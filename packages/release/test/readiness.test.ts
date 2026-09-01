import { describe, expect, it } from 'vitest';
import { TwinGraph } from '@govintel/twin/graph';
import { createNode, type NodeClass, type TwinNode } from '@govintel/twin/nodes';
import type { EdgeClass, TwinEdge } from '@govintel/twin/edges';
import {
  CATEGORY_MEANING,
  TEST_CATEGORIES,
  TEST_OUTCOMES,
  checkExceptions,
  checkTesting,
  coverage,
  isLive,
  testsFromGraph,
  type Exception,
  type TestRecord,
} from '../src/testing.ts';
import {
  FINDING_STATES,
  THREATS,
  blocksRelease,
  checkSecurity,
  checkThreatModel,
  isOutstanding,
  type SecurityFinding,
} from '../src/security.ts';
import {
  CHECK_RESULTS,
  ENVIRONMENTS,
  PRODUCTION_CHECKS,
  checkDeployment,
  mayPromoteTo,
  type ProductionCheckRecord,
} from '../src/deployment.ts';
import { OWNERSHIP_AREAS, checkOperations, type Ownership } from '../src/operations.ts';
import {
  GATE_PREREQUISITE,
  RELEASE_GATES,
  evaluateReadiness,
  type ReadinessInput,
} from '../src/readiness.ts';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const AT = '2026-01-01T00:00:00.000Z';
const TODAY = '2026-01-01';
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
    provenance: { provenance: 'DETERMINISTIC_CALCULATION', confidence: 'HIGH' },
    attributes,
    at: AT,
  });
}

