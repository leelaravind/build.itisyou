/**
 * Connecting to a networked PostgreSQL.
 *
 * One place that knows how to open a connection, shared by the request layer and the background
 * Worker. Both need the same driver, the same pool settings and the same reasons for them, and two
 * copies would drift in exactly the way the tenant scope did (KI-049).
 *
 * This module is deliberately ignorant of Cloudflare. It takes a connection string and returns a
 * Drizzle handle. Hyperdrive presents itself as an ordinary Postgres connection string, so the
 * pooler is a deployment detail rather than something the code has to know about — which is what
 * makes it replaceable.
 *
 * PGlite remains the development path (`apps/web/src/lib/server/database.ts`). It is the same engine,
 * so behaviour transfers; it is one connection, so it needs a mutex this does not.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';

export type PooledDatabase = ReturnType<typeof drizzle<typeof schema>>;

export interface ConnectionOptions {
  readonly connectionString: string;
  /**
   * Connections this instance may open.
   *
   * Small on purpose. Behind Hyperdrive the real pooling happens in Hyperdrive, and a Worker isolate
   * is short-lived and highly replicated — a generous per-isolate pool multiplied by the number of
   * isolates is how a serverless application exhausts a database's connection limit while each
   * individual instance looks reasonable.
   */
  readonly maxConnections?: number;
  /** Seconds a connection may sit idle before being closed. */
  readonly idleTimeoutSeconds?: number;
  /** Seconds to wait for a connection before giving up. */
  readonly connectTimeoutSeconds?: number;
}

/**
 * Open a pooled connection.
 *
 * `prepare: false` is required rather than preferred. Named prepared statements live on a *session*,
 * and a transaction-mode pooler hands out a different session per transaction — so a prepared
 * statement created on one and referenced on another produces "prepared statement does not exist"
 * under load and never in testing. It is the same class of bug as KI-049: connection-level state
 * that survives longer than the thing that created it.
 */
export function connect(options: ConnectionOptions): {
  readonly db: PooledDatabase;
  readonly close: () => Promise<void>;
} {
  const client = postgres(options.connectionString, {
    max: options.maxConnections ?? 5,
    idle_timeout: options.idleTimeoutSeconds ?? 20,
    connect_timeout: options.connectTimeoutSeconds ?? 10,

    // See the note above. Not an optimisation to revisit.
    prepare: false,

    /*
     * Do not interrogate the server for type OIDs on connect.
     *
     * postgres.js normally issues a catalogue query to learn custom types. Behind a pooler that is
     * an extra round trip on every cold connection, and in a Worker cold connections are the common
     * case rather than the exception. The schema uses no custom types that need it.
     */
    fetch_types: false,

    /*
     * `onnotice` is deliberately left at its default, which logs.
     *
     * `SET LOCAL` outside a transaction emits a warning rather than an error, and the tenant scope
     * depends on being inside one. Silencing notices is the obvious tidiness that would hide the one
     * signal saying KI-049's fix had stopped applying.
     */
  });

  return {
    db: drizzle(client, { schema }),
    close: async () => {
      await client.end({ timeout: 5 });
    },
  };
}
