/**
 * The responsive contract.
 *
 * §3.3 asks for exact behaviour at six sizes and adds one sentence that decides the whole approach:
 * *"The implementation must not merely shrink desktop UI."* §3.4 then names ten dense
 * representations and asks for four things about each — desktop primary, tablet fallback, mobile
 * fallback, **and an accessible alternative**.
 *
 * That fourth item is listed separately from the mobile fallback, and treating them as the same
 * thing is the mistake this module exists to prevent. A mobile fallback is what a small screen gets;
 * an accessible alternative is what somebody gets who cannot perceive the visual representation *at
 * any size*. A screen-reader user on a 27-inch monitor needs the alternative, and a design that ships
 * it only below 640px has not provided one.
 *
 * So the rule here is stronger than §3.4 strictly requires: **the accessible alternative is always in
 * the document**, and the visual representation is supplementary to it. That inverts the usual
 * arrangement, where a table is a degraded thing hidden behind a toggle, and it is the only
 * arrangement where the alternative cannot rot — because everybody is looking at it.
 *
 * Contract: gap-spec §3.3, §3.4, §3.5.
 */

/* -------------------------------------------------------------------------- */
/* Breakpoints                                                                */
/* -------------------------------------------------------------------------- */

/**
 * §3.3's six sizes.
 *
 * The widths are Tailwind's, because inventing a second set would mean every class in the codebase
 * is written against one scale and reasoned about against another.
 */
export const BREAKPOINTS = [
  'MOBILE',
  'SMALL_TABLET',
  'LARGE_TABLET',
  'LAPTOP',
  'DESKTOP',
  'WIDE_DESKTOP',
] as const;

export type Breakpoint = (typeof BREAKPOINTS)[number];

export interface BreakpointSpec {
  /** Inclusive lower bound in CSS pixels. */
  readonly from: number;
  /** Tailwind's prefix, or `null` for the base (unprefixed) layer. */
  readonly prefix: string | null;
  /** What changes at this size, stated as a decision rather than as a measurement. */
  readonly behaviour: string;
}

export const BREAKPOINT_SPEC: Readonly<Record<Breakpoint, BreakpointSpec>> = {
  MOBILE: {
    from: 0,
    prefix: null,
    /*
     * Base layer, not an override.
     *
     * Writing mobile as the default and enhancing upward is what stops the implementation being a
     * shrunk desktop: a layout that only exists as a set of overrides has a desktop shape underneath
     * it, and the overrides are where things break.
     */
    behaviour:
      'One column. Every control at least 44px. Nothing scrolls sideways. This is the base layer, not an override — the desktop is the enhancement.',
  },
  SMALL_TABLET: {
    from: 640,
    prefix: 'sm',
    behaviour:
      'Two columns where a pair of things are genuinely read together. Secondary navigation becomes visible.',
  },
  LARGE_TABLET: {
    from: 768,
    prefix: 'md',
    behaviour: 'Side-by-side comparison becomes possible: a list beside its detail.',
  },
  LAPTOP: {
    from: 1024,
    prefix: 'lg',
    behaviour:
      'Three columns where three things are compared. Dense representations become primary.',
  },
  DESKTOP: {
    from: 1280,
    prefix: 'xl',
    behaviour: 'Full dense representations, with no truncation of names or values.',
  },
  WIDE_DESKTOP: {
    from: 1536,
    prefix: '2xl',
    /*
     * Deliberately not "more columns".
     *
     * Line length is a readability constraint rather than a space constraint, and a paragraph
     * stretched across 1800px is harder to read than the same paragraph at 700px. Extra width becomes
     * margin.
     */
    behaviour:
      'Content stops widening and the extra space becomes margin. A paragraph across 1800px is harder to read than the same paragraph at 700px.',
  },
};

/** The breakpoint a width falls into. */
export function breakpointFor(width: number): Breakpoint {
  const ordered = [...BREAKPOINTS].reverse();

  for (const breakpoint of ordered) {
    if (width >= BREAKPOINT_SPEC[breakpoint].from) return breakpoint;
  }

  return 'MOBILE';
}

/* -------------------------------------------------------------------------- */
/* Dense representations                                                      */
/* -------------------------------------------------------------------------- */

/** §3.4's ten, in the order it names them. */
export const DENSE_REPRESENTATIONS = [
  'DEPENDENCY_GRAPH',
  'TRACEABILITY_GRAPH',
  'ARCHITECTURE_DIAGRAM',
  'TIMELINE',
  'CALENDAR',
  'WORK_BREAKDOWN',
  'BUDGET_TABLE',
  'RISK_REGISTER',
  'TEST_MATRIX',
  'AUDIT_LOG',
] as const;

