import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from '@govintel/db/client';
import { outboxEvents } from '@govintel/db/schema';
import { MAX_ATTEMPTS } from '@govintel/resilience/jobs';
import { CLAIM_TIMEOUT_MS, drain, type OutboxMessage } from '../src/drain.ts';

/**
 * The drainer against real Postgres (PGlite), not a mock of one: the claim is a CTE with
 * `FOR UPDATE SKIP LOCKED`, and a mock would only prove the SQL string was sent.
 */

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.truncate();
});

async function insertEvent(overrides: Partial<typeof outboxEvents.$inferInsert> = {}) {
  const [row] = await database.db
    .insert(outboxEvents)
    .values({
      eventType: 'GATE_CHANGED',
      payload: { gate: 'PLANNING' },
      correlationId: crypto.randomUUID(),
      ...overrides,
    })
    .returning();
  if (row === undefined) throw new Error('insert returned nothing');
  return row;
}

function collector() {
  const sent: OutboxMessage[] = [];
  return {
    sent,
    publish: (message: OutboxMessage) => {
      sent.push(message);
      return Promise.resolve();
    },
  };
}

describe('drain', () => {
  it('publishes pending rows and records the claim', async () => {
    const row = await insertEvent({ idempotencyKey: 'k-1' });
    const { sent, publish } = collector();

    const result = await drain(database.db, publish);

    expect(result.published).toBe(1);
    expect(sent).toEqual([
      {
        id: row.id,
        idempotencyKey: 'k-1',
        eventType: 'GATE_CHANGED',
        correlationId: row.correlationId,
      },
    ]);
    const [after] = await database.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, row.id));
    expect(after?.attemptCount).toBe(1);
    expect(after?.lastAttemptedAt).not.toBeNull();
  });

  it('does not publish a row twice while its claim is live', async () => {
    await insertEvent();
    const now = new Date();
    const first = collector();
    const second = collector();

    await drain(database.db, first.publish, now);
    await drain(database.db, second.publish, new Date(now.getTime() + 60_000));

    expect(first.sent).toHaveLength(1);
    expect(second.sent).toHaveLength(0);
  });

  it('re-publishes a row whose claim expired without a result', async () => {
    await insertEvent();
    const now = new Date();
    await drain(database.db, collector().publish, now);

    const later = collector();
    await drain(database.db, later.publish, new Date(now.getTime() + CLAIM_TIMEOUT_MS + 1_000));

    expect(later.sent).toHaveLength(1);
  });

  it('skips processed and dead-lettered rows', async () => {
    await insertEvent({ processedAt: new Date() });
    await insertEvent({ deadLettered: true });
    const { sent, publish } = collector();

    const result = await drain(database.db, publish);

    expect(result.published).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('dead-letters exhausted rows even when nothing else is pending', async () => {
    // The regression: the dead-letter pass sat behind `if (claimed.length === 0) return`, and the
    // claim excludes exhausted rows, so the pass never ran in exactly this situation.
    const exhausted = await insertEvent({ attemptCount: MAX_ATTEMPTS });

    const result = await drain(database.db, collector().publish);

    expect(result.published).toBe(0);
    expect(result.deadLettered).toEqual([exhausted.id]);
    const [after] = await database.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, exhausted.id));
    expect(after?.deadLettered).toBe(true);
    expect(after?.lastErrorCode).toBe('ATTEMPTS_EXHAUSTED');
  });

  it('gives the final attempt its chance before dead-lettering it', async () => {
    // The claim takes this row to MAX_ATTEMPTS. It used to be dead-lettered in the same tick that
    // published it — before the consumer ran — so a delivery that then succeeded was reported lost.
    const last = await insertEvent({ attemptCount: MAX_ATTEMPTS - 1 });
    const now = new Date();
    const { sent, publish } = collector();

    const result = await drain(database.db, publish, now);

    expect(sent.map((m) => m.id)).toEqual([last.id]);
    expect(result.deadLettered).toEqual([]);

    // The final claim expires with the row still unprocessed: now it is exhausted.
    const later = await drain(
      database.db,
      collector().publish,
      new Date(now.getTime() + CLAIM_TIMEOUT_MS + 1_000),
    );
    expect(later.deadLettered).toEqual([last.id]);
  });

  it('never dead-letters a row the consumer processed on its final attempt', async () => {
    const last = await insertEvent({ attemptCount: MAX_ATTEMPTS - 1 });
    const now = new Date();
    await drain(database.db, collector().publish, now);
    await database.db
      .update(outboxEvents)
      .set({ processedAt: new Date() })
      .where(eq(outboxEvents.id, last.id));

    const later = await drain(
      database.db,
      collector().publish,
      new Date(now.getTime() + CLAIM_TIMEOUT_MS + 1_000),
    );

    expect(later.deadLettered).toEqual([]);
  });

  it('does not report a row twice once it is dead-lettered', async () => {
    await insertEvent({ attemptCount: MAX_ATTEMPTS });
    await drain(database.db, collector().publish);

    const second = await drain(database.db, collector().publish);

    expect(second.deadLettered).toEqual([]);
  });

  it('publishes in creation order', async () => {
    const first = await insertEvent({ createdAt: new Date('2026-01-01T00:00:00Z') });
    const second = await insertEvent({ createdAt: new Date('2026-01-02T00:00:00Z') });
    const { sent, publish } = collector();

    await drain(database.db, publish);

    expect(sent.map((m) => m.id)).toEqual([first.id, second.id]);
  });
});
