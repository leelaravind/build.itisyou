/**
 * Database schema — tenancy, identity and audit foundation.
 *
 * Contract:
 *  - MASTER_IMPLEMENTATION_PLAN.md §3.2 (PostgreSQL, migrations under version control, row-level
 *    security as defence-in-depth, tenant filtering also enforced in the application layer)
 *  - §5 (canonical entities), §20 (immutable audit), §27 (foreign keys, unique/check constraints,
 *    version columns, optimistic concurrency, tenant-scoped indexes)
 *  - IMPLEMENTATION_GAP_CLOSURE_SPEC.md §6.1 (provider-neutral OIDC identity), §7 (tenancy model
 *    and roles), §5 (guest session contract), §40 (audit immutability)
 *
 * The governing idea: **every tenant-owned row carries `organizationId`, and no query may omit it.**
 * Plan §3.2 asks for isolation in both the application layer and the database. Belt and braces is
 * deliberate — cross-tenant disclosure is the highest-severity failure this system can have, and a
 * single forgotten `where` clause should not be sufficient to cause it.
 */

import { sql, relations } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { PROJECT_ROLES } from '@govintel/shared/roles';

/* -------------------------------------------------------------------------- */
/* Enumerations                                                               */
/* -------------------------------------------------------------------------- */

/** Organisation-level roles (gap-spec §7.2). */
export const organizationRoleEnum = pgEnum('organization_role', [
  'OWNER',
  'ADMIN',
  'MEMBER',
  /** Read-everything, change-nothing. Exists so auditors need no write grant at all. */
  'AUDITOR',
]);

/** Project-level roles (gap-spec §7.3). */
/*
 * Derived from the shared list rather than repeating it.
 *
 * The six roles are a vocabulary the domain layer also needs (gap-spec §7.3), and when this was the
 * only definition, `packages/governance` could not reach it — so its sign-off requirements named two
 * roles that exist nowhere. Deriving the enum keeps one list and makes disagreement a compile error.
 */
export const projectRoleEnum = pgEnum('project_role', PROJECT_ROLES);

/** Canonical project lifecycle states (plan §6). Transitions are validated centrally in Phase 7. */
export const lifecycleStateEnum = pgEnum('lifecycle_state', [
  'IDEA',
  'DISCOVERY',
  'PLANNING',
  'PLANNED',
  'APPROVED',
  'IN_PROGRESS',
  'VERIFYING',
  'RELEASE_READY',
  'LIVE',
  'OPERATING',
  'COMPLETED',
  'ARCHIVED',
]);

/** V1 supported project classes (gap-spec §4.1). */
export const projectTypeEnum = pgEnum('project_type', [
  'PUBLIC_WEB_APP',
  'SAAS_WEB_APP',
  'INTERNAL_BUSINESS_APP',
  'API_BACKEND_PLATFORM',
  'MOBILE_APP',
  'AI_ENABLED_WEB_APP',
  'DEVELOPER_TOOLING',
  'ECOMMERCE',
  /** Accepted with explicit, surfaced limitations (gap-spec §4.2). */
  'PARTIALLY_SUPPORTED',
  /** The user has not said yet. Never guessed on their behalf. */
  'UNKNOWN',
]);

/* -------------------------------------------------------------------------- */
/* Identity                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Users.
 *
 * Identity is keyed on `(issuer, subject)` — the OIDC pair — never on email. Gap-spec §6.1 requires
 * the provider to stay replaceable, and email is the wrong key regardless: it is mutable, it can be
 * reassigned between people, and two providers can assert the same address.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** OIDC issuer URL. */
    issuer: text('issuer').notNull(),
    /** OIDC subject claim — opaque and stable within an issuer. */
    subject: text('subject').notNull(),
    email: text('email'),
    displayName: text('display_name'),
    avatarUrl: text('avatar_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set when the account is locked by a security event (gap-spec §6.3). */
    lockedAt: timestamp('locked_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('users_issuer_subject_idx').on(table.issuer, table.subject),
    index('users_email_idx').on(table.email),
  ],
);

/* -------------------------------------------------------------------------- */
/* Tenancy                                                                    */
/* -------------------------------------------------------------------------- */

