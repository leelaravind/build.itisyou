/**
 * The Phase-9 gate: the calculation golden suite.
 *
 * Contract: plan §34 — "calculation golden suite green"; gap-spec §20 (do not pretend to know exact
 * delivery time), §21 (currency, cost types, states, actuals, contingency), §22 (feasibility is not a
 * magic score), §23 (do not create an unexplained 83/100), §24 (next action).
 *
 * Money and estimates are the two places in this product where being subtly wrong is invisible. A
 * total that is a penny out looks like a total; an estimate presented as a single figure looks like a
 * commitment. So most of these tests assert the *shape* of an answer rather than only its value —
 * that a range stays a range, that a rate is recorded, that a status names its cause.
 */

import { describe, expect, it } from 'vitest';
import { TwinGraph } from '@govintel/twin/graph';
import { createNode, type NodeClass, type TwinNode } from '@govintel/twin/nodes';
import type { EdgeClass, TwinEdge } from '@govintel/twin/edges';
import type { ScheduleProblem } from '@govintel/execution/scheduling';
import {
  CURRENCIES,
  add,
  compare,
  convert,
  describeConversion,
  formatMoney,
  formatRange,
  fromMajor,
  isCurrency,
  money,
  moneyRange,
  percentOf,
  rangeSpread,
  scale,
  subtract,
  sum,
  sumRanges,
  toMajor,
  type ExchangeRate,
} from '../src/money.ts';
import {
  ADJUSTMENTS,
  COMPLEXITY_HOURS,
  ESTIMATOR_VERSION,
  aggregateConfidence,
  collectAssumptions,
  confidenceFor,
  estimate,
  formatEffort,
  override,
  totalEffort,
} from '../src/estimate.ts';
import {
  BUDGET_STATES,
  COST_TYPES,
  addContingency,
  addLine,
  createBudget,
  sizeContingency,
  totals,
  variance,
  type CostLine,
} from '../src/budget.ts';
import {
  assessFeasibility,
  assessHealth,
  nextAction,
  type AssessmentInput,
} from '../src/feasibility.ts';

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

/* -------------------------------------------------------------------------- */
/* Money                                                                      */
/* -------------------------------------------------------------------------- */

describe('money is held in minor units', () => {
  it('rejects a fractional minor unit', () => {
    // A fractional minor unit is a floating-point value that has already lost precision upstream.
    expect(() => money(12.5, 'GBP')).toThrow(/whole number/i);
  });

  it('adds without floating-point error', () => {
    /*
     * The whole argument for integers. In floating point, 0.1 + 0.2 is 0.30000000000000004, and a
     * total accumulating that is off by a penny in a way nobody can explain.
     */
    const tenP = fromMajor(0.1, 'GBP');
    const twentyP = fromMajor(0.2, 'GBP');

    expect(add(tenP, twentyP).minorUnits).toBe(30);
    expect(toMajor(add(tenP, twentyP))).toBe(0.3);
  });

  it('rounds half away from zero, symmetrically', () => {
    /*
     * `Math.round(-0.5)` is -0 in JavaScript, which rounds a negative half *up*. Money must round
     * symmetrically, or the direction of a rounding error depends on the sign of the amount.
     */
    expect(fromMajor(0.005, 'GBP').minorUnits).toBe(1);
    expect(fromMajor(-0.005, 'GBP').minorUnits).toBe(-1);
  });

  it('handles currencies with no minor unit', () => {
    // Treating yen as having two decimal places inflates it a hundredfold, which is the reason the
    // exponent table exists at all.
    expect(fromMajor(1234, 'JPY').minorUnits).toBe(1234);
    expect(toMajor(money(1234, 'JPY'))).toBe(1234);
  });

  it('rejects a currency it does not know', () => {
    expect(() => money(100, 'XYZ')).toThrow(/not one this platform handles/i);
    expect(isCurrency('XYZ')).toBe(false);
  });

  it('gives every listed currency an exponent', () => {
    for (const [code, currency] of Object.entries(CURRENCIES)) {
      expect(Number.isInteger(currency.exponent), code).toBe(true);
      expect(currency.name.length, code).toBeGreaterThan(3);
    }
  });

  it('refuses to combine two currencies', () => {
    /*
     * §21.1: never silently use a rate. Adding two currencies needs one, and which rate applies at
     * what time is a question only the caller can answer.
     */
    expect(() => add(money(100, 'GBP'), money(100, 'EUR'))).toThrow(/without a recorded rate/i);
  });

  it('sums an empty list to zero in a known currency', () => {
    // The currency is a parameter rather than inferred, so an empty sum is zero *in a currency*
    // rather than a failure or a guess.
    expect(sum([], 'GBP')).toEqual({ minorUnits: 0, currency: 'GBP' });
  });

  it('subtracts, scales and compares', () => {
    expect(subtract(money(500, 'GBP'), money(200, 'GBP')).minorUnits).toBe(300);
    expect(scale(money(1000, 'GBP'), 0.15).minorUnits).toBe(150);
    expect(percentOf(money(1000, 'GBP'), 15).minorUnits).toBe(150);
    expect(compare(money(100, 'GBP'), money(200, 'GBP'))).toBeLessThan(0);
  });

  it('formats with the currency', () => {
    expect(formatMoney(money(123456, 'GBP'))).toContain('1,234.56');
  });
});

