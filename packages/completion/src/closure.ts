/**
 * Closing a project.
 *
 * The Phase-14 gate is precise: *a project can formally close only when criteria pass or accepted
 * exceptions exist*. The second clause is where the whole thing lives or dies, because "accepted
 * exceptions exist" is one careless implementation away from being a bypass — and a bypass on this
 * gate is worse than on any other, since "the project closed successfully" is the strongest claim the
 * platform ever makes about anything.
 *
 * So closure exceptions are held to a higher standard than the release exceptions in Phase 11:
 *
 * - They are **permanent**. A closure exception has no expiry, because the project is ending and
 *   there is nobody left to review it. That makes it a statement rather than a deferral, and it has
 *   to be written as one.
 * - They require an **owner who is not the person closing the project**. Somebody accepting their own
 *   exception on the way out records a decision with nobody independent behind it.
 * - They require a **consequence**: what the receiving team inherits because of this. An exception
 *   that only says why it was acceptable to the outgoing team is written for the wrong reader.
 * - They are **on the closure record forever**, counted and named. A project that closed on four
 *   exceptions did not close the same way as one that closed on none, and any report that renders the
 *   two identically is lying by omission.
 *
 * Contract: `MASTER_IMPLEMENTATION_PLAN.md` Phase 14; gap-spec §15.11.
 */

import type { TwinGraph } from '@govintel/twin/graph';
import {
  checkOperations,
  type Incident,
  type Ownership,
  type TechnicalDebt,
} from '@govintel/release/operations';
import { checkRetrospective, transferableLessons, type Retrospective } from './retrospective.ts';

export const CLOSURE_ENGINE_VERSION = '1.0.0';

/* -------------------------------------------------------------------------- */
/* Criteria                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * §15.11's list, in the order it names them.
 *
 * Each is a question about the day after everybody leaves, which is the only useful frame for a
 * completion gate: the project is not finished when it works, it is finished when somebody else can
 * keep it working.
 */
export const CLOSURE_CRITERIA = [
  'REQUIREMENTS_DISPOSITIONED',
  'TESTS_COMPLETE',
  'SECURITY_RESOLVED',
  'DOCUMENTS_COMPLETE',
  'OWNERSHIP_TRANSFERRED',
  'CREDENTIALS_TRANSFERRED',
  'DEBT_RECORDED',
  'EVIDENCE_CAPTURED',
  'RETROSPECTIVE_HELD',
] as const;

export type ClosureCriterion = (typeof CLOSURE_CRITERIA)[number];

export const CRITERION_MEANING: Readonly<Record<ClosureCriterion, string>> = {
  REQUIREMENTS_DISPOSITIONED:
    'Every requirement is met, explicitly dropped, or transferred. Handing over with open ones transfers a question rather than a system.',
  TESTS_COMPLETE:
    'The tests that exist have run, and what they cannot show has been said. A green suite of the wrong tests is the most reassuring possible way to be unprepared.',
  SECURITY_RESOLVED:
    'Findings are fixed or explicitly accepted by somebody. An open finding at closure becomes somebody else’s open finding, without the context of whoever was working on it.',
  DOCUMENTS_COMPLETE:
    'The documents somebody will need exist and match the system. A document that drifted is worse than none, because it still looks authoritative.',
  OWNERSHIP_TRANSFERRED:
    'Somebody has accepted each area. An owner who does not know they are the owner is not an owner.',
  CREDENTIALS_TRANSFERRED:
    'Administrative access is held by somebody who is staying. An unassigned credential is either lost or held by somebody who has left.',
  DEBT_RECORDED:
    'The shortcuts are written down. Undisclosed debt is what makes a handover a betrayal rather than a transfer.',
  EVIDENCE_CAPTURED:
    'What was kept is still verifiable. Evidence that cannot be checked is testimony, and the people who could vouch for it are leaving.',
  RETROSPECTIVE_HELD:
    'Somebody wrote down what this project taught, in a form another project can use. Otherwise it is learned again, at full price.',
};

export const CRITERION_RESULTS = ['MET', 'NOT_MET', 'EXCEPTED', 'UNKNOWN'] as const;

export type CriterionResult = (typeof CRITERION_RESULTS)[number];

/* -------------------------------------------------------------------------- */
/* Exceptions                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A permanent, accepted departure from a closure criterion.
 *
 * Deliberately a different type from the release exception in `@govintel/release/testing`, and not a
 * reuse of it. That one expires; this one cannot, because the project is ending and there is nobody
 * left to review it. Sharing the type would have meant either an expiry nobody honours or a nullable
 * field that quietly makes release exceptions permanent too.
 */