export type DenseRepresentation = (typeof DENSE_REPRESENTATIONS)[number];

export interface DenseSpec {
  /** What a desktop shows. */
  readonly desktop: string;
  /** What a tablet shows instead. */
  readonly tablet: string;
  /** What a phone shows instead. */
  readonly mobile: string;
  /**
   * What somebody gets who cannot perceive the visual form, **at any size**.
   *
   * Listed separately from `mobile` by §3.4, and the separation is the point: a screen-reader user on
   * a large monitor needs this, and shipping it only below 640px means not shipping it.
   */
  readonly accessibleAlternative: string;
  /**
   * Whether the accessible alternative is in the document at every size.
   *
   * `true` for everything here. An alternative rendered only in some conditions is one that decays,
   * because nobody is looking at it — and it decays silently, since the people who would notice are
   * the people it was for.
   */
  readonly alwaysPresent: true;
}

export const DENSE_SPEC: Readonly<Record<DenseRepresentation, DenseSpec>> = {
  DEPENDENCY_GRAPH: {
    desktop: 'Node-and-edge diagram with the critical path emphasised.',
    tablet: 'The same diagram, pannable, with labels shortened rather than hidden.',
    mobile: 'An ordered list by dependency depth: what must happen before what.',
    accessibleAlternative:
      'The ordered list, with each item naming what it depends on. A graph is a set of statements about ordering, and the statements are the content — the picture is a convenience.',
    alwaysPresent: true,
  },
  TRACEABILITY_GRAPH: {
    desktop: 'One row per requirement with its chain rendered as a sequence of linked hops.',
    tablet: 'The same rows, hops wrapping rather than truncating.',
    mobile: 'The chain as a vertical list, one hop per line, each naming its status.',
    accessibleAlternative:
      'Each hop is text: the hop name, its status word, and why it is that status. Nothing is conveyed by position or colour alone.',
    alwaysPresent: true,
  },
  ARCHITECTURE_DIAGRAM: {
    desktop: 'Components grouped by layer, with dependency arrows.',
    tablet: 'Layers stacked vertically, arrows replaced by an explicit "depends on" line.',
    mobile: 'A list grouped by layer, each component naming what it depends on.',
    accessibleAlternative:
      'The grouped list. Layer membership and dependency direction are both stated in words, because both are the whole meaning of the diagram.',
    alwaysPresent: true,
  },
  TIMELINE: {
    desktop: 'Horizontal bars against a date axis.',
    tablet: 'The same bars over a shorter window, with a range control.',
    mobile: 'A chronological list with the range and any caveats on each entry.',
    accessibleAlternative:
      'The chronological list. A bar communicates start, end and overlap; all three are stated rather than drawn.',
    alwaysPresent: true,
  },
  CALENDAR: {
    desktop: 'A month grid.',
    tablet: 'A week grid.',
    mobile: 'An agenda: the next entries in order, with dates written out.',
    accessibleAlternative:
      'The agenda. A grid conveys date by position, which is exactly what a non-visual reading cannot recover.',
    alwaysPresent: true,
  },
  WORK_BREAKDOWN: {
    desktop: 'Columns by status, cards within.',
    tablet: 'Two columns with the rest reachable by scrolling within the region.',
    mobile: 'One list per status, stacked, each headed by its status and count.',
    accessibleAlternative:
      'The stacked lists. A card conveys status by which column it sits in, so on mobile and for assistive technology the status is written on the group instead.',
    alwaysPresent: true,
  },
  BUDGET_TABLE: {
    desktop: 'Rows of cost lines with columns for type, amount and range.',
    tablet: 'The same table, scrolling horizontally within its own region rather than the page.',
    mobile: 'One block per line, label above value, ranges written out in full.',
    accessibleAlternative:
      'The blocks, with every figure carrying its unit and currency inline. A column heading two hundred pixels away is not a label anybody hears.',
    alwaysPresent: true,
  },
  RISK_REGISTER: {
    desktop: 'A table sorted by impact, with likelihood and mitigation columns.',
    tablet: 'The same table with mitigation moved to a second line.',
    mobile: 'One block per risk, impact and likelihood written as words rather than plotted.',
    accessibleAlternative:
      'The blocks. Impact and likelihood are words, never a position on a matrix — a two-by-two grid is meaningless without sight of it.',
    alwaysPresent: true,
  },
  TEST_MATRIX: {
    desktop: 'Requirements against test categories, cells showing outcome.',
    tablet: 'One requirement per row, categories wrapping.',
    mobile: 'One block per requirement listing each category and its outcome.',
    accessibleAlternative:
      'The blocks. A matrix cell means nothing without both its headings, and neither heading is adjacent to it in reading order.',
    alwaysPresent: true,
  },
  AUDIT_LOG: {
    desktop: 'A dense table, newest first, with columns for actor, action and subject.',
    tablet: 'The same table with the payload collapsed.',
    mobile: 'One block per event: what happened, who did it, when, in that order.',
    accessibleAlternative:
      'The blocks, in sequence order. The sequence is the content of an audit log, so it is never re-ordered for presentation.',
    alwaysPresent: true,
  },
};

