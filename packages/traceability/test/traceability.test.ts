import { describe, expect, it } from 'vitest';
import { TwinGraph } from '@govintel/twin/graph';
import { createNode, type NodeClass, type TwinNode } from '@govintel/twin/nodes';
import { checkEdgeLegality, type EdgeClass, type TwinEdge } from '@govintel/twin/edges';
import {
  PRIORITIES,
  QUALITY_ATTRIBUTES,
  REQUIREMENT_DEFECTS,
  REQUIREMENT_KINDS,
  VERIFICATION_METHODS,
  checkRequirement,
  requirementFromNode,
  type Requirement,
} from '../src/requirements.ts';
import {
  ARCHITECTURE_DEFECTS,
  DECISION_STATES,
  LAYERS,
  checkArchitecture,
  decisionFromNode,
  mayDependOn,
} from '../src/architecture.ts';
import {
  CHAIN,
  HOP_KEYS,
  LINK_STATUSES,
  traceAll,
  traceRequirement,
  type LinkStatus,
} from '../src/chain.ts';
import { GAP_KINDS, analyse, brokenHops, summarise } from '../src/gaps.ts';
import { generateProject } from '@govintel/twin/generate';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const AT = '2026-01-01T00:00:00.000Z';
const PROJECT = 'p1';

function node(
  id: string,
  nodeClass: NodeClass,
  attributes: Record<string, unknown> = {},
  overrides: Partial<TwinNode> = {},
): TwinNode {
  return {
    ...createNode({
      id,
      projectId: PROJECT,
      class: nodeClass,
      label: id,
      provenance: { provenance: 'DETERMINISTIC_CALCULATION', confidence: 'HIGH' },
      attributes,
      at: AT,
    }),
    ...overrides,
  };
}

function edge(from: string, to: string, edgeClass: EdgeClass): TwinEdge {
  return {
    id: `${from}:${edgeClass}:${to}`,
    projectId: PROJECT,
    class: edgeClass,
    from,
    to,
    createdAt: AT,
  };
}

function graphOf(nodes: readonly TwinNode[], edges: readonly TwinEdge[] = []): TwinGraph {
  return new TwinGraph({ projectId: PROJECT, nodes, edges });
}

function requirement(overrides: Partial<Requirement> = {}): Requirement {
  return {
    id: 'r1',
    projectId: PROJECT,
    kind: 'FUNCTIONAL',
    label: 'Record a patient appointment',
    description: 'A clinician can record an appointment against a patient record.',
    priority: 'MUST',
    verification: ['TEST'],
    acceptance: [{ id: 'a1', statement: 'An appointment saved is visible on the patient record.' }],
    sourceRef: 'intake:capabilities',
    revision: 1,
    ...overrides,
  };
}

/**
 * A graph with one requirement and a complete, current chain through to evidence.
 *
 * Built once and mutated per test rather than assembled by hand in each, so that a test asserting a
 * *gap* differs from the healthy case in exactly the one respect it is about. Hand-assembling each
 * one produces tests that pass for reasons unrelated to their name.
 */
function healthyChain(): { nodes: TwinNode[]; edges: TwinEdge[] } {
  return {
    nodes: [
      node('proj', 'PROJECT'),
      node('r1', 'REQUIREMENT', {
        kind: 'FUNCTIONAL',
        priority: 'MUST',
        verification: ['TEST'],
        acceptance: [{ id: 'a1', statement: 'It is visible.' }],
        sourceRef: 'intake:capabilities',
      }),
      node('c1', 'ARCHITECTURE_COMPONENT', { kind: 'API', layer: 'APPLICATION' }),
      node('t1', 'TASK'),
      node('test1', 'TEST', {
        outcome: 'PASSED',
        attests: [{ nodeId: 'r1', revision: 1 }],
      }),
      node('e1', 'EVIDENCE', {
        hash: 'sha256:abc',
        attests: [{ nodeId: 'r1', revision: 1 }],
      }),
    ],
    edges: [
      edge('c1', 'r1', 'IMPLEMENTS'),
      edge('t1', 'r1', 'IMPLEMENTS'),
      edge('test1', 'r1', 'VERIFIES'),
      edge('test1', 'e1', 'EVIDENCED_BY'),
    ],
  };
}

/** A confirmed intake answer. The generator reads `state`, so anything less would not trigger a rule. */
function field(fieldId: string, value: unknown) {
  return {
    fieldId,
    category: 'DATA_TYPES' as const,
    value,
    state: 'CONFIRMED' as const,
    provenance: 'USER_CONFIRMED' as const,
    confidence: 'HIGH' as const,
    lastUpdatedAt: AT,
  };
}

/** The node class a hop departs from, resolved through the chain. */
function originClass(from: 'REQUIREMENT' | (typeof HOP_KEYS)[number]): NodeClass {
  if (from === 'REQUIREMENT') return 'REQUIREMENT';
  const hop = CHAIN.find((h) => h.key === from);
  if (hop === undefined) throw new Error(`unknown hop ${from}`);
  return hop.to;
}

/* -------------------------------------------------------------------------- */
/* Requirements                                                               */
/* -------------------------------------------------------------------------- */

