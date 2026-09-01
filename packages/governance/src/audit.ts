/**
 * The audit log.
 *
 * §40 is four lines: append, query and retention are allowed; updating an event and deleting an
 * individual event through the product are not; and "if legal deletion requires special handling,
 * document the strategy".
 *
 * The first thing to say is that this module enforces that by **not having the functions**. There is
 * no `update`, no `delete`, and no way to construct one from what is exported. A guard that throws is
 * a decision somebody can reverse in a hurry at two in the morning; an absent function is a decision
 * somebody has to notice they are reversing.
 *
 * The second is the legal-deletion strategy, which §40 asks to be documented rather than avoided.
 * The requirement is real — a subject access deletion request can cover personal data that ended up
 * in an audit payload — and the naive implementation is to delete the row, which destroys the
 * sequence and makes the log unable to prove anything about what happened around it.
 *
 * The strategy here is **redaction, not deletion**: the event keeps its id, its position, its
 * timestamp, its actor and its kind, and its payload is replaced by a tombstone recording that a
 * redaction happened, when, and under what authority. Anyone reading the log later sees that
 * something was removed and why, which is strictly more truthful than a gap.
 *
 * Contract: gap-spec §40, §37 (privacy), §38 (retention).
 */

/* -------------------------------------------------------------------------- */
/* Events                                                                     */
/* -------------------------------------------------------------------------- */

export const AUDIT_CATEGORIES = [
  'AUTHENTICATION',
  'AUTHORISATION',
  'PROJECT_CHANGE',
  'APPROVAL',
  'BASELINE',
  'EVIDENCE',
  'DOCUMENT',
  'DEPLOYMENT',
  'CONFIGURATION',
  'DATA_EXPORT',
  'RETENTION',
] as const;

export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export interface AuditEvent {
  /** Never reissued. A reference to an event id always resolves to the same event or to nothing. */
  readonly id: string;
  readonly projectId: string;
  readonly category: AuditCategory;
  /** What happened, in the system's terms. */
  readonly action: string;
  /** What it happened to. */
  readonly subjectId: string;
  /**
   * Who did it.
   *
   * `system` is a legitimate value and is written as such rather than left blank — an empty actor and
   * an automated one are different, and a log that cannot distinguish them cannot answer "did a
   * person do this".
   */
  readonly actor: string;
  readonly at: string;
  /** Ties this to every other event in the same request. */
  readonly correlationId: string;
  /**
   * Monotonic within a project. The sequence is what makes the log evidence about *order*, which is
   * usually the question being asked.
   */
  readonly sequence: number;
  readonly payload: Readonly<Record<string, unknown>>;
  /** Present only on a redacted event. */
  readonly redaction?: Redaction;
}

export interface Redaction {
  readonly redactedAt: string;
  readonly redactedBy: string;
  /** The legal or policy basis. A redaction with no authority is a deletion with extra steps. */
  readonly authority: string;
  /** Which payload keys were removed, so a reader knows what kind of thing is missing. */
  readonly removedKeys: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* Appending                                                                  */
/* -------------------------------------------------------------------------- */

export interface NewAuditEvent {
  readonly projectId: string;
  readonly category: AuditCategory;
  readonly action: string;
  readonly subjectId: string;
  readonly actor: string;
  readonly at: string;
  readonly correlationId: string;
  readonly payload?: Readonly<Record<string, unknown>>;
}

/**
 * Append an event to a log.
 *
 * Takes the existing log and returns a new one. This module holds no state and performs no I/O: the
 * caller writes, inside whatever transaction the change belongs to, which is what makes "the audit
 * event and the change it describes either both happen or neither does" achievable at all.
 *
 * The sequence is derived from the log rather than supplied, so a caller cannot produce two events
 * claiming the same position — which would make the log's ordering unusable exactly where it matters.
 */
export function append(log: readonly AuditEvent[], event: NewAuditEvent, id: string): AuditEvent {
  const last = log[log.length - 1];

  return {
    id,
    projectId: event.projectId,
    category: event.category,
    action: event.action,
    subjectId: event.subjectId,
    actor: event.actor.trim() === '' ? 'unknown' : event.actor,
    at: event.at,
    correlationId: event.correlationId,
    sequence: (last?.sequence ?? 0) + 1,
    payload: event.payload ?? {},
  };
}

/* -------------------------------------------------------------------------- */
/* Redaction — §40's "special handling"                                       */
/* -------------------------------------------------------------------------- */

export const REDACTION_REFUSALS = ['ALREADY_REDACTED', 'NO_AUTHORITY', 'NO_ACTOR'] as const;

export type RedactionRefusal = (typeof REDACTION_REFUSALS)[number];

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refusal: RedactionRefusal; readonly reason: string };

