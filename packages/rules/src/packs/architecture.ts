/**
 * Architecture rules, plus the remaining requirements rules.
 *
 * Contract: gap-spec §14 asks for at least 25 architecture rules and 20 requirements rules; ten of
 * the latter are in `discovery.ts` and the rest are here, kept together with the architecture rules
 * they most often interact with.
 *
 * The unifying idea: an architecture decision is a decision that is expensive to reverse. Rules about
 * choices that are cheap to change do not belong here — they are preferences, and a rules engine that
 * enforces preferences trains people to ignore it.
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
const SERVICES = [...WEB, 'API_BACKEND_PLATFORM'];

export const ARCHITECTURE_RULES: readonly Rule[] = [
  defineRule({
    id: 'ARC-ADR-001',
    version: '1.0.0',
    title: 'Decisions that are expensive to reverse are written down',
    description: 'What was chosen, what was rejected, and what would make the decision wrong.',
    category: 'ARCHITECTURE',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'adrs-exist',
        title: 'Significant decisions have a written record',
        description: 'Including the alternatives considered and why they were not chosen.',
        priority: 'MUST',
        verification: 'A decision record per significant choice.',
      },
    ],
    emittedGates: [
      { gateKey: 'ARCHITECTURE', criterion: 'Significant decisions are recorded.', blocking: true },
    ],
    rationale:
      'A decision nobody wrote down gets re-argued, usually by people who lack the original context, and usually at the worst moment. The rejected alternatives are the most valuable part.',
    remediation: 'Write a short record per decision: context, choice, alternatives, consequences.',
    references: ['Nygard: Documenting Architecture Decisions'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'ARC-ADR-002',
    version: '1.0.0',
    title: 'A superseded decision is superseded, not deleted',
    description: 'The record of what was believed is part of the reasoning.',
    category: 'ARCHITECTURE',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    emittedTasks: [
      {
        key: 'supersede-not-delete',
        title: 'Supersede outdated decisions rather than editing them',
        phaseKey: 'design',
      },
    ],
    rationale:
      'Editing a decision record erases why the earlier choice looked right, which is exactly what someone revisiting it needs to know.',
    remediation: 'Mark the old record superseded and link the new one.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'ARC-CONTEXT-001',
    version: '1.0.0',
    title: 'A system context diagram exists before the components do',
    description: 'What is inside the boundary, what is outside, and what crosses it.',
    category: 'ARCHITECTURE',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    projectTypeScope: SERVICES,
    emittedTasks: [{ key: 'system-context', title: 'Draw the system context', phaseKey: 'design' }],
    emittedGates: [
      { gateKey: 'ARCHITECTURE', criterion: 'The system boundary is documented.', blocking: true },
    ],
    rationale:
      'Every integration, every trust boundary and every piece of data leaving the system is visible on a context diagram and invisible in a component list.',
    remediation: 'Draw the system, its users and the external systems it talks to.',
    references: ['C4 model: System Context diagram'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'ARC-COMP-001',
    version: '1.0.0',
    title: 'Components are identified before work is estimated against them',
    description:
      'Estimating against an undivided system produces one large number and no structure.',
    category: 'ARCHITECTURE',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedGates: [
      {
        gateKey: 'ARCHITECTURE',
        criterion: 'The major components are identified.',
        blocking: true,
      },
    ],
    rationale:
      'Work attaches to components. Without them, estimates cannot be decomposed, checked or parallelised.',
    remediation: 'List the major components and what each is responsible for.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'ARC-DATA-001',
    version: '1.0.0',
    title: 'The data model is designed before the schema is written',
    description: 'What entities exist, what they mean, and what must always be true of them.',
    category: 'ARCHITECTURE',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'data-model',
        title: 'Entities, relationships and invariants are recorded',
        description:
          'Including which invariants the database enforces rather than the application.',
        priority: 'MUST',
        verification: 'A data model document, and constraints in the schema matching it.',
      },
    ],
    rationale:
      'Data outlives code. A schema that encodes the wrong model constrains every future change, and migrating data is far harder than rewriting logic.',
    remediation: 'Model the entities and their invariants before writing the schema.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'ARC-DATA-002',
    version: '1.0.0',
    title: 'Invariants belong in the database where the database can hold them',
    description:
      'Application-only invariants hold until something writes without going through it.',
    category: 'ARCHITECTURE',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'db-constraints',
        title: 'Structural invariants are database constraints',
        description: 'Foreign keys, uniqueness, check constraints and not-null.',
        priority: 'SHOULD',
        verification: 'Tests that attempt to violate each constraint directly.',
      },
    ],
    rationale:
      'Migrations, scripts, admin tools and future services all write to the database. Only the database sees every write.',
    remediation: 'Express structural invariants as constraints, and test them with direct writes.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'ARC-INTEG-001',
    version: '1.0.0',
    title: 'Integration boundaries state what happens when they fail',
    description: 'Timeouts, retries and the behaviour when the other side is unavailable.',
    category: 'ARCHITECTURE',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    projectTypeScope: SERVICES,
    emittedRequirements: [
      {
        key: 'integration-failure-behaviour',
        title: 'Each integration has a defined failure behaviour',
        description: 'A timeout, a retry policy, and a decision about degrading or refusing.',
        priority: 'MUST',
        verification: 'A test simulating each integration being unavailable and slow.',
      },
    ],
    rationale:
      'An integration with no timeout inherits the other system’s worst latency, and one slow dependency then consumes every connection you have.',
    remediation: 'Set explicit timeouts, decide the degradation behaviour, and test both.',
    references: ['Nygard: Release It! — Circuit Breaker, Timeouts'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'ARC-IDEMPOTENT-001',
    version: '1.0.0',
    title: 'Anything that can be retried must be safe to retry',
    description: 'Networks retry without asking, so operations must tolerate repetition.',
    category: 'ARCHITECTURE',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    projectTypeScope: SERVICES,
    emittedRequirements: [
      {
        key: 'idempotent-operations',
        title: 'Operations with side effects are idempotent',
        description: 'Via an idempotency key or a natural uniqueness constraint.',
        priority: 'MUST',
        verification: 'A test that repeats each operation and asserts one effect.',
      },
    ],
    rationale:
      'A payment taken twice because a connection dropped is not a rare edge case; it is what happens on mobile networks routinely.',
    remediation: 'Add idempotency keys to operations with side effects.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'ARC-STATE-001',
    version: '1.0.0',
    title: 'State transitions are validated centrally',
    description: 'One place decides which transitions are legal, and everything goes through it.',
    category: 'ARCHITECTURE',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'central-state-machine',
        title: 'Status changes go through a single validated path',
        description: 'No direct writes to a status column from feature code.',
        priority: 'MUST',
        verification: 'Tests for every allowed and prohibited transition.',
      },
    ],
    rationale:
      'Status logic spread across features means each one has its own idea of what is legal, and a status field then reflects who clicked what rather than what is true.',
    remediation: 'Define the transitions in one place and route every change through it.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'ARC-AUTH-001',
    version: '1.0.0',
    title: 'Authorisation is a layer, not a per-endpoint decision',
    description: 'One model, applied consistently, rather than a check written at each handler.',
    category: 'ARCHITECTURE',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    projectTypeScope: SERVICES,
    emittedRequirements: [
      {
        key: 'authorisation-layer',
        title: 'Authorisation decisions come from one model',
        description: 'Deny by default, with permissions declared rather than inferred.',
        priority: 'MUST',
        verification: 'A permissions matrix generated from the code, and tests per role.',
      },
    ],
    rationale:
      'Per-endpoint checks diverge. The endpoint written in a hurry is the one missing the check, and it looks exactly like the others.',
    remediation: 'Centralise the permission model and generate the matrix from it.',
    references: ['OWASP ASVS v4 §4 Access Control'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'ARC-TENANT-001',
    version: '1.0.0',
    title: 'Multi-tenancy is decided at the start',
    description: 'Retrofitting tenant isolation into a single-tenant schema is close to a rewrite.',
    category: 'ARCHITECTURE',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    projectTypeScope: ['SAAS_WEB_APP'],
    emittedRequirements: [
      {
        key: 'tenancy-model',
        title: 'The tenancy model is recorded and applied everywhere',
        description: 'Every table, every query, every export and every background job.',
        priority: 'MUST',
        verification: 'A cross-tenant test suite covering every read path.',
      },
    ],
    rationale:
      'Every query, index and constraint depends on the tenancy decision. Adding a tenant column afterwards means revisiting all of them, and missing one is a data leak.',
    remediation: 'Decide the tenancy model before the first table, and record it.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'ARC-ENV-001',
    version: '1.0.0',
    title: 'Environments are defined and differ only in configuration',
    description: 'Same artefact, different settings.',
    category: 'ARCHITECTURE',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'environment-parity',
        title: 'Environments differ by configuration only',
        description: 'The same build is promoted rather than rebuilt per environment.',
        priority: 'MUST',
        verification: 'The deployment pipeline promotes a single artefact.',
      },
    ],
    rationale:
      'Rebuilding per environment means what was tested is not what ships, and the difference is invisible until it matters.',
    remediation: 'Build once, promote the artefact, and vary only configuration.',
    references: ['Twelve-Factor App: Build, release, run'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'ARC-CONFIG-001',
    version: '1.0.0',
    title: 'Configuration comes from the environment',
    description: 'Not from files committed per environment.',
    category: 'ARCHITECTURE',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'env-configuration',
        title: 'Configuration is external to the artefact',
        description: 'Validated at startup, with the process refusing to serve if it is invalid.',
        priority: 'MUST',
        verification: 'A test that startup fails on missing required configuration.',
      },
    ],
    rationale:
      'Committed per-environment configuration eventually contains a secret, and it forces a code change to alter an operational setting.',
    remediation: 'Read configuration from the environment and validate it at startup.',
    references: ['Twelve-Factor App: Config'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'ARC-OBSERVE-001',
    version: '1.0.0',
    title: 'Observability is designed in, not added during the first incident',
    description: 'Structured logs, correlation identifiers and metrics chosen deliberately.',
    category: 'ARCHITECTURE',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    projectTypeScope: SERVICES,
    emittedRequirements: [
      {
        key: 'observability',
        title: 'Requests are traceable end to end',
        description:
          'A correlation identifier that follows a request through every component and log line.',
        priority: 'MUST',
        verification: 'A test asserting the identifier appears in every log entry for one request.',
      },
    ],
    rationale:
      'Without correlation, diagnosing a distributed failure means reading several logs and guessing which lines belong together — during an outage.',
    remediation: 'Generate a correlation identifier per request and include it in every log line.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'ARC-ASYNC-001',
    version: '1.0.0',
    title: 'Background work needs a delivery guarantee',
    description: 'What happens if the process dies mid-job must be a decision, not a discovery.',
    category: 'ARCHITECTURE',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    projectTypeScope: SERVICES,
    emittedRequirements: [
      {
        key: 'job-durability',
        title: 'Background jobs survive a process restart',
        description: 'Durable queueing, retry with backoff, and a dead-letter path.',
        priority: 'MUST',
        verification: 'A test that kills the worker mid-job and asserts the job completes.',
      },
    ],
    rationale:
      'In-memory job queues lose work on every deploy, and the loss is silent — the user is told it succeeded because the request returned.',
    remediation: 'Use a durable queue with retries and a dead-letter destination.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'ARC-ASYNC-002',
    version: '1.0.0',
    title: 'Events that must not be lost use the outbox pattern',
    description: 'Writing to the database and publishing an event are not one atomic operation.',
    category: 'ARCHITECTURE',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    projectTypeScope: SERVICES,
    emittedRequirements: [
      {
        key: 'transactional-outbox',
        title: 'Events are written in the same transaction as the data',
        description: 'And published from there by a separate process.',
        priority: 'SHOULD',
        verification:
          'A test that fails the publish and asserts the event is still delivered later.',
      },
    ],
    rationale:
      'Committing the row and then publishing the event leaves a window where the row exists and the event does not. Under load, that window is hit regularly.',
    remediation:
      'Write events to an outbox table in the same transaction and publish asynchronously.',
    references: ['Transactional outbox pattern'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'ARC-CACHE-001',
    version: '1.0.0',
    title: 'Every cache states how it is invalidated',
    description: 'A cache with no invalidation strategy serves stale data indefinitely.',
    category: 'ARCHITECTURE',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'cache-invalidation',
        title: 'Each cache has a stated lifetime and invalidation trigger',
        description: 'And a decision about what stale data would mean for correctness.',
        priority: 'SHOULD',
        verification: 'A test asserting the cache reflects a change within the stated window.',
      },
    ],
    rationale:
      'Caching added for performance without an invalidation plan converts a slow correct system into a fast wrong one.',
    remediation: 'Give each cache an explicit lifetime and invalidation trigger.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'ARC-SCALE-001',
    version: '1.0.0',
    title: 'Scaling limits are known before they are reached',
    description: 'Which component saturates first, and at roughly what load.',
    category: 'ARCHITECTURE',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
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
        key: 'identify-bottleneck',
        title: 'Identify the first component to saturate',
        phaseKey: 'design',
      },
    ],
    rationale:
      'Knowing the bottleneck in advance turns a capacity problem into a planned upgrade rather than an outage.',
    remediation: 'Estimate where the first limit is and what would be done about it.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'ARC-STATELESS-001',
    version: '1.0.0',
    title: 'Application processes hold no state that matters',
    description: 'Anything worth keeping goes in a database, a cache or a queue.',
    category: 'ARCHITECTURE',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    projectTypeScope: SERVICES,
    emittedRequirements: [
      {
        key: 'stateless-processes',
        title: 'A process can be restarted at any moment without loss',
        description: 'No in-memory sessions, no local file state that is not reproducible.',
        priority: 'SHOULD',
        verification: 'A test that restarts the process mid-session and asserts continuity.',
      },
    ],
    rationale:
      'In-process state prevents horizontal scaling and makes every deployment a small outage for whoever was mid-session.',
    remediation: 'Move session and job state out of the process.',
    references: ['Twelve-Factor App: Processes'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'ARC-DEP-001',
    version: '1.0.0',
    title: 'A dependency is a decision with a maintenance cost',
    description: 'Each one is code you did not write, running with your privileges, forever.',
    category: 'ARCHITECTURE',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    emittedTasks: [
      {
        key: 'justify-dependencies',
        title: 'Record why each significant dependency was chosen',
        phaseKey: 'design',
      },
    ],
    rationale:
      'Dependencies are adopted in minutes and removed over weeks. The moment of adoption is the only cheap moment to say no.',
    remediation:
      'For significant dependencies, record the alternative considered and the exit cost.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'ARC-COUPLE-001',
    version: '1.0.0',
    title: 'Two components must not share a database table',
    description: 'A shared table is a shared schema, and a shared schema is one component.',
    category: 'ARCHITECTURE',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'no-shared-tables',
        title: 'Each table has one owning component',
        description: 'Others read through an interface, not by querying directly.',
        priority: 'SHOULD',
        verification: 'A review of which components write which tables.',
      },
    ],
    rationale:
      'Components sharing tables cannot be changed, deployed or reasoned about independently — they are one component that merely appears to be two.',
    remediation: 'Give each table one owner and expose access through an interface.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'ARC-VERSION-001',
    version: '1.0.0',
    title: 'Published interfaces have a versioning and deprecation policy',
    description: 'Written before the first consumer, not after the first breakage.',
    category: 'ARCHITECTURE',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    projectTypeScope: ['API_BACKEND_PLATFORM'],
    emittedRequirements: [
      {
        key: 'api-versioning',
        title: 'The versioning and deprecation policy is published',
        description: 'How breaking changes are announced and how long old versions survive.',
        priority: 'MUST',
        verification: 'Published documentation.',
      },
    ],
    rationale:
      'Without a policy, every change is potentially breaking for someone, and there is no agreed way to find out before it breaks.',
    remediation:
      'Publish the versioning scheme and deprecation timeline before the first consumer.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'ARC-MIGRATE-001',
    version: '1.0.0',
    title: 'Schema changes are migrations, applied the same way everywhere',
    description: 'Not hand-applied statements that exist only in someone’s history.',
    category: 'ARCHITECTURE',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'versioned-migrations',
        title: 'Schema changes are versioned and repeatable',
        description: 'Applied identically in every environment, in a known order.',
        priority: 'MUST',
        verification: 'A migration test that builds the schema from empty.',
      },
    ],
    rationale:
      'A schema that exists only as the result of statements someone ran cannot be recreated, which makes a new environment or a restore an act of archaeology.',
    remediation: 'Put schema changes in versioned migrations and apply them through the pipeline.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'ARC-MIGRATE-002',
    version: '1.0.0',
    title: 'Migrations are backwards compatible for one release',
    description:
      'So the old code can run against the new schema while a deployment is in progress.',
    category: 'ARCHITECTURE',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    projectTypeScope: SERVICES,
    emittedRequirements: [
      {
        key: 'expand-contract',
        title: 'Schema changes expand before they contract',
        description: 'Add the new shape, migrate, then remove the old one in a later release.',
        priority: 'SHOULD',
        verification: 'A test running the previous release against the new schema.',
      },
    ],
    rationale:
      'During a rolling deployment both versions run at once. A migration that removes a column immediately breaks every instance that has not yet been replaced.',
    remediation: 'Split destructive migrations across two releases.',
    references: ['Expand and contract migration pattern'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'ARC-SECRET-001',
    version: '1.0.0',
    title: 'The architecture says where secrets live',
    description: 'Which secrets exist, where they are stored, and who can read them.',
    category: 'ARCHITECTURE',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    emittedRequirements: [
      {
        key: 'secret-inventory',
        title: 'Secrets are inventoried with their storage and access',
        description: 'So rotation is a known procedure rather than an investigation.',
        priority: 'MUST',
        verification: 'A secret inventory with storage location and rotation procedure.',
      },
    ],
    rationale:
      'During an incident, the first question is which credentials are exposed. An inventory answers it in minutes; its absence turns the response into a search.',
    remediation: 'List each secret, where it is stored, who can read it, and how it is rotated.',
    references: ['OWASP ASVS v4 §6.4 Secret Management'],
    activeFrom: ACTIVE,
  }),

  /* ------------------------------------------- Remaining requirements rules */

  defineRule({
    id: 'REQ-AMBIG-001',
    version: '1.0.0',
    title: 'Ambiguous words in requirements are resolved before build',
    description:
      '"Quickly", "user-friendly", "flexible" and "robust" each mean different things to different readers.',
    category: 'REQUIREMENTS',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    emittedTasks: [
      {
        key: 'resolve-ambiguity',
        title: 'Replace ambiguous terms with specifics',
        phaseKey: 'design',
      },
    ],
    rationale:
      'Ambiguity is resolved during implementation, by whoever is implementing, according to what they assumed — and nobody discovers the mismatch until acceptance.',
    remediation: 'Replace subjective terms with a measurable statement.',
    references: ['ISO/IEC/IEEE 29148 §5.2.4 Unambiguous'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'REQ-ASSUME-001',
    version: '1.0.0',
    title: 'A requirement built on an assumption records it',
    description: 'So that when the assumption changes, the affected requirements can be found.',
    category: 'REQUIREMENTS',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    emittedTasks: [
      {
        key: 'link-assumptions',
        title: 'Link requirements to the assumptions they rest on',
        phaseKey: 'design',
      },
    ],
    rationale:
      'When an assumption turns out wrong, the question is what else has to change. Without links, the answer is found by reading everything.',
    remediation: 'Link each requirement to the assumptions underlying it.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'REQ-REGRESS-001',
    version: '1.0.0',
    title: 'A requirement that is removed is recorded as removed',
    description: 'Deleting it makes the change invisible at review.',
    category: 'REQUIREMENTS',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedGates: [
      {
        gateKey: 'COMPLETION',
        criterion: 'Removed requirements are recorded rather than deleted.',
        blocking: false,
      },
    ],
    rationale:
      'A requirement that vanishes cannot be distinguished from one that was never agreed, which makes it impossible to say what the project committed to.',
    remediation: 'Mark removed requirements as withdrawn, with a reason.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'REQ-STAKE-001',
    version: '1.0.0',
    title: 'Every requirement has someone who can decide about it',
    description: 'An unowned requirement cannot be clarified, prioritised or withdrawn.',
    category: 'REQUIREMENTS',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    emittedTasks: [
      {
        key: 'assign-requirement-owners',
        title: 'Name a decision-maker per requirement area',
        phaseKey: 'design',
      },
    ],
    rationale:
      'Requirements with no owner are the ones that stall, because the question of what they mean has no addressee.',
    remediation: 'Name who decides for each requirement area.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'REQ-DATA-001',
    version: '1.0.0',
    title: 'Requirements touching personal data name the data',
    description: 'Which fields, for what purpose, and for how long.',
    category: 'REQUIREMENTS',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    conditions: [
      {
        subject: 'INTAKE',
        key: 'data.types',
        operator: 'INCLUDES_ANY',
        value: ['Personal data', 'Health data', 'Financial data'],
      },
    ],
    requiredInputs: ['data.types'],
    emittedRequirements: [
      {
        key: 'data-minimisation',
        title: 'Each feature collects only the data it needs',
        description: 'Named fields, stated purpose, stated retention.',
        priority: 'MUST',
        verification: 'A review of collected fields against stated purposes.',
      },
    ],
    rationale:
      'Data collected "in case it is useful" is data that must be protected, disclosed on request and deleted on demand, for no benefit that was ever articulated.',
    remediation: 'For each feature, list the personal data it needs and why.',
    references: ['UK GDPR Article 5(1)(c) Data minimisation'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'REQ-ERROR-001',
    version: '1.0.0',
    title: 'Requirements say what happens when things go wrong',
    description: 'The failure behaviour is part of the requirement, not an implementation detail.',
    category: 'REQUIREMENTS',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    emittedTasks: [
      {
        key: 'specify-error-behaviour',
        title: 'Specify failure behaviour per requirement',
        phaseKey: 'design',
      },
    ],
    rationale:
      'Unspecified failure behaviour is invented during implementation and discovered by users, and it is usually the part that determines whether they trust the system.',
    remediation: 'For each requirement, state what should happen when it cannot be satisfied.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'REQ-LEGACY-001',
    version: '1.0.0',
    title: 'Replacing something means knowing what it currently does',
    description: 'Including the behaviour nobody documented but somebody depends on.',
    category: 'REQUIREMENTS',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    conditions: [{ subject: 'INTAKE', key: 'code.existing', operator: 'IS_ANSWERED' }],
    requiredInputs: ['code.existing'],
    emittedTasks: [
      {
        key: 'catalogue-existing-behaviour',
        title: 'Catalogue the behaviour being replaced',
        phaseKey: 'discovery',
      },
    ],
    emittedRisks: [
      {
        key: 'undocumented-behaviour',
        title: 'Undocumented behaviour will be discovered by removing it',
        description: 'Usually by the one user whose workflow depended on it.',
        likelihood: 'HIGH',
        impact: 'MEDIUM',
      },
    ],
    rationale:
      'A replacement judged against the documentation rather than the behaviour will be missing whatever was never written down, which is most of it.',
    remediation: 'Catalogue actual behaviour, including from usage data, before replacing it.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'REQ-BASELINE-001',
    version: '1.0.0',
    title: 'Requirements are baselined before build starts',
    description: 'So that later changes are visible as changes.',
    category: 'REQUIREMENTS',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedGates: [
      { gateKey: 'PLANNING', criterion: 'The requirements have been baselined.', blocking: true },
    ],
    rationale:
      'Without a baseline there is nothing to compare against, so scope change is undetectable and the final argument is about what was agreed.',
    remediation: 'Take an immutable snapshot of the requirements when the plan is approved.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'REQ-DUP-001',
    version: '1.0.0',
    title: 'The same requirement stated twice will diverge',
    description: 'One copy gets updated and the other does not.',
    category: 'REQUIREMENTS',
    severity: 'ADVISORY',
    source: 'RECOMMENDED_DEFAULT',
    emittedTasks: [
      {
        key: 'deduplicate-requirements',
        title: 'Merge duplicated requirements',
        phaseKey: 'design',
      },
    ],
    rationale:
      'Duplicated requirements produce contradictory acceptance criteria, and whichever one the implementer found first wins.',
    remediation: 'Merge duplicates and reference the single statement.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'REQ-COMPLIANCE-001',
    version: '1.0.0',
    title: 'Compliance obligations become requirements, not a separate list',
    description: 'A parallel compliance list is a list nobody builds from.',
    category: 'REQUIREMENTS',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    conditions: [{ subject: 'INTAKE', key: 'compliance.regimes', operator: 'IS_ANSWERED' }],
    requiredInputs: ['compliance.regimes'],
    emittedRequirements: [
      {
        key: 'compliance-as-requirements',
        title: 'Each obligation appears as a requirement with verification',
        description: 'In the same backlog as everything else, so it is planned and estimated.',
        priority: 'MUST',
        verification: 'Each obligation traces to a requirement and to evidence.',
      },
    ],
    rationale:
      'Compliance kept in a separate document is discovered at the audit, when the work it implies has not been estimated or scheduled.',
    remediation: 'Convert each obligation into a requirement with a verification method.',
    references: [
      'ISO/IEC 27001:2022 §6.1.3 Information security risk treatment',
      'UK GDPR Article 24 Responsibility of the controller',
    ],
    activeFrom: ACTIVE,
  }),
];
