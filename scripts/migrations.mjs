/**
 * Written migrations, applied only between the exact shapes they were written for.
 *
 * Contract: gap-spec §50, plan Phase 18, `docs/MIGRATION_POLICY.md`.
 *
 * ## Why this exists, and why it is not a migration framework
 *
 * `migrate.mjs` handles one transition — empty to current — and refuses everything else, on the
 * grounds that "a script that guessed at a migration would be a script that destroys data on the day
 * the guess is wrong". That reasoning is right and is not being softened here. What it left missing
 * was the other half: the policy says *write the migration*, and there was nowhere to write it, so
 * the only available answer to "I added a table" was to drop the database and rebuild it. On a
 * laptop that is fine. On anything holding data it is the outcome the refusal exists to prevent.
 *
 * So each entry below is a migration somebody wrote, anchored to the fingerprint it starts from and
 * the fingerprint it produces. Nothing is inferred: an unrecognised shape is still refused, exactly
 * as before. The difference is that a shape somebody has thought about now has a path.
 *
 * ## The rules each entry has to satisfy
 *
 * - **Additive only** (`MIGRATION_POLICY.md` §1). A new table, a new index, a nullable column.
 *   Nothing that a running instance of the previous release could be holding a query against. This
 *   file has no `DROP`, for the same reason `migrate.mjs` has none.
 * - **`from` and `to` are exact.** A migration runs only against the shape it was written against.
 * - **The rollback is recorded before it runs**, which is what §5 of the policy asks for, and it is
 *   recorded here rather than in somebody's memory of the deployment.
 */

/**
 * @typedef {object} Migration
 * @property {string} id            Stable identifier, recorded in `schema_migrations`.
 * @property {string} from          The fingerprint this applies to.
 * @property {string} to            The fingerprint it produces.
 * @property {string} why           What changed and why, for whoever reads the table later.
 * @property {string} rollback      How to undo it, decided before it ran.
 * @property {string} sql           Additive DDL. Runs inside one transaction with the bookkeeping.
 */

