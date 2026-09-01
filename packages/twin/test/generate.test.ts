/**
 * Deterministic generation — the Phase-6 gate.
 *
 * Contract: plan §34, "deterministic generation from golden fixture".
 *
 * The gate is the first describe block. Everything after it exists because "the output is identical
 * every time" is necessary and nowhere near sufficient: a generator that always returned an empty
 * graph would pass the determinism test perfectly.
 */

import { describe, expect, it } from 'vitest';
import { generateProject, GENERATOR_VERSION } from '../src/generate.ts';
import { checkInvariants, errorsOnly } from '../src/invariants.ts';
import { stableStringify } from '../src/versioning.ts';
import {
  BARELY_ANSWERED,
  FIXED_TIME,
  FIXTURE_PROJECT_ID,
  RISKY_SOLO,
  UNSUPPORTED_TYPE,
  WELL_ANSWERED_SAAS,
} from './fixtures.ts';

function generate(intake: readonly Parameters<typeof generateProject>[0]['intake'][number][]) {
  return generateProject({
    projectId: FIXTURE_PROJECT_ID,
    projectName: 'Fixture project',
    projectSummary: 'A fixture.',
    intake,
    at: FIXED_TIME,
  });
}

/** The whole graph as a canonical string, for byte-comparison. */
function serialise(result: ReturnType<typeof generate>): string {
  return stableStringify({
    nodes: [...result.graph.nodes].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...result.graph.edges].sort((a, b) => a.id.localeCompare(b.id)),
    assumptions: result.assumptions,
    unknowns: result.unknowns,
  });
}

describe('the Phase-6 gate: deterministic generation', () => {
  const FIXTURES = [
    ['well-answered SaaS', WELL_ANSWERED_SAAS],
    ['barely answered', BARELY_ANSWERED],
    ['risky solo project', RISKY_SOLO],
    ['unsupported project type', UNSUPPORTED_TYPE],
  ] as const;

  for (const [name, intake] of FIXTURES) {
    it(`produces a byte-identical graph on every run: ${name}`, () => {
      // Ten runs rather than two. A generator that depends on `Map` iteration order or on a `Set`
      // built from a hash is usually stable across two runs and not across ten.
      const runs = Array.from({ length: 10 }, () => serialise(generate(intake)));
      const first = runs[0];

      expect(first).toBeDefined();
      for (const run of runs) expect(run).toBe(first);
    });

    it(`produces stable node ids: ${name}`, () => {
      // The stronger property. Identical *content* with different ids would still break the change
      // log and make two plans incomparable, and a naive deep-equal would not notice.
      const a = generate(intake).graph.nodes.map((n) => n.id);
      const b = generate(intake).graph.nodes.map((n) => n.id);

      expect(a).toEqual(b);
      expect(a.every((id) => id.startsWith(FIXTURE_PROJECT_ID))).toBe(true);
      expect(a.some((id) => /^[0-9a-f-]{36}$/.test(id))).toBe(false);
    });

    it(`produces a graph with no invariant errors: ${name}`, () => {
      // A deterministic graph that violates its own rules is deterministically wrong.
      const report = checkInvariants(generate(intake).graph);
      expect(errorsOnly(report)).toEqual([]);
    });
  }

  it('records the generator version on the project node', () => {
    // Without it, a stored plan cannot be explained after the rules change — the numbers would be
    // reinterpreted under rules the user never saw.
    const { graph } = generate(WELL_ANSWERED_SAAS);
    const project = graph.nodesOfClass('PROJECT')[0];

    expect(project?.attributes.generatorVersion).toBe(GENERATOR_VERSION);
  });

  it('uses the supplied timestamp rather than the clock', () => {
    const { graph } = generate(WELL_ANSWERED_SAAS);
    expect(graph.nodes.every((n) => n.createdAt === FIXED_TIME)).toBe(true);
  });

  it('produces different graphs for different inputs', () => {
    // Guards the guard: every determinism test above would pass if `generate` ignored its input.
    expect(serialise(generate(WELL_ANSWERED_SAAS))).not.toBe(serialise(generate(RISKY_SOLO)));
  });
});

