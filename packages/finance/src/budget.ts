/**
 * The budget engine.
 *
 * Contract: gap-spec §21. Seven cost types (§21.2), five budget states (§21.3), manual actuals with
 * an honest disclaimer (§21.4), and the instruction that shapes the whole module:
 *
 * **§21.5: "Contingency must be explicit and explainable. Never hide contingency inside inflated task
 * estimates."**
 *
 * That is not a presentation preference. Buffer distributed into every estimate is consumed by
 * whichever task happens to overrun first, and nobody can see it going — the project looks fine until
 * the padding runs out, at which point it looks fine right up to the moment it does not. Held as a
 * named line, spending it is a decision somebody takes, and the remaining amount is a real signal.
 *
 * So `Contingency` is a distinct type here, it is never folded into a cost line, and the roll-up
 * reports it separately at every level.
 */

import { AppError } from '@govintel/shared/errors';
import {
  add,
  formatMoney,
  formatRange,
  money,
  moneyRange,
  percentOf,
  scale,
  sum,
  sumRanges,
  type ConvertedMoney,
  type CurrencyCode,
  type Money,
  type MoneyRange,
} from './money.ts';

/** Bumped whenever the roll-up rules change. A stored figure keeps the version that produced it. */
export const BUDGET_ENGINE_VERSION = '1.0.0';

/* -------------------------------------------------------------------------- */
/* Cost types and states                                                      */
/* -------------------------------------------------------------------------- */

/** Gap-spec §21.2. */
export const COST_TYPES = [
  'ONE_TIME',
  'RECURRING_MONTHLY',
  'RECURRING_ANNUAL',
  'USAGE_BASED',
  'HUMAN_EFFORT',
  'CONTINGENCY',
  'UNKNOWN',
] as const;

export type CostType = (typeof COST_TYPES)[number];

/**
 * Gap-spec §21.3, in the order a cost moves through them.
 *
 * The order matters for reporting: an estimated figure and an actual one are not comparable as
 * quantities of the same kind, and showing them in one column invites exactly that comparison.
 */
export const BUDGET_STATES = ['ESTIMATED', 'ALLOCATED', 'COMMITTED', 'ACTUAL', 'FORECAST'] as const;
export type BudgetState = (typeof BUDGET_STATES)[number];

export const STATE_MEANING: Readonly<Record<BudgetState, string>> = {
  ESTIMATED: 'A figure the engine or a person produced. Nobody has agreed to spend it.',
  ALLOCATED: 'Set aside for this. Not yet promised to anyone.',
  COMMITTED: 'Promised — a signed contract, a purchase order, a hire.',
  ACTUAL:
    'Spent. Entered by hand or imported; this platform does not reconcile with an accounting system.',
  FORECAST: 'What the remaining work is expected to cost, given what has happened so far.',
};

/* -------------------------------------------------------------------------- */
/* Cost lines                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * One line in the budget.
 *
 * `amount` is a **range**, always. Plan §12.3 forbids fake precision, and even a committed cost has a
 * range where usage or currency moves — a committed figure simply has a range of zero width, which is
 * a statement rather than an absence.
 */
export interface CostLine {
  readonly id: string;
  readonly label: string;
  readonly category: string;
  readonly type: CostType;
  readonly state: BudgetState;

  readonly amount: MoneyRange;

  /**
   * The original amount and rate, where this was converted.
   *
   * §21.1: never use a rate without recording its provenance. Present only when a conversion actually
   * happened, so its absence means "this was always in the base currency" rather than "nobody
   * recorded it".
   */
  readonly conversion?: ConvertedMoney;

  /** What this figure rests on. Shown with the number rather than in a footnote. */
  readonly basis: string;

  /** For recurring costs, how many periods the budget covers. */
  readonly periods?: number;
}

/**
 * Contingency, held as its own thing.
 *
 * §21.5 forbids hiding it inside estimates, which means it needs somewhere legitimate to live. This is
 * that place: a named amount, attributed to the uncertainties that justify it, with a record of what
 * has been drawn against it.
 */
