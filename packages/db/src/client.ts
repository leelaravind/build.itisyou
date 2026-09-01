/**
 * Database client.
 *
 * ADR-0002: PostgreSQL everywhere. PGlite (real Postgres compiled to WebAssembly) in development and
 * test; a networked server when deployed. Same engine, same SQL semantics, same migrations — which
 * is the whole reason SQLite was rejected: row-level security, recursive CTEs and serialisable
 * isolation cannot be exercised on it, so the tenant-isolation suite would prove nothing about
 * production.
 *
 * `createTestDatabase()` returns a fresh in-memory instance per call. That is both faster than
 * truncating a shared database and impossible to leak state through — which matters for the ~50
 * isolation tests, where a leaked row between cases would be indistinguishable from the bug they
 * exist to catch.
 */

import { createHash } from 'node:crypto';

import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { sql, type ExtractTablesWithRelations, type SQL } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema.ts';

/**
 * A Drizzle handle over this schema, whichever driver is underneath.
 *
 * Drizzle's common supertype rather than the PGlite type it used to be. Every function taking a
 * `Database` performs schema operations that are identical on PGlite and on postgres-js, and typing
 * them to one driver meant the deployed path could not call them — which would have forced a second
 * copy of each, and a second copy is how the tenant scope drifted in the first place (KI-049).
 *
 * A transaction handle also satisfies this, which is what lets tenant-scoped callbacks pass their
 * transaction straight into these functions instead of reaching for the database and escaping the
 * scope.
 */
export type Database = PgDatabase<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

/**
 * The PGlite-backed handle specifically.
 *
 * Tests run on PGlite and nothing else, so they get the concrete type and keep their result typing:
 * `execute<{ id: string }>()` returns rows of that shape here, where on the driver-agnostic
 * supertype it cannot.
 */
export type EmbeddedDatabase = ReturnType<typeof drizzlePglite<typeof schema>>;

/** The transaction handle a PGlite transaction callback receives. */
export type EmbeddedTransaction = Parameters<Parameters<EmbeddedDatabase['transaction']>[0]>[0];

/**
 * The Postgres role application queries run as.
 *
 * Deliberately *not* the owner. Row-level security is bypassed by table owners and by superusers,
 * so running the application as the owner would leave RLS defined but never enforced — a control
 * that exists on paper only. See `applyRowLevelSecurity`.
 */
export const APP_ROLE = 'govintel_app';

/** Setting the RLS policies read to determine the current tenant. */
export const TENANT_SETTING = 'app.current_organization_id';

/**
 * Anything that can issue SQL. Both a Drizzle database and a Drizzle transaction satisfy it.
 *
 * Structural rather than nominal so this module does not have to name a driver: PGlite in
 * development and postgres-js when deployed produce different Drizzle types, and the tenant scope is
 * the same statements either way.
 */
export interface SqlExecutor {
  execute: (query: SQL) => Promise<unknown>;
}

/**
 * Apply the tenant scope. **Must be called inside a transaction.**
 *
 * This is the whole of KI-049, and the word doing the work is `LOCAL`.
 *
 * The previous implementation used `SET ROLE` and `set_config(..., false)` — both *session*-scoped —
 * with a `finally` that reset them. That is correct on PGlite, which is one connection serialised
 * behind a mutex, and unsafe behind any connection pooler: a pooled connection returns to the pool
 * still carrying a tenant identity, and the reset narrows the window without closing it. A process
 * that dies mid-request, or an isolate evicted between the query and the reset, hands the next
 * request a connection primed with somebody else's organisation.
 *
 * Row-level security would then apply that organisation *correctly*, and every query would return the
 * wrong tenant's rows while every test still passed.
 *
 * `SET LOCAL` and `is_local = true` are discarded when the transaction ends — whether it commits,
 * rolls back, or the connection dies. There is no window and no cleanup to fail to run. It is also
 * correct under transaction-mode poolers generally, so which pooler sits in front stops being
 * load-bearing.
 *
 * Exported and shared rather than written twice. The test helper below and the request layer in
 * `apps/web` both call this, so the isolation suite exercises the mechanism the application uses
 * rather than a copy of it that can drift.
 */
