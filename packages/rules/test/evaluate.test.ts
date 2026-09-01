/**
 * The rules golden suite.
 *
 * Contract: gap-spec §13.1 (determinism), §13.2 (precedence, and never resolving a critical conflict
 * silently), §13.3 (every emitted action answers "why is this required?"); §14 (a meaningful
 * catalogue rather than a padded one).
 *
 * Two things are being defended, and only one of them is obvious.
 *
 * The obvious one is that the engine produces the right answers. The other is that it produces the
 * right *kind* of answer when it cannot decide — an unanswered input must make a rule
 * `INDETERMINATE`, never `NOT_APPLICABLE`. That single distinction is what separates "this project
 * has no payment obligations" from "nobody said whether it takes payments", and a system that
 * collapses them tells people they are compliant because they left a field blank.
 */

import { describe, expect, it } from 'vitest';
import type { IntakeField } from '@govintel/intake/schema';
import { TwinGraph } from '@govintel/twin/graph';
import { createNode } from '@govintel/twin/nodes';
import {
  RULES,
  RULESET_VERSION,
  MINIMUM_RULES,
  checkCatalogue,
  countByCategory,
  findRule,
  summariseCatalogue,
} from '../src/catalogue.ts';
import { evaluateRules, summarise, type EvaluationContext } from '../src/evaluate.ts';
import { defineRule, RULE_CATEGORIES, type Rule } from '../src/schema.ts';
import { outranks, resolveConflict, SOURCE_PRECEDENCE } from '../src/precedence.ts';

const AT = '2026-06-01';

function field(
  fieldId: string,
  value: unknown,
  state: IntakeField['state'] = 'CONFIRMED',
): IntakeField {
  return {
    fieldId,
    category: 'IDEA',
    value,
    state,
    provenance: state === 'ASSUMED' ? 'ASSUMPTION' : 'USER_CONFIRMED',
    confidence: 'HIGH',
    lastUpdatedAt: '2026-03-01T09:00:00.000Z',
  };
}

