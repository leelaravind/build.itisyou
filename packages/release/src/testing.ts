/**
 * Tests, test evidence, and the exceptions people accept against them.
 *
 * The Testing Gate (§15.6) asks four things: the required categories ran, there are no critical
 * failures, accepted exceptions are documented, and requirement verification coverage meets policy.
 *
 * Three of those are straightforward. The fourth — "accepted exceptions documented" — is where the
 * gate actually lives or dies, because an exception is the mechanism by which a gate stops meaning
 * anything. One exception is a judgement call. Fifteen undated exceptions with no owner is a gate
 * that passes every time and tells you nothing, and it gets there one reasonable decision at a time.
 *
 * So an exception here needs a reason, an owner, and an expiry, and the gate result reports how many
 * it is resting on rather than absorbing them into a pass.
 *
 * Contract: gap-spec §15.6, §32 (evidence).
 */

import type { TwinGraph } from '@govintel/twin/graph';
import type { TwinNode } from '@govintel/twin/nodes';

/* -------------------------------------------------------------------------- */
/* Categories                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Test categories, each with what it can and cannot tell you.
 *
 * The `cannotShow` field is the useful half. A project with a green unit suite and no integration
 * tests has demonstrated that its functions behave as their authors expected, which is a much
 * narrower claim than "it works" — and the gap between those two claims is where most production
 * incidents live.
 */
export const TEST_CATEGORIES = [
  'UNIT',
  'INTEGRATION',
  'END_TO_END',
  'CONTRACT',
  'SECURITY',
  'ACCESSIBILITY',
  'PERFORMANCE',
  'MIGRATION',
  'DISASTER_RECOVERY',
] as const;

export type TestCategory = (typeof TEST_CATEGORIES)[number];

export interface CategoryMeaning {
  readonly shows: string;
  readonly cannotShow: string;
}

export const CATEGORY_MEANING: Readonly<Record<TestCategory, CategoryMeaning>> = {
  UNIT: {
    shows: 'Individual pieces behave as their author expected.',
    cannotShow:
      'That the pieces fit together, or that the author’s expectation matched the requirement.',
  },
  INTEGRATION: {
    shows: 'Components agree with each other and with the database.',
    cannotShow: 'That a real user can complete anything.',
  },
  END_TO_END: {
    shows: 'A user journey completes through the real stack.',
    cannotShow: 'That it still works under load, or for a second tenant.',
  },
  CONTRACT: {
    shows: 'An interface still matches what its consumers were promised.',
    cannotShow: 'That the behaviour behind the interface is correct.',
  },
  SECURITY: {
    shows: 'Specific attacks were attempted and did not succeed.',
    cannotShow:
      'That no other attack succeeds. A security suite is evidence about what was tried, never about what exists.',
  },
  ACCESSIBILITY: {
    shows: 'Automated checks found no violations, and named journeys are operable by keyboard.',
    cannotShow:
      'That the product is usable with a screen reader. Roughly a third of WCAG cannot be checked automatically, and reporting a clean scan as compliance is the most common accessibility lie.',
  },
  PERFORMANCE: {
    shows: 'Measured response under a stated load and dataset.',
    cannotShow: 'Behaviour under a load or dataset nobody measured.',
  },
  MIGRATION: {
    shows: 'The migration ran forward against representative data.',
    cannotShow: 'That it can be reversed, unless the reversal was also run.',
  },
  DISASTER_RECOVERY: {
    shows: 'A restore was performed and timed.',
    cannotShow:
      'That the same restore works at production scale, unless it was done at that scale.',
  },
};

/* -------------------------------------------------------------------------- */
/* Outcomes                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Test outcomes.
 *
 * `NOT_RUN` and `SKIPPED` are different and both are retained. A test nobody has run yet is an
 * unfinished task; a test somebody deliberately turned off is a decision, and it needs a reason.
 * Collapsing them loses the distinction between "not yet" and "we chose not to", which is exactly the
 * distinction a release decision turns on.
 */
export const TEST_OUTCOMES = ['PASSED', 'FAILED', 'SKIPPED', 'NOT_RUN', 'ERRORED'] as const;

export type TestOutcome = (typeof TEST_OUTCOMES)[number];

