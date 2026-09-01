/**
 * Capacity, sequencing and the things that make a schedule impossible.
 *
 * Contract: gap-spec §19 defines available capacity and requires the engine to detect **overload**,
 * **impossible parallel assignments**, **missing skill coverage** and **single-person bottlenecks**;
 * §18.1 gives the human resource model; §18.2 says AI tools are capabilities rather than employees.
 *
 * The formula in §19 is:
 *
 *     Available Capacity = Working Hours
 *                        − Leave
 *                        − Non-project allocation
 *                        − Meetings/overhead allowance
 *                        − Operational/support commitment
 *
 * Every subtraction in that list is something plans routinely omit, and each omission points the same
 * way: a schedule built on nominal headcount is wrong from the first week and the error compounds.
 * This module makes each deduction explicit and recorded, so a capacity figure can be argued with
 * rather than merely disbelieved.
 *
 * Nothing here produces a date. Plan §12.3 forbids fake precision, and a delivery date computed from
 * estimates that are themselves ranges would be exactly that. What it produces is a range, the
 * assumptions behind it, and a list of reasons the plan may not be achievable at all.
 */

import type { TwinGraph } from '@govintel/twin/graph';

/* -------------------------------------------------------------------------- */
/* Resources                                                                  */
/* -------------------------------------------------------------------------- */

/** Gap-spec §18.1. */
export interface HumanResource {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly skills: readonly string[];

  /** Contracted hours per week, before any deduction. */
  readonly workingHoursPerWeek: number;

  /** Proportion of their time this project has. 0.5 means half. */
  readonly projectAllocation: number;

  /** Hours per week lost to leave, averaged. */
  readonly leaveHoursPerWeek?: number;
  /** Hours per week committed to other projects. */
  readonly otherProjectHoursPerWeek?: number;
  /** Meetings, administration, and everything that is not the work. */
  readonly overheadHoursPerWeek?: number;
  /** Support and on-call, which is unpredictable but not optional. */
  readonly supportHoursPerWeek?: number;

  readonly timezone?: string;
  readonly availableFrom?: string;
  readonly availableUntil?: string;

  /** Cost per hour, in the project's base currency. */
  readonly hourlyCost?: number;
}

/**
 * An AI tool.
 *
 * Gap-spec §18.2 is explicit that these are **capabilities, not employees**, and the distinction is
 * not pedantic. A capability changes how fast some work goes; an employee can be assigned
 * accountability. Modelling a coding agent as a person would let a plan assign it a task nobody is
 * answerable for — and §18.2 says directly that an AI tool "does not own approvals" and "cannot be
 * responsible for legally required human accountability".
 *
 * So this type deliberately has no `role`, no `assignedTasks`, and no way to own anything.
 */
export interface AiCapability {
  readonly id: string;
  readonly name: string;
  /** What it actually speeds up. */
  readonly appliesTo: readonly ('IMPLEMENTATION' | 'TESTING' | 'REVIEW' | 'DOCUMENTATION')[];
  /**
   * Effort multiplier range where it applies. Below 1 means faster.
   *
   * A range rather than a figure, because the effect varies enormously by task and nobody has
   * measured it for this team on this codebase.
   */
  readonly effortMultiplier: { readonly low: number; readonly high: number };
  /** Subscription or usage cost per month, if any. Zero is a legitimate answer. */
  readonly monthlyCost?: number;
  /**
   * Whether work it produces needs human verification before it counts as done.
   *
   * Gap-spec §18.2: "its work requires verification based on project policy." Defaults to true,
   * because the safe default for unverified output is that it is unverified.
   */
  readonly requiresVerification?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Capacity                                                                   */
/* -------------------------------------------------------------------------- */

export interface CapacityBreakdown {
  readonly resourceId: string;
  readonly name: string;

  readonly contractedHours: number;
  readonly deductions: readonly { readonly reason: string; readonly hours: number }[];
  /** What is actually left for this project, per week. */
  readonly availableHours: number;