export async function applyTenantScope(tx: SqlExecutor, organizationId: string): Promise<void> {
  /*
   * `SET LOCAL ROLE` matters as much as the setting.
   *
   * A superuser bypasses row-level security unconditionally — `FORCE ROW LEVEL SECURITY` covers the
   * table *owner*, not a superuser — so without switching role the policies are defined and never
   * enforced. That is SEC-001.
   */
  await tx.execute(sql`SET LOCAL ROLE ${sql.raw(APP_ROLE)}`);
  await tx.execute(sql`SELECT set_config(${TENANT_SETTING}, ${organizationId}, true)`);
}

export interface TestDatabase {
  readonly db: EmbeddedDatabase;
  readonly client: PGlite;
  /** Run a callback with the tenant session variable set, as the request layer does. */
  readonly asTenant: <T>(
    organizationId: string,
    fn: (tx: EmbeddedTransaction) => Promise<T>,
  ) => Promise<T>;
  /** Empty every table, preserving the schema. Use between tests in a shared-instance suite. */
  readonly truncate: () => Promise<void>;
  readonly close: () => Promise<void>;
}

/**
 * Tables emptied by `truncate()`, in an order that respects foreign keys.
 * `TRUNCATE ... CASCADE` would also work, but naming them keeps the reset explicit: a new table
 * that nobody adds here will show up as state leaking between tests.
 */
const TRUNCATABLE = [
  'outbox_events',
  'audit_events',
  'intake_answers',
  'ai_imports',
  'project_members',
  'projects',
  'memberships',
  'guest_sessions',
  'organizations',
  'users',
] as const;

/**
 * An isolated in-memory database with the schema applied.
 *
 * Every call gets its own instance. Tests never share.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const client = new PGlite();
  const db = drizzlePglite(client, { schema });

  await applySchema(client);
  await createApplicationRole(client);
  // Applied unconditionally: RLS enabled is the production configuration, so tests should run
  // against it by default rather than opting in. Statements issued as the default superuser still
  // bypass it, which is what non-isolation tests want.
  await applyRowLevelSecurity(client);

  return {
    db,
    client,
    asTenant: async (organizationId, fn) =>
      /*
       * A transaction, calling the same `applyTenantScope` the request layer calls.
       *
       * Previously this duplicated the production statements, which meant the isolation suite
       * verified a *copy* of the mechanism. The copy and the original could drift, and under KI-049
       * they would have drifted in the one direction nobody would notice — the tests staying safe
       * while production did not.
       */
      db.transaction(async (tx) => {
        await applyTenantScope(tx, organizationId);
        return fn(tx);
      }),
    truncate: async () => {
      // RESTART IDENTITY keeps sequences from drifting across tests; TRUNCATE is dramatically
      // cheaper than recreating the instance (measured: ~1.5s per instance vs a few ms here).
      await client.exec(`TRUNCATE ${TRUNCATABLE.join(', ')} RESTART IDENTITY CASCADE;`);
    },
    close: async () => {
      await client.close();
    },
  };
}

/**
 * Create the schema.
 *
 * Written as explicit DDL rather than generated by drizzle-kit at test time: the migration is the
 * artefact that must be under version control (plan §27), and generating it on the fly would mean
 * tests exercise a schema that never appears in a migration file.
 *
 * Uses PGlite's `exec` rather than Drizzle's `execute`: `execute` sends a single statement, and this
 * script is many statements including `$$`-quoted function bodies that a naive split would mangle.
 */
export async function applySchema(client: PGlite): Promise<void> {
  await client.exec(SCHEMA_DDL);
}