describe('ranges never collapse to a midpoint', () => {
  it('has no midpoint accessor', () => {
    /*
     * Asserted structurally. Averaging a range discards the information it carried, and the moment a
     * midpoint exists everyone downstream treats it as *the* number.
     */
    const range = moneyRange(money(100, 'GBP'), money(300, 'GBP'));
    expect(Object.keys(range).sort()).toEqual(['high', 'low']);
  });

  it('refuses an inverted range', () => {
    expect(() => moneyRange(money(300, 'GBP'), money(100, 'GBP'))).toThrow(/cannot start above/i);
  });

  it('sums ranges point by point', () => {
    const a = moneyRange(money(100, 'GBP'), money(200, 'GBP'));
    const b = moneyRange(money(50, 'GBP'), money(400, 'GBP'));
    const total = sumRanges([a, b], 'GBP');

    expect(total.low.minorUnits).toBe(150);
    expect(total.high.minorUnits).toBe(600);
  });

  it('reports spread as a proportion, or nothing when the low end is zero', () => {
    // A range from nothing to something has no meaningful proportional width, and reporting one
    // would invent a figure.
    expect(rangeSpread(moneyRange(money(100, 'GBP'), money(300, 'GBP')))).toBe(2);
    expect(rangeSpread(moneyRange(money(0, 'GBP'), money(300, 'GBP')))).toBeNull();
  });

  it('formats a zero-width range as a single figure', () => {
    const fixed = moneyRange(money(1000, 'GBP'), money(1000, 'GBP'));
    expect(formatRange(fixed)).not.toContain('–');
  });
});

describe('gap-spec §21.1: a rate is never used without provenance', () => {
  const rate: ExchangeRate = {
    from: 'EUR',
    to: 'GBP',
    rate: 0.85,
    source: 'ECB reference rate',
    asOf: '2026-03-01',
  };

  it('keeps the original amount, the converted amount and the rate', () => {
    const result = convert(money(10000, 'EUR'), rate);

    expect(result.original.currency).toBe('EUR');
    expect(result.converted.currency).toBe('GBP');
    expect(result.rate.source).toBe('ECB reference rate');
  });

  it('refuses a rate with no source', () => {
    /*
     * The prohibition, enforced. A converted figure whose rate is unrecorded cannot be reproduced, so
     * the discrepancy that appears later cannot be attributed to anything.
     */
    expect(() => convert(money(100, 'EUR'), { ...rate, source: '   ' })).toThrow(
      /must record where it came from/i,
    );
  });

  it('refuses a rate that does not apply to the amount', () => {
    expect(() => convert(money(100, 'USD'), rate)).toThrow(/does not apply/i);
  });

  it('refuses a non-positive or infinite rate', () => {
    expect(() => convert(money(100, 'EUR'), { ...rate, rate: 0 })).toThrow(/positive number/i);
    expect(() => convert(money(100, 'EUR'), { ...rate, rate: Infinity })).toThrow(/positive/i);
  });

  it('converts through major units so differing exponents are handled', () => {
    /*
     * £12.34 at 190 JPY/GBP is about ¥2,345, not ¥234,460. Converting minor units directly would
     * multiply by a hundred wherever the exponents differ.
     */
    const toYen: ExchangeRate = {
      from: 'GBP',
      to: 'JPY',
      rate: 190,
      source: 'Contract rate',
      asOf: '2026-03-01',
    };

    const result = convert(money(1234, 'GBP'), toYen);
    expect(result.converted.minorUnits).toBe(2345);
  });

  it('describes a conversion with its rate and date', () => {
    const described = describeConversion(convert(money(10000, 'EUR'), rate));
    expect(described).toContain('ECB reference rate');
    expect(described).toContain('2026-03-01');
  });
});

/* -------------------------------------------------------------------------- */
/* Estimation                                                                 */
/* -------------------------------------------------------------------------- */

