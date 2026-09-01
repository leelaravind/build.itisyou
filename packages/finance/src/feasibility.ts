/**
 * Feasibility and project health.
 *
 * Contract: gap-spec §22 opens with **"Feasibility is not a magic score"** and §23 with **"Do not
 * create an unexplained 83/100."** Both give a list of dimensions, a set of statuses, and require every
 * status to link to its causes.
 *
 * Those two opening sentences are the same instruction twice, and they rule out the thing most tools
 * do. A single number is attractive because it fits in a dashboard, and it is useless for the same
 * reason: nobody can act on 83, nobody can argue with 83, and the number moves for reasons nobody can
 * see. Worse, it invites optimisation of the score rather than of the project.
 *
 * So there is no overall score here. There are dimensions, each with a status and the specific causes
 * that produced it, and an overall status that is simply **the worst dimension** — with that dimension
 * named. "At risk, because the budget has no ceiling and two critical questions are unanswered" is
 * something a person can do something about.
 */

import type { TwinGraph } from '@govintel/twin/graph';
import type { ScheduleProblem } from '@govintel/execution/scheduling';
import type { BudgetTotals, Variance } from './budget.ts';
import type { ConfidenceClass } from './estimate.ts';

/* -------------------------------------------------------------------------- */
/* Shared shapes                                                              */
/* -------------------------------------------------------------------------- */

/** Gap-spec §22. */
export const FEASIBILITY_STATUSES = [
  'FEASIBLE',
  'FEASIBLE_WITH_RISK',
  'UNREALISTIC',
  'UNKNOWN',
] as const;

export type FeasibilityStatus = (typeof FEASIBILITY_STATUSES)[number];

/** Gap-spec §23. */
export const HEALTH_STATUSES = ['HEALTHY', 'WATCH', 'AT_RISK', 'CRITICAL', 'UNKNOWN'] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

/**
 * One cause behind a status.
 *
 * `evidence` points at something in the project — a node id, a rule id, a schedule problem code — so a
 * reader can go and look. A cause with no evidence is an assertion, and an engine whose assertions
 * cannot be checked is one people stop believing the first time they disagree.
 */
export interface Cause {
  readonly summary: string;
  readonly evidence: readonly string[];
}

export interface Dimension<Status extends string> {
  readonly key: string;
  readonly label: string;
  readonly status: Status;
  readonly causes: readonly Cause[];
}

/* -------------------------------------------------------------------------- */
/* Ordering                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Worst first.
 *
 * `UNKNOWN` sits deliberately between the bad and the good. It is not a failure — plenty of projects
 * legitimately cannot answer a question yet — but treating it as healthy would let a project be
 * reported as fine because nobody had filled anything in, which is the exact failure the rule engine's
 * `INDETERMINATE` outcome exists to prevent.
 */
const FEASIBILITY_RANK: Readonly<Record<FeasibilityStatus, number>> = {
  UNREALISTIC: 0,
  FEASIBLE_WITH_RISK: 1,
  UNKNOWN: 2,
  FEASIBLE: 3,
};

const HEALTH_RANK: Readonly<Record<HealthStatus, number>> = {
  CRITICAL: 0,
  AT_RISK: 1,
  WATCH: 2,
  UNKNOWN: 3,
  HEALTHY: 4,
};

/* -------------------------------------------------------------------------- */
/* Input                                                                      */
/* -------------------------------------------------------------------------- */

export interface AssessmentInput {
  readonly graph: TwinGraph;

  /** Problems the scheduler found. */
  readonly scheduleProblems: readonly ScheduleProblem[];

  readonly budget?: BudgetTotals;
  readonly variance?: Variance;

  /** Whether a budget ceiling was ever recorded. Without one, nothing can be over it. */
  readonly budgetCeilingKnown?: boolean;

  /** How much confidence the effort estimates deserve. */
  readonly estimateConfidence?: ConfidenceClass;

