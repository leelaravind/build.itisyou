import 'server-only';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import * as schema from '@govintel/db/schema';
import { SCHEMA_DDL, ROW_LEVEL_SECURITY_DDL, APP_ROLE } from '@govintel/db/client';

/**
 * Server-side database handle.
 *
 * ADR-0002: PostgreSQL everywhere. PGlite in development, a networked server when deployed. The
 * deployment target is deliberately not chosen yet (deferred to Phase 19), so this module talks to
 * a connection string and nothing else — there is no provider-specific code to unpick later.
 *
 * `server-only` at the top is load-bearing: importing this from a client component would bundle a
 * database driver, and in the worst case a connection string, into browser JavaScript. The import
 * makes that a build error rather than a code review question.
 *
 * The instance is memoised on `globalThis` because Next's dev server re-evaluates modules on every
 * hot reload; without it each reload would create another PGlite instance and lose all local state.
 */

type DatabaseHandle = ReturnType<typeof drizzle<typeof schema>>;

interface Cache {
  client?: PGlite;
  db?: DatabaseHandle;
  ready?: Promise<DatabaseHandle>;
}

const globalCache = globalThis as unknown as { __govintelDb?: Cache };
const cache: Cache = (globalCache.__govintelDb ??= {});

/**
 * Development data directory.
 *
 * File-backed rather than in-memory so a restart does not silently discard a guest's work. Tests use
 * `createTestDatabase()` from `@govintel/db/client` instead, which is in-memory and per-file.
 */
const DEV_DATA_DIR = '.pglite';

async function initialise(): Promise<DatabaseHandle> {
  const client = new PGlite(DEV_DATA_DIR);
  const db = drizzle(client, { schema });

  // Idempotent: the schema is applied only if the tables are absent, so a restart against an
  // existing data directory keeps whatever the developer already has.
  const existing = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'projects'`,
  );

  if ((existing.rows[0]?.count ?? 0) === 0) {
    await client.exec(SCHEMA_DDL);
    await client.exec(`
      CREATE ROLE ${APP_ROLE} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
      GRANT USAGE ON SCHEMA public TO ${APP_ROLE};
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE};
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};
    `);
    await client.exec(ROW_LEVEL_SECURITY_DDL);
  }

  cache.client = client;
  cache.db = db;
  return db;
}

/** The database handle, initialising it once per process. */
export async function getDatabase(): Promise<DatabaseHandle> {
  if (cache.db !== undefined) return cache.db;
  // Memoise the promise, not just the result: two concurrent requests during a cold start would
  // otherwise each begin initialisation and race to create the schema.
  cache.ready ??= initialise();
  return cache.ready;
}

/*
 * Serialised access to the development database.
 *
 * **PGlite is single-connection.** It is real Postgres, but it is one embedded instance with one
 * connection, so two overlapping requests do not get two sessions — they interleave on the same one.
 * Under concurrent load, writes were silently lost: the E2E suite recorded an intake answer, the
 * next request read the table and saw nothing, and the wizard appeared to ignore the answer.
 *
 * The symptom was maddeningly intermittent, which is the signature of exactly this. It is also
 * KI-013, logged at Phase 0 as an accepted limitation of PGlite — it just arrived earlier than
 * expected, in the application rather than in the tests.
 *
 * Every database operation therefore queues behind the previous one. That is a real throughput
 * ceiling and it is fine: this path is only ever used in development and test. Deployed environments
 * connect to a networked Postgres with a proper pool, where the queue does not apply.
 */
let queue: Promise<unknown> = Promise.resolve();

export function serialised<T>(fn: () => Promise<T>): Promise<T> {
  // Chain onto the tail regardless of whether the previous operation succeeded — a rejection must
  // not break the chain for everything after it.
  const result = queue.then(fn, fn);
  queue = result.catch(() => undefined);
  return result;
}

/** The database handle, with all access serialised. Use this from request handlers. */
export async function withDatabase<T>(fn: (db: DatabaseHandle) => Promise<T>): Promise<T> {
  const db = await getDatabase();
  return serialised(() => fn(db));
}

/**
 * Run a callback inside a tenant scope.
 *
 * Sets the application role and the tenant session variable, exactly as the isolation tests do.
 * `SET ROLE` is what makes row-level security apply at all — a superuser bypasses every policy
 * unconditionally, which is finding SEC-001 in `docs/SECURITY.md`.
 */
export async function withTenant<T>(
  organizationId: string,
  fn: (db: DatabaseHandle) => Promise<T>,
): Promise<T> {
  const db = await getDatabase();

  // The whole scope is serialised: `SET ROLE` and the tenant setting are connection state, so an
  // interleaved request would run under another tenant's scope. On a single-connection database
  // that is not a theoretical risk.
  return serialised(async () => {
    await db.execute(sql`SET ROLE ${sql.raw(APP_ROLE)}`);
    await db.execute(
      sql`SELECT set_config('app.current_organization_id', ${organizationId}, false)`,
    );

    try {
      return await fn(db);
    } finally {
      await db.execute(sql`SELECT set_config('app.current_organization_id', '', false)`);
      await db.execute(sql`RESET ROLE`);
    }
  });
}
