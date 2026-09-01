import 'server-only';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import * as schema from '@govintel/db/schema';
import {
  APP_ROLE,
  SCHEMA_FINGERPRINT,
  readSchemaFingerprint,
  rebuildSchema,
} from '@govintel/db/client';
import { logger } from '@govintel/shared/logging';
import { IS_DEPLOYED } from './config.ts';

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
  /*
   * A deployed environment must never reach this function. PGlite is a single-connection embedded
   * database and `rebuildSchema` below destroys data; both are correct for a laptop and catastrophic
   * anywhere else. The guard is here rather than in a comment because the failure mode is silent —
   * the app would start, serve traffic, and lose everything on the next deploy.
   */
  if (IS_DEPLOYED) {
    throw new Error(
      'The embedded development database was reached in a deployed environment. ' +
        'Deployed environments require a networked Postgres and real migrations (Phase 19).',
    );
  }

  const client = new PGlite(DEV_DATA_DIR);
  const db = drizzle(client, { schema });

  /*
   * Rebuild when the structure on disk is not the structure this build expects.
   *
   * The previous version asked "does `projects` exist?" and treated yes as "the schema is current".
   * That is true exactly once — the first time. Every table added afterwards was silently missing
   * from any data directory created before it, and the symptom surfaced as an insert failing against
   * a relation that does not exist, three layers away from the cause. `ai_imports` was the first to
   * hit it; every future table would have hit it too.
   *
   * Comparing a fingerprint of the DDL catches the general case instead of that one instance. The
   * local database is disposable by construction — it holds a developer's scratch projects, not a
   * customer's — so rebuilding is the right response, and it is logged loudly rather than done
   * quietly, because silently discarding local work is its own kind of unpleasant surprise.
   */
  const found = await readSchemaFingerprint(client);

  if (found !== SCHEMA_FINGERPRINT) {
    logger.warn(
      found === null
        ? 'building the development database'
        : 'the development database was built from a different schema; rebuilding it',
      { expected: SCHEMA_FINGERPRINT, found, dataDir: DEV_DATA_DIR },
    );
    await rebuildSchema(client);
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
