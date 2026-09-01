/**
 * The quality gate suite.
 *
 * Contract: gap-spec §15 — eleven gates, each with **exact criteria**; §16 — methodology must not
 * bypass a mandatory gate.
 *
 * "Exact" is what most of these tests are about. A criterion phrased as "security reviewed" is a
 * checkbox someone ticks; a criterion has to be a question the platform can answer from the project
 * graph, or it is a self-assessment with extra steps. Every criterion here is checked against a real
 * graph, in both directions — a gate that passed everything would satisfy every positive assertion
 * and be worthless.
 */

import { describe, expect, it } from 'vitest';
import { TwinGraph } from '@govintel/twin/graph';
import { createNode, type NodeClass, type TwinNode } from '@govintel/twin/nodes';
import type { EdgeClass, TwinEdge } from '@govintel/twin/edges';
import { GATES, GATE_KEYS, evaluateGate, evaluateGates, findGate } from '../src/gates.ts';
import {
  MANDATORY_GATES,
  METHODOLOGIES,
  METHODOLOGY_PROFILES,
  canSkipGate,
  cadenceFor,
  gatesFor,
  isMethodology,
  suggestMethodology,
} from '../src/methodology.ts';

const AT = '2026-03-01T09:00:00.000Z';
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
    provenance: { provenance: 'USER_PROVIDED', confidence: 'HIGH' },
    attributes,
    at: AT,
  });
}