export interface RedactionRequest {
  readonly redactedBy: string;
  readonly at: string;
  /** The legal or policy basis. Mandatory. */
  readonly authority: string;
  /** Payload keys to remove. Everything else is retained. */
  readonly keys: readonly string[];
}

/**
 * Remove payload content while preserving the event.
 *
 * §40's documented strategy for legal deletion. What survives is deliberate: the id, the position in
 * the sequence, the timestamp, the actor, the category and the action. What goes is the payload keys
 * named, replaced by a record that they were removed, by whom, and under what authority.
 *
 * A reader of the log sees an event that happened, in its place, with a note saying part of it was
 * removed. That is strictly more truthful than a gap — a missing row cannot be distinguished from a
 * row that was never written, and a log with unexplained gaps proves nothing about anything near
 * them.
 *
 * The redaction is itself an auditable act, and `redactionEvent` produces the event recording it.
 */
export function redact(event: AuditEvent, request: RedactionRequest): Result<AuditEvent> {
  if (event.redaction !== undefined) {
    return {
      ok: false,
      refusal: 'ALREADY_REDACTED',
      reason:
        'This event has already been redacted. Redacting again would overwrite the record of the first redaction, which is the one thing a second redaction must not do.',
    };
  }

  if (request.authority.trim() === '') {
    return {
      ok: false,
      refusal: 'NO_AUTHORITY',
      reason:
        'A redaction with no recorded authority is a deletion with extra steps. The basis is what distinguishes a lawful erasure from somebody removing an inconvenient record.',
    };
  }

  if (request.redactedBy.trim() === '') {
    return {
      ok: false,
      refusal: 'NO_ACTOR',
      reason:
        'A redaction nobody performed cannot be asked about, which defeats the point of keeping the event.',
    };
  }

  const payload: Record<string, unknown> = {};
  const removed: string[] = [];

  for (const [key, value] of Object.entries(event.payload)) {
    if (request.keys.includes(key)) {
      removed.push(key);
      continue;
    }

    payload[key] = value;
  }

  return {
    ok: true,
    value: {
      ...event,
      payload,
      redaction: {
        redactedAt: request.at,
        redactedBy: request.redactedBy,
        authority: request.authority,
        // Sorted, so two redactions of the same keys record them identically.
        removedKeys: removed.sort(),
      },
    },
  };
}