export interface ClosureException {
  readonly id: string;
  readonly criterion: ClosureCriterion;
  /** Why this is acceptable. */
  readonly reason: string;
  /**
   * What the receiving team inherits because of it.
   *
   * The field that makes an exception useful to its actual reader. A reason explains the outgoing
   * team's decision; a consequence tells the incoming team what it means for them.
   */
  readonly consequence: string;
  /** Who accepted it. Must not be the person closing the project. */
  readonly acceptedBy: string;
  readonly acceptedAt: string;
}

export const EXCEPTION_DEFECTS = [
  'NO_REASON',
  'NO_CONSEQUENCE',
  'NO_OWNER',
  'ACCEPTED_BY_THE_CLOSER',
] as const;

export type ExceptionDefect = (typeof EXCEPTION_DEFECTS)[number];

export interface ExceptionFinding {
  readonly defect: ExceptionDefect;
  readonly exceptionId: string;
  readonly summary: string;
  readonly why: string;
}

export function checkExceptions(
  exceptions: readonly ClosureException[],
  closedBy: string,
): readonly ExceptionFinding[] {
  const findings: ExceptionFinding[] = [];

  for (const exception of exceptions) {
    if (exception.reason.trim() === '') {
      findings.push({
        defect: 'NO_REASON',
        exceptionId: exception.id,
        summary: 'No reason recorded.',
        why: 'An unexplained exception at closure is permanent and unexaminable. Nobody is left to ask.',
      });
    }

    if (exception.consequence.trim() === '') {
      findings.push({
        defect: 'NO_CONSEQUENCE',
        exceptionId: exception.id,
        summary: 'Does not say what the receiving team inherits.',
        why: 'A reason explains the outgoing team’s decision. A consequence tells the incoming team what it means for them, and they are the only people who will ever read this.',
      });
    }

    if (exception.acceptedBy.trim() === '') {
      findings.push({
        defect: 'NO_OWNER',
        exceptionId: exception.id,
        summary: 'Nobody accepted it.',
        why: 'A closure exception is permanent. One with no name on it is a gap somebody decided not to fill, recorded as though it were a decision.',
      });
    } else if (exception.acceptedBy.trim() === closedBy.trim()) {
      findings.push({
        defect: 'ACCEPTED_BY_THE_CLOSER',
        exceptionId: exception.id,
        summary: `${exception.acceptedBy} is both accepting this exception and closing the project.`,
        why: 'Accepting your own exception on the way out records a decision with nobody independent behind it. The record looks complete, which is what makes it worse than no exception at all.',
      });
    }
  }

  return findings;
}

/* -------------------------------------------------------------------------- */
/* Assessment                                                                 */
/* -------------------------------------------------------------------------- */

export interface CriterionOutcome {
  readonly criterion: ClosureCriterion;
  readonly result: CriterionResult;
  readonly explanation: string;
  /** Set on `EXCEPTED`. The exception this rests on. */
  readonly exceptionId?: string;
  readonly evidence: readonly string[];
}

export interface ClosureInput {
  readonly graph: TwinGraph;
  readonly closedBy: string;
  readonly exceptions: readonly ClosureException[];
  readonly retrospective?: Retrospective;
  readonly ownership: readonly Ownership[];
  readonly incidents: readonly Incident[];
  readonly debt: readonly TechnicalDebt[];

  /** Traceability gaps still blocking. From `@govintel/traceability`. */
  readonly blockingTraceabilityGaps: number;
  /** Requirements with no verification method, which cannot be dispositioned by testing. */
  readonly untraceableRequirements: number;
  /** Tests that have not passed. */
  readonly failingTests: number;
  /**
   * Security findings still open or in progress at a blocking severity.
   *
   * `undefined` when there is no findings register to count from. That is not zero: a project whose
   * findings were never recorded has not resolved them, and reading the absence as "none open" is
   * how an unassessed criterion gets reported as met.
   */
  readonly openSecurityFindings: number | undefined;
  /** Documents that no longer match the project. `undefined` when no document is tracked at all. */
  readonly staleDocuments: number | undefined;
  /** Evidence records that failed their integrity check. */
  readonly unverifiableEvidence: number;
  /** Whether the project has delivered anything, so vacuous criteria are not reported as met. */
  readonly hasDeliveredWork: boolean;
}

