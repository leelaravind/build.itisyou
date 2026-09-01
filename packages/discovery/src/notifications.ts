/**
 * Notifications.
 *
 * §43 lists eight types and then says: *"Avoid excessive low-value notifications."*
 *
 * That instruction is usually treated as a tuning problem — send fewer, batch them, add a preference
 * screen. It is not. It is a *correctness* problem, because the failure it describes is not
 * annoyance: a person who receives forty notifications a day mutes the channel, and from that moment
 * the one notification that mattered does not reach them either. Every low-value notification spends
 * some of the credibility the important ones depend on.
 *
 * So the design here is restrictive by construction:
 *
 * - **The eight types are the whole set.** Nothing else generates a notification. Adding a ninth is a
 *   decision somebody has to make in this file, not a side effect of adding a feature.
 * - **Every notification names something the recipient can do.** A notification about a state a
 *   person cannot change is news, and news belongs on a page they choose to open.
 * - **Nobody is notified about their own action.** They were there.
 * - **Repeats coalesce.** Four notifications about one failing gate is one fact, delivered four
 *   times, and the fourth is what teaches somebody to stop reading.
 *
 * Contract: gap-spec §43.
 */

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

/** §43's eight, in the order it names them. */
export const NOTIFICATION_TYPES = [
  'ASSIGNMENT',
  'APPROVAL_REQUIRED',
  'GATE_FAILED',
  'BLOCKER_CREATED',
  'MILESTONE_APPROACHING',
  'CHANGE_REQUEST',
  'PROJECT_EXCEPTION',
  'SECURITY_RELEASE_BLOCKER',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface TypeSpec {
  /** What the recipient is expected to do about it. */
  readonly action: string;
  /**
   * Whether this reaches somebody outside working hours.
   *
   * Only two do. Waking somebody for anything else spends credibility that the two real cases need,
   * and a channel that wakes people needlessly is a channel people turn off.
   */
  readonly urgent: boolean;
  /** How repeats of the same subject are handled. */
  readonly coalesce: 'REPLACE' | 'SUPPRESS' | 'ALWAYS';
}

export const TYPE_SPEC: Readonly<Record<NotificationType, TypeSpec>> = {
  ASSIGNMENT: {
    action: 'Somebody gave you a piece of work. Look at it and say whether you can do it.',
    urgent: false,
    // Replace: the newest assignment for a subject supersedes an older one, and being told twice
    // that the same task is yours is one fact delivered twice.
    coalesce: 'REPLACE',
  },
  APPROVAL_REQUIRED: {
    action: 'Somebody is waiting on your decision, and nothing moves until you make it.',
    urgent: false,
    coalesce: 'REPLACE',
  },
  GATE_FAILED: {
    action: 'A gate that was passing is now failing. Something changed that broke it.',
    urgent: false,
    /*
     * Suppress: one failing gate is one fact. Re-notifying on every subsequent evaluation is how a
     * useful signal becomes a filter rule in somebody's inbox.
     */
    coalesce: 'SUPPRESS',
  },
  BLOCKER_CREATED: {
    action: 'Work you own cannot continue. Somebody has to unblock it or re-plan around it.',
    urgent: false,
    coalesce: 'REPLACE',
  },
  MILESTONE_APPROACHING: {
    action: 'A date you own is close and the work behind it is not finished.',
    urgent: false,
    // Suppress: a milestone approaches once. Daily reminders are a countdown, and a countdown is
    // pressure rather than information.
    coalesce: 'SUPPRESS',
  },
  CHANGE_REQUEST: {
    action:
      'Somebody wants to change something you are responsible for. Read the impact and decide.',
    urgent: false,
    coalesce: 'ALWAYS',
  },
  PROJECT_EXCEPTION: {
    action: 'Somebody accepted a shortfall on a project you own. You are the reviewer of that.',
    urgent: false,
    coalesce: 'ALWAYS',
  },
  SECURITY_RELEASE_BLOCKER: {
    action: 'A security finding is blocking a release. It needs resolving or explicitly accepting.',
    /*
     * One of the two urgent cases, and the reason is not that security is more important in the
     * abstract — it is that this one is time-bound. A release is either going out or being held, and
     * the decision is being made now with or without the recipient.
     */
    urgent: true,
    coalesce: 'ALWAYS',
  },
};

/* -------------------------------------------------------------------------- */
/* Notifications                                                              */
/* -------------------------------------------------------------------------- */

export interface Notification {
  readonly id: string;
  readonly type: NotificationType;
  readonly recipientId: string;
  readonly projectId: string;
  /** What it is about. Used for coalescing. */
  readonly subjectId: string;
  readonly summary: string;
  /** Who caused it. Compared against the recipient — nobody is notified about their own action. */
  readonly actorId: string;
  readonly at: string;
  readonly read: boolean;
}

export const NOTIFICATION_REFUSALS = [
  'NOT_A_RECOGNISED_TYPE',
  'SELF_NOTIFICATION',
  'NO_RECIPIENT',
  'ALREADY_NOTIFIED',
] as const;

export type NotificationRefusal = (typeof NOTIFICATION_REFUSALS)[number];

export type Result =
  | { readonly ok: true; readonly notification: Notification; readonly replaced?: string }
  | { readonly ok: false; readonly refusal: NotificationRefusal; readonly reason: string };

/**
 * Decide whether to deliver a notification.
 *
 * Returns a refusal rather than silently dropping, so a caller can tell "we chose not to send this"
 * from "the send failed" — those need different responses, and a silent drop makes them identical.
 */
export function deliver(existing: readonly Notification[], candidate: Notification): Result {
  if (!NOTIFICATION_TYPES.includes(candidate.type)) {
    return {
      ok: false,
      refusal: 'NOT_A_RECOGNISED_TYPE',
      reason:
        'The eight types are the whole set. Adding a ninth is a decision somebody makes deliberately, not a side effect of adding a feature — which is how a notification channel becomes noise.',
    };
  }

  if (candidate.recipientId.trim() === '') {
    return {
      ok: false,
      refusal: 'NO_RECIPIENT',
      reason: 'A notification addressed to nobody is a log line, and it belongs in the log.',
    };
  }

  if (candidate.recipientId === candidate.actorId) {
    /*
     * They were there.
     *
     * This is the single largest source of low-value notifications in most systems, because the
     * easiest implementation notifies everybody watching a thing including whoever just touched it.
     */
    return {
      ok: false,
      refusal: 'SELF_NOTIFICATION',
      reason:
        'They did it. Telling somebody what they just did is the largest single source of notification noise, and it is the one nobody defends once it is pointed out.',
    };
  }

  const spec = TYPE_SPEC[candidate.type];

  const prior = existing.filter(
    (n) =>
      n.recipientId === candidate.recipientId &&
      n.type === candidate.type &&
      n.subjectId === candidate.subjectId,
  );

  if (prior.length > 0 && spec.coalesce === 'SUPPRESS') {
    return {
      ok: false,
      refusal: 'ALREADY_NOTIFIED',
      reason:
        'They already know. One failing gate is one fact, and re-sending it on every evaluation is how a useful signal becomes a filter rule in somebody’s inbox.',
    };
  }

  if (prior.length > 0 && spec.coalesce === 'REPLACE') {
    // Replace the unread one rather than adding beside it. Two entries about the same subject make a
    // list look busier than the situation is.
    const replaceable = prior.find((n) => !n.read);

    return replaceable === undefined
      ? { ok: true, notification: candidate }
      : { ok: true, notification: candidate, replaced: replaceable.id };
  }

  return { ok: true, notification: candidate };
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

export interface Inbox {
  readonly unread: readonly Notification[];
  readonly read: readonly Notification[];
  /** Urgent and unread. The subset worth interrupting somebody for. */
  readonly urgent: readonly Notification[];
  readonly headline: string;
}

/**
 * Group a recipient's notifications.
 *
 * Unread first and urgent named separately, because an inbox sorted purely by time buries the one
 * thing that needed acting on under everything that arrived after it.
 */
export function inboxFor(notifications: readonly Notification[], recipientId: string): Inbox {
  const mine = notifications
    .filter((n) => n.recipientId === recipientId)
    // Newest first within each group, with a stable tie-break so two runs agree.
    .sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));

  const unread = mine.filter((n) => !n.read);
  const read = mine.filter((n) => n.read);
  const urgent = unread.filter((n) => TYPE_SPEC[n.type].urgent);

  return {
    unread,
    read,
    urgent,
    headline: headlineFor(unread.length, urgent.length),
  };
}

