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

/**
 * Privileges the application role needs on what already exists.
 *
 * Separate from the schema DDL so it can be re-applied on its own. Idempotent: granting something
 * already granted is a no-op rather than an error.
 */
async function applyGrants(executor) {
  await executor.unsafe(APPLICATION_ROLE_DDL);
  await applyDefaultPrivileges(executor);
}

/**
 * Privileges for tables a future migration creates.
 *
 * `GRANT ... ON ALL TABLES` covers what exists at the moment it runs. Without this, the next table
 * added is invisible to the application until somebody remembers to re-grant — and the symptom is a
 * permission error on one table, long after the migration that caused it.
 */
async function applyDefaultPrivileges(executor) {
  await executor.unsafe(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public
       GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE}`,
  );
  await executor.unsafe(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${APP_ROLE}`,
  );
}

/**
 * Give the application role a password, so the application can connect **as** it.
 *
 * Opt-in via `APP_ROLE_PASSWORD`, and deliberately not part of the shared DDL. The DDL creates the
 * role `NOLOGIN`, which is the safe default: a role nobody can authenticate as cannot be used to
 * reach the database at all, however the credential leaks. Handing it a password is a decision, and
 * decisions belong in a deployment step rather than in a schema constant.
 *
 * ## Why this matters more than it looks
 *
 * There are two ways to run the application and they are not equally safe.
 *
 * Connect as the **owner** and `SET LOCAL ROLE` per transaction: every tenant-scoped query is
 * correctly restricted, but anything outside a scope runs as a role that can bypass RLS entirely.
 * On Neon the owner has `rolbypassrls`, so for those queries row-level security is inert — defined,
 * listed in the catalogue, enforcing nothing.
 *
 * Connect **as the application role**: the connection itself cannot bypass RLS, cannot create roles
 * or databases, and owns no tables. `SET LOCAL ROLE` becomes a self-set that Postgres always
 * permits, so it still works and now means "belt" rather than "the only thing holding this up".
 *
 * Measured on the production branch: as `neondb_owner`, an unscoped read of `projects` returned the
 * row. As `govintel_app`, it returned nothing. Same database, same policies, same query.
 */
async function setApplicationPassword(executor) {
  const password = process.env.APP_ROLE_PASSWORD;

  if (password === undefined || password.trim() === '') {
    console.log(
      `${APP_ROLE} left NOLOGIN. Set APP_ROLE_PASSWORD to let the application connect as it — ` +
        'the arrangement a deployed environment requires.',
    );
    return;
  }

  if (password.length < 24) {
    // Not advice. A short password on a role reachable from the public internet is a defect.
    throw new Error('APP_ROLE_PASSWORD must be at least 24 characters.');
  }

  /*
   * A literal, because `ALTER ROLE ... PASSWORD` does not accept a bind parameter. Quoted by
   * doubling single quotes rather than concatenated raw — the generated passwords are base64url and
   * contain nothing needing escaping, but the next person's might not be.
   */
  /*
   * `NOSUPERUSER` is deliberately absent from this list.
   *
   * Postgres requires the SUPERUSER attribute to *change* the SUPERUSER attribute — even to clear
   * it — so including it makes the whole statement fail as any ordinary owner, with
   * *"Only roles with the SUPERUSER attribute may change the SUPERUSER attribute"*. The role is
   * created `NOSUPERUSER` by the shared DDL and nothing here can promote it, so there is nothing to
   * clear; asking anyway only breaks the statement that clears the attributes that DO matter.
   */
  await executor.unsafe(
    `ALTER ROLE ${APP_ROLE} LOGIN PASSWORD ${quoteLiteral(password)} ` +
      'NOCREATEDB NOCREATEROLE NOBYPASSRLS',
  );

  /*
   * Verify rather than assume.
   *
   * The statement above succeeding does not prove the outcome: a provider can create roles with
   * attributes the owner cannot alter, and the failure mode is silent. Neon does exactly this — a
   * role created through its API comes back with `BYPASSRLS`, `CREATEDB` and `CREATEROLE`, and
   * `ALTER ROLE` on it is refused outright. Reading the catalogue back is the only thing that
   * distinguishes "restricted" from "believed to be restricted".
   */
  const [attributes] = await executor`
    SELECT rolsuper AS superuser, rolbypassrls AS bypassrls,
           rolcreatedb AS createdb, rolcreaterole AS createrole, rolcanlogin AS canlogin
    FROM pg_roles WHERE rolname = ${APP_ROLE}
  `;

  const unsafe = [
    attributes.superuser ? 'superuser' : null,
    attributes.bypassrls ? 'bypassrls' : null,
    attributes.createdb ? 'createdb' : null,
    attributes.createrole ? 'createrole' : null,
  ].filter(Boolean);

  if (unsafe.length > 0) {
    throw new Error(
      `${APP_ROLE} still has: ${unsafe.join(', ')}. The application must not connect as a role that ` +
        'can bypass row-level security or create roles. If the provider manages this role, drop it ' +
        'and let the migration create it instead.',
    );
  }

  if (!attributes.canlogin) {
    throw new Error(
      `${APP_ROLE} did not gain LOGIN; the application would not be able to connect.`,
    );
  }

  console.log(
    `${APP_ROLE} can log in. Verified from pg_roles: no superuser, bypassrls, createdb or createrole.`,
  );
}

