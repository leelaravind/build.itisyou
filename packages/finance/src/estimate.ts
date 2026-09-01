/**
 * The estimation engine.
 *
 * Contract: gap-spec §20 opens with the instruction that governs everything here — **"Do not pretend
 * to know exact delivery time."** §20.2 requires optimistic/expected/conservative or min/expected/max;
 * §20.3 requires a confidence class; §20.4 requires every estimate to record its source, formula,
 * assumptions, engine version, whether it was manually overridden and why.
 *
 * §20.4 is the part that makes an estimate defensible rather than merely present. Six months later,
 * "the build was estimated at ninety days" cannot be argued with or corrected unless someone can see
 * what it assumed. An estimate without its basis is a number that has acquired authority it never
 * earned.
 *
 * Two things this engine deliberately will not do:
 *
 * - **Produce a single figure.** Every output is three points. There is no `expectedOnly` accessor,
 *   because the moment one exists everyone downstream uses it and the range becomes decoration.
 * - **Produce a delivery date.** A date computed from ranges is fake precision with a calendar
 *   attached. What it produces is a range of effort and the assumptions behind it; turning that into
 *   dates needs capacity and a calendar, and the uncertainty has to travel with it.
 */

import { AppError } from '@govintel/shared/errors';

/** Bumped whenever a formula changes. A stored estimate keeps the version that produced it. */
export const ESTIMATOR_VERSION = '1.0.0';

/* -------------------------------------------------------------------------- */
/* Three-point estimates                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Effort in hours, as three points.
 *
 * §20.2 offers optimistic/expected/conservative or min/expected/max. The first naming is used because
 * "min" invites being read as a floor that cannot be beaten, whereas "optimistic" says what it is: the
 * figure if things go well, which is not a promise that they will.
 */
export interface EffortEstimate {
  readonly optimistic: number;
  readonly expected: number;
  readonly conservative: number;
}

export const CONFIDENCE_CLASSES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type ConfidenceClass = (typeof CONFIDENCE_CLASSES)[number];

/** §20.4: everything needed to explain an estimate later. */
export interface EstimateProvenance {
  /** Where the figure came from: a formula, a person, an analogy with prior work. */
  readonly source: 'FORMULA' | 'MANUAL' | 'ANALOGY' | 'IMPORTED';
  /** Which formula, when there was one. */
  readonly formula: string;
  readonly estimatorVersion: string;
  /** What had to be true for this figure to hold. Surfaced with the number, never buried. */
  readonly assumptions: readonly string[];
  /** §20.4 asks explicitly. A manual override is legitimate and must be visible. */
  readonly manuallyOverridden: boolean;
  readonly overrideReason?: string;
  /** The inputs the formula actually read, so the arithmetic can be reproduced. */
  readonly inputs: Readonly<Record<string, number | string | boolean>>;
}

export interface Estimate {
  readonly effort: EffortEstimate;
  readonly confidence: ConfidenceClass;
  readonly provenance: EstimateProvenance;
}

/* -------------------------------------------------------------------------- */
/* Complexity                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * How much work an item is, before any adjustment.
 *
 * Deliberately coarse. A five-point scale invites arguments about whether something is a three or a
 * four, and the difference is well inside the error of the estimate itself — which is the point §20's
 * opening instruction is making.
 */
export const COMPLEXITY_LEVELS = ['TRIVIAL', 'SMALL', 'MEDIUM', 'LARGE', 'UNKNOWN'] as const;
export type Complexity = (typeof COMPLEXITY_LEVELS)[number];

/**
 * Base hours per complexity level.
 *
 * These are conventions, not measurements, and every estimate that uses them says so. The wide bands
 * on `LARGE` and `UNKNOWN` are the honest shape: uncertainty grows faster than size, and an item
 * nobody has sized is not "medium by default" — it is unknown, and the range says that.
 */
