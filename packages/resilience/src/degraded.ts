/**
 * Degraded mode.
 *
 * §52 is short and contains one instruction that decides everything:
 *
 * > If DB is unavailable: fail safely, **do not show stale mutation success**.
 *
 * That second clause is the whole module. The tempting behaviour when a write fails is to keep the
 * optimistic UI update — the user typed something, the screen shows it, the request failed
 * afterwards. It looks like resilience and it is the worst available outcome: the person believes
 * their change is saved, acts on that belief, and finds out it was not at the moment they are relying
 * on it hardest.
 *
 * A read failing is an inconvenience. A write *appearing* to succeed is a lie the system told about
 * its own state, and there is no acceptable amount of it.
 *
 * The rest of §52 is a graceful-degradation ladder: a non-critical subsystem going down should not
 * take core project reading with it. That is genuinely worth building, and the way it goes wrong is
 * the opposite mistake — a page that renders happily while silently omitting a section, so the reader
 * cannot tell "nothing here" from "we could not look".
 *
 * Contract: gap-spec §52, §51 (recovery targets), §55 (error taxonomy).
 */

/* -------------------------------------------------------------------------- */
/* Subsystems                                                                 */
/* -------------------------------------------------------------------------- */

export const SUBSYSTEMS = [
  'DATABASE',
  'SEARCH',
  'QUEUE',
  'INTEGRATIONS',
  'OBJECT_STORAGE',
] as const;

export type Subsystem = (typeof SUBSYSTEMS)[number];

export interface SubsystemSpec {
  /**
   * Whether the product can serve anything useful without it.
   *
   * Only the database is critical. That is not an accident of implementation: everything this
   * platform claims to know is in the graph, and without the graph there is nothing to be right or
   * wrong about.
   */
  readonly critical: boolean;
  /** What still works when this is down. */
  readonly stillWorks: string;
  /** What the user is told. Written as a fact about the system, not an apology. */
  readonly tellsTheUser: string;
}

export const SUBSYSTEM_SPEC: Readonly<Record<Subsystem, SubsystemSpec>> = {
  DATABASE: {
    critical: true,
    stillWorks: 'Nothing that depends on project data. Static pages still render.',
    tellsTheUser:
      'The project store is unavailable, so nothing can be read or saved right now. Nothing you have done has been lost — it was not accepted in the first place.',
  },
  SEARCH: {
    critical: false,
    stillWorks: 'Everything except finding things by typing. Every page remains reachable by link.',
    tellsTheUser: 'Search is unavailable. Everything is still reachable by navigating to it.',
  },
  QUEUE: {
    critical: false,
    /*
     * Reads and writes both continue.
     *
     * The outbox is what makes that safe: a change commits with its side effects recorded in the same
     * transaction, so the work is not lost, only delayed. Without an outbox this would have to be
     * critical, because the alternative is accepting changes whose consequences never happen.
     */
    stillWorks:
      'Reading and changing the project. Side effects are recorded and will run when the queue returns.',
    tellsTheUser:
      'Background work is delayed. Your changes are saved and their follow-up actions are queued rather than lost.',
  },
  INTEGRATIONS: {
    critical: false,
    stillWorks: 'Everything. No integration is connected in V1, so nothing depends on one.',
    tellsTheUser: 'An integration is unavailable. Nothing in the project depends on it.',
  },
  OBJECT_STORAGE: {
    critical: false,
    stillWorks:
      'Everything except uploading and downloading evidence. Evidence records remain readable.',
    tellsTheUser:
      'Evidence files cannot be uploaded or downloaded. The records of what exists are still readable, and nothing has been deleted.',
  },
};

/* -------------------------------------------------------------------------- */
/* Modes                                                                      */
/* -------------------------------------------------------------------------- */

export const MODES = ['NORMAL', 'DEGRADED', 'READ_ONLY', 'UNAVAILABLE'] as const;

export type Mode = (typeof MODES)[number];

export const MODE_MEANING: Readonly<Record<Mode, string>> = {
  NORMAL: 'Everything works.',
  DEGRADED: 'Something non-critical is down. Reading and writing the project still work.',
  READ_ONLY:
    'The project can be read and not changed. Every control that would change something is disabled, and none of them pretends otherwise.',
  UNAVAILABLE: 'Nothing that depends on project data can be served.',
};

export interface Health {
  /** Subsystems currently believed to be down. */
  readonly down: readonly Subsystem[];
  /** Whether writes are being refused for a reason other than a subsystem being down. */
  readonly writesSuspended?: boolean;
}

/**
 * The mode the product is in.
 *
 * A single function so that every surface answers this the same way. Two pages disagreeing about
 * whether the system is read-only is how a "save" button survives on one of them.
 */
export function modeFor(health: Health): Mode {
  if (health.down.includes('DATABASE')) return 'UNAVAILABLE';
  if (health.writesSuspended === true) return 'READ_ONLY';
  if (health.down.length > 0) return 'DEGRADED';
  return 'NORMAL';
}

/**
 * Whether a mutation may be attempted.
 *
 * The gate that stops §52's forbidden outcome. A caller that checks this before attempting a write
 * cannot produce a stale success, because it never starts the write it would have had to lie about.
 */
export function mayMutate(mode: Mode): boolean {
  return mode === 'NORMAL' || mode === 'DEGRADED';
}

/* -------------------------------------------------------------------------- */
/* Mutation outcomes                                                          */
/* -------------------------------------------------------------------------- */

export const MUTATION_OUTCOMES = ['ACCEPTED', 'REFUSED', 'UNKNOWN'] as const;

export type MutationOutcome = (typeof MUTATION_OUTCOMES)[number];