export interface Contingency {
  readonly id: string;
  readonly label: string;
  readonly amount: Money;
  /**
   * What this contingency is *for*.
   *
   * A percentage applied by habit is not contingency; it is a superstition with a number. Naming the
   * uncertainties makes the figure arguable, and makes it obvious when one is resolved and the
   * allowance can shrink.
   */
  readonly justifications: readonly string[];
  /** Drawings against it, each with a reason. */
  readonly drawdowns: readonly {
    readonly amount: Money;
    readonly reason: string;
    readonly at: string;
  }[];
}

export interface Budget {
  readonly projectId: string;
  readonly baseCurrency: CurrencyCode;
  readonly lines: readonly CostLine[];
  readonly contingency: readonly Contingency[];
  readonly engineVersion: string;
}

/* -------------------------------------------------------------------------- */
/* Construction                                                               */
/* -------------------------------------------------------------------------- */

export function createBudget(projectId: string, baseCurrency: CurrencyCode): Budget {
  return {
    projectId,
    baseCurrency,
    lines: [],
    contingency: [],
    engineVersion: BUDGET_ENGINE_VERSION,
  };
}

export function addLine(budget: Budget, line: CostLine): Budget {
  if (line.amount.low.currency !== budget.baseCurrency) {
    /*
     * Every line is held in the base currency.
     *
     * §21.1 gives a project one base currency and says external costs may have an original currency —
     * which is what \`conversion\` records. Storing a line in a foreign currency would mean the total
     * could not be computed without an implicit rate, and an implicit rate is the thing §21.1 forbids.
     */
    throw new AppError({
      code: 'BUDGET_CURRENCY_MISMATCH',
      category: 'VALIDATION',
      safeMessage: 'Every budget line must be held in the project’s base currency.',
      details: { line: line.id, lineCurrency: line.amount.low.currency, base: budget.baseCurrency },
    });
  }

  if (line.type === 'CONTINGENCY') {
    // §21.5. A contingency line among the cost lines is contingency hidden in the budget, which is the
    // same failure as hiding it in an estimate.
    throw new AppError({
      code: 'BUDGET_CONTINGENCY_AS_LINE',
      category: 'VALIDATION',
      safeMessage: 'Contingency is held separately so it stays visible. Add it as contingency.',
      details: { line: line.id },
    });
  }

  if (budget.lines.some((existing) => existing.id === line.id)) {
    throw new AppError({
      code: 'BUDGET_DUPLICATE_LINE',
      category: 'CONFLICT',
      safeMessage: 'That budget line already exists.',
      details: { line: line.id },
    });
  }

  return { ...budget, lines: [...budget.lines, line] };
}

export function addContingency(budget: Budget, contingency: Contingency): Budget {
  if (contingency.justifications.length === 0) {
    /*
     * §21.5 requires contingency to be *explainable*.
     *
     * An unexplained allowance is the ten-per-cent convention with a different name: too much for
     * well-understood work, far too little for novel work, and applied to both identically.
     */
    throw new AppError({
      code: 'BUDGET_CONTINGENCY_UNJUSTIFIED',
      category: 'VALIDATION',
      safeMessage: 'Contingency has to say what it is for.',
      details: { contingency: contingency.id },
    });
  }

  return { ...budget, contingency: [...budget.contingency, contingency] };
}

/* -------------------------------------------------------------------------- */
/* Roll-up                                                                    */
/* -------------------------------------------------------------------------- */

export interface BudgetTotals {
  /** Cost lines only. Contingency is never included here — §21.5. */
  readonly lines: MoneyRange;
  readonly contingencyAllocated: Money;
  readonly contingencyRemaining: Money;
  /** Lines plus the full contingency allowance. */
  readonly withContingency: MoneyRange;

  readonly byType: Readonly<Record<CostType, MoneyRange>>;
  readonly byState: Readonly<Record<BudgetState, MoneyRange>>;
  readonly byCategory: Readonly<Record<string, MoneyRange>>;

  /** What these figures do and do not mean. Travels with them. */
  readonly caveats: readonly string[];
}

/**
 * Total a budget.
 *
 * Contingency is reported separately at every level, and `withContingency` is offered as a distinct
 * figure rather than as *the* total. A single number that silently includes the allowance is
 * contingency hidden one layer up from where §21.5 forbids hiding it.
 */