export interface ClosureAssessment {
  readonly version: string;
  readonly outcomes: readonly CriterionOutcome[];
  /** Whether the project may formally close. */
  readonly mayClose: boolean;
  /** Criteria met only because an exception was accepted. Named, always. */
  readonly restingOn: readonly ClosureException[];
  readonly exceptionFindings: readonly ExceptionFinding[];
  readonly headline: string;
}

export function assessClosure(input: ClosureInput): ClosureAssessment {
  const exceptionFindings = checkExceptions(input.exceptions, input.closedBy);

  /*
   * A malformed exception cannot excuse anything.
   *
   * Otherwise the highest-standard gate in the platform could be cleared by an exception with no
   * reason, no owner and no consequence — which is not an accepted exception, it is a blank line
   * where one should be.
   */
  const usable = input.exceptions.filter(
    (exception) => !exceptionFindings.some((f) => f.exceptionId === exception.id),
  );

  const exceptionFor = (criterion: ClosureCriterion): ClosureException | undefined =>
    usable.find((e) => e.criterion === criterion);

  const operations = checkOperations({
    ownership: input.ownership,
    incidents: input.incidents,
    debt: input.debt,
    forHandover: true,
    hasDeliveredWork: input.hasDeliveredWork,
  });

  const owned = (area: string): boolean =>
    !operations.some((gap) => gap.evidence.includes(`ownership:${area}`));

  const raw: readonly {
    readonly criterion: ClosureCriterion;
    readonly met: boolean | undefined;
    readonly explanation: string;
    readonly evidence: readonly string[];
  }[] = [
    {
      criterion: 'REQUIREMENTS_DISPOSITIONED',
      met: input.untraceableRequirements > 0 ? undefined : input.blockingTraceabilityGaps === 0,
      explanation:
        input.untraceableRequirements > 0
          ? `${String(input.untraceableRequirements)} requirement(s) record no way of being verified, so whether they were met cannot be decided either way.`
          : input.blockingTraceabilityGaps === 0
            ? 'Every requirement traces to work, a passing test and kept evidence.'
            : `${String(input.blockingTraceabilityGaps)} traceability gap(s) still block.`,
      evidence: ['traceability'],
    },
    {
      criterion: 'TESTS_COMPLETE',
      met: input.failingTests === 0,
      explanation:
        input.failingTests === 0
          ? 'No test is failing or unrun.'
          : `${String(input.failingTests)} test(s) have not passed.`,
      evidence: ['tests'],
    },
    {
      criterion: 'SECURITY_RESOLVED',
      met: input.openSecurityFindings === undefined ? undefined : input.openSecurityFindings === 0,
      explanation:
        input.openSecurityFindings === undefined
          ? 'No security findings are recorded for this project, so whether any is still open cannot be told.'
          : input.openSecurityFindings === 0
            ? 'No blocking security finding is outstanding.'
            : `${String(input.openSecurityFindings)} blocking security finding(s) are still open.`,
      evidence: ['security'],
    },
    {
      criterion: 'DOCUMENTS_COMPLETE',
      met: input.staleDocuments === undefined ? undefined : input.staleDocuments === 0,
      explanation:
        input.staleDocuments === undefined
          ? 'No documents are tracked against this project, so whether any contradicts it cannot be told.'
          : input.staleDocuments === 0
            ? 'No document contradicts the project.'
            : `${String(input.staleDocuments)} document(s) say something the project no longer does.`,
      evidence: ['documents'],
    },
    {
      criterion: 'OWNERSHIP_TRANSFERRED',
      met:
        owned('PRODUCT') &&
        owned('ENGINEERING') &&
        owned('OPERATIONS') &&
        owned('SECURITY') &&
        owned('DATA_PROTECTION'),
      explanation: operations.some((g) => g.defect === 'UNOWNED_AREA')
        ? 'Some areas have nobody accountable for them after handover.'
        : 'Every area has an owner.',
      evidence: ['ownership'],
    },
    {
      criterion: 'CREDENTIALS_TRANSFERRED',
      met: owned('CREDENTIALS'),
      explanation: owned('CREDENTIALS')
        ? 'Administrative access is held by a named person.'
        : 'Nobody holds the administrative access. It is either lost or held by somebody who has left.',
      evidence: ['ownership:CREDENTIALS'],
    },
    {
      criterion: 'DEBT_RECORDED',
      met: !operations.some(
        (g) => g.defect === 'UNDISCLOSED_DEBT' || g.defect === 'NO_DEBT_RECORDED',
      ),
      explanation: operations.some((g) => g.defect === 'NO_DEBT_RECORDED')
        ? 'Nothing is recorded for a project that delivered work. Every delivered project has shortcuts; an empty register means nobody wrote them down.'
        : operations.some((g) => g.defect === 'UNDISCLOSED_DEBT')
          ? 'Some recorded debt has not been disclosed to the receiving team.'
          : 'The debt is recorded and disclosed.',
      evidence: ['debt'],
    },
    {
      criterion: 'EVIDENCE_CAPTURED',
      met: input.unverifiableEvidence === 0,
      explanation:
        input.unverifiableEvidence === 0
          ? 'Every evidence record still verifies against its hash.'
          : `${String(input.unverifiableEvidence)} evidence record(s) no longer verify. The people who could vouch for them are leaving.`,
      evidence: ['evidence'],
    },
    {
      criterion: 'RETROSPECTIVE_HELD',
      met:
        input.retrospective === undefined
          ? false
          : !checkRetrospective(input.retrospective).some((f) => f.blocking) &&
            transferableLessons(input.retrospective).length > 0,
      explanation:
        input.retrospective === undefined
          ? 'No retrospective is recorded. Whatever this project taught will be learned again at full price.'
          : transferableLessons(input.retrospective).length === 0
            ? 'A retrospective was held and none of its lessons are in a form another project could use.'
            : `${String(transferableLessons(input.retrospective).length)} transferable lesson(s) recorded.`,
      evidence: ['retrospective'],
    },
  ];

  const outcomes = raw.map((entry): CriterionOutcome => {
    if (entry.met === true) {
      return {
        criterion: entry.criterion,
        result: 'MET',
        explanation: entry.explanation,
        evidence: entry.evidence,
      };
    }

    if (entry.met === undefined) {
      /*
       * Undecidable, not failed.
       *
       * An exception can excuse a criterion somebody decided not to meet. It cannot excuse one
       * nobody can evaluate, because there is nothing to accept — and letting it would turn "we
       * could not tell" into "we decided it was fine".
       */
      return {
        criterion: entry.criterion,
        result: 'UNKNOWN',
        explanation: `${entry.explanation} This cannot be excepted: an exception accepts a known shortfall, and there is nothing here to accept.`,
        evidence: entry.evidence,
      };
    }

    const exception = exceptionFor(entry.criterion);

    if (exception === undefined) {
      return {
        criterion: entry.criterion,
        result: 'NOT_MET',
        explanation: entry.explanation,
        evidence: entry.evidence,
      };
    }

    return {
      criterion: entry.criterion,
      result: 'EXCEPTED',
      explanation: `${entry.explanation} Accepted by ${exception.acceptedBy}: ${exception.reason} The receiving team inherits: ${exception.consequence}`,
      exceptionId: exception.id,
      evidence: entry.evidence,
    };
  });

  const restingOn = outcomes
    .filter((o) => o.result === 'EXCEPTED')
    .map((o) => usable.find((e) => e.id === o.exceptionId))
    .filter((e): e is ClosureException => e !== undefined);

  const mayClose = outcomes.every((o) => o.result === 'MET' || o.result === 'EXCEPTED');

  return {
    version: CLOSURE_ENGINE_VERSION,
    outcomes,
    mayClose,
    restingOn,
    exceptionFindings,
    headline: headlineFor(outcomes, restingOn),
  };
}

function headlineFor(
  outcomes: readonly CriterionOutcome[],
  restingOn: readonly ClosureException[],
): string {
  const blocked = outcomes.filter((o) => o.result === 'NOT_MET');
  const unknown = outcomes.filter((o) => o.result === 'UNKNOWN');

  if (blocked.length === 0 && unknown.length === 0) {
    /*
     * A project that closed on four exceptions did not close the same way as one that closed on
     * none, and a headline rendering the two identically is lying by omission — on the strongest
     * claim this platform ever makes.
     */
    return restingOn.length === 0
      ? 'Every closure criterion is met. This project can close.'
      : `This project can close, resting permanently on ${String(restingOn.length)} accepted exception${restingOn.length === 1 ? '' : 's'}. They stay on the closure record, because whoever inherits this is the person they were written for.`;
  }

  if (unknown.length > 0 && blocked.length === 0) {
    return `${String(unknown.length)} criterion(s) cannot be decided. An exception accepts a known shortfall, and there is nothing here to accept — the underlying question has to be answered first.`;
  }

  return `${String(blocked.length)} closure criterion(s) are not met and not excepted.`;
}