export const SCHEMA_DDL = `
CREATE TYPE organization_role AS ENUM ('OWNER','ADMIN','MEMBER','AUDITOR');
CREATE TYPE project_role AS ENUM ('PROJECT_OWNER','PROJECT_MANAGER','ENGINEER','REVIEWER','APPROVER','VIEWER');
CREATE TYPE lifecycle_state AS ENUM (
  'IDEA','DISCOVERY','PLANNING','PLANNED','APPROVED','IN_PROGRESS',
  'VERIFYING','RELEASE_READY','LIVE','OPERATING','COMPLETED','ARCHIVED'
);
CREATE TYPE project_type AS ENUM (
  'PUBLIC_WEB_APP','SAAS_WEB_APP','INTERNAL_BUSINESS_APP','API_BACKEND_PLATFORM',
  'MOBILE_APP','AI_ENABLED_WEB_APP','DEVELOPER_TOOLING','ECOMMERCE',
  'PARTIALLY_SUPPORTED','UNKNOWN'
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issuer text NOT NULL,
  subject text NOT NULL,
  email text,
  display_name text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz
);
CREATE UNIQUE INDEX users_issuer_subject_idx ON users (issuer, subject);
CREATE INDEX users_email_idx ON users (email);

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL,
  external_ai_mode text NOT NULL DEFAULT 'USER_CHOICE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organizations_external_ai_mode_check
    CHECK (external_ai_mode IN ('DISABLED','REDACTED_ONLY','APPROVED_PROVIDERS_ONLY','USER_CHOICE'))
);
CREATE UNIQUE INDEX organizations_slug_idx ON organizations (slug);

CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role organization_role NOT NULL DEFAULT 'MEMBER',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX memberships_org_user_idx ON memberships (organization_id, user_id);
CREATE INDEX memberships_user_idx ON memberships (user_id);

CREATE TABLE guest_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  converted_to_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  converted_at timestamptz,
  CONSTRAINT guest_sessions_expiry_after_creation CHECK (expires_at > created_at)
);
CREATE INDEX guest_sessions_expires_idx ON guest_sessions (expires_at);

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  summary text,
  project_type project_type NOT NULL DEFAULT 'UNKNOWN',
  lifecycle_state lifecycle_state NOT NULL DEFAULT 'IDEA',
  version integer NOT NULL DEFAULT 1,
  base_currency text NOT NULL DEFAULT 'GBP',
  guest_session_id uuid,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT projects_version_positive CHECK (version >= 1),
  CONSTRAINT projects_currency_iso CHECK (char_length(base_currency) = 3),
  -- Exactly one owner: an organisation (saved) or a guest session (unsaved), never both, never
  -- neither. Prevents an unreachable orphan and an ambiguous dual-access row.
  CONSTRAINT projects_single_owner
    CHECK ((organization_id IS NULL) <> (guest_session_id IS NULL))
);
CREATE INDEX projects_org_idx ON projects (organization_id);
CREATE INDEX projects_org_lifecycle_idx ON projects (organization_id, lifecycle_state);
CREATE INDEX projects_guest_session_idx ON projects (guest_session_id);

CREATE TABLE project_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role project_role NOT NULL DEFAULT 'VIEWER',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX project_members_project_user_idx ON project_members (project_id, user_id);
CREATE INDEX project_members_org_idx ON project_members (organization_id);
CREATE INDEX project_members_user_idx ON project_members (user_id);

CREATE TABLE intake_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  field_id text NOT NULL,
  category text NOT NULL,
  value jsonb,
  state text NOT NULL,
  provenance text NOT NULL,
  confidence text NOT NULL,
  note text,
  confirmed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT intake_answers_state_check CHECK (
    state IN ('CONFIRMED','PROVIDED','ASSUMED','UNKNOWN','EXTERNAL_RESEARCH_REQUIRED','CONFLICTING','UNANSWERED')
  ),
  -- A value must be absent exactly when the state says there is no answer. Stops the worst intake
  -- bug: a field shown as "unknown" with a stale value underneath still feeding the engine.
  CONSTRAINT intake_answers_value_matches_state CHECK (
    (state IN ('UNKNOWN','UNANSWERED','EXTERNAL_RESEARCH_REQUIRED')) = (value IS NULL)
  )
);
CREATE UNIQUE INDEX intake_answers_project_field_idx ON intake_answers (project_id, field_id);
CREATE INDEX intake_answers_project_idx ON intake_answers (project_id);
CREATE INDEX intake_answers_org_idx ON intake_answers (organization_id);

CREATE TABLE ai_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  prompt_id text,
  state text NOT NULL DEFAULT 'RAW',
  raw text NOT NULL,
  response jsonb,
  validation jsonb,
  schema_version text,
  validator_version text,
  decided_by uuid REFERENCES users(id) ON DELETE SET NULL,
  decision_reason text,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_imports_state_check CHECK (
    state IN ('RAW','PARSED','VALIDATED','ACCEPTED','REJECTED','MATERIALIZED')
  ),
  -- The third lock. The application refuses this twice already; the database refuses it at a layer
  -- that a bug in the other two cannot bypass.
  CONSTRAINT ai_imports_decided_requires_validation CHECK (
    state NOT IN ('ACCEPTED','MATERIALIZED') OR validation IS NOT NULL
  )
);
CREATE INDEX ai_imports_project_idx ON ai_imports (project_id);
CREATE INDEX ai_imports_org_idx ON ai_imports (organization_id);
CREATE UNIQUE INDEX ai_imports_idempotency_idx ON ai_imports (idempotency_key);

-- ---------------------------------------------------------------------------
-- Project Digital Twin (gap-spec §8).
--
-- The canonical project graph. One row per node, one per edge — not one per
-- version: gap-spec §8.4 forbids copying the database per change, so history
-- lives in twin_changes and twin_baselines instead.
--
-- The class column is text with a CHECK rather than a Postgres enum. Enums require an
-- ALTER TYPE to extend, which locks the table and cannot run inside the same
-- transaction as its use; a CHECK is a cheap constraint change. The taxonomy is
-- still closed: it is enforced in packages/twin/src/nodes.ts and asserted
-- against this list by a test, so the two cannot drift.
-- ---------------------------------------------------------------------------
CREATE TABLE twin_nodes (
  id text PRIMARY KEY,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  class text NOT NULL,
  label text NOT NULL,
  description text,
  state text NOT NULL DEFAULT 'ACTIVE',
  provenance text NOT NULL,
  confidence text NOT NULL,
  source_ref text,
  revision integer NOT NULL DEFAULT 1,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT twin_nodes_state_check CHECK (state IN ('ACTIVE','SUPERSEDED','WITHDRAWN')),
  CONSTRAINT twin_nodes_revision_check CHECK (revision >= 1),
  -- An AI cannot claim a user confirmed something. Same rule as the interchange
  -- schema, enforced again here because a node can also arrive from a rule, an
  -- import or a migration — the schema only guards one of those paths.
  CONSTRAINT twin_nodes_provenance_check CHECK (
    provenance IN (
      'USER_CONFIRMED','DETERMINISTIC_CALCULATION','USER_PROVIDED','EXTERNAL_SOURCE',
      'ASSUMPTION','EXTERNAL_AI_INFERENCE','FUTURE_ML_PREDICTION'
    )
  ),
  CONSTRAINT twin_nodes_confidence_check CHECK (confidence IN ('LOW','MEDIUM','HIGH'))
);
CREATE INDEX twin_nodes_project_idx ON twin_nodes (project_id);
CREATE INDEX twin_nodes_org_idx ON twin_nodes (organization_id);
CREATE INDEX twin_nodes_project_class_idx ON twin_nodes (project_id, class);

CREATE TABLE twin_edges (
  id text PRIMARY KEY,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  class text NOT NULL,
  from_id text NOT NULL REFERENCES twin_nodes(id) ON DELETE CASCADE,
  to_id text NOT NULL REFERENCES twin_nodes(id) ON DELETE CASCADE,
  rationale text,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Irreflexivity is a property of every edge class in the taxonomy, so it is
  -- enforced here rather than left to the invariant pass. A node that depends on
  -- itself is meaningless in every relation the graph has.
  CONSTRAINT twin_edges_no_self_reference CHECK (from_id <> to_id)
);
CREATE INDEX twin_edges_project_idx ON twin_edges (project_id);
CREATE INDEX twin_edges_org_idx ON twin_edges (organization_id);
CREATE INDEX twin_edges_from_idx ON twin_edges (from_id, class);
CREATE INDEX twin_edges_to_idx ON twin_edges (to_id, class);
-- The same relationship asserted twice between the same pair is not additional
-- information; it is a duplicate that every traversal would then count twice.
CREATE UNIQUE INDEX twin_edges_unique_idx ON twin_edges (from_id, class, to_id);

-- One entry per material change. Not one row per node version.
CREATE TABLE twin_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version integer NOT NULL,
  correlation_id uuid NOT NULL,
  kind text NOT NULL,
  target_id text NOT NULL,
  before_value jsonb,
  after_value jsonb,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT twin_changes_kind_check CHECK (
    kind IN ('NODE_CREATED','NODE_UPDATED','NODE_SUPERSEDED','NODE_WITHDRAWN',
             'EDGE_CREATED','EDGE_REMOVED')
  )
);
CREATE INDEX twin_changes_project_idx ON twin_changes (project_id, version);
CREATE INDEX twin_changes_target_idx ON twin_changes (target_id);

-- Immutable, and enforced by trigger rather than by convention — the same
-- argument as the audit table. A baseline the application can edit is a claim
-- about the past, not a record of it.
CREATE TABLE twin_baselines (
  id text PRIMARY KEY,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version integer NOT NULL,
  label text NOT NULL,
  correlation_id uuid NOT NULL,
  checksum text NOT NULL,
  snapshot jsonb NOT NULL,
  taken_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT twin_baselines_checksum_check CHECK (char_length(checksum) = 64)
);
CREATE INDEX twin_baselines_project_idx ON twin_baselines (project_id, version);

CREATE OR REPLACE FUNCTION twin_baselines_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'twin_baselines is immutable: % is not permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER twin_baselines_no_update
  BEFORE UPDATE ON twin_baselines
  FOR EACH ROW EXECUTE FUNCTION twin_baselines_immutable();

CREATE TRIGGER twin_baselines_no_delete
  BEFORE DELETE ON twin_baselines
  FOR EACH ROW EXECUTE FUNCTION twin_baselines_immutable();

-- A stored figure with no record of the formula version or the inputs cannot be
-- explained later, and carries an authority it has not earned.
CREATE TABLE twin_calculations (
  id text PRIMARY KEY,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version integer NOT NULL,
  calculation text NOT NULL,
  formula_version text NOT NULL,
  correlation_id uuid NOT NULL,
  inputs jsonb NOT NULL,
  result jsonb NOT NULL,
  depends_on text[] NOT NULL DEFAULT '{}',
  assumptions text[] NOT NULL DEFAULT '{}',
  computed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX twin_calculations_project_idx ON twin_calculations (project_id, calculation);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id uuid REFERENCES projects(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_guest_session_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  correlation_id uuid NOT NULL,
  summary jsonb,
  payload_hash text,
  reason text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_org_time_idx ON audit_events (organization_id, occurred_at);
CREATE INDEX audit_events_project_time_idx ON audit_events (project_id, occurred_at);
CREATE INDEX audit_events_correlation_idx ON audit_events (correlation_id);
CREATE INDEX audit_events_actor_idx ON audit_events (actor_user_id);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  correlation_id uuid NOT NULL,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  -- When the drainer last claimed this row. Distinct from created_at and from processed_at: a
  -- claim that never resulted in a publish must expire, or a drainer that died between claiming
  -- and publishing would strand the row forever — which looks exactly like a side effect nobody
  -- ever needed.
  last_attempted_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  last_error_code text,
  dead_lettered boolean NOT NULL DEFAULT false
);
CREATE INDEX outbox_unprocessed_idx ON outbox_events (processed_at, created_at);
CREATE UNIQUE INDEX outbox_idempotency_idx ON outbox_events (idempotency_key);
CREATE INDEX outbox_correlation_idx ON outbox_events (correlation_id);

-- ---------------------------------------------------------------------------
-- Audit immutability (plan §20, gap-spec §40).
--
-- Enforced by trigger, not by convention. An audit trail that the application
-- can edit is not an audit trail, and "we never call UPDATE on it" is a promise
-- rather than a control.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_events_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_no_update
  BEFORE UPDATE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_immutable();

CREATE TRIGGER audit_events_no_delete
  BEFORE DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_immutable();
`;

