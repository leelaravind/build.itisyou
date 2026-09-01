/**
 * Tenant isolation, verified against a real pooled PostgreSQL.
 *
 * ## Why this is a separate gate
 *
 * `packages/db/test/tenant-scope.test.ts` covers the same property and cannot, even in principle,
 * catch the bug it was written for. It runs against PGlite: one connection, serialised behind a
 * mutex. A tenant scope that leaks onto the connection has nowhere to leak *to*, so the suite was
 * thorough and structurally incapable of failing — which is exactly how KI-049 survived from Phase 3
 * to Phase 19 with every isolation test green.
 *
 * The discriminating condition is a **pool**: several connections, with requests interleaved across
 * them. That needs a real server, so this cannot be a unit test and is not pretending to be one.
 *
 * ## What it measured
 *
 * Run against the pre-fix implementation (commit 0fd0cac, restored faithfully) on a 4-connection
 * pool, the interleaving check returned:
 *
 *     { "WRONG TENANT": 18, "correct": 20, "empty": 2 }
 *
 * Eighteen requests out of forty were served another tenant's row. That is not a derived risk or a
 * reading of the code; it is the observed behaviour of the code this project shipped for sixteen
 * phases. The fixed implementation returns 40/40.
 *
 * The failure classes are reported separately on purpose. `empty` is a malfunction — a user sees
 * nothing and complains. `WRONG TENANT` is a disclosure — nobody complains, because the data looks
 * entirely plausible to whoever receives it. Collapsing the two into "failed" would hide the one
 * that matters.
 */

import postgres from 'postgres';
import { APP_ROLE, TENANT_SETTING } from '../packages/db/src/client.ts';

/*
 * Refuses to run anywhere but staging.
 *
 * This writes and removes rows. Against production that is unacceptable regardless of how careful
 * the cleanup is, and a check that merely *asks* to be pointed at the right database eventually gets
 * pointed at the wrong one. The environment has to say so.
 */
if (process.env.APP_ENV !== 'staging') {
  console.error(
    'Refusing to run: APP_ENV must be "staging". This check writes and removes rows, and the\n' +
      'safest way to keep it away from production is to make production impossible to reach.',
  );
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

if (connectionString === undefined || connectionString.trim() === '') {
  console.error('DATABASE_URL_UNPOOLED or DATABASE_URL must point at the staging database.');
  process.exit(1);
}

/* Four connections. One would reproduce nothing — which is the whole point of the file. */
const sql = postgres(connectionString, { max: 4, prepare: false, onnotice: () => undefined });

/* Reserved ids, so cleanup removes exactly what this created and never anything else. */
const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const PROJECT_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const PROJECT_B = 'bbbbbbbb-0000-4000-8000-00000000000b';

let failures = 0;

function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures += 1;
}