describe('gap-spec §15.2: a requirement must be capable of being failed', () => {
  it('accepts a requirement with a method and criteria', () => {
    expect(checkRequirement(requirement())).toEqual([]);
  });

  it('refuses a requirement with no verification method', () => {
    /*
     * The defect that survives all the way to the release gate, where somebody has to decide on the
     * day whether an unfalsifiable statement was met.
     */
    const findings = checkRequirement(requirement({ verification: [] }));

    expect(findings.map((f) => f.defect)).toContain('UNVERIFIABLE');
    expect(findings.find((f) => f.defect === 'UNVERIFIABLE')?.blocking).toBe(true);
  });

  it('does not block on an unverifiable requirement that is only a SHOULD', () => {
    // Blocking release on a nice-to-have would teach people to mark everything COULD, which costs
    // more than the check saves.
    const findings = checkRequirement(requirement({ verification: [], priority: 'SHOULD' }));
    expect(findings.find((f) => f.defect === 'UNVERIFIABLE')?.blocking).toBe(false);
  });

  it('refuses a quality attribute with no measurable criterion', () => {
    // Quality attributes are exactly the ones that cannot be judged by looking. Without a number,
    // "satisfied" means whatever the person asked at the time believes.
    const findings = checkRequirement(
      requirement({
        kind: 'QUALITY_ATTRIBUTE',
        qualityAttribute: 'PERFORMANCE',
        label: 'Pages load promptly',
        description: 'Pages should load promptly for users on the clinic network.',
        acceptance: [{ id: 'a1', statement: 'Pages load promptly.' }],
      }),
    );

    expect(findings.map((f) => f.defect)).toContain('UNMEASURED_QUALITY_ATTRIBUTE');
  });

  it('accepts a quality attribute that states a measure', () => {
    const findings = checkRequirement(
      requirement({
        kind: 'QUALITY_ATTRIBUTE',
        qualityAttribute: 'PERFORMANCE',
        label: 'Appointment search returns within a bounded time',
        description: 'Search over the appointment index returns within a stated bound.',
        acceptance: [
          {
            id: 'a1',
            statement: 'Search returns within the stated bound.',
            measure: {
              metric: '95th-percentile search response',
              comparator: 'AT_MOST',
              value: 500,
              unit: 'ms',
              conditions: '50 concurrent clinicians, 2 million appointment rows',
            },
          },
        ],
      }),
    );

    expect(findings).toEqual([]);
  });

  it('reports a measure with no stated conditions', () => {
    // A target with no stated load is unfalsifiable in both directions: any measurement can be
    // dismissed as unrepresentative by whoever dislikes the result.
    const findings = checkRequirement(
      requirement({
        acceptance: [
          {
            id: 'a1',
            statement: 'Search returns within the bound.',
            measure: {
              metric: '95th-percentile search response',
              comparator: 'AT_MOST',
              value: 500,
              unit: 'ms',
            },
          },
        ],
      }),
    );

    expect(findings.map((f) => f.defect)).toContain('MEASURE_WITHOUT_CONDITIONS');
  });

  it('reports subjective wording without blocking on it', () => {
    const findings = checkRequirement(
      requirement({ description: 'The interface must be intuitive for clinicians.' }),
    );

    const subjective = findings.find((f) => f.defect === 'SUBJECTIVE_WORDING');

    expect(subjective).toBeDefined();

    // Advisory on purpose: blocking would train people to write requirements that pass the word
    // filter rather than requirements that can be failed, which is strictly worse.
    expect(subjective?.blocking).toBe(false);
  });

  it('names the offending word, so the finding can be acted on', () => {
    // "There is subjective wording somewhere in this requirement" sends the reader hunting. The
    // point of the check is that the fix is usually to say what the word stood in for.
    const findings = checkRequirement(
      requirement({ description: 'The system must be robust under load.' }),
    );

    expect(findings.find((f) => f.defect === 'SUBJECTIVE_WORDING')?.summary).toContain('robust');
  });

  it('reports a compound requirement', () => {
    // A compound requirement can be half-satisfied, and there is nowhere to record that: it is
    // either done or not, and both answers are wrong.
    const findings = checkRequirement(
      requirement({
        description: 'Appointments are recorded against a patient and also exported nightly.',
      }),
    );

    expect(findings.map((f) => f.defect)).toContain('COMPOUND');
  });

  it('refuses a regulatory requirement verified only by demonstration', () => {
    /*
     * A demonstration convinces the people in the room and nobody else. A regulator asking two years
     * later how this was satisfied needs something they can examine.
     */
    const findings = checkRequirement(
      requirement({ kind: 'REGULATORY', verification: ['DEMONSTRATION'] }),
    );

    const finding = findings.find((f) => f.defect === 'REGULATORY_WITHOUT_ARTEFACT');

    expect(finding).toBeDefined();
    expect(finding?.blocking).toBe(true);
  });

  it('accepts a regulatory requirement verified by inspection', () => {
    // Inspection leaves a record of what was read and by whom, which is the property that matters —
    // not that it was automated.
    const findings = checkRequirement(
      requirement({ kind: 'REGULATORY', verification: ['INSPECTION', 'DEMONSTRATION'] }),
    );

    expect(findings.map((f) => f.defect)).not.toContain('REGULATORY_WITHOUT_ARTEFACT');
  });

  it('reports a kind that disagrees with its attribute, in both directions', () => {
    const missing = checkRequirement(requirement({ kind: 'QUALITY_ATTRIBUTE' }));
    const spurious = checkRequirement(
      requirement({ kind: 'FUNCTIONAL', qualityAttribute: 'SECURITY' }),
    );

    expect(missing.map((f) => f.defect)).toContain('KIND_MISMATCH');
    expect(spurious.map((f) => f.defect)).toContain('KIND_MISMATCH');
  });

  it('reports an unsourced requirement', () => {
    // A requirement nobody can trace to a person or an answer cannot be renegotiated, which is how
    // requirements outlive the reason they existed.
    const findings = checkRequirement(requirement({ sourceRef: '   ' }));
    expect(findings.map((f) => f.defect)).toContain('UNSOURCED');
  });

  it('has no verification method meaning "somebody said so"', () => {
    // Asserted structurally. Adding an ASSERTION member later would be a visible change here, and
    // the absence of a method already carries that meaning without making it selectable.
    expect(VERIFICATION_METHODS).not.toContain('ASSERTION');
    expect(VERIFICATION_METHODS).toHaveLength(4);
  });

  it('keeps WONT as a priority rather than deleting decided-against requirements', () => {
    expect(PRIORITIES).toContain('WONT');
  });

  it('is deterministic', () => {
    const input = requirement({ verification: [], acceptance: [], sourceRef: '' });
    expect(JSON.stringify(checkRequirement(input))).toBe(JSON.stringify(checkRequirement(input)));
  });
});

