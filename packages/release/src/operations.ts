/**
 * Operations: ownership, incidents, technical debt and handover.
 *
 * This covers the two gates nobody reaches in a demo and everybody reaches eventually — Operational
 * Readiness (§15.10) and Completion/Handover (§15.11).
 *
 * The unifying idea is that a project is not finished when it works; it is finished when somebody
 * else can keep it working. Every check here is a question about the day after the team leaves:
 * who is called, what are they told, what did they inherit that nobody mentioned.
 *
 * The most useful thing in this module is that **technical debt is recorded rather than resolved**.
 * A handover gate demanding zero debt would be failed by every real project, so it would be waived
 * every time, so it would stop being a gate. What it demands instead is that the debt is *written
 * down* — because undisclosed debt is the thing that makes a handover a betrayal rather than a
 * transfer.
 *
 * Contract: gap-spec §15.10, §15.11.
 */

/* -------------------------------------------------------------------------- */
/* Ownership                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The things that must have an owner before anyone walks away.
 *
 * Separate entries rather than one "owner" field, because they are genuinely different people in
 * most organisations, and a single field produces one name that is wrong for four of them.
 */
export const OWNERSHIP_AREAS = [
  'PRODUCT',
  'ENGINEERING',
  'OPERATIONS',
  'SECURITY',
  'DATA_PROTECTION',
  'CREDENTIALS',
] as const;

export type OwnershipArea = (typeof OWNERSHIP_AREAS)[number];

export const OWNERSHIP_MEANING: Readonly<Record<OwnershipArea, string>> = {
  PRODUCT: 'Who decides what it should do next, and who says no.',
  ENGINEERING: 'Who changes it, and who reviews the change.',
  OPERATIONS: 'Who is called when it stops working at three in the morning.',
  SECURITY: 'Who receives a vulnerability report, and who can act on one.',
  DATA_PROTECTION:
    'Who answers a subject access request. This one is a legal obligation with a clock on it, and it is the one most often left unassigned.',
  CREDENTIALS:
    'Who holds the administrative access. An unassigned credential is either lost or held by somebody who has left.',
};

export interface Ownership {
  readonly area: OwnershipArea;
  readonly owner: string;
  /** Whether the named person has acknowledged it. An owner who does not know is not an owner. */
  readonly accepted: boolean;
}

/* -------------------------------------------------------------------------- */
/* Incidents                                                                  */
/* -------------------------------------------------------------------------- */

export const INCIDENT_SEVERITIES = ['SEV1', 'SEV2', 'SEV3'] as const;

export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export const INCIDENT_STATES = ['OPEN', 'MITIGATED', 'RESOLVED', 'REVIEWED'] as const;

export type IncidentState = (typeof INCIDENT_STATES)[number];

/**
 * An incident.
 *
 * `REVIEWED` is a state beyond `RESOLVED` on purpose. Fixing the outage and understanding it are
 * different pieces of work, and the second is the one that gets skipped — a project whose incidents
 * are all "resolved" and none "reviewed" is one that has been fixing the same thing repeatedly
 * without noticing.
 */
