/**
 * Background job failure semantics.
 *
 * §46 lists six states and seven fields. The list looks like bookkeeping and is not: the distinction
 * between `FAILED_RETRYABLE` and `FAILED_TERMINAL` is the whole design, because a system with only
 * "failed" does one of two harmful things.
 *
 * If everything retries, a job that will never succeed — malformed input, a deleted subject, a
 * permanent authorisation failure — retries forever, occupying a worker and generating an alert
 * every time. If nothing retries, a transient network blip becomes a permanently lost side effect,
 * and nobody finds out until somebody notices the thing that should have happened did not.
 *
 * So the classification is a property of the *error*, not of the attempt, and it is decided by a
 * function rather than by whoever wrote the catch block.
 *
 * The other line worth taking seriously is §46's last: **no raw secrets in the failure payload.** A
 * failure payload is the least guarded data in any system — it is logged, alerted on, pasted into
 * tickets and read by people who would never be granted access to the thing it came from.
 *
 * Contract: gap-spec §46, §54 (log redaction).
 */

/* -------------------------------------------------------------------------- */
/* States                                                                     */
/* -------------------------------------------------------------------------- */

/** §46's six, in the order it names them. */
export const JOB_STATES = [
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED_RETRYABLE',
  'FAILED_TERMINAL',
  'CANCELLED',
] as const;

export type JobState = (typeof JOB_STATES)[number];

export const STATE_MEANING: Readonly<Record<JobState, string>> = {
  QUEUED: 'Accepted and waiting. Nothing has been attempted yet.',
  RUNNING: 'A worker has it. If a worker dies here the job is reclaimed, not lost.',
  SUCCEEDED: 'Done. The side effect happened.',
  FAILED_RETRYABLE:
    'Failed for a reason that might not recur — a timeout, a lock, a dependency that was briefly down. It will be attempted again.',
  FAILED_TERMINAL:
    'Failed for a reason that will recur every time. Retrying wastes a worker and produces an alert per attempt; this needs a person.',
  CANCELLED:
    'Somebody stopped it before it finished. Not a failure, and it should not be alerted on.',
};

/**
 * Which transitions are legal. Deny-by-default, like every other allowlist here.
 *
 * `SUCCEEDED` is terminal, and so is `FAILED_TERMINAL`. A job that could move out of `SUCCEEDED`
 * would mean the record of a completed side effect is not final, and everything downstream that
 * trusted it would be trusting something revocable.
 */
export const TRANSITIONS: Readonly<Record<JobState, readonly JobState[]>> = {
  QUEUED: ['RUNNING', 'CANCELLED'],
  RUNNING: ['SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_TERMINAL', 'CANCELLED'],
  // Back to queued for another attempt. This is the only cycle in the machine, and it is bounded by
  // the attempt limit rather than by the state graph.
  FAILED_RETRYABLE: ['QUEUED', 'FAILED_TERMINAL', 'CANCELLED'],
  SUCCEEDED: [],
  FAILED_TERMINAL: [],
  CANCELLED: [],
};

export function canTransition(from: JobState, to: JobState): boolean {
  return TRANSITIONS[from].includes(to);
}

/* -------------------------------------------------------------------------- */
/* Jobs                                                                       */
/* -------------------------------------------------------------------------- */

/** §46's required fields, all of them. */
export interface Job {
  readonly id: string;
  readonly kind: string;
  readonly state: JobState;
  readonly attempts: number;
  /** A code, never a message. Messages carry data; codes carry meaning. */
  readonly lastErrorCode?: string;
  readonly correlationId: string;
  readonly tenantId: string;
  readonly projectId?: string;
  /** What makes a repeat attempt safe. §48. */
  readonly idempotencyKey: string;
  /** Redacted before it is written. Never contains a secret. */
  readonly failurePayload?: Readonly<Record<string, unknown>>;
}

/**
 * How many attempts before a retryable failure becomes terminal.
 *
 * Five, and the number matters less than the existence of a limit. Unbounded retry of something that
 * is genuinely broken is indistinguishable from a denial-of-service the system is performing on
 * itself, and it produces the alert fatigue that means nobody looks at the sixth one.
 */
export const MAX_ATTEMPTS = 5;

/* -------------------------------------------------------------------------- */
/* Classification                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Error codes that are worth trying again.
 *
 * An allowlist rather than a denylist, and that direction is deliberate. Defaulting to retryable
 * means every unrecognised error retries five times before anybody looks at it — and unrecognised
 * errors are exactly the ones most likely to be a genuine bug rather than a blip.
 */
const RETRYABLE_CODES: ReadonlySet<string> = new Set([
  'TIMEOUT',
  'CONNECTION_REFUSED',
  'LOCK_CONTENTION',
  'RATE_LIMITED',
  'DEPENDENCY_UNAVAILABLE',
  'SERIALIZATION_FAILURE',
]);

/**
 * Which kind of failure this is.
 *
 * Decided from the error code rather than by whoever wrote the catch block, because the same
 * classification has to hold everywhere — a job that retries in one code path and does not in another
 * behaves differently depending on where it failed, which is impossible to reason about afterwards.
 */
export function classify(errorCode: string, attempts: number): JobState {
  if (!RETRYABLE_CODES.has(errorCode)) return 'FAILED_TERMINAL';

  // A retryable error that has exhausted its attempts is terminal. The reason was transient; the
  // situation is not.
  return attempts >= MAX_ATTEMPTS ? 'FAILED_TERMINAL' : 'FAILED_RETRYABLE';
}