export function totals(budget: Budget): BudgetTotals {
  const currency = budget.baseCurrency;
  const zero = money(0, currency);
  const zeroRange = moneyRange(zero, zero);

  const byType = Object.fromEntries(COST_TYPES.map((t) => [t, zeroRange])) as Record<
    CostType,
    MoneyRange
  >;
  const byState = Object.fromEntries(BUDGET_STATES.map((s) => [s, zeroRange])) as Record<
    BudgetState,
    MoneyRange
  >;
  const byCategory: Record<string, MoneyRange> = {};

  for (const line of budget.lines) {
    // Recurring costs are multiplied by the periods the budget covers. Without that a monthly licence
    // appears once and the annual figure is out by a factor of twelve.
    const amount = expand(line);

    byType[line.type] = sumRanges([byType[line.type], amount], currency);
    byState[line.state] = sumRanges([byState[line.state], amount], currency);
    byCategory[line.category] = sumRanges(
      [byCategory[line.category] ?? zeroRange, amount],
      currency,
    );
  }

  const lineTotal = sumRanges(
    budget.lines.map((line) => expand(line)),
    currency,
  );

  const allocated = sum(
    budget.contingency.map((c) => c.amount),
    currency,
  );

  const drawn = sum(
    budget.contingency.flatMap((c) => c.drawdowns.map((d) => d.amount)),
    currency,
  );

  const remaining = money(allocated.minorUnits - drawn.minorUnits, currency);

  return {
    lines: lineTotal,
    contingencyAllocated: allocated,
    contingencyRemaining: remaining,
    withContingency: moneyRange(add(lineTotal.low, allocated), add(lineTotal.high, allocated)),
    byType,
    byState,
    byCategory,
    caveats: caveatsFor(budget, remaining),
  };
}

/** A recurring line, multiplied out over the periods the budget covers. */
function expand(line: CostLine): MoneyRange {
  if (line.type !== 'RECURRING_MONTHLY' && line.type !== 'RECURRING_ANNUAL') return line.amount;

  const periods = line.periods ?? 1;
  return moneyRange(scale(line.amount.low, periods), scale(line.amount.high, periods));
}

function caveatsFor(budget: Budget, remaining: Money): string[] {
  const caveats: string[] = [];

  if (budget.lines.some((l) => l.state === 'ACTUAL')) {
    /*
     * §21.4 is explicit: do not claim accounting-grade reconciliation unless it is implemented. It is
     * not, so the figure says so rather than letting a reader assume it reconciles.
     */
    caveats.push(
      'Actual costs are entered by hand or imported. This platform does not reconcile with an accounting system, so these figures are as accurate as what was entered.',
    );
  }

  if (budget.lines.some((l) => l.type === 'UNKNOWN')) {
    caveats.push(
      'Some costs are recorded as unknown. They are counted at their stated range, which is wide by construction — the total inherits that width.',
    );
  }

  if (budget.lines.some((l) => l.type === 'USAGE_BASED')) {
    caveats.push(
      'Usage-based costs have no natural ceiling. The figures here are estimates at expected volume, not limits.',
    );
  }

  if (budget.contingency.length === 0 && budget.lines.length > 0) {
    caveats.push(
      'No contingency has been set aside. Every estimate below is therefore being treated as the amount that will actually be needed.',
    );
  }

  if (remaining.minorUnits < 0) {
    caveats.push(
      'More has been drawn from contingency than was allocated to it. The budget is already over.',
    );
  }

  if (budget.lines.some((l) => l.conversion !== undefined)) {
    caveats.push(
      'Some costs were converted from another currency. The rate and its source are recorded on each line; the total moves if the rate does.',
    );
  }

  return caveats;
}

/* -------------------------------------------------------------------------- */
/* Contingency sizing                                                         */
/* -------------------------------------------------------------------------- */

export interface ContingencyBasis {
  /** Unresolved critical unknowns. Each widens the plausible range rather than shifting it. */
  readonly criticalUnknowns: number;
  /** Assumptions the plan rests on that nobody has confirmed. */
  readonly unconfirmedAssumptions: number;
  /** Whether the team is working in an unfamiliar technology. */
  readonly unfamiliarTechnology: boolean;
  /** Whether there is an existing system to work inside. */
  readonly existingSystem: boolean;
}

export interface SizedContingency {
  readonly percent: number;
  readonly amount: Money;
  readonly justifications: readonly string[];
}

