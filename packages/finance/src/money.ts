/**
 * Money, currency and the provenance of a conversion.
 *
 * Contract: gap-spec §21.1 — a project has one base currency; external costs may have an original
 * currency; store the original amount and currency, the converted base amount, and the FX source and
 * time. And the instruction that shapes the whole file: **"Do not silently use live FX without
 * recording rate provenance."**
 *
 * That prohibition is doing real work. A converted figure with no recorded rate is a number nobody can
 * reproduce: six months later the rate has moved, the total no longer reconciles, and there is no way
 * to tell whether the difference is a rate change, a scope change or a mistake. Recording the rate
 * turns an unexplainable discrepancy into an arithmetic one.
 *
 * Amounts are held in **minor units as integers**. Floating-point arithmetic on money accumulates
 * error that is invisible until a total is off by a penny and somebody has to explain why —
 * `0.1 + 0.2 !== 0.3` is the whole argument.
 */

import { AppError } from '@govintel/shared/errors';

/* -------------------------------------------------------------------------- */
/* Currency                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The currencies this build understands, with their minor-unit exponent.
 *
 * Not every currency has two decimal places, and assuming so is a real defect rather than a curiosity:
 * treating a yen amount as having minor units inflates it a hundredfold. The list is deliberately
 * short — adding one is a decision, not a default — and anything absent is refused rather than guessed.
 */
export const CURRENCIES: Readonly<
  Record<string, { readonly exponent: number; readonly name: string }>
> = {
  GBP: { exponent: 2, name: 'Pound sterling' },
  EUR: { exponent: 2, name: 'Euro' },
  USD: { exponent: 2, name: 'US dollar' },
  CAD: { exponent: 2, name: 'Canadian dollar' },
  AUD: { exponent: 2, name: 'Australian dollar' },
  CHF: { exponent: 2, name: 'Swiss franc' },
  SEK: { exponent: 2, name: 'Swedish krona' },
  NOK: { exponent: 2, name: 'Norwegian krone' },
  DKK: { exponent: 2, name: 'Danish krone' },
  PLN: { exponent: 2, name: 'Polish złoty' },
  INR: { exponent: 2, name: 'Indian rupee' },
  /** Zero minor units. The reason this table exists at all. */
  JPY: { exponent: 0, name: 'Japanese yen' },
  KRW: { exponent: 0, name: 'South Korean won' },
};

export type CurrencyCode = keyof typeof CURRENCIES;

export function isCurrency(code: string): code is CurrencyCode {
  return Object.hasOwn(CURRENCIES, code);
}

export function exponentOf(code: string): number {
  const currency = CURRENCIES[code];
  if (currency === undefined) {
    throw new AppError({
      code: 'MONEY_UNKNOWN_CURRENCY',
      category: 'VALIDATION',
      safeMessage: 'That currency is not one this platform handles.',
      details: { code },
    });
  }
  return currency.exponent;
}

/* -------------------------------------------------------------------------- */
/* Amounts                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * An amount of money.
 *
 * `minorUnits` is an integer: 1234 in GBP is £12.34, and 1234 in JPY is ¥1,234. Currency travels with
 * every amount because a number without one is not an amount — a figure inferred from context is a
 * figure that will eventually be inferred wrongly, and the mistake is invisible because the number
 * still looks fine.
 */
export interface Money {
  readonly minorUnits: number;
  readonly currency: CurrencyCode;
}

export function money(minorUnits: number, currency: string): Money {
  if (!isCurrency(currency)) {
    throw new AppError({
      code: 'MONEY_UNKNOWN_CURRENCY',
      category: 'VALIDATION',
      safeMessage: 'That currency is not one this platform handles.',
      details: { currency },
    });
  }

  if (!Number.isInteger(minorUnits)) {
    // A fractional minor unit is a floating-point value that has already lost precision somewhere
    // upstream. Accepting it would carry that loss into every total computed from it.
    throw new AppError({
      code: 'MONEY_FRACTIONAL_MINOR_UNITS',
      category: 'VALIDATION',
      safeMessage: 'An amount of money must be a whole number of its smallest unit.',
      details: { minorUnits, currency },
    });
  }

  return { minorUnits, currency };
}