export const SEVERITIES = ['CRITICAL', 'MAJOR', 'MINOR'] as const;

export type Severity = (typeof SEVERITIES)[number];

export interface TestRecord {
  readonly id: string;
  readonly label: string;
  readonly category: TestCategory;
  readonly outcome: TestOutcome;
  readonly severity: Severity;
  /** Requirement ids this test verifies. Empty means it contributes nothing to the release argument. */
  readonly verifies: readonly string[];
  /** Evidence node ids. A passing test with nothing kept is a claim about a moment nobody recorded. */
  readonly evidence: readonly string[];
  /** Required on `SKIPPED`. Checked. */
  readonly skipReason?: string;
}

/* -------------------------------------------------------------------------- */
/* Exceptions                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A documented decision to release despite something being wrong.
 *
 * Every field here exists because of a way exceptions go bad:
 *
 * - `reason` — an unexplained exception is indistinguishable from an oversight.
 * - `acceptedBy` — an exception nobody owns is one nobody will revisit.
 * - `expiresOn` — the mechanism that stops the set growing forever. An exception with no expiry is a
 *   permanent change to the standard, made without saying so.
 * - `subjectId` — what it is an exception *to*. Without it the exception cannot be matched against
 *   the thing it excuses, and it silently excuses everything.
 */
export interface Exception {
  readonly id: string;
  readonly subjectId: string;
  readonly reason: string;
  readonly acceptedBy: string;
  /** ISO date. Compared against the caller's `asOf`; never against a clock read here. */
  readonly expiresOn: string;
}

export const EXCEPTION_DEFECTS = [
  'EXCEPTION_WITHOUT_REASON',
  'EXCEPTION_WITHOUT_OWNER',
  'EXCEPTION_EXPIRED',
  'EXCEPTION_FOR_NOTHING',
] as const;

export type ExceptionDefect = (typeof EXCEPTION_DEFECTS)[number];

export interface ExceptionFinding {
  readonly defect: ExceptionDefect;
  readonly exceptionId: string;
  readonly summary: string;
  readonly why: string;
}

/**
 * Check the exceptions themselves.
 *
 * An expired exception is reported rather than silently ignored. Ignoring it would re-block the gate
 * with no explanation, and whoever accepted it would have no way to tell that their decision had
 * lapsed rather than been reversed.
 */
export function checkExceptions(
  exceptions: readonly Exception[],
  subjectIds: ReadonlySet<string>,
  asOf: string,
): readonly ExceptionFinding[] {
  const findings: ExceptionFinding[] = [];

  for (const exception of exceptions) {
    if (exception.reason.trim() === '') {
      findings.push({
        defect: 'EXCEPTION_WITHOUT_REASON',
        exceptionId: exception.id,
        summary: 'No reason is recorded.',
        why: 'An unexplained exception is indistinguishable from an oversight, and nobody reviewing it later can tell whether the judgement still holds.',
      });
    }

    if (exception.acceptedBy.trim() === '') {
      findings.push({
        defect: 'EXCEPTION_WITHOUT_OWNER',
        exceptionId: exception.id,
        summary: 'Nobody is recorded as having accepted it.',
        why: 'An exception nobody owns is one nobody will revisit. Accepting risk is a decision, and decisions have names attached.',
      });
    }

    if (exception.expiresOn < asOf) {
      findings.push({
        defect: 'EXCEPTION_EXPIRED',
        exceptionId: exception.id,
        summary: `Expired on ${exception.expiresOn}.`,
        why: 'Reported rather than silently dropped: dropping it would re-block the gate with no explanation, and whoever accepted it could not tell their decision had lapsed rather than been reversed.',
      });
    }

    if (!subjectIds.has(exception.subjectId)) {
      findings.push({
        defect: 'EXCEPTION_FOR_NOTHING',
        exceptionId: exception.id,
        summary: `Excuses ${exception.subjectId}, which is not among the things being checked.`,
        why: 'An exception that matches nothing cannot be reasoned about. It may be stale, or it may be a typo that is quietly excusing nothing while somebody believes it is.',
      });
    }
  }

  return findings;
}

