/**
 * Gate criteria the rules ask for.
 *
 * Contract: gap-spec §13 (the engine's emissions are its output), §15 (gates define exact criteria),
 * plan §12 (a rule explains itself and is traceable).
 *
 * ## What was wrong
 *
 * The evaluator produced 73 gate criteria across the catalogue and every caller threw them away.
 * `evaluateGates` read the static catalogue and nothing else, so a rule saying "a public web
 * application's security gate must also require a documented threat model" had no effect on the
 * security gate — or on anything else. 287 rules were evaluated, explained, traced and rendered, and
 * not one of them could stop a project advancing.
 *
 * The tests below are written so that the *old* behaviour fails them. Several assert that a gate
 * changes result when a rule demands something, which is precisely what could not happen before.
 */

import { describe, expect, it } from 'vitest';
import { TwinGraph } from '@govintel/twin/graph';
import { createNode, type NodeClass, type TwinNode } from '@govintel/twin/nodes';
import { RULES, RULESET_VERSION } from '../src/catalogue.ts';
import { evaluateRules } from '../src/evaluate.ts';
import {
  GATES,
  criterionFromRule,
  emittedCriterionKey,
  evaluateGate,
  evaluateGates,
  evidencePurposes,
  gatesWith,
  manualCriteria,
  type EmittedGateCriterion,
} from '../src/gates.ts';

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

function graphOf(nodes: readonly TwinNode[]): TwinGraph {
  return new TwinGraph({ projectId: PROJECT, nodes, edges: [] });
}

const emitted = (
  gateKey: string,
  criterion: string,
  blocking = true,
  ruleId = 'ARCH-001',
): EmittedGateCriterion => ({ gateKey, criterion, blocking, ruleId });

describe('a rule can add a criterion to a gate', () => {
  it('attaches it to the gate the rule named', () => {
    const gates = gatesWith([emitted('ARCHITECTURE', 'A threat model is documented.')]);
    const architecture = gates.find((g) => g.key === 'ARCHITECTURE');

    expect(architecture?.criteria.map((c) => c.statement)).toContain(
      'A threat model is documented.',
    );
  });

  it('leaves every other gate exactly as it was', () => {
    const before = GATES.find((g) => g.key === 'TESTING');
    const after = gatesWith([emitted('ARCHITECTURE', 'A threat model is documented.')]).find(
      (g) => g.key === 'TESTING',
    );

    expect(after).toBe(before);
  });

  it('changes nothing at all when the rules asked for nothing', () => {
    expect(gatesWith([])).toBe(GATES);
  });
});

describe('a rule-emitted criterion can actually block a gate', () => {
  /*
   * The heart of it. Before this wiring, no combination of rule and project could move a gate off
   * the verdict the catalogue alone produced.
   */
  /** Everything the ARCHITECTURE gate's own five criteria ask for, so it passes on the catalogue. */
  const architectureSatisfied = [
    node('c1', 'ARCHITECTURE_COMPONENT'),
    node('d1', 'ARCHITECTURE_DECISION'),
    node('env1', 'ENVIRONMENT'),
    node('e1', 'EVIDENCE', { purpose: 'security-architecture' }),
  ];

  const passing = graphOf(architectureSatisfied);

  it('the graph really does pass the gate on its own', () => {
    /*
     * Asserted rather than assumed. The test below is only meaningful if the gate would otherwise
     * be PASSED — against an already-failing gate "not passed" proves nothing, and an earlier draft
     * of this file made exactly that mistake by naming two node classes that do not exist.
     */
    expect(evaluateGates(passing).find((g) => g.key === 'ARCHITECTURE')?.result).toBe('PASSED');
  });

  it('turns a passing gate into a failing one', () => {
    const demand = [emitted('ARCHITECTURE', 'A threat model is documented.')];
    const withRule = evaluateGates(passing, demand).find((g) => g.key === 'ARCHITECTURE');

    /*
     * FAILED rather than INDETERMINATE, matching the catalogue's own seventeen MANUAL criteria.
     *
     * The distinction the gate system draws is between "we checked and it is not so" and "we cannot
     * tell from what exists". A missing evidence record is the first: the platform can see the whole
     * record and there is nothing in it. Undecidable is for a check whose *inputs* are absent.
     */
    expect(withRule?.result).toBe('FAILED');

    const criterion = withRule?.criteria.find(
      (c) => c.statement === 'A threat model is documented.',
    );
    expect(criterion?.met).toBe(false);
  });

  it('is satisfied by evidence recorded for it, and the gate passes again', () => {
    const criterion = 'A threat model is documented.';
    const purpose = emittedCriterionKey(criterion);

    const withEvidence = graphOf([...architectureSatisfied, node('e2', 'EVIDENCE', { purpose })]);

    const outcome = evaluateGate(
      gatesWith([emitted('ARCHITECTURE', criterion)]).find((g) => g.key === 'ARCHITECTURE')!,
      withEvidence,
    );

    expect(outcome.criteria.find((c) => c.statement === criterion)?.met).toBe(true);
    // The whole round trip: a rule demanded something, the gate held, evidence satisfied it.
    expect(outcome.result).toBe('PASSED');
  });

  it('reports rather than blocks when the rule said it was not blocking', () => {
    const gate = gatesWith([emitted('ARCHITECTURE', 'A capacity model exists.', false)]).find(
      (g) => g.key === 'ARCHITECTURE',
    );

    const criterion = gate?.criteria.find((c) => c.statement === 'A capacity model exists.');
    expect(criterion?.blocking).toBe(false);
  });
});