export const COMPLEXITY_HOURS: Readonly<Record<Complexity, EffortEstimate>> = {
  TRIVIAL: { optimistic: 0.5, expected: 1, conservative: 2 },
  SMALL: { optimistic: 2, expected: 4, conservative: 8 },
  MEDIUM: { optimistic: 8, expected: 16, conservative: 32 },
  LARGE: { optimistic: 24, expected: 56, conservative: 120 },
  /*
   * An unsized item.
   *
   * The range is deliberately enormous — a factor of twenty — because that is what "we have not
   * looked at this" actually means. Narrowing it to something comfortable would be inventing
   * knowledge, and the discomfort of the number is the signal that the item needs sizing.
   */
  UNKNOWN: { optimistic: 4, expected: 40, conservative: 160 },
};

/* -------------------------------------------------------------------------- */
/* Adjustments                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A named multiplier, with the reason it applies.
 *
 * Adjustments are separate from the base figure and each carries its own explanation, so the finished
 * estimate can be read as an argument rather than as a number. "Ninety hours" is unarguable; "sixteen
 * base, doubled for unfamiliar technology, plus twenty per cent rework" can be disagreed with in
 * exactly one place.
 */
export interface Adjustment {
  readonly key: string;
  readonly reason: string;
  /** Applied to all three points. Below 1 makes the work smaller. */
  readonly factor: {
    readonly optimistic: number;
    readonly expected: number;
    readonly conservative: number;
  };
}

/** The adjustments this engine knows about. Each corresponds to a rule in the Phase-7 catalogue. */
export const ADJUSTMENTS: Readonly<Record<string, Adjustment>> = {
  UNFAMILIAR_TECHNOLOGY: {
    key: 'UNFAMILIAR_TECHNOLOGY',
    reason:
      'The technology is new to whoever is doing the work. Learning time is real time, and it is usually planned as though it were zero.',
    // Wider at the conservative end: the risk of an unfamiliar technology is not that it is uniformly
    // slower, but that it occasionally goes very badly.
    factor: { optimistic: 1.2, expected: 1.6, conservative: 2.5 },
  },
  EXISTING_CODEBASE: {
    key: 'EXISTING_CODEBASE',
    reason:
      'Working inside an existing system means discovering undocumented behaviour that something depends on.',
    factor: { optimistic: 1.1, expected: 1.4, conservative: 2.0 },
  },
  REWORK_ALLOWANCE: {
    key: 'REWORK_ALLOWANCE',
    reason:
      'Review feedback, changed understanding and defects found in verification all produce real work that estimates systematically omit.',
    factor: { optimistic: 1.05, expected: 1.2, conservative: 1.4 },
  },
  COMPLIANCE_EVIDENCE: {
    key: 'COMPLIANCE_EVIDENCE',
    reason:
      'Compliance work is mostly evidence collection, and evidence gathered as you go still takes time that feature estimates do not include.',
    factor: { optimistic: 1.1, expected: 1.3, conservative: 1.6 },
  },
  HIGH_AVAILABILITY: {
    key: 'HIGH_AVAILABILITY',
    reason:
      'Redundancy, failover and the testing that proves either work are additional to the feature itself.',
    factor: { optimistic: 1.15, expected: 1.4, conservative: 1.8 },
  },
  ACCESSIBILITY_RETROFIT: {
    key: 'ACCESSIBILITY_RETROFIT',
    reason:
      'Accessibility added after the design is finished means reworking markup, focus order and colour decisions across every page.',
    factor: { optimistic: 3, expected: 5, conservative: 10 },
  },
  AI_ASSISTED: {
    key: 'AI_ASSISTED',
    reason:
      'An AI coding tool is available. The effect varies enormously by task and nobody has measured it for this team on this codebase, so the range widens as well as shifting.',
    // The optimistic end improves more than the conservative one: the tool helps most where the work
    // is routine, and least where it is hard — which is where the schedule risk actually is.
    factor: { optimistic: 0.5, expected: 0.8, conservative: 1.0 },
  },
};

/* -------------------------------------------------------------------------- */
/* Estimation                                                                 */
/* -------------------------------------------------------------------------- */

