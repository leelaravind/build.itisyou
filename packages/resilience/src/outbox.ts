/**
 * The transactional outbox.
 *
 * §47: material domain changes that need asynchronous side effects must write outbox entries **inside
 * the same transaction**, and the worker processes them idempotently.
 *
 * The reason is a race that is easy to describe and almost impossible to notice in production. A
 * change commits, and then the code enqueues a job. Between those two statements the process can die,
 * the queue can be down, or the network can drop — and the result is a project whose version says a
 * gate changed while nothing downstream ever heard about it. Nobody gets an alert, because nothing
 * failed: the change succeeded, and the notification simply never existed.
 *
 * Writing the entry in the same transaction makes that impossible by construction. Either both happen
 * or neither does, which is the only arrangement where "the change is committed" and "its
 * consequences will happen" are the same statement.
 *
 * The cost is that delivery becomes at-least-once rather than exactly-once, which is why the worker
 * has to be idempotent — and why every entry carries a key rather than trusting the worker to be
 * careful.
 *
 * Contract: gap-spec §47, §48 (idempotency), §46 (job semantics).
 */

/* -------------------------------------------------------------------------- */
/* Entries                                                                    */
/* -------------------------------------------------------------------------- */

/** §47's examples, which are the events whose side effects must not be lost. */
export const OUTBOX_EVENTS = [
  'PROJECT_VERSION_CREATED',
  'GATE_CHANGED',
  'APPROVAL_GRANTED',
  'CHANGE_REQUEST_APPLIED',
  'DEPLOYMENT_RECORDED',
] as const;

export type OutboxEvent = (typeof OUTBOX_EVENTS)[number];

export const OUTBOX_STATES = ['PENDING', 'DELIVERED', 'ABANDONED'] as const;

export type OutboxState = (typeof OUTBOX_STATES)[number];

export interface OutboxEntry {
  readonly id: string;
  readonly event: OutboxEvent;
  readonly tenantId: string;
  readonly projectId: string;
  /**
   * What makes redelivery safe.
   *
   * Required rather than optional. An outbox guarantees at-least-once delivery, so an entry without a
   * key is one whose second delivery does the work twice — and the second delivery is not a rare
   * case, it is the normal consequence of a worker restarting mid-batch.
   */
  readonly idempotencyKey: string;
  readonly correlationId: string;
  /** The project version this was written alongside. Ties the side effect to the state that caused it. */
  readonly version: number;
  readonly state: OutboxState;
  readonly attempts: number;
  readonly payload: Readonly<Record<string, unknown>>;
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                    */
/* -------------------------------------------------------------------------- */

export const OUTBOX_REFUSALS = [
  'NOT_IN_A_TRANSACTION',
  'NO_IDEMPOTENCY_KEY',
  'NO_TENANT',
  'UNKNOWN_EVENT',
] as const;

export type OutboxRefusal = (typeof OUTBOX_REFUSALS)[number];

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refusal: OutboxRefusal; readonly reason: string };

export interface WriteContext {
  /**
   * Whether the caller is inside the transaction that carries the domain change.
   *
   * Passed explicitly rather than inferred, because the whole guarantee rests on it and something
   * this load-bearing should be impossible to satisfy by accident. A caller that has to state it is
   * a caller who had to think about it.
   */
  readonly inTransaction: boolean;
}

export function write(
  context: WriteContext,
  entry: Omit<OutboxEntry, 'state' | 'attempts'>,
): Result<OutboxEntry> {
  if (!context.inTransaction) {
    /*
     * The refusal the whole pattern exists for.
     *
     * Writing outside the transaction reintroduces exactly the race an outbox removes: the change
     * commits, the entry does not, and nothing fails — so nobody ever finds out that the consequences
     * of a committed change never happened.
     */
    return {
      ok: false,
      refusal: 'NOT_IN_A_TRANSACTION',
      reason:
        'An outbox entry written outside the transaction that carries the change reintroduces the race it exists to remove. The change commits, the entry does not, and nothing fails — so nobody learns that a committed change had no consequences.',
    };
  }

  if (!OUTBOX_EVENTS.includes(entry.event)) {
    return {
      ok: false,
      refusal: 'UNKNOWN_EVENT',
      reason: `${entry.event} is not an event with recorded side effects. Adding one is a decision about what the system promises to do, not a detail of how it does it.`,
    };
  }

  if (entry.idempotencyKey.trim() === '') {
    return {
      ok: false,
      refusal: 'NO_IDEMPOTENCY_KEY',
      reason:
        'An outbox guarantees at-least-once delivery, so an entry with no key does its work twice on the second delivery — and a second delivery is the normal consequence of a worker restarting mid-batch, not a rare failure.',
    };
  }

  if (entry.tenantId.trim() === '') {
    return {
      ok: false,
      refusal: 'NO_TENANT',
      reason: 'A side effect with no tenant is one that could be applied to the wrong one.',
    };
  }

  return { ok: true, value: { ...entry, state: 'PENDING', attempts: 0 } };
}

