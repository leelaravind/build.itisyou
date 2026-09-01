import { describe, expect, it } from 'vitest';
import {
  JOB_STATES,
  MAX_ATTEMPTS,
  REDACTED,
  canTransition,
  checkJob,
  classify,
  recordFailure,
  redactPayload,
  retryDelayMs,
  type Job,
} from '../src/jobs.ts';
import {
  MODES,
  SUBSYSTEM_SPEC,
  checkDegradedModel,
  describeMutation,
  mayMutate,
  modeFor,
  omissionFor,
} from '../src/degraded.ts';
import {
  alreadyDelivered,
  checkOutbox,
  nextBatch,
  write,
  type OutboxEntry,
} from '../src/outbox.ts';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: 'j1',
    kind: 'RECALCULATE_BUDGET',
    state: 'RUNNING',
    attempts: 0,
    correlationId: 'c1',
    tenantId: 'org1',
    projectId: 'p1',
    idempotencyKey: 'k1',
    ...overrides,
  };
}

function entry(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    id: 'o1',
    event: 'GATE_CHANGED',
    tenantId: 'org1',
    projectId: 'p1',
    idempotencyKey: 'gate:security:v7',
    correlationId: 'c1',
    version: 7,
    state: 'PENDING',
    attempts: 0,
    payload: { gate: 'SECURITY' },
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* Jobs                                                                       */
/* -------------------------------------------------------------------------- */

describe('gap-spec §46: job failure semantics', () => {
  it('offers all six states', () => {
    expect(JOB_STATES).toHaveLength(6);
  });

  it('keeps retryable and terminal failures distinct', () => {
    /*
     * The whole design. With only "failed", either everything retries — so a job that will never
     * succeed occupies a worker and alerts forever — or nothing does, and a network blip permanently
     * loses a side effect nobody finds out about.
     */
    expect(classify('TIMEOUT', 1)).toBe('FAILED_RETRYABLE');
    expect(classify('VALIDATION_FAILED', 1)).toBe('FAILED_TERMINAL');
  });

  it('treats an unrecognised error as terminal', () => {
    /*
     * Allowlist rather than denylist. Defaulting to retryable means every unrecognised error retries
     * five times before anybody looks at it — and unrecognised errors are exactly the ones most
     * likely to be a genuine bug rather than a blip.
     */
    expect(classify('SOMETHING_NOBODY_ANTICIPATED', 1)).toBe('FAILED_TERMINAL');
  });

  it('becomes terminal once the attempts are exhausted', () => {
    // The reason was transient; the situation is not.
    expect(classify('TIMEOUT', MAX_ATTEMPTS)).toBe('FAILED_TERMINAL');
  });

  it('backs off exponentially, with a ceiling', () => {
    // A tight retry loop turns one failing job into load on the dependency that is already
    // struggling.
    expect(retryDelayMs(1)).toBeLessThan(retryDelayMs(3));
    expect(retryDelayMs(20)).toBeLessThanOrEqual(30_000);
  });

  it('counts the attempt before classifying it', () => {
    /*
     * Order matters: classifying before incrementing gives every job one more attempt than the limit
     * says, which is the kind of off-by-one nobody notices until they are counting retries during an
     * incident.
     */
    const exhausted = recordFailure(job({ attempts: MAX_ATTEMPTS - 1 }), { errorCode: 'TIMEOUT' });

    expect(exhausted.attempts).toBe(MAX_ATTEMPTS);
    expect(exhausted.state).toBe('FAILED_TERMINAL');
  });

  it('redacts secrets from a failure payload', () => {
    /*
     * §46's last line. A failure payload is the least guarded data in any system: logged, alerted on,
     * pasted into tickets, and read by people who would never be granted access to whatever it came
     * from.
     */
    const failed = recordFailure(job(), {
      errorCode: 'TIMEOUT',
      payload: {
        url: 'https://example.test/api',
        authorization: 'Bearer abc123',
        nested: { sessionToken: 'zzz', keep: 'this' },
      },
    });

    expect(failed.failurePayload?.authorization).toBe(REDACTED);
    expect(failed.failurePayload?.url).toBe('https://example.test/api');

    const nested = failed.failurePayload?.nested as Record<string, unknown>;

    expect(nested.sessionToken).toBe(REDACTED);
    expect(nested.keep).toBe('this');
  });

  it('redacts by key rather than by the shape of the value', () => {
    // A value-based check has to recognise a secret by shape, and secrets have no reliable shape. A
    // key called `password` holds one whatever it looks like.
    const redacted = redactPayload({ password: 'correct horse battery staple' }) as Record<
      string,
      unknown
    >;

    expect(redacted.password).toBe(REDACTED);
  });

  it('keeps the shape of the payload while removing the values', () => {
    // Somebody debugging can see that an authorization header was present, which is frequently the
    // fact they need.
    const redacted = redactPayload({ authorization: 'x' }) as Record<string, unknown>;

    expect(Object.keys(redacted)).toEqual(['authorization']);
  });

  it('bounds recursion so a pathological payload cannot take the worker down', () => {
    // It is already handling a failure. Falling over here would turn one bad job into an outage.
    let deep: Record<string, unknown> = { value: 1 };
    for (let i = 0; i < 30; i += 1) deep = { nested: deep };

    expect(() => redactPayload(deep)).not.toThrow();
  });

  it('cannot move out of a terminal state', () => {
    /*
     * A job that could leave SUCCEEDED would mean the record of a completed side effect is not final,
     * and everything downstream that trusted it would be trusting something revocable.
     */
    expect(canTransition('SUCCEEDED', 'RUNNING')).toBe(false);
    expect(canTransition('FAILED_TERMINAL', 'QUEUED')).toBe(false);
    expect(canTransition('FAILED_RETRYABLE', 'QUEUED')).toBe(true);
  });

  it('reports a job still retrying past the limit', () => {
    const findings = checkJob(job({ state: 'FAILED_RETRYABLE', attempts: MAX_ATTEMPTS + 2 }));

    expect(findings.map((f) => f.defect)).toContain('RETRYING_PAST_THE_LIMIT');
  });

  it('reports a leaked secret that bypassed redaction', () => {
    // The check exists because redaction is applied at one point and payloads can be written at
    // another. A control that only runs on the happy path is not a control.
    const findings = checkJob(job({ failurePayload: { apiKey: 'live-secret' } }));

    expect(findings.map((f) => f.defect)).toContain('SECRET_IN_PAYLOAD');
  });

  it('reports a job with no tenant', () => {
    // In a tenanted system, this is the shape a cross-tenant side effect takes.
    expect(checkJob(job({ tenantId: '' })).map((f) => f.defect)).toContain('NO_TENANT');
  });

  it('reports a job with no idempotency key', () => {
    // Retry is the point of the retryable state, and a retry without a key is a second execution
    // rather than a second attempt.
    expect(checkJob(job({ idempotencyKey: '' })).map((f) => f.defect)).toContain(
      'NO_IDEMPOTENCY_KEY',
    );
  });

  it('finds nothing wrong with a well-formed job', () => {
    expect(checkJob(job())).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Degraded mode                                                              */
/* -------------------------------------------------------------------------- */

describe('gap-spec §52: do not show stale mutation success', () => {
  it('never reports success for a change that could not have been applied', () => {
    /*
     * Asserted over the whole input space rather than on the cases I thought of. This is the single
     * instruction §52 gives, and the tempting implementation — keep the optimistic update, let the
     * request fail behind it — is the worst available outcome: the person believes their change is
     * saved, acts on it, and finds out at the moment they are relying on it hardest.
     */
    expect(checkDegradedModel()).toEqual([]);
  });

  it('refuses a mutation before attempting it when the store is unavailable', () => {
    // The safest possible failure: nothing reaches the database, so there is nothing to be uncertain
    // about afterwards.
    const result = describeMutation('UNAVAILABLE', false, false, true);

    expect(result.outcome).toBe('REFUSED');

    // The message has to say the change did not happen *and* that nothing partial was recorded.
    // "It failed" leaves a reader wondering whether half of it went through, which is the question
    // §52's stale-success rule exists to make unnecessary.
    expect(result.message).toMatch(/was not made/i);
    expect(result.message).toMatch(/nothing about it has been recorded/i);
  });

  it('reports a timed-out mutation as unknown rather than as either outcome', () => {
    /*
     * The state most systems do not have. A request that timed out after being sent may or may not
     * have been applied; claiming either is a lie, and the user's correct next action differs
     * between them.
     */
    const result = describeMutation('NORMAL', true, true, true);

    expect(result.outcome).toBe('UNKNOWN');
    expect(result.safeToRetry).toBe(true);
  });

  it('says retrying is unsafe without an idempotency key', () => {
    // Turning an unanswerable question into an instruction is only possible when a repeat is
    // recognised as the same change rather than made twice.
    const result = describeMutation('NORMAL', true, true, false);

    expect(result.safeToRetry).toBe(false);
    expect(result.message).toMatch(/reload before trying again/i);
  });

  it('keeps reading available when a non-critical subsystem is down', () => {
    // §52's graceful-degradation ladder. Search being down should not take project reading with it.
    expect(modeFor({ down: ['SEARCH'] })).toBe('DEGRADED');
    expect(mayMutate('DEGRADED')).toBe(true);
  });

  it('treats only the database as critical', () => {
    /*
     * Not an accident of implementation. Everything this platform claims to know is in the graph, and
     * without it there is nothing to be right or wrong about.
     */
    expect(SUBSYSTEM_SPEC.DATABASE.critical).toBe(true);
    expect(modeFor({ down: ['DATABASE'] })).toBe('UNAVAILABLE');
    expect(mayMutate('UNAVAILABLE')).toBe(false);
  });

  it('says the queue being down does not lose the work', () => {
    // Only safe because of the outbox: a change commits with its side effects recorded in the same
    // transaction, so the work is delayed rather than lost.
    expect(SUBSYSTEM_SPEC.QUEUE.critical).toBe(false);
    expect(SUBSYSTEM_SPEC.QUEUE.tellsTheUser).toMatch(/queued rather than lost/i);
  });

  it('distinguishes a section that is missing from one that is empty', () => {
    /*
     * The failure mode on the other side of degradation: a page rendering happily while silently
     * omitting a section, so the reader cannot tell "nothing here" from "we could not look". This
     * platform makes that distinction everywhere else, and an outage must not be the one place it
     * stops.
     */
    const omission = omissionFor('Evidence', 'OBJECT_STORAGE');

    expect(omission.message).toMatch(/missing rather than empty/i);
  });

  it('gives one answer per mode, so surfaces cannot disagree', () => {
    // Two pages disagreeing about whether the system is read-only is how a save button survives on
    // one of them.
    expect(MODES).toEqual(['NORMAL', 'DEGRADED', 'READ_ONLY', 'UNAVAILABLE']);
    expect(mayMutate('READ_ONLY')).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Outbox                                                                     */
/* -------------------------------------------------------------------------- */

describe('gap-spec §47: the transactional outbox', () => {
  it('writes an entry inside a transaction', () => {
    const result = write({ inTransaction: true }, entry());

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.state : undefined).toBe('PENDING');
  });

  it('refuses to write outside the transaction that carries the change', () => {
    /*
     * The refusal the whole pattern exists for. Writing outside reintroduces the race: the change
     * commits, the entry does not, and *nothing fails* — so nobody ever learns that a committed
     * change had no consequences.
     */
    const result = write({ inTransaction: false }, entry());

    expect(result.ok ? undefined : result.refusal).toBe('NOT_IN_A_TRANSACTION');
    expect(result.ok ? undefined : result.reason).toMatch(/nothing fails/i);
  });

  it('refuses an entry with no idempotency key', () => {
    /*
     * An outbox guarantees at-least-once delivery, so an entry with no key does its work twice on the
     * second delivery — and a second delivery is the normal consequence of a worker restarting
     * mid-batch, not a rare failure.
     */
    const result = write({ inTransaction: true }, entry({ idempotencyKey: '' }));

    expect(result.ok ? undefined : result.refusal).toBe('NO_IDEMPOTENCY_KEY');
  });

  it('skips an entry whose key has already been completed', () => {
    // Identity by key rather than by id, because the same logical side effect can arrive as two
    // entries — a retry that wrote a fresh row, a replayed batch.
    expect(alreadyDelivered(entry(), new Set(['gate:security:v7']))).toBe(true);
    expect(alreadyDelivered(entry({ id: 'o2' }), new Set(['gate:security:v7']))).toBe(true);
  });

  it('processes in version order', () => {
    /*
     * Ordering matters more here than throughput. A gate-changed event delivered before the version
     * that changed it would have a worker acting on a state the rest of the system has not reached.
     */
    const batch = nextBatch(
      [
        entry({ id: 'b', version: 9, idempotencyKey: 'k9' }),
        entry({ id: 'a', version: 7, idempotencyKey: 'k7' }),
      ],
      new Set(),
    );

    expect(batch.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('reports an entry stuck pending', () => {
    /*
     * A side effect that will never happen, and nothing else reports it: the change succeeded, the
     * entry exists, and the queue is technically working.
     */
    const findings = checkOutbox([entry({ attempts: 12 })], 10);

    expect(findings.map((f) => f.defect)).toContain('STUCK');
  });

  it('reports an entry referencing a version the project never reached', () => {
    // Impossible if it was written in the same transaction. Either it was not, or something rolled
    // back and left it behind.
    const findings = checkOutbox([entry({ version: 99 })], 10);

    expect(findings.map((f) => f.defect)).toContain('ORPHANED_ENTRY');
  });

  it('reports two entries sharing an idempotency key', () => {
    // Either the same side effect written twice — one will be silently skipped — or two different
    // ones that will collide.
    const findings = checkOutbox([entry({ id: 'a' }), entry({ id: 'b' })], 10);

    expect(findings.map((f) => f.defect)).toContain('DUPLICATE_KEY');
  });

  it('finds nothing wrong with a healthy outbox', () => {
    expect(checkOutbox([entry()], 10)).toEqual([]);
  });
});