describe('reading requirements out of the twin', () => {
  it('reads a well-formed requirement node', () => {
    const read = requirementFromNode(
      node('r1', 'REQUIREMENT', {
        kind: 'REGULATORY',
        priority: 'MUST',
        verification: ['INSPECTION'],
        acceptance: [{ id: 'a1', statement: 'The record exists.' }],
        sourceRef: 'rule:GDPR-ROPA-001',
      }),
    );

    expect(read?.kind).toBe('REGULATORY');
    expect(read?.verification).toEqual(['INSPECTION']);
  });

  it('refuses a node that does not record a kind, rather than guessing one', () => {
    /*
     * A half-read requirement would be checked against rules its missing halves cannot fail and would
     * report clean. `gaps.ts` turns this `undefined` into an explicit finding.
     */
    expect(requirementFromNode(node('r1', 'REQUIREMENT', { priority: 'MUST' }))).toBeUndefined();
  });

  it('drops unrecognised verification methods rather than carrying them through', () => {
    const read = requirementFromNode(
      node('r1', 'REQUIREMENT', {
        kind: 'FUNCTIONAL',
        priority: 'MUST',
        verification: ['TEST', 'VIBES', 42],
        acceptance: [],
        sourceRef: 's',
      }),
    );

    expect(read?.verification).toEqual(['TEST']);
  });

  it('returns undefined for a node of another class', () => {
    expect(requirementFromNode(node('t1', 'TASK'))).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* Architecture                                                               */
/* -------------------------------------------------------------------------- */

describe('gap-spec §15.3: architecture', () => {
  it('allows a dependency running inward', () => {
    expect(mayDependOn('PRESENTATION', 'APPLICATION')).toBe(true);
    expect(mayDependOn('APPLICATION', 'DOMAIN')).toBe(true);
  });

  it('refuses a dependency running outward', () => {
    expect(mayDependOn('DOMAIN', 'APPLICATION')).toBe(false);
    expect(mayDependOn('APPLICATION', 'PRESENTATION')).toBe(false);
  });

  it('refuses the domain depending on infrastructure', () => {
    /*
     * The interesting case, and the one most layering rules get wrong by treating infrastructure as
     * "innermost". Domain logic that reaches into infrastructure cannot be tested without it, which
     * is the property that made separating the domain worth doing.
     */
    expect(mayDependOn('DOMAIN', 'INFRASTRUCTURE')).toBe(false);
  });

  it('allows same-layer dependencies', () => {
    for (const layer of LAYERS) {
      expect(mayDependOn(layer, layer)).toBe(true);
    }
  });

  it('reports an illegal layer dependency with both components as evidence', () => {
    const graph = graphOf(
      [
        node('d', 'ARCHITECTURE_COMPONENT', { kind: 'SERVICE', layer: 'DOMAIN' }),
        node('i', 'ARCHITECTURE_COMPONENT', { kind: 'DATASTORE', layer: 'INFRASTRUCTURE' }),
      ],
      [edge('d', 'i', 'DEPENDS_ON')],
    );

    const finding = checkArchitecture(graph).find((f) => f.defect === 'ILLEGAL_LAYER_DEPENDENCY');

    expect(finding?.blocking).toBe(true);
    expect(finding?.evidence).toEqual(['d', 'i']);
  });

  it('refuses a decision that records no alternatives', () => {
    /*
     * The reason to record a decision is so that when somebody later proposes the obvious thing,
     * there is a record of whether it was already considered. A record of only what was chosen
     * cannot answer that, which is the question the record exists for.
     */
    const graph = graphOf([
      node('adr1', 'ARCHITECTURE_DECISION', {
        state: 'ACCEPTED',
        context: 'We need a database.',
        chosen: 'Postgres',
        consequences: ['Operational cost.'],
      }),
    ]);

    const finding = checkArchitecture(graph).find(
      (f) => f.defect === 'DECISION_WITHOUT_ALTERNATIVES',
    );

    expect(finding).toBeDefined();
    expect(finding?.blocking).toBe(true);
  });

  it('does not block an unaccepted decision for missing alternatives', () => {
    // A proposal is allowed to be incomplete. That is what makes it a proposal.
    const graph = graphOf([
      node('adr1', 'ARCHITECTURE_DECISION', {
        state: 'PROPOSED',
        chosen: 'Postgres',
        consequences: ['Operational cost.'],
      }),
    ]);

    expect(
      checkArchitecture(graph).find((f) => f.defect === 'DECISION_WITHOUT_ALTERNATIVES')?.blocking,
    ).toBe(false);
  });

  it('drops an alternative that records no reason for its rejection', () => {
    /*
     * An alternative listed with no reason is the same failure as a decision with no alternatives,
     * one level down: it proves somebody thought of the option and records nothing about why it lost.
     * Counting it would let a decision satisfy the check with a list of words.
     */
    const decision = decisionFromNode(
      node('adr1', 'ARCHITECTURE_DECISION', {
        state: 'ACCEPTED',
        chosen: 'Postgres',
        alternatives: [
          { option: 'MySQL' },
          { option: 'SQLite', rejectedBecause: 'No concurrency.' },
        ],
      }),
    );

    expect(decision?.alternatives).toHaveLength(1);
    expect(decision?.alternatives[0]?.option).toBe('SQLite');
  });

  it('reports a decision superseded by nothing', () => {
    // A reader learns only that this is no longer true, not what is. That removes the answer without
    // replacing it, which is worse than having had no record.
    const graph = graphOf([
      node('adr1', 'ARCHITECTURE_DECISION', {
        state: 'SUPERSEDED',
        chosen: 'Postgres',
        alternatives: [{ option: 'MySQL', rejectedBecause: 'Licensing.' }],
        consequences: ['Cost.'],
      }),
    ]);

    expect(checkArchitecture(graph).map((f) => f.defect)).toContain('SUPERSEDED_BY_NOTHING');
  });

  it('reports a successor that does not exist', () => {
    const graph = graphOf([
      node('adr1', 'ARCHITECTURE_DECISION', {
        state: 'SUPERSEDED',
        supersededBy: 'adr9',
        chosen: 'Postgres',
        alternatives: [{ option: 'MySQL', rejectedBecause: 'Licensing.' }],
        consequences: ['Cost.'],
      }),
    ]);

    expect(checkArchitecture(graph).map((f) => f.defect)).toContain('DANGLING_SUCCESSOR');
  });

  it('reports a component that satisfies no requirement', () => {
    // Either scope nobody asked for, or a requirement nobody wrote down. The finding says the graph
    // cannot tell which rather than picking one.
    const graph = graphOf([
      node('c1', 'ARCHITECTURE_COMPONENT', { kind: 'UI', layer: 'PRESENTATION' }),
    ]);

    const finding = checkArchitecture(graph).find((f) => f.defect === 'UNJUSTIFIED_COMPONENT');

    expect(finding?.why).toContain('cannot tell which');
  });

  it('reports work committed against a component that is still proposed', () => {
    const graph = graphOf(
      [
        node('c1', 'ARCHITECTURE_COMPONENT', {
          kind: 'SERVICE',
          layer: 'APPLICATION',
          maturity: 'PROPOSED',
        }),
        node('t1', 'TASK'),
      ],
      [edge('t1', 'c1', 'DEPENDS_ON')],
    );

    expect(checkArchitecture(graph).map((f) => f.defect)).toContain('BUILDING_ON_A_PROPOSAL');
  });

  it('reports a component cycle as one finding naming the whole cycle', () => {
    // Two components that cannot be built, tested or understood without each other are one component
    // with a line drawn through them.
    const graph = graphOf(
      [
        node('a', 'ARCHITECTURE_COMPONENT', { kind: 'SERVICE', layer: 'APPLICATION' }),
        node('b', 'ARCHITECTURE_COMPONENT', { kind: 'SERVICE', layer: 'APPLICATION' }),
      ],
      [edge('a', 'b', 'DEPENDS_ON'), edge('b', 'a', 'DEPENDS_ON')],
    );

    const cycles = checkArchitecture(graph).filter((f) => f.defect === 'COMPONENT_CYCLE');

    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.evidence).toContain('a');
    expect(cycles[0]?.evidence).toContain('b');
  });

  it('gives every architecture finding evidence to look at', () => {
    const graph = graphOf(
      [
        node('d', 'ARCHITECTURE_COMPONENT', { kind: 'SERVICE', layer: 'DOMAIN' }),
        node('i', 'ARCHITECTURE_COMPONENT', { kind: 'DATASTORE', layer: 'INFRASTRUCTURE' }),
        node('adr1', 'ARCHITECTURE_DECISION', { state: 'ACCEPTED', chosen: 'x' }),
      ],
      [edge('d', 'i', 'DEPENDS_ON')],
    );

    const findings = checkArchitecture(graph);

    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      expect(finding.evidence.length).toBeGreaterThan(0);
    }
  });

  it('is deterministic', () => {
    const graph = graphOf(
      [
        node('d', 'ARCHITECTURE_COMPONENT', { kind: 'SERVICE', layer: 'DOMAIN' }),
        node('i', 'ARCHITECTURE_COMPONENT', { kind: 'DATASTORE', layer: 'INFRASTRUCTURE' }),
      ],
      [edge('d', 'i', 'DEPENDS_ON')],
    );

    expect(JSON.stringify(checkArchitecture(graph))).toBe(JSON.stringify(checkArchitecture(graph)));
  });
});

/* -------------------------------------------------------------------------- */
/* The chain                                                                  */
/* -------------------------------------------------------------------------- */

describe('the Requirement → Release chain', () => {
  it('traces a complete chain', () => {
    const { nodes, edges } = healthyChain();
    const trace = traceRequirement(graphOf(nodes, edges), 'r1');

    expect(trace.complete).toBe(true);
    expect(trace.brokeAt).toBeUndefined();
  });

  it('does not break on an absent optional hop', () => {
    /*
     * A missing DESIGN hop must not sever the walk. An earlier version reset the frontier on any
     * absence, which reported every requirement as having no work — the failure looked like a data
     * problem and was a walk problem.
     */
    const { nodes, edges } = healthyChain();
    const withoutDesign = edges.filter((e) => e.from !== 'c1');

    const trace = traceRequirement(graphOf(nodes, withoutDesign), 'r1');

    expect(trace.links.find((l) => l.hop === 'DESIGN')?.status).toBe('NOT_REQUIRED');
    expect(trace.links.find((l) => l.hop === 'WORK')?.status).toBe('LINKED');
    expect(trace.complete).toBe(true);
  });

  it('reports the first required hop that broke, not every downstream one', () => {
    // A requirement with no work also has no test and no evidence. Naming all three as the break
    // point would bury the cause under its own consequences.
    const { nodes, edges } = healthyChain();
    const withoutWork = edges.filter((e) => e.from !== 't1');

    expect(traceRequirement(graphOf(nodes, withoutWork), 'r1').brokeAt).toBe('WORK');
  });

  it('treats a test that has never run as unverified, not as linked', () => {
    /*
     * The distinction the whole three-outcome model exists for. Counting an unrun test as coverage
     * means the report improves the moment somebody creates a test file, which is exactly the
     * incentive not to have.
     */
    const { nodes, edges } = healthyChain();
    const unrun = nodes.map((n) =>
      n.id === 'test1' ? { ...n, attributes: { ...n.attributes, outcome: 'NOT_RUN' } } : n,
    );

    const trace = traceRequirement(graphOf(unrun, edges), 'r1');

    expect(trace.links.find((l) => l.hop === 'TEST')?.status).toBe('UNVERIFIED');
    expect(trace.complete).toBe(false);
  });

  it('treats a failing test as unverified rather than as absent', () => {
    // Absent and failing are different situations: one needs a test written, the other needs a bug
    // fixed. Reporting them identically sends the reader to do the wrong work.
    const { nodes, edges } = healthyChain();
    const failing = nodes.map((n) =>
      n.id === 'test1' ? { ...n, attributes: { ...n.attributes, outcome: 'FAILED' } } : n,
    );

    const link = traceRequirement(graphOf(failing, edges), 'r1').links.find(
      (l) => l.hop === 'TEST',
    );

    expect(link?.status).toBe('UNVERIFIED');
    expect(link?.nodeIds).toEqual(['test1']);
  });

  it('treats evidence with no artefact hash as unverified', () => {
    // §32 requires a hash. Without one there is nothing to check the artefact against, so the record
    // is a note about evidence rather than evidence.
    const { nodes, edges } = healthyChain();
    const unhashed = nodes.map((n) =>
      n.id === 'e1' ? { ...n, attributes: { ...n.attributes, hash: '' } } : n,
    );

    expect(
      traceRequirement(graphOf(unhashed, edges), 'r1').links.find((l) => l.hop === 'EVIDENCE')
        ?.status,
    ).toBe('UNVERIFIED');
  });

  it('breaks a chain whose every link is present but whose evidence is stale', () => {
    /*
     * The most valuable check in this module, and the one a presence-based traceability tool cannot
     * make. Every edge exists. The evidence attests to revision 1; the requirement is now at 2. What
     * was demonstrated is not what the requirement says.
     */
    const { nodes, edges } = healthyChain();
    const revised = nodes.map((n) => (n.id === 'r1' ? { ...n, revision: 2 } : n));

    const trace = traceRequirement(graphOf(revised, edges), 'r1');

    expect(trace.links.find((l) => l.hop === 'EVIDENCE')?.status).toBe('STALE');
    expect(trace.complete).toBe(false);
  });

  it('does not report evidence as stale when it attests to the current revision', () => {
    // The counterpart. A staleness check that fires on everything is the same as no check, because
    // people switch it off.
    const { nodes, edges } = healthyChain();
    const revised = nodes.map((n) => {
      if (n.id === 'r1') return { ...n, revision: 2 };
      if (n.id === 'e1' || n.id === 'test1') {
        return { ...n, attributes: { ...n.attributes, attests: [{ nodeId: 'r1', revision: 2 }] } };
      }
      return n;
    });

    expect(traceRequirement(graphOf(revised, edges), 'r1').complete).toBe(true);
  });

  it('does not follow a link to a withdrawn node', () => {
    // Withdrawn nodes are retained as a record of what was believed. A chain resting on one is not a
    // chain, and silently counting it would let a project keep its green report by never deleting.
    const { nodes, edges } = healthyChain();
    const withdrawn = nodes.map((n) =>
      n.id === 'test1' ? { ...n, state: 'WITHDRAWN' as const } : n,
    );

    const trace = traceRequirement(graphOf(withdrawn, edges), 'r1');

    expect(trace.links.find((l) => l.hop === 'TEST')?.status).toBe('MISSING');
  });

  it('does not credit a test that verifies a different requirement', () => {
    /*
     * The reason each hop starts from the previous hop's nodes rather than checking existence
     * independently. Six existence checks would find a requirement, a task and a test, and report
     * this as fully traced.
     */
    const { nodes, edges } = healthyChain();

    const twoRequirements = [
      ...nodes,
      node('r2', 'REQUIREMENT', {
        kind: 'FUNCTIONAL',
        priority: 'MUST',
        verification: ['TEST'],
        acceptance: [{ id: 'a1', statement: 'x' }],
        sourceRef: 's',
      }),
      node('t2', 'TASK'),
    ];

    const misattached = [...edges, edge('t2', 'r2', 'IMPLEMENTS')];

    const trace = traceRequirement(graphOf(twoRequirements, misattached), 'r2');

    expect(trace.links.find((l) => l.hop === 'TEST')?.status).toBe('MISSING');
    expect(trace.brokeAt).toBe('TEST');
  });

  it('returns a fully-missing trace for a requirement that is not in the graph', () => {
    const trace = traceRequirement(graphOf([node('proj', 'PROJECT')]), 'nope');

    expect(trace.complete).toBe(false);
    expect(trace.links.every((l) => l.status === 'MISSING')).toBe(true);
  });

  it('gives every hop a stated meaning for its absence', () => {
    // A report saying "EVIDENCE: missing" tells a reader what is absent and not why they should care.
    for (const hop of CHAIN) {
      expect(hop.absenceMeans.length).toBeGreaterThan(40);
    }
  });

  it('describes only edges the twin can actually hold', () => {
    /*
     * The guard that would have caught the defect this chain was first written with.
     *
     * The original CHAIN had components SATISFYING requirements and tests VERIFYING tasks. Neither is
     * legal under `EDGE_LEGALITY`, so those hops could never match anything — every trace came back
     * with no design and no test, and the report was empty and confident. Nothing failed, because an
     * empty result looks exactly like a project that has not done the work.
     */
    for (const hop of CHAIN) {
      const from = hop.direction === 'INBOUND' ? hop.to : originClass(hop.from);
      const to = hop.direction === 'INBOUND' ? originClass(hop.from) : hop.to;

      const verdict = checkEdgeLegality(hop.via, from, to);

      expect(verdict.ok, `${hop.key}: ${from} -${hop.via}-> ${to}`).toBe(true);
    }
  });

  it('departs each hop from a point that exists earlier in the chain', () => {
    // A hop departing from a later one would silently read an empty frontier and report MISSING.
    const seen = new Set<string>(['REQUIREMENT']);

    for (const hop of CHAIN) {
      expect(seen.has(hop.from)).toBe(true);
      seen.add(hop.key);
    }
  });

  it('covers every hop key exactly once, in order', () => {
    expect(CHAIN.map((h) => h.key)).toEqual([...HOP_KEYS]);
  });

  it('is deterministic', () => {
    const { nodes, edges } = healthyChain();
    const graph = graphOf(nodes, edges);

    expect(JSON.stringify(traceAll(graph))).toBe(JSON.stringify(traceAll(graph)));
  });
});

/* -------------------------------------------------------------------------- */
/* Gaps                                                                       */
/* -------------------------------------------------------------------------- */

describe('missing-link detection', () => {
  it('finds nothing wrong with a healthy chain', () => {
    const { nodes, edges } = healthyChain();
    const report = analyse(graphOf(nodes, edges));

    expect(report.gaps).toEqual([]);
    expect(report.counts.complete).toBe(1);
  });

  it('reports a requirement with no work, and blocks on it', () => {
    const { nodes, edges } = healthyChain();
    const report = analyse(
      graphOf(
        nodes,
        edges.filter((e) => e.from !== 't1'),
      ),
    );

    const gap = report.gaps.find((g) => g.kind === 'REQUIREMENT_WITHOUT_WORK');

    expect(gap?.blocking).toBe(true);
    expect(gap?.direction).toBe('FORWARD');
    expect(gap?.evidence).toContain('r1');
  });

  it('blocks only on the first broken hop, not on every later one', () => {
    /*
     * Two required hops broken by two independent causes: no work, and evidence that was never kept.
     * Both are real gaps and both are reported, but only the earliest blocks. Reporting every broken
     * hop as blocking turns the report into a wall, and a wall hides the other requirements.
     *
     * An earlier version of this test removed only the work edge and expected the test and evidence
     * hops to break with it. They do not, and should not: the chain is a tree rooted at the
     * requirement, so a test verifying the requirement survives the work being deleted. The premise
     * was left over from a linear model that turned out not to match the twin's edge rules.
     */
    const { nodes, edges } = healthyChain();
    const broken = edges.filter((e) => e.from !== 't1' && e.class !== 'EVIDENCED_BY');

    const report = analyse(graphOf(nodes, broken));
    const forward = report.gaps.filter((g) => g.direction === 'FORWARD');

    expect(forward.map((g) => g.kind)).toEqual([
      'REQUIREMENT_WITHOUT_WORK',
      'REQUIREMENT_WITHOUT_EVIDENCE',
    ]);

    expect(report.gaps.filter((g) => g.blocking)).toHaveLength(1);
  });

  it('reports stale evidence as a blocking gap in its own right', () => {
    const { nodes, edges } = healthyChain();
    const revised = nodes.map((n) => (n.id === 'r1' ? { ...n, revision: 2 } : n));

    const gap = analyse(graphOf(revised, edges)).gaps.find(
      (g) => g.kind === 'REQUIREMENT_EVIDENCE_STALE',
    );

    expect(gap?.blocking).toBe(true);
    expect(gap?.why).toContain('reports this as complete');
  });

  it('reports work that traces back to no requirement', () => {
    /*
     * The backward direction, which is the half most traceability reports omit. A project can look
     * fully traced forward while a third of the build is unaccounted for.
     */
    const { nodes, edges } = healthyChain();
    const extra = [...nodes, node('t9', 'TASK')];

    const gap = analyse(graphOf(extra, edges)).gaps.find(
      (g) => g.kind === 'WORK_WITHOUT_REQUIREMENT',
    );

    expect(gap?.direction).toBe('BACKWARD');
    expect(gap?.evidence).toEqual(['t9']);
  });

  it('exempts rule-generated work from the backward check', () => {
    /*
     * The rule *is* the recorded reason: it names the obligation and cites its source. Reporting the
     * platform's own output as unjustified would fill this section with noise and teach people to
     * skim it — which is precisely where real scope creep would then hide.
     */
    const { nodes, edges } = healthyChain();
    const generated = [...nodes, node('t9', 'TASK', { ruleId: 'SEC-TLS-001' })];

    expect(
      analyse(graphOf(generated, edges)).gaps.filter((g) => g.kind === 'WORK_WITHOUT_REQUIREMENT'),
    ).toEqual([]);
  });

  it('reports a test that verifies nothing', () => {
    const { nodes, edges } = healthyChain();
    const orphan = [...nodes, node('test9', 'TEST', { outcome: 'PASSED' })];

    expect(analyse(graphOf(orphan, edges)).gaps.map((g) => g.kind)).toContain(
      'TEST_VERIFIES_NOTHING',
    );
  });

  it('reports evidence attached to nothing', () => {
    const { nodes, edges } = healthyChain();
    const orphan = [...nodes, node('e9', 'EVIDENCE', { hash: 'sha256:zzz' })];

    expect(analyse(graphOf(orphan, edges)).gaps.map((g) => g.kind)).toContain(
      'EVIDENCE_ATTACHED_TO_NOTHING',
    );
  });

  it('reports an unverifiable requirement as not traceable rather than as missing a test', () => {
    /*
     * Blaming the right thing. Nobody can write the test until somebody decides what would
     * demonstrate the requirement, so "missing test" would send a reader to do work they cannot
     * specify.
     */
    const { nodes, edges } = healthyChain();
    const unverifiable = nodes.map((n) =>
      n.id === 'r1' ? { ...n, attributes: { ...n.attributes, verification: [] } } : n,
    );

    const kinds = analyse(graphOf(unverifiable, edges)).gaps.map((g) => g.kind);

    expect(kinds).toContain('REQUIREMENT_NOT_TRACEABLE');
    expect(kinds).not.toContain('REQUIREMENT_WITHOUT_TEST');
  });

  it('counts an unverifiable requirement as not assessable rather than as complete or gapped', () => {
    // Three states, not two. Folding it into either count would misstate what is known.
    const { nodes, edges } = healthyChain();
    const unverifiable = nodes.map((n) =>
      n.id === 'r1' ? { ...n, attributes: { ...n.attributes, verification: [] } } : n,
    );

    const counts = analyse(graphOf(unverifiable, edges)).counts;

    expect(counts.notAssessable).toBe(1);
    expect(counts.complete).toBe(0);
  });

  it('does not report a malformed requirement node as clean', () => {
    /*
     * The check that stops a malformed requirement being the safest kind to have. Silently skipping
     * an unreadable node would exclude it from every other check.
     */
    const graph = graphOf([
      node('proj', 'PROJECT'),
      node('r1', 'REQUIREMENT', { priority: 'MUST' }),
    ]);

    expect(analyse(graph).gaps.map((g) => g.kind)).toContain('REQUIREMENT_NOT_TRACEABLE');
  });

  it('reports counts as absolute numbers with no ratio anywhere', () => {
    /*
     * §23's prohibition applied here: "87% traceable" is unactionable, optimisable, and moves for
     * reasons nobody can see. Asserted structurally so adding one later is a visible change.
     */
    const { nodes, edges } = healthyChain();
    const counts = analyse(graphOf(nodes, edges)).counts;

    expect(Object.keys(counts).sort()).toEqual([
      'blocked',
      'complete',
      'notAssessable',
      'requirements',
    ]);

    for (const value of Object.values(counts)) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it('gives every gap evidence to look at', () => {
    const { nodes, edges } = healthyChain();
    const broken = analyse(
      graphOf(
        [...nodes, node('t9', 'TASK')],
        edges.filter((e) => e.from !== 't1'),
      ),
    );

    expect(broken.gaps.length).toBeGreaterThan(0);
    for (const gap of broken.gaps) {
      expect(gap.evidence.length).toBeGreaterThan(0);
      expect(gap.why.length).toBeGreaterThan(40);
    }
  });

  it('is deterministic', () => {
    const { nodes, edges } = healthyChain();
    const graph = graphOf([...nodes, node('t9', 'TASK')], edges);

    expect(JSON.stringify(analyse(graph))).toBe(JSON.stringify(analyse(graph)));
  });
});

describe('gap-spec §25: healthy items stay quiet', () => {
  it('distinguishes an empty report from a report on an empty project', () => {
    /*
     * The specific hazard created by staying quiet: nothing-to-say and nothing-to-check render
     * identically, and one of them is much worse news than the other.
     */
    const empty = summarise(analyse(graphOf([node('proj', 'PROJECT')])));

    expect(empty.quiet).toBe(false);
    expect(empty.headline).toContain('not the same as being fully traced');
  });

  it('goes quiet only when there is genuinely nothing to report', () => {
    const { nodes, edges } = healthyChain();
    const clean = summarise(analyse(graphOf(nodes, edges)));

    expect(clean.quiet).toBe(true);
  });

  it('leads with blocking gaps when there are any', () => {
    const { nodes, edges } = healthyChain();
    const report = analyse(
      graphOf(
        nodes,
        edges.filter((e) => e.from !== 't1'),
      ),
    );

    expect(summarise(report).headline).toContain('block');
  });

  it('says explicitly when gaps exist but none block', () => {
    // "Nothing blocking" is a different message from silence, and collapsing the two would hide work
    // worth doing behind a green report.
    const { nodes, edges } = healthyChain();
    const report = analyse(graphOf([...nodes, node('t9', 'TASK')], edges));

    const summary = summarise(report);

    expect(summary.quiet).toBe(false);
    expect(summary.headline).toContain('none blocking');
  });

  it('orders broken hops by the chain rather than by discovery', () => {
    // Otherwise the output depends on graph iteration order, and two runs read differently.
    const { nodes, edges } = healthyChain();

    const noWork = traceAll(
      graphOf(
        nodes,
        edges.filter((e) => e.from !== 't1'),
      ),
    );
    const noEvidence = traceAll(
      graphOf(
        nodes,
        edges.filter((e) => e.class !== 'EVIDENCED_BY'),
      ),
    );

    expect(brokenHops([...noEvidence, ...noWork])).toEqual(['WORK', 'EVIDENCE']);
  });
});

/* -------------------------------------------------------------------------- */
/* Structural guarantees                                                      */
/* -------------------------------------------------------------------------- */

describe('structure', () => {
  it('names every declared defect and gap kind uniquely', () => {
    for (const list of [REQUIREMENT_DEFECTS, ARCHITECTURE_DEFECTS, GAP_KINDS, LINK_STATUSES]) {
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it('keeps the three-outcome link model', () => {
    // LINKED / MISSING is the two-outcome model this deliberately rejects. UNVERIFIED and STALE are
    // the two that carry the phase's actual value.
    const statuses: readonly LinkStatus[] = LINK_STATUSES;

    expect(statuses).toContain('UNVERIFIED');
    expect(statuses).toContain('STALE');
  });

  it('keeps quality attributes aligned to what the intake asks', () => {
    expect(QUALITY_ATTRIBUTES.length).toBeLessThanOrEqual(REQUIREMENT_KINDS.length + 4);
    expect(new Set(QUALITY_ATTRIBUTES).size).toBe(QUALITY_ATTRIBUTES.length);
  });

  it('offers no decision state meaning "decided but not recorded"', () => {
    expect(DECISION_STATES).toEqual(['PROPOSED', 'ACCEPTED', 'REJECTED', 'SUPERSEDED']);
  });
});

/* -------------------------------------------------------------------------- */
/* The engine's own output                                                    */
/* -------------------------------------------------------------------------- */

describe('the platform holds its own requirements to the standard it applies', () => {
  /*
   * A platform that applies a rule to the user's requirements and exempts the ones it writes itself
   * is asserting that its own conclusions need no justification — which is exactly the position it
   * exists to argue against.
   *
   * When this file was first written the generator emitted requirements with a priority and nothing
   * else: no kind, no verification method, no criteria. Every generated requirement would have been
   * reported `REQUIREMENT_NOT_TRACEABLE`, and the honest report on a freshly generated project would
   * have been a wall of the platform's own failures. The generator was changed, not the check.
   */
  const INTAKE = [
    field('accessibility.target', 'WCAG 2.2 AA'),
    field('data.types', ['Personal data']),
    field('availability.expectation', '99.9% during working hours'),
    field('performance.expectation', 'Pages respond within a second'),
    field('compliance.regimes', ['UK GDPR']),
    field('security.authentication', true),
    field('project.type', 'WEB_APPLICATION'),
  ];

  const generated = generateProject({
    projectId: PROJECT,
    projectName: 'Clinic scheduling',
    intake: INTAKE,
    at: AT,
  });

  const requirements = generated.graph.nodesOfClass('REQUIREMENT');

  it('generates requirements at all, so the rest of this block is not vacuous', () => {
    expect(requirements.length).toBeGreaterThan(3);
  });

  it('generates requirements the traceability model can read', () => {
    for (const node of requirements) {
      expect(requirementFromNode(node), node.label).toBeDefined();
    }
  });

  it('generates no requirement whose defects are the platform’s own fault', () => {
    /*
     * The line this test draws, and it took a failure to find it.
     *
     * The first version asserted that no generated requirement carries *any* blocking defect. It
     * failed on availability: the intake records "99.9% during working hours" as prose, and prose is
     * not something a test can be run against, so the requirement is genuinely unmeasured.
     *
     * That defect is real and it should be reported — the user's answer cannot be tested and they
     * need to know. Parsing a number out of the sentence would be inventing structure the user never
     * supplied, which is the same failure as inventing the number itself.
     *
     * So the standard the *platform* is held to is narrower and harder: it must never emit a
     * requirement that is broken in a way the user cannot fix by answering better. No missing
     * verification method, no missing criteria, no regulatory obligation left with nothing to show
     * for it. Those would be the engine's own omissions dressed up as the project's problem.
     */
    const PLATFORM_FAULTS = [
      'UNVERIFIABLE',
      'NO_ACCEPTANCE_CRITERIA',
      'REGULATORY_WITHOUT_ARTEFACT',
      'KIND_MISMATCH',
      'UNSOURCED',
    ];

    for (const node of requirements) {
      const parsed = requirementFromNode(node);
      if (parsed === undefined) continue;

      const ours = checkRequirement(parsed).filter((f) => PLATFORM_FAULTS.includes(f.defect));

      expect(ours.map((f) => `${node.label}: ${f.summary}`)).toEqual([]);
    }
  });

  it('reports an untestable intake answer rather than quietly accepting it', () => {
    /*
     * The other half. Availability is recorded as prose, so the requirement derived from it has no
     * measurable criterion, and the platform says so instead of treating the sentence as a target.
     *
     * This is the check earning its keep on the platform's own output: without it, "99.9% during
     * working hours" would sit in the requirement set looking like a specification until somebody at
     * the release gate had to decide whether it had been met.
     */
    const availability = requirements.find((n) => n.label.includes('availability'));
    const parsed = availability === undefined ? undefined : requirementFromNode(availability);

    expect(parsed).toBeDefined();
    expect(checkRequirement(parsed!).map((f) => f.defect)).toContain(
      'UNMEASURED_QUALITY_ATTRIBUTE',
    );
  });

  it('gives every generated quality attribute a measurable criterion or states it needs one', () => {
    // The generator cannot invent a number the user never supplied — that would be exactly the fake
    // precision the platform refuses elsewhere. What it can do is state the criterion in terms of
    // the recorded target, so the measure arrives with the answer rather than being made up here.
    for (const node of requirements) {
      const parsed = requirementFromNode(node);
      if (parsed?.kind !== 'QUALITY_ATTRIBUTE') continue;

      expect(parsed.acceptance.length, node.label).toBeGreaterThan(0);
      for (const criterion of parsed.acceptance) {
        expect(criterion.statement, node.label).toMatch(/stated|recorded|named/i);
      }
    }
  });

  it('sources every generated requirement to an intake field', () => {
    for (const node of requirements) {
      expect(requirementFromNode(node)?.sourceRef, node.label).toMatch(/^intake:/);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Hops that are required conditionally                                       */
/* -------------------------------------------------------------------------- */

describe('a hop that is not required of every requirement', () => {
  /**
   * A requirement carrying the given verification methods, with work against it.
   *
   * Built to reach the TEST hop and stop there, because that is the hop under test.
   */
  function requirementVerifiedBy(methods: readonly string[] | undefined) {
    const nodes = [
      node('proj', 'PROJECT'),
      node('r1', 'REQUIREMENT', {
        kind: 'CONSTRAINT',
        priority: 'MUST',
        ...(methods === undefined ? {} : { verification: methods }),
        acceptance: [{ id: 'a1', statement: 'It holds.' }],
        sourceRef: 'rule:X-001',
      }),
      node('t1', 'TASK'),
    ];

    return traceRequirement(graphOf(nodes, [edge('t1', 'r1', 'IMPLEMENTS')]), 'r1');
  }

  it('does not demand a test of a requirement verified by inspection', () => {
    /*
     * The model was asking the wrong question. "Published documentation" is verified by reading it,
     * and reporting it as untested put a false finding beside every real one — which is how a report
     * teaches people to skim it.
     */
    const trace = requirementVerifiedBy(['INSPECTION']);
    const test = trace.links.find((link) => link.hop === 'TEST');

    expect(test?.status).toBe('NOT_REQUIRED');
    expect(test?.detail).toContain('rather than by a test');
  });

  it('does demand one of a requirement that says it is verified by a test', () => {
    expect(requirementVerifiedBy(['TEST']).links.find((l) => l.hop === 'TEST')?.status).toBe(
      'MISSING',
    );
  });

  it('demands one when the requirement never said how it is verified', () => {
    // Silence is not an exemption: a requirement that never stated a method must not escape
    // verification by having said nothing.
    expect(requirementVerifiedBy(undefined).links.find((l) => l.hop === 'TEST')?.status).toBe(
      'MISSING',
    );
  });
});

describe('evidence is required once a test has run', () => {
  function withTest(attributes: Record<string, unknown>) {
    const nodes = [
      node('proj', 'PROJECT'),
      node('r1', 'REQUIREMENT', {
        kind: 'CONSTRAINT',
        priority: 'MUST',
        verification: ['TEST'],
        acceptance: [{ id: 'a1', statement: 'It holds.' }],
        sourceRef: 'rule:X-001',
      }),
      node('t1', 'TASK'),
      node('test1', 'TEST', attributes),
    ];

    return traceRequirement(
      graphOf(nodes, [edge('t1', 'r1', 'IMPLEMENTS'), edge('test1', 'r1', 'VERIFIES')]),
      'r1',
    );
  }

  it('is not required of a test that has only been specified', () => {
    /*
     * Evidence is what a test *run* leaves behind. Demanding it from a specified test reports a gap
     * on every requirement in a project that has not started testing — which is every project at
     * planning time.
     */
    const link = withTest({ executed: false }).links.find((l) => l.hop === 'EVIDENCE');

    expect(link?.status).toBe('NOT_REQUIRED');
    expect(link?.detail).toContain('nothing to have kept evidence of');
  });

  it('is required the moment one runs', () => {
    expect(withTest({ executed: true }).links.find((l) => l.hop === 'EVIDENCE')?.status).toBe(
      'MISSING',
    );
  });

  it('reads a recorded outcome as having run, not only the executed flag', () => {
    // Two representations exist and both are legitimate. Reading only one made a passing test look
    // unrun, which would have excused it from needing evidence.
    expect(withTest({ outcome: 'PASSED' }).links.find((l) => l.hop === 'EVIDENCE')?.status).toBe(
      'MISSING',
    );
  });
});