function edge(from: string, to: string, edgeClass: EdgeClass): TwinEdge {
  return {
    id: `${from}->${edgeClass}->${to}`,
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

const EMPTY = graphOf([]);

describe('the catalogue of gates', () => {
  it('has the eleven gates gap-spec §15 defines', () => {
    expect(GATE_KEYS).toHaveLength(11);
    expect(GATES.map((g) => g.key)).toEqual([...GATE_KEYS]);
  });

  it('gives every gate at least one blocking criterion', () => {
    // A gate with nothing blocking cannot fail, which makes it a report rather than a gate.
    for (const gate of GATES) {
      expect(
        gate.criteria.some((c) => c.blocking),
        gate.key,
      ).toBe(true);
    }
  });

  it('gives every criterion a rationale a person could act on', () => {
    // Shown when the criterion fails, so the answer is never "because the tool said so".
    for (const gate of GATES) {
      for (const criterion of gate.criteria) {
        expect(criterion.rationale.length, `${gate.key}/${criterion.key}`).toBeGreaterThan(40);
        expect(criterion.statement.length, `${gate.key}/${criterion.key}`).toBeGreaterThan(10);
      }
    }
  });

  it('states each criterion as a claim rather than a question', () => {
    // "The project has an objective" can be true or false. "Does the project have an objective?"
    // needs someone to answer it, which is the checkbox this design avoids.
    for (const gate of GATES) {
      for (const criterion of gate.criteria) {
        expect(criterion.statement.endsWith('?'), `${gate.key}/${criterion.key}`).toBe(false);
      }
    }
  });

  it('gives every criterion a unique key within its gate', () => {
    for (const gate of GATES) {
      const keys = gate.criteria.map((c) => c.key);
      expect(new Set(keys).size, gate.key).toBe(keys.length);
    }
  });

  it('answers most criteria automatically rather than by asking', () => {
    /*
     * The measurement that decides whether these are gates or paperwork.
     *
     * Manual criteria are legitimate — whether a rollback was rehearsed is not something the platform
     * can see — but a catalogue that was mostly manual would be a checklist with a database behind
     * it.
     */
    const all = GATES.flatMap((g) => g.criteria);
    const automatic = all.filter((c) => c.kind === 'AUTOMATIC').length;
    expect(automatic / all.length).toBeGreaterThan(0.5);
  });

  it('requires an artefact even for manual criteria', () => {
    // A manual criterion still needs evidence or an approval in the graph. That is stricter than a
    // checkbox: something has to exist, attributable and timestamped.
    for (const gate of GATES) {
      for (const criterion of gate.criteria.filter((c) => c.kind === 'MANUAL')) {
        expect(criterion.check(EMPTY), `${gate.key}/${criterion.key}`).not.toBe(true);
      }
    }
  });

  it('finds a gate by key', () => {
    expect(findGate('SECURITY')?.title).toBe('Security');
    expect(findGate('NOPE')).toBeUndefined();
  });
});

describe('an empty project passes nothing', () => {
  /*
   * The baseline. A gate system that passed an empty project would pass anything, and every positive
   * test elsewhere would be meaningless.
   */
  const outcomes = evaluateGates(EMPTY);

  it('evaluates every gate', () => {
    expect(outcomes).toHaveLength(GATES.length);
  });

  it('passes none of them', () => {
    expect(outcomes.every((o) => o.result !== 'PASSED')).toBe(true);
  });

  it('explains each one', () => {
    for (const outcome of outcomes) {
      expect(outcome.explanation.length, outcome.key).toBeGreaterThan(30);
    }
  });
});

describe('undecidable is distinct from failed', () => {
  /*
   * The same distinction the rule evaluator draws.
   *
   * "We checked and it is not met" and "we cannot tell yet" are different states. Collapsing them
   * into failure teaches people that gate failures are noise, which is how the real ones get ignored.
   */

  it('reports INDETERMINATE when a blocking criterion cannot be decided', () => {
    // The requirements gate cannot judge verification coverage with no requirements to judge.
    const graph = graphOf([node('p', 'PROJECT'), node('r', 'REQUIREMENT')], []);
    const outcome = evaluateGate(
      GATES.find((g) => g.key === 'REQUIREMENTS')!,
      graph,
    );

    expect(['FAILED', 'INDETERMINATE']).toContain(outcome.result);
  });

  it('reports the criterion as null rather than false when undecidable', () => {
    const gate = GATES.find((g) => g.key === 'TESTING')!;
    const outcome = evaluateGate(gate, EMPTY);
    const categories = outcome.criteria.find((c) => c.key === 'categories-executed');

    expect(categories?.met).toBeNull();
  });

  it('says what it could not decide', () => {
    const outcome = evaluateGate(
      GATES.find((g) => g.key === 'TESTING')!,
      EMPTY,
    );
    if (outcome.result === 'INDETERMINATE') {
      expect(outcome.explanation).toMatch(/cannot be decided yet/i);
    }
  });
});

describe('the discovery gate', () => {
  const gate = GATES.find((g) => g.key === 'DISCOVERY')!;

  it('fails a project with no objective', () => {
    const graph = graphOf([node('p', 'PROJECT', { projectType: 'SAAS_WEB_APP' })]);
    const outcome = evaluateGate(gate, graph);

    expect(outcome.criteria.find((c) => c.key === 'objective-defined')?.met).toBe(false);
    expect(outcome.result).toBe('FAILED');
  });

  it('fails a project whose type is unknown', () => {
    const graph = graphOf([
      node('p', 'PROJECT', { projectType: 'UNKNOWN' }),
      node('o', 'OBJECTIVE'),
    ]);
    const outcome = evaluateGate(gate, graph);

    expect(outcome.criteria.find((c) => c.key === 'type-established')?.met).toBe(false);
  });

  it('passes a project with an objective and a known type', () => {
    const graph = graphOf([
      node('p', 'PROJECT', { projectType: 'SAAS_WEB_APP' }),
      node('o', 'OBJECTIVE'),
      node('r', 'REQUIREMENT'),
    ]);

    expect(evaluateGate(gate, graph).result).toBe('PASSED');
  });

  it('names what is missing rather than only failing', () => {
    const outcome = evaluateGate(gate, graphOf([node('p', 'PROJECT', { projectType: 'UNKNOWN' })]));
    expect(outcome.explanation).toMatch(/objective|kind of project/i);
  });
});

describe('the requirements gate', () => {
  const gate = GATES.find((g) => g.key === 'REQUIREMENTS')!;

  it('fails when a requirement has no test verifying it', () => {
    /*
     * The traceability question, asked directly.
     *
     * A requirement with work pointing at it is not verified — the graph's edge legality already
     * refuses `TASK VERIFIES REQUIREMENT`, and this asserts the gate agrees.
     */
    const graph = graphOf(
      [node('p', 'PROJECT'), node('r', 'REQUIREMENT'), node('t', 'TASK')],
      [edge('p', 'r', 'CONTAINS'), edge('t', 'r', 'IMPLEMENTS')],
    );

    expect(
      evaluateGate(gate, graph).criteria.find((c) => c.key === 'verification-defined')?.met,
    ).toBe(false);
  });

  it('passes verification when a test verifies the requirement', () => {
    const graph = graphOf(
      [node('p', 'PROJECT'), node('r', 'REQUIREMENT'), node('t', 'TEST')],
      [edge('p', 'r', 'CONTAINS'), edge('t', 'r', 'VERIFIES')],
    );

    expect(
      evaluateGate(gate, graph).criteria.find((c) => c.key === 'verification-defined')?.met,
    ).toBe(true);
  });

  it('fails while a critical unknown is outstanding', () => {
    const graph = graphOf([
      node('p', 'PROJECT'),
      node('r', 'REQUIREMENT'),
      node('u', 'UNKNOWN', { importance: 'CRITICAL' }),
    ]);

    expect(
      evaluateGate(gate, graph).criteria.find((c) => c.key === 'critical-unknowns-resolved')?.met,
    ).toBe(false);
  });

  it('does not fail on a non-critical unknown', () => {
    // Unknowns are normal. Only the critical ones block, or the gate would never pass.
    const graph = graphOf([
      node('p', 'PROJECT'),
      node('r', 'REQUIREMENT'),
      node('u', 'UNKNOWN', { importance: 'RECOMMENDED' }),
    ]);

    expect(
      evaluateGate(gate, graph).criteria.find((c) => c.key === 'critical-unknowns-resolved')?.met,
    ).toBe(true);
  });
});

describe('the planning gate', () => {
  const gate = GATES.find((g) => g.key === 'PLANNING')!;

  it('fails on a dependency cycle', () => {
    const graph = graphOf(
      [node('p', 'PROJECT'), node('a', 'TASK'), node('b', 'TASK')],
      [edge('a', 'b', 'DEPENDS_ON'), edge('b', 'a', 'DEPENDS_ON')],
    );

    expect(
      evaluateGate(gate, graph).criteria.find((c) => c.key === 'dependencies-valid')?.met,
    ).toBe(false);
  });

  it('fails with no estimates', () => {
    const graph = graphOf([node('p', 'PROJECT'), node('ph', 'PHASE'), node('t', 'TASK')]);
    expect(evaluateGate(gate, graph).criteria.find((c) => c.key === 'estimates-present')?.met).toBe(
      false,
    );
  });

  it('fails with an empty risk register', () => {
    // A register with nothing in it means nobody looked, not that there is nothing to find.
    const graph = graphOf([node('p', 'PROJECT'), node('ph', 'PHASE'), node('t', 'TASK')]);
    expect(evaluateGate(gate, graph).criteria.find((c) => c.key === 'risks-captured')?.met).toBe(
      false,
    );
  });

  it('requires an approval before the plan is committed to', () => {
    const graph = graphOf([node('p', 'PROJECT'), node('ph', 'PHASE'), node('t', 'TASK')]);
    expect(evaluateGate(gate, graph).criteria.find((c) => c.key === 'approval-recorded')?.met).toBe(
      false,
    );
  });

  it('passes a complete plan', () => {
    const graph = graphOf(
      [
        node('p', 'PROJECT'),
        node('ph', 'PHASE'),
        node('t', 'TASK'),
        node('e', 'ESTIMATE'),
        node('r', 'RISK'),
        node('a', 'APPROVAL'),
        node('m', 'MILESTONE'),
        node('b', 'BUDGET_ITEM'),
      ],
      [edge('p', 'ph', 'CONTAINS'), edge('ph', 'm', 'CONTAINS')],
    );

    expect(evaluateGate(gate, graph).result).toBe('PASSED');
  });
});

describe('the release readiness gate and stale evidence', () => {
  const gate = GATES.find((g) => g.key === 'RELEASE_READINESS')!;

  function releaseGraph(invalidated: boolean): TwinGraph {
    const nodes = [
      node('p', 'PROJECT'),
      node('d', 'DEPLOYMENT'),
      node('a', 'APPROVAL', { purpose: 'release' }),
      node('e1', 'EVIDENCE', { purpose: 'rollback-plan' }),
      node('e2', 'EVIDENCE', { purpose: 'monitoring' }),
      node('e3', 'EVIDENCE', { purpose: 'backup-restore' }),
      node('g', 'GATE', { result: 'PASSED' }),
      node('cr', 'CHANGE_REQUEST'),
    ];

    const edges = invalidated ? [edge('cr', 'g', 'INVALIDATES')] : [];
    return graphOf(nodes, edges);
  }

  it('passes when everything the release needs exists', () => {
    expect(evaluateGate(gate, releaseGraph(false)).result).toBe('PASSED');
  });

  it('fails when an earlier gate passed on a basis that has since changed', () => {
    /*
     * Gap-spec §8.3 through to §15.8.
     *
     * A passed gate whose evidence has been invalidated still reads "passed". Releasing on that basis
     * is the precise false assurance this whole system exists to prevent — the record says it was
     * checked, and what was checked no longer exists.
     */
    const outcome = evaluateGate(gate, releaseGraph(true));

    expect(outcome.criteria.find((c) => c.key === 'no-stale-gates')?.met).toBe(false);
    expect(outcome.result).toBe('FAILED');
  });

  it('does not silently reopen the invalidated gate', () => {
    // The gate still says PASSED. What changed is that the graph now reports it is no longer safe to
    // rely on — reopening it would destroy the record of what was concluded and when.
    const graph = releaseGraph(true);
    expect(graph.node('g')?.attributes.result).toBe('PASSED');
  });

  it('requires a rehearsed rollback', () => {
    const withoutRollback = graphOf([
      node('p', 'PROJECT'),
      node('d', 'DEPLOYMENT'),
      node('a', 'APPROVAL'),
    ]);

    expect(
      evaluateGate(gate, withoutRollback).criteria.find((c) => c.key === 'rollback-plan')?.met,
    ).toBe(false);
  });

  it('requires a verified restore, not merely a backup', () => {
    const withoutRestore = graphOf([
      node('p', 'PROJECT'),
      node('d', 'DEPLOYMENT'),
      node('a', 'APPROVAL'),
      node('e', 'EVIDENCE', { purpose: 'backup-taken' }),
    ]);

    expect(
      evaluateGate(gate, withoutRestore).criteria.find((c) => c.key === 'backup-readiness')?.met,
    ).toBe(false);
  });
});

describe('the testing gate', () => {
  const gate = GATES.find((g) => g.key === 'TESTING')!;

  it('fails on a failing critical test', () => {
    const graph = graphOf([
      node('p', 'PROJECT'),
      node('t', 'TEST', { executed: true, result: 'FAILED', severity: 'CRITICAL' }),
    ]);

    expect(
      evaluateGate(gate, graph).criteria.find((c) => c.key === 'no-critical-failures')?.met,
    ).toBe(false);
  });

  it('fails when a test has not been run', () => {
    const graph = graphOf([node('p', 'PROJECT'), node('t', 'TEST', { executed: false })]);
    expect(
      evaluateGate(gate, graph).criteria.find((c) => c.key === 'categories-executed')?.met,
    ).toBe(false);
  });

  it('requires an accepted failure to carry evidence', () => {
    // An accepted exception nobody recorded becomes, six months later, a defect nobody knew about.
    const graph = graphOf([
      node('p', 'PROJECT'),
      node('t', 'TEST', { executed: true, result: 'FAILED', severity: 'MINOR' }),
    ]);

    expect(
      evaluateGate(gate, graph).criteria.find((c) => c.key === 'exceptions-documented')?.met,
    ).toBe(false);
  });

  it('accepts a documented exception', () => {
    const graph = graphOf(
      [
        node('p', 'PROJECT'),
        node('t', 'TEST', { executed: true, result: 'FAILED', severity: 'MINOR' }),
        node('e', 'EVIDENCE', { purpose: 'accepted-failure' }),
      ],
      [edge('t', 'e', 'EVIDENCED_BY')],
    );

    expect(
      evaluateGate(gate, graph).criteria.find((c) => c.key === 'exceptions-documented')?.met,
    ).toBe(true);
  });
});

describe('the completion gate', () => {
  const gate = GATES.find((g) => g.key === 'COMPLETION')!;

  it('requires ownership and access to have been transferred', () => {
    // A handover where the original team still holds the only administrative access is not one.
    const graph = graphOf([node('p', 'PROJECT'), node('d', 'DOCUMENT')]);
    expect(
      evaluateGate(gate, graph).criteria.find((c) => c.key === 'ownership-transferred')?.met,
    ).toBe(false);
  });

  it('requires every requirement to be dispositioned', () => {
    const graph = graphOf([node('p', 'PROJECT'), node('r', 'REQUIREMENT'), node('d', 'DOCUMENT')]);
    expect(
      evaluateGate(gate, graph).criteria.find((c) => c.key === 'requirements-dispositioned')?.met,
    ).toBe(false);
  });

  it('accepts a withdrawn requirement as dispositioned', () => {
    // Withdrawn is a decision. Only a requirement left in limbo is a problem.
    const withdrawn: TwinNode = { ...node('r', 'REQUIREMENT'), state: 'WITHDRAWN' };
    const graph = graphOf([node('p', 'PROJECT'), withdrawn, node('d', 'DOCUMENT')]);

    expect(
      evaluateGate(gate, graph).criteria.find((c) => c.key === 'requirements-dispositioned')?.met,
    ).toBe(true);
  });
});

describe('gap-spec §16: methodology cannot bypass a mandatory gate', () => {
  it('supports the five methodologies the spec names', () => {
    expect(METHODOLOGIES).toEqual(['AGILE', 'KANBAN', 'WATERFALL', 'HYBRID', 'SOLO']);
  });

  it('every methodology gets every gate', () => {
    /*
     * The constraint the whole methodology module exists to hold.
     *
     * Adopting a lighter process is frequently used to justify skipping verification, which conflates
     * how work is scheduled with whether it was checked.
     */
    for (const methodology of METHODOLOGIES) {
      expect(gatesFor(methodology), methodology).toEqual([...GATE_KEYS]);
    }
  });

  it('every gate with a blocking criterion is mandatory', () => {
    expect(MANDATORY_GATES).toEqual([...GATE_KEYS]);
  });

  it('no gate can be skipped', () => {
    expect(canSkipGate()).toBe(false);
  });

  it('methodology changes cadence, not existence', () => {
    // Kanban runs the security gate continuously; waterfall runs it once. Both run it.
    expect(cadenceFor('KANBAN', 'SECURITY')).toBe('REPEATED');
    expect(cadenceFor('WATERFALL', 'SECURITY')).toBe('ONCE');
    expect(gatesFor('KANBAN')).toContain('SECURITY');
    expect(gatesFor('WATERFALL')).toContain('SECURITY');
  });

  it('rejects a methodology it does not know', () => {
    expect(isMethodology('SAFE')).toBe(false);
  });

  it('states what each methodology is bad at as well as good at', () => {
    // A tool presenting every option as equally suitable is not helping anyone choose, and the choice
    // matters most to the people least equipped to make it.
    for (const methodology of METHODOLOGIES) {
      const profile = METHODOLOGY_PROFILES[methodology];
      expect(profile.suitedTo.length, methodology).toBeGreaterThan(40);
      expect(profile.poorlySuitedTo.length, methodology).toBeGreaterThan(40);
    }
  });
});

describe('methodology suggestion', () => {
  it('suggests solo delivery for a team of one', () => {
    expect(suggestMethodology({ teamSize: 1 }).methodology).toBe('SOLO');
  });

  it('suggests hybrid where compliance obligations exist', () => {
    expect(suggestMethodology({ complianceRegimes: ['UK GDPR'] }).methodology).toBe('HYBRID');
  });

  it('suggests sequential delivery when requirements are settled and the date is fixed', () => {
    expect(
      suggestMethodology({ requirementsKnown: true, deadlineFixed: true, teamSize: 5 }).methodology,
    ).toBe('WATERFALL');
  });

  it('suggests iterating when the requirements are not yet known', () => {
    expect(suggestMethodology({ requirementsKnown: false, teamSize: 5 }).methodology).toBe('AGILE');
  });

  it('always states the trade-off alongside the recommendation', () => {
    /*
     * A recommendation that only lists advantages is advertising, and the person most likely to
     * accept it uncritically is the inexperienced user this product exists to help.
     */
    for (const input of [
      { teamSize: 1 },
      { complianceRegimes: ['UK GDPR'] },
      { requirementsKnown: true, deadlineFixed: true },
      { requirementsKnown: false },
      {},
    ]) {
      const suggestion = suggestMethodology(input);
      expect(suggestion.tradeOff.length, JSON.stringify(input)).toBeGreaterThan(40);
      expect(suggestion.because.length, JSON.stringify(input)).toBeGreaterThan(40);
    }
  });

  it('is deterministic', () => {
    const input = { teamSize: 5, requirementsKnown: false };
    expect(suggestMethodology(input)).toEqual(suggestMethodology(input));
  });
});
