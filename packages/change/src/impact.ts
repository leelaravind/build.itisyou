/**
 * Impact traversal.
 *
 * Given a set of changed nodes, what else in the project is affected, how badly, and *by what path*.
 *
 * The path is not a nicety. "47 items affected" is a number nobody can act on or dispute; "the
 * deployment approval is invalidated because it approved a deployment that implements a requirement
 * you changed" is something a reader can follow and disagree with. An impact analysis nobody can
 * check is one people stop believing the first time it is wrong, and after that it is worse than
 * having none.
 *
 * Two properties are load-bearing:
 *
 * **Bounded.** §26.1 requires the graph to work at 2,000 nodes. Traversal is breadth-first with a
 * visited set and a depth limit, so it is linear in edges and cannot loop — `DEPENDS_ON` cycles are
 * invalid but they exist in real projects, and an impact analyser that hangs on one is useless
 * exactly when somebody is trying to understand a mess.
 *
 * **Deterministic.** Same graph and same change produce byte-identical output, so a preview shown to
 * a user and the recalculation performed on apply cannot disagree.
 */

import type { TwinGraph } from '@govintel/twin/graph';
import type { TwinNode } from '@govintel/twin/nodes';
import type { EdgeClass } from '@govintel/twin/edges';
import {
  bearsClaim,
  effectOf,
  ruleFor,
  weaken,
  worse,
  type ChangeKind,
  type Staleness,
} from './propagation.ts';

export const IMPACT_VERSION = '1.0.0';

/**
 * How far impact travels.
 *
 * Four hops, not unlimited. Beyond four the effect has weakened to CURRENT anyway — three `weaken`
 * steps exhaust the scale — so the limit costs nothing in fidelity and guarantees termination on
 * pathological graphs independently of the visited set.
 */
export const MAX_DEPTH = 4;

export interface ChangedNode {
  readonly nodeId: string;
  readonly kind: ChangeKind;
  /** What changed, in the user's words. Carried into the impact report unaltered. */
  readonly summary: string;
}

export interface ImpactPath {
  readonly fromId: string;
  readonly edge: string;
  readonly toId: string;
  /** The rule's own reasoning, so the path explains itself hop by hop. */
  readonly because: string;
}

export interface ImpactedNode {
  readonly nodeId: string;
  readonly label: string;
  readonly nodeClass: string;
  readonly staleness: Staleness;
  /** Hops from the nearest changed node. */
  readonly distance: number;
  /**
   * The path that produced the worst staleness for this node.
   *
   * One path rather than all of them: a node reachable eleven ways produces eleven explanations
   * nobody reads. The one that caused the verdict is the one worth showing.
   */
  readonly path: readonly ImpactPath[];
  /** Whether this is something a person has to act on rather than a node the impact passed through. */
  readonly actionable: boolean;
}

export interface ImpactReport {
  readonly version: string;
  readonly changed: readonly ChangedNode[];
  /** Every affected node, worst first, then by id so the order is stable. */
  readonly impacted: readonly ImpactedNode[];
  /** Nodes the traversal could not resolve. Reported rather than skipped. */
  readonly unresolved: readonly string[];
  /**
   * Whether the traversal hit its depth limit.
   *
   * Surfaced rather than swallowed: a truncated analysis presented as complete is the specific way
   * an impact tool lies. Nobody can tell from the output that something was left out.
   */
  readonly truncated: boolean;
}

/* -------------------------------------------------------------------------- */
/* Traversal                                                                  */
/* -------------------------------------------------------------------------- */

interface Frontier {
  readonly nodeId: string;
  readonly staleness: Staleness;
  readonly distance: number;
  readonly path: readonly ImpactPath[];
}

/**
 * Everything affected by a set of changes.
 *
 * Breadth-first from all changed nodes at once, so a node reachable from two changes gets the worse
 * of the two verdicts rather than whichever happened to arrive first.
 */
