import { describe, expect, it } from 'vitest';
import {
  BREAKPOINTS,
  BREAKPOINT_SPEC,
  DENSE_REPRESENTATIONS,
  DENSE_SPEC,
  MIN_TOUCH_TARGET_PX,
  breakpointFor,
  checkContract,
} from '../src/responsive.ts';

describe('gap-spec §3.3: the responsive contract', () => {
  it('defines behaviour at all six sizes', () => {
    expect(BREAKPOINTS).toHaveLength(6);

    for (const breakpoint of BREAKPOINTS) {
      expect(BREAKPOINT_SPEC[breakpoint].behaviour.length, breakpoint).toBeGreaterThan(40);
    }
  });

  it('treats mobile as the base layer rather than an override', () => {
    /*
     * §3.3: "must not merely shrink desktop UI". A layout that exists only as a set of overrides has
     * a desktop shape underneath it, and the overrides are where it breaks.
     */
    expect(BREAKPOINT_SPEC.MOBILE.prefix).toBeNull();
    expect(BREAKPOINT_SPEC.MOBILE.from).toBe(0);
  });

  it('stops widening content at the largest size', () => {
    // Line length is a readability constraint, not a space constraint. A paragraph across 1800px is
    // harder to read than the same paragraph at 700px.
    expect(BREAKPOINT_SPEC.WIDE_DESKTOP.behaviour).toMatch(/margin/i);
  });

  it('resolves a width to exactly one breakpoint', () => {
    expect(breakpointFor(0)).toBe('MOBILE');
    expect(breakpointFor(393)).toBe('MOBILE');
    expect(breakpointFor(640)).toBe('SMALL_TABLET');
    expect(breakpointFor(1024)).toBe('LAPTOP');
    expect(breakpointFor(2560)).toBe('WIDE_DESKTOP');
  });

  it('uses a touch target larger than the failure threshold', () => {
    /*
     * WCAG 2.2 §2.5.8 sets 24px as the level below which a target *fails*. Designing to a failure
     * threshold makes every rounding error a defect; 44px is roughly the pad of an adult finger,
     * which is the constraint the criterion approximates.
     */
    expect(MIN_TOUCH_TARGET_PX).toBeGreaterThan(24);
  });
});

describe('gap-spec §3.4: dense representations', () => {
  it('covers all ten', () => {
    expect(DENSE_REPRESENTATIONS).toHaveLength(10);
  });

  it('defines desktop, tablet, mobile and an accessible alternative for each', () => {
    for (const key of DENSE_REPRESENTATIONS) {
      const spec = DENSE_SPEC[key];

      expect(spec.desktop.length, key).toBeGreaterThan(10);
      expect(spec.tablet.length, key).toBeGreaterThan(10);
      expect(spec.mobile.length, key).toBeGreaterThan(10);
      expect(spec.accessibleAlternative.length, key).toBeGreaterThan(40);
    }
  });

  it('keeps the accessible alternative distinct from the mobile fallback', () => {
    /*
     * The distinction the whole module exists for. A mobile fallback is what a small screen gets; an
     * accessible alternative is what somebody gets who cannot perceive the visual form *at any size*.
     * Written as the same sentence, the alternative gets implemented as a media query, and a
     * screen-reader user on a large monitor gets nothing.
     */
    for (const key of DENSE_REPRESENTATIONS) {
      expect(DENSE_SPEC[key].accessibleAlternative, key).not.toBe(DENSE_SPEC[key].mobile);
    }
  });

  it('requires the accessible alternative to be present at every size', () => {
    // An alternative rendered only in some conditions decays, and it decays silently — the people
    // who would notice are the people it was for.
    for (const key of DENSE_REPRESENTATIONS) {
      expect(DENSE_SPEC[key].alwaysPresent, key).toBe(true);
    }
  });

  it('finds nothing wrong with the contract as it stands', () => {
    expect(checkContract()).toEqual([]);
  });
});
