/**
 * Architecture components and decisions.
 *
 * Two things live here, and the second is the one that pays for itself.
 *
 * A *component* is a piece of the system that can satisfy requirements. Recording those lets the
 * chain reach from a requirement to the work that builds it.
 *
 * A *decision* is a choice that constrains everything downstream. The reason to record them is not
 * documentation; it is that six months later somebody will want to do the obvious thing, and the
 * only way to know whether the obvious thing was already considered and rejected is if the rejection
 * was written down at the time. So a decision that records only what was chosen is refused: it is a
 * record of a conclusion, not of a decision, and it cannot answer the question it exists to answer.
 *
 * Contract: gap-spec §15.3 (Architecture Gate), §8.1 (node classes).
 */

import type { TwinGraph } from '@govintel/twin/graph';
import type { TwinNode } from '@govintel/twin/nodes';

/* -------------------------------------------------------------------------- */
/* Components                                                                 */
/* -------------------------------------------------------------------------- */

export const COMPONENT_KINDS = [
  'UI',
  'API',
  'SERVICE',
  'DATASTORE',
  'JOB',
  'INTEGRATION',
  'INFRASTRUCTURE',
] as const;

export type ComponentKind = (typeof COMPONENT_KINDS)[number];

/**
 * Layers, ordered outermost to innermost.
 *
 * The order is the whole point: it defines which direction a dependency may run. Everything else in
 * this file is bookkeeping; this is the constraint that stops a modular monolith becoming a ball of
 * mud one reasonable-looking import at a time.
 */
export const LAYERS = ['PRESENTATION', 'APPLICATION', 'DOMAIN', 'INFRASTRUCTURE'] as const;

export type Layer = (typeof LAYERS)[number];

const LAYER_INDEX: Readonly<Record<Layer, number>> = {
  PRESENTATION: 0,
  APPLICATION: 1,
  DOMAIN: 2,
  INFRASTRUCTURE: 3,
};

/**
 * Which layer may depend on which.
 *
 * Inward and same-layer are legal; outward is not. `DOMAIN → INFRASTRUCTURE` is the interesting case
 * and it is deliberately **illegal**: domain logic that reaches into infrastructure cannot be tested
 * or reasoned about without it, which is the property that makes domain logic worth separating in the
 * first place. Infrastructure is depended *upon* through an interface the domain owns, so the arrow
 * points inward at the type level even where the call goes outward at runtime.
 */
export function mayDependOn(from: Layer, to: Layer): boolean {
  if (from === to) return true;
  if (from === 'DOMAIN') return false;
  return LAYER_INDEX[from] < LAYER_INDEX[to];
}

export interface Component {
  readonly id: string;
  readonly label: string;
  readonly kind: ComponentKind;
  readonly layer: Layer;
  /** What this exists to do. A component with no stated purpose cannot be argued out of existence. */
  readonly responsibility: string;
}

/* -------------------------------------------------------------------------- */
/* Decisions                                                                  */
/* -------------------------------------------------------------------------- */

export const DECISION_STATES = ['PROPOSED', 'ACCEPTED', 'REJECTED', 'SUPERSEDED'] as const;

export type DecisionState = (typeof DECISION_STATES)[number];

export interface Alternative {
  readonly option: string;
  /** Why this was not chosen. The single most useful sentence in any decision record. */
  readonly rejectedBecause: string;
}

export interface Decision {
  readonly id: string;
  readonly title: string;
  readonly state: DecisionState;
  /** The situation that forced a choice. Without it the decision reads as arbitrary preference. */
  readonly context: string;
  readonly chosen: string;
  readonly alternatives: readonly Alternative[];
  /**
   * What this makes harder, not only what it makes possible.
   *
   * Recording only benefits produces a decision log that reads as a series of unambiguous wins, which
   * is never what happened and is useless for deciding whether to revisit.
   */
  readonly consequences: readonly string[];
  /** Set only on `SUPERSEDED`. The decision that replaced this one. */
  readonly supersededBy?: string;
}

/* -------------------------------------------------------------------------- */
/* Defects                                                                    */
/* -------------------------------------------------------------------------- */

export const ARCHITECTURE_DEFECTS = [
  /** A dependency running outward through the layers. */
  'ILLEGAL_LAYER_DEPENDENCY',
  /** A component satisfying no requirement. Something is being built that nobody asked for. */
  'UNJUSTIFIED_COMPONENT',
  /** A decision recording no alternatives. A conclusion, not a decision. */
  'DECISION_WITHOUT_ALTERNATIVES',
  /** A decision recording no consequences. */
  'DECISION_WITHOUT_CONSEQUENCES',
  /** Marked `SUPERSEDED` with nothing named as the successor. */
  'SUPERSEDED_BY_NOTHING',
  /** Named as a successor by a superseded decision that does not exist. */
  'DANGLING_SUCCESSOR',
  /** A cycle among components. */
  'COMPONENT_CYCLE',
  /** A component still `PROPOSED` that work already depends on. */
  'BUILDING_ON_A_PROPOSAL',
] as const;