export function analyseImpact(graph: TwinGraph, changes: readonly ChangedNode[]): ImpactReport {
  const best = new Map<string, Frontier>();
  const unresolved: string[] = [];
  let truncated = false;

  // Sorted so the traversal order does not depend on how the caller assembled the list. Two callers
  // describing the same change in different orders must produce identical reports.
  const seeds = [...changes].sort((a, b) => a.nodeId.localeCompare(b.nodeId));

  let frontier: Frontier[] = [];

  for (const change of seeds) {
    if (graph.node(change.nodeId) === undefined) {
      unresolved.push(change.nodeId);
      continue;
    }

    frontier.push({ nodeId: change.nodeId, staleness: 'CURRENT', distance: 0, path: [] });
  }

  const changedIds = new Set(seeds.map((c) => c.nodeId));
  const kindOf = new Map(seeds.map((c) => [c.nodeId, c.kind]));

  for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0; depth += 1) {
    const next: Frontier[] = [];

    for (const current of frontier) {
      const node = graph.node(current.nodeId);
      if (node === undefined) continue;

      // The kind belongs to the *originating* change, not to the node being visited. A withdrawal
      // three hops out is still a withdrawal's impact, weakened by distance.
      const kind = kindOf.get(current.nodeId) ?? originKind(current, kindOf);

      for (const step of stepsFrom(graph, node)) {
        const rule = ruleFor(step.edge);
        if (rule === undefined) continue;

        const base = effectOf(rule, kind);
        if (base === undefined) continue;

        /*
         * Severity decays with distance, but reachability does not.
         *
         * The first version weakened once per hop and stopped there, which meant a `STALE` rule
         * produced nothing at all beyond the first hop — so §27's own worked example, "architecture
         * component changed → costs", never arrived: the estimate is two hops out through
         * `DERIVED_FROM`, and the effect had already decayed to CURRENT.
         *
         * `STALE` is therefore the floor for anything reachable through propagating edges within the
         * depth limit. That is honest — it *is* downstream of a change, and STALE means precisely
         * "may still hold; somebody has to look". Only the stronger verdicts decay.
         */
        let effect: Staleness = base;
        for (let i = 0; i < current.distance; i += 1) effect = weaken(effect);

        effect = worse(effect, 'STALE');

        const candidate: Frontier = {
          nodeId: step.toId,
          staleness: effect,
          distance: current.distance + 1,
          path: [
            ...current.path,
            {
              fromId: current.nodeId,
              edge: step.edge,
              toId: step.toId,
              because: rule.because,
            },
          ],
        };

        // A changed node is not "impacted by itself". It is reported in `changed`, and listing it
        // in both would double-count the thing the reader already knows about.
        if (changedIds.has(step.toId)) continue;

        const existing = best.get(step.toId);

        if (existing === undefined) {
          best.set(step.toId, candidate);
          next.push(candidate);
          continue;
        }

        const combined = worse(existing.staleness, candidate.staleness);

        // Replace only when this path is genuinely worse. Ties keep the first path found, which is
        // the shortest — breadth-first guarantees it — and the shortest path is the most readable.
        if (combined === candidate.staleness && combined !== existing.staleness) {
          best.set(step.toId, candidate);
          next.push(candidate);
        }
      }
    }

    frontier = next;

    if (depth === MAX_DEPTH - 1 && next.length > 0) truncated = true;
  }

  const impacted = [...best.values()]
    .map((entry): ImpactedNode => {
      const node = graph.requireNode(entry.nodeId);

      return {
        nodeId: entry.nodeId,
        label: node.label,
        nodeClass: node.class,
        staleness: entry.staleness,
        distance: entry.distance,
        path: entry.path,
        actionable: bearsClaim(node.class),
      };
    })
    .sort(byWorstThenId);

  return {
    version: IMPACT_VERSION,
    changed: seeds,
    impacted,
    unresolved,
    truncated,
  };
}

interface Step {
  readonly edge: EdgeClass;
  readonly toId: string;
}