/**
 * Size contingency from the actual uncertainty, rather than by convention.
 *
 * A fixed ten per cent is too much for well-understood work and far too little for novel work, and it
 * gets applied to both identically — which is how a project can be simultaneously over-budgeted and
 * under-protected.
 *
 * Every component is named, so the figure can be argued with, and so it can *shrink* when an unknown
 * is resolved. A contingency nobody can decompose never shrinks; it just gets spent.
 */
export function sizeContingency(base: Money, basis: ContingencyBasis): SizedContingency {
  const justifications: string[] = [];
  let percent = 0;

  if (basis.criticalUnknowns > 0) {
    // Ten per cent each, capped: past a handful of critical unknowns the problem is not the budget,
    // it is that the project is not ready to be budgeted.
    const contribution = Math.min(basis.criticalUnknowns * 10, 40);
    percent += contribution;
    justifications.push(
      `${String(contribution)}% for ${String(basis.criticalUnknowns)} unresolved critical ${basis.criticalUnknowns === 1 ? 'unknown' : 'unknowns'}. Each one widens the plausible cost rather than shifting it, and this allowance shrinks as they are answered.`,
    );
  }

  if (basis.unconfirmedAssumptions > 0) {
    const contribution = Math.min(basis.unconfirmedAssumptions * 3, 15);
    percent += contribution;
    justifications.push(
      `${String(contribution)}% for ${String(basis.unconfirmedAssumptions)} unconfirmed ${basis.unconfirmedAssumptions === 1 ? 'assumption' : 'assumptions'}. Any one being wrong changes work that has already been estimated.`,
    );
  }

  if (basis.unfamiliarTechnology) {
    percent += 15;
    justifications.push(
      '15% for unfamiliar technology. Learning time is real and is systematically omitted from estimates.',
    );
  }

  if (basis.existingSystem) {
    percent += 10;
    justifications.push(
      '10% for working inside an existing system, where undocumented behaviour is discovered by breaking it.',
    );
  }

  if (percent === 0) {
    /*
     * A floor rather than nothing.
     *
     * Zero contingency asserts that nothing unexpected will happen, which has never been true of any
     * project. Five per cent is small enough to be honest about being a convention and large enough
     * to absorb the first surprise.
     */
    percent = 5;
    justifications.push(
      '5% baseline. Nothing specific is outstanding, but a plan with no allowance at all asserts that nothing unexpected will happen.',
    );
  }

  return { percent, amount: percentOf(base, percent), justifications };
}

/* -------------------------------------------------------------------------- */
/* Variance                                                                   */
/* -------------------------------------------------------------------------- */

export interface Variance {
  readonly committedAndActual: Money;
  readonly estimated: MoneyRange;
  /** Positive means spending more than the estimate's conservative end. */
  readonly overConservative: Money;
  readonly withinRange: boolean;
  readonly explanation: string;
}

/**
 * Compare what has been spent against what was estimated.
 *
 * Compared against the **conservative** end, not the expected one. An estimate is a range, and being
 * above the middle of a range is not an overrun — reporting it as one trains people to ignore variance
 * warnings, which is how the real overrun goes unnoticed.
 */
export function variance(budget: Budget): Variance {
  const currency = budget.baseCurrency;

  const spent = sum(
    budget.lines
      .filter((l) => l.state === 'COMMITTED' || l.state === 'ACTUAL')
      .map((l) => expand(l).high),
    currency,
  );

  const estimated = sumRanges(
    budget.lines.filter((l) => l.state === 'ESTIMATED').map((l) => expand(l)),
    currency,
  );

  const over = money(Math.max(0, spent.minorUnits - estimated.high.minorUnits), currency);
  const withinRange = spent.minorUnits <= estimated.high.minorUnits;

  return {
    committedAndActual: spent,
    estimated,
    overConservative: over,
    withinRange,
    explanation: withinRange
      ? `${formatMoney(spent)} committed or spent, against an estimate of ${formatRange(estimated)}. Within the range.`
      : `${formatMoney(spent)} committed or spent, against a conservative estimate of ${formatMoney(estimated.high)}. That is ${formatMoney(over)} beyond the top of the range, so the estimate was wrong rather than merely optimistic.`,
  };
}