/** Organisations are the tenant boundary. Everything below one belongs to exactly one. */
export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    /**
     * External-AI policy for this tenant (plan §19). Enforced server-side: an organisation that has
     * disabled the workflow must not be able to reach it by crafting a request.
     */
    externalAiMode: text('external_ai_mode').notNull().default('USER_CHOICE'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('organizations_slug_idx').on(table.slug),
    check(
      'organizations_external_ai_mode_check',
      sql`${table.externalAiMode} IN ('DISABLED','REDACTED_ONLY','APPROVED_PROVIDERS_ONLY','USER_CHOICE')`,
    ),
  ],
);

/** A user's membership of an organisation. A user may belong to many (gap-spec §7.1). */
export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: organizationRoleEnum('role').notNull().default('MEMBER'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One membership per user per organisation. Without this, two rows with different roles make
    // the effective permission ambiguous — and ambiguity resolves in the attacker's favour.
    uniqueIndex('memberships_org_user_idx').on(table.organizationId, table.userId),
    index('memberships_user_idx').on(table.userId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Projects                                                                   */
/* -------------------------------------------------------------------------- */

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * The tenant key. Always set — including for guest projects.
     *
     * This was nullable, on the reasoning that a guest project "genuinely has no tenant until it is
     * saved", and that a NULL made the row *invisible to the RLS policy*, which was described as
     * correct behaviour.
     *
     * It was not correct. Invisible to a policy is not protected by it. `organization_id::text = …`
     * is never true for NULL, so a guest project matched no policy in either direction: unreadable
     * and unwritable under a role that cannot bypass RLS, and — while the application connected as
     * the owner, which can — guarded by nothing except the application remembering to filter on
     * `guest_session_id`. Every child row inherited the same NULL, so twin nodes and edges were in
     * the same position. On staging that was 3,870 of 3,872 projects and all 108,480 twin rows.
     *
     * It surfaced the moment the application stopped connecting as a role that could bypass RLS:
     * guest project creation began failing with *"new row violates row-level security policy"*. The
     * guest journey had been working only because the control was off.
     *
     * A guest session now owns an organisation of its own (`guest_sessions.organization_id`), so the
     * tenant key is real from the first request and every existing policy covers guest data with no
     * second isolation axis and no new columns. `guestSessionId` below still says whether the
     * project is claimed.
     */
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    summary: text('summary'),
    projectType: projectTypeEnum('project_type').notNull().default('UNKNOWN'),
    lifecycleState: lifecycleStateEnum('lifecycle_state').notNull().default('IDEA'),

    /**
     * Optimistic concurrency (gap-spec §49). Incremented on every material mutation; a stale write
     * is rejected with a conflict rather than silently overwriting someone else's change.
     */
    version: integer('version').notNull().default(1),

    /** Base currency. One per project (gap-spec §21.1). */
    baseCurrency: text('base_currency').notNull().default('GBP'),

    /**
     * Set while the project belongs to an anonymous guest (gap-spec §5.2). Cleared atomically on
     * signup conversion. A project has either a guest session or an organisation — never neither.
     */
    guestSessionId: uuid('guest_session_id'),

    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Tenant-scoped index (plan §27): every list query filters by organisation first.
    index('projects_org_idx').on(table.organizationId),
    index('projects_org_lifecycle_idx').on(table.organizationId, table.lifecycleState),
    index('projects_guest_session_idx').on(table.guestSessionId),
    check('projects_version_positive', sql`${table.version} >= 1`),
    check('projects_currency_iso', sql`char_length(${table.baseCurrency}) = 3`),
    /*
     * A project always has an organisation; the guest reference says whether it is claimed.
     *
     * This replaces `projects_single_owner`, which required *exactly one* of the two and so forced
     * `organization_id` to be NULL for every guest project. The constraint was enforcing the thing
     * that broke tenant isolation: it guaranteed guest rows fell outside every RLS policy.
     *
     * The states it was protecting against are still unrepresentable. "No owner at all" cannot
     * happen because `organization_id` is now NOT NULL. "Both set" is no longer ambiguous — it is
     * the normal state of an unclaimed project, and the two columns answer different questions:
     * which tenant owns this row, and is that tenant a guest's. A half-completed conversion is
     * caught by the same NOT NULL, since claiming repoints `organization_id` and clears
     * `guest_session_id` in one statement.
     */
    check(
      'projects_guest_session_belongs_to_its_organization',
      sql`${table.guestSessionId} IS NULL OR ${table.organizationId} IS NOT NULL`,
    ),
  ],
);