/**
 * Every edge out of a node that could carry impact, in a stable order.
 *
 * Both directions are walked, because propagation direction is a property of the *rule* rather than
 * of the traversal: a test verifies a requirement, so impact from the requirement reaches the test by
 * walking that edge backwards.
 */
function stepsFrom(graph: TwinGraph, node: TwinNode): readonly Step[] {
  const steps: Step[] = [];

  for (const edge of graph.edgesFrom(node.id)) {
    const rule = ruleFor(edge.class);
    if (rule?.direction === 'OUTBOUND') steps.push({ edge: edge.class, toId: edge.to });
  }

  for (const edge of graph.edgesTo(node.id)) {
    const rule = ruleFor(edge.class);
    if (rule?.direction === 'INBOUND') steps.push({ edge: edge.class, toId: edge.from });
  }

  // Sorted so traversal does not depend on edge insertion order. Determinism is asserted by a test,
  // and without this the impacted order would drift between runs on the same data.
  return steps.sort((a, b) => a.toId.localeCompare(b.toId) || a.edge.localeCompare(b.edge));
}

/**
 * The change kind that started this path.
 *
 * Reads the root of the path rather than carrying the kind through the frontier, which would need
 * one more field on every entry for information already present.
 */
function originKind(current: Frontier, kindOf: ReadonlyMap<string, ChangeKind>): ChangeKind {
  const root = current.path[0]?.fromId;
  return (root === undefined ? undefined : kindOf.get(root)) ?? 'MATERIAL';
}

const ORDER: Readonly<Record<Staleness, number>> = {
  INVALIDATED: 0,
  REVALIDATION_REQUIRED: 1,
  STALE: 2,
  CURRENT: 3,
};

function byWorstThenId(a: ImpactedNode, b: ImpactedNode): number {
  // Actionable first within the same severity: a stale EVIDENCE is something somebody does
  // something about, and a stale PHASE is something the impact passed through.
  return (
    ORDER[a.staleness] - ORDER[b.staleness] ||
    Number(b.actionable) - Number(a.actionable) ||
    a.nodeId.localeCompare(b.nodeId)
  );
}

/* -------------------------------------------------------------------------- */
/* Summary                                                                    */
/* -------------------------------------------------------------------------- */

export interface ImpactSummary {
  readonly headline: string;
  /** Counts by staleness. Absolute numbers, never a proportion of the project. */
  readonly counts: Readonly<Record<Staleness, number>>;
  /** The single thing most worth looking at, or null when nothing is affected. */
  readonly worst: ImpactedNode | null;
}

export function summariseImpact(report: ImpactReport): ImpactSummary {
  const counts: Record<Staleness, number> = {
    CURRENT: 0,
    STALE: 0,
    REVALIDATION_REQUIRED: 0,
    INVALIDATED: 0,
  };

  for (const item of report.impacted) counts[item.staleness] += 1;

  const actionable = report.impacted.filter((item) => item.actionable);

  if (report.impacted.length === 0) {
    return {
      headline:
        'Nothing else in the project depends on what you changed. That is a real answer, not an empty one — it means no test, evidence or approval points at it.',
      counts,
      worst: null,
    };
  }

  const invalidated = counts.INVALIDATED;
  const headline =
    invalidated > 0
      ? `${String(invalidated)} thing${invalidated === 1 ? '' : 's'} no longer hold${invalidated === 1 ? 's' : ''}, and ${String(report.impacted.length - invalidated)} more need${report.impacted.length - invalidated === 1 ? 's' : ''} looking at.`
      : `${String(report.impacted.length)} thing${report.impacted.length === 1 ? '' : 's'} need${report.impacted.length === 1 ? 's' : ''} looking at. Nothing is outright invalidated.`;

  return {
    headline: report.truncated
      ? `${headline} The analysis stopped at ${String(MAX_DEPTH)} hops.`
      : headline,
    counts,
    worst: actionable[0] ?? report.impacted[0] ?? null,
  };
}