describe('what the generator derives from a well-answered project', () => {
  const { graph } = generate(WELL_ANSWERED_SAAS);
  const labels = (cls: Parameters<typeof graph.nodesOfClass>[0]) =>
    graph.nodesOfClass(cls).map((n) => n.label);

  it('creates exactly one project node', () => {
    expect(graph.nodesOfClass('PROJECT')).toHaveLength(1);
  });

  it('derives the SaaS phase pack, not the generic one', () => {
    // Plan §7: the rule pack keys off project type. A SaaS product that got the generic phases would
    // be missing the tenant-isolation phase, which is the one defect class that ends a SaaS company.
    expect(labels('PHASE')).toContain('Tenant isolation');
    expect(labels('PHASE')).toContain('Security hardening');
  });

  it('sequences phases rather than presenting them as simultaneous', () => {
    const order = graph.topologicalOrder('DEPENDS_ON');
    expect(order.ok).toBe(true);
  });

  it('gives every phase a gate', () => {
    // A phase with no completion criterion is a phase that is always complete.
    const phases = graph.nodesOfClass('PHASE');
    for (const phase of phases) {
      const gates = graph.children(phase.id).filter((n) => n.class === 'GATE');
      expect(gates, `${phase.label} has no gate`).toHaveLength(1);
    }
  });

  it('raises an authentication requirement because the intake said users sign in', () => {
    expect(labels('REQUIREMENT')).toContain('Authenticate users');
  });

  it('raises a personal-data requirement from the data types held', () => {
    expect(labels('REQUIREMENT')).toContain('Handle personal data lawfully');
  });

  it('does not raise a payment-card requirement for a project that holds no card data', () => {
    // The inverse assertion matters more than the positive one: a generator that raised every
    // requirement for every project would pass all the tests above and be useless.
    expect(labels('REQUIREMENT')).not.toContain('Meet payment-card obligations');
  });

  it('traces every requirement back to the intake field that caused it', () => {
    // Plan §12: explainable. A requirement nobody can trace is one the user cannot challenge.
    for (const requirement of graph.nodesOfClass('REQUIREMENT')) {
      expect(requirement.provenance.sourceRef, requirement.label).toMatch(/^intake:/);
    }
  });

  it('links requirements to the objective they satisfy', () => {
    const satisfies = graph.edges.filter((e) => e.class === 'SATISFIES');
    expect(satisfies.length).toBeGreaterThan(0);
    for (const edge of satisfies) {
      expect(edge.rationale, edge.id).toBeDefined();
    }
  });

  it('raises the public-exposure risk for a SaaS product', () => {
    expect(labels('RISK')).toContain('The system is exposed to the public internet');
  });

  it('does not raise the unknown-budget risk when the budget is known', () => {
    expect(labels('RISK')).not.toContain('No budget has been established');
  });

  it('does not raise the single-person risk for a team of five', () => {
    expect(labels('RISK')).not.toContain('The project depends on one person');
  });

  it('marks engine-derived nodes as deterministic calculations, not user statements', () => {
    // The trust ordering depends on this. A phase the engine invented must never claim the rank of
    // something the user confirmed.
    for (const phase of graph.nodesOfClass('PHASE')) {
      expect(phase.provenance.provenance).toBe('DETERMINISTIC_CALCULATION');
    }
  });
});