/** Build an amount from a major-unit figure, e.g. 12.34 GBP. Rounds half away from zero. */
export function fromMajor(major: number, currency: string): Money {
  const exponent = exponentOf(currency);
  const scaled = major * 10 ** exponent;

  /*
   * Rounded, not truncated, and away from zero rather than towards positive infinity.
   *
   * `Math.round(-0.5)` is `-0` in JavaScript, which rounds a negative half *up* — a credit of −0.005
   * would become zero while a debit of 0.005 became a penny. Money should round symmetrically or the
   * direction of an error depends on its sign.
   */
  const rounded = scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
  return money(rounded, currency);
}

export function toMajor(amount: Money): number {
  return amount.minorUnits / 10 ** exponentOf(amount.currency);
}

/** Formatted for display, in the locale's convention for that currency. */
export function formatMoney(amount: Money, locale = 'en-GB'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: amount.currency,
    minimumFractionDigits: exponentOf(amount.currency),
    maximumFractionDigits: exponentOf(amount.currency),
  }).format(toMajor(amount));
}

/* -------------------------------------------------------------------------- */
/* Arithmetic                                                                 */
/* -------------------------------------------------------------------------- */

function sameCurrency(a: Money, b: Money): void {
  if (a.currency === b.currency) return;

  /*
   * Refused rather than converted.
   *
   * An implicit conversion would need a rate, and a rate used without being recorded is exactly what
   * §21.1 forbids. Adding two currencies is a question about which rate applies at what time, and
   * the answer has to come from the caller.
   */
  throw new AppError({
    code: 'MONEY_CURRENCY_MISMATCH',
    category: 'VALIDATION',
    safeMessage: 'Two amounts in different currencies cannot be combined without a recorded rate.',
    details: { left: a.currency, right: b.currency },
  });
}

export function add(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return { minorUnits: a.minorUnits + b.minorUnits, currency: a.currency };
}

export function subtract(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return { minorUnits: a.minorUnits - b.minorUnits, currency: a.currency };
}

export function sum(amounts: readonly Money[], currency: CurrencyCode): Money {
  // The currency is a parameter rather than inferred from the first element, so summing an empty list
  // returns zero *in a known currency* instead of failing or guessing.
  return amounts.reduce<Money>((total, amount) => add(total, amount), {
    minorUnits: 0,
    currency,
  });
}

/** Multiply by a factor, rounding half away from zero. */
export function scale(amount: Money, factor: number): Money {
  const scaled = amount.minorUnits * factor;
  const rounded = scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
  return { minorUnits: rounded, currency: amount.currency };
}

export function percentOf(amount: Money, percent: number): Money {
  return scale(amount, percent / 100);
}

export function isZero(amount: Money): boolean {
  return amount.minorUnits === 0;
}

export function compare(a: Money, b: Money): number {
  sameCurrency(a, b);
  return a.minorUnits - b.minorUnits;
}

/* -------------------------------------------------------------------------- */
/* Ranges                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A range of money.
 *
 * Plan §12.3 forbids fake precision, and a single figure for anything estimated is exactly that: a
 * number read as a commitment. A range communicates the uncertainty that was always present and makes
 * the conversation about which end is likely.
 *
 * There is deliberately **no midpoint accessor**. Averaging a range discards the information the range
 * carried, and once a midpoint exists everyone downstream treats it as the number.
 */
export interface MoneyRange {
  readonly low: Money;
  readonly high: Money;
}

export function moneyRange(low: Money, high: Money): MoneyRange {
  sameCurrency(low, high);

  if (low.minorUnits > high.minorUnits) {
    throw new AppError({
      code: 'MONEY_INVERTED_RANGE',
      category: 'VALIDATION',
      safeMessage: 'A range cannot start above where it ends.',
      details: { low: low.minorUnits, high: high.minorUnits },
    });
  }

  return { low, high };
}

export function addRange(a: MoneyRange, b: MoneyRange): MoneyRange {
  return moneyRange(add(a.low, b.low), add(a.high, b.high));
}

