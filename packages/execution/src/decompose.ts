/**
 * Turning a plan into work.
 *
 * Contract: gap-spec §17 (the hierarchy, and avoiding fake levels), §18.3 (solo delivery still gets
 * decomposed, without ceremony); plan §34 makes the Phase-8 gate "solo + 12-person fixtures produce
 * valid execution plans".
 *
 * The input is what earlier phases produced: the project graph from Phase 6, and the requirements,
 * tasks and tests the rules emitted in Phase 7. This turns those into a hierarchy of work with
 * dependencies, at a depth the project actually warrants.
 *
 * Pure, like the generator and the rule evaluator. No clock, no randomness, no database — the
 * timestamp is an input and ids derive from stable paths, so the same project produces the same
 * execution plan and two versions stay comparable.
 *
 * **What it deliberately does not do:** invent work. Every task here traces to a rule that fired, a
 * requirement that exists, or a phase that has to happen. A decomposition engine that padded a thin
 * project with plausible-sounding tasks would produce a plan that looks thorough and is fiction.
 */

import type { TwinGraph } from '@govintel/twin/graph';
import type { NodeProvenance, TwinNode } from '@govintel/twin/nodes';
import { createNode } from '@govintel/twin/nodes';
import type { EdgeClass, TwinEdge } from '@govintel/twin/edges';
import { TwinGraph as Graph } from '@govintel/twin/graph';
import type { Emissions } from '@govintel/rules/evaluate';
import {
  HIERARCHY,
  actualDepth,
  findFakeHierarchy,
  planHierarchy,
  type HierarchyLevel,
  type HierarchyNode,
  type HierarchyPlan,
} from './hierarchy.ts';

/** Bumped whenever decomposition rules change. A stored plan keeps the version that produced it. */
export const DECOMPOSER_VERSION = '1.0.0';

/* -------------------------------------------------------------------------- */
/* Input and output                                                           */
/* -------------------------------------------------------------------------- */

export interface DecompositionInput {
  readonly projectId: string;
  /** The graph from Phase 6: phases, requirements, risks, gates. */
  readonly graph: TwinGraph;
  /** What the rules emitted in Phase 7. */
  readonly emissions: Emissions;
  readonly teamSize?: number;
  readonly formalGovernance?: boolean;
  /** Distinct parallel areas of work, if known. */
  readonly parallelAreas?: number;
  /** Supplied. Never read from a clock — see the note above. */
  readonly at: string;
}