function headlineFor(unread: number, urgent: number): string {
  if (unread === 0) return 'Nothing waiting on you.';

  if (urgent > 0) {
    // Named separately rather than folded into the total. "12 unread" and "12 unread, one of which
    // is blocking a release" are different messages, and only one of them gets read today.
    return `${String(urgent)} needing attention now, ${String(unread)} unread in total.`;
  }

  return `${String(unread)} unread.`;
}

/** Mark one as read. Returns the list unchanged when it was already read, so callers can detect a no-op. */
export function markRead(
  notifications: readonly Notification[],
  id: string,
): readonly Notification[] {
  return notifications.map((n) => (n.id === id ? { ...n, read: true } : n));
}

/* -------------------------------------------------------------------------- */
/* Checks                                                                     */
/* -------------------------------------------------------------------------- */

export const NOTIFICATION_DEFECTS = ['NO_ACTION', 'TOO_MANY_URGENT'] as const;

export type NotificationDefect = (typeof NOTIFICATION_DEFECTS)[number];

export interface NotificationFinding {
  readonly defect: NotificationDefect;
  readonly summary: string;
  readonly why: string;
}

/**
 * Whether the catalogue keeps its own promise.
 *
 * The urgent count is checked with a hard ceiling, which is unusual and deliberate: the way a
 * notification system decays is that each new type is individually defensible as urgent, and nobody
 * ever compares the total against what a person can absorb.
 */
export function checkTypes(): readonly NotificationFinding[] {
  const findings: NotificationFinding[] = [];

  for (const type of NOTIFICATION_TYPES) {
    if (TYPE_SPEC[type].action.trim() === '') {
      findings.push({
        defect: 'NO_ACTION',
        summary: `${type} does not say what the recipient should do.`,
        why: 'A notification about something the recipient cannot act on is news, and news belongs on a page somebody chooses to open rather than in a channel that interrupts them.',
      });
    }
  }

  const urgent = NOTIFICATION_TYPES.filter((type) => TYPE_SPEC[type].urgent);

  if (urgent.length > 2) {
    findings.push({
      defect: 'TOO_MANY_URGENT',
      summary: `${String(urgent.length)} of ${String(NOTIFICATION_TYPES.length)} types are urgent.`,
      why: 'Each new urgent type is individually defensible, and nobody ever compares the total against what a person can absorb. Past a couple, urgency stops meaning anything and the channel gets muted — taking the genuinely urgent ones with it.',
    });
  }

  return findings;
}
