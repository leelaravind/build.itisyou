/**
 * The release-readiness flow, end to end.
 *
 * This composes the six gates §15.6–§15.11 into one answer to one question: can this be released,
 * and if not, what is the next thing to do about it.
 *
 * Three positions carry the design.
 *
 * **Three outcomes, and the third is the important one.** A gate is `PASSED`, `FAILED`, or
 * `INDETERMINATE`. Indeterminate means the gate could not be decided because information is missing —
 * nobody ran the production checks, nobody recorded the ownership. Collapsing that into `PASSED`
 * produces a release record saying a project was verified when nobody looked, and collapsing it into
 * `FAILED` makes the two indistinguishable, so nobody can tell "we checked and it is broken" from
 * "we have not checked". Both distinctions matter more at this gate than anywhere else, because this
 * is the record people cite after something goes wrong.
 *
 * **Gates are ordered and the order is enforced.** Production Verification cannot pass before
 * Release Readiness, because it is a claim about a deployment that the earlier gate has not yet
 * authorised. A system that lets a later gate pass first is one where the sequence is decoration.
 *
 * **Exceptions are counted, never absorbed.** A gate resting on four live exceptions passes
 * differently from one resting on none, and the result says so.
 *
 * Contract: gap-spec §15.6–§15.11, §25 (exception-first).
 */

import type { TwinGraph } from '@govintel/twin/graph';
import { analyse, type TraceabilityReport } from '@govintel/traceability/gaps';
import {
  checkExceptions,
  checkTesting,
  coverage,
  isLive,
  type Exception,
  type TestCategory,
  type TestRecord,
} from './testing.ts';
import { checkSecurity, checkThreatModel, type SecurityFinding } from './security.ts';
import {
  checkDeployment,
  type Environment,
  type PlanKind,
  type ProductionCheckRecord,
  type ReleasePlan,
} from './deployment.ts';
import {
  checkOperations,
  type Incident,
  type Ownership,
  type TechnicalDebt,
} from './operations.ts';

/* -------------------------------------------------------------------------- */
/* Gates                                                                      */
/* -------------------------------------------------------------------------- */

export const RELEASE_GATES = [
  'TESTING',
  'SECURITY',
  'RELEASE_READINESS',
  'PRODUCTION_VERIFICATION',
  'OPERATIONAL_READINESS',
  'COMPLETION_HANDOVER',
] as const;

export type ReleaseGate = (typeof RELEASE_GATES)[number];

export const GATE_RESULTS = ['PASSED', 'FAILED', 'INDETERMINATE'] as const;

export type GateResult = (typeof GATE_RESULTS)[number];

/**
 * Which gate must have passed before each one can be decided.
 *
 * `TESTING` and `SECURITY` are independent of each other and both come first — nothing about the
 * security position depends on the test position or the reverse, and making one wait on the other
 * would hide real problems behind unrelated ones.
 */
export const GATE_PREREQUISITE: Readonly<Record<ReleaseGate, ReleaseGate | undefined>> = {
  TESTING: undefined,
  SECURITY: undefined,
  RELEASE_READINESS: 'SECURITY',
  PRODUCTION_VERIFICATION: 'RELEASE_READINESS',
  OPERATIONAL_READINESS: 'PRODUCTION_VERIFICATION',
  COMPLETION_HANDOVER: 'OPERATIONAL_READINESS',
};

/**
 * One problem, with the argument behind it.
 *
 * `why` is not decoration. Every finding elsewhere in this platform carries one, and a release gate
 * reporting "No security test has run" with no reasoning is the one surface that would state a
 * verdict a reader cannot argue with — on the page most likely to be pasted into an approval ticket.
 */
export interface Blocker {
  readonly summary: string;
  readonly why: string;
}

