/**
 * Result type tests.
 * Used by the AI-import validation pipeline (plan section 11.1), where rejection is a normal outcome
 * rather than an exception, and where the user must see every problem at once.
 */

import { describe, it, expect } from 'vitest';
import { collect, err, flatMap, isErr, isOk, map, ok, unwrapOr } from '../src/result.ts';

describe('construction and guards', () => {
  it('builds a success result', () => {
    const result = ok(42);
    expect(result.ok).toBe(true);
    expect(isOk(result)).toBe(true);
    if (result.ok) expect(result.value).toBe(42);
  });

  it('builds a failure result', () => {
    const result = err('boom');
    expect(result.ok).toBe(false);
    expect(isErr(result)).toBe(true);
    if (!result.ok) expect(result.error).toBe('boom');
  });

  it('carries falsy success values without confusing them for failure', () => {
    expect(isOk(ok(0))).toBe(true);
    expect(isOk(ok(''))).toBe(true);
    expect(isOk(ok(null))).toBe(true);
    expect(isOk(ok(false))).toBe(true);
  });
});

describe('map', () => {
  it('transforms a success value', () => {
    expect(map(ok(2), (n) => n * 3)).toEqual({ ok: true, value: 6 });
  });

  it('leaves a failure untouched and does not run the function', () => {
    let called = false;
    const result = map(err<string>('bad'), () => {
      called = true;
      return 1;
    });

    expect(called).toBe(false);
    expect(result).toEqual({ ok: false, error: 'bad' });
  });
});

describe('flatMap', () => {
  it('chains successful steps', () => {
    const result = flatMap(ok(4), (n) => ok(n + 1));
    expect(result).toEqual({ ok: true, value: 5 });
  });

  it('short-circuits on the first failure', () => {
    let called = false;
    const result = flatMap(err<string>('first'), () => {
      called = true;
      return ok(1);
    });

    expect(called).toBe(false);
    expect(result).toEqual({ ok: false, error: 'first' });
  });

  it('propagates a failure produced mid-chain', () => {
    const result = flatMap(ok(4), () => err('mid-chain'));
    expect(result).toEqual({ ok: false, error: 'mid-chain' });
  });
});

describe('unwrapOr', () => {
  it('returns the value on success', () => {
    expect(unwrapOr(ok(7), 0)).toBe(7);
  });

  it('returns the fallback on failure', () => {
    expect(unwrapOr(err<string>('x'), 0)).toBe(0);
  });
});

describe('collect', () => {
  it('gathers all values when every result succeeds', () => {
    expect(collect([ok(1), ok(2), ok(3)])).toEqual({ ok: true, value: [1, 2, 3] });
  });

  it('accumulates every error rather than stopping at the first', () => {
    // The import validator must surface all problems at once. Returning them one at a time would
    // force a round trip to an external AI per error.
    const result = collect([ok(1), err('a'), ok(2), err('b'), err('c')]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual(['a', 'b', 'c']);
  });

  it('treats an empty input as success', () => {
    expect(collect([])).toEqual({ ok: true, value: [] });
  });

  it('discards partial values when any result failed', () => {
    // A partially applied import is worse than a rejected one.
    const result = collect([ok(1), err('bad')]);
    expect(result.ok).toBe(false);
  });
});
