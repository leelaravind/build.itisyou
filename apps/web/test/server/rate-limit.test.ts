/**
 * Rate limiting.
 *
 * Contract: gap-spec §36 — rate-limit auth endpoints, guest project creation, AI import validation,
 * file upload, search, export and expensive analysis; and "do not block normal legitimate usage with
 * overly low limits", which is a requirement in both directions.
 *
 * ## Why this file exists
 *
 * The limiter was written, wired into seven call sites, and never tested. That is worse than it
 * sounds for this particular control: a rate limiter that silently allows everything looks exactly
 * like one that is working, because the normal case is "not limited" either way. Nothing else in the
 * product would notice, and the first thing that would is a flood.
 *
 * The last test is the one that matters most over time. It reads the call sites out of the source
 * and checks each has a declared ceiling, because an action with no entry is *allowed* — and the
 * comment in `rate-limit.ts` saying "an unlimited endpoint is how limiting gets forgotten" is only
 * true if something checks.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { checkRateLimit, resetRateLimits } from '../../src/lib/server/rate-limit.ts';

const MINUTE = 60_000;
const START = 1_800_000_000_000;

beforeEach(() => {
  resetRateLimits();
});

describe('a limit lets normal use through', () => {
  it('allows the first call', async () => {
    expect(await checkRateLimit('guest-project-create', START)).toBe(true);
  });

  it('allows calls right up to the ceiling', async () => {
    // 600 a minute for project creation. The 600th is still inside the limit.
    for (let i = 0; i < 600; i += 1) {
      expect(await checkRateLimit('guest-project-create', START)).toBe(true);
    }
  });

  it('keeps a separate count per action', async () => {
    /*
     * A flood of one kind must not spend another kind's budget. Sharing a counter would let a
     * scripted import lock everybody out of signing in, which turns a limiter into the outage.
     */
    for (let i = 0; i < 300; i += 1) await checkRateLimit('auth-begin', START);

    expect(await checkRateLimit('auth-begin', START)).toBe(false);
    expect(await checkRateLimit('guest-project-create', START)).toBe(true);
  });
});

describe('a limit refuses a flood', () => {
  it('refuses the call past the ceiling', async () => {
    for (let i = 0; i < 300; i += 1) await checkRateLimit('ai-import', START);
    expect(await checkRateLimit('ai-import', START)).toBe(false);
  });

  it('keeps refusing for the rest of the window', async () => {
    /*
     * The refused calls are counted too, so hammering it does not walk the counter back under the
     * ceiling. A limiter that only counts successes can be held exactly at the boundary for ever.
     */
    for (let i = 0; i < 400; i += 1) await checkRateLimit('ai-import', START);

    expect(await checkRateLimit('ai-import', START + 30_000)).toBe(false);
  });

  it('lets the caller back in once the window has passed', async () => {
    for (let i = 0; i < 400; i += 1) await checkRateLimit('ai-import', START);
    expect(await checkRateLimit('ai-import', START)).toBe(false);

    expect(await checkRateLimit('ai-import', START + MINUTE)).toBe(true);
  });

  it('does not reset early', async () => {
    for (let i = 0; i < 400; i += 1) await checkRateLimit('ai-import', START);

    // One millisecond short of the window is still inside it.
    expect(await checkRateLimit('ai-import', START + MINUTE - 1)).toBe(false);
  });
});

describe('an action nobody declared a limit for', () => {
  it('is allowed rather than refused', async () => {
    /*
     * Deliberate, and the safer of two bad options: refusing would make a typo in a call site take
     * a working endpoint offline. The protection against the typo is the drift test below, not a
     * runtime refusal.
     */
    expect(await checkRateLimit('no-such-action', START)).toBe(true);
  });
});

describe('every rate-limited call site has a ceiling', () => {
  /*
   * The drift guard.
   *
   * `checkRateLimit('x')` with no entry for `x` returns true for ever, and the only sign is a
   * warning in a log nobody is reading. Reading the call sites out of the source means adding a
   * seventh limited action without a limit fails here rather than in production.
   */
  const SRC = join(process.cwd(), 'apps', 'web', 'src');

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return /\.tsx?$/.test(path) ? [path] : [];
    });
  }

  const called = new Set<string>();

  for (const file of sourceFiles(SRC)) {
    for (const match of readFileSync(file, 'utf8').matchAll(/checkRateLimit\('([a-z-]+)'/g)) {
      if (match[1] !== undefined) called.add(match[1]);
    }
  }

  it('finds the call sites at all', () => {
    // If the scan breaks, every assertion below passes vacuously.
    expect(called.size).toBeGreaterThanOrEqual(7);
  });

  it.each([...called].sort())('%s is limited', async (action) => {
    /*
     * A declared action refuses eventually; an undeclared one never does. Driving it past any
     * plausible ceiling distinguishes the two without this test needing to know the number.
     */
    let refused = false;

    for (let i = 0; i < 5_000 && !refused; i += 1) {
      refused = !(await checkRateLimit(action, START));
    }

    expect(refused).toBe(true);
  });
});

describe('the limits gap-spec §36 names', () => {
  it('covers the auth endpoints', async () => {
    // Named explicitly by §36, and the only actions here that do work on unauthenticated input.
    for (const action of ['auth-begin', 'auth-callback']) {
      resetRateLimits();
      let refused = false;
      for (let i = 0; i < 1_000 && !refused; i += 1) {
        refused = !(await checkRateLimit(action, START));
      }
      expect(refused, action).toBe(true);
    }
  });

  it('does not throttle a normal session', async () => {
    /*
     * The other half of §36, and the half that is easy to break while tightening the first: a
     * limiter that blocks legitimate use is an outage with a security justification.
     *
     * A person working through intake answers perhaps a few dozen questions. Fifty answers inside
     * one minute is well past attentive human speed and must still be allowed.
     */
    for (let i = 0; i < 50; i += 1) {
      expect(await checkRateLimit('intake-answer', START)).toBe(true);
    }
  });
});