export interface DecompositionResult {
  readonly nodes: readonly TwinNode[];
  readonly edges: readonly TwinEdge[];
  readonly hierarchy: HierarchyPlan;
  /** Levels that ended up being used, which may be shallower than planned. */
  readonly actualLevels: readonly HierarchyLevel[];
  readonly decomposerVersion: string;
  /** Levels that group a single item, or nothing. Gap-spec §17: avoid fake hierarchy. */
  readonly fakeHierarchy: readonly ReturnType<typeof findFakeHierarchy>[number][];
  /** What the engine could not decompose, and why. Never silently dropped. */
  readonly notDecomposed: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* Decomposition                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Build the work breakdown.
 *
 * Two passes, deliberately: the structure is decided first, then work is attached to it. Deciding
 * both at once produces a hierarchy shaped by whichever task was processed first.
 */
export function decompose(input: DecompositionInput): DecompositionResult {
  const { projectId, graph, emissions, at } = input;

  const phases = graph.nodesOfClass('PHASE');
  const requirements = graph.nodesOfClass('REQUIREMENT');

  /*
   * The task count drives the hierarchy depth, so it has to be known before the structure is chosen.
   * Counted from what will actually be created rather than estimated.
   */
  const taskCount = emissions.tasks.length + requirements.length;

  const hierarchy = planHierarchy({
    ...(input.teamSize === undefined ? {} : { teamSize: input.teamSize }),
    taskCount,
    ...(input.formalGovernance === undefined ? {} : { formalGovernance: input.formalGovernance }),
    ...(input.parallelAreas === undefined ? {} : { parallelAreas: input.parallelAreas }),
  });

  const uses = new Set(hierarchy.levels);

  const nodes: TwinNode[] = [];
  const edges: TwinEdge[] = [];
  const notDecomposed: string[] = [];

  const id = (kind: string, key: string): string => `${projectId}:${kind}:${key}`;

  const link = (edgeClass: EdgeClass, from: string, to: string, rationale?: string): void => {
    edges.push({
      id: `${from}->${edgeClass}->${to}`,
      projectId,
      class: edgeClass,
      from,
      to,
      ...(rationale === undefined ? {} : { rationale }),
      createdAt: at,
    });
  };

  const engine: NodeProvenance = {
    provenance: 'DETERMINISTIC_CALCULATION',
    confidence: 'HIGH',
    sourceRef: `decomposer:${DECOMPOSER_VERSION}`,
  };

  /* -- where does work attach? -------------------------------------------- */

  /*
   * The chain, derived from the levels this project uses.
   *
   * Gap-spec §17 permits skipping levels, so the parent of anything is simply the nearest level
   * above it that this project decided to use. Deriving it rather than hard-coding a cascade means a
   * change to `planHierarchy` cannot silently leave the decomposer attaching work to a level that no
   * longer exists.
   */
  /*
   * Milestones only sit in the task chain when there are no workstreams.
   *
   * A milestone divides by phase; a workstream divides by phase *and* family. The workstream is
   * strictly finer, so a milestone above one always contains exactly that workstream — a level that
   * groups a single thing, which §17 forbids and the collapse pass then removed, leaving a plan with
   * no workstreams at all despite having asked for them.
   *
   * Both of gap-spec §17's worked examples are consistent with this: the solo project has milestones
   * in the chain and no workstreams, the enterprise one has workstreams. Where workstreams exist the
   * milestone becomes what it is elsewhere in the product anyway — a marker on the phase saying when
   * that phase is finished.
   */
  const chain = HIERARCHY.filter(
    (level) => uses.has(level) && !(level === 'MILESTONE' && uses.has('WORKSTREAM')),
  );

  /** True when milestones are markers rather than containers of work. */
  const milestonesAreMarkers = uses.has('MILESTONE') && uses.has('WORKSTREAM');

  /** The level immediately above `level` in this project's chain. */
  function parentLevel(level: HierarchyLevel): HierarchyLevel | undefined {
    const at = chain.indexOf(level);
    return at <= 0 ? undefined : chain[at - 1];
  }

  /**
   * The key a container of `level` uses for a given phase and group.
   *
   * Phase-scoped levels repeat per phase; group-scoped ones repeat per rule family. A level scoped to
   * both would produce one container per combination, most holding a single task — the fake hierarchy
   * §17 forbids — so each level is scoped to whichever axis it actually divides by.
   */
  function containerKey(level: HierarchyLevel, phaseKey: string, group: string): string {
    if (level === 'PHASE') return phaseKey;
    if (level === 'WORKSTREAM') return `${phaseKey}:${group}`;
    if (level === 'MILESTONE') return phaseKey;
    if (level === 'EPIC') return uses.has('WORKSTREAM') ? `${phaseKey}:${group}` : group;
    return `${phaseKey}:${group}`;
  }

  function containerId(level: HierarchyLevel, phaseKey: string, group: string): string {
    return level === 'PHASE'
      ? id('phase', phaseKey)
      : id(level.toLowerCase(), containerKey(level, phaseKey, group));
  }

  /** Where a task belongs: the deepest container level this project uses. */
  function containerFor(phaseKey: string, group: string): string {
    const above = parentLevel('TASK');
    return above === undefined ? id('phase', phaseKey) : containerId(above, phaseKey, group);
  }

  const phaseKeyOf = (node: TwinNode): string =>
    typeof node.attributes.phaseKey === 'string' ? node.attributes.phaseKey : 'build';

  const phaseByKey = new Map(phases.map((p) => [phaseKeyOf(p), p]));
  const defaultPhaseKey = phases[0] === undefined ? 'build' : phaseKeyOf(phases[0]);

  /*
   * Rules name phases that this project type may not have.
   *
   * A rule emits a task for the "operate" phase because most project types have one — an internal
   * tool does not. Left alone, the decomposer created an epic under a milestone that was never built,
   * producing a dangling edge and an epic grouping a single task.
   *
   * The fallback is deliberately the *last* phase rather than the first: work a rule assigned to
   * operation belongs later in the project, not at discovery. Where even that cannot be decided the
   * work is reported rather than placed silently, because a task in the wrong phase is a task that
   * gets done at the wrong time.
   */
  const finalPhase = phases[phases.length - 1];
  const lastPhaseKey = finalPhase === undefined ? defaultPhaseKey : phaseKeyOf(finalPhase);

  const normalisePhaseKey = (key: string | undefined): string => {
    if (key !== undefined && phaseByKey.has(key)) return key;
    return lastPhaseKey;
  };

  /* -- containers ---------------------------------------------------------- */

  /*
   * Every phase-and-group combination the emitted work actually uses.
   *
   * Built from the work rather than from the taxonomy: creating a container for every possible
   * combination would produce mostly-empty structure, and the emptiness would only be visible after
   * the fact.
   */
  const combinations = new Set<string>();
  for (const task of emissions.tasks) {
    combinations.add(`${normalisePhaseKey(task.phaseKey)}|${groupOf(task.ruleId)}`);
  }
  for (const _requirement of requirements) {
    combinations.add(`${normalisePhaseKey('build')}|req`);
  }

  const created = new Set<string>();

  /*
   * Marker milestones, when they are not part of the task chain.
   *
   * One per phase, holding nothing. They exist so that progress has an intermediate signal — without
   * them the first honest report about the schedule arrives at the end — and they are excluded from
   * the singleton collapse for exactly that reason.
   */
  if (milestonesAreMarkers) {
    for (const phase of phases) {
      const key = phaseKeyOf(phase);
      const markerId = id('milestone', key);
      created.add(markerId);

      nodes.push(
        createNode({
          id: markerId,
          projectId,
          class: 'MILESTONE',
          label: `${phase.label} complete`,
          description: `The point at which ${phase.label.toLowerCase()} can be shown to be finished.`,
          provenance: engine,
          attributes: { phaseKey: key, kind: 'PHASE_MARKER' },
          at,
        }),
      );

      link('CONTAINS', phase.id, markerId);
    }
  }

  // Deepest-first would attach children before parents exist, so walk the chain downwards.
  for (const level of chain) {
    if (level === 'PROJECT' || level === 'PHASE' || level === 'TASK' || level === 'SUBTASK')
      continue;
    if (level === 'CHECKPOINT') continue;

    for (const combination of [...combinations].sort()) {
      const [phaseKey = defaultPhaseKey, group = 'gen'] = combination.split('|');
      const nodeId = containerId(level, phaseKey, group);
      if (created.has(nodeId)) continue;
      created.add(nodeId);

      nodes.push(
        createNode({
          id: nodeId,
          projectId,
          class: level,
          label: labelFor(level, group, phaseByKey.get(phaseKey)?.label ?? phaseKey),
          provenance: engine,
          attributes: { phaseKey, group, level },
          at,
        }),
      );

      const above = parentLevel(level);
      const parent =
        above === undefined || above === 'PROJECT'
          ? graph.nodesOfClass('PROJECT')[0]?.id
          : above === 'PHASE'
            ? (phaseByKey.get(phaseKey)?.id ?? phaseByKey.get(defaultPhaseKey)?.id)
            : containerId(above, phaseKey, group);

      if (parent !== undefined) link('CONTAINS', parent, nodeId);
    }
  }

  /* -- tasks from rule emissions ------------------------------------------- */

  for (const task of emissions.tasks) {
    const phaseKey = normalisePhaseKey(task.phaseKey);
    const group = groupOf(task.ruleId);
    const taskId = id('task', task.key);

    nodes.push(
      createNode({
        id: taskId,
        projectId,
        class: 'TASK',
        label: task.title,
        ...(task.description === undefined ? {} : { description: task.description }),
        // Traceable to the rule that required it. A task nobody can trace is one nobody can drop.
        provenance: {
          provenance: 'DETERMINISTIC_CALCULATION',
          confidence: 'HIGH',
          sourceRef: `rule:${task.ruleId}`,
        },
        attributes: { phaseKey, group, ruleId: task.ruleId, status: 'TODO' },
        at,
      }),
    );

    const container = containerFor(phaseKey, group);
    // Only link if the container exists — a phase key with no matching phase would dangle.
    if (nodes.some((n) => n.id === container) || phaseByKey.get(phaseKey)?.id === container) {
      link('CONTAINS', container, taskId, `Required by ${task.ruleId}.`);
    } else {
      const fallback = phaseByKey.get(defaultPhaseKey);
      if (fallback === undefined) {
        notDecomposed.push(
          `${task.title}: no phase to attach it to, so it was left out rather than placed arbitrarily.`,
        );
        nodes.pop();
        continue;
      }
      link('CONTAINS', fallback.id, taskId, `Required by ${task.ruleId}.`);
    }
  }

  /* -- tasks implementing requirements ------------------------------------- */

  for (const requirement of requirements) {
    const taskId = id('task', `implement:${shortKey(requirement.id)}`);
    const phaseKey = normalisePhaseKey('build');

    nodes.push(
      createNode({
        id: taskId,
        projectId,
        class: 'TASK',
        label: `Implement: ${requirement.label}`,
        ...(requirement.description === undefined ? {} : { description: requirement.description }),
        provenance: engine,
        attributes: { phaseKey, group: 'req', requirementId: requirement.id, status: 'TODO' },
        at,
      }),
    );

    const container = containerFor(phaseKey, 'req');
    const exists = nodes.some((n) => n.id === container) || phaseByKey.get(phaseKey) !== undefined;

    if (exists) {
      const parent =
        nodes.find((n) => n.id === container)?.id ??
        phaseByKey.get(phaseKey)?.id ??
        phaseByKey.get(defaultPhaseKey)?.id;
      if (parent !== undefined) link('CONTAINS', parent, taskId);
    }

    // The traceability edge. Work implements a requirement; it never verifies one.
    link('IMPLEMENTS', taskId, requirement.id, 'This work exists to satisfy that requirement.');
  }

  /* -- tests --------------------------------------------------------------- */

  for (const test of emissions.tests) {
    const testId = id('test', test.key);

    nodes.push(
      createNode({
        id: testId,
        projectId,
        class: 'TEST',
        label: test.title,
        ...(test.description === undefined ? {} : { description: test.description }),
        provenance: {
          provenance: 'DETERMINISTIC_CALCULATION',
          confidence: 'HIGH',
          sourceRef: `rule:${test.ruleId}`,
        },
        attributes: { kind: test.kind, ruleId: test.ruleId, executed: false },
        at,
      }),
    );

    // Tests hang off the project rather than a phase: a test written during build is run at
    // verification and again at every release, so tying it to one phase would misrepresent it.
    const project = graph.nodesOfClass('PROJECT')[0];
    if (project !== undefined) link('CONTAINS', project.id, testId);

    /*
     * The verification edge, where the rule said what the test is for.
     *
     * `test.verifies` names an emitted requirement key, which is not a node id — the requirement may
     * have been emitted by a rule and not yet materialised. Only linked when the requirement actually
     * exists in the graph, because a `VERIFIES` edge pointing at nothing would put a verification
     * arrow in the traceability matrix with no requirement on the other end.
     */
    if (test.verifies !== undefined) {
      const target = requirements.find(
        (r) => r.attributes.ruleKey === test.verifies || shortKey(r.id) === test.verifies,
      );
      if (target !== undefined) {
        link('VERIFIES', testId, target.id, `${test.ruleId} requires this to be verified.`);
      } else {
        notDecomposed.push(
          `${test.title}: it verifies "${test.verifies}", which is not yet a requirement in this project.`,
        );
      }
    }
  }

  /* -- dependencies -------------------------------------------------------- */

  /*
   * Tasks inherit the ordering of the phases they belong to.
   *
   * That is genuinely all the engine knows at this point. Task-level dependencies within a phase
   * require understanding what each task actually touches, which is information nobody has recorded —
   * and inventing them would produce a schedule that looks precise and constrains the team for no
   * reason.
   */
  const phaseOrder = orderedPhaseKeys(graph, phases, phaseKeyOf);

  for (let i = 1; i < phaseOrder.length; i += 1) {
    const previous = phaseOrder[i - 1];
    const current = phaseOrder[i];
    if (previous === undefined || current === undefined) continue;

    const earlier = nodes.filter((n) => n.class === 'TASK' && n.attributes.phaseKey === previous);
    const later = nodes.filter((n) => n.class === 'TASK' && n.attributes.phaseKey === current);

    // One edge per phase boundary rather than a full cross-product: n×m edges between two phases of
    // twenty tasks each is four hundred edges expressing one fact.
    const from = later[0];
    const to = earlier[earlier.length - 1];
    if (from !== undefined && to !== undefined) {
      link('DEPENDS_ON', from.id, to.id, `${current} follows ${previous}.`);
    }
  }

  /* -- collapse fake hierarchy ---------------------------------------------- */

  /*
   * Gap-spec §17: avoid fake hierarchy.
   *
   * Detecting a container that groups one thing and then creating it anyway would be reporting a
   * defect the engine chose to introduce. The depth chosen by `planHierarchy` is a prediction from
   * the shape of the project; what the work actually needs is only knowable once it has been placed.
   *
   * So containers with fewer than two children are removed and their children re-parented to the
   * grandparent. That is exactly the "fold it into its parent" the finding recommends, done rather
   * than suggested.
   */
  const collapsed = collapseSingletons(nodes, edges);

  /* -- report -------------------------------------------------------------- */

  /*
   * The hierarchy view spans the merged structure, not only what this pass created.
   *
   * `PROJECT` and `PHASE` come from the Phase-6 generator, so a view built from the decomposer's own
   * nodes reported the hierarchy as "milestone → epic → task" — which reads as though the plan has no
   * project or phases at all. It also meant the fake-hierarchy check never looked at a phase, so a
   * phase holding one milestone would have gone unreported.
   */
  const allNodes = [...graph.nodes, ...collapsed.nodes];
  const allEdges = [...graph.edges, ...collapsed.edges];

  const hierarchyNodes: HierarchyNode[] = allNodes.map((node) => ({
    id: node.id,
    class: node.class,
    label: node.label,
    childIds: allEdges.filter((e) => e.class === 'CONTAINS' && e.from === node.id).map((e) => e.to),
    isMarker: node.attributes.kind === 'PHASE_MARKER',
  }));

  return {
    nodes: collapsed.nodes,
    edges: collapsed.edges,
    hierarchy,
    actualLevels: actualDepth(hierarchyNodes),
    decomposerVersion: DECOMPOSER_VERSION,
    fakeHierarchy: findFakeHierarchy(hierarchyNodes),
    notDecomposed,
  };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Levels that exist to group work. A container of one of these holding one thing is noise.
 *
 * `MILESTONE` is included because in this engine a milestone genuinely is in the task chain — the
 * §17 solo example is Project → Phase → Milestone → Task. A milestone marking a phase that contains
 * one task is a row in every view that separates nothing, and excluding it here meant the decomposer
 * reported fake hierarchy it had itself created.
 */
const GROUPING_LEVELS: ReadonlySet<string> = new Set(['WORKSTREAM', 'MILESTONE', 'EPIC']);

/**
 * Remove grouping containers that hold fewer than two things.
 *
 * Runs to a fixed point: collapsing an epic can leave its milestone holding one child, which then
 * collapses too. Bounded by the node count so a malformed containment graph cannot loop — the twin's
 * invariants refuse cycles, but this must terminate on input that has not been checked yet.
 */
function collapseSingletons(
  nodes: readonly TwinNode[],
  edges: readonly TwinEdge[],
): { nodes: TwinNode[]; edges: TwinEdge[] } {
  let currentNodes = [...nodes];
  let currentEdges = [...edges];

  // One pass per node is a bound, not an index: collapsing one container can leave its parent holding
  // a single child, so the loop runs to a fixed point. The bound exists so a malformed containment
  // graph cannot loop forever — the twin's invariants refuse cycles, but this runs before they do.
  for (const _bound of nodes) {
    const childrenOf = new Map<string, string[]>();
    const parentOf = new Map<string, string>();

    for (const edge of currentEdges) {
      if (edge.class !== 'CONTAINS') continue;
      const children = childrenOf.get(edge.from) ?? [];
      children.push(edge.to);
      childrenOf.set(edge.from, children);
      parentOf.set(edge.to, edge.from);
    }

    const doomed = currentNodes.find(
      (node) =>
        GROUPING_LEVELS.has(node.class) &&
        // A phase marker holds nothing by design: it says when a phase is finished. Collapsing it
        // would delete the only intermediate progress signal the plan has.
        node.attributes.kind !== 'PHASE_MARKER' &&
        (childrenOf.get(node.id) ?? []).length < 2,
    );

    if (doomed === undefined) break;

    const children = childrenOf.get(doomed.id) ?? [];
    const grandparent = parentOf.get(doomed.id);

    currentNodes = currentNodes.filter((n) => n.id !== doomed.id);
    currentEdges = currentEdges.filter(
      (e) => !(e.class === 'CONTAINS' && (e.from === doomed.id || e.to === doomed.id)),
    );

    // Re-parent whatever it held, so nothing is orphaned by the collapse.
    if (grandparent !== undefined) {
      for (const child of children) {
        currentEdges.push({
          id: `${grandparent}->CONTAINS->${child}`,
          projectId: doomed.projectId,
          class: 'CONTAINS',
          from: grandparent,
          to: child,
          rationale: `Folded up from “${doomed.label}”, which grouped a single item.`,
          createdAt: doomed.createdAt,
        });
      }
    }

    // Any other edge pointing at the removed node would dangle.
    currentEdges = currentEdges.filter((e) => e.from !== doomed.id && e.to !== doomed.id);
  }

  // De-duplicate: re-parenting can produce an edge that already existed.
  const seen = new Set<string>();
  currentEdges = currentEdges.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });

  return { nodes: currentNodes, edges: currentEdges };
}

/**
 * Phase keys in dependency order.
 *
 * Uses the graph's own topological sort so the ordering matches what the plan says rather than the
 * order phases happen to be stored in.
 */
function orderedPhaseKeys(
  graph: TwinGraph,
  phases: readonly TwinNode[],
  phaseKeyOf: (node: TwinNode) => string,
): readonly string[] {
  const order = graph.topologicalOrder('DEPENDS_ON');
  if (!order.ok) return phases.map(phaseKeyOf);

  const byId = new Map(phases.map((p) => [p.id, p]));
  const keys: string[] = [];

  for (const nodeId of order.order) {
    const phase = byId.get(nodeId);
    if (phase !== undefined) keys.push(phaseKeyOf(phase));
  }

  return keys;
}

/**
 * Which family of work a task belongs to, taken from the rule that required it.
 *
 * Rule-id prefixes are the closest thing to a natural grouping the engine has, and they correspond
 * to how teams actually divide. Inventing a separate taxonomy here would produce groupings nobody
 * recognises.
 */
function groupOf(ruleId: string): string {
  const prefix = ruleId.split('-')[0] ?? 'GEN';
  return prefix.toLowerCase();
}

/** A readable name for a generated container. */
function labelFor(level: string, group: string, phaseLabel: string): string {
  if (level === 'MILESTONE') return `${phaseLabel} complete`;
  if (level === 'WORKSTREAM') return `${describeGroup(group)} — ${phaseLabel}`;
  return describeGroup(group);
}

