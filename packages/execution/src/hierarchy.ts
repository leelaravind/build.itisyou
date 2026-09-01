/**
 * The work hierarchy, and how deep it should actually go.
 *
 * Contract: gap-spec §17 gives the canonical hierarchy and then adds the instruction that shapes this
 * whole file: **"Not every project requires every hierarchy depth. Avoid fake hierarchy."**
 *
 * It gives two worked examples — a solo project as Project → Phase → Milestone → Task, an enterprise
 * one as the full eight levels — and the difference between them is not cosmetic. A workstream
 * containing one epic containing one task is three rows of ceremony wrapped around a day's work, and
 * it makes the plan *harder* to read while looking more thorough. §18.3 says the same thing about
 * solo delivery: decompose, but avoid "useless assignment bureaucracy".
 *
 * So depth is derived from the project rather than chosen once. The rule is simple and stated as a
 * property the tests assert: **a level earns its place only if it groups more than one thing.**
 */

import type { NodeClass } from '@govintel/twin/nodes';

/* -------------------------------------------------------------------------- */
/* The canonical hierarchy                                                    */
/* -------------------------------------------------------------------------- */

/** Gap-spec §17, in order. Each level contains the next. */
export const HIERARCHY: readonly NodeClass[] = [
  'PROJECT',
  'PHASE',
  'WORKSTREAM',
  'MILESTONE',
  'EPIC',
  'TASK',
  'SUBTASK',
  'CHECKPOINT',
] as const;

export type HierarchyLevel = (typeof HIERARCHY)[number];

/**
 * Levels that may be omitted, and levels that may not.
 *
 * `PROJECT`, `PHASE` and `TASK` are structural: a plan without phases has no sequence, and a plan
 * without tasks has nothing anyone can pick up and do. Everything between them is grouping, and
 * grouping that groups one thing is noise.
 */
export const REQUIRED_LEVELS: readonly HierarchyLevel[] = ['PROJECT', 'PHASE', 'TASK'] as const;

export const OPTIONAL_LEVELS: readonly HierarchyLevel[] = HIERARCHY.filter(
  (level) => !REQUIRED_LEVELS.includes(level),
);

export function isHierarchyLevel(value: string): value is HierarchyLevel {
  return (HIERARCHY as readonly string[]).includes(value);
}

/** How deep a level sits. Lower is nearer the project. */
export function depthOf(level: HierarchyLevel): number {
  return HIERARCHY.indexOf(level);
}

/* -------------------------------------------------------------------------- */
/* Choosing a depth                                                           */
/* -------------------------------------------------------------------------- */

/**
 * What the shape of the project tells us about how much structure it can carry.
 *
 * Team size is the strongest signal and the most often ignored one. Workstreams exist so that
 * separate groups of people can work without colliding; with three people there are no separate
 * groups, so the workstream is a folder with everybody in it.
 */
export interface ShapeInput {
  /** People actually working on it. Not the size of the department. */
  readonly teamSize?: number;
  /** Roughly how many discrete pieces of work the project contains. */
  readonly taskCount?: number;
  /** Whether the project needs an audit trail at the level of individual work items. */
  readonly formalGovernance?: boolean;
  /** Distinct parallel areas — a mobile app and a backend, say. */
  readonly parallelAreas?: number;
}

export interface HierarchyPlan {
  readonly levels: readonly HierarchyLevel[];
  /** Why each optional level was included or left out. Shown to the user. */
  readonly reasoning: readonly string[];
}

/**
 * Decide which levels this project should use.
 *
 * Deterministic, and deliberately conservative: a level is included only when there is a positive
 * reason for it. The default answer to "should we add another level?" is no, because the cost of an
 * unnecessary level is paid on every screen, every report and every status update for the life of the
 * project, while the cost of adding one later is a single restructuring.
 */