function edge(from: string, to: string, edgeClass: EdgeClass): TwinEdge {
  return {
    id: `${from}:${edgeClass}:${to}`,
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

function test_(overrides: Partial<TestRecord> = {}): TestRecord {
  return {
    id: 't1',
    label: 'Appointments can be recorded',
    category: 'END_TO_END',
    outcome: 'PASSED',
    severity: 'CRITICAL',
    verifies: ['r1'],
    evidence: ['e1'],
    ...overrides,
  };
}

function exception(overrides: Partial<Exception> = {}): Exception {
  return {
    id: 'x1',
    subjectId: 't1',
    reason: 'The upstream fixture is unavailable until the vendor restores it.',
    acceptedBy: 'A. Patel, engineering lead',
    expiresOn: '2026-03-01',
    ...overrides,
  };
}

function finding(overrides: Partial<SecurityFinding> = {}): SecurityFinding {
  return {
    id: 'f1',
    title: 'Session cookie missing SameSite',
    severity: 'HIGH',
    state: 'RESOLVED',
    source: 'CODE_REVIEW',
    threats: ['replay'],
    decidedBy: 'A. Patel',
    evidence: ['e2'],
    ...overrides,
  };
}

/** Every production check passed, with evidence. The state the last gate is supposed to require. */
function allChecksPassed(): readonly ProductionCheckRecord[] {
  return PRODUCTION_CHECKS.map((check) => ({
    check,
    result: 'PASSED' as const,
    checkedBy: 'A. Patel',
    checkedAt: AT,
    evidence: [`evidence:${check}`],
  }));
}

function ownership(): readonly Ownership[] {
  return OWNERSHIP_AREAS.map((area) => ({ area, owner: 'A. Patel', accepted: true }));
}

/**
 * A project that can be released.
 *
 * Built once and broken per test, so each test differs from a passing release in exactly the one
 * respect it names. Assembling each case by hand produces tests that pass for unrelated reasons.
 */
function readyInput(overrides: Partial<ReadinessInput> = {}): ReadinessInput {
  const graph = graphOf(
    [
      node('proj', 'PROJECT'),
      node('r1', 'REQUIREMENT', {
        kind: 'FUNCTIONAL',
        priority: 'MUST',
        verification: ['TEST'],
        acceptance: [{ id: 'a1', statement: 'It works.' }],
        sourceRef: 'intake:capabilities',
      }),
      node('task1', 'TASK'),
      node('test1', 'TEST', { category: 'END_TO_END', outcome: 'PASSED', attests: [] }),
      node('ev1', 'EVIDENCE', { hash: 'sha256:abc' }),
    ],
    [
      edge('task1', 'r1', 'IMPLEMENTS'),
      edge('test1', 'r1', 'VERIFIES'),
      edge('test1', 'ev1', 'EVIDENCED_BY'),
    ],
  );

  return {
    graph,
    tests: [test_({ id: 'test1', verifies: ['r1'] })],
    requiredCategories: ['END_TO_END'],
    findings: [finding()],
    plans: [
      { kind: 'DEPLOYMENT', documentId: 'd1', rehearsed: true },
      { kind: 'ROLLBACK', documentId: 'd2', rehearsed: true },
    ],
    requiredPlans: ['DEPLOYMENT', 'ROLLBACK'],
    productionChecks: allChecksPassed(),
    approvals: ['ap1'],
    target: 'PRODUCTION',
    alreadyDeployedTo: ['LOCAL', 'CI', 'PREVIEW', 'STAGING'],
    ownership: ownership(),
    incidents: [],
    debt: [
      {
        id: 'debt1',
        kind: 'MISSING_TEST',
        summary: 'No load test for the appointment search',
        consequence: 'Nobody knows how it behaves above a few hundred concurrent users.',
        disclosed: true,
      },
    ],
    exceptions: [],
    asOf: TODAY,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* Testing gate                                                               */
/* -------------------------------------------------------------------------- */

describe('gap-spec §15.6: the testing gate', () => {
  it('names what each category cannot show, not only what it does', () => {
    /*
     * The half that makes the category list useful. A green unit suite demonstrates that functions
     * behave as their authors expected, which is a much narrower claim than "it works" — and the gap
     * between the two is where most production incidents live.
     */
    for (const category of TEST_CATEGORIES) {
      expect(CATEGORY_MEANING[category].cannotShow.length, category).toBeGreaterThan(20);
    }
  });

  it('says a clean accessibility scan is not accessibility compliance', () => {
    // The most common accessibility lie, and stating it is the only defence against a tool that
    // reports a passing scan as conformance.
    expect(CATEGORY_MEANING.ACCESSIBILITY.cannotShow).toMatch(/screen reader|cannot be checked/i);
  });

  it('blocks on a critical failure', () => {
    const findings = checkTesting({
      tests: [test_({ outcome: 'FAILED' })],
      requiredCategories: [],
      requirementIds: [],
      exceptions: [],
      asOf: TODAY,
    });

    expect(findings.find((f) => f.defect === 'CRITICAL_FAILURE')?.blocking).toBe(true);
  });

  it('treats an errored critical test the same as a failed one', () => {
    // Nobody knows whether it would have passed, and "we do not know" is not a reason to proceed.
    const findings = checkTesting({
      tests: [test_({ outcome: 'ERRORED' })],
      requiredCategories: [],
      requirementIds: [],
      exceptions: [],
      asOf: TODAY,
    });

    expect(findings.map((f) => f.defect)).toContain('CRITICAL_FAILURE');
  });

  it('keeps NOT_RUN and SKIPPED as different outcomes', () => {
    /*
     * "Not yet" and "we chose not to" are the distinction a release decision turns on. Collapsing
     * them would let a deliberately disabled test read as an unfinished one.
     */
    expect(TEST_OUTCOMES).toContain('NOT_RUN');
    expect(TEST_OUTCOMES).toContain('SKIPPED');
  });

  it('reports a skip with no reason', () => {
    const findings = checkTesting({
      tests: [test_({ outcome: 'SKIPPED' })],
      requiredCategories: [],
      requirementIds: [],
      exceptions: [],
      asOf: TODAY,
    });

    expect(findings.map((f) => f.defect)).toContain('SKIPPED_WITHOUT_REASON');
  });

  it('accepts a skip that records why', () => {
    const findings = checkTesting({
      tests: [test_({ outcome: 'SKIPPED', skipReason: 'The vendor sandbox is down until March.' })],
      requiredCategories: [],
      requirementIds: [],
      exceptions: [],
      asOf: TODAY,
    });

    expect(findings.map((f) => f.defect)).not.toContain('SKIPPED_WITHOUT_REASON');
  });

  it('reports a required category nobody ran, explaining what that leaves unknown', () => {
    const findings = checkTesting({
      tests: [test_({ category: 'UNIT' })],
      requiredCategories: ['SECURITY'],
      requirementIds: [],
      exceptions: [],
      asOf: TODAY,
    });

    const missing = findings.find((f) => f.defect === 'CATEGORY_NOT_RUN');

    expect(missing?.blocking).toBe(true);
    // The `why` is the category's own `cannotShow`, so the message says what the absence costs
    // rather than restating the rule.
    expect(missing?.why).toBe(CATEGORY_MEANING.SECURITY.cannotShow);
  });

  it('measures coverage per requirement, never as a proportion', () => {
    /*
     * Deliberately not line coverage. A suite can execute every line and assert nothing, and once a
     * percentage is a target somebody optimises it. Named requirements can be acted on.
     */
    const result = coverage(
      ['r1', 'r2', 'r3'],
      [test_({ verifies: ['r1'] }), test_({ id: 't2', outcome: 'FAILED', verifies: ['r2'] })],
    );

    expect(result.verified).toEqual(['r1']);
    expect(result.attempted).toEqual(['r2']);
    expect(result.unverified).toEqual(['r3']);
  });

  it('distinguishes a requirement whose tests failed from one with no tests', () => {
    // Different responses: one needs a bug fixed, the other needs a test written. Reporting them
    // identically sends the reader to do the wrong work.
    const result = coverage(['r1'], [test_({ outcome: 'FAILED' })]);

    expect(result.attempted).toEqual(['r1']);
    expect(result.unverified).toEqual([]);
  });
});

describe('exceptions are the mechanism by which a gate stops meaning anything', () => {
  it('reports an exception with no reason', () => {
    const findings = checkExceptions([exception({ reason: '  ' })], new Set(['t1']), TODAY);
    expect(findings.map((f) => f.defect)).toContain('EXCEPTION_WITHOUT_REASON');
  });

  it('reports an exception nobody owns', () => {
    // An exception nobody owns is one nobody will revisit. Accepting risk is a decision, and
    // decisions have names attached.
    const findings = checkExceptions([exception({ acceptedBy: '' })], new Set(['t1']), TODAY);
    expect(findings.map((f) => f.defect)).toContain('EXCEPTION_WITHOUT_OWNER');
  });

  it('reports an expired exception rather than silently dropping it', () => {
    /*
     * Dropping it would re-block the gate with no explanation, and whoever accepted it could not
     * tell whether their decision had lapsed or been reversed.
     */
    const findings = checkExceptions(
      [exception({ expiresOn: '2025-12-01' })],
      new Set(['t1']),
      TODAY,
    );

    expect(findings.map((f) => f.defect)).toContain('EXCEPTION_EXPIRED');
  });

  it('reports an exception that excuses nothing', () => {
    // It may be stale, or a typo excusing nothing while somebody believes it is doing its job.
    const findings = checkExceptions([exception({ subjectId: 'nope' })], new Set(['t1']), TODAY);
    expect(findings.map((f) => f.defect)).toContain('EXCEPTION_FOR_NOTHING');
  });

  it('treats an expired exception as not live', () => {
    expect(isLive(exception({ expiresOn: '2025-12-01' }), TODAY)).toBe(false);
    expect(isLive(exception(), TODAY)).toBe(true);
  });

  it('stops a live exception blocking, while still reporting the finding', () => {
    /*
     * The single most important property in this module. If excusing a problem and fixing it
     * produced identical output, nobody at review could tell them apart — which is exactly how a
     * gate becomes a formality.
     */
    const findings = checkTesting({
      tests: [test_({ outcome: 'FAILED' })],
      requiredCategories: [],
      requirementIds: [],
      exceptions: [exception()],
      asOf: TODAY,
    });

    const critical = findings.find((f) => f.defect === 'CRITICAL_FAILURE');

    expect(critical).toBeDefined();
    expect(critical?.blocking).toBe(false);
    expect(critical?.exceptedBy).toBe('x1');
  });

  it('does not let an expired exception excuse anything', () => {
    const findings = checkTesting({
      tests: [test_({ outcome: 'FAILED' })],
      requiredCategories: [],
      requirementIds: [],
      exceptions: [exception({ expiresOn: '2025-12-01' })],
      asOf: TODAY,
    });

    expect(findings.find((f) => f.defect === 'CRITICAL_FAILURE')?.blocking).toBe(true);
  });
});

describe('reading tests out of the twin', () => {
  it('fills verifies and evidence from the graph rather than from attributes', () => {
    const graph = graphOf(
      [
        node('r1', 'REQUIREMENT'),
        node('t1', 'TEST', { category: 'UNIT', outcome: 'PASSED' }),
        node('e1', 'EVIDENCE', { hash: 'x' }),
      ],
      [edge('t1', 'r1', 'VERIFIES'), edge('t1', 'e1', 'EVIDENCED_BY')],
    );

    const [record] = testsFromGraph(graph);

    expect(record?.verifies).toEqual(['r1']);
    expect(record?.evidence).toEqual(['e1']);
  });

  it('treats an unclassified test as major rather than minor', () => {
    /*
     * Defaulting to MINOR would make forgetting to classify the safest option, which is the wrong
     * incentive: an unclassified test that fails should interrupt somebody.
     */
    const [record] = testsFromGraph(
      graphOf([node('t1', 'TEST', { category: 'UNIT', outcome: 'PASSED' })]),
    );

    expect(record?.severity).toBe('MAJOR');
  });
});

/* -------------------------------------------------------------------------- */
/* Security gate                                                              */
/* -------------------------------------------------------------------------- */

describe('gap-spec §15.7 and §34: security', () => {
  it('covers every threat §34 names', () => {
    // Checked as a count against the contract rather than by reading: the spec lists nineteen, and a
    // threat model that silently loses one is worse than one that never had it.
    expect(THREATS).toHaveLength(19);
    expect(new Set(THREATS.map((t) => t.key)).size).toBe(19);
  });

  it('states a residual risk for every threat', () => {
    // A threat model claiming complete coverage is the least believable kind, and the residual is
    // the part a reader can argue with.
    for (const threat of THREATS) {
      expect(threat.residualRisk.length, threat.key).toBeGreaterThan(30);
      expect(threat.mitigations.length, threat.key).toBeGreaterThan(0);
    }
  });

  it('reports threats whose mitigation is believed rather than demonstrated', () => {
    /*
     * Not blocking — several are mitigated by a feature not existing yet, and there is nothing to
     * verify. What matters is that the list is visible rather than reading as coverage.
     */
    const gaps = checkThreatModel();

    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps.every((g) => !g.blocking)).toBe(true);
    expect(gaps[0]?.why).toMatch(/residual risk/i);
  });

  it('blocks on an open high or critical finding', () => {
    expect(blocksRelease('CRITICAL')).toBe(true);
    expect(blocksRelease('HIGH')).toBe(true);
    expect(blocksRelease('MEDIUM')).toBe(false);

    const gaps = checkSecurity([finding({ state: 'OPEN' })]);
    expect(gaps.find((g) => g.defect === 'BLOCKING_FINDING_OPEN')?.blocking).toBe(true);
  });

  it('treats in-progress as outstanding, not as handled', () => {
    // "In progress" at a release gate is a decision made by omission.
    expect(isOutstanding(finding({ state: 'IN_PROGRESS' }))).toBe(true);
    expect(isOutstanding(finding({ state: 'ACCEPTED' }))).toBe(false);
  });

  it('keeps accepted and false-positive as different states', () => {
    /*
     * "It is real and we are shipping anyway" and "we looked and it is not real" are different
     * claims that age differently. Only one needs revisiting when the system changes around it.
     */
    expect(FINDING_STATES).toContain('ACCEPTED');
    expect(FINDING_STATES).toContain('FALSE_POSITIVE');
  });

  it('refuses an acceptance with no rationale', () => {
    const gaps = checkSecurity([finding({ state: 'ACCEPTED' })]);

    const gap = gaps.find((g) => g.defect === 'ACCEPTED_WITHOUT_RATIONALE');

    expect(gap?.blocking).toBe(true);
    expect(gap?.why).toMatch(/the same button/i);
  });

  it('reports a state change nobody made', () => {
    const gaps = checkSecurity([finding({ state: 'RESOLVED', decidedBy: '' })]);
    expect(gaps.map((g) => g.defect)).toContain('DECIDED_BY_NOBODY');
  });

  it('reports a resolution with nothing kept', () => {
    const gaps = checkSecurity([finding({ state: 'RESOLVED', evidence: [] })]);
    expect(gaps.map((g) => g.defect)).toContain('RESOLVED_WITHOUT_EVIDENCE');
  });

  it('reports a finding referencing a threat that is not in the model', () => {
    // A dangling reference quietly reads as coverage, and it is equally likely to be a real gap in
    // the model or a typo.
    const gaps = checkSecurity([finding({ threats: ['mind-control'] })]);
    expect(gaps.map((g) => g.defect)).toContain('FINDING_FOR_UNKNOWN_THREAT');
  });

  it('finds nothing wrong with a properly resolved finding', () => {
    expect(checkSecurity([finding()])).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Deployment                                                                 */
/* -------------------------------------------------------------------------- */

describe('gap-spec §15.8 and §15.9: deployment and production verification', () => {
  it('lets anything reach preview freely', () => {
    // Cheap and reversible. Gating them would slow the loop that catches problems early.
    expect(mayPromoteTo('PREVIEW', [])).toBe(true);
    expect(mayPromoteTo('CI', [])).toBe(true);
  });

  it('refuses production without staging', () => {
    expect(mayPromoteTo('PRODUCTION', ['LOCAL', 'CI', 'PREVIEW'])).toBe(false);
    expect(mayPromoteTo('PRODUCTION', ['STAGING'])).toBe(true);
  });

  it('refuses staging without preview', () => {
    expect(mayPromoteTo('STAGING', ['LOCAL', 'CI'])).toBe(false);
  });

  it('blocks a promotion that skips a stage, saying why the stage exists', () => {
    const gaps = checkDeployment({
      target: 'PRODUCTION',
      alreadyDeployedTo: ['LOCAL', 'CI'],
      plans: [],
      checks: [],
      approvals: ['a1'],
      requiredPlans: [],
      verifyProduction: true,
    });

    const gap = gaps.find((g) => g.defect === 'PROMOTED_WITHOUT_A_STAGE');

    expect(gap?.blocking).toBe(true);
    expect(gap?.why).toMatch(/something is learned there/i);
  });

  it('blocks production with no approval', () => {
    const gaps = checkDeployment({
      target: 'PRODUCTION',
      alreadyDeployedTo: ['STAGING'],
      plans: [],
      checks: allChecksPassed(),
      approvals: [],
      requiredPlans: [],
      verifyProduction: true,
    });

    expect(gaps.find((g) => g.defect === 'NO_APPROVAL')?.blocking).toBe(true);
  });

  it('explains what each missing plan costs rather than naming it', () => {
    const gaps = checkDeployment({
      target: 'PRODUCTION',
      alreadyDeployedTo: ['STAGING'],
      plans: [],
      checks: allChecksPassed(),
      approvals: ['a1'],
      requiredPlans: ['ROLLBACK'],
      verifyProduction: true,
    });

    // "You are missing a rollback plan" is a checklist item. "The decision will be made under
    // pressure by whoever is awake" is an argument.
    expect(gaps.find((g) => g.defect === 'PLAN_MISSING')?.why).toMatch(/under pressure/i);
  });

  it('reports an unrehearsed rollback without blocking on it', () => {
    /*
     * Blocking would make the field get ticked rather than the rehearsal get done, which loses the
     * information entirely.
     */
    const gaps = checkDeployment({
      target: 'PRODUCTION',
      alreadyDeployedTo: ['STAGING'],
      plans: [{ kind: 'ROLLBACK', documentId: 'd1', rehearsed: false }],
      checks: allChecksPassed(),
      approvals: ['a1'],
      requiredPlans: ['ROLLBACK'],
      verifyProduction: true,
    });

    expect(gaps.find((g) => g.defect === 'ROLLBACK_NOT_REHEARSED')?.blocking).toBe(false);
  });

  it('treats an unchecked production check as not run, never as passed', () => {
    /*
     * The most consequential default in the whole package. Software reporting its own production as
     * healthy because nobody entered a failure is the claim people cite after something goes wrong.
     */
    const gaps = checkDeployment({
      target: 'PRODUCTION',
      alreadyDeployedTo: ['STAGING'],
      plans: [],
      checks: [],
      approvals: ['a1'],
      requiredPlans: [],
      verifyProduction: true,
    });

    const notRun = gaps.filter((g) => g.defect === 'PRODUCTION_CHECK_NOT_RUN');

    expect(notRun).toHaveLength(PRODUCTION_CHECKS.length);
    expect(notRun.every((g) => g.blocking)).toBe(true);
  });

  it('offers no check result meaning "assumed fine"', () => {
    // Asserted structurally. Adding one would be a visible change here, and there is no honest
    // reading of a check nobody ran.
    expect(CHECK_RESULTS).toEqual(['PASSED', 'FAILED', 'NOT_CHECKED']);
  });

  it('reports a passing production check that kept nothing', () => {
    const gaps = checkDeployment({
      target: 'PRODUCTION',
      alreadyDeployedTo: ['STAGING'],
      plans: [],
      checks: PRODUCTION_CHECKS.map((check) => ({
        check,
        result: 'PASSED' as const,
        evidence: [],
      })),
      approvals: ['a1'],
      requiredPlans: [],
      verifyProduction: true,
    });

    // Later, a check with no artefact cannot be distinguished from one nobody ran.
    expect(gaps.map((g) => g.defect)).toContain('PRODUCTION_CHECK_WITHOUT_EVIDENCE');
  });

  it('evaluates production checks only when asked to, not because the target is production', () => {
    /*
     * These two questions look like one and are not: "is this release destined for production" and
     * "has production been verified". Deriving the second from the first made the Release Readiness
     * Gate demand evidence from a deployment it had not yet authorised, so it could never pass — a
     * gate that must fail in order to be reached is not a gate.
     */
    const planning = checkDeployment({
      target: 'PRODUCTION',
      alreadyDeployedTo: ['STAGING'],
      plans: [],
      checks: [],
      approvals: ['a1'],
      requiredPlans: [],
      verifyProduction: false,
    });

    const verifying = checkDeployment({
      target: 'PRODUCTION',
      alreadyDeployedTo: ['STAGING'],
      plans: [],
      checks: [],
      approvals: ['a1'],
      requiredPlans: [],
      verifyProduction: true,
    });

    expect(planning).toEqual([]);
    expect(verifying.filter((g) => g.defect === 'PRODUCTION_CHECK_NOT_RUN')).toHaveLength(
      PRODUCTION_CHECKS.length,
    );
  });

  it('runs no production checks for a preview deployment', () => {
    // A preview would otherwise be blocked on production evidence that cannot exist yet.
    const gaps = checkDeployment({
      target: 'PREVIEW',
      alreadyDeployedTo: [],
      plans: [],
      checks: [],
      approvals: [],
      requiredPlans: [],
      verifyProduction: false,
    });

    expect(gaps).toEqual([]);
  });

  it('names every environment in the promotion order', () => {
    expect(ENVIRONMENTS).toEqual(['LOCAL', 'CI', 'PREVIEW', 'STAGING', 'PRODUCTION']);
  });
});

/* -------------------------------------------------------------------------- */
/* Operations                                                                 */
/* -------------------------------------------------------------------------- */

describe('gap-spec §15.10 and §15.11: operations and handover', () => {
  it('requires an owner for each area separately', () => {
    /*
     * A single owner field produces one name that is wrong for four of these. Data protection in
     * particular is a legal obligation with a clock on it, and it is the one most often unassigned.
     */
    const gaps = checkOperations({
      ownership: [],
      incidents: [],
      debt: [],
      forHandover: true,
      hasDeliveredWork: true,
    });

    const unowned = gaps.filter((g) => g.defect === 'UNOWNED_AREA');

    expect(unowned).toHaveLength(OWNERSHIP_AREAS.length);
    expect(unowned.every((g) => g.blocking)).toBe(true);
  });

  it('does not block on unowned areas outside a handover', () => {
    // Operational readiness during delivery is a different question from handover, and blocking a
    // running project on handover paperwork would make the gate meaningless by being permanent.
    const gaps = checkOperations({
      ownership: [],
      incidents: [],
      debt: [],
      forHandover: false,
      hasDeliveredWork: true,
    });

    expect(gaps.filter((g) => g.defect === 'UNOWNED_AREA').every((g) => !g.blocking)).toBe(true);
  });

  it('reports an owner who has not accepted', () => {
    // The most common way a handover looks complete on paper and fails on the first incident.
    const gaps = checkOperations({
      ownership: OWNERSHIP_AREAS.map((area) => ({ area, owner: 'A. Patel', accepted: false })),
      incidents: [],
      debt: [{ id: 'd', kind: 'SHORTCUT', summary: 's', consequence: 'c', disclosed: true }],
      forHandover: true,
      hasDeliveredWork: true,
    });

    expect(gaps.map((g) => g.defect)).toContain('OWNER_HAS_NOT_ACCEPTED');
  });

  it('says mitigated is not resolved', () => {
    /*
     * The symptom has stopped and the cause has not, which means the mitigation is now load-bearing
     * without anybody having decided that.
     */
    const gaps = checkOperations({
      ownership: ownership(),
      incidents: [
        { id: 'i1', title: 'Search timeouts', severity: 'SEV2', state: 'MITIGATED', actions: [] },
      ],
      debt: [{ id: 'd', kind: 'SHORTCUT', summary: 's', consequence: 'c', disclosed: true }],
      forHandover: false,
      hasDeliveredWork: true,
    });

    expect(gaps.find((g) => g.defect === 'INCIDENT_UNRESOLVED')?.why).toMatch(/load-bearing/i);
  });

  it('reports a resolved incident nobody reviewed', () => {
    // A project whose incidents are all resolved and none reviewed has been fixing the same thing
    // repeatedly without noticing.
    const gaps = checkOperations({
      ownership: ownership(),
      incidents: [
        {
          id: 'i1',
          title: 'Search timeouts',
          severity: 'SEV2',
          state: 'RESOLVED',
          cause: 'Missing index',
          actions: [],
        },
      ],
      debt: [{ id: 'd', kind: 'SHORTCUT', summary: 's', consequence: 'c', disclosed: true }],
      forHandover: false,
      hasDeliveredWork: true,
    });

    expect(gaps.map((g) => g.defect)).toContain('INCIDENT_UNREVIEWED');
  });

  it('blocks handover on undisclosed debt', () => {
    /*
     * Undisclosed debt is what makes a handover a betrayal rather than a transfer. The receiving
     * team will find it; the only variable is whether they find it in a document or in production.
     */
    const gaps = checkOperations({
      ownership: ownership(),
      incidents: [],
      debt: [
        {
          id: 'd1',
          kind: 'SHORTCUT',
          summary: 'Auth bypass in the seed script',
          consequence: 'x',
          disclosed: false,
        },
      ],
      forHandover: true,
      hasDeliveredWork: true,
    });

    expect(gaps.find((g) => g.defect === 'UNDISCLOSED_DEBT')?.blocking).toBe(true);
  });

  it('reports an empty debt register on a project that delivered work', () => {
    /*
     * Not a rule about how much debt is acceptable. Zero recorded debt after real delivery means
     * nobody looked, and "nobody looked" and "there is none" are indistinguishable in the register
     * while being completely different at handover.
     */
    const gaps = checkOperations({
      ownership: ownership(),
      incidents: [],
      debt: [],
      forHandover: true,
      hasDeliveredWork: true,
    });

    expect(gaps.map((g) => g.defect)).toContain('NO_DEBT_RECORDED');
  });

  it('does not demand debt from a project that has delivered nothing', () => {
    const gaps = checkOperations({
      ownership: ownership(),
      incidents: [],
      debt: [],
      forHandover: true,
      hasDeliveredWork: false,
    });

    expect(gaps.map((g) => g.defect)).not.toContain('NO_DEBT_RECORDED');
  });
});

/* -------------------------------------------------------------------------- */
/* The release-readiness flow                                                 */
/* -------------------------------------------------------------------------- */

describe('the release-readiness flow, end to end', () => {
  it('passes every gate for a project that has done the work', () => {
    // The Phase-11 gate: the flow works end to end. Without this the negative tests below could all
    // pass on a flow that never passes anything.
    const report = evaluateReadiness(readyInput());

    expect(report.gates.map((g) => `${g.gate}:${g.result}`)).toEqual(
      RELEASE_GATES.map((g) => `${g}:PASSED`),
    );

    expect(report.releasable).toBe(true);
    expect(report.stoppedAt).toBeUndefined();
    expect(report.nextAction).toBeNull();
  });

  it('returns null for the next action rather than a cheerful placeholder', () => {
    // "Nothing needs your attention" is a claim, and inventing one is the same false reassurance as
    // an unexplained score.
    expect(evaluateReadiness(readyInput()).nextAction).toBeNull();
  });

  it('stops at the first unpassed gate and says so', () => {
    const report = evaluateReadiness(
      readyInput({ tests: [test_({ id: 'test1', outcome: 'FAILED' })] }),
    );

    expect(report.stoppedAt).toBe('TESTING');
    expect(report.releasable).toBe(false);
    expect(report.nextAction?.summary).toMatch(/testing/i);
  });

  it('marks a gate whose prerequisite has not passed as indeterminate, not failed', () => {
    /*
     * Saying it failed would blame it for a problem belonging to an earlier gate — sending somebody
     * to fix production verification when the real issue is that nobody approved the release.
     */
    const report = evaluateReadiness(readyInput({ approvals: [] }));

    const production = report.gates.find((g) => g.gate === 'PRODUCTION_VERIFICATION');

    expect(report.gates.find((g) => g.gate === 'RELEASE_READINESS')?.result).toBe('FAILED');
    expect(production?.result).toBe('INDETERMINATE');
    expect(production?.explanation).toMatch(/not a failure of this gate/i);
  });

  it('distinguishes production checks nobody ran from production checks that failed', () => {
    /*
     * The distinction the production gate exists for. If both read as failure, a release record
     * cannot tell "we looked and it is broken" from "nobody looked" — and the second gets quietly
     * treated as the first and waved through.
     */
    const unchecked = evaluateReadiness(readyInput({ productionChecks: [] }));
    const failed = evaluateReadiness(
      readyInput({
        productionChecks: allChecksPassed().map((record) =>
          record.check === 'TLS' ? { ...record, result: 'FAILED' as const } : record,
        ),
      }),
    );

    expect(unchecked.gates.find((g) => g.gate === 'PRODUCTION_VERIFICATION')?.result).toBe(
      'INDETERMINATE',
    );
    expect(failed.gates.find((g) => g.gate === 'PRODUCTION_VERIFICATION')?.result).toBe('FAILED');
  });

  it('says an indeterminate gate cannot be decided rather than telling somebody to fix it', () => {
    const report = evaluateReadiness(readyInput({ productionChecks: [] }));

    expect(report.nextAction?.summary).toMatch(/cannot be decided/i);
  });

  it('names the exceptions a passing gate is resting on', () => {
    /*
     * A gate resting on four live exceptions passes differently from one resting on none. Absorbing
     * them into the pass is how a gate becomes a formality without anybody deciding to make it one.
     */
    const report = evaluateReadiness(
      readyInput({
        tests: [test_({ id: 'test1', outcome: 'FAILED' })],
        exceptions: [exception({ subjectId: 'test1' })],
      }),
    );

    const testing = report.gates.find((g) => g.gate === 'TESTING');

    expect(testing?.result).toBe('PASSED');
    expect(testing?.restingOn).toEqual(['x1']);
    expect(testing?.explanation).toMatch(/resting on 1 live exception/i);
  });

  it('blocks the testing gate on a malformed exception', () => {
    // Letting it through would be the gate accepting an undated, unowned waiver as a decision.
    const report = evaluateReadiness(
      readyInput({ exceptions: [exception({ subjectId: 'test1', acceptedBy: '' })] }),
    );

    expect(report.gates.find((g) => g.gate === 'TESTING')?.result).toBe('FAILED');
  });

  it('blocks the testing gate on a requirement with no test', () => {
    const graph = new TwinGraph({
      projectId: PROJECT,
      nodes: [node('proj', 'PROJECT'), node('r9', 'REQUIREMENT')],
      edges: [],
    });

    const report = evaluateReadiness(readyInput({ graph, tests: [] }));

    expect(
      report.gates
        .find((g) => g.gate === 'TESTING')
        ?.blockers.map((b) => b.summary)
        .join(' '),
    ).toMatch(/no test at all/i);
  });

  it('reports requirement coverage by name, with no ratio anywhere', () => {
    const graph = new TwinGraph({
      projectId: PROJECT,
      nodes: [node('proj', 'PROJECT'), node('r9', 'REQUIREMENT')],
      edges: [],
    });

    const blockers = evaluateReadiness(readyInput({ graph, tests: [] }))
      .gates.find((g) => g.gate === 'TESTING')
      ?.blockers.map((b) => b.summary);

    expect(blockers?.join(' ')).toContain('r9');
    expect(blockers?.join(' ')).not.toMatch(/\d{1,3}\s*%/);
  });

  it('blocks handover on outstanding traceability gaps', () => {
    // §15.11: requirements dispositioned. Handing over with open ones transfers a question rather
    // than a system.
    const graph = new TwinGraph({
      projectId: PROJECT,
      nodes: [
        node('proj', 'PROJECT'),
        node('r1', 'REQUIREMENT', {
          kind: 'FUNCTIONAL',
          priority: 'MUST',
          verification: ['TEST'],
          acceptance: [{ id: 'a1', statement: 'x' }],
          sourceRef: 's',
        }),
        node('task1', 'TASK'),
      ],
      edges: [edge('task1', 'r1', 'IMPLEMENTS')],
    });

    const report = evaluateReadiness(
      readyInput({ graph, tests: [test_({ id: 'test1', verifies: ['r1'] })] }),
    );

    const handover = report.gates.find((g) => g.gate === 'COMPLETION_HANDOVER');

    expect(handover?.result).toBe('FAILED');
    expect(handover?.blockers.map((b) => b.summary).join(' ')).toMatch(/traceability gap/i);

    // The argument moved to `why` when blockers gained one. That is the field a reader needs: the
    // summary says what is wrong, and this says why handing over anyway is a bad idea.
    expect(handover?.blockers.map((b) => b.why).join(' ')).toMatch(/dispositioned/i);
  });

  it('orders the gates so a later one cannot be decided before an earlier one', () => {
    // A system where a later gate can pass first is one where the sequence is decoration.
    for (const gate of RELEASE_GATES) {
      const prerequisite = GATE_PREREQUISITE[gate];
      if (prerequisite === undefined) continue;

      expect(RELEASE_GATES.indexOf(prerequisite)).toBeLessThan(RELEASE_GATES.indexOf(gate));
    }
  });

  it('keeps testing and security independent of each other', () => {
    /*
     * Nothing about the security position depends on the test position or the reverse, and making
     * one wait on the other would hide real problems behind unrelated ones.
     */
    expect(GATE_PREREQUISITE.TESTING).toBeUndefined();
    expect(GATE_PREREQUISITE.SECURITY).toBeUndefined();

    const report = evaluateReadiness(
      readyInput({ tests: [test_({ id: 'test1', outcome: 'FAILED' })] }),
    );

    expect(report.gates.find((g) => g.gate === 'SECURITY')?.result).toBe('PASSED');
  });

  it('gives every gate outcome evidence to look at', () => {
    const report = evaluateReadiness(readyInput({ approvals: [], productionChecks: [] }));

    for (const gate of report.gates) {
      if (gate.result === 'PASSED' && gate.blockers.length === 0) continue;
      expect(gate.evidence.length, gate.gate).toBeGreaterThan(0);
    }
  });

  it('is deterministic', () => {
    const input = readyInput({ approvals: [] });
    expect(JSON.stringify(evaluateReadiness(input))).toBe(JSON.stringify(evaluateReadiness(input)));
  });

  it('reads no clock', () => {
    /*
     * `asOf` is supplied by the caller everywhere. A clock read inside would make exception expiry
     * — and therefore the gate result — depend on when the report was generated.
     */
    const yesterday = readyInput({
      tests: [test_({ id: 'test1', outcome: 'FAILED' })],
      exceptions: [exception({ subjectId: 'test1', expiresOn: '2026-02-01' })],
      asOf: '2026-01-01',
    });

    const later = { ...yesterday, asOf: '2026-03-01' };

    expect(evaluateReadiness(yesterday).gates.find((g) => g.gate === 'TESTING')?.result).toBe(
      'PASSED',
    );
    expect(evaluateReadiness(later).gates.find((g) => g.gate === 'TESTING')?.result).toBe('FAILED');
  });
});
