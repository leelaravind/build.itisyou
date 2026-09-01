/**
 * Testing and quality-assurance rules.
 *
 * Contract: gap-spec §14 asks for at least 35.
 *
 * The thread running through these: a test suite's job is to fail when the system is wrong. Most of
 * the rules below exist because some common practice produces a suite that *cannot* fail — coverage
 * measured in lines rather than requirements, assertions that would pass against an empty
 * implementation, mocks so thorough that nothing real is exercised, or a flaky test quarantined
 * rather than diagnosed.
 *
 * A green suite that cannot fail is worse than no suite. It costs the same to run and it actively
 * discourages anyone from looking.
 */

import { defineRule, type Rule } from '../schema.ts';

const ACTIVE = '2026-01-01';
const WEB = [
  'PUBLIC_WEB_APP',
  'SAAS_WEB_APP',
  'ECOMMERCE',
  'AI_ENABLED_WEB_APP',
  'INTERNAL_BUSINESS_APP',
];

export const TESTING_RULES: readonly Rule[] = [
  defineRule({
    id: 'QA-COVER-001',
    version: '1.0.0',
    title: 'Coverage is measured against requirements, not lines',
    description:
      'Every requirement has at least one test that would fail if the requirement were not met.',
    category: 'TESTING',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'requirement-coverage',
        title: 'Every requirement is covered by a test',
        description:
          'Traced explicitly, so a requirement with no test is visible rather than assumed.',
        priority: 'MUST',
        verification: 'A traceability report listing each requirement and the tests verifying it.',
      },
    ],
    emittedGates: [
      {
        gateKey: 'TESTING',
        criterion: 'Every requirement is verified by at least one test.',
        blocking: true,
      },
    ],
    rationale:
      'Line coverage says how much code ran, which is not the same question. A suite can execute every line and check nothing, and it will report a number that sounds like assurance.',
    remediation: 'Link tests to requirements and report any requirement without one.',
    references: ['ISO/IEC/IEEE 29119-3 Test documentation'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'QA-COVER-002',
    version: '1.0.0',
    title: 'A test must be able to fail',
    description:
      'Tests are verified by breaking the thing they cover and confirming they catch it.',
    category: 'TESTING',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    emittedTasks: [
      {
        key: 'verify-test-sensitivity',
        title: 'Confirm critical tests fail when the behaviour breaks',
        phaseKey: 'verify',
      },
    ],
    rationale:
      'A test asserting the wrong thing, or asserting nothing, is indistinguishable from a passing one. The only reliable check is to break the behaviour and watch the test go red.',
    remediation:
      'For each critical test, temporarily break the behaviour and confirm the test catches it.',
    references: ['Mutation testing literature: assertion adequacy'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'QA-FLAKE-001',
    version: '1.0.0',
    title: 'Flaky tests are diagnosed, not retried',
    description:
      'A test that passes on retry is recording a real defect — usually a race — and hiding it.',
    category: 'TESTING',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'no-blind-retries',
        title: 'Intermittent failures are investigated before being retried away',
        description: 'Retries may mask a real race in the system, not only in the test.',
        priority: 'MUST',
        verification: 'A record of each quarantined test and what was found.',
      },
    ],
    rationale:
      'Retrying until green converts a reproducible signal into noise. The underlying race usually exists in the application, where it will surface under production concurrency instead.',
    remediation:
      'Diagnose each flaky test. Add retries only after establishing the cause is genuinely external.',
    references: ['Google Testing Blog: Flaky Tests at Google'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'QA-ASSERT-001',
    version: '1.0.0',
    title: 'Assertions wait rather than sleep',
    description: 'Interface tests use retrying assertions instead of fixed delays.',
    category: 'TESTING',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    projectTypeScope: WEB,
    emittedRequirements: [
      {
        key: 'no-fixed-sleeps',
        title: 'No test waits by sleeping',
        description:
          'Auto-retrying assertions, so the test is as fast as the system and as patient as it needs to be.',
        priority: 'SHOULD',
        verification: 'A check for fixed sleeps in the test suite.',
      },
    ],
    rationale:
      'A fixed sleep is either too short — flaky on a slow machine — or too long, which multiplies across the suite until nobody runs it locally.',
    remediation:
      'Replace sleeps with assertions that poll until a condition holds or a timeout expires.',
    references: ['Playwright documentation: auto-waiting'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'QA-E2E-001',
    version: '1.0.0',
    title: 'The critical journeys are tested end to end',
    description:
      'The paths that must work — sign up, sign in, the core action, payment — are exercised through the real interface.',
    category: 'TESTING',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    projectTypeScope: WEB,
    emittedRequirements: [
      {
        key: 'critical-journeys',
        title: 'Each critical journey has an end-to-end test',
        description: 'Through the real interface against a real database, not a mocked one.',
        priority: 'MUST',
        verification: 'A test per journey, run in CI.',
      },
    ],
    emittedTests: [
      {
        key: 'journey-suite',
        title: 'Critical journey suite',
        kind: 'E2E',
        verifies: 'critical-journeys',
      },
    ],
    emittedGates: [
      {
        gateKey: 'TESTING',
        criterion: 'Every critical journey has a passing end-to-end test.',
        blocking: true,
      },
    ],
    rationale:
      'Every unit can pass while the thing a user actually does is broken, because the failure is in the seams that unit tests deliberately remove.',
    remediation: 'List the journeys that must work and write one end-to-end test each.',
    references: ['ISTQB Foundation: test levels'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'QA-E2E-002',
    version: '1.0.0',
    title: 'End-to-end tests run against a freshly built application',
    description:
      'The suite builds before it starts the server, so it never tests the previous commit.',
    category: 'TESTING',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    projectTypeScope: WEB,
    emittedRequirements: [
      {
        key: 'fresh-build-e2e',
        title: 'The end-to-end suite builds before it runs',
        description: 'And refuses to reuse a server left running from an earlier session.',
        priority: 'MUST',
        verification: 'The test command builds and starts its own server.',
      },
    ],
    rationale:
      'A stale artefact produces confident, reproducible failures against code that is already correct — the most expensive kind of debugging, because the evidence points somewhere real and wrong.',
    remediation: 'Build before starting the server, and disable reuse of an existing one.',
    references: ['Playwright documentation: webServer configuration'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'QA-UNIT-001',
    version: '1.0.0',
    title: 'Business logic is testable without infrastructure',
    description:
      'Rules, calculations and state machines are pure functions that need no database or network.',
    category: 'TESTING',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'pure-core',
        title: 'The decision-making core is pure',
        description: 'Input in, output out. Infrastructure at the edges.',
        priority: 'SHOULD',
        verification: 'The core test suite runs with no external dependency.',
      },
    ],
    rationale:
      'Logic that can only be tested through a database gets tested less, because the tests are slow enough that people stop running them.',
    remediation: 'Move decisions into pure functions and keep effects at the boundary.',
    references: ['Hexagonal architecture: ports and adapters'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'QA-INT-001',
    version: '1.0.0',
    title: 'Integration tests use the real database engine',
    description: 'Not an in-memory substitute with different semantics.',
    category: 'TESTING',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'real-database-tests',
        title: 'Database behaviour is tested against the real engine',
        description:
          'Constraints, transactions, isolation levels and row-level security behave differently elsewhere.',
        priority: 'MUST',
        verification: 'The integration suite runs against the same engine as production.',
      },
    ],
    rationale:
      'A substitute engine passes tests that the real one fails, and the difference is always in exactly the features you were relying on — constraints, isolation and security policies.',
    remediation: 'Run integration tests against the same database engine as production.',
    references: ['Testcontainers: integration testing practice'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'QA-MOCK-001',
    version: '1.0.0',
    title: 'Mocking your own code proves your own code agrees with itself',
    description:
      'Mocks belong at genuine external boundaries. Internal seams should be exercised for real.',
    category: 'TESTING',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'mock-boundaries-only',
        title: 'Mocks are used at external boundaries only',
        description: 'Third-party services and non-deterministic sources, not internal modules.',
        priority: 'SHOULD',
        verification: 'A review of what the test suite mocks and why.',
      },
    ],
    rationale:
      'A test where every collaborator is mocked verifies that the code calls the functions the test expected it to call. It cannot detect that those functions do the wrong thing.',
    remediation: 'Mock only what you do not control; use the real thing for everything else.',
    references: ['Fowler: Mocks Aren’t Stubs'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'QA-DATA-001',
    version: '1.0.0',
    title: 'Tests do not depend on each other’s leftovers',
    description: 'Each test creates what it needs and leaves nothing that affects the next.',
    category: 'TESTING',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'test-isolation',
        title: 'Tests pass in any order and in isolation',
        description: 'No test depends on state another created.',
        priority: 'MUST',
        verification: 'The suite passes when run in a randomised order.',
      },
    ],
    rationale:
      'Order-dependent tests fail mysteriously the first time somebody adds a test in the middle, and the failure points at the wrong test.',
    remediation: 'Reset state between tests and run the suite in random order to prove it.',
    references: ['xUnit Test Patterns: Fresh Fixture'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'QA-NEG-001',
    version: '1.0.0',
    title: 'Test the refusals, not only the successes',
    description:
      'For every rule the system enforces, a test asserts what happens when it is broken.',
    category: 'TESTING',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'negative-tests',
        title: 'Every enforced rule has a test that violates it',
        description: 'Asserting the refusal, and the message.',
        priority: 'MUST',
        verification: 'A negative test alongside each validation and authorisation rule.',
      },
    ],
    rationale:
      'A validator that accepts everything passes every positive test. The only way to know a rule is enforced is to break it.',
    remediation: 'Add a violating case for every rule the system claims to enforce.',
    references: ['ISTQB Foundation: equivalence partitioning and boundary analysis'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'QA-BOUND-001',
    version: '1.0.0',
    title: 'Boundaries are tested at the boundary',
    description: 'Empty, one, maximum, maximum plus one, and whatever the domain calls unusual.',
    category: 'TESTING',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'boundary-cases',
        title: 'Limits are tested on both sides',
        description: 'Including zero, empty collections and the maximum permitted value.',
        priority: 'SHOULD',
        verification: 'Boundary cases present for each bounded input.',
      },
    ],
    rationale:
      'Off-by-one errors survive every test that uses a comfortable middle value, and they are among the most common defects in code that otherwise works.',
    remediation: 'For each limit, test just inside and just outside it.',
    references: ['ISTQB Foundation: boundary value analysis'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'QA-REGRESS-001',
    version: '1.0.0',
    title: 'Every fixed defect gets a test that would have caught it',
    description: 'Written before the fix, so it fails first.',
    category: 'TESTING',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'regression-per-defect',
        title: 'Each defect fix ships with a failing-first test',
        description: 'Demonstrating the defect before demonstrating the fix.',
        priority: 'MUST',
        verification: 'A test accompanies each defect fix.',
      },
    ],
    rationale:
      'A test written after the fix proves the code currently works. A test written before it proves the test detects the defect — which is what stops it coming back.',
    remediation: 'Reproduce the defect in a test, watch it fail, then fix it.',
    references: ['Beck: Test-Driven Development'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'QA-CI-001',
    version: '1.0.0',
    title: 'The suite runs in CI on every change',
    description: 'And a failure blocks the merge.',
    category: 'TESTING',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedTasks: [{ key: 'ci-test-run', title: 'Run the test suite in CI', phaseKey: 'build' }],
    emittedGates: [
      { gateKey: 'DEVELOPMENT', criterion: 'The test suite passes in CI.', blocking: true },
    ],
    rationale:
      'Tests that only run locally run when someone remembers, which correlates inversely with how busy they are.',
    remediation: 'Run the full suite in CI and make failure block the merge.',
    references: ['Continuous integration practice'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'QA-CI-002',
    version: '1.0.0',
    title: 'A failing test is never disabled to make the build green',
    description:
      'A test failing for a valid reason is a defect report. Skipping it deletes the report.',
    category: 'TESTING',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'no-silent-skips',
        title: 'Skipped tests carry a reason and an owner',
        description: 'And the count of skips is reported rather than hidden.',
        priority: 'MUST',
        verification: 'Skipped tests are listed in the CI output with their reasons.',
      },
    ],
    rationale:
      'The pressure to skip is highest exactly when the failure is most likely to be real. A skip with no recorded reason is indistinguishable from a test nobody understood.',
    remediation: 'Require a reason on every skip and report the total.',
    references: ['ISO/IEC/IEEE 29119-3: incident reporting'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'QA-PERF-001',
    version: '1.0.0',
    title: 'Performance is measured against a defined journey',
    description: 'A target with no defined scenario cannot be passed or failed.',
    category: 'TESTING',
    severity: 'RECOMMENDED',
    source: 'PROJECT_CONSTRAINT',
    conditions: [{ subject: 'INTAKE', key: 'performance.expectation', operator: 'IS_ANSWERED' }],
    requiredInputs: ['performance.expectation'],
    emittedRequirements: [
      {
        key: 'performance-scenario',
        title: 'Each performance target names its journey and its load',
        description: 'Measured at a stated percentile, not as an average.',
        priority: 'SHOULD',
        verification: 'A performance test per target.',
      },
    ],
    emittedTests: [
      {
        key: 'performance-suite',
        title: 'Performance suite',
        kind: 'PERFORMANCE',
        verifies: 'performance-scenario',
      },
    ],
    rationale:
      'Averages hide the tail, and the tail is what users experience as "the site is slow". A target without a percentile is not a target.',
    remediation: 'Define the journey, the concurrent load and the percentile for each target.',
    references: ['Web Vitals: field measurement guidance'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'QA-LOAD-001',
    version: '1.0.0',
    title: 'Load is tested against something like production',
    description:
      'Load results from a machine with different data volume and hardware do not transfer.',
    category: 'TESTING',
    severity: 'RECOMMENDED',
    source: 'PROJECT_CONSTRAINT',
    conditions: [
      {
        subject: 'INTAKE',
        key: 'performance.expectation',
        operator: 'IN',
        value: ['Large data volumes', 'Real-time or near-real-time', 'Heavy background processing'],
      },
    ],
    requiredInputs: ['performance.expectation'],
    emittedTasks: [
      {
        key: 'load-test',
        title: 'Run a load test against production-like data',
        phaseKey: 'verify',
      },
    ],
    rationale:
      'Query plans change with data volume. A query that is instant against a thousand rows can be unusable against a million, and no amount of testing on the small dataset reveals it.',
    remediation: 'Load-test with representative data volume on comparable hardware.',
    references: ['Database performance: cardinality and plan selection'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'QA-A11Y-001',
    version: '1.0.0',
    title: 'Automated accessibility checks run on every page',
    description:
      'Automated checks find a minority of issues, which is a reason to add manual testing rather than to skip them.',
    category: 'TESTING',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    projectTypeScope: WEB,
    emittedRequirements: [
      {
        key: 'automated-a11y',
        title: 'Every page has an automated accessibility check',
        description: 'Run in CI, with violations failing the build.',
        priority: 'MUST',
        verification: 'An accessibility assertion per route.',
      },
    ],
    emittedTests: [
      {
        key: 'a11y-suite',
        title: 'Automated accessibility suite',
        kind: 'ACCESSIBILITY',
        verifies: 'automated-a11y',
      },
    ],
    rationale:
      'Automated tools catch perhaps a third of accessibility issues, but they catch them on every commit for no ongoing cost. The other two thirds need people, which is a separate rule.',
    remediation: 'Add an automated accessibility assertion to every route test.',
    references: ['WCAG 2.2', 'Deque: automated testing coverage'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'QA-A11Y-002',
    version: '1.0.0',
    title: 'Keyboard-only operation is tested by a person',
    description:
      'Every interactive control is reachable, operable and visibly focused without a mouse.',
    category: 'TESTING',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    projectTypeScope: WEB,
    emittedTasks: [
      {
        key: 'keyboard-walkthrough',
        title: 'Walk every journey using only the keyboard',
        phaseKey: 'verify',
      },
    ],
    rationale:
      'Focus order, focus visibility and keyboard traps are the issues automated tools are worst at, and the ones that make a page completely unusable rather than merely awkward.',
    remediation: 'Walk each journey with the keyboard alone and record what was found.',
    references: ['WCAG 2.2 §2.1 Keyboard Accessible'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'QA-BROWSER-001',
    version: '1.0.0',
    title: 'Tests run on more than one browser engine',
    description:
      'Chromium, Gecko and WebKit differ in cookies, layout and storage in ways that matter.',
    category: 'TESTING',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    projectTypeScope: WEB,
    emittedRequirements: [
      {
        key: 'multi-engine',
        title: 'The suite runs on at least three engines',
        description: 'Including a WebKit engine, which is the only option on iOS.',
        priority: 'SHOULD',
        verification: 'CI runs the suite across engines.',
      },
    ],
    rationale:
      'Cookie attribute handling in particular differs between engines, and a session that silently fails on Safari affects every iPhone user without producing an error anywhere.',
    remediation: 'Run the end-to-end suite on Chromium, Firefox and WebKit.',
    references: ['Playwright: browser support'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'QA-MOBILE-001',
    version: '1.0.0',
    title: 'Mobile viewports are tested, not inferred',
    description: 'At least one small viewport is exercised for every critical journey.',
    category: 'TESTING',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    projectTypeScope: WEB,
    emittedRequirements: [
      {
        key: 'mobile-viewport-tests',
        title: 'Critical journeys are tested at a mobile viewport',
        description: 'Including reflow at 320 pixels with no horizontal scrolling.',
        priority: 'SHOULD',
        verification: 'The suite includes a mobile viewport project.',
      },
    ],
    rationale:
      'Layout that works at desktop width can put a control off-screen at mobile width, and the majority of traffic to most public sites is mobile.',
    remediation: 'Add a mobile viewport to the test matrix and assert reflow at 320 pixels.',
    references: ['WCAG 2.2 §1.4.10 Reflow'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'QA-CONTRACT-001',
    version: '1.0.0',
    title: 'API contracts are tested against the published schema',
    description: 'Responses are validated against the same document consumers were given.',
    category: 'TESTING',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    projectTypeScope: ['API_BACKEND_PLATFORM'],
    emittedRequirements: [
      {
        key: 'contract-tests',
        title: 'Responses conform to the published schema',
        description: 'Checked automatically, so documentation cannot drift from behaviour.',
        priority: 'MUST',
        verification: 'A contract test per endpoint.',
      },
    ],
    emittedTests: [
      {
        key: 'contract-suite',
        title: 'API contract suite',
        kind: 'INTEGRATION',
        verifies: 'contract-tests',
      },
    ],
    rationale:
      'Documentation that drifts from behaviour is worse than none: consumers build against it and their integration breaks for reasons they cannot see.',
    remediation: 'Validate responses against the published schema in CI.',
    references: ['OpenAPI Specification: schema validation'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'QA-MIGRATION-001',
    version: '1.0.0',
    title: 'Migrations are tested against realistic data',
    description: 'Including the volume, and including the reverse.',
    category: 'TESTING',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'migration-tests',
        title: 'Each migration is tested forward and backward on realistic data',
        description:
          'Timing measured, so a migration that locks a table for an hour is known in advance.',
        priority: 'MUST',
        verification: 'A migration test with production-like row counts.',
      },
    ],
    rationale:
      'A migration that runs in milliseconds on an empty table can lock a production table for an hour. The difference is only visible at volume.',
    remediation: 'Test migrations against realistic row counts and measure how long they take.',
    references: ['Database schema migration practice'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'QA-CONCURRENCY-001',
    version: '1.0.0',
    title: 'Concurrent access to shared state is tested concurrently',
    description: 'Race conditions do not appear in sequential tests, by construction.',
    category: 'TESTING',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'concurrency-tests',
        title: 'Contended operations are tested under real concurrency',
        description:
          'Stock decrements, balance updates, unique claims and anything with a read-then-write.',
        priority: 'SHOULD',
        verification: 'A test issuing simultaneous operations and asserting the invariant holds.',
      },
    ],
    emittedTests: [
      {
        key: 'concurrency-suite',
        title: 'Concurrency suite',
        kind: 'INTEGRATION',
        verifies: 'concurrency-tests',
      },
    ],
    rationale:
      'Read-then-write without a lock is correct in every sequential test and wrong under load, where it silently produces double bookings and negative stock.',
    remediation: 'Test contended operations with simultaneous requests and assert the invariant.',
    references: ['Transaction isolation levels: lost update anomaly'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'QA-IDEMPOTENT-001',
    version: '1.0.0',
    title: 'Operations that can be retried are tested for repetition',
    description: 'Anything a user can double-click, or a client can retry, is tested twice.',
    category: 'TESTING',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'idempotency-tests',
        title: 'Repeated requests produce one effect',
        description: 'Payments, submissions and any operation with a side effect.',
        priority: 'MUST',
        verification: 'A test that issues the same operation twice and asserts a single effect.',
      },
    ],
    rationale:
      'Users double-click, networks retry and mobile connections reconnect. An operation that is not idempotent will eventually be performed twice, and the first time anyone notices is usually a duplicate charge.',
    remediation: 'Add idempotency keys and test the repeated case.',
    references: ['Stripe: idempotent requests'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'QA-ERROR-001',
    version: '1.0.0',
    title: 'Failure paths are tested as well as success paths',
    description: 'Timeouts, refusals and partial failures from every dependency.',
    category: 'TESTING',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'failure-path-tests',
        title: 'Each dependency failure has a tested response',
        description: 'What the user sees, and what the system does.',
        priority: 'SHOULD',
        verification: 'A test simulating each dependency failure.',
      },
    ],
    rationale:
      'Error handling is the least-exercised code in most systems and runs at the worst possible moment. Untested error handling frequently throws its own error.',
    remediation: 'Simulate each dependency failing and assert the resulting behaviour.',
    references: ['Nygard: Release It! — stability patterns'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'QA-SEED-001',
    version: '1.0.0',
    title: 'Test fixtures are deterministic',
    description: 'No random values, no current date, no dependence on the machine.',
    category: 'TESTING',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'deterministic-fixtures',
        title: 'Fixtures produce the same data every run',
        description: 'Fixed timestamps and seeded generators.',
        priority: 'MUST',
        verification: 'The suite passes identically on repeated runs.',
      },
    ],
    rationale:
      'A test using the current date passes for months and then fails on a leap day or a month boundary, with no change to the code and no obvious cause.',
    remediation: 'Use fixed dates and seeded generators in fixtures.',
    references: ['xUnit Test Patterns: Deterministic Test'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'QA-TIME-001',
    version: '1.0.0',
    title: 'Time-dependent behaviour takes time as an input',
    description:
      'Anything that expires, schedules or compares dates receives the time rather than reading it.',
    category: 'TESTING',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'injectable-time',
        title: 'Time is passed in, not read from the clock',
        description: 'So expiry, scheduling and retention can be tested without waiting.',
        priority: 'MUST',
        verification: 'Tests for expiry that complete immediately.',
      },
    ],
    rationale:
      'Code that reads the clock directly cannot be tested for anything that happens later, so expiry logic tends to be tested by not testing it.',
    remediation: 'Accept a timestamp parameter in time-dependent functions.',
    references: ['Dependency injection for temporal logic'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'QA-TZ-001',
    version: '1.0.0',
    title: 'Time zones and daylight saving are tested explicitly',
    description: 'Including the days that have 23 and 25 hours.',
    category: 'TESTING',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    conditions: [{ subject: 'INTAKE', key: 'privacy.jurisdictions', operator: 'IS_ANSWERED' }],
    requiredInputs: ['privacy.jurisdictions'],
    emittedRequirements: [
      {
        key: 'timezone-tests',
        title: 'Date handling is tested across time zones and transitions',
        description: 'Storage in UTC, display in the user’s zone, and the transition days.',
        priority: 'SHOULD',
        verification: 'Tests covering a daylight-saving transition in each supported region.',
      },
    ],
    rationale:
      'A daily job scheduled in local time either runs twice or not at all on transition days, and appointment systems shift every booking by an hour.',
    remediation: 'Store in UTC, convert for display, and test both transitions.',
    references: ['IANA Time Zone Database'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'QA-I18N-001',
    version: '1.0.0',
    title: 'Text handling is tested with more than ASCII',
    description: 'Accents, non-Latin scripts, right-to-left text and multi-byte characters.',
    category: 'TESTING',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'unicode-tests',
        title: 'Names and free text are tested with real-world characters',
        description: 'Including characters outside the basic multilingual plane.',
        priority: 'SHOULD',
        verification: 'Fixtures containing non-ASCII names and text.',
      },
    ],
    rationale:
      'Length limits counted in bytes truncate multi-byte characters mid-sequence, producing corrupted text — and the first person to hit it is usually a real user with an ordinary name.',
    remediation: 'Include non-ASCII values in fixtures and count string length in characters.',
    references: ['Unicode Standard: text segmentation'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'QA-SNAPSHOT-001',
    version: '1.0.0',
    title: 'Snapshot tests are reviewed, not regenerated',
    description: 'A snapshot updated without being read asserts whatever the code now does.',
    category: 'TESTING',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'snapshot-discipline',
        title: 'Snapshot changes are reviewed as changes',
        description: 'Large snapshots are avoided in favour of targeted assertions.',
        priority: 'SHOULD',
        verification: 'Snapshot diffs appear in review.',
      },
    ],
    rationale:
      'Regenerating a snapshot to make a test pass converts a failure into a record of the new behaviour, whether or not the new behaviour is correct.',
    remediation: 'Keep snapshots small and review every change to one.',
    references: ['Jest documentation: snapshot testing best practices'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'QA-SEC-001',
    version: '1.0.0',
    title: 'Security tests run in the same suite as everything else',
    description: 'A separate suite that runs occasionally is a suite that runs after the release.',
    category: 'TESTING',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    emittedRequirements: [
      {
        key: 'security-in-ci',
        title: 'Security tests are part of the normal pipeline',
        description: 'Authorisation, injection and header assertions run on every change.',
        priority: 'MUST',
        verification: 'Security tests appear in the standard CI run.',
      },
    ],
    emittedGates: [
      {
        gateKey: 'SECURITY',
        criterion: 'Security tests run in the standard pipeline.',
        blocking: true,
      },
    ],
    rationale:
      'Security testing scheduled separately becomes an event, and events get postponed. In the pipeline it is simply part of whether the change is finished.',
    remediation: 'Move security assertions into the standard suite.',
    references: ['OWASP ASVS v4 §1.14 Configuration Architecture'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'QA-DOC-001',
    version: '1.0.0',
    title: 'A test explains why it exists',
    description:
      'Enough context that someone can decide whether a failure is a defect or an outdated expectation.',
    category: 'TESTING',
    severity: 'ADVISORY',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'test-intent',
        title: 'Non-obvious tests state what they protect against',
        description: 'Particularly regression tests, where the original defect is the whole point.',
        priority: 'COULD',
        verification: 'Review.',
      },
    ],
    rationale:
      'A failing test nobody understands gets deleted. The context that would have saved it was known when it was written and nowhere else.',
    remediation: 'State the defect or property each non-obvious test protects.',
    references: ['xUnit Test Patterns: Tests as Documentation'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'QA-COUNT-001',
    version: '1.0.0',
    title: 'Test count is not a quality measure',
    description:
      'A target number encourages trivial tests, which cost maintenance and detect nothing.',
    category: 'TESTING',
    severity: 'ADVISORY',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'meaningful-tests',
        title: 'Tests are judged by what they would catch',
        description: 'Not by how many there are.',
        priority: 'COULD',
        verification: 'Review of what a sample of tests would detect if the code were wrong.',
      },
    ],
    rationale:
      'Optimising for a count produces tests that assert a constructor sets a field. They pass forever and would not notice the system being broken.',
    remediation: 'Ask of each test what defect it would catch. If the answer is none, delete it.',
    references: ['Goodhart’s law applied to engineering metrics'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'QA-ENV-001',
    version: '1.0.0',
    title: 'The test environment resembles production in the ways that matter',
    description: 'Same engine versions, same runtime, comparable configuration.',
    category: 'TESTING',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'env-parity',
        title: 'Runtime and engine versions match production',
        description: 'Pinned, so a passing suite is evidence about the thing being shipped.',
        priority: 'SHOULD',
        verification: 'Version pinning across CI and production.',
      },
    ],
    rationale:
      'A suite passing on a different runtime version is evidence about a different system.',
    remediation: 'Pin runtime and engine versions across environments.',
    references: ['Twelve-Factor App: dev/prod parity'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'QA-EXCEPTION-001',
    version: '1.0.0',
    title: 'Accepted test failures are recorded with an owner and a date',
    description: 'An exception without an expiry becomes permanent by default.',
    category: 'TESTING',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedGates: [
      {
        gateKey: 'TESTING',
        criterion: 'Accepted failures are recorded with an owner and a review date.',
        blocking: true,
      },
    ],
    rationale:
      'Undated exceptions accumulate. Two years later nobody knows whether the reason still applies, and the safest-seeming action is to leave it.',
    remediation: 'Record who accepted each failure, why, and when it will be reviewed.',
    references: ['ISO/IEC/IEEE 29119-3: test incident reporting'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'QA-SMOKE-001',
    version: '1.0.0',
    title: 'A smoke test runs against production after every release',
    description: 'Against the real hostname, not the deployment’s own health check.',
    category: 'TESTING',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    projectTypeScope: WEB,
    emittedRequirements: [
      {
        key: 'production-smoke',
        title: 'A post-release smoke test exercises the critical path',
        description: 'From outside, as a user would reach it.',
        priority: 'MUST',
        verification: 'A smoke suite run automatically after deployment.',
      },
    ],
    emittedGates: [
      {
        gateKey: 'PRODUCTION_VERIFICATION',
        criterion: 'A post-release smoke test has passed against production.',
        blocking: true,
      },
    ],
    rationale:
      'A deployment reporting success and a system serving users are different claims, and the gap between them is where DNS, certificates and configuration live.',
    remediation: 'Run a smoke suite against the public hostname after each release.',
    references: ['Continuous delivery: release verification'],
    activeFrom: ACTIVE,
  }),
];