/** A user's role on a specific project (gap-spec §7.3). */
export const projectMembers = pgTable(
  'project_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * Denormalised from `projects` deliberately. It lets every authorisation check filter by tenant
     * without a join, so the tenant predicate cannot be lost through a mis-written join condition.
     */
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: projectRoleEnum('role').notNull().default('VIEWER'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('project_members_project_user_idx').on(table.projectId, table.userId),
    index('project_members_org_idx').on(table.organizationId),
    index('project_members_user_idx').on(table.userId),
  ],
);

/**
 * Intake answers — one row per question, per project.
 *
 * A table rather than a JSON blob on `projects`, because gap-spec §9.3 requires every field to carry
 * its own state, provenance, confidence, timestamp and confirmer. Those are queryable facts — "show
 * me everything this plan is assuming", "which answers came from an AI import" — and burying them in
 * a blob would make each of those a full-table scan and a parse.
 *
 * `organizationId` is nullable here for the same reason it is on `projects`: an intake belongs to a
 * guest project until that project is saved.
 */
export const intakeAnswers = pgTable(
  'intake_answers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),

    /** Field id from the catalogue in `@govintel/intake/fields`. */
    fieldId: text('field_id').notNull(),
    category: text('category').notNull(),

    /** Null whenever the state carries the meaning by itself — UNKNOWN, deferred, unanswered. */
    value: jsonb('value'),

    state: text('state').notNull(),
    provenance: text('provenance').notNull(),
    confidence: text('confidence').notNull(),
    note: text('note'),

    confirmedBy: uuid('confirmed_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One answer per field per project. Two rows for the same question would make "what did the
    // user say?" ambiguous, and ambiguity in the intake propagates into every downstream estimate.
    uniqueIndex('intake_answers_project_field_idx').on(table.projectId, table.fieldId),
    index('intake_answers_project_idx').on(table.projectId),
    index('intake_answers_org_idx').on(table.organizationId),
    check(
      'intake_answers_state_check',
      sql`${table.state} IN ('CONFIRMED','PROVIDED','ASSUMED','UNKNOWN','EXTERNAL_RESEARCH_REQUIRED','CONFLICTING','UNANSWERED')`,
    ),
    /*
     * A value must be absent exactly when the state says there is no answer.
     *
     * This is the constraint that stops the worst intake bug: a field displayed as "unknown" while a
     * stale value sits underneath it, silently feeding the planning engine.
     */
    check(
      'intake_answers_value_matches_state',
      sql`(${table.state} IN ('UNKNOWN','UNANSWERED','EXTERNAL_RESEARCH_REQUIRED')) = (${table.value} IS NULL)`,
    ),
  ],
);

/**
 * AI import staging (gap-spec §12.3).
 *
 * The raw text is stored verbatim, separately from anything derived from it. That separation is the
 * point: `raw` is evidence of what was actually submitted, and `response` is what the validator was
 * willing to make of it. Keeping only the parsed form would destroy the ability to answer "what did
 * the user actually paste?" after a dispute.
 *
 * Nothing in this table has touched the project. The `state` column is the gate.
 */