/** Quote a string as a SQL literal. Doubling single quotes is the whole of the rule. */
function quoteLiteral(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Let the connecting role become the application role — best effort.
 *
 * Two arrangements are supported and only one needs this:
 *
 * - **Connect as the application role** (production). `SET LOCAL ROLE govintel_app` is then a
 *   self-set, which Postgres always permits, and the connection never holds owner privileges. This
 *   is the stronger arrangement and the one to prefer.
 * - **Connect as the owner and switch** (PGlite, and any host where the app shares the migration
 *   role). `SET ROLE` to a role you are not a member of is an error, so this grant is what makes
 *   `applyTenantScope` work at all.
 *
 * On Neon the second is unavailable for a platform-managed role, and that is not an obstacle to work
 * around — it is the provider pushing towards the arrangement that was already better. Failure is
 * reported rather than swallowed, because in the second arrangement it would mean a broken deploy.
 */
async function grantMembership(executor) {
  try {
    await executor.unsafe(`GRANT ${APP_ROLE} TO CURRENT_USER`);
    console.log(`Granted ${APP_ROLE} to the connecting role; either arrangement will work.`);
  } catch (error) {
    console.log(
      `Could not grant ${APP_ROLE} to the connecting role: ${error.message}\n` +
        `Expected where roles are platform-managed, or where the application connects as\n` +
        `${APP_ROLE} directly. The application asserts its own effective role at startup.`,
    );
  }
}

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
    /*
     * The schema matches, but grants are re-applied anyway.
     *
     * Privileges drift independently of structure: a role is dropped and recreated, a branch is
     * restored from a snapshot taken before the role existed, a provider replaces a managed role.
     * None of those change the fingerprint, and every one of them leaves the application unable to
     * read its own tables — a failure that surfaces as a permission error on one query, long after
     * the change that caused it.
     *
     * Every statement is idempotent by construction, so doing this on every run costs a round trip
     * and removes a whole class of "it worked yesterday".
     */
    console.log('\nSchema is up to date. Re-applying grants, which drift independently.');
    await applyGrants(sql);
    await setApplicationPassword(sql);
    await grantMembership(sql);
    await sql.end();
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
    await applyDefaultPrivileges(tx);

    await tx`INSERT INTO schema_meta (fingerprint) VALUES (${SCHEMA_FINGERPRINT})`;
  });

  console.log(`Applied. schema_meta now records ${SCHEMA_FINGERPRINT}.`);

  await setApplicationPassword(sql);
  await grantMembership(sql);
} finally {
  await sql.end();
}