export interface EstimateInput {
  readonly complexity: Complexity;
  /** Keys from `ADJUSTMENTS`. Unknown keys are refused rather than ignored. */
  readonly adjustments?: readonly string[];
  /** Extra assumptions from the caller, recorded alongside the engine's own. */
  readonly assumptions?: readonly string[];
}

/**
 * Estimate one item.
 *
 * Pure and deterministic: same input, same output, same assumptions in the same order. That is what
 * makes the golden calculation suite possible, and it is the same property the generator and the rule
 * evaluator hold.
 */
export function estimate(input: EstimateInput): Estimate {
  const base = COMPLEXITY_HOURS[input.complexity];
  const keys = [...(input.adjustments ?? [])].sort();

  const applied: Adjustment[] = [];

  for (const key of keys) {
    const adjustment = ADJUSTMENTS[key];
    if (adjustment === undefined) {
      /*
       * Refused, not ignored.
       *
       * Silently dropping an unrecognised adjustment would produce an estimate that is quietly too
       * low, and the omission would be invisible — the number would look like a normal estimate.
       */
      throw new AppError({
        code: 'ESTIMATE_UNKNOWN_ADJUSTMENT',
        category: 'VALIDATION',
        safeMessage: 'That estimate adjustment is not one this engine knows about.',
        details: { key },
      });
    }
    applied.push(adjustment);
  }

  let effort = base;
  for (const adjustment of applied) {
    effort = {
      optimistic: effort.optimistic * adjustment.factor.optimistic,
      expected: effort.expected * adjustment.factor.expected,
      conservative: effort.conservative * adjustment.factor.conservative,
    };
  }

  const rounded: EffortEstimate = {
    optimistic: round(effort.optimistic),
    expected: round(effort.expected),
    conservative: round(effort.conservative),
  };

  const assumptions = [
    complexityAssumption(input.complexity),
    ...applied.map((a) => a.reason),
    ...(input.assumptions ?? []),
  ];

  return {
    effort: rounded,
    confidence: confidenceFor(input.complexity, rounded),
    provenance: {
      source: 'FORMULA',
      formula: 'complexity-base × adjustments',
      estimatorVersion: ESTIMATOR_VERSION,
      assumptions,
      manuallyOverridden: false,
      inputs: {
        complexity: input.complexity,
        adjustments: keys.join(','),
        baseOptimistic: base.optimistic,
        baseExpected: base.expected,
        baseConservative: base.conservative,
      },
    },
  };
}

function round(hours: number): number {
  // To a quarter hour. Finer resolution on a figure whose range spans a factor of four would be
  // precision the estimate does not have.
  return Math.round(hours * 4) / 4;
}

function complexityAssumption(complexity: Complexity): string {
  if (complexity === 'UNKNOWN') {
    return 'Nobody has sized this. The range spans a factor of twenty because that is what "we have not looked at it" means — narrowing it would be inventing knowledge.';
  }

  return `Sized as ${complexity.toLowerCase()}, using the platform's convention for that size rather than a measurement of this team's actual pace.`;
}

/**
 * How much confidence the figure deserves.
 *
 * Derived from the width of the range rather than asserted. A range spanning a factor of four is not
 * a high-confidence estimate no matter how carefully it was produced, and letting a caller declare
 * confidence independently of the spread would let the two disagree.
 */
export function confidenceFor(complexity: Complexity, effort: EffortEstimate): ConfidenceClass {
  if (complexity === 'UNKNOWN') return 'LOW';
  if (effort.optimistic === 0) return 'LOW';

  const spread = effort.conservative / effort.optimistic;

  if (spread <= 2.5) return 'HIGH';
  if (spread <= 5) return 'MEDIUM';
  return 'LOW';
}