export function planHierarchy(shape: ShapeInput): HierarchyPlan {
  const levels: HierarchyLevel[] = ['PROJECT', 'PHASE'];
  const reasoning: string[] = [];

  const team = shape.teamSize ?? 1;
  const tasks = shape.taskCount ?? 0;
  const areas = shape.parallelAreas ?? 1;

  /*
   * Workstreams group work by *who is doing it*, so they need more than one group of people.
   *
   * Four is the threshold because below it everyone is in the same conversation, and a workstream
   * boundary between people who talk daily creates coordination overhead rather than removing it.
   */
  if (team >= 4 && areas > 1) {
    levels.push('WORKSTREAM');
    reasoning.push(
      `Workstreams: ${String(team)} people across ${String(areas)} parallel areas, so work needs grouping by who is doing it.`,
    );
  } else {
    reasoning.push(
      team < 4
        ? `No workstreams: with ${String(team)} ${team === 1 ? 'person' : 'people'} everyone is in the same conversation, and a boundary between them would add coordination rather than remove it.`
        : 'No workstreams: the work is not split into parallel areas, so there is nothing to group by.',
    );
  }

  /*
   * Milestones are how anyone outside the work sees progress before the end. Almost every project
   * benefits, and a project small enough not to is one that finishes before the first report.
   */
  if (tasks >= 8 || shape.formalGovernance === true) {
    levels.push('MILESTONE');
    reasoning.push(
      'Milestones: there are enough distinct pieces of work that the first honest signal about the schedule would otherwise arrive at the end.',
    );
  } else {
    reasoning.push(
      'No milestones: the project is small enough that phase completion is the progress signal.',
    );
  }

  /*
   * Epics group tasks by *what they achieve*. Below roughly twenty tasks the phase already does that,
   * and an epic containing three tasks is a heading.
   *
   * They are also mutually exclusive with workstreams, which is not obvious and was found by the
   * fake-hierarchy check rather than by reasoning. Both divide work by the same axis — the family of
   * work it belongs to — so using both produces a one-to-one mapping where every workstream contains
   * exactly one epic. That is precisely the "avoid fake hierarchy" §17 forbids, and it survives
   * inspection because two plausible levels look more thorough than one.
   *
   * A genuine second axis would justify both. This engine does not have one: it knows the phase and
   * the rule family, and the phase is already a level.
   */
  if (levels.includes('WORKSTREAM')) {
    reasoning.push(
      'No epics: workstreams already divide the work by family, and a second layer over the same division would group one thing per level.',
    );
  } else if (tasks >= 20) {
    levels.push('EPIC');
    reasoning.push(
      `Epics: ${String(tasks)} tasks is more than a phase can present as a flat list, so they need grouping by outcome.`,
    );
  } else {
    reasoning.push(
      `No epics: ${String(tasks)} tasks fit under their phases without another layer of grouping.`,
    );
  }

  levels.push('TASK');

  /*
   * Subtasks only exist where a task genuinely does not fit in a few days. Splitting a two-day task
   * into four half-day subtasks produces four things to update instead of one, and nobody updates
   * them.
   */
  if (tasks >= 40 && team >= 4) {
    levels.push('SUBTASK');
    reasoning.push(
      'Subtasks: the project is large enough that some tasks will genuinely need breaking down further.',
    );
  } else {
    reasoning.push(
      'No subtasks: tasks at this scale should be small enough to finish without being split again.',
    );
  }

  /*
   * Checkpoints are verification points. They are added where governance requires evidence at
   * intermediate stages rather than only at gates.
   */
  if (shape.formalGovernance === true) {
    levels.push('CHECKPOINT');
    reasoning.push(
      'Checkpoints: governance needs evidence at intermediate points, not only at the phase gates.',
    );
  } else {
    reasoning.push('No checkpoints: the phase gates are the verification points.');
  }

  return { levels, reasoning };
}

/* -------------------------------------------------------------------------- */
/* Detecting fake hierarchy                                                   */
/* -------------------------------------------------------------------------- */

export interface HierarchyNode {
  readonly id: string;
  readonly class: NodeClass;
  readonly label: string;
  readonly childIds: readonly string[];
  /**
   * True when this node exists as a marker rather than as a container.
   *
   * A milestone saying "design is finished" holds nothing by design, and reporting it as empty would
   * fill the list with findings about nodes that are working correctly.
   */
  readonly isMarker?: boolean;
}

export interface FakeHierarchyFinding {
  readonly nodeId: string;
  readonly label: string;
  readonly level: HierarchyLevel;
  /** Written for the person looking at the plan. */
  readonly message: string;
}

/**
 * Find levels that are not doing any grouping.
 *
 * Gap-spec §17: *"Avoid fake hierarchy."* The concrete test is a container with exactly one child —
 * it adds a row to every view and separates nothing. A container with **no** children is a different
 * problem and is reported separately, because an empty phase usually means work that was planned and
 * then forgotten rather than a structural mistake.
 *
 * `PROJECT` is exempt: a project with one phase is a small project, not a fake hierarchy.
 */
export function findFakeHierarchy(
  nodes: readonly HierarchyNode[],
): readonly FakeHierarchyFinding[] {
  const findings: FakeHierarchyFinding[] = [];

  for (const node of nodes) {
    if (!isHierarchyLevel(node.class)) continue;
    if (node.class === 'PROJECT' || node.class === 'TASK' || node.class === 'SUBTASK') continue;
    if (node.class === 'CHECKPOINT') continue;
    if (node.isMarker === true) continue;

    if (node.childIds.length === 1) {
      findings.push({
        nodeId: node.id,
        label: node.label,
        level: node.class,
        message: `“${node.label}” contains one item. A ${describeLevel(node.class)} that groups a single thing adds a row to every view and separates nothing — fold it into its parent.`,
      });
      continue;
    }

    if (node.childIds.length === 0) {
      findings.push({
        nodeId: node.id,
        label: node.label,
        level: node.class,
        message: `“${node.label}” is empty. Either work is missing from it or it should not exist.`,
      });
    }
  }

  return findings;
}

/**
 * Whether a parent–child pairing respects the hierarchy.
 *
 * A level may contain the next one *or skip levels that this project omitted* — a phase containing
 * tasks directly is correct when workstreams, milestones and epics were all left out. What it may not
 * do is contain something above it, which would invert the structure.
 */
export function canNest(parent: HierarchyLevel, child: HierarchyLevel): boolean {
  return depthOf(child) > depthOf(parent);
}

export function describeLevel(level: HierarchyLevel): string {
  return level.toLowerCase().replace(/_/g, ' ');
}

/**
 * The deepest level actually used in a set of nodes.
 *
 * Used to report what shape a plan ended up with, which is frequently not the shape that was planned
 * — decomposition adds levels only where the work needs them.
 */
export function actualDepth(nodes: readonly HierarchyNode[]): readonly HierarchyLevel[] {
  const present = new Set(
    nodes.map((n) => n.class).filter((c): c is HierarchyLevel => isHierarchyLevel(c)),
  );

  return HIERARCHY.filter((level) => present.has(level));
}