  /** Mandatory rules that fired and are not yet satisfied. */
  readonly openMandatoryFindings?: number;
  /** Rules that could not be decided because information is missing. */
  readonly indeterminateFindings?: number;
  /** Gates that failed, by key. */
  readonly failedGates?: readonly string[];
  /** Gates that could not be decided. */
  readonly indeterminateGates?: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* Feasibility                                                                */
/* -------------------------------------------------------------------------- */

export interface FeasibilityAssessment {
  readonly dimensions: readonly Dimension<FeasibilityStatus>[];
  /** The worst dimension's status. Never an average, and never a score. */
  readonly overall: FeasibilityStatus;
  /** Which dimension decided the overall status. */
  readonly decidedBy: string;
  readonly explanation: string;
}

/**
 * Assess feasibility across the eight dimensions §22 names.
 *
 * The overall status is the worst dimension rather than a combination. Averaging would let one
 * unrealistic dimension disappear into seven feasible ones — and a project that cannot be staffed is
 * not seven-eighths feasible, it is not feasible.
 */
export function assessFeasibility(input: AssessmentInput): FeasibilityAssessment {
  const dimensions: Dimension<FeasibilityStatus>[] = [
    scopeFeasibility(input),
    timelineFeasibility(input),
    budgetFeasibility(input),
    resourceFeasibility(input),
    skillFeasibility(input),
    technicalFeasibility(input),
    complianceFeasibility(input),
    dependencyFeasibility(input),
  ];

  const worst = [...dimensions].sort(
    (a, b) => FEASIBILITY_RANK[a.status] - FEASIBILITY_RANK[b.status] || a.key.localeCompare(b.key),
  )[0];

  const overall = worst?.status ?? 'UNKNOWN';

  return {
    dimensions,
    overall,
    decidedBy: worst?.key ?? 'none',
    explanation: explainFeasibility(overall, worst),
  };
}

function explainFeasibility(
  overall: FeasibilityStatus,
  worst: Dimension<FeasibilityStatus> | undefined,
): string {
  if (worst === undefined) return 'Nothing has been assessed yet.';

  const because = worst.causes[0]?.summary ?? 'no reason was recorded';

  switch (overall) {
    case 'UNREALISTIC':
      return `Not achievable as it stands. ${worst.label} is the binding constraint: ${because}`;
    case 'FEASIBLE_WITH_RISK':
      return `Achievable, but ${worst.label.toLowerCase()} carries real risk: ${because}`;
    case 'UNKNOWN':
      return `Cannot be assessed yet. ${worst.label} is the gap: ${because}`;
    case 'FEASIBLE':
      return 'Nothing found that would prevent this being delivered as planned.';
  }
}

/* -------------------------------------------------------------------------- */
/* The eight feasibility dimensions                                           */
/* -------------------------------------------------------------------------- */

function scopeFeasibility(input: AssessmentInput): Dimension<FeasibilityStatus> {
  const causes: Cause[] = [];
  const requirements = input.graph.nodesOfClass('REQUIREMENT');
  const criticalUnknowns = input.graph
    .nodesOfClass('UNKNOWN')
    .filter((n) => n.attributes.importance === 'CRITICAL');

  if (requirements.length === 0) {
    causes.push({
      summary: 'Nothing has been recorded as a requirement, so there is no scope to assess.',
      evidence: [],
    });
  }

  if (criticalUnknowns.length > 0) {
    causes.push({
      summary: `${String(criticalUnknowns.length)} critical ${criticalUnknowns.length === 1 ? 'question is' : 'questions are'} unanswered, and each could change what has to be built.`,
      evidence: criticalUnknowns.map((n) => n.id),
    });
  }

  return {
    key: 'scope',
    label: 'Scope',
    status:
      requirements.length === 0
        ? 'UNKNOWN'
        : criticalUnknowns.length > 0
          ? 'FEASIBLE_WITH_RISK'
          : 'FEASIBLE',
    causes,
  };
}

function timelineFeasibility(input: AssessmentInput): Dimension<FeasibilityStatus> {
  const causes: Cause[] = [];

  const overloadError = input.scheduleProblems.find(
    (p) => p.code === 'OVERLOAD' && p.severity === 'ERROR',
  );
  const overloadWarning = input.scheduleProblems.find((p) => p.code === 'OVERLOAD');
  const parallelism = input.scheduleProblems.find((p) => p.code === 'IMPOSSIBLE_PARALLELISM');

  for (const problem of [overloadError ?? overloadWarning, parallelism]) {
    if (problem === undefined) continue;
    causes.push({ summary: problem.message, evidence: [problem.code] });
  }

  if (input.estimateConfidence === 'LOW') {
    causes.push({
      summary:
        'The effort estimates are low-confidence, so the timeline derived from them is a wide range rather than a schedule.',
      evidence: ['estimate:confidence'],
    });
  }

  return {
    key: 'timeline',
    label: 'Timeline',
    status:
      overloadError !== undefined
        ? 'UNREALISTIC'
        : causes.length > 0
          ? 'FEASIBLE_WITH_RISK'
          : 'FEASIBLE',
    causes,
  };
}

function budgetFeasibility(input: AssessmentInput): Dimension<FeasibilityStatus> {
  const causes: Cause[] = [];

  if (input.budgetCeilingKnown !== true) {
    /*
     * No ceiling means nothing can be over it.
     *
     * `UNKNOWN` rather than `FEASIBLE`: a budget that cannot be exceeded because none was set is not a
     * healthy budget, and reporting it as feasible would reward not answering the question.
     */
    causes.push({
      summary:
        'No budget has been recorded, so there is nothing for the estimates to be measured against.',
      evidence: ['intake:budget.total'],
    });

    return { key: 'budget', label: 'Budget', status: 'UNKNOWN', causes };
  }

  if (input.variance !== undefined && !input.variance.withinRange) {
    causes.push({ summary: input.variance.explanation, evidence: ['budget:variance'] });
    return { key: 'budget', label: 'Budget', status: 'UNREALISTIC', causes };
  }

  if (input.budget !== undefined && input.budget.contingencyRemaining.minorUnits <= 0) {
    causes.push({
      summary:
        'Contingency is exhausted. Anything unexpected from here comes out of scope or out of the date.',
      evidence: ['budget:contingency'],
    });

    return { key: 'budget', label: 'Budget', status: 'FEASIBLE_WITH_RISK', causes };
  }

  return { key: 'budget', label: 'Budget', status: 'FEASIBLE', causes };
}

function resourceFeasibility(input: AssessmentInput): Dimension<FeasibilityStatus> {
  const causes: Cause[] = [];

  const noCapacity = input.scheduleProblems.find((p) => p.code === 'NO_CAPACITY');
  const bottleneck = input.scheduleProblems.filter((p) => p.code === 'SINGLE_PERSON_BOTTLENECK');

  if (noCapacity !== undefined) {
    causes.push({ summary: noCapacity.message, evidence: ['schedule:NO_CAPACITY'] });
    return { key: 'resource', label: 'Resourcing', status: 'UNREALISTIC', causes };
  }

  for (const problem of bottleneck) {
    causes.push({ summary: problem.message, evidence: problem.resourceIds });
  }

  return {
    key: 'resource',
    label: 'Resourcing',
    status: causes.length > 0 ? 'FEASIBLE_WITH_RISK' : 'FEASIBLE',
    causes,
  };
}

function skillFeasibility(input: AssessmentInput): Dimension<FeasibilityStatus> {
  const causes: Cause[] = [];

  const missing = input.scheduleProblems.filter((p) => p.code === 'MISSING_SKILL');
  for (const problem of missing) {
    causes.push({ summary: problem.message, evidence: problem.resourceIds });
  }

  // A skill held by one person is a resourcing risk and a skill risk at once. Reported under both,
  // because the mitigations are different: one is scheduling, the other is knowledge transfer.
  const soleHolders = input.scheduleProblems.filter(
    (p) => p.code === 'SINGLE_PERSON_BOTTLENECK' && /only/i.test(p.message),
  );

  for (const problem of soleHolders) {
    causes.push({ summary: problem.message, evidence: problem.resourceIds });
  }

  return {
    key: 'skill',
    label: 'Skills',
    status:
      missing.length > 0 ? 'UNREALISTIC' : causes.length > 0 ? 'FEASIBLE_WITH_RISK' : 'FEASIBLE',
    causes,
  };
}

function technicalFeasibility(input: AssessmentInput): Dimension<FeasibilityStatus> {
  const causes: Cause[] = [];

  const decisions = input.graph.nodesOfClass('ARCHITECTURE_DECISION');
  const components = input.graph.nodesOfClass('ARCHITECTURE_COMPONENT');

  if (components.length === 0) {
    causes.push({
      summary:
        'No architecture has been recorded, so whether the approach is workable has not been assessed.',
      evidence: [],
    });

    return { key: 'technical', label: 'Technical approach', status: 'UNKNOWN', causes };
  }

  if (decisions.length === 0) {
    causes.push({
      summary:
        'Components exist but no decisions were recorded, so the choices behind them cannot be reviewed.',
      evidence: components.map((c) => c.id).slice(0, 5),
    });
  }

  return {
    key: 'technical',
    label: 'Technical approach',
    status: causes.length > 0 ? 'FEASIBLE_WITH_RISK' : 'FEASIBLE',
    causes,
  };
}

function complianceFeasibility(input: AssessmentInput): Dimension<FeasibilityStatus> {
  const causes: Cause[] = [];

  const open = input.openMandatoryFindings ?? 0;
  const indeterminate = input.indeterminateFindings ?? 0;

  if (indeterminate > 0) {
    causes.push({
      summary: `${String(indeterminate)} rules cannot be decided because information is missing. Some of them decide whether security or privacy obligations apply at all.`,
      evidence: ['rules:indeterminate'],
    });
  }

  if (open > 0) {
    causes.push({
      summary: `${String(open)} mandatory ${open === 1 ? 'obligation is' : 'obligations are'} outstanding.`,
      evidence: ['rules:mandatory'],
    });
  }

  return {
    key: 'compliance',
    label: 'Security and compliance',
    // Outstanding obligations are normal mid-project. What is not normal is not knowing whether they
    // apply, which is why indeterminacy is reported as UNKNOWN rather than as risk.
    status: indeterminate > 0 ? 'UNKNOWN' : open > 0 ? 'FEASIBLE_WITH_RISK' : 'FEASIBLE',
    causes,
  };
}

function dependencyFeasibility(input: AssessmentInput): Dimension<FeasibilityStatus> {
  const causes: Cause[] = [];

  const cycles = input.graph.findCycles('DEPENDS_ON');
  if (cycles.length > 0) {
    causes.push({
      summary: `The dependencies contain ${String(cycles.length)} ${cycles.length === 1 ? 'cycle' : 'cycles'}, so no order of work exists that satisfies them.`,
      evidence: cycles.flat().slice(0, 10),
    });

    return { key: 'dependency', label: 'Dependencies', status: 'UNREALISTIC', causes };
  }

  const blockers = input.graph.nodesOfClass('BLOCKER');
  if (blockers.length > 0) {
    causes.push({
      summary: `${String(blockers.length)} ${blockers.length === 1 ? 'blocker is' : 'blockers are'} recorded against this project.`,
      evidence: blockers.map((b) => b.id),
    });
  }

  return {
    key: 'dependency',
    label: 'Dependencies',
    status: causes.length > 0 ? 'FEASIBLE_WITH_RISK' : 'FEASIBLE',
    causes,
  };
}

/* -------------------------------------------------------------------------- */
/* Health                                                                     */
/* -------------------------------------------------------------------------- */

export interface HealthAssessment {
  readonly dimensions: readonly Dimension<HealthStatus>[];
  readonly overall: HealthStatus;
  readonly decidedBy: string;
  readonly explanation: string;
  /**
   * Deliberately absent: a numeric score.
   *
   * §23: "Do not create an unexplained 83/100." There is no field here to put one in, which is a
   * stronger guarantee than a convention — adding one later would be a visible change to this type.
   */
}

/**
 * Assess health across the eight dimensions §23 names.
 *
 * Same shape as feasibility and for the same reason: the overall status is the worst dimension, and it
 * says which one. The two are different questions — feasibility asks whether the plan *can* work,
 * health asks whether it *is* working — and a project can be entirely feasible and quite unhealthy.
 */
export function assessHealth(input: AssessmentInput): HealthAssessment {
  const dimensions: Dimension<HealthStatus>[] = [
    scopeHealth(input),
    scheduleHealth(input),
    budgetHealth(input),
    qualityHealth(input),
    securityHealth(input),
    resourceHealth(input),
    riskHealth(input),
    dependencyHealth(input),
  ];

  const worst = [...dimensions].sort(
    (a, b) => HEALTH_RANK[a.status] - HEALTH_RANK[b.status] || a.key.localeCompare(b.key),
  )[0];

  const overall = worst?.status ?? 'UNKNOWN';
  const because = worst?.causes[0]?.summary;

  return {
    dimensions,
    overall,
    decidedBy: worst?.key ?? 'none',
    explanation:
      worst === undefined
        ? 'Nothing has been assessed yet.'
        : because === undefined
          ? `${worst.label} is the weakest dimension, though no specific cause was recorded.`
          : `${worst.label}: ${because}`,
  };
}

function scopeHealth(input: AssessmentInput): Dimension<HealthStatus> {
  const requirements = input.graph.nodesOfClass('REQUIREMENT');
  const changeRequests = input.graph.nodesOfClass('CHANGE_REQUEST');

  const causes: Cause[] = [];

  if (requirements.length === 0) {
    return {
      key: 'scope',
      label: 'Scope',
      status: 'UNKNOWN',
      causes: [{ summary: 'No requirements are recorded.', evidence: [] }],
    };
  }

  if (changeRequests.length > requirements.length / 4) {
    causes.push({
      summary: `${String(changeRequests.length)} change requests against ${String(requirements.length)} requirements. Scope is moving faster than it is being delivered.`,
      evidence: changeRequests.map((c) => c.id).slice(0, 10),
    });
  }

  return {
    key: 'scope',
    label: 'Scope',
    status: causes.length > 0 ? 'AT_RISK' : 'HEALTHY',
    causes,
  };
}

function scheduleHealth(input: AssessmentInput): Dimension<HealthStatus> {
  const causes: Cause[] = [];

  const errors = input.scheduleProblems.filter((p) => p.severity === 'ERROR');
  const warnings = input.scheduleProblems.filter((p) => p.severity === 'WARNING');

  for (const problem of [...errors, ...warnings].slice(0, 3)) {
    causes.push({ summary: problem.message, evidence: [problem.code] });
  }

  return {
    key: 'schedule',
    label: 'Schedule',
    status: errors.length > 0 ? 'CRITICAL' : warnings.length > 0 ? 'WATCH' : 'HEALTHY',
    causes,
  };
}

function budgetHealth(input: AssessmentInput): Dimension<HealthStatus> {
  /*
   * Two different absences, and conflating them was a real defect.
   *
   * `budget === undefined` means nothing has been costed. `budgetCeilingKnown !== true` means costs
   * exist but there is no ceiling for them to be measured against — which is the more dangerous of
   * the two, because a budget object holding only a contingency line satisfies every check below and
   * reports HEALTHY.
   *
   * That is precisely the "healthy because nobody filled in the form" failure §23 exists to prevent,
   * and it is worse here than on the feasibility side: health is the dimension people scan.
   */
  if (input.budget === undefined) {
    return {
      key: 'budget',
      label: 'Budget',
      status: 'UNKNOWN',
      causes: [
        {
          summary: 'Nothing has been costed, so there is no budget to report on.',
          evidence: ['intake:budget.total'],
        },
      ],
    };
  }

  if (input.budgetCeilingKnown !== true) {
    return {
      key: 'budget',
      label: 'Budget',
      status: 'UNKNOWN',
      causes: [
        {
          summary:
            'Costs are recorded but no budget ceiling is, so nothing here can be over or under it. A budget that cannot be exceeded because none was set is not a healthy budget.',
          evidence: ['intake:budget.total'],
        },
      ],
    };
  }

  const causes: Cause[] = [];

  if (input.variance !== undefined && !input.variance.withinRange) {
    causes.push({ summary: input.variance.explanation, evidence: ['budget:variance'] });
    return { key: 'budget', label: 'Budget', status: 'CRITICAL', causes };
  }

  if (input.budget.contingencyRemaining.minorUnits <= 0) {
    causes.push({
      summary: 'Contingency is used up. There is nothing left to absorb the next surprise.',
      evidence: ['budget:contingency'],
    });

    return { key: 'budget', label: 'Budget', status: 'AT_RISK', causes };
  }

  return { key: 'budget', label: 'Budget', status: 'HEALTHY', causes };
}

function qualityHealth(input: AssessmentInput): Dimension<HealthStatus> {
  const tests = input.graph.nodesOfClass('TEST');
  const requirements = input.graph.nodesOfClass('REQUIREMENT');

  if (requirements.length === 0) {
    return {
      key: 'quality',
      label: 'Quality',
      status: 'UNKNOWN',
      causes: [{ summary: 'There are no requirements to verify.', evidence: [] }],
    };
  }

  const unverified = requirements.filter(
    (r) =>
      !input.graph
        .edgesTo(r.id, 'VERIFIES')
        .some((e) => input.graph.node(e.from)?.class === 'TEST'),
  );

  const failing = tests.filter((t) => t.attributes.result === 'FAILED');
  const causes: Cause[] = [];

  if (failing.length > 0) {
    causes.push({
      summary: `${String(failing.length)} ${failing.length === 1 ? 'test is' : 'tests are'} failing.`,
      evidence: failing.map((t) => t.id).slice(0, 10),
    });
  }

  if (unverified.length > 0) {
    causes.push({
      summary: `${String(unverified.length)} of ${String(requirements.length)} requirements have nothing testing them. Work near a requirement is not evidence that it is met.`,
      evidence: unverified.map((r) => r.id).slice(0, 10),
    });
  }

  return {
    key: 'quality',
    label: 'Quality',
    status:
      failing.length > 0
        ? 'CRITICAL'
        : unverified.length === requirements.length
          ? 'AT_RISK'
          : unverified.length > 0
            ? 'WATCH'
            : 'HEALTHY',
    causes,
  };
}

function securityHealth(input: AssessmentInput): Dimension<HealthStatus> {
  const causes: Cause[] = [];

  const failed = input.failedGates ?? [];
  const securityGateFailed = failed.includes('SECURITY');
  const indeterminate = input.indeterminateFindings ?? 0;

  if (securityGateFailed) {
    causes.push({
      summary: 'The security gate is failing.',
      evidence: ['gate:SECURITY'],
    });

    return { key: 'security', label: 'Security', status: 'CRITICAL', causes };
  }

  if (indeterminate > 0) {
    /*
     * Undecidable is not healthy.
     *
     * A project whose security obligations cannot be determined because nobody answered the questions
     * is not a secure project; it is an unassessed one, and reporting it as healthy is the precise
     * false assurance the whole platform exists to avoid.
     */
    causes.push({
      summary: `${String(indeterminate)} rules cannot be decided. Whether security obligations apply is currently unknown, not established as fine.`,
      evidence: ['rules:indeterminate'],
    });

    return { key: 'security', label: 'Security', status: 'UNKNOWN', causes };
  }

  const openRisks = input.graph
    .nodesOfClass('RISK')
    .filter((r) => r.attributes.category === 'SECURITY' && r.attributes.status === 'OPEN');

  if (openRisks.length > 0) {
    causes.push({
      summary: `${String(openRisks.length)} security ${openRisks.length === 1 ? 'risk is' : 'risks are'} open.`,
      evidence: openRisks.map((r) => r.id),
    });

    return { key: 'security', label: 'Security', status: 'AT_RISK', causes };
  }

  return { key: 'security', label: 'Security', status: 'HEALTHY', causes };
}

function resourceHealth(input: AssessmentInput): Dimension<HealthStatus> {
  const problems = input.scheduleProblems.filter(
    (p) => p.code === 'NO_CAPACITY' || p.code === 'SINGLE_PERSON_BOTTLENECK',
  );

  const critical = problems.some((p) => p.code === 'NO_CAPACITY');

  return {
    key: 'resource',
    label: 'Resourcing',
    status: critical ? 'CRITICAL' : problems.length > 0 ? 'WATCH' : 'HEALTHY',
    causes: problems.slice(0, 3).map((p) => ({ summary: p.message, evidence: [p.code] })),
  };
}

function riskHealth(input: AssessmentInput): Dimension<HealthStatus> {
  const risks = input.graph.nodesOfClass('RISK');

  if (risks.length === 0) {
    /*
     * An empty risk register is not a healthy project.
     *
     * Every project has risks. A register with none means nobody looked, which is a worse position
     * than one with several recorded — those at least have someone watching them.
     */
    return {
      key: 'risk',
      label: 'Risk',
      status: 'UNKNOWN',
      causes: [
        {
          summary:
            'No risks are recorded. Every project has some, so this means nobody has looked rather than that there are none.',
          evidence: [],
        },
      ],
    };
  }

  const highImpact = risks.filter((r) => r.attributes.impact === 'HIGH');
  const unmitigated = highImpact.filter((r) => input.graph.edgesTo(r.id, 'MITIGATES').length === 0);

  const causes: Cause[] = [];

  if (unmitigated.length > 0) {
    causes.push({
      summary: `${String(unmitigated.length)} high-impact ${unmitigated.length === 1 ? 'risk has' : 'risks have'} nothing being done about them.`,
      evidence: unmitigated.map((r) => r.id),
    });
  }

  return {
    key: 'risk',
    label: 'Risk',
    status: unmitigated.length > 2 ? 'AT_RISK' : unmitigated.length > 0 ? 'WATCH' : 'HEALTHY',
    causes,
  };
}

function dependencyHealth(input: AssessmentInput): Dimension<HealthStatus> {
  const cycles = input.graph.findCycles('DEPENDS_ON');
  const blockers = input.graph.nodesOfClass('BLOCKER');

  const causes: Cause[] = [];

  if (cycles.length > 0) {
    causes.push({
      summary: `${String(cycles.length)} dependency ${cycles.length === 1 ? 'cycle' : 'cycles'}. No order of work satisfies them.`,
      evidence: cycles.flat().slice(0, 10),
    });
  }

  if (blockers.length > 0) {
    causes.push({
      summary: `${String(blockers.length)} ${blockers.length === 1 ? 'blocker' : 'blockers'} recorded.`,
      evidence: blockers.map((b) => b.id),
    });
  }

  return {
    key: 'dependency',
    label: 'Dependencies',
    status: cycles.length > 0 ? 'CRITICAL' : blockers.length > 0 ? 'WATCH' : 'HEALTHY',
    causes,
  };
}

/* -------------------------------------------------------------------------- */
/* Next action                                                                */
/* -------------------------------------------------------------------------- */

/**
 * What to deal with first.
 *
 * Contract: gap-spec §24 gives the priority order, and the reasoning behind it is that a user should
 * not have to inspect every module to find out what is on fire. The order is reproduced exactly, and
 * the first match wins — this is not a scoring function.
 */
export const NEXT_ACTION_PRIORITIES = [
  'CRITICAL_SECURITY_BLOCKER',
  'FAILED_MANDATORY_GATE',
  'BLOCKER_ON_CRITICAL_PATH',
  'REQUIRED_APPROVAL',
  'CRITICAL_MISSING_INFORMATION',
  'OVERDUE_MILESTONE',
] as const;

export type NextActionKind = (typeof NEXT_ACTION_PRIORITIES)[number];

export interface NextAction {
  readonly kind: NextActionKind;
  readonly summary: string;
  readonly why: string;
  readonly evidence: readonly string[];
}

export function nextAction(input: AssessmentInput): NextAction | null {
  const failedGates = input.failedGates ?? [];

  if (failedGates.includes('SECURITY')) {
    return {
      kind: 'CRITICAL_SECURITY_BLOCKER',
      summary: 'Resolve the failing security gate.',
      why: 'A release over a failing security gate is a decision somebody should take deliberately, and it stops everything downstream until they do.',
      evidence: ['gate:SECURITY'],
    };
  }

  if (failedGates.length > 0) {
    const gate = failedGates[0] ?? 'a gate';
    return {
      kind: 'FAILED_MANDATORY_GATE',
      summary: `Resolve the failing ${gate.toLowerCase().replace(/_/g, ' ')} gate.`,
      why: 'A failing gate blocks the lifecycle transition that depends on it, so nothing after it can proceed honestly.',
      evidence: [`gate:${gate}`],
    };
  }

  const blockers = input.graph.nodesOfClass('BLOCKER');
  if (blockers.length > 0) {
    const first = blockers[0];
    return {
      kind: 'BLOCKER_ON_CRITICAL_PATH',
      summary: `Clear the blocker: ${first?.label ?? 'unnamed'}.`,
      why: 'Work is stopped behind it, and the delay accumulates for as long as it is open.',
      evidence: blockers.map((b) => b.id),
    };
  }

  const pendingApprovals = input.graph
    .nodesOfClass('GATE')
    .filter((g) => g.attributes.result === 'AWAITING_APPROVAL');

  if (pendingApprovals.length > 0) {
    return {
      kind: 'REQUIRED_APPROVAL',
      summary: 'An approval is outstanding.',
      why: 'Approvals are the cheapest thing on this list to resolve and the most common reason work sits still.',
      evidence: pendingApprovals.map((g) => g.id),
    };
  }

  const criticalUnknowns = input.graph
    .nodesOfClass('UNKNOWN')
    .filter((n) => n.attributes.importance === 'CRITICAL');

  if (criticalUnknowns.length > 0) {
    return {
      kind: 'CRITICAL_MISSING_INFORMATION',
      summary: `Answer ${String(criticalUnknowns.length)} critical ${criticalUnknowns.length === 1 ? 'question' : 'questions'}.`,
      why: 'Until these are answered the platform cannot tell whether several obligations apply, so the plan is built on assumptions rather than facts.',
      evidence: criticalUnknowns.map((n) => n.id),
    };
  }

  const overdue = input.graph
    .nodesOfClass('MILESTONE')
    .filter((m) => m.attributes.status === 'OVERDUE');

  if (overdue.length > 0) {
    return {
      kind: 'OVERDUE_MILESTONE',
      summary: `${String(overdue.length)} ${overdue.length === 1 ? 'milestone is' : 'milestones are'} overdue.`,
      why: 'A missed milestone that nobody has replanned around means the rest of the schedule is now fiction.',
      evidence: overdue.map((m) => m.id),
    };
  }

  // Null rather than a cheerful placeholder. "Nothing needs your attention" is a claim, and inventing
  // one would be the same kind of false reassurance as an unexplained score.
  return null;
}