  /** Stated so the figure can be argued with rather than merely disbelieved. */
  readonly assumptions: readonly string[];
}

/**
 * Default deductions, applied when a resource does not state its own.
 *
 * These are conventions, and they are stated as assumptions on every result that uses them. A
 * platform that silently applied an 80% factor and reported the answer as fact would be inventing
 * precision; one that applied nothing would produce a schedule that is wrong in a known direction.
 */
export const DEFAULT_DEDUCTIONS = {
  /** Statutory leave and ordinary sickness across a year, as a proportion of contracted hours. */
  leaveProportion: 0.12,
  /** Meetings, administration, code review of others' work, and interruption. */
  overheadProportion: 0.2,
} as const;

/**
 * What one person can actually give this project in a week.
 *
 * Every deduction is itemised rather than folded into a single factor. "You have 22 hours" invites
 * disagreement with no way to locate it; "37.5, minus 4.5 leave, minus 7.5 overhead, minus 3.75 other
 * projects" locates the disagreement precisely.
 */
export function capacityOf(resource: HumanResource): CapacityBreakdown {
  const contracted = resource.workingHoursPerWeek;
  const deductions: { reason: string; hours: number }[] = [];
  const assumptions: string[] = [];

  const leave = resource.leaveHoursPerWeek ?? contracted * DEFAULT_DEDUCTIONS.leaveProportion;
  if (resource.leaveHoursPerWeek === undefined) {
    assumptions.push(
      `Leave and sickness assumed at ${String(Math.round(DEFAULT_DEDUCTIONS.leaveProportion * 100))}% of contracted hours, because none was recorded.`,
    );
  }
  deductions.push({ reason: 'Leave and sickness', hours: round(leave) });

  const overhead =
    resource.overheadHoursPerWeek ?? contracted * DEFAULT_DEDUCTIONS.overheadProportion;
  if (resource.overheadHoursPerWeek === undefined) {
    assumptions.push(
      `Meetings and overhead assumed at ${String(Math.round(DEFAULT_DEDUCTIONS.overheadProportion * 100))}% of contracted hours, because none was recorded.`,
    );
  }
  deductions.push({ reason: 'Meetings and overhead', hours: round(overhead) });

  if (resource.otherProjectHoursPerWeek !== undefined && resource.otherProjectHoursPerWeek > 0) {
    deductions.push({ reason: 'Other projects', hours: round(resource.otherProjectHoursPerWeek) });
  }

  if (resource.supportHoursPerWeek !== undefined && resource.supportHoursPerWeek > 0) {
    deductions.push({ reason: 'Support and on-call', hours: round(resource.supportHoursPerWeek) });
  }

  const deducted = deductions.reduce((sum, d) => sum + d.hours, 0);

  /*
   * Allocation is applied last, to what remains.
   *
   * Applying it first would mean "half-time on this project" deducted a full person's overhead from a
   * half person's time, which produces a negative number for anyone under about half allocation.
   */
  const beforeAllocation = Math.max(0, contracted - deducted);
  const available = round(beforeAllocation * resource.projectAllocation);

  if (resource.projectAllocation < 1) {
    deductions.push({
      reason: `Allocated ${String(Math.round(resource.projectAllocation * 100))}% to this project`,
      hours: round(beforeAllocation - available),
    });

    /*
     * The cost of splitting attention, stated but not silently applied.
     *
     * Context switching between projects measurably costs more than the arithmetic split suggests,
     * but the size of the effect is disputed and applying an unmeasured factor would be inventing
     * precision. Naming it lets a planner decide.
     */
    assumptions.push(
      'Splitting a person across projects costs more than the arithmetic suggests. This figure does not discount for context switching; treat it as an upper bound.',
    );
  }

  return {
    resourceId: resource.id,
    name: resource.name,
    contractedHours: contracted,
    deductions,
    availableHours: available,
    assumptions,
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/* -------------------------------------------------------------------------- */
/* Problems §19 requires detecting                                            */
/* -------------------------------------------------------------------------- */

export const SCHEDULE_PROBLEMS = [
  'OVERLOAD',
  'IMPOSSIBLE_PARALLELISM',
  'MISSING_SKILL',
  'SINGLE_PERSON_BOTTLENECK',
  'NO_CAPACITY',
  'UNASSIGNED_WORK',
] as const;

export type ScheduleProblemCode = (typeof SCHEDULE_PROBLEMS)[number];

export interface ScheduleProblem {
  readonly code: ScheduleProblemCode;
  readonly severity: 'ERROR' | 'WARNING';
  /** Written for whoever has to fix the plan. */
  readonly message: string;
  readonly resourceIds: readonly string[];
  readonly nodeIds: readonly string[];
}

export interface ScheduleInput {
  readonly graph: TwinGraph;
  readonly resources: readonly HumanResource[];
  readonly capabilities?: readonly AiCapability[];
  /** Effort in hours per task id, where it is known. */
  readonly effortByTask?: Readonly<Record<string, { low: number; high: number }>>;
  /** How many weeks the plan covers. Used to compare total capacity against total effort. */
  readonly weeks?: number;
}

/**
 * Find the reasons this plan may not be achievable.
 *
 * Reports rather than throws. A plan with an overloaded person is a plan that needs a conversation,
 * not an error three layers up with the cause discarded.
 */
export function findScheduleProblems(input: ScheduleInput): readonly ScheduleProblem[] {
  const problems: ScheduleProblem[] = [];
  const { graph, resources } = input;

  const tasks = graph.nodesOfClass('TASK');
  const capacities = resources.map(capacityOf);
  const totalWeekly = capacities.reduce((sum, c) => sum + c.availableHours, 0);

  /* ---- no capacity at all ------------------------------------------------ */

  if (resources.length === 0 && tasks.length > 0) {
    problems.push({
      code: 'NO_CAPACITY',
      severity: 'ERROR',
      message: `There are ${String(tasks.length)} tasks and nobody recorded to do them. A schedule cannot be produced from this.`,
      resourceIds: [],
      nodeIds: tasks.map((t) => t.id),
    });

    // Everything below reasons about capacity, and there is none. Reporting each consequence
    // separately would bury the single fact that matters.
    return problems;
  }

  if (totalWeekly === 0 && resources.length > 0) {
    problems.push({
      code: 'NO_CAPACITY',
      severity: 'ERROR',
      message:
        'Every person is fully consumed by leave, overhead or other commitments. No hours remain for this project.',
      resourceIds: resources.map((r) => r.id),
      nodeIds: [],
    });
  }

  /* ---- overload ---------------------------------------------------------- */

  const weeks = input.weeks ?? 0;
  const effort = input.effortByTask ?? {};
  const totalEffort = Object.values(effort).reduce(
    (sum, e) => ({ low: sum.low + e.low, high: sum.high + e.high }),
    { low: 0, high: 0 },
  );

  if (weeks > 0 && totalEffort.high > 0) {
    const capacityInWindow = totalWeekly * weeks;

    if (totalEffort.low > capacityInWindow) {
      // Even the optimistic estimate does not fit. This is arithmetic, not a judgement.
      problems.push({
        code: 'OVERLOAD',
        severity: 'ERROR',
        message:
          `The work needs at least ${String(Math.round(totalEffort.low))} hours and there are ` +
          `${String(Math.round(capacityInWindow))} available in ${String(weeks)} weeks. ` +
          'Even the optimistic estimate does not fit, so something has to change: scope, people or the date.',
        resourceIds: resources.map((r) => r.id),
        nodeIds: [],
      });
    } else if (totalEffort.high > capacityInWindow) {
      problems.push({
        code: 'OVERLOAD',
        severity: 'WARNING',
        message:
          `The work needs between ${String(Math.round(totalEffort.low))} and ${String(Math.round(totalEffort.high))} hours ` +
          `against ${String(Math.round(capacityInWindow))} available. It fits only if everything goes well, ` +
          'which is not a plan.',
        resourceIds: resources.map((r) => r.id),
        nodeIds: [],
      });
    }
  }

  /* ---- impossible parallelism -------------------------------------------- */

  /*
   * How many things could run at once, against how many people there are.
   *
   * A plan showing six simultaneous streams and two people is sequential work drawn wrongly, and the
   * end date it implies is arithmetic rather than a forecast.
   */
  const order = graph.topologicalOrder('DEPENDS_ON');
  if (order.ok && resources.length > 0) {
    const width = maxConcurrentWork(graph);

    if (width > resources.length * 2) {
      problems.push({
        code: 'IMPOSSIBLE_PARALLELISM',
        severity: 'WARNING',
        message:
          `The plan has ${String(width)} pieces of work that could start at once and ${String(resources.length)} ` +
          `${resources.length === 1 ? 'person' : 'people'} to do them. The sequence shown is not the sequence that will happen.`,
        resourceIds: resources.map((r) => r.id),
        nodeIds: [],
      });
    }
  } else if (!order.ok) {
    problems.push({
      code: 'IMPOSSIBLE_PARALLELISM',
      severity: 'ERROR',
      message:
        'The dependencies contain a cycle, so no ordering of the work exists. Nothing can be scheduled until it is broken.',
      resourceIds: [],
      nodeIds: order.cycles.flat(),
    });
  }

  /* ---- single-person bottleneck ------------------------------------------ */

  if (resources.length === 1 && tasks.length > 0) {
    const only = resources[0];
    problems.push({
      code: 'SINGLE_PERSON_BOTTLENECK',
      severity: 'WARNING',
      message:
        `Everything depends on ${only?.name ?? 'one person'} being available. That is workable, but it means ` +
        'illness or a change of job moves the whole timeline, so the plan should say what happens then.',
      resourceIds: only === undefined ? [] : [only.id],
      nodeIds: [],
    });
  }

  /*
   * A skill only one person has, on a team where others exist.
   *
   * Different from the solo case: here there *are* other people, and the work still queues behind one
   * of them. That is invisible in a capacity total, which is why it needs its own check.
   */
  if (resources.length > 1) {
    const bySkill = new Map<string, string[]>();
    for (const resource of resources) {
      for (const skill of resource.skills) {
        const holders = bySkill.get(skill) ?? [];
        holders.push(resource.id);
        bySkill.set(skill, holders);
      }
    }

    for (const skill of [...bySkill.keys()].sort()) {
      const holders = bySkill.get(skill) ?? [];
      if (holders.length !== 1) continue;

      const holder = resources.find((r) => r.id === holders[0]);
      problems.push({
        code: 'SINGLE_PERSON_BOTTLENECK',
        severity: 'WARNING',
        message: `Only ${holder?.name ?? 'one person'} has ${skill}. Work needing it queues behind them regardless of who else is free.`,
        resourceIds: holders,
        nodeIds: [],
      });
    }
  }

  /* ---- unassigned work --------------------------------------------------- */

  const unassigned = tasks.filter((task) => graph.edgesFrom(task.id, 'ASSIGNED_TO').length === 0);

  if (unassigned.length > 0 && resources.length > 1) {
    // Not reported for a solo project: assigning every task to the only person is the "assignment
    // bureaucracy" gap-spec §18.3 says to avoid.
    problems.push({
      code: 'UNASSIGNED_WORK',
      severity: 'WARNING',
      message: `${String(unassigned.length)} of ${String(tasks.length)} tasks have nobody doing them.`,
      resourceIds: [],
      nodeIds: unassigned.map((t) => t.id),
    });
  }

  return problems;
}

/**
 * The widest point of the dependency graph — how many tasks could run simultaneously.
 *
 * Computed by levelling: everything with no unmet dependency is level 0, everything depending only on
 * level 0 is level 1, and so on. The largest level is the width. This is the number a plan implicitly
 * claims it can staff.
 */
export function maxConcurrentWork(graph: TwinGraph): number {
  const tasks = graph.nodesOfClass('TASK');
  if (tasks.length === 0) return 0;

  const taskIds = new Set(tasks.map((t) => t.id));
  const level = new Map<string, number>();

  // Iterative rather than recursive: depth is derived from user-supplied structure.
  let changed = true;
  let guard = 0;

  while (changed && guard < tasks.length + 1) {
    changed = false;
    guard += 1;

    for (const task of tasks) {
      const dependencies = graph
        .edgesFrom(task.id, 'DEPENDS_ON')
        .filter((e) => taskIds.has(e.to))
        .map((e) => level.get(e.to) ?? 0);

      const next = dependencies.length === 0 ? 0 : Math.max(...dependencies) + 1;

      if (level.get(task.id) !== next) {
        level.set(task.id, next);
        changed = true;
      }
    }
  }

  const counts = new Map<number, number>();
  for (const value of level.values()) counts.set(value, (counts.get(value) ?? 0) + 1);

  return Math.max(...counts.values());
}

/* -------------------------------------------------------------------------- */
/* Summary                                                                    */
/* -------------------------------------------------------------------------- */

export interface CapacitySummary {
  readonly totalWeeklyHours: number;
  readonly perResource: readonly CapacityBreakdown[];
  readonly problems: readonly ScheduleProblem[];
  /** True when nothing is an ERROR. Warnings are shown, not blocking. */
  readonly feasible: boolean;
  /** Every assumption behind the figures, deduplicated. Shown with the number, never buried. */
  readonly assumptions: readonly string[];
}

export function summariseCapacity(input: ScheduleInput): CapacitySummary {
  const perResource = input.resources.map(capacityOf);
  const problems = findScheduleProblems(input);

  const assumptions = [...new Set(perResource.flatMap((c) => c.assumptions))].sort();

  /*
   * AI capabilities are reported as assumptions rather than folded into the capacity number.
   *
   * §18.2: a capability influences "effort assumptions" and "suggested parallelism", and has no
   * employment cost. Adding its multiplier into the hours available would turn a disputed,
   * unmeasured effect into a figure that looks like a measurement.
   */
  for (const capability of input.capabilities ?? []) {
    // The default is that output needs verifying. §18.2: "its work requires verification based on
    // project policy", and the safe default for unverified output is that it is unverified.
    const verification =
      capability.requiresVerification === false
        ? ''
        : ' Its output still requires human verification.';

    assumptions.push(
      `${capability.name} is available for ${capability.appliesTo.join(', ').toLowerCase()}. ` +
        `Its effect on effort is estimated between ${String(capability.effortMultiplier.low)}× and ` +
        `${String(capability.effortMultiplier.high)}×, and is not included in the hours above.` +
        verification,
    );
  }

  return {
    totalWeeklyHours: round(perResource.reduce((sum, c) => sum + c.availableHours, 0)),
    perResource,
    problems,
    feasible: !problems.some((p) => p.severity === 'ERROR'),
    assumptions,
  };
}