/* -------------------------------------------------------------------------- */
/* Touch targets                                                              */
/* -------------------------------------------------------------------------- */

/**
 * WCAG 2.2 §2.5.8 sets a 24px minimum. This uses 44px.
 *
 * The larger figure is not gold-plating: 24px is the level below which a target is a *failure*, and
 * designing to a failure threshold means every rounding error is a defect. 44px is roughly the pad of
 * an adult finger, which is the actual constraint the criterion is approximating.
 */
export const MIN_TOUCH_TARGET_PX = 44;

/* -------------------------------------------------------------------------- */
/* Checks                                                                     */
/* -------------------------------------------------------------------------- */

export const RESPONSIVE_DEFECTS = [
  'NO_ACCESSIBLE_ALTERNATIVE',
  'ALTERNATIVE_ONLY_ON_MOBILE',
  'MOBILE_IS_A_SHRUNK_DESKTOP',
  'BREAKPOINT_GAP',
] as const;

export type ResponsiveDefect = (typeof RESPONSIVE_DEFECTS)[number];

export interface ResponsiveFinding {
  readonly defect: ResponsiveDefect;
  readonly subject: string;
  readonly summary: string;
  readonly why: string;
}

/**
 * Whether the contract itself is coherent.
 *
 * Checked as a test rather than at runtime: these are defects in what was decided, not in what a user
 * did, and the point is that weakening the contract fails the build.
 */
export function checkContract(): readonly ResponsiveFinding[] {
  const findings: ResponsiveFinding[] = [];

  for (const key of DENSE_REPRESENTATIONS) {
    const spec = DENSE_SPEC[key];

    if (spec.accessibleAlternative.trim() === '') {
      findings.push({
        defect: 'NO_ACCESSIBLE_ALTERNATIVE',
        subject: key,
        summary: 'No accessible alternative defined.',
        why: '§3.4 asks for one separately from the mobile fallback. Without it the representation is unusable by anybody who cannot perceive its visual form.',
      });
    }

    if (spec.accessibleAlternative === spec.mobile) {
      /*
       * The mistake this module exists to prevent.
       *
       * A mobile fallback and an accessible alternative are different answers to different questions.
       * When they are written as the same sentence, the alternative gets implemented as a
       * breakpoint — and a screen-reader user on a large monitor gets nothing.
       */
      findings.push({
        defect: 'ALTERNATIVE_ONLY_ON_MOBILE',
        subject: key,
        summary: 'The accessible alternative is stated as identical to the mobile fallback.',
        why: 'They answer different questions. One is what a small screen gets; the other is what somebody gets who cannot perceive the visual form at any size. Writing them as the same thing is how the alternative ends up behind a media query.',
      });
    }
  }

  const widths = BREAKPOINTS.map((b) => BREAKPOINT_SPEC[b].from);

  for (let i = 1; i < widths.length; i += 1) {
    if ((widths[i] ?? 0) <= (widths[i - 1] ?? 0)) {
      findings.push({
        defect: 'BREAKPOINT_GAP',
        subject: BREAKPOINTS[i] ?? 'unknown',
        summary: 'Breakpoints are not strictly increasing.',
        why: 'Two breakpoints that overlap or invert mean some widths match twice and others match nothing, and which one wins depends on source order rather than on a decision.',
      });
    }
  }

  if (BREAKPOINT_SPEC.MOBILE.prefix !== null) {
    findings.push({
      defect: 'MOBILE_IS_A_SHRUNK_DESKTOP',
      subject: 'MOBILE',
      summary: 'Mobile is expressed as an override rather than as the base layer.',
      why: '§3.3: "must not merely shrink desktop UI". A layout that exists only as a set of overrides has a desktop shape underneath it, and the overrides are where it breaks.',
    });
  }

  return findings;
}