describe('what the generator does when it knows almost nothing', () => {
  const result = generate(BARELY_ANSWERED);
  const { graph } = result;

  it('still produces a usable plan rather than refusing', () => {
    // Guest-first (plan §2.3). A product that demands twenty-five answers before showing anything is
    // one the intended user abandons at question four.
    expect(graph.nodesOfClass('PHASE').length).toBeGreaterThan(0);
  });

  it('states that the project type is unknown instead of assuming a web app', () => {
    const project = graph.nodesOfClass('PROJECT')[0];
    expect(project?.attributes.projectType).toBe('UNKNOWN');
  });

  it('records the missing project type as an explicit assumption', () => {
    expect(result.assumptions.join(' ')).toMatch(/kind of project was not established/i);
  });

  it('raises the unknown-type risk', () => {
    expect(graph.nodesOfClass('RISK').map((n) => n.label)).toContain(
      'The kind of project has not been established',
    );
  });

  it('creates UNKNOWN nodes for unanswered critical fields', () => {
    // Plan §10 and gap-spec §10: an unknown that is merely absent from the graph is
    // indistinguishable from one nobody thought to ask about.
    expect(graph.nodesOfClass('UNKNOWN').length).toBeGreaterThan(0);
  });

  it('raises no requirements it cannot justify', () => {
    // The failure being guarded against is a generator that pads a thin plan to look substantial.
    expect(graph.nodesOfClass('REQUIREMENT')).toHaveLength(0);
  });

  it('does not invent an objective', () => {
    expect(graph.nodesOfClass('OBJECTIVE')).toHaveLength(0);
    expect(result.unknowns.join(' ')).toMatch(/no primary objective/i);
  });
});

describe('what the generator does with a risky project shape', () => {
  const result = generate(RISKY_SOLO);
  const risks = result.graph.nodesOfClass('RISK').map((n) => n.label);

  it('raises the fixed-deadline risk', () => {
    expect(risks).toContain('The deadline is fixed and the scope is not');
  });

  it('raises the unknown-budget risk', () => {
    expect(risks).toContain('No budget has been established');
  });

  it('raises the single-person risk', () => {
    expect(risks).toContain('The project depends on one person');
  });

  it('raises the skills-gap risk', () => {
    expect(risks).toContain('The work needs skills the team has not confirmed');
  });

  it('raises the payment-card requirement', () => {
    expect(result.graph.nodesOfClass('REQUIREMENT').map((n) => n.label)).toContain(
      'Meet payment-card obligations',
    );
  });

  it('derives the e-commerce phase pack', () => {
    expect(result.graph.nodesOfClass('PHASE').map((n) => n.label)).toContain(
      'Payments and compliance',
    );
  });

  it('records the assumed accessibility target as an assumption node, not as a fact', () => {
    // The distinction the whole provenance system exists for. An assumed value that presents as
    // confirmed is how a plan silently acquires false certainty.
    const assumptions = result.graph.nodesOfClass('ASSUMPTION');
    expect(assumptions.length).toBeGreaterThan(0);
    for (const node of assumptions) {
      expect(node.provenance.provenance).toBe('ASSUMPTION');
      expect(node.description).toMatch(/nobody has confirmed this/i);
    }
  });

  it('surfaces every assumption in the result, not only in the graph', () => {
    // The UI reads this list. An assumption recorded in the graph but absent from the summary is one
    // the user will never be shown.
    expect(result.assumptions.length).toBeGreaterThan(0);
  });
});

describe('a project type the taxonomy does not cover', () => {
  const result = generate(UNSUPPORTED_TYPE);

  it('falls back to the generic phases rather than guessing a web app', () => {
    // Gap-spec §12.2 on unsupported values: report, never coerce. Silently treating firmware as a web
    // app would produce a plan full of obligations that do not apply and missing the ones that do.
    const labels = result.graph.nodesOfClass('PHASE').map((n) => n.label);
    expect(labels).not.toContain('Security hardening');
    expect(labels).toContain('Discovery');
  });

  it('does not claim the type is unknown when the user did answer', () => {
    // The user answered; the platform does not support the answer. Those are different failures and
    // conflating them would tell the user to go and answer a question they already answered.
    const project = result.graph.nodesOfClass('PROJECT')[0];
    expect(project?.attributes.projectType).toBe('EMBEDDED_FIRMWARE');
  });
});