/**
 * Row-level security policies.
 *
 * Defence in depth (plan §3.2). The application already filters by tenant; this ensures a query
 * that bypasses `tenancy.ts` — a raw statement, a hand-written join, a future refactor that drops a
 * `where` clause — still returns nothing from another tenant.
 *
 * `FORCE ROW LEVEL SECURITY` matters: without it, the table owner bypasses its own policies, and in
 * most deployments the migration user and the application user are the same. RLS that the
 * application silently bypasses is worse than no RLS, because it looks like a control.
 */
export const ROW_LEVEL_SECURITY_DDL = `
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
CREATE POLICY projects_tenant_isolation ON projects
  USING (organization_id::text = current_setting('${TENANT_SETTING}', true))
  WITH CHECK (organization_id::text = current_setting('${TENANT_SETTING}', true));

ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members FORCE ROW LEVEL SECURITY;
CREATE POLICY project_members_tenant_isolation ON project_members
  USING (organization_id::text = current_setting('${TENANT_SETTING}', true))
  WITH CHECK (organization_id::text = current_setting('${TENANT_SETTING}', true));

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY memberships_tenant_isolation ON memberships
  USING (organization_id::text = current_setting('${TENANT_SETTING}', true))
  WITH CHECK (organization_id::text = current_setting('${TENANT_SETTING}', true));

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_events_tenant_isolation ON audit_events
  USING (organization_id::text = current_setting('${TENANT_SETTING}', true))
  WITH CHECK (organization_id::text = current_setting('${TENANT_SETTING}', true));

ALTER TABLE twin_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE twin_nodes FORCE ROW LEVEL SECURITY;
CREATE POLICY twin_nodes_tenant_isolation ON twin_nodes
  USING (organization_id::text = current_setting('${TENANT_SETTING}', true))
  WITH CHECK (organization_id::text = current_setting('${TENANT_SETTING}', true));

ALTER TABLE twin_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE twin_edges FORCE ROW LEVEL SECURITY;
CREATE POLICY twin_edges_tenant_isolation ON twin_edges
  USING (organization_id::text = current_setting('${TENANT_SETTING}', true))
  WITH CHECK (organization_id::text = current_setting('${TENANT_SETTING}', true));

ALTER TABLE twin_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE twin_changes FORCE ROW LEVEL SECURITY;
CREATE POLICY twin_changes_tenant_isolation ON twin_changes
  USING (organization_id::text = current_setting('${TENANT_SETTING}', true))
  WITH CHECK (organization_id::text = current_setting('${TENANT_SETTING}', true));

ALTER TABLE twin_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE twin_baselines FORCE ROW LEVEL SECURITY;
CREATE POLICY twin_baselines_tenant_isolation ON twin_baselines
  USING (organization_id::text = current_setting('${TENANT_SETTING}', true))
  WITH CHECK (organization_id::text = current_setting('${TENANT_SETTING}', true));

ALTER TABLE twin_calculations ENABLE ROW LEVEL SECURITY;
ALTER TABLE twin_calculations FORCE ROW LEVEL SECURITY;
CREATE POLICY twin_calculations_tenant_isolation ON twin_calculations
  USING (organization_id::text = current_setting('${TENANT_SETTING}', true))
  WITH CHECK (organization_id::text = current_setting('${TENANT_SETTING}', true));

ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_events FORCE ROW LEVEL SECURITY;
CREATE POLICY outbox_events_tenant_isolation ON outbox_events
  USING (organization_id::text = current_setting('${TENANT_SETTING}', true))
  WITH CHECK (organization_id::text = current_setting('${TENANT_SETTING}', true));
`;