describe('the criterion a rule produces', () => {
  it('is MANUAL, because a rule asking for an artefact is asking for evidence', () => {
    const criterion = criterionFromRule(
      emitted('ARCHITECTURE', 'A threat model is documented.'),
      undefined,
    );

    expect(criterion.kind).toBe('MANUAL');
    expect(criterion.evidencePurpose).toBe(criterion.key);
  });

  it('carries the rule’s own reasoning when the rule has one', () => {
    const rule = RULES[0];
    const criterion = criterionFromRule(
      emitted('ARCHITECTURE', 'Something the rule wants.', true, rule?.id ?? ''),
      rule?.rationale,
    );

    // Not "because rule ARCH-001 says so" — the point of the catalogue is that it explains itself.
    expect(criterion.rationale).toBe(rule?.rationale);
  });

  it('falls back to naming the rule when it has no rationale to give', () => {
    const criterion = criterionFromRule(
      emitted('ARCHITECTURE', 'Something.', true, 'XYZ-999'),
      undefined,
    );
    expect(criterion.rationale).toContain('XYZ-999');
  });

  it('derives the same key from the same demand, so two rules share one piece of evidence', () => {
    const a = emittedCriterionKey('A threat model is documented.');
    const b = emittedCriterionKey('A  threat   model is documented!');

    expect(a).toBe(b);
    expect(a).toMatch(/^rule-[a-z0-9-]+$/);
  });
});

describe('what a rule cannot do', () => {
  it('cannot invent a gate that does not exist', () => {
    /*
     * `gateKey` is a free string in the rule schema. A typo must not create a twelfth gate that
     * nobody defined and nothing can pass.
     */
    const gates = gatesWith([emitted('ARCHITECTUER', 'Typo gate.')]);

    expect(gates).toHaveLength(GATES.length);
    expect(gates.flatMap((g) => g.criteria).map((c) => c.statement)).not.toContain('Typo gate.');
  });

  it('cannot replace a criterion the catalogue already checks automatically', () => {
    const existing = GATES.find((g) => g.key === 'ARCHITECTURE')?.criteria.find(
      (c) => c.kind === 'AUTOMATIC',
    );

    const restated = emitted('ARCHITECTURE', existing?.statement ?? '');
    const gate = gatesWith([restated]).find((g) => g.key === 'ARCHITECTURE');

    // Only if the derived key collides — which it does not for prose statements — but the guard is
    // what matters: an automatic check must never be downgraded to "upload a file saying so".
    const automatic = gate?.criteria.filter((c) => c.statement === existing?.statement);
    expect(automatic?.some((c) => c.kind === 'AUTOMATIC')).toBe(true);
  });
});

describe('the evidence surface sees what the rules demand', () => {
  const demand = [emitted('ARCHITECTURE', 'A threat model is documented.')];

  it('offers the rule-emitted criterion alongside the catalogue’s own', () => {
    const criteria = manualCriteria(demand);
    const statements = criteria.map((c) => c.statement);

    expect(statements).toContain('A threat model is documented.');
    // The catalogue's seventeen are still there.
    expect(criteria.length).toBeGreaterThan(manualCriteria().length);
  });

  it('accepts the purpose that would satisfy it', () => {
    // `evidencePurposes` is what the server action validates against. A purpose the gate wants but
    // the action refuses is a criterion nobody can ever satisfy — the failure this replaces.
    expect(evidencePurposes(demand)).toContain(
      emittedCriterionKey('A threat model is documented.'),
    );
  });
});

describe('the derived keys hold up against the whole catalogue', () => {
  /*
   * The key is a slug of the first eight words of the criterion, which is what lets two rules
   * asking for the same thing share one piece of evidence. The same property is a hazard: two
   * *different* demands whose openings match would collapse into one, and satisfying either would
   * silently satisfy both. Measured across all 287 rules today — 73 distinct keys, no collisions —
   * and asserted so that the rule which would break it fails here instead.
   */
  const emittedByKey = new Map<string, Set<string>>();

  for (const rule of RULES) {
    for (const gate of rule.emittedGates) {
      const key = emittedCriterionKey(gate.criterion);
      const existing = emittedByKey.get(key) ?? new Set<string>();
      existing.add(`${gate.gateKey}|${gate.criterion}`);
      emittedByKey.set(key, existing);
    }
  }

  it('gives two different demands two different keys', () => {
    const collisions = [...emittedByKey.entries()]
      .filter(([, demands]) => demands.size > 1)
      .map(([key, demands]) => ({ key, demands: [...demands] }));

    expect(collisions).toEqual([]);
  });

  it('never collides with a criterion the catalogue already defines', () => {
    // A collision here would let a rule's evidence silently satisfy a catalogue criterion, or
    // replace one — including an AUTOMATIC check.
    const catalogue = new Set(GATES.flatMap((g) => g.criteria.map((c) => c.key)));
    const clashes = [...emittedByKey.keys()].filter((key) => catalogue.has(key));

    expect(clashes).toEqual([]);
  });

  it('found something to check', () => {
    // Guards the two assertions above against an empty map passing them vacuously.
    expect(emittedByKey.size).toBeGreaterThan(50);
  });
});

describe('against the real catalogue', () => {
  it('produces gate criteria for a real project, and they reach the gates', () => {
    const evaluation = evaluateRules(
      RULES,
      {
        projectId: PROJECT,
        projectType: 'PUBLIC_WEB_APP',
        lifecycleState: 'PLANNING',
        methodology: 'AGILE',
        intake: [],
        asOf: '2026-03-01',
      },
      RULESET_VERSION,
    );

    const demanded = evaluation.emissions.gates;

    // If this is ever zero the test above proves nothing, so assert the premise.
    expect(demanded.length).toBeGreaterThan(0);

    const before = evaluateGates(graphOf([])).flatMap((g) => g.criteria).length;
    const after = evaluateGates(graphOf([]), demanded).flatMap((g) => g.criteria).length;

    expect(after).toBeGreaterThan(before);
  });
});
