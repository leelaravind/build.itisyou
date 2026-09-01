import 'server-only';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from '@govintel/db/schema';
import {
  SCHEMA_FINGERPRINT,
  applyTenantScope,
  readSchemaFingerprint,
  readSchemaFingerprintFrom,
  rebuildSchema,
} from '@govintel/db/client';
import { connect } from '@govintel/db/connect';
import { logger } from '@govintel/shared/logging';
import { IS_DEPLOYED } from './config.ts';
import { resolveConnectionString } from './connection-string.ts';

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

/*
 * Drizzle's common supertype, rather than a union of the two drivers.
 *
 * A union looked right and was not: `PgliteDatabase` and `PostgresJsDatabase` differ in their query
 * result type, so every call site had to narrow one away before it could do anything. `PgDatabase` is
 * the base both extend, and it carries everything the request layer uses — select, insert, update,
 * delete, execute and transaction — without knowing which driver is underneath.
 *
 * That is the point: the request layer must not be able to tell. If it could, the development and
 * deployed paths would drift.
 */
export type DatabaseHandle = PgDatabase<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

/**
 * The handle a tenant-scoped callback receives.
 *
 * Deliberately the *transaction* type rather than the database type. Making it the database type
 * would compile while letting a caller issue queries outside the scope — under the owner role, with
 * no tenant setting, seeing everything. The type is the guard.
 */
export type TenantScope = Parameters<Parameters<DatabaseHandle['transaction']>[0]>[0];

interface Cache {
  client?: PGlite;
  db?: DatabaseHandle;
  ready?: Promise<DatabaseHandle>;
  /**
   * Whether the handle is a real pool.
   *
   * Decides whether operations are serialised. PGlite has one connection and needs the mutex;
   * a pool hands out a connection per transaction and serialising would discard the pool.
   */
  pooled?: boolean;
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
    /*
     * Deployed: a networked PostgreSQL, reached through whatever pooler is in front of it.
     *
     * On Cloudflare that is Hyperdrive, which presents an ordinary connection string — so nothing
     * here names Cloudflare, and moving to a different pooler or host is a configuration change.
     *
     * There is deliberately no schema bootstrap on this path. `rebuildSchema` destroys data, and the
     * fingerprint check below refuses to serve rather than repairing: a deployed database whose shape
     * is not the one this build expects is a migration that has not run, and the correct response is
     * to stop, not to guess (KI-026).
     */
    /*
     * Resolved rather than read from `process.env` directly.
     *
     * On Cloudflare the connection string arrives on the Hyperdrive *binding*, which is an object and
     * therefore cannot appear in `process.env` the way a var or a secret does. Reading the variable
     * here threw "DATABASE_URL is not set" on the first staging request with the binding present and
     * correct. `resolveConnectionString` holds that one piece of provider knowledge so this module
     * keeps having none.
     */
    const connectionString = await resolveConnectionString();

    const { db: pooled } = connect({ connectionString });

    const deployedFingerprint = await readSchemaFingerprintFrom(pooled);

    if (deployedFingerprint !== SCHEMA_FINGERPRINT) {
      throw new Error(
        `The database schema does not match this build. Expected ${SCHEMA_FINGERPRINT}, ` +
          `found ${deployedFingerprint ?? 'no fingerprint at all'}. A migration has not run, or ran ` +
          'against a different database. Refusing to serve rather than guessing — see ' +
          'docs/MIGRATION_POLICY.md.',
      );
    }

    cache.pooled = true;
    return pooled;
  }

  cache.pooled = false;

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
 * **This is now a connection-level concern only.** It used to do double duty: PGlite's single
 * connection *and* tenant isolation, because `SET ROLE` and the tenant setting were session state and
 * the mutex was what stopped two requests interleaving inside somebody else's scope. That second job
 * has moved to `applyTenantScope`, which is transaction-local and therefore safe under any pooler
 * (KI-049).
 *
 * Keeping it is still correct here and only here: two concurrent transactions on one PGlite
 * connection would conflict. `withPooledTenant` — the deployed path — does not serialise, because a
 * pool hands out a connection per transaction and serialising would throw that away.
 */
let queue: Promise<unknown> = Promise.resolve();

export function serialised<T>(fn: () => Promise<T>): Promise<T> {
  // Chain onto the tail regardless of whether the previous operation succeeded — a rejection must
  // not break the chain for everything after it.
  const result = queue.then(fn, fn);
  queue = result.catch(() => undefined);
  return result;
}

/**
 * Whether operations must queue.
 *
 * True for PGlite, which has one connection. False for a pool, where serialising would hand back the
 * throughput the pool exists to provide — and where it would also be *misleading*, because the mutex
 * used to be part of the tenant isolation story and no longer is (KI-049).
 */
function mustSerialise(): boolean {
  return cache.pooled !== true;
}

/** The database handle. Serialised on the development path only. Use this from request handlers. */
export async function withDatabase<T>(fn: (db: DatabaseHandle) => Promise<T>): Promise<T> {
  const db = await getDatabase();
  return mustSerialise() ? serialised(() => fn(db)) : fn(db);
}

/**
 * Run a callback inside a tenant scope.
 *
 * One transaction, with the role and the tenant setting both transaction-local. Everything the
 * callback does runs on the transaction handle, not on the database handle — a query issued against
 * `db` here would run outside the scope, under the owner role, and see every tenant's rows.
 *
 * The serialisation is PGlite's single connection, not the isolation: see the note above and KI-049.
 */
export async function withTenant<T>(
  organizationId: string,
  fn: (tx: TenantScope) => Promise<T>,
): Promise<T> {
  const db = await getDatabase();

  const scope = (): Promise<T> =>
    db.transaction(async (tx) => {
      await applyTenantScope(tx, organizationId);
      return fn(tx);
    });

  return mustSerialise() ? serialised(scope) : scope();
}