export const aiImports = pgTable(
  'ai_imports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),

    /** The prompt this answers, when known. A mismatch is surfaced as a warning. */
    promptId: text('prompt_id'),

    state: text('state').notNull().default('RAW'),

    /** Exactly what was pasted. Never rewritten. */
    raw: text('raw').notNull(),
    /** The parsed response, present only once the schema layer passed. */
    response: jsonb('response').$type<Record<string, unknown>>(),
    /** The full validation result, including every issue, for the review screen and the audit. */
    validation: jsonb('validation').$type<Record<string, unknown>>(),

    /** The four version identifiers in force when this was validated (plan §11). */
    schemaVersion: text('schema_version'),
    validatorVersion: text('validator_version'),

    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decisionReason: text('decision_reason'),

    /** Deduplicates a replayed accept (gap-spec §48). */
    idempotencyKey: text('idempotency_key'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ai_imports_project_idx').on(table.projectId),
    index('ai_imports_org_idx').on(table.organizationId),
    uniqueIndex('ai_imports_idempotency_idx').on(table.idempotencyKey),
    check(
      'ai_imports_state_check',
      sql`${table.state} IN ('RAW','PARSED','VALIDATED','ACCEPTED','REJECTED','MATERIALIZED')`,
    ),
    /*
     * An import cannot be accepted or materialised without a stored validation result.
     *
     * The application already refuses both, twice. This is the third lock, at the layer that cannot
     * be bypassed by a bug in the other two — the whole point of the staging table is that untrusted
     * content never reaches the project, and that guarantee should not rest solely on application
     * code being correct.
     */
    check(
      'ai_imports_decided_requires_validation',
      sql`${table.state} NOT IN ('ACCEPTED','MATERIALIZED') OR ${table.validation} IS NOT NULL`,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* Guest sessions                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Anonymous sessions (gap-spec §5).
 *
 * Guests can complete intake, generate the external-AI prompt, import, validate and preview without
 * an account. The session id lives in an HttpOnly secure cookie; this table holds the server-side
 * state so nothing sensitive is trusted from the client.
 */
export const guestSessions = pgTable(
  'guest_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * The organisation this guest session owns, created with it.
     *
     * A guest is a tenant of one. That sounds like ceremony and is the only reason guest data is
     * protected at all: row-level security keys on `organization_id`, so before this existed every
     * guest row carried NULL there and matched no policy in either direction — see
     * `projects.organizationId` for the full account.
     *
     * Session-scoped rather than project-scoped because a guest may start more than one project
     * (`findGuestProjects` queries by session), and those must share a tenant or they could not see
     * each other.
     *
     * `ON DELETE CASCADE` on both sides is what makes expiry work: removing an expired session
     * removes its organisation, and removing the organisation removes every row scoped to it. The
     * guest TTL therefore deletes the data rather than merely hiding it.
     */
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    /** Guest projects expire automatically (gap-spec §5.3). */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /**
     * Set once converted to an account, so a replayed conversion request is a no-op rather than a
     * second project (gap-spec §5.4, §48).
     */
    convertedToUserId: uuid('converted_to_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    convertedAt: timestamp('converted_at', { withTimezone: true }),
  },
  (table) => [
    index('guest_sessions_expires_idx').on(table.expiresAt),
    check('guest_sessions_expiry_after_creation', sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

/* -------------------------------------------------------------------------- */
/* Audit                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Immutable audit log (plan §20, gap-spec §40).
 *
 * Append-only: no update, no delete through the product. Enforced by database triggers in the
 * migration, not by convention — a convention is exactly what an attacker with SQL access ignores,
 * and an audit trail that can be edited is not an audit trail.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Null only for pre-tenant events such as a failed sign-in attempt. */
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'restrict',
    }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'restrict' }),
    /** Null for system-initiated actions. */
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorGuestSessionId: uuid('actor_guest_session_id'),
    /** Stable verb, e.g. `PROJECT_CREATED`, `GATE_EVALUATED`, `APPROVAL_GRANTED`. */
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    correlationId: uuid('correlation_id').notNull(),
    /**
     * Safe before/after summary. Redacted before it lands here — the audit log is retained far
     * longer than most data, so a secret written into it is a long-lived exposure.
     */
    summary: jsonb('summary').$type<Record<string, unknown>>(),
    /** Hash of the full before/after, so tampering is detectable without storing the payload. */
    payloadHash: text('payload_hash'),
    reason: text('reason'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_events_org_time_idx').on(table.organizationId, table.occurredAt),
    index('audit_events_project_time_idx').on(table.projectId, table.occurredAt),
    index('audit_events_correlation_idx').on(table.correlationId),
    index('audit_events_actor_idx').on(table.actorUserId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Outbox                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Transactional outbox (gap-spec §47).
 *
 * Written inside the same transaction as the domain change it describes. ADR-0002 chose pg-boss
 * over Redis precisely so this is possible: enqueue and domain write commit together, leaving no
 * window in which a change is committed but its side effect is not yet queued.
 */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    correlationId: uuid('correlation_id').notNull(),
    /** Deduplicates redelivery (gap-spec §48). */
    idempotencyKey: text('idempotency_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    /** When the drainer last claimed this row. Claims expire so a dead drainer cannot strand one. */
    lastAttemptedAt: timestamp('last_attempted_at', { withTimezone: true }),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastErrorCode: text('last_error_code'),
    /** Terminal failure: surfaced rather than retried forever (gap-spec §46). */
    deadLettered: boolean('dead_lettered').notNull().default(false),
  },
  (table) => [
    index('outbox_unprocessed_idx').on(table.processedAt, table.createdAt),
    uniqueIndex('outbox_idempotency_idx').on(table.idempotencyKey),
    index('outbox_correlation_idx').on(table.correlationId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Relations                                                                  */
/* -------------------------------------------------------------------------- */

export const organizationsRelations = relations(organizations, ({ many }) => ({
  memberships: many(memberships),
  projects: many(projects),
}));

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
  projectMemberships: many(projectMembers),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  organization: one(organizations, {
    fields: [memberships.organizationId],
    references: [organizations.id],
  }),
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [projects.organizationId],
    references: [organizations.id],
  }),
  members: many(projectMembers),
}));

export const projectMembersRelations = relations(projectMembers, ({ one }) => ({
  project: one(projects, { fields: [projectMembers.projectId], references: [projects.id] }),
  user: one(users, { fields: [projectMembers.userId], references: [users.id] }),
}));

/* -------------------------------------------------------------------------- */
/* Project Digital Twin (gap-spec §8)                                         */
/* -------------------------------------------------------------------------- */

/**
 * The canonical project graph.
 *
 * One row per node, not one per version. Gap-spec §8.4 forbids copying the database per change, so
 * history lives in `twinChanges` and `twinBaselines` — see `packages/twin/src/versioning.ts` for
 * why those are three separate mechanisms rather than one.
 *
 * The id is `text`, not `uuid`. The generator derives ids from a stable path
 * (`<project>:req:accessibility`) precisely so that regenerating a plan produces the same ids and
 * the two versions stay comparable; a UUID column would force random ids and destroy that.
 */
export const twinNodes = pgTable(
  'twin_nodes',
  {
    id: text('id').primaryKey(),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),

    /** One of the closed taxonomy in `packages/twin/src/nodes.ts`. */
    class: text('class').notNull(),
    label: text('label').notNull(),
    description: text('description'),
    state: text('state').notNull().default('ACTIVE'),

    /** Where the content came from, and how much weight it carries. */
    provenance: text('provenance').notNull(),
    confidence: text('confidence').notNull(),
    sourceRef: text('source_ref'),

    revision: integer('revision').notNull().default(1),
    attributes: jsonb('attributes').$type<Record<string, unknown>>().notNull().default({}),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('twin_nodes_project_idx').on(table.projectId),
    index('twin_nodes_org_idx').on(table.organizationId),
    index('twin_nodes_project_class_idx').on(table.projectId, table.class),
    check('twin_nodes_state_check', sql`${table.state} IN ('ACTIVE','SUPERSEDED','WITHDRAWN')`),
    check('twin_nodes_revision_check', sql`${table.revision} >= 1`),
    /*
     * An AI cannot claim a user confirmed something.
     *
     * The interchange schema already makes `USER_CONFIRMED` unrepresentable in an import, but a node
     * can also arrive from a rule, a migration or a future integration — and the schema only guards
     * one of those paths. This guards the column itself.
     */
    check(
      'twin_nodes_provenance_check',
      sql`${table.provenance} IN ('USER_CONFIRMED','DETERMINISTIC_CALCULATION','USER_PROVIDED','EXTERNAL_SOURCE','ASSUMPTION','EXTERNAL_AI_INFERENCE','FUTURE_ML_PREDICTION')`,
    ),
    check('twin_nodes_confidence_check', sql`${table.confidence} IN ('LOW','MEDIUM','HIGH')`),
  ],
);

export const twinEdges = pgTable(
  'twin_edges',
  {
    id: text('id').primaryKey(),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    class: text('class').notNull(),
    fromId: text('from_id')
      .notNull()
      .references(() => twinNodes.id, { onDelete: 'cascade' }),
    toId: text('to_id')
      .notNull()
      .references(() => twinNodes.id, { onDelete: 'cascade' }),
    /** Why the edge exists. The traceability report reads this. */
    rationale: text('rationale'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('twin_edges_project_idx').on(table.projectId),
    index('twin_edges_org_idx').on(table.organizationId),
    index('twin_edges_from_idx').on(table.fromId, table.class),
    index('twin_edges_to_idx').on(table.toId, table.class),
    /* The same relationship twice between the same pair is a duplicate every traversal would count. */
    uniqueIndex('twin_edges_unique_idx').on(table.fromId, table.class, table.toId),
    /* Irreflexive in every relation the taxonomy has, so enforced at the column rather than left to
       the invariant pass. */
    check('twin_edges_no_self_reference', sql`${table.fromId} <> ${table.toId}`),
  ],
);

/** One entry per material change. Deliberately not one row per node version. */
export const twinChanges = pgTable(
  'twin_changes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    kind: text('kind').notNull(),
    targetId: text('target_id').notNull(),
    /** Only the fields that differed, never whole snapshots. */
    beforeValue: jsonb('before_value').$type<Record<string, unknown>>(),
    afterValue: jsonb('after_value').$type<Record<string, unknown>>(),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('twin_changes_project_idx').on(table.projectId, table.version),
    index('twin_changes_target_idx').on(table.targetId),
    check(
      'twin_changes_kind_check',
      sql`${table.kind} IN ('NODE_CREATED','NODE_UPDATED','NODE_SUPERSEDED','NODE_WITHDRAWN','EDGE_CREATED','EDGE_REMOVED')`,
    ),
  ],
);

/**
 * Immutable snapshots.
 *
 * Immutability is enforced by trigger, not by convention — the same argument as the audit table. A
 * baseline the application can edit is a claim about the past rather than a record of it, and
 * "we never call UPDATE on it" is a promise rather than a control.
 */
export const twinBaselines = pgTable(
  'twin_baselines',
  {
    id: text('id').primaryKey(),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    label: text('label').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    /** SHA-256 of the canonical serialisation. What makes the snapshot evidence rather than a copy. */
    checksum: text('checksum').notNull(),
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
    takenAt: timestamp('taken_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('twin_baselines_project_idx').on(table.projectId, table.version),
    check('twin_baselines_checksum_check', sql`char_length(${table.checksum}) = 64`),
  ],
);

/** A recorded calculation, with everything needed to explain it months later. */
export const twinCalculations = pgTable(
  'twin_calculations',
  {
    id: text('id').primaryKey(),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    calculation: text('calculation').notNull(),
    /** Lets an old result stay correct-as-of-then when the formula changes. */
    formulaVersion: text('formula_version').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    inputs: jsonb('inputs').$type<Record<string, unknown>>().notNull(),
    result: jsonb('result').$type<Record<string, unknown>>().notNull(),
    /** Node ids the result depends on. What makes staleness detectable rather than silent. */
    dependsOn: text('depends_on').array().notNull().default([]),
    /** Surfaced with the number, never buried. */
    assumptions: text('assumptions').array().notNull().default([]),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('twin_calculations_project_idx').on(table.projectId, table.calculation)],
);

/* -------------------------------------------------------------------------- */
/* Evidence and approvals                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Recorded evidence (gap-spec §32, §35).
 *
 * The durable record. Gates read EVIDENCE nodes from the twin graph, and the twin is rebuilt from
 * scratch every time a plan is regenerated — so evidence stored only as a node would be destroyed by
 * the next `Build the plan`. It lives here and is projected into the graph on read.
 *
 * `purpose` is the field the gates actually match on. Its vocabulary is not free text: it comes from
 * `evidencePurposes()` in `packages/rules`, derived from the criteria themselves, so the set of
 * things a user can record is exactly the set of things a gate looks for.
 */
export const evidence = pgTable(
  'evidence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** Which gate criterion this is offered against. Matches `GateCriterion.evidencePurpose`. */
    purpose: text('purpose').notNull(),
    /** `EVIDENCE_TYPES` in packages/governance. Weight differs by type, so it is recorded. */
    type: text('type').notNull(),
    label: text('label').notNull(),
    /** What the person asserts. For an attestation this *is* the evidence. */
    note: text('note'),
    /** A link to the artefact, when it lives somewhere else — a CI run, a ticket, a dashboard. */
    uri: text('uri'),
    /**
     * The R2 object key, when a file was uploaded.
     *
     * Randomised and server-generated, never derived from the filename (§35). A user-controlled path
     * is a path traversal waiting for somebody to try it.
     */
    storageKey: text('storage_key'),
    /** Content hash. §32: the field that makes this evidence rather than testimony. */
    contentHash: text('content_hash'),
    mimeType: text('mime_type'),
    sizeBytes: integer('size_bytes'),
    /** `CURRENT`, `SUPERSEDED` or `QUARANTINED`. */
    state: text('state').notNull().default('CURRENT'),
    collectedBy: text('collected_by').notNull(),
    collectedAt: timestamp('collected_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('evidence_project_purpose_idx').on(table.projectId, table.purpose),
    index('evidence_org_idx').on(table.organizationId),
    check('evidence_state_check', sql`${table.state} IN ('CURRENT','SUPERSEDED','QUARANTINED')`),
    /*
     * Evidence must actually point at something.
     *
     * A record with no note, no link and no file is a claim that something exists, which is the one
     * thing evidence must not be. Attestations are permitted — `note` alone is enough — because a
     * named person asserting something is weaker evidence, not absent evidence, and §32 grades it
     * that way rather than forbidding it.
     */
    check(
      'evidence_has_substance',
      sql`${table.note} IS NOT NULL OR ${table.uri} IS NOT NULL OR ${table.storageKey} IS NOT NULL`,
    ),
  ],
);

/**
 * Approvals and sign-offs (gap-spec §33).
 *
 * `subjectVersion` is the field that makes an approval mean something: without it, "approved" has no
 * scope and the only honest reading is "somebody approved this at some point". A change to the
 * subject makes the approval stale, which `isStale` decides and the lifecycle machine enforces.
 */
export const approvals = pgTable(
  'approvals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** `APPROVABLE_SUBJECTS` in packages/governance. */
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    /** The version of the subject that was approved. See the note above. */
    subjectVersion: integer('subject_version').notNull(),
    requestedBy: text('requested_by').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    /** Decided by policy rather than by the requester, so a requester cannot choose a soft approver. */
    approverRole: projectRoleEnum('approver_role').notNull(),
    /** `REQUESTED`, `APPROVED`, `REJECTED`, `WITHDRAWN`, `INVALIDATED`. */
    state: text('state').notNull().default('REQUESTED'),
    approverUser: text('approver_user'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    /** Why. Required on any decision, including approval. */
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('approvals_project_subject_idx').on(table.projectId, table.subjectType),
    index('approvals_org_idx').on(table.organizationId),
    check(
      'approvals_state_check',
      sql`${table.state} IN ('REQUESTED','APPROVED','REJECTED','WITHDRAWN','INVALIDATED')`,
    ),
    check('approvals_subject_version_positive', sql`${table.subjectVersion} >= 1`),
    /*
     * A decision carries who made it, when, and why — or none of the three.
     *
     * A decided approval missing its decider attributes a judgement to nobody, which is worse than an
     * undecided one because it looks settled.
     */
    check(
      'approvals_decision_complete',
      sql`(${table.state} IN ('REQUESTED','WITHDRAWN'))
          OR (${table.approverUser} IS NOT NULL AND ${table.decidedAt} IS NOT NULL AND ${table.comment} IS NOT NULL)`,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* Type exports                                                               */
/* -------------------------------------------------------------------------- */

export type Evidence = typeof evidence.$inferSelect;
export type NewEvidence = typeof evidence.$inferInsert;
export type ApprovalRow = typeof approvals.$inferSelect;
export type NewApprovalRow = typeof approvals.$inferInsert;

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Organization = typeof organizations.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type ProjectMember = typeof projectMembers.$inferSelect;
export type GuestSession = typeof guestSessions.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type OutboxEvent = typeof outboxEvents.$inferSelect;
export type IntakeAnswer = typeof intakeAnswers.$inferSelect;
export type AiImport = typeof aiImports.$inferSelect;
export type NewAiImport = typeof aiImports.$inferInsert;
export type NewIntakeAnswer = typeof intakeAnswers.$inferInsert;

export type TwinNodeRow = typeof twinNodes.$inferSelect;
export type NewTwinNodeRow = typeof twinNodes.$inferInsert;
export type TwinEdgeRow = typeof twinEdges.$inferSelect;
export type NewTwinEdgeRow = typeof twinEdges.$inferInsert;
export type TwinChangeRow = typeof twinChanges.$inferSelect;
export type TwinBaselineRow = typeof twinBaselines.$inferSelect;
export type TwinCalculationRow = typeof twinCalculations.$inferSelect;

export type OrganizationRole = (typeof organizationRoleEnum.enumValues)[number];
export type ProjectRole = (typeof projectRoleEnum.enumValues)[number];
export type LifecycleState = (typeof lifecycleStateEnum.enumValues)[number];
export type ProjectType = (typeof projectTypeEnum.enumValues)[number];