/** Whether an exception is usable as of a date. Expired and malformed ones are not. */
export function isLive(exception: Exception, asOf: string): boolean {
  return (
    exception.reason.trim() !== '' &&
    exception.acceptedBy.trim() !== '' &&
    exception.expiresOn >= asOf
  );
}

/* -------------------------------------------------------------------------- */
/* Coverage policy                                                            */
/* -------------------------------------------------------------------------- */

/**
 * What "coverage meets policy" means here.
 *
 * Deliberately **not** a line-coverage percentage. Line coverage measures which lines a test suite
 * happened to execute, which is a proxy for a proxy: a suite can execute every line and assert
 * nothing. Worse, it is trivially optimisable, and once it is a target somebody will optimise it.
 *
 * What matters for a release argument is whether each *requirement* has a passing test attached, and
 * that is countable exactly, per requirement, with names.
 */
export interface CoverageResult {
  /** Requirement ids with at least one passing test. */
  readonly verified: readonly string[];
  /** Requirement ids whose tests exist but have not passed. */
  readonly attempted: readonly string[];
  /** Requirement ids no test names at all. */
  readonly unverified: readonly string[];
}

export function coverage(
  requirementIds: readonly string[],
  tests: readonly TestRecord[],
): CoverageResult {
  const verified: string[] = [];
  const attempted: string[] = [];
  const unverified: string[] = [];

  for (const requirementId of requirementIds) {
    const relevant = tests.filter((test) => test.verifies.includes(requirementId));

    if (relevant.length === 0) {
      unverified.push(requirementId);
    } else if (relevant.some((test) => test.outcome === 'PASSED')) {
      verified.push(requirementId);
    } else {
      // Tests exist and none has passed. Distinct from having no tests: the work has been done and
      // the result is bad, which needs a different response from nobody having started.
      attempted.push(requirementId);
    }
  }

  return { verified, attempted, unverified };
}

/* -------------------------------------------------------------------------- */
/* Test findings                                                              */
/* -------------------------------------------------------------------------- */

export const TEST_DEFECTS = [
  'CRITICAL_FAILURE',
  'SKIPPED_WITHOUT_REASON',
  'CATEGORY_NOT_RUN',
  'PASSING_TEST_WITHOUT_EVIDENCE',
  'TEST_VERIFIES_NOTHING',
] as const;

export type TestDefect = (typeof TEST_DEFECTS)[number];

export interface TestFinding {
  readonly defect: TestDefect;
  readonly summary: string;
  readonly why: string;
  readonly evidence: readonly string[];
  readonly blocking: boolean;
  /** Set when a live exception covers this. The finding is still reported. */
  readonly exceptedBy?: string;
}

export interface TestingInput {
  readonly tests: readonly TestRecord[];
  /** Categories this project must run, decided by its type and rules rather than by this module. */
  readonly requiredCategories: readonly TestCategory[];
  readonly requirementIds: readonly string[];
  readonly exceptions: readonly Exception[];
  /** ISO date supplied by the caller. Never read from a clock: that would break determinism. */
  readonly asOf: string;
}

/**
 * Everything wrong with the test position, with exceptions applied but never hidden.
 *
 * An excepted finding is still in the list, marked. Removing it would make the gate's output
 * identical whether a problem was fixed or excused, which is the single most important distinction
 * the gate carries.
 */
