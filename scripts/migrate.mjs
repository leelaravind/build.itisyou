/**
 * Apply the schema to a networked PostgreSQL.
 *
 * ## Why this exists
 *
 * `rebuildSchema()` in `packages/db/src/client.ts` builds the schema from nothing, and its own
 * documentation says development and test only — it opens with `DROP SCHEMA public CASCADE`. That is
 * correct for a laptop and catastrophic anywhere else, so the deployed path in
 * `apps/web/src/lib/server/database.ts` deliberately has no bootstrap at all: it compares the
 * fingerprint and *refuses to serve* if it does not match, rather than repairing something it cannot
 * safely reason about (KI-026).
 *
 * Which left a real gap. Every `apply*` function took a `PGlite` client, so there was no way to get a
 * schema onto a real server. This is that way.
 *
 * ## What it deliberately does not do
 *
 * It is not a migration system. It handles exactly one transition — **empty database to the current
 * schema** — and refuses everything else.
 *
 * That refusal is the point. A database holding a *different* fingerprint needs a considered
 * migration with a rollback decision recorded before it runs (`MIGRATION_POLICY.md`), and a script
 * that guessed at one would be a script that destroys data on the day the guess is wrong. Refusing
 * costs a message; guessing costs the data.
 *
 * There is no `DROP` in this file. Not as a flag, not behind a confirmation. A tool that can drop a
 * production schema is a tool that eventually does.
 */

import postgres from 'postgres';
import {
  APP_ROLE,
  APPLICATION_ROLE_DDL,
  ROW_LEVEL_SECURITY_DDL,
  SCHEMA_DDL,
  SCHEMA_FINGERPRINT,
  SCHEMA_META_DDL,
} from '../packages/db/src/client.ts';

const check = process.argv.includes('--check');

/*
 * The direct connection, not the pooled one.
 *
 * DDL through a transaction pooler is a known way to get half a schema: poolers in transaction mode
 * hand out a different backend per transaction, and session-scoped things like `CREATE ROLE`
 * followed by a `GRANT` can land on separate connections. Neon exposes both; this takes the direct
 * one and says so if it is missing.
 */
const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

if (connectionString === undefined || connectionString.trim() === '') {
  console.error(
    'DATABASE_URL_UNPOOLED (preferred) or DATABASE_URL must be set to the target database.',
  );
  process.exit(1);
}

const sql = postgres(connectionString, { max: 1, prepare: false, onnotice: () => undefined });

try {
  /*
   * Read the fingerprint without assuming the table exists.
   *
   * `to_regclass` returns null rather than raising for a missing relation, which matters because the
   * empty-database case is the *expected* one here and should not arrive as an exception.
   */
  const [{ present }] = await sql`SELECT to_regclass('public.schema_meta') IS NOT NULL AS present`;

  const existing = present
    ? ((await sql`SELECT fingerprint FROM schema_meta ORDER BY applied_at DESC LIMIT 1`)[0]
        ?.fingerprint ?? null)
    : null;

  console.log(`expected  ${SCHEMA_FINGERPRINT}`);
  console.log(`found     ${existing ?? 'nothing — the database has no schema_meta'}`);

  if (existing === SCHEMA_FINGERPRINT) {
    console.log('\nUp to date. Nothing to do.');
    process.exit(0);
  }

  if (existing !== null) {
    /*
     * A schema is here and it is not this one. This is the case the file header refuses.
     *
     * Note it exits non-zero: a deployment pipeline must treat "I do not know how to migrate this"
     * as a failure, because the alternative is deploying a build against a shape it cannot read and
     * discovering that at the first query.
     */
    console.error(
      '\nThe database holds a different schema. This script only creates a schema from empty; it\n' +
        'cannot migrate one shape to another, and will not guess. Write the migration, record its\n' +
        'rollback decision first, and apply it — see docs/MIGRATION_POLICY.md.',
    );
    process.exit(1);
  }

  /*
   * Empty of *our* schema is not the same as empty. A database with unrelated tables is somebody
   * else's, and creating ours alongside is how two systems end up sharing one namespace by accident.
   */
  const [{ tables }] = await sql`
    SELECT count(*)::int AS tables
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `;

  if (tables > 0) {
    console.error(
      `\nThe public schema already holds ${tables} table(s) but no schema_meta. This database\n` +
        'belongs to something else, or a previous run failed part way. Refusing to add tables to it.',
    );
    process.exit(1);
  }

  if (check) {
    console.log('\n--check: the database is empty and would be initialised. Nothing was written.');
    process.exit(1);
  }

  console.log('\nEmpty database. Creating the schema.');

  /*
   * One transaction for the whole thing.
   *
   * Postgres has transactional DDL, so a failure anywhere leaves the database exactly as empty as it
   * started rather than holding a partial schema — which is the state the `tables > 0` guard above
   * would then refuse to touch, requiring a human to clean up by hand.
   */
  await sql.begin(async (tx) => {
    await tx.unsafe(SCHEMA_DDL);
    await tx.unsafe(SCHEMA_META_DDL);
    await tx.unsafe(APPLICATION_ROLE_DDL);
    await tx.unsafe(ROW_LEVEL_SECURITY_DDL);

    /*
     * Let the connecting role become the application role.
     *
     * This is the one thing the shared DDL cannot cover, and it is not an oversight in it. On PGlite
     * the connecting user is a superuser, so `SET LOCAL ROLE govintel_app` just works. On a managed
     * PostgreSQL it is an ordinary owner, and `SET ROLE` to a role it is not a member of is an error
     * — so `applyTenantScope` would fail on its first statement, on every request.
     *
     * Granting membership does not weaken the control. RLS is enforced against the *current* role,
     * `govintel_app` is `NOSUPERUSER`, and every tenant-scoped query runs as it. The owner keeping
     * the ability to switch into it is what makes that possible at all.
     */
    await tx.unsafe(`GRANT ${APP_ROLE} TO CURRENT_USER`);

    /*
     * Default privileges for tables this role creates later.
     *
     * `GRANT ... ON ALL TABLES` in the role DDL covers what exists at the moment it runs. Without
     * this, the next table added by a future migration is invisible to the application until somebody
     * remembers to re-grant — and the symptom is a permission error on one table, long after.
     */
    await tx.unsafe(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public
         GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE}`,
    );
    await tx.unsafe(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${APP_ROLE}`,
    );

    await tx`INSERT INTO schema_meta (fingerprint) VALUES (${SCHEMA_FINGERPRINT})`;
  });

  console.log(`Applied. schema_meta now records ${SCHEMA_FINGERPRINT}.`);
} finally {
  await sql.end();
}