/** @type {readonly Migration[]} */
export const MIGRATIONS = [
  {
    id: '001-change-requests',
    from: '7a07f39a13e9ad67b73d4a2acd6a5316',
    to: '6c7aaf28d6e3c642e10ed889c03af2d4',
    why:
      'Adds change_requests. gap-spec §27/§28 and §85 make managing changes a V1 requirement, and ' +
      'the engine in packages/change had no table to run against, so approve, reject and apply were ' +
      'unreachable from the product.',
    rollback:
      'DROP TABLE change_requests. Safe because nothing else references it: no foreign key points ' +
      'at it, and the release before this one does not read it. Per MIGRATION_POLICY.md §4 the drop ' +
      'is a separate release from the code that stops using it.',
    sql: `
CREATE TABLE change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  rationale text NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT',
  changes jsonb NOT NULL,
  impact jsonb,
  base_version integer NOT NULL,
  requested_by text NOT NULL,
  approved_by text,
  decision_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT change_requests_state_check
    CHECK (state IN ('DRAFT','PENDING_APPROVAL','APPROVED','APPLIED','REJECTED','SUPERSEDED')),
  CONSTRAINT change_requests_no_self_approval
    CHECK (approved_by IS NULL OR approved_by <> requested_by),
  CONSTRAINT change_requests_decision_has_reason
    CHECK (state NOT IN ('APPROVED','REJECTED') OR decision_reason IS NOT NULL)
);

CREATE INDEX change_requests_project_idx ON change_requests (project_id, created_at DESC);
CREATE INDEX change_requests_org_idx ON change_requests (organization_id);

ALTER TABLE change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY change_requests_tenant_isolation ON change_requests
  USING (organization_id::text = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id::text = current_setting('app.current_organization_id', true));
`,
  },
  {
    id: '002-audit-retention-path',
    from: '6c7aaf28d6e3c642e10ed889c03af2d4',
    to: '0433d7ed47c7dcf46326073dc75fae97',
    why:
      'Gives §40 retention the path it always permitted. audit_events.project_id is ON DELETE ' +
      'RESTRICT and the immutability trigger refused every delete, so a guest project that had ' +
      'produced one audit event could never be deleted -- and §5.3 expiry deletes every expired ' +
      'session in a single transaction, so one such project would have stopped the purge for all of ' +
      'them, permanently. Measured on staging before the fix: 126 guest sessions owned audited ' +
      'projects, the first expiring 2026-09-05T08:08:57Z.',
    rollback:
      'Re-create audit_events_immutable() with an unconditional RAISE -- the body this replaces, ' +
      'which is in git at 47a676e. Additive in the sense that matters: the previous release never ' +
      'sets govintel.audit_retention, so it behaves identically against either version of the ' +
      'function, and rolling back only removes a permission nothing older uses.',
    sql: `
CREATE OR REPLACE FUNCTION audit_events_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('govintel.audit_retention', true) = 'on' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'audit_events is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
`,
  },
  {
    id: '003-intake-and-import-isolation',
    from: '0433d7ed47c7dcf46326073dc75fae97',
    to: '6aa38daebd263bd6bf10f2f639a6682b',
    why:
      "intake_answers and ai_imports hold a project's answers and pasted AI output -- tenant data -- " +
      "and were the two tenant tables without row-level security, guarded only by the application's " +
      'ownership check. Their writers also left organization_id NULL, so a policy could not have ' +
      "been added without first making the key real. This backfills the key from each row's " +
      'project, makes it NOT NULL, and forces the same tenant policy every other tenant table has.',
    rollback:
      'ALTER TABLE ... NO FORCE ROW LEVEL SECURITY; DISABLE ROW LEVEL SECURITY; DROP POLICY ' +
      '..._tenant_isolation; ALTER COLUMN organization_id DROP NOT NULL -- on both tables. The ' +
      'backfilled keys are correct values and are left in place. A hard cutover under the exact ' +
      'fingerprint rule (MIGRATION_POLICY.md): the previous release writes these rows without the ' +
      'key and refuses to serve against this shape, so apply and deploy together.',
    sql: `
UPDATE intake_answers AS a
SET organization_id = p.organization_id
FROM projects AS p
WHERE a.project_id = p.id AND a.organization_id IS DISTINCT FROM p.organization_id;

UPDATE ai_imports AS i
SET organization_id = p.organization_id
FROM projects AS p
WHERE i.project_id = p.id AND i.organization_id IS DISTINCT FROM p.organization_id;

ALTER TABLE intake_answers ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE ai_imports ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE intake_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_answers FORCE ROW LEVEL SECURITY;
CREATE POLICY intake_answers_tenant_isolation ON intake_answers
  USING (organization_id::text = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id::text = current_setting('app.current_organization_id', true));

ALTER TABLE ai_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_imports FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_imports_tenant_isolation ON ai_imports
  USING (organization_id::text = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id::text = current_setting('app.current_organization_id', true));
`,
  },
];

/** Bookkeeping, so a migration cannot be applied twice and the history is readable in the database. */
export const SCHEMA_MIGRATIONS_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id text PRIMARY KEY,
  from_fingerprint text NOT NULL,
  to_fingerprint text NOT NULL,
  why text NOT NULL,
  rollback text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
`;

/**
 * The chain from one shape to another, or `null` when there is not one.
 *
 * A chain rather than a single step, because two migrations may land between deployments. `null` is
 * the case `migrate.mjs` already refuses, and it must stay refused: an unrecognised shape is one
 * nobody has thought about, and this file exists for the ones somebody has.
 */
export function pathBetween(from, to) {
  const steps = [];
  const seen = new Set();

  let current = from;

  while (current !== to) {
    if (seen.has(current)) return null; // A cycle. Refuse rather than loop.
    seen.add(current);

    const next = MIGRATIONS.find((migration) => migration.from === current);
    if (next === undefined) return null;

    steps.push(next);
    current = next.to;
  }

  return steps;
}