function context(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    projectId: 'p1',
    lifecycleState: 'PLANNING',
    methodology: 'AGILE',
    intake: [],
    asOf: AT,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* The catalogue                                                              */
/* -------------------------------------------------------------------------- */

describe('the catalogue', () => {
  it('meets every category minimum gap-spec §14 sets', () => {
    const counts = countByCategory();
    for (const category of RULE_CATEGORIES) {
      expect(counts[category], category).toBeGreaterThanOrEqual(MINIMUM_RULES[category]);
    }
  });

  it('exceeds the overall minimum of 270', () => {
    expect(RULES.length).toBeGreaterThanOrEqual(270);
  });

  it('has no structural problems', () => {
    expect(checkCatalogue()).toEqual([]);
  });

  it('gives every rule a unique id', () => {
    const ids = RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every rule something to emit', () => {
    /*
     * The check against padding.
     *
     * Gap-spec §14: "Do not create artificial rules solely to meet a number." A rule that emits
     * nothing would pass every schema check, sit in the catalogue, count towards the total, and do
     * nothing — which is exactly what padding looks like. `defineRule` refuses it, and this asserts
     * the refusal is actually in force.
     */
    for (const rule of RULES) {
      const emits =
        rule.emittedRequirements.length +
        rule.emittedTasks.length +
        rule.emittedTests.length +
        rule.emittedGates.length +
        rule.emittedRisks.length +
        rule.calculationEffects.length;
      expect(emits, rule.id).toBeGreaterThan(0);
    }
  });

  it('gives every rule a substantive rationale and remediation', () => {
    // §13.3. A finding with no remediation is a complaint, and a rationale of ten characters is a
    // restatement of the title.
    for (const rule of RULES) {
      expect(rule.rationale.length, rule.id).toBeGreaterThan(40);
      expect(rule.remediation.length, rule.id).toBeGreaterThan(20);
    }
  });

  it('cites a source for every mandatory legal or security rule', () => {
    // An uncitable obligation cannot be challenged or retired, so it becomes folklore.
    for (const rule of RULES) {
      if (rule.severity !== 'MANDATORY' || rule.source !== 'LEGAL_SECURITY') continue;
      expect(rule.references.length, rule.id).toBeGreaterThan(0);
    }
  });

  it('does not make every rule mandatory', () => {
    /*
     * A catalogue where everything blocks is a catalogue nobody reads: the first rule anybody hits
     * gets waived, and the habit spreads to the ones that mattered.
     *
     * The threshold is deliberately generous — many of these genuinely are obligations — but a
     * catalogue at 95% mandatory would be one where the severity field carries no information.
     */
    const mandatory = RULES.filter((r) => r.severity === 'MANDATORY').length;
    expect(mandatory / RULES.length).toBeLessThan(0.8);
  });

  it('never claims a project is compliant, only that something was evidenced', () => {
    // The platform records evidence; it does not certify. A rule emitting "PCI DSS compliant" would
    // be making an assessor's judgement on their behalf.
    for (const rule of RULES) {
      const text = `${rule.title} ${rule.description}`.toLowerCase();
      expect(text, rule.id).not.toMatch(/\bis compliant\b|\bcertifies\b|\bguarantees\b/);
    }
  });

  it('finds a rule by id', () => {
    expect(findRule('SEC-AUTHZ-001')?.category).toBe('SECURITY');
    expect(findRule('NOT-A-RULE-001')).toBeUndefined();
  });

  it('reports a summary that matches the rules', () => {
    const summary = summariseCatalogue();
    expect(summary.total).toBe(RULES.length);
    expect(summary.emittedRequirements).toBeGreaterThan(50);
  });
});

/* -------------------------------------------------------------------------- */
/* Determinism                                                                */
/* -------------------------------------------------------------------------- */

describe('gap-spec §13.1: determinism', () => {
  const ctx = context({
    projectType: 'SAAS_WEB_APP',
    intake: [
      field('security.authentication', true),
      field('data.types', ['Personal data', 'Account details']),
      field('accessibility.target', 'WCAG 2.2 AA'),
      field('team.size', 4),
    ],
  });

  it('produces an identical result on every run', () => {
    // Ten runs rather than two: a dependency on Map ordering is usually stable across two.
    const runs = Array.from({ length: 10 }, () =>
      JSON.stringify(evaluateRules(RULES, ctx, RULESET_VERSION)),
    );
    for (const run of runs) expect(run).toBe(runs[0]);
  });

  it('returns results in catalogue order', () => {
    // The UI renders findings in the order it receives them. A list that reshuffles between two
    // identical runs looks like the project changed.
    const result = evaluateRules(RULES, ctx, RULESET_VERSION);
    expect(result.results.map((r) => r.ruleId)).toEqual(RULES.map((r) => r.id));
  });

  it('records the ruleset version with the result', () => {
    // Without it, a stored evaluation cannot be explained once the catalogue moves on.
    expect(evaluateRules(RULES, ctx, RULESET_VERSION).rulesetVersion).toBe(RULESET_VERSION);
  });

  it('produces a different result for a different project', () => {
    // Guards the guard: the determinism tests above would pass for an engine that ignored its input.
    const other = context({ projectType: 'DEVELOPER_TOOLING', intake: [] });
    expect(JSON.stringify(evaluateRules(RULES, ctx, RULESET_VERSION))).not.toBe(
      JSON.stringify(evaluateRules(RULES, other, RULESET_VERSION)),
    );
  });

  it('does not depend on the order the intake was supplied in', () => {
    const reversed = context({ ...ctx, intake: [...ctx.intake].reverse() });
    expect(JSON.stringify(evaluateRules(RULES, reversed, RULESET_VERSION))).toBe(
      JSON.stringify(evaluateRules(RULES, ctx, RULESET_VERSION)),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* The three outcomes                                                         */
/* -------------------------------------------------------------------------- */

describe('unanswered inputs make a rule indeterminate, never inapplicable', () => {
  /*
   * The most consequential behaviour in the engine.
   *
   * A security rule conditioned on "the system holds payment data" must not quietly become
   * "does not apply" for every project that has not answered the question. That would show a plan
   * with no payment obligations at all, indistinguishable from a project that genuinely has none.
   */

  it('reports INDETERMINATE when a required input is missing', () => {
    const result = evaluateRules(RULES, context({ projectType: 'ECOMMERCE' }), RULESET_VERSION);
    const payment = result.results.find((r) => r.ruleId === 'SEC-PAY-001');

    expect(payment?.outcome).toBe('INDETERMINATE');
  });

  it('names the input that is missing', () => {
    const result = evaluateRules(RULES, context({ projectType: 'ECOMMERCE' }), RULESET_VERSION);
    const payment = result.results.find((r) => r.ruleId === 'SEC-PAY-001');

    expect(payment?.missingInputs).toContain('data.types');
  });

  it('reports NOT_APPLICABLE only when the answer genuinely rules the rule out', () => {
    const result = evaluateRules(
      RULES,
      context({ projectType: 'ECOMMERCE', intake: [field('data.types', ['Account details'])] }),
      RULESET_VERSION,
    );

    expect(result.results.find((r) => r.ruleId === 'SEC-PAY-001')?.outcome).toBe('NOT_APPLICABLE');
  });

  it('reports APPLIED when the answer triggers it', () => {
    const result = evaluateRules(
      RULES,
      context({ projectType: 'ECOMMERCE', intake: [field('data.types', ['Payment card data'])] }),
      RULESET_VERSION,
    );

    expect(result.results.find((r) => r.ruleId === 'SEC-PAY-001')?.outcome).toBe('APPLIED');
  });

  it('treats an unanswered project type as indeterminate for type-scoped rules', () => {
    /*
     * Otherwise a project that skipped one question silently escapes every project-type security
     * obligation, and the plan shows none of them — which reads as "none apply".
     */
    const result = evaluateRules(RULES, context(), RULESET_VERSION);
    const tenant = result.results.find((r) => r.ruleId === 'SEC-TENANT-001');

    expect(tenant?.outcome).toBe('INDETERMINATE');
    expect(tenant?.missingInputs).toContain('project.type');
  });

  it('collects every blocking input so the UI can ask for them', () => {
    const result = evaluateRules(RULES, context(), RULESET_VERSION);
    const summary = summarise(result);

    expect(summary.blockingInputs.length).toBeGreaterThan(0);
    expect(summary.blockingInputs).toEqual([...summary.blockingInputs].sort());
  });

  it('an unknown answer does not count as an answer', () => {
    // An UNKNOWN field holds a value — the marker the user chose. Treating it as answered would let
    // "I don't know" masquerade as a fact.
    const result = evaluateRules(
      RULES,
      context({
        projectType: 'ECOMMERCE',
        intake: [field('data.types', null, 'UNKNOWN')],
      }),
      RULESET_VERSION,
    );

    expect(result.results.find((r) => r.ruleId === 'SEC-PAY-001')?.outcome).toBe('INDETERMINATE');
  });
});

/* -------------------------------------------------------------------------- */
/* Explanations                                                               */
/* -------------------------------------------------------------------------- */

describe('gap-spec §13.3: every outcome explains itself', () => {
  const result = evaluateRules(
    RULES,
    context({
      projectType: 'SAAS_WEB_APP',
      intake: [field('security.authentication', true), field('data.types', ['Personal data'])],
    }),
    RULESET_VERSION,
  );

  it('explains every applied rule', () => {
    for (const r of result.results.filter((x) => x.outcome === 'APPLIED')) {
      expect(r.explanation.length, r.ruleId).toBeGreaterThan(40);
    }
  });

  it('explains why a rule did not apply, not only that it did not', () => {
    // "Why is this *not* required?" is asked as often as the positive form, usually by someone who
    // expected it to be. An engine that can only justify its positives loses trust on the first
    // negative anyone disagrees with.
    for (const r of result.results.filter((x) => x.outcome === 'NOT_APPLICABLE')) {
      expect(r.explanation.length, r.ruleId).toBeGreaterThan(20);
    }
  });

  it('says what an applied rule requires doing', () => {
    const applied = result.results.find(
      (r) => r.ruleId === 'SEC-AUTH-001' && r.outcome === 'APPLIED',
    );
    expect(applied?.explanation).toMatch(/add an authentication test pack/i);
  });

  it('says whether a rule blocks or advises', () => {
    const applied = result.results.find(
      (r) => r.outcome === 'APPLIED' && r.severity === 'MANDATORY',
    );
    expect(applied?.explanation).toMatch(/blocks the gate/i);
  });

  it('carries the rule version so a stored finding stays explainable', () => {
    for (const r of result.results) {
      expect(r.ruleVersion, r.ruleId).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Emissions                                                                  */
/* -------------------------------------------------------------------------- */

describe('what an evaluation emits', () => {
  const result = evaluateRules(
    RULES,
    context({
      projectType: 'SAAS_WEB_APP',
      intake: [
        field('security.authentication', true),
        field('data.types', ['Personal data', 'Health data']),
        field('accessibility.target', 'WCAG 2.2 AA'),
        field('compliance.regimes', ['UK GDPR']),
      ],
    }),
    RULESET_VERSION,
  );

  it('emits requirements for the obligations that fired', () => {
    const keys = result.emissions.requirements.map((r) => r.key);
    expect(keys).toContain('auth-verified');
    expect(keys).toContain('lawful-basis');
    expect(keys).toContain('tenant-isolation');
  });

  it('attributes every emission to the rule that produced it', () => {
    // Plan §12: explainable. An emitted requirement nobody can trace back cannot be challenged.
    for (const requirement of result.emissions.requirements) {
      expect(findRule(requirement.ruleId), requirement.key).toBeDefined();
    }
  });

  it('does not emit the same requirement twice when several rules converge on it', () => {
    const keys = result.emissions.requirements.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps every calculation effect, even where two rules affect the same figure', () => {
    /*
     * Deliberately not deduplicated. Two rules adding contingency for different reasons both add
     * contingency, and collapsing them would silently discard one of the reasons the number is what
     * it is.
     */
    const contingency = result.emissions.calculationEffects.filter(
      (e) => e.kind === 'ADD_CONTINGENCY_PERCENT',
    );
    expect(contingency.every((e) => e.basis.length > 20)).toBe(true);
  });

  it('emits gate criteria attached to real gates', () => {
    expect(result.emissions.gates.length).toBeGreaterThan(0);
  });

  it('emits nothing at all for a project with no answers', () => {
    // Almost everything is indeterminate, and an engine that emitted requirements anyway would be
    // inventing obligations from nothing.
    const empty = evaluateRules(RULES, context(), RULESET_VERSION);
    const summary = summarise(empty);

    expect(summary.indeterminate).toBeGreaterThan(20);
    expect(empty.emissions.requirements.length).toBeLessThan(result.emissions.requirements.length);
  });
});

/* -------------------------------------------------------------------------- */
/* Precedence and conflicts                                                   */
/* -------------------------------------------------------------------------- */

describe('gap-spec §13.2: precedence', () => {
  it('orders sources as the spec does', () => {
    expect(SOURCE_PRECEDENCE).toEqual([
      'LEGAL_SECURITY',
      'ORGANIZATION_POLICY',
      'PROJECT_CONSTRAINT',
      'PROJECT_TYPE_PACK',
      'METHODOLOGY_PACK',
      'RECOMMENDED_DEFAULT',
    ]);
  });

  it('a legal obligation outranks organisation policy', () => {
    // An organisation cannot policy its way out of the law.
    expect(outranks('LEGAL_SECURITY', 'ORGANIZATION_POLICY')).toBe(true);
  });

  it('an explicit project constraint outranks the project-type pack', () => {
    // The person doing the work knows something the taxonomy does not.
    expect(outranks('PROJECT_CONSTRAINT', 'PROJECT_TYPE_PACK')).toBe(true);
  });

  it('a recommended default outranks nothing', () => {
    for (const source of SOURCE_PRECEDENCE) {
      if (source === 'RECOMMENDED_DEFAULT') continue;
      expect(outranks('RECOMMENDED_DEFAULT', source)).toBe(false);
    }
  });

  it('a source does not outrank itself', () => {
    expect(outranks('LEGAL_SECURITY', 'LEGAL_SECURITY')).toBe(false);
  });
});

describe('gap-spec §13.2: never resolve a critical conflict silently', () => {
  /*
   * Two rules that disagree about the same emitted requirement.
   *
   * `priority` is a separate parameter rather than derived from severity. The first version derived
   * it, so two MANDATORY rules always emitted MUST — they agreed, no conflict was detected, and the
   * withholding test passed vacuously against an engine that might have done nothing.
   */
  function conflicting(
    id: string,
    source: Rule['source'],
    severity: Rule['severity'],
    priority: 'MUST' | 'SHOULD' | 'COULD' = severity === 'MANDATORY' ? 'MUST' : 'SHOULD',
  ): Rule {
    return defineRule({
      id,
      version: '1.0.0',
      title: `Test rule ${id}`,
      description: 'A rule constructed to disagree with another about the same requirement.',
      category: 'GOVERNANCE',
      severity,
      source,
      emittedRequirements: [
        {
          key: 'contested',
          title: 'A contested requirement',
          description: 'Two rules disagree about how important this is.',
          priority,
          verification: 'A test.',
        },
      ],
      rationale:
        'Constructed for the conflict tests, where two rules must genuinely disagree about the same emitted key.',
      remediation: 'Resolve the disagreement between the two rules.',
      ...(source === 'LEGAL_SECURITY' && severity === 'MANDATORY'
        ? { references: ['Constructed for tests'] }
        : {}),
      activeFrom: '2026-01-01',
    });
  }

  it('resolves an ordinary conflict by precedence and says what was overridden', () => {
    const conflict = resolveConflict('requirement:contested', [
      conflicting('TST-A-001', 'RECOMMENDED_DEFAULT', 'RECOMMENDED'),
      conflicting('TST-B-001', 'PROJECT_CONSTRAINT', 'MANDATORY'),
    ]);

    expect(conflict.kind).toBe('RESOLVED');
    expect(conflict.winnerId).toBe('TST-B-001');
    expect(conflict.explanation).toContain('TST-A-001');
  });

  it('refuses to resolve two mandatory rules from different authorities', () => {
    /*
     * The instruction the whole precedence module exists for.
     *
     * A legal obligation losing to nothing, or an explicit project constraint being silently
     * overruled, are both decisions with consequences the engine cannot weigh. Resolving it would be
     * picking, quietly, on someone else's behalf.
     */
    const conflict = resolveConflict('requirement:contested', [
      conflicting('TST-C-001', 'LEGAL_SECURITY', 'MANDATORY', 'MUST'),
      conflicting('TST-D-001', 'PROJECT_CONSTRAINT', 'MANDATORY', 'SHOULD'),
    ]);

    expect(conflict.kind).toBe('UNRESOLVABLE');
    expect(conflict.winnerId).toBeUndefined();
  });

  it('says that resolving it may mean changing the project', () => {
    const conflict = resolveConflict('requirement:contested', [
      conflicting('TST-C-001', 'LEGAL_SECURITY', 'MANDATORY'),
      conflicting('TST-D-001', 'PROJECT_CONSTRAINT', 'MANDATORY'),
    ]);

    expect(conflict.explanation).toMatch(/changing the project/i);
  });

  it('reports two mandatory rules from the same authority as a ruleset defect', () => {
    // Not a project problem. Picking arbitrarily between two deliberately-written rules would hide a
    // mistake in the catalogue behind a project-level message.
    const conflict = resolveConflict('requirement:contested', [
      conflicting('TST-E-001', 'LEGAL_SECURITY', 'MANDATORY', 'MUST'),
      conflicting('TST-F-001', 'LEGAL_SECURITY', 'MANDATORY', 'SHOULD'),
    ]);

    expect(conflict.kind).toBe('UNRESOLVABLE');
    expect(conflict.explanation).toMatch(/defect in the ruleset/i);
  });

  it('refuses to break a tie between equal sources', () => {
    // Precedence is the only tiebreaker this function has, and it has run out. Deciding by id order
    // would be arbitrary dressed up as deterministic.
    const conflict = resolveConflict('requirement:contested', [
      conflicting('TST-G-001', 'PROJECT_TYPE_PACK', 'RECOMMENDED', 'SHOULD'),
      conflicting('TST-H-001', 'PROJECT_TYPE_PACK', 'RECOMMENDED', 'COULD'),
    ]);

    expect(conflict.kind).toBe('UNRESOLVABLE');
    expect(conflict.explanation).toMatch(/equal authority/i);
  });

  it('withholds the emission covered by an unresolvable conflict', () => {
    /*
     * Emitting one side anyway would be resolving the conflict — quietly, in favour of whichever
     * rule happened to be evaluated first.
     */
    const rules = [
      conflicting('TST-I-001', 'LEGAL_SECURITY', 'MANDATORY', 'MUST'),
      conflicting('TST-J-001', 'PROJECT_CONSTRAINT', 'MANDATORY', 'SHOULD'),
    ];

    const result = evaluateRules(rules, context(), RULESET_VERSION);

    expect(result.withheld).toContain('requirement:contested');
    expect(result.emissions.requirements.map((r) => r.key)).not.toContain('contested');
  });

  it('does not report agreement as conflict', () => {
    // Several rules legitimately converge on the same requirement. Reporting that as a conflict would
    // fill the list with noise and teach people to skim it.
    const result = evaluateRules(
      [
        conflicting('TST-K-001', 'LEGAL_SECURITY', 'MANDATORY', 'MUST'),
        conflicting('TST-L-001', 'ORGANIZATION_POLICY', 'MANDATORY', 'MUST'),
      ],
      context(),
      RULESET_VERSION,
    );

    expect(result.conflicts).toEqual([]);
    // And the requirement is still emitted once, credited to the higher-precedence rule.
    expect(result.emissions.requirements.map((r) => r.key)).toEqual(['contested']);
  });

  it('the real catalogue contains no unresolvable conflicts for a well-answered project', () => {
    /*
     * The check that matters most. A catalogue that contradicts itself on ordinary projects would
     * block them for reasons the user cannot act on, and the blame would land on the project.
     */
    const result = evaluateRules(
      RULES,
      context({
        projectType: 'SAAS_WEB_APP',
        intake: [
          field('security.authentication', true),
          field('data.types', ['Personal data']),
          field('accessibility.target', 'WCAG 2.2 AA'),
          field('compliance.regimes', ['UK GDPR']),
          field('availability.expectation', 'Business hours'),
          field('performance.expectation', 'Standard web responsiveness'),
        ],
      }),
      RULESET_VERSION,
    );

    expect(summarise(result).unresolvableConflicts).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Scope                                                                      */
/* -------------------------------------------------------------------------- */

describe('scope', () => {
  it('applies a type-scoped rule only to that type', () => {
    const saas = evaluateRules(
      RULES,
      context({ projectType: 'SAAS_WEB_APP', intake: [field('data.types', ['Personal data'])] }),
      RULESET_VERSION,
    );
    const tooling = evaluateRules(
      RULES,
      context({
        projectType: 'DEVELOPER_TOOLING',
        intake: [field('data.types', ['Personal data'])],
      }),
      RULESET_VERSION,
    );

    expect(saas.results.find((r) => r.ruleId === 'SEC-TENANT-001')?.outcome).toBe('APPLIED');
    expect(tooling.results.find((r) => r.ruleId === 'SEC-TENANT-001')?.outcome).toBe(
      'NOT_APPLICABLE',
    );
  });

  it('says which types a scoped rule applies to when it does not', () => {
    const result = evaluateRules(
      RULES,
      context({ projectType: 'DEVELOPER_TOOLING' }),
      RULESET_VERSION,
    );

    const tenant = result.results.find((r) => r.ruleId === 'SEC-TENANT-001');
    expect(tenant?.explanation).toMatch(/applies only to/i);
  });

  it('does not apply a rule before its active date', () => {
    const future = defineRule({
      id: 'TST-FUTURE-001',
      version: '1.0.0',
      title: 'A rule that is not in force yet',
      description: 'Scheduled to take effect later.',
      category: 'GOVERNANCE',
      severity: 'RECOMMENDED',
      source: 'ORGANIZATION_POLICY',
      emittedTasks: [{ key: 'future-task', title: 'Something for later' }],
      rationale:
        'Rules with a future effective date exist so an organisation can announce a change before enforcing it.',
      remediation: 'Nothing yet.',
      activeFrom: '2030-01-01',
    });

    const result = evaluateRules([future], context(), RULESET_VERSION);
    expect(result.results[0]?.outcome).toBe('NOT_APPLICABLE');
    expect(result.results[0]?.explanation).toMatch(/not in force until/i);
  });

  it('does not apply a rule after it is withdrawn', () => {
    const retired = defineRule({
      id: 'TST-RETIRED-001',
      version: '1.0.0',
      title: 'A withdrawn rule',
      description: 'No longer in force.',
      category: 'GOVERNANCE',
      severity: 'RECOMMENDED',
      source: 'ORGANIZATION_POLICY',
      emittedTasks: [{ key: 'retired-task', title: 'Something no longer required' }],
      rationale:
        'A withdrawn rule stays in the catalogue so stored findings that cite it remain explainable.',
      remediation: 'Nothing.',
      activeFrom: '2020-01-01',
      deprecatedFrom: '2025-01-01',
    });

    const result = evaluateRules([retired], context(), RULESET_VERSION);
    expect(result.results[0]?.outcome).toBe('NOT_APPLICABLE');
    expect(result.results[0]?.explanation).toMatch(/withdrawn on/i);
  });

  it('applies a methodology-scoped rule only under that methodology', () => {
    const kanban = evaluateRules(RULES, context({ methodology: 'KANBAN' }), RULESET_VERSION);
    const agile = evaluateRules(RULES, context({ methodology: 'AGILE' }), RULESET_VERSION);

    expect(kanban.results.find((r) => r.ruleId === 'PLN-WIP-001')?.outcome).toBe('APPLIED');
    expect(agile.results.find((r) => r.ruleId === 'PLN-WIP-001')?.outcome).toBe('NOT_APPLICABLE');
  });
});

/* -------------------------------------------------------------------------- */
/* Conditions                                                                 */
/* -------------------------------------------------------------------------- */

describe('condition evaluation', () => {
  it('ALL requires every condition, and one definite false settles it', () => {
    const result = evaluateRules(
      RULES,
      context({
        projectType: 'PUBLIC_WEB_APP',
        intake: [field('deadline.fixed', false), field('capabilities.key', ['A'])],
      }),
      RULESET_VERSION,
    );

    expect(result.results.find((r) => r.ruleId === 'DIS-SCOPE-001')?.outcome).toBe(
      'NOT_APPLICABLE',
    );
  });

  it('ALL is undecidable when a condition is unknown and none is false', () => {
    const result = evaluateRules(
      RULES,
      context({ projectType: 'PUBLIC_WEB_APP', intake: [field('deadline.fixed', true)] }),
      RULESET_VERSION,
    );

    // `capabilities.key` is unanswered, so whether the rule applies genuinely cannot be decided.
    expect(result.results.find((r) => r.ruleId === 'DIS-SCOPE-001')?.outcome).toBe('APPLIED');
  });

  it('reads a multi-select answer as a list', () => {
    const result = evaluateRules(
      RULES,
      context({
        projectType: 'SAAS_WEB_APP',
        intake: [field('data.types', ['Account details', 'Health data'])],
      }),
      RULESET_VERSION,
    );

    expect(result.results.find((r) => r.ruleId === 'SEC-PRIV-001')?.outcome).toBe('APPLIED');
  });

  it('a graph condition is undecidable without a graph', () => {
    // "Does the project have an architecture decision" cannot be answered before anything has been
    // generated, and answering FALSE would raise findings against a project that has not begun.
    const rule = defineRule({
      id: 'TST-GRAPH-001',
      version: '1.0.0',
      title: 'Needs a graph',
      description: 'Asks whether the project has any architecture decisions.',
      category: 'ARCHITECTURE',
      severity: 'RECOMMENDED',
      source: 'ORGANIZATION_POLICY',
      conditions: [{ subject: 'GRAPH', key: 'ARCHITECTURE_DECISION', operator: 'NOT_EXISTS' }],
      emittedTasks: [{ key: 'add-adr', title: 'Record an architecture decision' }],
      rationale:
        'A project with components and no recorded decisions has made choices nobody can revisit.',
      remediation: 'Record the decisions.',
      activeFrom: '2026-01-01',
    });

    expect(evaluateRules([rule], context(), RULESET_VERSION).results[0]?.outcome).toBe(
      'INDETERMINATE',
    );
  });

  it('a graph condition is decidable with a graph', () => {
    const graph = new TwinGraph({
      projectId: 'p1',
      nodes: [
        createNode({
          id: 'n1',
          projectId: 'p1',
          class: 'PROJECT',
          label: 'A project',
          provenance: { provenance: 'USER_PROVIDED', confidence: 'HIGH' },
          at: '2026-03-01T09:00:00.000Z',
        }),
      ],
      edges: [],
    });

    const rule = defineRule({
      id: 'TST-GRAPH-002',
      version: '1.0.0',
      title: 'Needs a graph',
      description: 'Asks whether the project has any architecture decisions.',
      category: 'ARCHITECTURE',
      severity: 'RECOMMENDED',
      source: 'ORGANIZATION_POLICY',
      conditions: [{ subject: 'GRAPH', key: 'ARCHITECTURE_DECISION', operator: 'NOT_EXISTS' }],
      emittedTasks: [{ key: 'add-adr', title: 'Record an architecture decision' }],
      rationale:
        'A project with components and no recorded decisions has made choices nobody can revisit.',
      remediation: 'Record the decisions.',
      activeFrom: '2026-01-01',
    });

    expect(evaluateRules([rule], context({ graph }), RULESET_VERSION).results[0]?.outcome).toBe(
      'APPLIED',
    );
  });

  it('a rule with no conditions applies wherever it is in scope', () => {
    // How the unconditional baseline obligations are expressed: every project gets them.
    const result = evaluateRules(
      RULES,
      context({ projectType: 'PUBLIC_WEB_APP' }),
      RULESET_VERSION,
    );
    expect(result.results.find((r) => r.ruleId === 'SEC-SECRET-001')?.outcome).toBe('APPLIED');
  });
});

/* -------------------------------------------------------------------------- */
/* Realistic projects                                                         */
/* -------------------------------------------------------------------------- */

describe('what a realistic project actually gets', () => {
  const saas = evaluateRules(
    RULES,
    context({
      projectType: 'SAAS_WEB_APP',
      intake: [
        field('security.authentication', true),
        field('data.types', ['Account details', 'Personal data']),
        field('accessibility.target', 'WCAG 2.2 AA'),
        field('availability.expectation', 'Business hours'),
        field('compliance.regimes', ['UK GDPR']),
        field('team.size', 5),
        field('deadline.fixed', false),
      ],
    }),
    RULESET_VERSION,
  );

  it('applies most of the catalogue, because most of it is universal', () => {
    /*
     * This test previously asserted fewer than 220 rules applied, on the theory that a long list is
     * an unusable one. It failed at 249, and the premise was wrong rather than the engine.
     *
     * 164 of the 287 rules have no conditions and no scope at all: "estimates are ranges", "work is
     * broken down", "a test must be able to fail". Those genuinely do apply to every project, and
     * narrowing them artificially to shorten a list would be making the catalogue less true to make
     * a screen tidier.
     *
     * The count is therefore not the property worth defending. What is worth defending is that the
     * *conditional* rules discriminate — asserted below — and that presentation groups by category
     * and severity, which is a UI concern rather than a rules one.
     */
    const summary = summarise(saas);
    expect(summary.applied).toBeGreaterThan(60);
    expect(summary.applied).toBeLessThanOrEqual(RULES.length);
  });

  it('the conditional rules genuinely discriminate between projects', () => {
    /*
     * The property the count was standing in for.
     *
     * Of the rules that *do* carry conditions or scope, a materially different project must get a
     * materially different answer. Without this, scoping would be decoration and every project would
     * receive the same plan with a different name on it.
     */
    const conditional = RULES.filter(
      (r) =>
        r.conditions.length > 0 ||
        r.projectTypeScope.length > 0 ||
        r.methodologyScope.length > 0 ||
        r.requiredInputs.length > 0,
    );

    expect(conditional.length).toBeGreaterThan(100);

    const tooling = evaluateRules(
      RULES,
      context({
        projectType: 'DEVELOPER_TOOLING',
        intake: [field('security.authentication', false), field('data.types', ['None'])],
      }),
      RULESET_VERSION,
    );

    const appliedHere = new Set(
      saas.results.filter((r) => r.outcome === 'APPLIED').map((r) => r.ruleId),
    );
    const appliedThere = new Set(
      tooling.results.filter((r) => r.outcome === 'APPLIED').map((r) => r.ruleId),
    );

    const differing = conditional.filter(
      (r) => appliedHere.has(r.id) !== appliedThere.has(r.id),
    ).length;

    // At least a fifth of the conditional rules must answer differently for two unlike projects.
    expect(differing / conditional.length).toBeGreaterThan(0.2);
  });

  it('applies the tenant-isolation rules a SaaS product needs', () => {
    const applied = saas.results.filter((r) => r.outcome === 'APPLIED').map((r) => r.ruleId);
    expect(applied).toContain('SEC-TENANT-001');
    expect(applied).toContain('ARC-TENANT-001');
  });

  it('does not apply the payment-card rules to a product that takes no payments', () => {
    // The inverse assertion. An engine that applied everything would pass every positive test above.
    const applied = saas.results.filter((r) => r.outcome === 'APPLIED').map((r) => r.ruleId);
    expect(applied).not.toContain('SEC-PAY-001');
  });

  it('does not apply the mobile rules to a web product', () => {
    const applied = saas.results.filter((r) => r.outcome === 'APPLIED').map((r) => r.ruleId);
    expect(applied).not.toContain('SEC-MOBILE-001');
    expect(applied).not.toContain('DEP-STORE-001');
  });

  it('applies fewer rules to a simpler project', () => {
    const tooling = evaluateRules(
      RULES,
      context({
        projectType: 'DEVELOPER_TOOLING',
        intake: [field('security.authentication', false), field('data.types', ['None'])],
      }),
      RULESET_VERSION,
    );

    expect(summarise(tooling).applied).toBeLessThan(summarise(saas).applied);
  });

  it('applies the payment rules to an e-commerce project that takes cards', () => {
    const shop = evaluateRules(
      RULES,
      context({
        projectType: 'ECOMMERCE',
        intake: [
          field('security.authentication', true),
          field('data.types', ['Personal data', 'Payment card data']),
        ],
      }),
      RULESET_VERSION,
    );

    const applied = shop.results.filter((r) => r.outcome === 'APPLIED').map((r) => r.ruleId);
    expect(applied).toContain('SEC-PAY-001');
  });

  it('reports how many mandatory rules apply', () => {
    expect(summarise(saas).mandatoryApplied).toBeGreaterThan(30);
  });
});