export function checkTesting(input: TestingInput): readonly TestFinding[] {
  const findings: TestFinding[] = [];
  const live = input.exceptions.filter((e) => isLive(e, input.asOf));
  const exceptionFor = (subjectId: string): string | undefined =>
    live.find((e) => e.subjectId === subjectId)?.id;

  const push = (
    defect: TestDefect,
    subjectId: string,
    summary: string,
    why: string,
    evidence: readonly string[],
    blocking: boolean,
  ): void => {
    const excepted = exceptionFor(subjectId);
    findings.push({
      defect,
      summary,
      why,
      evidence,
      // An excepted finding does not block, but it is still reported. If excusing a problem and
      // fixing it produced the same output, nobody could tell them apart at review.
      blocking: blocking && excepted === undefined,
      ...(excepted === undefined ? {} : { exceptedBy: excepted }),
    });
  };

  for (const test of input.tests) {
    if ((test.outcome === 'FAILED' || test.outcome === 'ERRORED') && test.severity === 'CRITICAL') {
      push(
        'CRITICAL_FAILURE',
        test.id,
        `${test.label} ${test.outcome === 'ERRORED' ? 'errored' : 'failed'}.`,
        'A critical test failing is the clearest possible statement that the release is not ready. An errored test counts the same: nobody knows whether it would have passed.',
        [test.id],
        true,
      );
    }

    if (test.outcome === 'SKIPPED' && (test.skipReason ?? '').trim() === '') {
      push(
        'SKIPPED_WITHOUT_REASON',
        test.id,
        `${test.label} is skipped with no reason recorded.`,
        'A skip with no reason is indistinguishable from a test somebody disabled to make the suite green. The reason is what makes it reviewable.',
        [test.id],
        test.severity === 'CRITICAL',
      );
    }

    if (test.outcome === 'PASSED' && test.evidence.length === 0) {
      push(
        'PASSING_TEST_WITHOUT_EVIDENCE',
        test.id,
        `${test.label} passed but kept nothing.`,
        'A pass with no artefact is a claim about a moment nobody recorded. §32 exists because "it passed when I ran it" is not something a third party can check.',
        [test.id],
        false,
      );
    }

    if (test.verifies.length === 0) {
      push(
        'TEST_VERIFIES_NOTHING',
        test.id,
        `${test.label} names no requirement.`,
        'It contributes nothing to the release argument. If it fails, nobody can judge how much that matters.',
        [test.id],
        false,
      );
    }
  }

  const ran = new Set(input.tests.filter((t) => t.outcome !== 'NOT_RUN').map((t) => t.category));

  for (const category of input.requiredCategories) {
    if (ran.has(category)) continue;

    push(
      'CATEGORY_NOT_RUN',
      `category:${category}`,
      `No ${category.toLowerCase().replace(/_/g, ' ')} test has run.`,
      CATEGORY_MEANING[category].cannotShow,
      [`category:${category}`],
      true,
    );
  }

  return findings;
}

/* -------------------------------------------------------------------------- */
/* Reading tests out of the twin                                              */
/* -------------------------------------------------------------------------- */

export function testFromNode(node: TwinNode): TestRecord | undefined {
  if (node.class !== 'TEST') return undefined;

  const category = node.attributes.category;
  const outcome = node.attributes.outcome;

  if (!isCategory(category) || !isOutcome(outcome)) return undefined;

  const severity = node.attributes.severity;
  const skipReason = node.attributes.skipReason;

  return {
    id: node.id,
    label: node.label,
    category,
    outcome,
    // MAJOR rather than MINOR where unstated: an unclassified test that fails should interrupt
    // somebody. Defaulting to MINOR would make forgetting to classify the safest option.
    severity: isSeverity(severity) ? severity : 'MAJOR',
    verifies: [],
    evidence: [],
    ...(typeof skipReason === 'string' ? { skipReason } : {}),
  };
}

/** Test records for a graph, with `verifies` and `evidence` filled in from its edges. */
export function testsFromGraph(graph: TwinGraph): readonly TestRecord[] {
  const out: TestRecord[] = [];

  for (const node of graph.nodesOfClass('TEST')) {
    const record = testFromNode(node);
    if (record === undefined) continue;

    out.push({
      ...record,
      verifies: graph
        .edgesFrom(node.id, 'VERIFIES')
        .filter((edge) => graph.node(edge.to)?.class === 'REQUIREMENT')
        .map((edge) => edge.to),
      evidence: graph
        .edgesFrom(node.id, 'EVIDENCED_BY')
        .filter((edge) => graph.node(edge.to)?.class === 'EVIDENCE')
        .map((edge) => edge.to),
    });
  }

  return out;
}

function isCategory(value: unknown): value is TestCategory {
  return typeof value === 'string' && (TEST_CATEGORIES as readonly string[]).includes(value);
}

function isOutcome(value: unknown): value is TestOutcome {
  return typeof value === 'string' && (TEST_OUTCOMES as readonly string[]).includes(value);
}

function isSeverity(value: unknown): value is Severity {
  return typeof value === 'string' && (SEVERITIES as readonly string[]).includes(value);
}