describe('gap-spec §20: estimates are three points, never one', () => {
  it('produces optimistic, expected and conservative', () => {
    const result = estimate({ complexity: 'MEDIUM' });

    expect(result.effort.optimistic).toBeLessThan(result.effort.expected);
    expect(result.effort.expected).toBeLessThan(result.effort.conservative);
  });

  it('offers no single-figure accessor', () => {
    // The moment one exists everyone downstream uses it and the range becomes decoration.
    const result = estimate({ complexity: 'MEDIUM' });
    expect(Object.keys(result.effort).sort()).toEqual(['conservative', 'expected', 'optimistic']);
  });

  it('gives an unsized item an enormous range rather than a comfortable one', () => {
    /*
     * A factor of twenty is what "we have not looked at this" actually means. Narrowing it would be
     * inventing knowledge, and the discomfort of the number is the signal that the item needs sizing.
     */
    const unknown = COMPLEXITY_HOURS.UNKNOWN;
    expect(unknown.conservative / unknown.optimistic).toBeGreaterThan(15);
  });

  it('never treats an unsized item as medium by default', () => {
    expect(estimate({ complexity: 'UNKNOWN' }).confidence).toBe('LOW');
  });

  it('derives confidence from the spread rather than accepting an assertion', () => {
    // Letting a caller declare confidence independently of the range would let the two disagree, and
    // the declared one would win because it is the one on the screen.
    expect(confidenceFor('SMALL', { optimistic: 10, expected: 12, conservative: 20 })).toBe('HIGH');
    expect(confidenceFor('SMALL', { optimistic: 10, expected: 25, conservative: 45 })).toBe(
      'MEDIUM',
    );
    expect(confidenceFor('SMALL', { optimistic: 10, expected: 50, conservative: 200 })).toBe('LOW');
  });

  it('formats without collapsing to one number', () => {
    expect(formatEffort({ optimistic: 8, expected: 16, conservative: 32 })).toMatch(/8–32/);
  });
});