export type ArchitectureDefect = (typeof ARCHITECTURE_DEFECTS)[number];

export interface ArchitectureFinding {
  readonly defect: ArchitectureDefect;
  readonly summary: string;
  readonly why: string;
  /** Node ids a reader can go and look at. A finding with no evidence is an assertion. */
  readonly evidence: readonly string[];
  readonly blocking: boolean;
}

/**
 * Every architecture defect in the graph, in a fixed order.
 *
 * Deterministic: the graph's own node ordering drives the walk, so two runs over the same graph
 * produce byte-identical output.
 */
export function checkArchitecture(graph: TwinGraph): readonly ArchitectureFinding[] {
  const findings: ArchitectureFinding[] = [];

  const components = graph.nodesOfClass('ARCHITECTURE_COMPONENT');
  const decisions = graph.nodesOfClass('ARCHITECTURE_DECISION');
  const decisionIds = new Set(decisions.map((d) => d.id));

  for (const node of components) {
    const layer = layerOf(node);
    if (layer === undefined) continue;

    for (const edge of graph.edgesFrom(node.id, 'DEPENDS_ON')) {
      const target = graph.node(edge.to);
      if (target?.class !== 'ARCHITECTURE_COMPONENT') continue;

      const targetLayer = layerOf(target);
      if (targetLayer === undefined) continue;

      if (!mayDependOn(layer, targetLayer)) {
        findings.push({
          defect: 'ILLEGAL_LAYER_DEPENDENCY',
          summary: `${node.label} (${layer}) depends on ${target.label} (${targetLayer}).`,
          why:
            targetLayer === 'INFRASTRUCTURE' && layer === 'DOMAIN'
              ? 'Domain logic that reaches into infrastructure cannot be tested or reasoned about without it, which is the property that made separating the domain worth doing.'
              : 'Dependencies run inward. An outward one means the inner layer now changes whenever the outer one does, which is the direction the layering exists to prevent.',
          evidence: [node.id, target.id],
          blocking: true,
        });
      }
    }

    // A component satisfying nothing is either scope nobody asked for, or a requirement nobody
    // recorded. Both are worth surfacing, and the graph cannot tell which it is — so the finding
    // says so rather than guessing.
    // `IMPLEMENTS`, not `SATISFIES`. The twin's edge model reserves `SATISFIES` for requirement →
    // objective and evidence → requirement; a component realises a requirement, which is
    // `IMPLEMENTS`. Using the wrong one here reported every component as unjustified, because the
    // edge it looked for could not legally exist.
    if (graph.edgesFrom(node.id, 'IMPLEMENTS').length === 0) {
      findings.push({
        defect: 'UNJUSTIFIED_COMPONENT',
        summary: `${node.label} satisfies no recorded requirement.`,
        why: 'Either this is being built for a reason nobody wrote down, or it is scope nobody asked for. The graph cannot tell which, and both are worth knowing before it is built.',
        evidence: [node.id],
        blocking: false,
      });
    }

    // `maturity` is a component attribute rather than a node state: `NodeState` records whether the
    // node is still current (ACTIVE / SUPERSEDED / WITHDRAWN), which is a different question from
    // whether the choice it represents has been made.
    if (node.attributes.maturity === 'PROPOSED') {
      const dependants = graph
        .edgesTo(node.id, 'DEPENDS_ON')
        .map((edge) => graph.node(edge.from))
        .filter((n): n is TwinNode => n !== undefined && n.class !== 'ARCHITECTURE_COMPONENT');

      if (dependants.length > 0) {
        findings.push({
          defect: 'BUILDING_ON_A_PROPOSAL',
          summary: `${dependants.length} item(s) depend on ${node.label}, which is still proposed.`,
          why: 'Work committed against an undecided component pays for the decision twice if it goes the other way — and by then reversing it is expensive enough that the decision effectively gets made by the work.',
          evidence: [node.id, ...dependants.map((d) => d.id)],
          blocking: false,
        });
      }
    }
  }

  for (const cycle of graph.findCycles('DEPENDS_ON')) {
    const inComponents = cycle.every((id) => graph.node(id)?.class === 'ARCHITECTURE_COMPONENT');
    if (!inComponents) continue;

    findings.push({
      defect: 'COMPONENT_CYCLE',
      summary: `Components form a cycle: ${cycle.join(' → ')}.`,
      why: 'Neither component can be built, tested, deployed or understood without the other, so they are one component with a line drawn through it.',
      evidence: [...cycle],
      blocking: true,
    });
  }

  for (const node of decisions) {
    const decision = decisionFromNode(node);
    if (decision === undefined) continue;

    if (decision.alternatives.length === 0) {
      findings.push({
        defect: 'DECISION_WITHOUT_ALTERNATIVES',
        summary: `${decision.title} records no alternatives.`,
        why: 'The reason to record a decision is so that when somebody later proposes the obvious thing, there is a record of whether it was already considered. A record of only what was chosen cannot answer that.',
        evidence: [node.id],
        blocking: decision.state === 'ACCEPTED',
      });
    }

    if (decision.consequences.length === 0) {
      findings.push({
        defect: 'DECISION_WITHOUT_CONSEQUENCES',
        summary: `${decision.title} records no consequences.`,
        why: 'A decision log where every entry is an unambiguous win is not what happened, and it gives no basis for deciding whether to revisit one.',
        evidence: [node.id],
        blocking: false,
      });
    }

    if (decision.state === 'SUPERSEDED') {
      if (decision.supersededBy === undefined) {
        findings.push({
          defect: 'SUPERSEDED_BY_NOTHING',
          summary: `${decision.title} is marked superseded but names no successor.`,
          why: 'A reader arriving at this decision learns only that it is no longer true, not what is. That is worse than no record: it removes the answer without replacing it.',
          evidence: [node.id],
          blocking: false,
        });
      } else if (!decisionIds.has(decision.supersededBy)) {
        findings.push({
          defect: 'DANGLING_SUCCESSOR',
          summary: `${decision.title} names ${decision.supersededBy} as its successor, which does not exist.`,
          why: 'The pointer resolves to nothing, so the current position is unrecoverable from the record.',
          evidence: [node.id],
          blocking: false,
        });
      }
    }
  }

  return findings;
}

