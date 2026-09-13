import { and, eq, isNull } from 'drizzle-orm';
import { connect, type PooledDatabase } from '@govintel/db/connect';
import { outboxEvents } from '@govintel/db/schema';
import { purgeExpiredGuestSessions } from '@govintel/db/guest';
import { classify } from '@govintel/resilience/jobs';
import { logger } from '@govintel/shared/logging';
import { drain, type OutboxMessage } from './drain.ts';

/**
 * The outbox drainer and queue consumer.
 *
 * A separate Worker from the application, and deliberately so. OpenNext owns the entry point of the
 * Next.js Worker; adding a `queue` and `scheduled` handler to a generated entry means fighting the
 * generator on every upgrade. Two Workers sharing `packages/*` is the arrangement that stays true
 * after somebody else touches it.
 *
 * ## What this is for
 *
 * §47 requires side effects to be recorded inside the transaction that carries the domain change.
 * The application therefore writes **rows**, never queue messages: publishing from a request would
 * reintroduce exactly the race the outbox removes, where the change commits, the publish does not,
 * and *nothing fails* — so nobody learns that a committed change had no consequences.
 *
 * This Worker closes that loop in two halves:
 *
 * - `scheduled` — the drainer. Reads unprocessed rows in version order and publishes them.
 * - `queue` — the consumer. Performs the side effect and marks the row processed.
 *
 * ## Why the two halves are separate
 *
 * The drainer could do the work itself and skip the queue entirely. It should not: a cron tick is a
 * single invocation with one CPU budget, and a backlog of a thousand rows would exhaust it and
 * retry the whole batch from the beginning. Publishing hands each row its own invocation, its own
 * budget, and its own retry — which is what makes a backlog drain rather than thrash.
 */

export interface Env {
  readonly HYPERDRIVE: { readonly connectionString: string };
  /**
   * Absent where no queue is provisioned — production, for now. Nothing in V1 writes an outbox row
   * (there is no transport to deliver one to, §43/§44), so provisioning a queue there would be
   * infrastructure with no producer. Guest expiry is the job production needs, and it does not
   * depend on the queue.
   */
  readonly OUTBOX_QUEUE?: Queue<OutboxMessage>;
  readonly APP_ENV: string;
}

export type { OutboxMessage } from './drain.ts';

export default {
  /**
   * The drainer. Runs on a schedule.
   *
   * Claim-then-publish rather than publish-then-claim. The reverse ordering publishes a message and
   * then records that it did, and a failure in between produces a delivery nobody knows about —
   * which the consumer's idempotency would absorb, so the bug would be invisible rather than absent.
   */
  // Not `async`: the whole point is to hand the drain to `waitUntil` and return immediately, so the
  // handler awaits nothing. Marking it async to look symmetrical with `queue` would be a lie the
  // linter is right to reject.
  scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): void {
    const { db, close } = connect({ connectionString: env.HYPERDRIVE.connectionString });

    /*
     * Two jobs, and only one of them is the outbox.
     *
     * Guest expiry is the single clock-driven job V1 actually requires: gap-spec §5.3 says guest
     * projects expire automatically, and §5.2 forbids keeping full project data indefinitely without
     * signup. `purgeExpiredGuestSessions` implements it, is unit-tested, and until now had **no
     * caller anywhere** — so the retention promise was written down, stamped onto every session as
     * `expires_at`, and never kept. Expired guest data simply accumulated; on staging it had reached
     * 3,872 projects.
     *
     * They run independently rather than in sequence: a failure to drain must not stop data being
     * deleted, and a failure to delete must not stop side effects being published. Chaining them
     * would make the less important one able to block the one with a privacy obligation behind it.
     *
     * The connection must outlive the handler's return but not the invocation, or a job is cancelled
     * halfway — the drain with rows claimed and unpublished, the purge mid-transaction.
     */
    ctx.waitUntil(
      Promise.allSettled([
        runDrain(db, env).catch((error: unknown) => {
          logger.error('outbox drain failed', { error: String(error) });
        }),
        purge(db).catch((error: unknown) => {
          logger.error('guest session purge failed', { error: String(error) });
        }),
      ]).finally(() => close()),
    );
  },

  /**
   * The consumer. One message, one side effect.
   *
   * `retryAll` and `ackAll` are used rather than per-message acknowledgement because the batch is
   * processed in order and a failure mid-batch means the rows after it have not been attempted. Acking
   * those would lose them.
   */
  async queue(batch: MessageBatch<OutboxMessage>, env: Env): Promise<void> {
    const { db, close } = connect({ connectionString: env.HYPERDRIVE.connectionString });

    try {
      for (const message of batch.messages) {
        await handle(db, message);
      }
    } finally {
      await close();
    }
  },
};