export interface Incident {
  readonly id: string;
  readonly title: string;
  readonly severity: IncidentSeverity;
  readonly state: IncidentState;
  /** What actually caused it. Empty on anything but OPEN is a finding. */
  readonly cause?: string;
  /** Follow-up work ids. A review producing no actions has usually not finished. */
  readonly actions: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* Technical debt                                                             */
/* -------------------------------------------------------------------------- */

export const DEBT_KINDS = [
  'KNOWN_DEFECT',
  'MISSING_TEST',
  'UNSUPPORTED_DEPENDENCY',
  'MANUAL_PROCESS',
  'SHORTCUT',
  'UNDOCUMENTED_BEHAVIOUR',
  'SCALING_LIMIT',
] as const;

export type DebtKind = (typeof DEBT_KINDS)[number];

export interface TechnicalDebt {
  readonly id: string;
  readonly kind: DebtKind;
  readonly summary: string;
  /**
   * What it costs to leave, in terms of what will go wrong rather than a story-point number.
   *
   * The number is what makes debt registers useless: it invites prioritising by size instead of by
   * consequence, and the consequence is the only part anyone can act on.
   */
  readonly consequence: string;
  /** Whether the receiving team has been told. The whole point of the register. */
  readonly disclosed: boolean;
}

/* -------------------------------------------------------------------------- */
/* Checks                                                                     */
/* -------------------------------------------------------------------------- */

export const OPERATIONS_DEFECTS = [
  'UNOWNED_AREA',
  'OWNER_HAS_NOT_ACCEPTED',
  'INCIDENT_UNRESOLVED',
  'INCIDENT_UNREVIEWED',
  'INCIDENT_WITHOUT_CAUSE',
  'UNDISCLOSED_DEBT',
  'NO_DEBT_RECORDED',
] as const;

export type OperationsDefect = (typeof OPERATIONS_DEFECTS)[number];

export interface OperationsGap {
  readonly defect: OperationsDefect;
  readonly summary: string;
  readonly why: string;
  readonly evidence: readonly string[];
  readonly blocking: boolean;
}

export interface OperationsInput {
  readonly ownership: readonly Ownership[];
  readonly incidents: readonly Incident[];
  readonly debt: readonly TechnicalDebt[];
  /** Whether this is being checked for handover, which raises what counts as blocking. */
  readonly forHandover: boolean;
  /** Whether the project has produced any work at all, so the debt check is not applied to nothing. */
  readonly hasDeliveredWork: boolean;
}

export function checkOperations(input: OperationsInput): readonly OperationsGap[] {
  const gaps: OperationsGap[] = [];
  const owned = new Map(input.ownership.map((o) => [o.area, o]));

  for (const area of OWNERSHIP_AREAS) {
    const record = owned.get(area);

    if (record === undefined || record.owner.trim() === '') {
      gaps.push({
        defect: 'UNOWNED_AREA',
        summary: `Nobody owns ${area.toLowerCase().replace(/_/g, ' ')}.`,
        why: OWNERSHIP_MEANING[area],
        evidence: [`ownership:${area}`],
        blocking: input.forHandover,
      });
      continue;
    }

    if (!record.accepted) {
      gaps.push({
        defect: 'OWNER_HAS_NOT_ACCEPTED',
        summary: `${record.owner} is named for ${area.toLowerCase().replace(/_/g, ' ')} but has not accepted it.`,
        why: 'An owner who does not know they are the owner is not an owner. This is the most common way a handover looks complete on paper and fails on the first incident.',
        evidence: [`ownership:${area}`],
        blocking: false,
      });
    }
  }

  for (const incident of input.incidents) {
    if (incident.state === 'OPEN' || incident.state === 'MITIGATED') {
      gaps.push({
        defect: 'INCIDENT_UNRESOLVED',
        summary: `${incident.title} is ${incident.state.toLowerCase()}.`,
        why:
          incident.state === 'MITIGATED'
            ? 'Mitigated is not resolved. The symptom has stopped and the cause has not, which means it will happen again and the mitigation is now load-bearing without anyone deciding that.'
            : 'An open incident at a handover becomes somebody else’s open incident, without the context of whoever was working on it.',
        evidence: [incident.id],
        blocking: input.forHandover && incident.severity === 'SEV1',
      });
    }

    if (incident.state === 'RESOLVED') {
      gaps.push({
        defect: 'INCIDENT_UNREVIEWED',
        summary: `${incident.title} was resolved but never reviewed.`,
        why: 'Fixing an outage and understanding it are different work, and the second is the one that gets skipped. A project whose incidents are all resolved and none reviewed has been fixing the same thing repeatedly without noticing.',
        evidence: [incident.id],
        blocking: false,
      });
    }

    if (incident.state !== 'OPEN' && (incident.cause ?? '').trim() === '') {
      gaps.push({
        defect: 'INCIDENT_WITHOUT_CAUSE',
        summary: `${incident.title} is ${incident.state.toLowerCase()} with no cause recorded.`,
        why: 'Something changed and the symptom stopped. Without a recorded cause, nobody can tell whether the fix addressed the problem or moved it.',
        evidence: [incident.id],
        blocking: false,
      });
    }
  }

  for (const item of input.debt) {
    if (item.disclosed) continue;

    gaps.push({
      defect: 'UNDISCLOSED_DEBT',
      summary: `${item.summary} has not been disclosed.`,
      why: 'Undisclosed debt is what makes a handover a betrayal rather than a transfer. The receiving team will find it, and the only variable is whether they find it in a document or in production.',
      evidence: [item.id],
      blocking: input.forHandover,
    });
  }

  /*
   * An empty debt register on a project that has delivered work.
   *
   * Not a rule about how much debt is acceptable — that is not this module's business. It is that
   * zero recorded debt after real delivery means nobody looked, and "nobody looked" and "there is
   * none" are indistinguishable in the register while being completely different at handover.
   */
  if (input.forHandover && input.hasDeliveredWork && input.debt.length === 0) {
    gaps.push({
      defect: 'NO_DEBT_RECORDED',
      summary: 'No technical debt is recorded for a project that has delivered work.',
      why: 'Every delivered project has shortcuts, missing tests and things somebody meant to come back to. An empty register does not mean there is none; it means nobody wrote them down, and the receiving team inherits them anyway.',
      evidence: ['debt:none'],
      blocking: false,
    });
  }

  return gaps;
}