describe('gap-spec §20.4: every estimate records its basis', () => {
  it('records the formula, the version and the inputs', () => {
    const result = estimate({ complexity: 'MEDIUM', adjustments: ['REWORK_ALLOWANCE'] });

    expect(result.provenance.formula.length).toBeGreaterThan(5);
    expect(result.provenance.estimatorVersion).toBe(ESTIMATOR_VERSION);
    expect(result.provenance.inputs.complexity).toBe('MEDIUM');
  });

  it('records an assumption for every adjustment applied', () => {
    const result = estimate({
      complexity: 'MEDIUM',
      adjustments: ['REWORK_ALLOWANCE', 'UNFAMILIAR_TECHNOLOGY'],
    });

    expect(result.provenance.assumptions.length).toBeGreaterThanOrEqual(3);
    expect(result.provenance.assumptions.join(' ')).toMatch(/learning time is real/i);
  });

  it('refuses an adjustment it does not know rather than ignoring it', () => {
    /*
     * Silently dropping an unrecognised adjustment produces an estimate that is quietly too low, and
     * the omission is invisible — the number looks like a normal estimate.
     */
    expect(() => estimate({ complexity: 'MEDIUM', adjustments: ['MAGIC'] })).toThrow(
      /not one this engine knows about/i,
    );
  });

  it('gives every adjustment a reason', () => {
    for (const [key, adjustment] of Object.entries(ADJUSTMENTS)) {
      expect(adjustment.reason.length, key).toBeGreaterThan(40);
    }
  });

  it('is deterministic regardless of adjustment order', () => {
    const a = estimate({
      complexity: 'LARGE',
      adjustments: ['REWORK_ALLOWANCE', 'HIGH_AVAILABILITY'],
    });
    const b = estimate({
      complexity: 'LARGE',
      adjustments: ['HIGH_AVAILABILITY', 'REWORK_ALLOWANCE'],
    });

    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('produces identical output on repeated runs', () => {
    const input = { complexity: 'MEDIUM' as const, adjustments: ['EXISTING_CODEBASE'] };
    expect(JSON.stringify(estimate(input))).toBe(JSON.stringify(estimate(input)));
  });
});

describe('manual overrides', () => {
  it('records that it was overridden and why', () => {
    // §20.4 asks explicitly. Overriding must be supported rather than prevented — a system that
    // refuses human judgement gets worked around, and the workaround leaves no record at all.
    const original = estimate({ complexity: 'MEDIUM' });
    const result = override(
      original,
      { optimistic: 20, expected: 30, conservative: 50 },
      'We have built this exact thing before and it took a month.',
    );

    expect(result.provenance.manuallyOverridden).toBe(true);
    expect(result.provenance.overrideReason).toMatch(/built this exact thing/i);
  });

  it('requires a reason', () => {
    const original = estimate({ complexity: 'MEDIUM' });
    expect(() => override(original, { optimistic: 1, expected: 2, conservative: 3 }, 'no')).toThrow(
      /reason has to be recorded/i,
    );
  });

  it('keeps the original figure and its assumptions', () => {
    // The context anyone reviewing the override needs is what the replaced figure was based on.
    const original = estimate({ complexity: 'LARGE', adjustments: ['UNFAMILIAR_TECHNOLOGY'] });
    const result = override(
      original,
      { optimistic: 10, expected: 20, conservative: 30 },
      'The unfamiliar part turned out to be a library we already use.',
    );

    expect(result.provenance.inputs.originalExpected).toBe(original.effort.expected);
    expect(result.provenance.assumptions.join(' ')).toMatch(/learning time is real/i);
  });

  it('refuses an inverted override', () => {
    const original = estimate({ complexity: 'MEDIUM' });
    expect(() =>
      override(
        original,
        { optimistic: 50, expected: 20, conservative: 10 },
        'A reason long enough.',
      ),
    ).toThrow(/optimistic through expected to conservative/i);
  });
});

describe('aggregation is conservative on purpose', () => {
  it('sums the points independently', () => {
    /*
     * A statistical roll-up would produce a narrower and more flattering range, and it assumes the
     * estimates are independent. They are not: projects go wrong for reasons that affect many tasks
     * at once. Narrowing on an independence assumption that does not hold is the fake precision §20
     * opens by forbidding.
     */
    const items = [estimate({ complexity: 'SMALL' }), estimate({ complexity: 'SMALL' })];
    const total = totalEffort(items);

    expect(total.conservative).toBe(COMPLEXITY_HOURS.SMALL.conservative * 2);
  });

  it('takes the lowest confidence of its parts, not an average', () => {
    // A total containing one unsized item is not medium-confidence because everything else was well
    // understood — the unknown dominates.
    const items = [estimate({ complexity: 'SMALL' }), estimate({ complexity: 'UNKNOWN' })];
    expect(aggregateConfidence(items)).toBe('LOW');
  });

  it('reports low confidence for an empty set rather than high', () => {
    // Nothing estimated is not the same as everything certain.
    expect(aggregateConfidence([])).toBe('LOW');
  });

  it('collects assumptions without duplication', () => {
    const items = [
      estimate({ complexity: 'SMALL', adjustments: ['REWORK_ALLOWANCE'] }),
      estimate({ complexity: 'SMALL', adjustments: ['REWORK_ALLOWANCE'] }),
    ];

    const assumptions = collectAssumptions(items);
    expect(new Set(assumptions).size).toBe(assumptions.length);
  });
});

/* -------------------------------------------------------------------------- */
/* Budget                                                                     */
/* -------------------------------------------------------------------------- */

function line(overrides: Partial<CostLine> = {}): CostLine {
  return {
    id: 'l1',
    label: 'Development',
    category: 'People',
    type: 'HUMAN_EFFORT',
    state: 'ESTIMATED',
    amount: moneyRange(money(100000, 'GBP'), money(200000, 'GBP')),
    basis: 'Effort estimate at an assumed day rate.',
    ...overrides,
  };
}

describe('gap-spec §21.5: contingency is never hidden', () => {
  it('refuses a contingency cost line', () => {
    /*
     * Contingency among the cost lines is contingency hidden in the budget, which is the same failure
     * as hiding it in an estimate — spending it stops being a decision anybody takes.
     */
    const budget = createBudget(PROJECT, 'GBP');
    expect(() => addLine(budget, line({ type: 'CONTINGENCY' }))).toThrow(/held separately/i);
  });

  it('refuses contingency with no justification', () => {
    // An unexplained allowance is the ten-per-cent convention with a different name.
    const budget = createBudget(PROJECT, 'GBP');
    expect(() =>
      addContingency(budget, {
        id: 'c1',
        label: 'Contingency',
        amount: money(10000, 'GBP'),
        justifications: [],
        drawdowns: [],
      }),
    ).toThrow(/has to say what it is for/i);
  });

  it('reports contingency separately from the line total', () => {
    let budget = createBudget(PROJECT, 'GBP');
    budget = addLine(budget, line());
    budget = addContingency(budget, {
      id: 'c1',
      label: 'Contingency',
      amount: money(30000, 'GBP'),
      justifications: ['Two unresolved critical unknowns.'],
      drawdowns: [],
    });

    const result = totals(budget);

    expect(result.lines.low.minorUnits).toBe(100000);
    expect(result.contingencyAllocated.minorUnits).toBe(30000);
    // Offered as a distinct figure rather than as *the* total.
    expect(result.withContingency.low.minorUnits).toBe(130000);
  });

  it('tracks what has been drawn against it', () => {
    let budget = createBudget(PROJECT, 'GBP');
    budget = addContingency(budget, {
      id: 'c1',
      label: 'Contingency',
      amount: money(30000, 'GBP'),
      justifications: ['One unresolved unknown.'],
      drawdowns: [{ amount: money(10000, 'GBP'), reason: 'The integration was harder.', at: AT }],
    });

    expect(totals(budget).contingencyRemaining.minorUnits).toBe(20000);
  });

  it('warns when more has been drawn than allocated', () => {
    let budget = createBudget(PROJECT, 'GBP');
    budget = addContingency(budget, {
      id: 'c1',
      label: 'Contingency',
      amount: money(10000, 'GBP'),
      justifications: ['One unknown.'],
      drawdowns: [{ amount: money(15000, 'GBP'), reason: 'Overspent.', at: AT }],
    });

    expect(totals(budget).caveats.join(' ')).toMatch(/already over/i);
  });

  it('warns when no contingency exists at all', () => {
    // Zero allowance asserts that every estimate is exactly what will be needed.
    let budget = createBudget(PROJECT, 'GBP');
    budget = addLine(budget, line());

    expect(totals(budget).caveats.join(' ')).toMatch(/no contingency has been set aside/i);
  });
});

describe('sizing contingency from actual uncertainty', () => {
  it('grows with the number of critical unknowns', () => {
    const one = sizeContingency(money(100000, 'GBP'), {
      criticalUnknowns: 1,
      unconfirmedAssumptions: 0,
      unfamiliarTechnology: false,
      existingSystem: false,
    });

    const three = sizeContingency(money(100000, 'GBP'), {
      criticalUnknowns: 3,
      unconfirmedAssumptions: 0,
      unfamiliarTechnology: false,
      existingSystem: false,
    });

    expect(three.percent).toBeGreaterThan(one.percent);
  });

  it('names every component so the figure can be argued with', () => {
    // A contingency nobody can decompose never shrinks; it just gets spent.
    const sized = sizeContingency(money(100000, 'GBP'), {
      criticalUnknowns: 2,
      unconfirmedAssumptions: 3,
      unfamiliarTechnology: true,
      existingSystem: true,
    });

    expect(sized.justifications.length).toBe(4);
    for (const justification of sized.justifications) {
      expect(justification.length).toBeGreaterThan(40);
    }
  });

  it('says the allowance shrinks as unknowns are answered', () => {
    const sized = sizeContingency(money(100000, 'GBP'), {
      criticalUnknowns: 1,
      unconfirmedAssumptions: 0,
      unfamiliarTechnology: false,
      existingSystem: false,
    });

    expect(sized.justifications.join(' ')).toMatch(/shrinks as they are answered/i);
  });

  it('applies a floor rather than nothing when there is no specific uncertainty', () => {
    // Zero contingency asserts that nothing unexpected will happen, which has never been true of any
    // project.
    const sized = sizeContingency(money(100000, 'GBP'), {
      criticalUnknowns: 0,
      unconfirmedAssumptions: 0,
      unfamiliarTechnology: false,
      existingSystem: false,
    });

    expect(sized.percent).toBe(5);
    expect(sized.justifications.join(' ')).toMatch(/nothing unexpected will happen/i);
  });

  it('caps the contribution from unknowns', () => {
    // Past a handful of critical unknowns the problem is not the budget; it is that the project is
    // not ready to be budgeted.
    const many = sizeContingency(money(100000, 'GBP'), {
      criticalUnknowns: 20,
      unconfirmedAssumptions: 0,
      unfamiliarTechnology: false,
      existingSystem: false,
    });

    expect(many.percent).toBeLessThanOrEqual(40);
  });
});

describe('budget roll-up', () => {
  it('expands a recurring cost over the periods covered', () => {
    // Without this a monthly licence appears once and the annual figure is out by a factor of twelve.
    let budget = createBudget(PROJECT, 'GBP');
    budget = addLine(
      budget,
      line({
        id: 'licence',
        type: 'RECURRING_MONTHLY',
        amount: moneyRange(money(10000, 'GBP'), money(10000, 'GBP')),
        periods: 12,
      }),
    );

    expect(totals(budget).lines.low.minorUnits).toBe(120000);
  });

  it('groups by type, state and category', () => {
    let budget = createBudget(PROJECT, 'GBP');
    budget = addLine(budget, line({ id: 'a', type: 'HUMAN_EFFORT', category: 'People' }));
    budget = addLine(budget, line({ id: 'b', type: 'ONE_TIME', category: 'Infrastructure' }));

    const result = totals(budget);
    expect(result.byType.HUMAN_EFFORT.low.minorUnits).toBe(100000);
    expect(result.byCategory.Infrastructure?.low.minorUnits).toBe(100000);
  });

  it('refuses a line in a different currency from the base', () => {
    // Storing a foreign-currency line would mean the total needed an implicit rate.
    const budget = createBudget(PROJECT, 'GBP');
    expect(() =>
      addLine(budget, line({ amount: moneyRange(money(100, 'EUR'), money(200, 'EUR')) })),
    ).toThrow(/base currency/i);
  });

  it('states that actuals are not reconciled', () => {
    /*
     * §21.4 is explicit: do not claim accounting-grade reconciliation unless implemented. It is not,
     * so the figure says so rather than letting a reader assume it reconciles.
     */
    let budget = createBudget(PROJECT, 'GBP');
    budget = addLine(budget, line({ state: 'ACTUAL' }));

    expect(totals(budget).caveats.join(' ')).toMatch(
      /does not reconcile with an accounting system/i,
    );
  });

  it('warns that usage-based costs have no ceiling', () => {
    let budget = createBudget(PROJECT, 'GBP');
    budget = addLine(budget, line({ type: 'USAGE_BASED' }));

    expect(totals(budget).caveats.join(' ')).toMatch(/no natural ceiling/i);
  });

  it('covers every cost type and state the spec names', () => {
    expect(COST_TYPES).toHaveLength(7);
    expect(BUDGET_STATES).toEqual(['ESTIMATED', 'ALLOCATED', 'COMMITTED', 'ACTUAL', 'FORECAST']);
  });
});

describe('variance is measured against the conservative end', () => {
  it('does not report an overrun for spending above the middle of a range', () => {
    /*
     * An estimate is a range, and being above the middle is not an overrun. Reporting it as one
     * trains people to ignore variance warnings, which is how the real overrun goes unnoticed.
     */
    let budget = createBudget(PROJECT, 'GBP');
    budget = addLine(budget, line({ id: 'est', state: 'ESTIMATED' }));
    budget = addLine(
      budget,
      line({
        id: 'spent',
        state: 'COMMITTED',
        amount: moneyRange(money(180000, 'GBP'), money(180000, 'GBP')),
      }),
    );

    expect(variance(budget).withinRange).toBe(true);
  });

  it('reports an overrun past the conservative end', () => {
    let budget = createBudget(PROJECT, 'GBP');
    budget = addLine(budget, line({ id: 'est', state: 'ESTIMATED' }));
    budget = addLine(
      budget,
      line({
        id: 'spent',
        state: 'ACTUAL',
        amount: moneyRange(money(250000, 'GBP'), money(250000, 'GBP')),
      }),
    );

    const result = variance(budget);
    expect(result.withinRange).toBe(false);
    expect(result.explanation).toMatch(/the estimate was wrong rather than merely optimistic/i);
  });
});

/* -------------------------------------------------------------------------- */
/* Feasibility and health                                                     */
/* -------------------------------------------------------------------------- */

function assessmentInput(overrides: Partial<AssessmentInput> = {}): AssessmentInput {
  return {
    graph: graphOf([node('p', 'PROJECT')]),
    scheduleProblems: [],
    ...overrides,
  };
}

describe('gap-spec §22: feasibility is not a magic score', () => {
  it('has no numeric score anywhere in the result', () => {
    const result = assessFeasibility(assessmentInput());
    expect(Object.keys(result).sort()).toEqual([
      'decidedBy',
      'dimensions',
      'explanation',
      'overall',
    ]);
  });

  it('assesses the eight dimensions §22 names', () => {
    const keys = assessFeasibility(assessmentInput())
      .dimensions.map((d) => d.key)
      .sort();
    expect(keys).toEqual([
      'budget',
      'compliance',
      'dependency',
      'resource',
      'scope',
      'skill',
      'technical',
      'timeline',
    ]);
  });

  it('takes the worst dimension rather than an average', () => {
    /*
     * A project that cannot be staffed is not seven-eighths feasible. Averaging would let one
     * unrealistic dimension disappear into seven feasible ones.
     */
    const problems: ScheduleProblem[] = [
      {
        code: 'NO_CAPACITY',
        severity: 'ERROR',
        message: 'There is nobody to do the work.',
        resourceIds: [],
        nodeIds: [],
      },
    ];

    const result = assessFeasibility(assessmentInput({ scheduleProblems: problems }));
    expect(result.overall).toBe('UNREALISTIC');
    expect(result.decidedBy).toBe('resource');
  });

  it('names the dimension that decided the verdict', () => {
    const result = assessFeasibility(assessmentInput());
    expect(result.decidedBy.length).toBeGreaterThan(0);
    expect(result.explanation.length).toBeGreaterThan(30);
  });

  it('gives every non-feasible dimension at least one cause with evidence', () => {
    // A cause with no evidence is an assertion, and assertions that cannot be checked stop being
    // believed the first time someone disagrees.
    const graph = graphOf(
      [node('p', 'PROJECT'), node('a', 'TASK'), node('b', 'TASK')],
      [edge('a', 'b', 'DEPENDS_ON'), edge('b', 'a', 'DEPENDS_ON')],
    );

    const result = assessFeasibility(assessmentInput({ graph }));
    const dependency = result.dimensions.find((d) => d.key === 'dependency');

    expect(dependency?.status).toBe('UNREALISTIC');
    expect(dependency?.causes[0]?.evidence.length).toBeGreaterThan(0);
  });

  it('reports an unknown budget as unknown rather than feasible', () => {
    /*
     * A budget that cannot be exceeded because none was set is not a healthy budget, and reporting
     * it as feasible rewards not answering the question.
     */
    const result = assessFeasibility(assessmentInput({ budgetCeilingKnown: false }));
    expect(result.dimensions.find((d) => d.key === 'budget')?.status).toBe('UNKNOWN');
  });

  it('reports a budget with no ceiling as unknown health, not healthy', () => {
    /*
     * Regression, and the defect was visible only through the page.
     *
     * `budgetHealth` used to ask whether a budget *object* existed. The budget surface always builds
     * one — it needs somewhere to put the contingency — so a project with no budget whatsoever
     * satisfied every check and reported HEALTHY, while feasibility reported the same fact as
     * UNKNOWN. The two disagreed about one input.
     *
     * Reporting healthy here is the "healthy because nobody filled in the form" failure §23 exists
     * to prevent, on the dimension a reader looks at first.
     */
    const budget = totals(
      addContingency(createBudget('p', 'GBP'), {
        id: 'c',
        label: 'Contingency',
        amount: money(500_00, 'GBP'),
        justifications: ['Two critical unknowns.'],
        drawdowns: [],
      }),
    );

    const health = assessHealth(assessmentInput({ budget, budgetCeilingKnown: false }));
    const dimension = health.dimensions.find((d) => d.key === 'budget');

    expect(dimension?.status).toBe('UNKNOWN');
    expect(dimension?.causes[0]?.evidence.length).toBeGreaterThan(0);

    // And the two assessments must agree about it, since they are reading the same fact.
    const feasibility = assessFeasibility(assessmentInput({ budget, budgetCeilingKnown: false }));
    expect(feasibility.dimensions.find((d) => d.key === 'budget')?.status).toBe('UNKNOWN');
  });

  it('reports a budget within a recorded ceiling as healthy', () => {
    // The counterpart: with a ceiling recorded and nothing wrong, UNKNOWN would be as misleading in
    // the other direction. The fix must not simply make the dimension permanently undecidable.
    const budget = totals(
      addContingency(createBudget('p', 'GBP'), {
        id: 'c',
        label: 'Contingency',
        amount: money(500_00, 'GBP'),
        justifications: ['Two critical unknowns.'],
        drawdowns: [],
      }),
    );

    const health = assessHealth(assessmentInput({ budget, budgetCeilingKnown: true }));
    expect(health.dimensions.find((d) => d.key === 'budget')?.status).toBe('HEALTHY');
  });

  it('reports undecidable compliance as unknown rather than as risk', () => {
    // Not knowing whether obligations apply is a different state from knowing they are outstanding.
    const result = assessFeasibility(assessmentInput({ indeterminateFindings: 12 }));
    expect(result.dimensions.find((d) => d.key === 'compliance')?.status).toBe('UNKNOWN');
  });

  it('is deterministic', () => {
    const input = assessmentInput({ indeterminateFindings: 3 });
    expect(JSON.stringify(assessFeasibility(input))).toBe(JSON.stringify(assessFeasibility(input)));
  });
});

describe('gap-spec §23: no unexplained score', () => {
  it('has no numeric field in the health result', () => {
    // Asserted structurally: adding one later would be a visible change to this shape.
    const result = assessHealth(assessmentInput());
    expect(Object.keys(result).sort()).toEqual([
      'decidedBy',
      'dimensions',
      'explanation',
      'overall',
    ]);
  });

  it('assesses the eight dimensions §23 names', () => {
    const keys = assessHealth(assessmentInput())
      .dimensions.map((d) => d.key)
      .sort();
    expect(keys).toEqual([
      'budget',
      'dependency',
      'quality',
      'resource',
      'risk',
      'schedule',
      'scope',
      'security',
    ]);
  });

  it('treats an empty risk register as unknown, not healthy', () => {
    /*
     * Every project has risks. A register with none means nobody looked, which is a worse position
     * than one with several recorded — those at least have someone watching them.
     */
    const result = assessHealth(assessmentInput());
    const risk = result.dimensions.find((d) => d.key === 'risk');

    expect(risk?.status).toBe('UNKNOWN');
    expect(risk?.causes[0]?.summary).toMatch(/nobody has looked/i);
  });

  it('treats undecidable security as unknown, not healthy', () => {
    // A project whose security obligations cannot be determined is unassessed, not secure.
    const result = assessHealth(assessmentInput({ indeterminateFindings: 5 }));
    const security = result.dimensions.find((d) => d.key === 'security');

    expect(security?.status).toBe('UNKNOWN');
    expect(security?.causes[0]?.summary).toMatch(/not established as fine/i);
  });

  it('reports a failing security gate as critical', () => {
    const result = assessHealth(assessmentInput({ failedGates: ['SECURITY'] }));
    expect(result.overall).toBe('CRITICAL');
    expect(result.decidedBy).toBe('security');
  });

  it('explains the overall status by naming the dimension and its cause', () => {
    const result = assessHealth(assessmentInput({ failedGates: ['SECURITY'] }));
    expect(result.explanation).toMatch(/security/i);
    expect(result.explanation.length).toBeGreaterThan(20);
  });

  it('reports unverified requirements as a quality concern', () => {
    const graph = graphOf([node('p', 'PROJECT'), node('r', 'REQUIREMENT')]);
    const quality = assessHealth(assessmentInput({ graph })).dimensions.find(
      (d) => d.key === 'quality',
    );

    expect(quality?.status).toBe('AT_RISK');
    expect(quality?.causes[0]?.summary).toMatch(/nothing testing them/i);
  });
});

describe('gap-spec §24: the next action', () => {
  it('puts a failing security gate first', () => {
    const action = nextAction(assessmentInput({ failedGates: ['SECURITY', 'TESTING'] }));
    expect(action?.kind).toBe('CRITICAL_SECURITY_BLOCKER');
  });

  it('falls to a failing mandatory gate next', () => {
    const action = nextAction(assessmentInput({ failedGates: ['TESTING'] }));
    expect(action?.kind).toBe('FAILED_MANDATORY_GATE');
  });

  it('then to a blocker', () => {
    const graph = graphOf([node('p', 'PROJECT'), node('b', 'BLOCKER')]);
    expect(nextAction(assessmentInput({ graph }))?.kind).toBe('BLOCKER_ON_CRITICAL_PATH');
  });

  it('then to critical missing information', () => {
    const graph = graphOf([node('p', 'PROJECT'), node('u', 'UNKNOWN', { importance: 'CRITICAL' })]);

    expect(nextAction(assessmentInput({ graph }))?.kind).toBe('CRITICAL_MISSING_INFORMATION');
  });

  it('always says why, not only what', () => {
    // A user told what to do without being told why has no way to disagree with the ordering.
    const action = nextAction(assessmentInput({ failedGates: ['SECURITY'] }));
    expect(action?.why.length).toBeGreaterThan(40);
    expect(action?.evidence.length).toBeGreaterThan(0);
  });

  it('returns nothing rather than inventing reassurance', () => {
    /*
     * "Nothing needs your attention" is a claim, and inventing one would be the same kind of false
     * reassurance as an unexplained score.
     */
    const graph = graphOf([node('p', 'PROJECT'), node('r', 'RISK')]);
    expect(nextAction(assessmentInput({ graph }))).toBeNull();
  });

  it('follows the priority order §24 gives', () => {
    // A blocker outranks missing information, so a project with both gets the blocker.
    const graph = graphOf([
      node('p', 'PROJECT'),
      node('b', 'BLOCKER'),
      node('u', 'UNKNOWN', { importance: 'CRITICAL' }),
    ]);

    expect(nextAction(assessmentInput({ graph }))?.kind).toBe('BLOCKER_ON_CRITICAL_PATH');
  });
});