/* -------------------------------------------------------------------------- */
/* Reading out of the twin                                                    */
/* -------------------------------------------------------------------------- */

export function componentFromNode(node: TwinNode): Component | undefined {
  if (node.class !== 'ARCHITECTURE_COMPONENT') return undefined;

  const kind = node.attributes.kind;
  const layer = node.attributes.layer;

  if (!isKind(kind) || !isLayer(layer)) return undefined;

  return {
    id: node.id,
    label: node.label,
    kind,
    layer,
    responsibility:
      typeof node.attributes.responsibility === 'string' ? node.attributes.responsibility : '',
  };
}

export function decisionFromNode(node: TwinNode): Decision | undefined {
  if (node.class !== 'ARCHITECTURE_DECISION') return undefined;

  const state = node.attributes.state;
  if (!isDecisionState(state)) return undefined;

  const supersededBy = node.attributes.supersededBy;

  return {
    id: node.id,
    title: node.label,
    state,
    context: typeof node.attributes.context === 'string' ? node.attributes.context : '',
    chosen: typeof node.attributes.chosen === 'string' ? node.attributes.chosen : '',
    alternatives: readAlternatives(node.attributes.alternatives),
    consequences: readStrings(node.attributes.consequences),
    ...(typeof supersededBy === 'string' ? { supersededBy } : {}),
  };
}

function layerOf(node: TwinNode): Layer | undefined {
  const layer = node.attributes.layer;
  return isLayer(layer) ? layer : undefined;
}

function readAlternatives(value: unknown): readonly Alternative[] {
  if (!Array.isArray(value)) return [];

  return value.filter((entry): entry is Alternative => {
    if (typeof entry !== 'object' || entry === null) return false;
    const record = entry as Record<string, unknown>;
    // An alternative with no reason for its rejection is the same failure as a decision with no
    // alternatives, one level down — so it is dropped rather than counted towards the check.
    return typeof record.option === 'string' && typeof record.rejectedBecause === 'string';
  });
}

function readStrings(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function isKind(value: unknown): value is ComponentKind {
  return typeof value === 'string' && (COMPONENT_KINDS as readonly string[]).includes(value);
}

function isLayer(value: unknown): value is Layer {
  return typeof value === 'string' && (LAYERS as readonly string[]).includes(value);
}

function isDecisionState(value: unknown): value is DecisionState {
  return typeof value === 'string' && (DECISION_STATES as readonly string[]).includes(value);
}