export async function applyRowLevelSecurity(client: PGlite): Promise<void> {
  await client.exec(ROW_LEVEL_SECURITY_DDL);
}

/**
 * Create the least-privilege role the application runs as.
 *
 * Explicitly `NOSUPERUSER`: a superuser bypasses every RLS policy, so an application connecting as
 * one would have row-level security defined and never enforced — a control that exists only on
 * paper. The role is granted DML on the tenant tables and nothing more; no DDL, no ownership.
 */
export async function createApplicationRole(client: PGlite): Promise<void> {
  await client.exec(APPLICATION_ROLE_DDL);
}

/**
 * Role creation, written to be safe to run twice.
 *
 * Roles live in the cluster, not in a schema, so they outlive `DROP SCHEMA public CASCADE` — which
 * `rebuildSchema` does. A bare `CREATE ROLE` would then fail on the second boot with a duplicate
 * object error, and the grants after it would never run, leaving the application unable to read its
 * own tables. The grants are re-issued unconditionally because a rebuilt schema contains new tables
 * that the earlier `GRANT ... ON ALL TABLES` never covered.
 */
export const APPLICATION_ROLE_DDL = `
DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
    CREATE ROLE ${APP_ROLE} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$role$;
GRANT USAGE ON SCHEMA public TO ${APP_ROLE};
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE};
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};
`;

