import { describe, expect, it } from 'vitest';
import { TwinGraph } from '@govintel/twin/graph';
import { createNode, type NodeClass, type TwinNode } from '@govintel/twin/nodes';
import { EDGE_CLASSES, type EdgeClass, type TwinEdge } from '@govintel/twin/edges';
import {
  CHANGE_KINDS,
  PROPAGATION,
  STALENESS,
  STALENESS_MEANING,
  bearsClaim,
  effectOf,
  propagates,
  ruleFor,
  weaken,
  worse,
} from '../src/propagation.ts';
import { MAX_DEPTH, analyseImpact, summariseImpact, type ChangedNode } from '../src/impact.ts';
import {
  REQUEST_STATES,
  TRANSITIONS,
  apply,
  canTransition,
  plan,
  supersedeIfStale,
  type ChangePlan,
  type ChangeRequest,
} from '../src/request.ts';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const AT = '2026-01-01T00:00:00.000Z';
const PROJECT = 'p1';

function node(
  id: string,
  nodeClass: NodeClass,
  attributes: Record<string, unknown> = {},
): TwinNode {
  return createNode({
    id,
    projectId: PROJECT,
    class: nodeClass,
    label: id,
    provenance: { provenance: 'DETERMINISTIC_CALCULATION', confidence: 'HIGH' },
    attributes,
    at: AT,
  });
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

/**
 * The golden scenario the Phase-12 gate names: a major architecture change.
 *
 * A component the whole delivery rests on, with work built on it, tests verifying the requirement it
 * implements, evidence behind those tests, an approval on the deployment, and a budget line derived
 * from the estimate. Changing the component has to reach all of it, by paths a reader can follow.
 *
 * Built once and used by every scenario test, so a test asserting one effect differs from the whole
 * scenario in exactly the respect it names.
 */
function architectureScenario(): TwinGraph {
  return graphOf(
    [
      node('proj', 'PROJECT'),
      node('req-auth', 'REQUIREMENT'),
      node('comp-auth', 'ARCHITECTURE_COMPONENT'),
      node('adr-auth', 'ARCHITECTURE_DECISION'),
      node('comp-api', 'ARCHITECTURE_COMPONENT'),
      node('task-auth', 'TASK'),
      node('test-auth', 'TEST', { outcome: 'PASSED' }),
      node('ev-auth', 'EVIDENCE', { hash: 'sha256:abc' }),
      node('deploy-1', 'DEPLOYMENT'),
      node('appr-1', 'APPROVAL', { decision: 'APPROVED', approver: 'A. Patel' }),
      node('est-auth', 'ESTIMATE'),
      node('budget-auth', 'BUDGET_ITEM'),
      node('risk-auth', 'RISK'),
    ],
    [
      // The component realises the requirement and derives from a decision. Neither edge carries
      // impact *outward* from the component: changing an implementation does not make the
      // requirement or the decision behind it stale.
      edge('comp-auth', 'req-auth', 'IMPLEMENTS'),
      edge('comp-auth', 'adr-auth', 'DERIVED_FROM'),

      // What is built on the component. §27: "architecture component changed → implementation
      // tasks, integration tests, deployment".
      edge('task-auth', 'comp-auth', 'DEPENDS_ON'),
      edge('test-auth', 'comp-auth', 'VERIFIES'),
      edge('deploy-1', 'comp-auth', 'DEPENDS_ON'),
      edge('comp-api', 'comp-auth', 'DEPENDS_ON'),

      // Evidence behind the test, and the approval on the deployment.
      edge('test-auth', 'ev-auth', 'EVIDENCED_BY'),
      edge('deploy-1', 'appr-1', 'APPROVED_BY'),

      // §27: "→ costs". Money derived from the work.
      edge('est-auth', 'task-auth', 'DERIVED_FROM'),
      edge('budget-auth', 'est-auth', 'DERIVED_FROM'),

      // A risk the component mitigates.
      edge('comp-auth', 'risk-auth', 'MITIGATES'),
    ],
  );
}

function request(overrides: Partial<ChangeRequest> = {}): ChangeRequest {
  return {
    id: 'cr1',
    projectId: PROJECT,
    title: 'Replace the session store',
    rationale: 'The current store cannot be replicated, which caps availability below the target.',
    state: 'APPROVED',
    changes: [
      { nodeId: 'comp-auth', kind: 'MATERIAL', summary: 'Session storage moves to Redis.' },
    ],
    baseVersion: 12,
    requestedBy: 'R. Okafor',
    approvedBy: 'A. Patel',
    ...overrides,
  };
}

function planFor(graph: TwinGraph, req: ChangeRequest, version: number): ChangePlan {
  const result = plan(graph, req, version);
  if (!result.ok) throw new Error(`expected a plan, got ${result.refusal}`);
  return result.value;
}

/* -------------------------------------------------------------------------- */
/* Propagation rules                                                          */
/* -------------------------------------------------------------------------- */

describe('gap-spec §27: propagation is decided per relationship', () => {
  it('is deny-by-default: most edge classes do not propagate', () => {
    /*
     * The decision that keeps impact reports readable. Propagating through every edge reports
     * forty-seven affected items for any change, everything is eventually connected to everything,
     * and people stop reading by the third report they see.
     */
    const propagating = EDGE_CLASSES.filter(propagates);

    expect(propagating.length).toBeLessThan(EDGE_CLASSES.length / 2);
    expect(propagates('CONTAINS')).toBe(false);
    expect(propagates('OWNED_BY')).toBe(false);
  });

  it('does not propagate up containment', () => {
    // A project containing a changed task is not itself stale, and propagating up containment makes
    // every change reach the project root — from which everything is reachable.
    expect(ruleFor('CONTAINS')).toBeUndefined();
  });

  it('gives every propagating edge a stated reason', () => {
    // The path in an impact report is built from these. Without them the report says what happened
    // and not why, which is the difference between something a reader can dispute and a verdict.
    for (const rule of PROPAGATION) {
      expect(rule.because.length, rule.edge).toBeGreaterThan(40);
    }
  });

  it('invalidates a test when what it verifies changes', () => {
    // The test passed against a different claim. What it demonstrated is not about the current one.
    expect(ruleFor('VERIFIES')?.effect).toBe('INVALIDATED');
  });

  it('only makes evidence stale, not invalid', () => {
    /*
     * The artefact still records what happened when it was captured. Whether it still supports the
     * claim is a judgement, and §27.1 is explicit that dependent evidence is never deleted.
     */
    expect(ruleFor('EVIDENCED_BY')?.effect).toBe('STALE');
  });

  it('invalidates an approval when its subject changes', () => {
    // §33. Treating the decision as still standing would put the approver's name on a choice they
    // did not make.
    expect(ruleFor('APPROVED_BY')?.effect).toBe('INVALIDATED');
  });

  it('keeps STALE and INVALIDATED as different states', () => {
    /*
     * The distinction that does the work. Stale means it might still hold and somebody has to look;
     * invalidated means it definitely does not. Collapsing them either buries real breakage in a
     * pile of maybes, or makes every change look like it destroyed the project.
     */
    expect(STALENESS).toContain('STALE');
    expect(STALENESS).toContain('INVALIDATED');
    expect(STALENESS_MEANING.STALE).toMatch(/may still hold/i);
    expect(STALENESS_MEANING.INVALIDATED).toMatch(/no longer holds/i);
  });

  it('takes the worse of two verdicts, never the average', () => {
    expect(worse('STALE', 'INVALIDATED')).toBe('INVALIDATED');
    expect(worse('CURRENT', 'STALE')).toBe('STALE');
  });

  it('weakens by one step per hop and bottoms out at current', () => {
    expect(weaken('INVALIDATED')).toBe('REVALIDATION_REQUIRED');
    expect(weaken('REVALIDATION_REQUIRED')).toBe('STALE');
    expect(weaken('STALE')).toBe('CURRENT');
    expect(weaken('CURRENT')).toBe('CURRENT');
  });

  it('propagates nothing for a cosmetic change', () => {
    /*
     * The rule that keeps the report worth reading. A project where renaming a requirement
     * invalidates its test suite produces reports that are mostly noise, and a noisy report gets
     * skimmed — including on the occasion it matters.
     */
    const rule = ruleFor('VERIFIES');
    expect(rule).toBeDefined();
    expect(effectOf(rule!, 'COSMETIC')).toBeUndefined();
  });

  it('propagates nothing for an addition', () => {
    // Nothing pointed at it before it existed.
    const rule = ruleFor('VERIFIES');
    expect(effectOf(rule!, 'ADDITION')).toBeUndefined();
  });

  it('escalates a withdrawal to invalidated regardless of the edge', () => {
    // Dependants have not merely lost currency; they have lost their subject.
    for (const rule of PROPAGATION) {
      expect(effectOf(rule, 'WITHDRAWAL'), rule.edge).toBe('INVALIDATED');
    }
  });

  it('names the change kinds without a fifth meaning "we are not sure"', () => {
    expect(CHANGE_KINDS).toEqual(['MATERIAL', 'COSMETIC', 'WITHDRAWAL', 'ADDITION']);
  });

  it('marks the classes that carry a claim somebody signed up to', () => {
    // A stale PHASE is not something anybody can act on; a stale EVIDENCE is.
    expect(bearsClaim('EVIDENCE')).toBe(true);
    expect(bearsClaim('APPROVAL')).toBe(true);
    expect(bearsClaim('PHASE')).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* The golden scenario                                                        */
/* -------------------------------------------------------------------------- */

describe('the major architecture-change golden scenario', () => {
  const graph = architectureScenario();
  const change: ChangedNode[] = [
    { nodeId: 'comp-auth', kind: 'MATERIAL', summary: 'Session storage moves to Redis.' },
  ];

  const report = analyseImpact(graph, change);
  const byId = new Map(report.impacted.map((item) => [item.nodeId, item]));

  it('reaches something at all, so the rest of this block is not vacuous', () => {
    /*
     * The guard the traceability chain taught. An impact report that found nothing looks exactly
     * like a change that affects nothing, and every assertion below would pass against a traversal
     * that never moved.
     */
    expect(report.impacted.length).toBeGreaterThan(4);
  });

  it('does not make the requirement stale, because the spec did not change', () => {
    /*
     * The direction that is easy to get backwards. A component realises a requirement; changing the
     * implementation does not make the requirement it implements stale. Propagating that way would
     * mark the spec as needing review every time somebody refactored, which is how an impact tool
     * teaches people to ignore it.
     */
    expect(byId.has('req-auth')).toBe(false);
  });

  it('does not make the decision behind it stale either', () => {
    // The decision constrained the component, not the reverse.
    expect(byId.has('adr-auth')).toBe(false);
  });

  it('reaches the work built on it', () => {
    // §27's own worked example: architecture component changed → implementation tasks.
    expect(byId.has('task-auth')).toBe(true);
  });

  it('invalidates the integration test that verifies the component', () => {
    // It passed against a component that has since changed materially, so what it demonstrated is
    // not about the current one.
    expect(byId.get('test-auth')?.staleness).toBe('INVALIDATED');
  });

  it('makes the evidence behind that test stale rather than invalid', () => {
    /*
     * §27.1 is explicit that dependent evidence is never deleted. The artefact still records what
     * happened when it was captured; whether it still supports the claim is a judgement.
     */
    expect(byId.get('ev-auth')?.staleness).toBe('STALE');
  });

  it('reaches the deployment and the approval on it', () => {
    /*
     * §27's example again: architecture component changed → deployment. The approval is two hops out
     * so its invalidation weakens — the approver approved a deployment, and it is the deployment
     * that depends on what changed. Reporting the approval as outright invalid at that distance
     * would overstate what the graph knows.
     */
    expect(byId.get('deploy-1')?.staleness).toBe('REVALIDATION_REQUIRED');
    expect(byId.get('appr-1')?.staleness).toBe('REVALIDATION_REQUIRED');
  });

  it('reaches the cost derived from the work', () => {
    // §27: architecture component changed → costs. Derived values are stale rather than invalid,
    // because recalculating is cheap and the old figure records what was believed.
    expect(byId.has('est-auth')).toBe(true);
    expect(byId.has('budget-auth')).toBe(true);
  });

  it('reaches the component that depends on it', () => {
    expect(byId.get('comp-api')?.staleness).toBe('REVALIDATION_REQUIRED');
  });

  it('reaches the risk it mitigates', () => {
    // Whether the mitigation still addresses the risk is exactly the question nobody asks unless
    // prompted.
    expect(byId.has('risk-auth')).toBe(true);
  });

  it('does not report the changed node as impacted by itself', () => {
    // It is already in `changed`. Listing it in both double-counts the thing the reader knows about.
    expect(byId.has('comp-auth')).toBe(false);
  });

  it('gives every impacted node a path that explains itself hop by hop', () => {
    /*
     * "47 items affected" is a number nobody can act on or dispute. The path is what makes the
     * report checkable, and a report nobody can check stops being believed the first time it is
     * wrong.
     */
    for (const item of report.impacted) {
      expect(item.path.length, item.nodeId).toBeGreaterThan(0);
      expect(item.path[0]?.because.length, item.nodeId).toBeGreaterThan(40);
      expect(item.path[0]?.fromId, item.nodeId).toBe('comp-auth');
      expect(item.path[item.path.length - 1]?.toId, item.nodeId).toBe(item.nodeId);
    }
  });

  it('orders the report worst first, actionable before pass-through', () => {
    const ranks = report.impacted.map((item) =>
      ['INVALIDATED', 'REVALIDATION_REQUIRED', 'STALE', 'CURRENT'].indexOf(item.staleness),
    );

    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('summarises without a proportion of the project', () => {
    // Absolute counts. "38% of the project is affected" is optimisable and unactionable.
    const summary = summariseImpact(report);

    expect(summary.headline).not.toMatch(/\d{1,3}\s*%/);
    expect(summary.worst?.actionable).toBe(true);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(analyseImpact(graph, change))).toBe(
      JSON.stringify(analyseImpact(graph, change)),
    );
  });

  it('does not depend on the order the caller listed the changes', () => {
    // Two people describing the same change must get the same report, or the report is not evidence.
    const a = analyseImpact(graph, [
      { nodeId: 'comp-auth', kind: 'MATERIAL', summary: 'x' },
      { nodeId: 'req-auth', kind: 'MATERIAL', summary: 'y' },
    ]);

    const b = analyseImpact(graph, [
      { nodeId: 'req-auth', kind: 'MATERIAL', summary: 'y' },
      { nodeId: 'comp-auth', kind: 'MATERIAL', summary: 'x' },
    ]);

    expect(JSON.stringify(a.impacted)).toBe(JSON.stringify(b.impacted));
  });
});

describe('impact traversal', () => {
  it('reports nothing affected as a real answer, not an empty one', () => {
    /*
     * The §25 hazard again: an empty report and a report on an unconnected node render identically,
     * and the reader needs to know which.
     */
    const graph = graphOf([node('proj', 'PROJECT'), node('lonely', 'REQUIREMENT')]);

    const summary = summariseImpact(
      analyseImpact(graph, [{ nodeId: 'lonely', kind: 'MATERIAL', summary: 'x' }]),
    );

    expect(summary.headline).toMatch(/that is a real answer/i);
    expect(summary.worst).toBeNull();
  });

  it('reports an unresolvable change rather than silently finding nothing', () => {
    // An empty report from a typo'd id reads identically to a change that affects nothing.
    const report = analyseImpact(graphOf([node('proj', 'PROJECT')]), [
      { nodeId: 'nope', kind: 'MATERIAL', summary: 'x' },
    ]);

    expect(report.unresolved).toEqual(['nope']);
  });

  it('terminates on a dependency cycle', () => {
    /*
     * `DEPENDS_ON` cycles are invalid and they exist in real projects. An impact analyser that hangs
     * on one is useless at exactly the moment somebody is trying to understand a mess.
     */
    const graph = graphOf(
      [node('a', 'ARCHITECTURE_COMPONENT'), node('b', 'ARCHITECTURE_COMPONENT')],
      [edge('a', 'b', 'DEPENDS_ON'), edge('b', 'a', 'DEPENDS_ON')],
    );

    const report = analyseImpact(graph, [{ nodeId: 'a', kind: 'MATERIAL', summary: 'x' }]);

    expect(report.impacted.map((i) => i.nodeId)).toEqual(['b']);
  });

  it('says when it stopped early instead of presenting a truncated analysis as complete', () => {
    /*
     * The specific way an impact tool lies: nobody can tell from the output that something was left
     * out. A chain long enough to exceed the depth limit has to say so.
     */
    const nodes = [node('r0', 'REQUIREMENT')];
    const edges: TwinEdge[] = [];

    for (let i = 1; i <= 8; i += 1) {
      nodes.push(node(`r${String(i)}`, 'REQUIREMENT'));
      edges.push(edge(`r${String(i)}`, `r${String(i - 1)}`, 'DERIVED_FROM'));
    }

    const report = analyseImpact(graphOf(nodes, edges), [
      { nodeId: 'r0', kind: 'WITHDRAWAL', summary: 'withdrawn' },
    ]);

    expect(report.truncated).toBe(true);
    expect(summariseImpact(report).headline).toMatch(new RegExp(`${String(MAX_DEPTH)} hops`));
  });

  it('handles a two-thousand-node graph', () => {
    /*
     * §26.1 names 20, 100, 500 and 2,000 nodes. The scale that matters here is not rendering — it is
     * that traversal stays linear in edges, which is the property that makes an impact preview
     * usable interactively rather than something you wait for.
     */
    const nodes: TwinNode[] = [node('hub', 'REQUIREMENT')];
    const edges: TwinEdge[] = [];

    for (let i = 0; i < 2000; i += 1) {
      nodes.push(node(`t${String(i)}`, 'TEST', { outcome: 'PASSED' }));
      edges.push(edge(`t${String(i)}`, 'hub', 'VERIFIES'));
    }

    const report = analyseImpact(graphOf(nodes, edges), [
      { nodeId: 'hub', kind: 'MATERIAL', summary: 'x' },
    ]);

    expect(report.impacted).toHaveLength(2000);
    expect(report.impacted.every((i) => i.staleness === 'INVALIDATED')).toBe(true);
  });

  it('takes the worse verdict when two changes reach the same node', () => {
    const graph = graphOf(
      [
        node('req', 'REQUIREMENT'),
        node('other', 'REQUIREMENT'),
        node('test', 'TEST', { outcome: 'PASSED' }),
      ],
      [edge('test', 'req', 'VERIFIES'), edge('test', 'other', 'DERIVED_FROM')],
    );

    // Reached as STALE via DERIVED_FROM and INVALIDATED via VERIFIES. The worse one wins.
    const report = analyseImpact(graph, [
      { nodeId: 'other', kind: 'MATERIAL', summary: 'x' },
      { nodeId: 'req', kind: 'MATERIAL', summary: 'y' },
    ]);

    expect(report.impacted.find((i) => i.nodeId === 'test')?.staleness).toBe('INVALIDATED');
  });
});

/* -------------------------------------------------------------------------- */
/* Change requests                                                            */
/* -------------------------------------------------------------------------- */

describe('gap-spec §28: change request atomicity', () => {
  const graph = architectureScenario();

  it('plans a well-formed request', () => {
    const result = plan(graph, request(), 12);

    expect(result.ok).toBe(true);
  });

  it('refuses a request that changes nothing', () => {
    // It would create a project version identical to the one before it, and a version history with
    // entries that changed nothing is one nobody trusts to be complete.
    const result = plan(graph, request({ changes: [] }), 12);

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.refusal).toBe('NO_CHANGES');
  });

  it('refuses a request with no stated reason', () => {
    // An approver has nothing to approve except the fact that somebody asked.
    const result = plan(graph, request({ rationale: '  ' }), 12);

    expect(result.ok ? undefined : result.refusal).toBe('NO_RATIONALE');
  });

  it('refuses a change against a node that is not in the project', () => {
    // Calculating impact from a node that does not exist produces an empty report, which reads
    // identically to a change that affects nothing.
    const result = plan(
      graph,
      request({ changes: [{ nodeId: 'ghost', kind: 'MATERIAL', summary: 'x' }] }),
      12,
    );

    expect(result.ok ? undefined : result.refusal).toBe('UNKNOWN_NODE');
  });

  it('refuses to plan against a project that has moved on', () => {
    const result = plan(graph, request({ baseVersion: 9 }), 12);

    expect(result.ok ? undefined : result.refusal).toBe('STALE_BASE_VERSION');
  });

  it('requires approval when the change breaks a claim the project relies on', () => {
    /*
     * Not a size threshold. Nobody agrees on what counts as big, and a threshold is a number people
     * learn to stay under. "Does this break something already claimed" is a fact about the graph.
     */
    const changePlan = planFor(graph, request(), 12);

    expect(changePlan.requiresApproval).toBe(true);
    expect(
      changePlan.impact.impacted.filter((i) => i.staleness === 'INVALIDATED').length,
    ).toBeGreaterThan(0);
  });

  it('names an approval as invalidated only when its own subject changed', () => {
    /*
     * Two hops out the approval is merely revalidation-required — the approver approved a
     * deployment, and it is the deployment that depends on what changed. Changing the deployment
     * itself is what puts their name on something that no longer exists.
     *
     * Reporting an approval as invalidated at any distance would mean every change in the project
     * eventually claims to have voided somebody's decision, which is the point at which approvers
     * stop reading the notification.
     */
    const distant = planFor(graph, request(), 12);

    const direct = planFor(
      graph,
      request({
        changes: [{ nodeId: 'deploy-1', kind: 'MATERIAL', summary: 'Deploy target changed.' }],
      }),
      12,
    );

    expect(distant.invalidatedApprovals).toEqual([]);
    expect(direct.invalidatedApprovals).toEqual(['appr-1']);
  });

  it('does not require approval for a change that invalidates nothing', () => {
    const isolated = graphOf([node('proj', 'PROJECT'), node('lonely', 'REQUIREMENT')]);

    const changePlan = planFor(
      isolated,
      request({ changes: [{ nodeId: 'lonely', kind: 'MATERIAL', summary: 'x' }] }),
      12,
    );

    expect(changePlan.requiresApproval).toBe(false);
  });

  it('applies an approved request and creates the next version', () => {
    const changePlan = planFor(graph, request(), 12);
    const result = apply(request(), changePlan, 12);

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.newVersion : undefined).toBe(13);
  });

  it('refuses to apply a change whose impact was calculated against an older project', () => {
    /*
     * The reason this module exists. Somebody previews against version 12, goes to a meeting, comes
     * back and approves. The project is now at 15. Applying would apply a decision made about a
     * different project — the approver saw an impact report that is no longer true, and their name
     * ends up on a choice they did not make.
     *
     * Nothing errors without this check. The change applies cleanly and the record looks complete.
     */
    const changePlan = planFor(graph, request(), 12);
    const result = apply(request(), changePlan, 15);

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.refusal).toBe('STALE_BASE_VERSION');
    expect(result.ok ? undefined : result.reason).toMatch(/no longer true/i);
  });

  it('refuses to apply a request that has not been approved', () => {
    const changePlan = planFor(graph, request(), 12);
    const result = apply(request({ state: 'PENDING_APPROVAL' }), changePlan, 12);

    expect(result.ok ? undefined : result.refusal).toBe('NOT_APPROVED');
  });

  it('refuses to apply a request the requester approved themselves', () => {
    /*
     * Self-approval records a decision with nobody independent behind it, which is worse than no
     * approval at all: the record looks complete.
     */
    const changePlan = planFor(graph, request(), 12);
    const result = apply(request({ approvedBy: 'R. Okafor' }), changePlan, 12);

    expect(result.ok ? undefined : result.refusal).toBe('APPROVER_IS_REQUESTER');
  });

  it('refuses to apply an already-applied request', () => {
    const changePlan = planFor(graph, request(), 12);
    const result = apply(request({ state: 'APPLIED' }), changePlan, 12);

    expect(result.ok ? undefined : result.refusal).toBe('ILLEGAL_TRANSITION');
  });

  it('emits one audit event per material effect', () => {
    // §28 step 8. The audit trail has to match the impact report, or the record of what happened
    // disagrees with the record of what was going to happen.
    const req = request({
      changes: [{ nodeId: 'deploy-1', kind: 'MATERIAL', summary: 'Deploy target changed.' }],
    });

    const changePlan = planFor(graph, req, 12);
    const result = apply(req, changePlan, 12);

    if (!result.ok) throw new Error('expected an application');

    const marked = result.value.auditEvents.filter((e) => e.kind === 'NODE_MARKED');

    expect(marked).toHaveLength(changePlan.markings.length);
    expect(result.value.auditEvents.some((e) => e.kind === 'VERSION_CREATED')).toBe(true);
    expect(result.value.auditEvents.some((e) => e.kind === 'APPROVAL_INVALIDATED')).toBe(true);
  });

  it('names follow-up work rather than performing it', () => {
    /*
     * §28 step 10. Running a notification inside the transaction means a failed notification rolls
     * back a successful change, which is the wrong trade in both directions.
     */
    const req = request({
      changes: [{ nodeId: 'deploy-1', kind: 'MATERIAL', summary: 'Deploy target changed.' }],
    });

    const result = apply(req, planFor(graph, req, 12), 12);

    if (!result.ok) throw new Error('expected an application');

    expect(result.value.followUp.join(' ')).toMatch(/recalculate derived values/i);
    expect(result.value.followUp.join(' ')).toMatch(/approver/i);
  });

  it('supersedes a stale request rather than rejecting it', () => {
    /*
     * Nobody decided against it. Forcing it into REJECTED loses the difference between "we said no"
     * and "the world moved", and those need different follow-ups.
     */
    const superseded = supersedeIfStale(request({ state: 'PENDING_APPROVAL' }), 15);

    expect(superseded?.state).toBe('SUPERSEDED');
    expect(superseded?.decisionReason).toMatch(/nobody decided against it/i);
  });

  it('does not supersede a request whose base version still matches', () => {
    expect(supersedeIfStale(request(), 12)).toBeUndefined();
  });

  it('offers no route back from approved to pending', () => {
    /*
     * Silently returning a stale approval to pending would let it be reused across a project version
     * it was never given against — the exact thing the concurrency check exists to stop.
     */
    expect(canTransition('APPROVED', 'PENDING_APPROVAL')).toBe(false);
    expect(TRANSITIONS.APPLIED).toEqual([]);
  });

  it('names every request state uniquely', () => {
    expect(new Set(REQUEST_STATES).size).toBe(REQUEST_STATES.length);
  });

  it('produces the same plan the application executes', () => {
    /*
     * The preview and the application share one plan, so they cannot disagree. A preview computed by
     * separate code is a second implementation, and the first divergence surfaces to a user as "the
     * system did something other than what it showed me".
     */
    const changePlan = planFor(graph, request(), 12);
    const result = apply(request(), changePlan, 12);

    if (!result.ok) throw new Error('expected an application');

    expect(result.value.plan).toBe(changePlan);
  });

  it('is deterministic', () => {
    const a = planFor(graph, request(), 12);
    const b = planFor(graph, request(), 12);

    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