/* -------------------------------------------------------------------------- */
/* Retention                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Delete guest sessions past their expiry, and the projects that belong to them.
 *
 * The retention obligation V1 actually has. Gap-spec §5.3 requires guest projects to expire
 * automatically and §5.2 forbids keeping full project data indefinitely without signup — and every
 * session has carried an `expires_at` since Phase 3 that nothing ever acted on.
 *
 * Converted sessions are exempt, which `purgeExpiredGuestSessions` enforces by checking
 * `converted_at IS NULL`: once a guest has saved their work to an account, the session's expiry is
 * about the session, not about their data.
 *
 * Deletion rather than soft-deletion, deliberately. A retention rule that hides rows instead of
 * removing them satisfies the letter of "expire" while leaving the data exactly where it was, which
 * is the failure mode §5.2 is written against.
 *
 * This comment used to say "the cascades do the rest: removing a session removes its organisation".
 * They do not, and the cascade runs the other way — `guest_sessions.organization_id` is ON DELETE
 * CASCADE, so deleting the *organisation* deletes the session. The sweep now removes each of them by
 * name, in an order that leaves nothing pointing at anything, and the audit events with them: those
 * are ON DELETE RESTRICT and were quietly making the whole sweep impossible.
 */
async function purge(db: PooledDatabase): Promise<void> {
  const { sessionsDeleted, projectsDeleted, auditEventsDeleted, sessionsFailed } =
    await purgeExpiredGuestSessions(db);

  // Each guest is deleted in its own transaction, so one that cannot be deleted no longer stops the
  // rest — but it must still be seen, or guest data outlives its stated expiry in silence.
  if (sessionsFailed > 0) {
    logger.error('expired guest sessions could not be purged', { sessionsFailed });
  }

  // Logged only when something happened. A line every minute saying "deleted nothing" is a line
  // nobody reads, and it would bury the one that matters.
  if (sessionsDeleted > 0 || projectsDeleted > 0) {
    logger.info('expired guest data purged', {
      sessionsDeleted,
      projectsDeleted,
      auditEventsDeleted,
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Draining                                                                   */
/* -------------------------------------------------------------------------- */

async function runDrain(db: PooledDatabase, env: Env): Promise<void> {
  const queue = env.OUTBOX_QUEUE;

  // No queue, no drain: claiming rows with nowhere to publish them would burn their attempts.
  if (queue === undefined) return;

  const { published, deadLettered } = await drain(db, async (message) => {
    await queue.send(message);
  });

  if (published > 0) {
    logger.info('outbox drained', { published, environment: env.APP_ENV });
  }

  if (deadLettered.length > 0) {
    /*
     * Logged at error, not warn.
     *
     * A dead-lettered outbox row is a committed change whose consequences never happened, and the
     * change itself succeeded — so nothing else in the system will ever report it. This log line is
     * the only place that fact appears.
     */
    logger.error('outbox events dead-lettered', { count: deadLettered.length, ids: deadLettered });
  }
}

/* -------------------------------------------------------------------------- */
/* Consuming                                                                  */
/* -------------------------------------------------------------------------- */

async function handle(db: PooledDatabase, message: Message<OutboxMessage>): Promise<void> {
  const { id, eventType, correlationId } = message.body;

  try {
    /*
     * Read the row before doing anything.
     *
     * The message carries an id; the row carries the truth. If the row is already processed this is a
     * redelivery — which Queues guarantees will happen — and the correct response is to acknowledge
     * and do nothing rather than perform the effect twice.
     */
    const rows = await db
      .select()
      .from(outboxEvents)
      .where(and(eq(outboxEvents.id, id), isNull(outboxEvents.processedAt)))
      .limit(1);

    const row = rows[0];

    if (row === undefined) {
      // Already processed, or deleted with its project. Both are fine and neither is an error.
      message.ack();
      return;
    }

    await perform(row.eventType, row.payload);

    await db
      .update(outboxEvents)
      .set({ processedAt: new Date(), lastErrorCode: null })
      .where(eq(outboxEvents.id, id));

    message.ack();
  } catch (error) {
    const code = errorCodeOf(error);
    const attempts = message.attempts;
    const outcome = classify(code, attempts);

    await db
      .update(outboxEvents)
      .set({
        lastErrorCode: code,
        deadLettered: outcome === 'FAILED_TERMINAL',
      })
      .where(eq(outboxEvents.id, id));

    logger.error('outbox event failed', { id, eventType, correlationId, code, outcome, attempts });

    if (outcome === 'FAILED_TERMINAL') {
      /*
       * Acknowledged despite failing.
       *
       * A terminal failure will fail identically on every retry, and retrying it occupies a consumer
       * and produces an alert per attempt until somebody turns the alerting off — taking the real
       * alerts with it. The row is marked dead-lettered, which is where a person finds it.
       */
      message.ack();
      return;
    }

    message.retry();
  }
}

/**
 * Perform the side effect.
 *
 * Deliberately exhaustive over the event types the schema records, with no default. An unrecognised
 * event is a terminal failure rather than a silent success: a row marked processed without its effect
 * having happened is indistinguishable afterwards from one where it did.
 */
/*
 * The signature is the contract, not the current body.
 *
 * Every real handler added here will await a transport, and narrowing this to synchronous now would
 * mean widening it back the moment one exists — which would ripple through the consumer and the
 * batch loop for no gain.
 */
// eslint-disable-next-line @typescript-eslint/require-await
async function perform(eventType: string, payload: Record<string, unknown>): Promise<void> {
  switch (eventType) {
    case 'PROJECT_VERSION_CREATED':
    case 'GATE_CHANGED':
    case 'APPROVAL_GRANTED':
    case 'CHANGE_REQUEST_APPLIED':
    case 'DEPLOYMENT_RECORDED':
      /*
       * V1 has no notification transport and no integrations — every one is `PLANNED` (§44), and the
       * platform says so rather than pretending otherwise.
       *
       * So the effect is: recalculate nothing, notify nobody, and mark the row processed. That is
       * honest and it is not a stub in the pejorative sense — the outbox's guarantee is that the row
       * survives until something can act on it, and this is the point where that something gets
       * added.
       */
      logger.info('outbox event handled', { eventType, keys: Object.keys(payload).sort() });
      return;

    default:
      throw new UnrecognisedEvent(eventType);
  }
}

class UnrecognisedEvent extends Error {
  constructor(eventType: string) {
    super(`No handler for outbox event type ${eventType}`);
    this.name = 'UnrecognisedEvent';
  }
}

/**
 * Map a thrown value onto a code `classify` understands.
 *
 * Codes rather than messages, because §46 stores a code and a message carries data — frequently the
 * data that caused the failure, which is the last thing that should reach a log line.
 */
function errorCodeOf(error: unknown): string {
  if (error instanceof UnrecognisedEvent) return 'UNRECOGNISED_EVENT';

  const message = error instanceof Error ? error.message.toLowerCase() : '';

  if (message.includes('timeout') || message.includes('etimedout')) return 'TIMEOUT';
  if (message.includes('econnrefused')) return 'CONNECTION_REFUSED';
  if (message.includes('deadlock') || message.includes('could not serialize')) {
    return 'SERIALIZATION_FAILURE';
  }

  /*
   * Anything unrecognised is terminal, because `classify` treats it that way.
   *
   * That direction is deliberate: defaulting to retryable means every unrecognised error — which is
   * exactly the set most likely to be a genuine bug — retries to exhaustion before anybody looks.
   */
  return 'UNKNOWN';
}