/* -------------------------------------------------------------------------- */
/* Processing                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Whether this entry has already been handled.
 *
 * Checked against keys the worker has completed rather than against entry ids, because the same
 * logical side effect can arrive as two entries — a retry that wrote a fresh row, a replayed batch —
 * and identity by id would treat those as different work.
 */
export function alreadyDelivered(entry: OutboxEntry, completedKeys: ReadonlySet<string>): boolean {
  return completedKeys.has(entry.idempotencyKey);
}

/**
 * The next entries to process, in the order they must be processed.
 *
 * Ordered by version then id. Ordering matters more here than throughput does: a gate-changed event
 * delivered before the version that changed it would have a worker acting on a state the rest of the
 * system has not reached.
 */
export function nextBatch(
  entries: readonly OutboxEntry[],
  completedKeys: ReadonlySet<string>,
  size = 25,
): readonly OutboxEntry[] {
  return entries
    .filter((entry) => entry.state === 'PENDING' && !alreadyDelivered(entry, completedKeys))
    .sort((a, b) => a.version - b.version || a.id.localeCompare(b.id))
    .slice(0, size);
}

/* -------------------------------------------------------------------------- */
/* Checks                                                                     */
/* -------------------------------------------------------------------------- */

export const OUTBOX_DEFECTS = ['ORPHANED_ENTRY', 'DUPLICATE_KEY', 'STUCK'] as const;

export type OutboxDefect = (typeof OUTBOX_DEFECTS)[number];

export interface OutboxFinding {
  readonly defect: OutboxDefect;
  readonly entryId: string;
  readonly summary: string;
  readonly why: string;
}

/**
 * Problems visible only across the whole outbox rather than in any single entry.
 *
 * `STUCK` is the one worth having. An entry that has been pending through many attempts is the shape
 * of a side effect that will never happen, and nothing else reports it: the change succeeded, the
 * entry exists, and the queue is technically working.
 */
export function checkOutbox(
  entries: readonly OutboxEntry[],
  highestVersion: number,
): readonly OutboxFinding[] {
  const findings: OutboxFinding[] = [];
  const seen = new Map<string, string>();

  for (const entry of entries) {
    const prior = seen.get(entry.idempotencyKey);

    if (prior !== undefined) {
      findings.push({
        defect: 'DUPLICATE_KEY',
        entryId: entry.id,
        summary: `Shares an idempotency key with ${prior}.`,
        why: 'Two entries with one key are either the same side effect written twice — in which case one will be silently skipped — or two different ones that will collide. Both are worth knowing about.',
      });
    }

    seen.set(entry.idempotencyKey, entry.id);

    if (entry.version > highestVersion) {
      findings.push({
        defect: 'ORPHANED_ENTRY',
        entryId: entry.id,
        summary: `References version ${String(entry.version)}, beyond the project's current ${String(highestVersion)}.`,
        why: 'The entry outlived the change it was written with, which should be impossible if it was written in the same transaction. Either it was not, or something rolled back and left it behind.',
      });
    }

    if (entry.state === 'PENDING' && entry.attempts >= 10) {
      findings.push({
        defect: 'STUCK',
        entryId: entry.id,
        summary: `Pending after ${String(entry.attempts)} attempts.`,
        why: 'A side effect that will never happen, and nothing else reports it: the change succeeded, the entry exists, and the queue is technically working.',
      });
    }
  }

  return findings;
}