/**
 * A fingerprint of the structure this build expects.
 *
 * There is no migration system yet — that arrives with the deployment target in Phase 19 — so a
 * development data directory created by an earlier build keeps whatever tables it had. The old
 * bootstrap asked "does `projects` exist?" and treated yes as "the schema is current", which meant
 * every table added after the directory was created was silently absent. `ai_imports` was the first
 * to hit it, and the symptom was a generic insert failure three layers away from the cause.
 *
 * A hash of the DDL turns "the local database is out of date" from a silent wrong answer into a
 * detectable condition. It is not a migration: it can tell you the structure changed, not how to get
 * from one to the other. That is the correct trade for a development-only path, and deliberately not
 * good enough for a deployed one — where the data cannot be thrown away and real migrations are
 * required.
 */
export const SCHEMA_FINGERPRINT = createHash('sha256')
  .update(SCHEMA_DDL)
  .update(ROW_LEVEL_SECURITY_DDL)
  .digest('hex')
  .slice(0, 32);

/** Records which structure a database was built from, so drift is detectable rather than silent. */
export const SCHEMA_META_DDL = `
CREATE TABLE IF NOT EXISTS schema_meta (
  fingerprint text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
`;

/**
 * The rows of an `execute()` result, whichever driver produced it.
 *
 * The two drivers disagree about the shape and nothing in the type system says so. Drizzle's PGlite
 * adapter returns `{ rows: [...] }`; its postgres-js adapter returns the array itself. `execute()` is
 * typed loosely enough that both satisfy it, so reading `.rows` compiles against either and is
 * correct against only one.
 *
 * This was found on the first real staging deployment and it had produced two live defects:
 *
 * - The outbox drainer read `.rows.length` off an array, threw `TypeError` inside the cron handler,
 *   and left claimed rows unpublished. Every tick failed identically; the only trace was a log line
 *   in a Worker nothing was watching.
 * - `readSchemaFingerprintFrom` read `.rows[0]` off an array and would have returned `null` for every
 *   deployed database — so the web Worker would have refused to serve, reporting a migration failure
 *   against a database whose schema was in fact correct.
 *
 * Both were invisible locally because every test runs on PGlite, which is the shape the code assumed.
 * That is the same root cause as KI-049: **the development database is not the deployed one, and the
 * places they differ are exactly the places tests cannot reach.**
 *
 * Throws rather than returning `[]` for an unrecognised shape. Returning empty is what the drainer
 * effectively did, and "there is nothing to do" is indistinguishable from "I could not tell" right up
 * until somebody asks why a queue never drained.
 */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];

  if (typeof result === 'object' && result !== null) {
    const { rows } = result as { rows?: unknown };
    if (Array.isArray(rows)) return rows as T[];
  }

  throw new TypeError(
    `Unrecognised query result shape: expected an array or { rows }, received ${
      result === null ? 'null' : typeof result
    }. A driver has changed its result shape — see rowsOf() in packages/db/src/client.ts.`,
  );
}