/* -------------------------------------------------------------------------- */
/* Overrides                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Replace an estimate with a human judgement, keeping the record.
 *
 * §20.4 asks whether an estimate was manually overridden and why, which means overriding must be
 * *supported* rather than prevented — a system that refuses human judgement gets worked around, and
 * the workaround leaves no record at all.
 *
 * The reason is mandatory. An override with no reason is indistinguishable from a mistake six months
 * later, and it is exactly the case where the original figure might have been right.
 */
export function override(original: Estimate, effort: EffortEstimate, reason: string): Estimate {
  if (reason.trim().length < 10) {
    throw new AppError({
      code: 'ESTIMATE_OVERRIDE_WITHOUT_REASON',
      category: 'VALIDATION',
      safeMessage: 'An estimate can be overridden, but the reason has to be recorded.',
      details: {},
    });
  }

  if (effort.optimistic > effort.expected || effort.expected > effort.conservative) {
    throw new AppError({
      code: 'ESTIMATE_INVERTED',
      category: 'VALIDATION',
      safeMessage: 'An estimate must run from optimistic through expected to conservative.',
      details: { ...effort },
    });
  }

  return {
    effort,
    confidence: confidenceFor('MEDIUM', effort),
    provenance: {
      source: 'MANUAL',
      formula: 'manual override',
      estimatorVersion: ESTIMATOR_VERSION,
      // The original assumptions are kept: they explain what the figure being replaced was based on,
      // which is the context anyone reviewing the override needs.
      assumptions: [
        `Overridden from ${String(original.effort.expected)}h expected. ${reason}`,
        ...original.provenance.assumptions,
      ],
      manuallyOverridden: true,
      overrideReason: reason,
      inputs: {
        originalOptimistic: original.effort.optimistic,
        originalExpected: original.effort.expected,
        originalConservative: original.effort.conservative,
        overriddenOptimistic: effort.optimistic,
        overriddenExpected: effort.expected,
        overriddenConservative: effort.conservative,
      },
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Aggregation                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Total a set of estimates.
 *
 * Points are summed independently, which is deliberately the **conservative** aggregation: it assumes
 * everything goes badly together at the conservative end and well together at the optimistic one.
 *
 * A statistical roll-up (PERT, or summing variances) would produce a narrower and more flattering
 * range, and it assumes the estimates are independent. They are not — projects go wrong for reasons
 * that affect many tasks at once: a wrong architectural assumption, a departure, a dependency that
 * turned out harder. Narrowing the range on an independence assumption that does not hold is precisely
 * the fake precision §20 opens by forbidding.
 */
export function totalEffort(estimates: readonly Estimate[]): EffortEstimate {
  return estimates.reduce<EffortEstimate>(
    (total, e) => ({
      optimistic: total.optimistic + e.effort.optimistic,
      expected: total.expected + e.effort.expected,
      conservative: total.conservative + e.effort.conservative,
    }),
    { optimistic: 0, expected: 0, conservative: 0 },
  );
}

/** Every distinct assumption behind a set of estimates, in first-seen order. */
export function collectAssumptions(estimates: readonly Estimate[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const e of estimates) {
    for (const assumption of e.provenance.assumptions) {
      if (seen.has(assumption)) continue;
      seen.add(assumption);
      out.push(assumption);
    }
  }

  return out;
}

/**
 * The confidence of a total.
 *
 * The **lowest** of its parts, not an average. A total containing one unsized item is not
 * medium-confidence because everything else was well understood — the unknown dominates, and averaging
 * would let a single large uncertainty disappear into a comfortable-looking summary.
 */
export function aggregateConfidence(estimates: readonly Estimate[]): ConfidenceClass {
  if (estimates.length === 0) return 'LOW';
  if (estimates.some((e) => e.confidence === 'LOW')) return 'LOW';
  if (estimates.some((e) => e.confidence === 'MEDIUM')) return 'MEDIUM';
  return 'HIGH';
}

/** Format for display. Never collapses to a single figure. */
export function formatEffort(effort: EffortEstimate): string {
  return `${String(effort.optimistic)}–${String(effort.conservative)} hours (expected ${String(effort.expected)})`;
}