export function sumRanges(ranges: readonly MoneyRange[], currency: CurrencyCode): MoneyRange {
  const zero = money(0, currency);
  return ranges.reduce<MoneyRange>((total, range) => addRange(total, range), {
    low: zero,
    high: zero,
  });
}

export function scaleRange(range: MoneyRange, factor: number): MoneyRange {
  return moneyRange(scale(range.low, factor), scale(range.high, factor));
}

/** How wide the range is, as a proportion of its low end. A crude but useful uncertainty signal. */
export function rangeSpread(range: MoneyRange): number | null {
  // Undefined rather than infinite when the low end is zero: a range from nothing to something has no
  // meaningful proportional width, and reporting one would invent a figure.
  if (range.low.minorUnits === 0) return null;
  return (range.high.minorUnits - range.low.minorUnits) / range.low.minorUnits;
}

export function formatRange(range: MoneyRange, locale = 'en-GB'): string {
  if (range.low.minorUnits === range.high.minorUnits) return formatMoney(range.low, locale);
  return `${formatMoney(range.low, locale)} – ${formatMoney(range.high, locale)}`;
}

/* -------------------------------------------------------------------------- */
/* Conversion                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * An exchange rate, with where it came from and when.
 *
 * Every field here exists because §21.1 forbids using a rate without recording its provenance. A
 * converted total whose rate is unrecorded cannot be reproduced, and the discrepancy that appears
 * later cannot be attributed to anything.
 */
export interface ExchangeRate {
  readonly from: CurrencyCode;
  readonly to: CurrencyCode;
  /** Units of `to` per one unit of `from`. */
  readonly rate: number;
  /** Where the rate came from — a provider name, a contract, a manual entry. */
  readonly source: string;
  /** When the rate was observed, not when the conversion ran. */
  readonly asOf: string;
}

export interface ConvertedMoney {
  readonly original: Money;
  readonly converted: Money;
  readonly rate: ExchangeRate;
}

/**
 * Convert, keeping the original and the rate.
 *
 * Returns all three parts rather than just the result. A function returning only the converted amount
 * would make it possible to store a base-currency figure with no record of what it was converted from
 * — which is the failure §21.1 names, arrived at by convenience rather than intent.
 */
export function convert(amount: Money, rate: ExchangeRate): ConvertedMoney {
  if (amount.currency !== rate.from) {
    throw new AppError({
      code: 'MONEY_RATE_MISMATCH',
      category: 'VALIDATION',
      safeMessage: 'That exchange rate does not apply to this amount.',
      details: { amount: amount.currency, rateFrom: rate.from },
    });
  }

  if (!(rate.rate > 0) || !Number.isFinite(rate.rate)) {
    throw new AppError({
      code: 'MONEY_INVALID_RATE',
      category: 'VALIDATION',
      safeMessage: 'An exchange rate must be a positive number.',
      details: { rate: rate.rate },
    });
  }

  if (rate.source.trim().length === 0) {
    // §21.1: never silently use a rate. An empty source is a rate nobody can trace.
    throw new AppError({
      code: 'MONEY_RATE_WITHOUT_PROVENANCE',
      category: 'VALIDATION',
      safeMessage: 'An exchange rate must record where it came from.',
      details: { from: rate.from, to: rate.to },
    });
  }

  /*
   * Converted through major units, because the exponents may differ.
   *
   * £12.34 at 190 JPY/GBP is ¥2,345, not ¥234,460 — converting minor units directly would multiply by
   * a hundred wherever the exponents are not equal, and JPY is exactly why the exponent table exists.
   */
  const major = toMajor(amount) * rate.rate;

  return { original: amount, converted: fromMajor(major, rate.to), rate };
}

/** Describe a conversion for display, including the rate and when it was taken. */
export function describeConversion(converted: ConvertedMoney, locale = 'en-GB'): string {
  return (
    `${formatMoney(converted.original, locale)} converted at ${String(converted.rate.rate)} ` +
    `${converted.rate.from}/${converted.rate.to} (${converted.rate.source}, ${converted.rate.asOf})`
  );
}