/**
 * The fingerprint a database was built from, or `null` if it predates fingerprinting or is empty.
 */
export async function readSchemaFingerprint(client: PGlite): Promise<string | null> {
  const present = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'schema_meta'`,
  );

  if ((present.rows[0]?.count ?? 0) === 0) return null;

  const row = await client.query<{ fingerprint: string }>(
    'SELECT fingerprint FROM schema_meta ORDER BY applied_at DESC LIMIT 1',
  );

  return row.rows[0]?.fingerprint ?? null;
}

/**
 * The same question, asked through Drizzle rather than through a PGlite client.
 *
 * Exists because the deployed path talks to postgres-js and the development path talks to PGlite,
 * and the fingerprint check has to run on both — it is the thing that decides whether a build may
 * serve traffic at all (KI-026).
 *
 * Returns `null` rather than throwing when the table is absent, because "this database has never had
 * a schema applied" and "this database has the wrong schema" are different situations and the caller
 * distinguishes them in its message.
 */
export async function readSchemaFingerprintFrom(tx: SqlExecutor): Promise<string | null> {
  const present = rowsOf<{ count: number }>(
    await tx.execute(
      sql`SELECT count(*)::int AS count FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'schema_meta'`,
    ),
  );

  if ((present[0]?.count ?? 0) === 0) return null;

  const rows = rowsOf<{ fingerprint: string }>(
    await tx.execute(sql`SELECT fingerprint FROM schema_meta ORDER BY applied_at DESC LIMIT 1`),
  );

  return rows[0]?.fingerprint ?? null;
}

/**
 * Build the schema from nothing, discarding whatever was there.
 *
 * `DROP SCHEMA public CASCADE` rather than dropping tables one by one: the enum types, triggers and
 * functions have to go too, and enumerating them is a list that will be wrong the moment someone
 * adds one.
 *
 * **Development and test only.** Nothing in a deployed environment may call this: it destroys data,
 * and the whole point of the Phase-19 migration work is that deployed schemas change without doing
 * that. `assertNotDeployed` is the caller's responsibility, because this module has no view of the
 * environment.
 */
export async function rebuildSchema(client: PGlite): Promise<void> {
  await client.exec('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await client.exec(SCHEMA_DDL);
  await client.exec(SCHEMA_META_DDL);
  await client.exec(APPLICATION_ROLE_DDL);
  await client.exec(ROW_LEVEL_SECURITY_DDL);
  await client.query('INSERT INTO schema_meta (fingerprint) VALUES ($1)', [SCHEMA_FINGERPRINT]);
}