export interface GateOutcome {
  readonly gate: ReleaseGate;
  readonly result: GateResult;
  /** Why the gate came out as it did, in this project's terms. */
  readonly explanation: string;
  /** Blocking problems, most important first. */
  readonly blockers: readonly Blocker[];
  /** Recorded and not blocking. Present so a passing gate still says what it is carrying. */
  readonly observations: readonly Blocker[];
  /** Live exceptions this gate is resting on. Counted, never absorbed. */
  readonly restingOn: readonly string[];
  /** Node and check ids a reader can go and look at. */
  readonly evidence: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* Input                                                                      */
/* -------------------------------------------------------------------------- */

export interface ReadinessInput {
  readonly graph: TwinGraph;
  readonly tests: readonly TestRecord[];
  readonly requiredCategories: readonly TestCategory[];
  readonly findings: readonly SecurityFinding[];
  readonly plans: readonly ReleasePlan[];
  readonly requiredPlans: readonly PlanKind[];
  readonly productionChecks: readonly ProductionCheckRecord[];
  readonly approvals: readonly string[];
  readonly target: Environment;
  readonly alreadyDeployedTo: readonly Environment[];
  readonly ownership: readonly Ownership[];
  readonly incidents: readonly Incident[];
  readonly debt: readonly TechnicalDebt[];
  readonly exceptions: readonly Exception[];
  /** ISO date from the caller. Never a clock read: determinism is a tested property. */
  readonly asOf: string;
}

export interface ReadinessReport {
  readonly gates: readonly GateOutcome[];
  /** The first gate that is not passed, which is where the work is. */
  readonly stoppedAt?: ReleaseGate;
  readonly releasable: boolean;
  readonly traceability: TraceabilityReport;
  /** What to do next, or null when there is genuinely nothing. */
  readonly nextAction: { readonly summary: string; readonly why: string } | null;
}

/* -------------------------------------------------------------------------- */
/* Evaluation                                                                 */
/* -------------------------------------------------------------------------- */

export function evaluateReadiness(input: ReadinessInput): ReadinessReport {
  const traceability = analyse(input.graph);
  const requirementIds = input.graph.nodesOfClass('REQUIREMENT').map((n) => n.id);

  const live = input.exceptions.filter((e) => isLive(e, input.asOf));

  const outcomes = new Map<ReleaseGate, GateOutcome>();

  const decide = (gate: ReleaseGate, own: () => GateOutcome): GateOutcome => {
    const prerequisite = GATE_PREREQUISITE[gate];

    if (prerequisite !== undefined && outcomes.get(prerequisite)?.result !== 'PASSED') {
      /*
       * Deliberately INDETERMINATE rather than FAILED.
       *
       * This gate has not been evaluated at all, and saying it failed would blame it for a problem
       * that belongs to an earlier one — sending somebody to fix production verification when the
       * actual issue is that nobody approved the release.
       */
      return {
        gate,
        result: 'INDETERMINATE',
        explanation: `Cannot be decided until the ${prerequisite.toLowerCase().replace(/_/g, ' ')} gate passes. This is not a failure of this gate; it has not been evaluated.`,
        blockers: [],
        observations: [],
        restingOn: [],
        evidence: [`gate:${prerequisite}`],
      };
    }

    return own();
  };

  /* -- testing ------------------------------------------------------------ */

  outcomes.set(
    'TESTING',
    decide('TESTING', () => {
      const findings = checkTesting({
        tests: input.tests,
        requiredCategories: input.requiredCategories,
        requirementIds,
        exceptions: input.exceptions,
        asOf: input.asOf,
      });

      const subjectIds = new Set([
        ...input.tests.map((t) => t.id),
        ...input.requiredCategories.map((c) => `category:${c}`),
      ]);

      const exceptionFindings = checkExceptions(input.exceptions, subjectIds, input.asOf);
      const cover = coverage(requirementIds, input.tests);

      const blockers: Blocker[] = [
        ...findings.filter((f) => f.blocking).map((f) => ({ summary: f.summary, why: f.why })),
        // An exception that is itself malformed blocks: it is not a decision anybody made properly,
        // and letting it excuse something would be the gate accepting an undated, unowned waiver.
        ...exceptionFindings
          .filter((f) => f.defect !== 'EXCEPTION_EXPIRED')
          .map((f) => ({ summary: `Exception ${f.exceptionId}: ${f.summary}`, why: f.why })),
      ];

      const observations: Blocker[] = [
        ...findings.filter((f) => !f.blocking).map((f) => ({ summary: f.summary, why: f.why })),
        ...exceptionFindings
          .filter((f) => f.defect === 'EXCEPTION_EXPIRED')
          .map((f) => ({ summary: `Exception ${f.exceptionId}: ${f.summary}`, why: f.why })),
      ];

      // Coverage is reported as named requirements, never as a proportion. A ratio here would be the
      // number that ends up on a slide, and it would be optimised.
      if (cover.unverified.length > 0) {
        blockers.push({
          summary: `${String(cover.unverified.length)} requirement(s) have no test at all: ${cover.unverified.join(', ')}`,
          why: 'Nothing will notice if these stop being true. Reported by name rather than as a proportion — a coverage percentage is the number that ends up on a slide, and it gets optimised.',
        });
      }

      /*
       * Coverage has to respect the same exceptions the individual findings do.
       *
       * Otherwise accepting a failing test unblocks the test finding and leaves the coverage check
       * reporting the identical failure under a different name — which means an exception can never
       * actually clear the gate, and the whole mechanism is decorative. An exception is a decision to
       * accept a specific failure, and the gate has to reflect it consistently or not offer it.
       *
       * The requirement is still reported, as an observation. A requirement whose only verification
       * is an excepted failing test is not verified, and that stays visible.
       */
      const excepted: string[] = [];
      const stillBlocked: string[] = [];

      for (const requirementId of cover.attempted) {
        const failing = input.tests.filter(
          (test) => test.verifies.includes(requirementId) && test.outcome !== 'PASSED',
        );

        const allExcepted = failing.every((test) => live.some((e) => e.subjectId === test.id));

        (allExcepted ? excepted : stillBlocked).push(requirementId);
      }

      if (stillBlocked.length > 0) {
        blockers.push({
          summary: `${String(stillBlocked.length)} requirement(s) have tests that have not passed: ${stillBlocked.join(', ')}`,
          why: 'Distinct from having no tests: the work has been done and the result is bad, which needs a bug fixed rather than a test written.',
        });
      }

      if (excepted.length > 0) {
        observations.push({
          summary: `${String(excepted.length)} requirement(s) are verified only by a test that is failing under an accepted exception: ${excepted.join(', ')}`,
          why: 'The exception stops this blocking, and it does not make the requirement verified. That stays visible so the two are never confused.',
        });
      }

      return finish('TESTING', blockers, observations, live, [
        ...input.tests.map((t) => t.id),
        ...cover.unverified,
      ]);
    }),
  );

  /* -- security ----------------------------------------------------------- */

  outcomes.set(
    'SECURITY',
    decide('SECURITY', () => {
      const gaps = [...checkSecurity(input.findings), ...checkThreatModel()];

      return finish(
        'SECURITY',
        gaps.filter((g) => g.blocking).map((g) => ({ summary: g.summary, why: g.why })),
        gaps.filter((g) => !g.blocking).map((g) => ({ summary: g.summary, why: g.why })),
        live,
        gaps.flatMap((g) => g.evidence),
      );
    }),
  );

  /* -- release readiness -------------------------------------------------- */

  outcomes.set(
    'RELEASE_READINESS',
    decide('RELEASE_READINESS', () => {
      const gaps = checkDeployment({
        target: input.target,
        alreadyDeployedTo: input.alreadyDeployedTo,
        plans: input.plans,
        checks: [],
        // Production checks are the *next* gate's business. Evaluating them here would make this
        // gate demand evidence from a deployment it has not yet authorised.
        verifyProduction: false,
        approvals: input.approvals,
        requiredPlans: input.requiredPlans,
      });

      return finish(
        'RELEASE_READINESS',
        gaps.filter((g) => g.blocking).map((g) => ({ summary: g.summary, why: g.why })),
        gaps.filter((g) => !g.blocking).map((g) => ({ summary: g.summary, why: g.why })),
        live,
        gaps.flatMap((g) => g.evidence),
      );
    }),
  );

  /* -- production verification -------------------------------------------- */

  outcomes.set(
    'PRODUCTION_VERIFICATION',
    decide('PRODUCTION_VERIFICATION', () => {
      const gaps = checkDeployment({
        target: 'PRODUCTION',
        alreadyDeployedTo: input.alreadyDeployedTo,
        plans: input.plans,
        checks: input.productionChecks,
        verifyProduction: true,
        approvals: input.approvals,
        requiredPlans: [],
      });

      const notRun = gaps.filter((g) => g.defect === 'PRODUCTION_CHECK_NOT_RUN');
      const failed = gaps.filter((g) => g.defect === 'PRODUCTION_CHECK_FAILED');

      /*
       * The distinction this gate exists for.
       *
       * Unchecked is INDETERMINATE; checked-and-broken is FAILED. If both read as failure, a release
       * record cannot distinguish "we looked and it is broken" from "nobody looked", and the second
       * is the one that gets quietly treated as the first and waved through.
       */
      if (failed.length === 0 && notRun.length > 0) {
        return {
          gate: 'PRODUCTION_VERIFICATION',
          result: 'INDETERMINATE',
          explanation: `${String(notRun.length)} of the ten production checks have not been run. This platform cannot observe production, so silence is unknown rather than healthy.`,
          blockers: notRun.map((g) => ({ summary: g.summary, why: g.why })),
          observations: gaps
            .filter((g) => !g.blocking)
            .map((g) => ({ summary: g.summary, why: g.why })),
          restingOn: live.map((e) => e.id),
          evidence: gaps.flatMap((g) => g.evidence),
        };
      }

      return finish(
        'PRODUCTION_VERIFICATION',
        gaps.filter((g) => g.blocking).map((g) => ({ summary: g.summary, why: g.why })),
        gaps.filter((g) => !g.blocking).map((g) => ({ summary: g.summary, why: g.why })),
        live,
        gaps.flatMap((g) => g.evidence),
      );
    }),
  );

  /* -- operational readiness ---------------------------------------------- */

  const hasDeliveredWork = input.graph.nodesOfClass('TASK').length > 0;

  outcomes.set(
    'OPERATIONAL_READINESS',
    decide('OPERATIONAL_READINESS', () => {
      const gaps = checkOperations({
        ownership: input.ownership,
        incidents: input.incidents,
        debt: input.debt,
        forHandover: false,
        hasDeliveredWork,
      });

      return finish(
        'OPERATIONAL_READINESS',
        gaps.filter((g) => g.blocking).map((g) => ({ summary: g.summary, why: g.why })),
        gaps.filter((g) => !g.blocking).map((g) => ({ summary: g.summary, why: g.why })),
        live,
        gaps.flatMap((g) => g.evidence),
      );
    }),
  );

  /* -- completion and handover -------------------------------------------- */

  outcomes.set(
    'COMPLETION_HANDOVER',
    decide('COMPLETION_HANDOVER', () => {
      const gaps = checkOperations({
        ownership: input.ownership,
        incidents: input.incidents,
        debt: input.debt,
        forHandover: true,
        hasDeliveredWork,
      });

      const blockers: Blocker[] = gaps
        .filter((g) => g.blocking)
        .map((g) => ({ summary: g.summary, why: g.why }));

      // §15.11: requirements dispositioned. A requirement neither traced nor explicitly decided
      // against is one nobody has answered, and handing over with those open transfers a question
      // rather than a system.
      if (traceability.counts.blocked > 0) {
        blockers.push({
          summary: `${String(traceability.counts.blocked)} traceability gap(s) still block.`,
          why: '§15.11 requires requirements to be dispositioned before handover. Handing over with open ones transfers a question rather than a system.',
        });
      }

      return finish(
        'COMPLETION_HANDOVER',
        blockers,
        gaps.filter((g) => !g.blocking).map((g) => ({ summary: g.summary, why: g.why })),
        live,
        gaps.flatMap((g) => g.evidence),
      );
    }),
  );

  const gates = RELEASE_GATES.map((gate) => outcomes.get(gate)).filter(
    (outcome): outcome is GateOutcome => outcome !== undefined,
  );

  const stopped = gates.find((outcome) => outcome.result !== 'PASSED');

  return {
    gates,
    ...(stopped === undefined ? {} : { stoppedAt: stopped.gate }),
    releasable: stopped === undefined,
    traceability,
    nextAction: nextActionFor(stopped),
  };
}

function finish(
  gate: ReleaseGate,
  blockers: readonly Blocker[],
  observations: readonly Blocker[],
  live: readonly Exception[],
  evidence: readonly string[],
): GateOutcome {
  const restingOn = live.map((e) => e.id);

  return {
    gate,
    result: blockers.length === 0 ? 'PASSED' : 'FAILED',
    explanation:
      blockers.length === 0
        ? restingOn.length === 0
          ? 'Passed with nothing outstanding.'
          : `Passed, resting on ${String(restingOn.length)} live exception(s). A gate carrying exceptions passes differently from one carrying none, so they are named rather than absorbed.`
        : `${String(blockers.length)} problem(s) block this gate.`,
    blockers,
    observations,
    restingOn,
    evidence,
  };
}

/**
 * What to do next.
 *
 * Returns the first unpassed gate rather than a ranked list, because the gates are ordered and a
 * later one cannot be worked on meaningfully before an earlier one clears. `null` when everything
 * passes — a cheerful placeholder would be the same false reassurance as an unexplained score.
 */
function nextActionFor(
  stopped: GateOutcome | undefined,
): { readonly summary: string; readonly why: string } | null {
  if (stopped === undefined) return null;

  const name = stopped.gate.toLowerCase().replace(/_/g, ' ');

  if (stopped.result === 'INDETERMINATE') {
    return {
      summary: `The ${name} gate cannot be decided yet.`,
      why: stopped.explanation,
    };
  }

  return {
    summary: `Clear the ${name} gate: ${stopped.blockers[0]?.summary ?? 'unspecified'}`,
    why: `${String(stopped.blockers.length)} problem(s) block it, and the gates after it cannot be evaluated until it passes.`,
  };
}