/** The scope under test — the shape `withTenant` uses: one transaction, both statements local. */
const asTenant = (organizationId, fn) =>
  sql.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL ROLE ${APP_ROLE}`);
    await tx`SELECT set_config(${TENANT_SETTING}, ${organizationId}, true)`;
    return fn(tx);
  });

async function cleanup() {
  await sql`DELETE FROM projects WHERE id IN (${PROJECT_A}, ${PROJECT_B})`;
  await sql`DELETE FROM organizations WHERE id IN (${A}, ${B})`;
}

try {
  await cleanup();

  // Seeded as the owner, outside any scope, so the rows exist regardless of RLS.
  await sql`
    INSERT INTO organizations (id, name, slug)
    VALUES (${A}, 'Isolation check A', 'isolation-check-a'),
           (${B}, 'Isolation check B', 'isolation-check-b')
  `;
  await sql`
    INSERT INTO projects (id, organization_id, name)
    VALUES (${PROJECT_A}, ${A}, 'Belongs to A'),
           (${PROJECT_B}, ${B}, 'Belongs to B')
  `;

  const own = await asTenant(A, (tx) => tx`SELECT name FROM projects WHERE id = ${PROJECT_A}`);
  check('a tenant sees its own row', own.length === 1);

  /*
   * The load-bearing check. Both tenants at once, across every connection in the pool.
   *
   * Sequential calls pass under the broken implementation too — the damage needs two scopes in
   * flight together, which is what a deployed request pattern looks like and what a test written as
   * a sequence never produces.
   */
  const outcomes = await Promise.all(
    Array.from({ length: 40 }, (_, index) => {
      const even = index % 2 === 0;
      const organizationId = even ? A : B;
      const expected = even ? 'Belongs to A' : 'Belongs to B';

      return asTenant(organizationId, (tx) => tx`SELECT name FROM projects ORDER BY name`)
        .then((rows) => {
          if (rows.length === 1 && rows[0].name === expected) return 'correct';
          if (rows.length === 0) return 'empty';
          if (rows.length > 1) return 'EVERY TENANT';
          return 'WRONG TENANT';
        })
        .catch((error) => `error: ${error.message.slice(0, 60)}`);
    }),
  );

  const tally = {};
  for (const outcome of outcomes) tally[outcome] = (tally[outcome] ?? 0) + 1;

  check(
    '40 interleaved scopes across a 4-connection pool stay isolated',
    outcomes.every((outcome) => outcome === 'correct'),
    JSON.stringify(tally),
  );

  /*
   * A query with no scope at all, on connections a scope has just used.
   *
   * Under the application role and with no tenant setting the RLS policy compares against an empty
   * string and matches nothing. Any row returned here came from a previous request.
   */
  const unscoped = await Promise.all(
    Array.from({ length: 20 }, () =>
      sql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE ${APP_ROLE}`);
        return tx`SELECT name FROM projects`;
      }),
    ),
  );

  const disclosed = unscoped.reduce((total, rows) => total + rows.length, 0);

  check(
    'an unscoped query on a reused pooled connection sees nothing',
    disclosed === 0,
    `${disclosed} row(s) disclosed`,
  );

  // Nothing left on any connection for the next request to inherit.
  const residue = await Promise.all(
    Array.from(
      { length: 20 },
      () => sql`SELECT current_setting(${TENANT_SETTING}, true) AS tenant, current_user AS role`,
    ),
  );

  const dirty = residue.filter(([row]) => (row.tenant ?? '') !== '' || row.role === APP_ROLE);

  check(
    'no pooled connection carries a tenant or the application role afterwards',
    dirty.length === 0,
    `${dirty.length} dirty connection(s)`,
  );

  /*
   * RLS enforced rather than merely defined (SEC-001).
   *
   * `FORCE` matters because the migration user owns these tables, and an owner bypasses its own
   * policies without it. A superuser bypasses them even with it. Either way the policies would still
   * be listed in the catalogue, so a reviewer reading the DDL would see a control that does nothing.
   */
  const [{ forced }] = await sql`
    SELECT relforcerowsecurity AS forced FROM pg_class WHERE relname = 'projects'
  `;
  /*
   * `rolbypassrls` as well as `rolsuper`, because on a managed provider they are not the same
   * question. Neon's `neondb_owner` is not a superuser and *does* have `BYPASSRLS` — so the owner
   * role this connects as is exempt from every policy, and `SET LOCAL ROLE` is not defence in depth
   * on top of RLS: it is the only thing that makes RLS apply at all.
   *
   * Which means a future `ALTER ROLE govintel_app BYPASSRLS`, or a provider that grants it by
   * default, would silently remove tenant isolation while leaving every policy defined and visible in
   * the catalogue. This assertion is what turns that into a failed check.
   */
  const [{ superuser, bypasses }] = await sql`
    SELECT rolsuper AS superuser, rolbypassrls AS bypasses
    FROM pg_roles WHERE rolname = ${APP_ROLE}
  `;

  check(
    'projects forces row-level security and the application role can neither bypass nor own it',
    forced === true && superuser === false && bypasses === false,
    `forced=${forced} superuser=${superuser} bypassrls=${bypasses}`,
  );

  await cleanup();
} finally {
  await sql.end();
}

console.log(failures === 0 ? '\nPooled isolation verified.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