/** The audit event recording that a redaction happened. A redaction is itself an auditable act. */
export function redactionEvent(redacted: AuditEvent, request: RedactionRequest): NewAuditEvent {
  return {
    projectId: redacted.projectId,
    category: 'RETENTION',
    action: 'AUDIT_EVENT_REDACTED',
    subjectId: redacted.id,
    actor: request.redactedBy,
    at: request.at,
    correlationId: redacted.correlationId,
    payload: {
      authority: request.authority,
      removedKeys: [...request.keys].sort(),
      originalSequence: redacted.sequence,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Verification                                                               */
/* -------------------------------------------------------------------------- */

export const LOG_DEFECTS = [
  'SEQUENCE_GAP',
  'SEQUENCE_DUPLICATE',
  'OUT_OF_ORDER',
  'MISSING_ACTOR',
  'REDACTION_WITHOUT_AUTHORITY',
] as const;

export type LogDefect = (typeof LOG_DEFECTS)[number];

export interface LogFinding {
  readonly defect: LogDefect;
  readonly eventId: string;
  readonly summary: string;
  readonly why: string;
}

/**
 * Check a log for the shapes that mean it can no longer be relied on.
 *
 * This is the audit *of* the audit, and the Phase-13 gate names it. A log nobody checks is a log that
 * has been silently broken for an unknown length of time — and the specific problem with audit logs
 * is that the damage is invisible from inside: every individual event looks fine, and only the
 * sequence reveals that one is missing.
 *
 * A gap is the important one. It means an event was deleted, or never written, and either way the
 * log's claim about what happened is incomplete in a way nothing else would reveal.
 */
export function verifyLog(log: readonly AuditEvent[]): readonly LogFinding[] {
  const findings: LogFinding[] = [];
  const seen = new Set<number>();

  let previousSequence = 0;
  let previousAt = '';

  for (const event of log) {
    if (seen.has(event.sequence)) {
      findings.push({
        defect: 'SEQUENCE_DUPLICATE',
        eventId: event.id,
        summary: `Two events claim sequence ${String(event.sequence)}.`,
        why: 'The order of these two events is unrecoverable, and order is usually the question being asked of an audit log.',
      });
    }

    seen.add(event.sequence);

    if (event.sequence > previousSequence + 1 && previousSequence !== 0) {
      findings.push({
        defect: 'SEQUENCE_GAP',
        eventId: event.id,
        summary: `Sequence jumps from ${String(previousSequence)} to ${String(event.sequence)}.`,
        why: 'An event was deleted or never written. Either way the log is incomplete in a way nothing else would reveal — every individual event still looks correct, and only the sequence shows one is missing.',
      });
    }

    if (previousAt !== '' && event.at < previousAt) {
      findings.push({
        defect: 'OUT_OF_ORDER',
        eventId: event.id,
        summary: `Recorded at ${event.at}, before the event that precedes it in sequence.`,
        why: 'Either a clock moved or events were written out of order. Until it is explained, no timing claim based on this log can be relied on.',
      });
    }

    if (event.actor.trim() === '') {
      findings.push({
        defect: 'MISSING_ACTOR',
        eventId: event.id,
        summary: 'No actor recorded.',
        why: 'The log cannot answer whether a person did this, which is the question asked of an audit log more often than any other.',
      });
    }

    if (event.redaction?.authority.trim() === '') {
      findings.push({
        defect: 'REDACTION_WITHOUT_AUTHORITY',
        eventId: event.id,
        summary: 'Redacted with no recorded authority.',
        why: 'A redaction with no basis is indistinguishable from somebody removing an inconvenient record.',
      });
    }

    previousSequence = event.sequence;
    previousAt = event.at;
  }

  return findings;
}

/**
 * Events matching a filter, in sequence order.
 *
 * Querying is one of the three things §40 permits, and it is worth having here rather than only in
 * the database layer: the ordering guarantee belongs with the model that defines the sequence.
 */
export function query(
  log: readonly AuditEvent[],
  filter: {
    readonly category?: AuditCategory;
    readonly subjectId?: string;
    readonly actor?: string;
    readonly since?: string;
  },
): readonly AuditEvent[] {
  return log
    .filter((event) => {
      if (filter.category !== undefined && event.category !== filter.category) return false;
      if (filter.subjectId !== undefined && event.subjectId !== filter.subjectId) return false;
      if (filter.actor !== undefined && event.actor !== filter.actor) return false;
      if (filter.since !== undefined && event.at < filter.since) return false;
      return true;
    })
    .sort((a, b) => a.sequence - b.sequence);
}
