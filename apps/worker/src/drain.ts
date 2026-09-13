import { and, eq, isNull, sql } from 'drizzle-orm';
import { rowsOf, type Database } from '@govintel/db/client';
import { outboxEvents } from '@govintel/db/schema';
import { MAX_ATTEMPTS } from '@govintel/resilience/jobs';

/**
 * The outbox drainer, separated from the Worker entry so it can be run against a real Postgres in a
 * test. The entry point wires it to a queue; nothing here knows what a queue is.
 */

/** What is put on the queue: the id and the key, never the payload (see index.ts). */
export interface OutboxMessage {
  readonly id: string;
  readonly idempotencyKey: string | null;
  readonly eventType: string;
  readonly correlationId: string;
}

/** How many rows one cron tick publishes. */
export const DRAIN_BATCH = 100;

/**
 * How long a row may sit claimed before another drainer may publish it again.
 *
 * The drainer marks a row as attempted when it publishes, so two overlapping ticks do not publish the
 * same row twice. That mark has to expire, or a tick that dies between the mark and the publish would
 * strand the row forever — the failure that looks exactly like a side effect nobody ever needed.
 */
export const CLAIM_TIMEOUT_MS = 5 * 60 * 1000;

export interface DrainResult {
  readonly published: number;
  readonly deadLettered: readonly string[];
}

/**
 * Claim a batch, publish it, then dead-letter anything that has run out of attempts.
 *
 * Claim-then-publish rather than publish-then-claim. The reverse ordering publishes a message and then
 * records that it did, and a failure in between produces a delivery nobody knows about — which the
 * consumer's idempotency would absorb, so the bug would be invisible rather than absent.
 *
 * The dead-letter pass runs **whether or not anything was claimed**. It used to sit after an early
 * return on an empty claim, and the claim excludes rows at `MAX_ATTEMPTS` — so the one situation in
 * which every pending row has failed for good was exactly the one in which the pass that reports them
 * never ran. The rows sat undead-lettered, and the error log that is the only place a committed change
 * with no consequences ever surfaces stayed silent.
 */
export async function drain(
  db: Database,
  publish: (message: OutboxMessage) => Promise<void>,
  now: Date = new Date(),
): Promise<DrainResult> {
  const claimedBefore = new Date(now.getTime() - CLAIM_TIMEOUT_MS);

  /*
   * Claim a batch and read it back in one statement.
   *
   * `FOR UPDATE SKIP LOCKED` is what makes two overlapping ticks safe: the second skips rows the first
   * is holding rather than blocking on them.
   *
   * The `attempt_count` bump is the claim. It is also the retry counter, which means a row that keeps
   * failing to publish eventually exceeds `MAX_ATTEMPTS` and is dead-lettered rather than retried
   * forever — §46's distinction between a failure worth repeating and one that is not.
   */
  const claimed = rowsOf<{
    id: string;
    idempotency_key: string | null;
    event_type: string;
    correlation_id: string;
  }>(
    await db.execute(sql`
    WITH claimed AS (
      SELECT id
      FROM outbox_events
      WHERE processed_at IS NULL
        AND dead_lettered = false
        AND attempt_count < ${MAX_ATTEMPTS}
        AND (last_attempted_at IS NULL OR last_attempted_at < ${claimedBefore.toISOString()})
      ORDER BY created_at ASC
      LIMIT ${DRAIN_BATCH}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE outbox_events AS o
    SET attempt_count = o.attempt_count + 1,
        last_attempted_at = ${now.toISOString()}
    FROM claimed
    WHERE o.id = claimed.id
    RETURNING o.id, o.idempotency_key, o.event_type, o.correlation_id
  `),
  );

  for (const row of claimed) {
    await publish({
      id: row.id,
      idempotencyKey: row.idempotency_key,
      eventType: row.event_type,
      correlationId: row.correlation_id,
    });
  }

  const deadLettered = await deadLetterExhausted(db, claimedBefore);
  return { published: claimed.length, deadLettered };
}

/**
 * Mark rows that have run out of attempts.
 *
 * Separate from the claim so that a row is dead-lettered *after* its final attempt rather than
 * instead of it. Doing it in the claim would consume the last attempt without ever making it.
 *
 * "After" means after the final claim has had its chance, not after the final publish. This pass
 * used to mark every row at `MAX_ATTEMPTS` in the same tick that published it, so the last attempt
 * was dead-lettered before the consumer could run — and a row the consumer then processed was left
 * both processed and dead-lettered, with an error line reporting a lost side effect that had in fact
 * happened. A row is exhausted only once its last claim has expired unprocessed.
 */
export async function deadLetterExhausted(
  db: Database,
  claimedBefore: Date,
): Promise<readonly string[]> {
  const exhausted = await db
    .update(outboxEvents)
    .set({ deadLettered: true, lastErrorCode: 'ATTEMPTS_EXHAUSTED' })
    .where(
      and(
        isNull(outboxEvents.processedAt),
        eq(outboxEvents.deadLettered, false),
        sql`${outboxEvents.attemptCount} >= ${MAX_ATTEMPTS}`,
        sql`(${outboxEvents.lastAttemptedAt} IS NULL OR ${outboxEvents.lastAttemptedAt} < ${claimedBefore.toISOString()})`,
      ),
    )
    .returning({ id: outboxEvents.id });

  return exhausted.map((row) => row.id);
}