/**
 * When to attempt again, as a delay in milliseconds.
 *
 * Exponential, because a dependency that is down stays down for a while and a tight retry loop turns
 * one failing job into load on the thing that is already struggling. Returned rather than slept, so
 * the schedule is testable without waiting for it.
 */
export function retryDelayMs(attempts: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, attempts - 1));
}

/* -------------------------------------------------------------------------- */
/* Redaction                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Key fragments whose values never reach a failure payload.
 *
 * Matched on the key rather than on the value, because a value-based check has to recognise a secret
 * by shape and secrets have no reliable shape. A key called `password` holds one whatever it looks
 * like.
 */
const SENSITIVE_KEY_FRAGMENTS = [
  'password',
  'secret',
  'token',
  'authorization',
  'auth',
  'cookie',
  'session',
  'key',
  'credential',
  'signature',
  'private',
];

export const REDACTED = '[redacted]';

/**
 * Strip secrets from a failure payload, recursively.
 *
 * §46's last line. A failure payload is the least guarded data in any system: logged, alerted on,
 * pasted into tickets, and read by people who would never be granted access to whatever it came from.
 *
 * Redacts rather than removes, so the *shape* of the payload survives — somebody debugging can see
 * that an authorization header was present, which is frequently the fact they need.
 */
export function redactPayload(payload: unknown, depth = 0): unknown {
  // Bounded, because a cyclic or pathologically nested payload would otherwise take the worker down
  // while it was already handling a failure.
  if (depth > 6) return '[too deep]';

  if (Array.isArray(payload)) return payload.map((entry) => redactPayload(entry, depth + 1));

  if (typeof payload !== 'object' || payload === null) return payload;

  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload)) {
    out[key] = isSensitive(key) ? REDACTED : redactPayload(value, depth + 1);
  }

  return out;
}

function isSensitive(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_FRAGMENTS.some((fragment) => lower.includes(fragment));
}

/* -------------------------------------------------------------------------- */
/* Recording a failure                                                        */
/* -------------------------------------------------------------------------- */

export interface Failure {
  readonly errorCode: string;
  readonly payload?: Readonly<Record<string, unknown>>;
}

/**
 * The job after a failure.
 *
 * Increments the attempt count, classifies, and redacts — in that order, so the classification sees
 * the attempt that just happened rather than the one before it. Getting that backwards gives every
 * job one more attempt than the limit says, which is the kind of off-by-one nobody notices until
 * they are counting retries in an incident.
 */
export function recordFailure(job: Job, failure: Failure): Job {
  const attempts = job.attempts + 1;

  return {
    ...job,
    attempts,
    state: classify(failure.errorCode, attempts),
    lastErrorCode: failure.errorCode,
    ...(failure.payload === undefined
      ? {}
      : { failurePayload: redactPayload(failure.payload) as Readonly<Record<string, unknown>> }),
  };
}

/* -------------------------------------------------------------------------- */
/* Checks                                                                     */
/* -------------------------------------------------------------------------- */

export const JOB_DEFECTS = [
  'SECRET_IN_PAYLOAD',
  'NO_CORRELATION_ID',
  'NO_TENANT',
  'NO_IDEMPOTENCY_KEY',
  'RETRYING_PAST_THE_LIMIT',
] as const;

export type JobDefect = (typeof JOB_DEFECTS)[number];

export interface JobFinding {
  readonly defect: JobDefect;
  readonly jobId: string;
  readonly summary: string;
  readonly why: string;
}

export function checkJob(job: Job): readonly JobFinding[] {
  const findings: JobFinding[] = [];

  if (job.failurePayload !== undefined) {
    const leaked = Object.keys(job.failurePayload).filter(
      (key) => isSensitive(key) && job.failurePayload?.[key] !== REDACTED,
    );

    if (leaked.length > 0) {
      findings.push({
        defect: 'SECRET_IN_PAYLOAD',
        jobId: job.id,
        summary: `${leaked.join(', ')} reached the failure payload unredacted.`,
        why: 'A failure payload is the least guarded data in any system — logged, alerted on, pasted into tickets, read by people who would never be granted access to whatever it came from.',
      });
    }
  }

  if (job.correlationId.trim() === '') {
    findings.push({
      defect: 'NO_CORRELATION_ID',
      jobId: job.id,
      summary: 'No correlation id.',
      why: 'A failed job with no correlation id cannot be tied to the request that queued it, which is the first thing anybody asks when one fails.',
    });
  }

  if (job.tenantId.trim() === '') {
    findings.push({
      defect: 'NO_TENANT',
      jobId: job.id,
      summary: 'No tenant.',
      why: 'A job with no tenant cannot be scoped, retried safely, or shown to the right people. In a tenanted system it is also the shape a cross-tenant side effect takes.',
    });
  }

  if (job.idempotencyKey.trim() === '') {
    findings.push({
      defect: 'NO_IDEMPOTENCY_KEY',
      jobId: job.id,
      summary: 'No idempotency key.',
      why: 'Retry is the whole point of the retryable state, and a retry without an idempotency key is a second execution rather than a second attempt.',
    });
  }

  if (job.state === 'FAILED_RETRYABLE' && job.attempts >= MAX_ATTEMPTS) {
    findings.push({
      defect: 'RETRYING_PAST_THE_LIMIT',
      jobId: job.id,
      summary: `Still retryable after ${String(job.attempts)} attempts.`,
      why: 'Unbounded retry of something genuinely broken is a denial-of-service the system performs on itself, and it produces the alert fatigue that means nobody looks at the sixth one.',
    });
  }

  return findings;
}