/** `sec` → `Security`. The rule-id prefixes, in language a person recognises. */
function describeGroup(group: string): string {
  const labels: Record<string, string> = {
    sec: 'Security',
    qa: 'Testing',
    dis: 'Discovery',
    req: 'Requirements',
    arc: 'Architecture',
    pln: 'Planning',
    res: 'Resourcing',
    bud: 'Budget',
    a11y: 'Accessibility',
    dep: 'Deployment',
    prd: 'Production verification',
    ops: 'Operations',
    doc: 'Documentation',
    gov: 'Governance',
  };

  return labels[group] ?? group.toUpperCase();
}

/** The last path segment of a node id, for building a readable derived id. */
function shortKey(nodeId: string): string {
  const parts = nodeId.split(':');
  return parts[parts.length - 1] ?? nodeId;
}

/**
 * Assemble the decomposition into a graph alongside what was already there.
 *
 * Separate from `decompose` so the caller can inspect the result before committing to it — the plan
 * page shows what would be created before anything is written.
 */
export function mergeIntoGraph(existing: TwinGraph, result: DecompositionResult): TwinGraph {
  const existingIds = new Set(existing.nodes.map((n) => n.id));
  const existingEdgeIds = new Set(existing.edges.map((e) => e.id));

  return new Graph({
    projectId: existing.projectId,
    nodes: [...existing.nodes, ...result.nodes.filter((n) => !existingIds.has(n.id))],
    edges: [...existing.edges, ...result.edges.filter((e) => !existingEdgeIds.has(e.id))],
  });
}