export interface MutationResult {
  readonly outcome: MutationOutcome;
  /** What the user is told. Never optimistic, and never ambiguous about whether the change happened. */
  readonly message: string;
  /** Whether it is safe to retry. Depends on idempotency, not on hope. */
  readonly safeToRetry: boolean;
}

/**
 * Decide what to tell a user about a mutation.
 *
 * `UNKNOWN` is the state that makes this honest, and it is the one most systems do not have. A
 * request that timed out *after* being sent may or may not have been applied. Reporting it as failed
 * is a lie in one direction and reporting it as succeeded is a lie in the other — and the user's
 * correct next action differs between them.
 *
 * With an idempotency key, retrying an unknown is safe, and saying so turns an unanswerable question
 * into an instruction.
 */
export function describeMutation(
  mode: Mode,
  attempted: boolean,
  timedOut: boolean,
  hasIdempotencyKey: boolean,
): MutationResult {
  if (!mayMutate(mode)) {
    /*
     * Refused before being attempted, which is the safest possible failure: nothing reached the
     * database, so there is nothing to be uncertain about.
     */
    return {
      outcome: 'REFUSED',
      message: `${MODE_MEANING[mode]} Your change was not made, and nothing about it has been recorded.`,
      safeToRetry: true,
    };
  }

  if (!attempted) {
    return {
      outcome: 'REFUSED',
      message: 'The change was not sent.',
      safeToRetry: true,
    };
  }

  if (timedOut) {
    return {
      outcome: 'UNKNOWN',
      message: hasIdempotencyKey
        ? 'The change was sent and no answer came back, so it may or may not have been applied. Trying again is safe — a repeat of the same change is recognised as the same change rather than made twice.'
        : 'The change was sent and no answer came back, so it may or may not have been applied. Reload before trying again: without an idempotency key a second attempt could apply it twice.',
      safeToRetry: hasIdempotencyKey,
    };
  }

  return {
    outcome: 'ACCEPTED',
    message: 'Saved.',
    safeToRetry: false,
  };
}

/* -------------------------------------------------------------------------- */
/* Omissions                                                                  */
/* -------------------------------------------------------------------------- */

export interface Omission {
  readonly section: string;
  readonly because: Subsystem;
  readonly message: string;
}

/**
 * What a page must say about a section it could not load.
 *
 * The failure mode on the other side of degradation: a page that renders happily while silently
 * omitting a section, so the reader cannot tell "nothing here" from "we could not look".
 *
 * This platform makes that distinction everywhere else — an empty traceability report says whether it
 * is empty or unassessed, a portfolio says whether the organisation is empty or the view is partial —
 * and a subsystem outage must not be the one place it stops.
 */
export function omissionFor(section: string, subsystem: Subsystem): Omission {
  return {
    section,
    because: subsystem,
    message: `${section} could not be loaded: ${SUBSYSTEM_SPEC[subsystem].tellsTheUser} This section is missing rather than empty, and the difference matters.`,
  };
}

/* -------------------------------------------------------------------------- */
/* Checks                                                                     */
/* -------------------------------------------------------------------------- */

export const DEGRADED_DEFECTS = [
  'OPTIMISTIC_SUCCESS',
  'MUTATION_ALLOWED_WHILE_READ_ONLY',
  'SILENT_OMISSION',
  'CRITICAL_SUBSYSTEM_TREATED_AS_OPTIONAL',
] as const;

export type DegradedDefect = (typeof DEGRADED_DEFECTS)[number];

export interface DegradedFinding {
  readonly defect: DegradedDefect;
  readonly summary: string;
  readonly why: string;
}

/**
 * Whether the model keeps §52's promise.
 *
 * The first check is the one that matters: no combination of inputs may produce `ACCEPTED` when the
 * system could not have applied the change. Asserting that over the whole input space is stronger
 * than testing the cases somebody thought of.
 */
export function checkDegradedModel(): readonly DegradedFinding[] {
  const findings: DegradedFinding[] = [];

  for (const mode of MODES) {
    for (const attempted of [true, false]) {
      for (const timedOut of [true, false]) {
        for (const idempotent of [true, false]) {
          const result = describeMutation(mode, attempted, timedOut, idempotent);

          const couldNotHaveApplied = !mayMutate(mode) || !attempted;

          if (result.outcome === 'ACCEPTED' && couldNotHaveApplied) {
            findings.push({
              defect: 'OPTIMISTIC_SUCCESS',
              summary: `A mutation reports success in ${mode} mode (attempted: ${String(attempted)}).`,
              why: '§52: do not show stale mutation success. The person believes their change is saved, acts on that belief, and finds out otherwise at the moment they are relying on it hardest.',
            });
          }

          if (result.outcome === 'ACCEPTED' && timedOut) {
            findings.push({
              defect: 'OPTIMISTIC_SUCCESS',
              summary: 'A timed-out mutation reports success.',
              why: 'A request that timed out after being sent may or may not have been applied. Claiming either is a lie, and the user’s correct next action differs between them.',
            });
          }
        }
      }
    }
  }

  if (mayMutate('READ_ONLY')) {
    findings.push({
      defect: 'MUTATION_ALLOWED_WHILE_READ_ONLY',
      summary: 'Mutations are permitted in read-only mode.',
      why: 'Read-only exists to make writes refuse before they are attempted, which is the safest failure available: nothing reaches the database, so there is nothing to be uncertain about afterwards.',
    });
  }

  if (!SUBSYSTEM_SPEC.DATABASE.critical) {
    findings.push({
      defect: 'CRITICAL_SUBSYSTEM_TREATED_AS_OPTIONAL',
      summary: 'The database is not marked critical.',
      why: 'Everything this platform claims to know is in the graph. Without it there is nothing to be right or wrong about, and serving pages that imply otherwise is worse than serving none.',
    });
  }

  return findings;
}
