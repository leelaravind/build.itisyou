# RULE FORMAT SPECIFICATION

> **Generated file — do not edit by hand.**
> Source of truth: `packages/rules/src/`. Regenerate with `pnpm docs:rules`.
> CI runs `pnpm docs:rules --check` and fails if this file has drifted from the code.

**Contract:** `IMPLEMENTATION_GAP_CLOSURE_SPEC.md` §13 (formal DSL, determinism, precedence,
explanations) and §14 (the initial catalogue); `MASTER_IMPLEMENTATION_PLAN.md` §7 (the deterministic
rules engine).

**Rule format version:** 1.0.0 · **Ruleset version:** 1.0.0

---

## 1. Why the rules are data

A rule written as code can do anything: read a clock, call a service, mutate the project it is
evaluating. A rule written as data can only *describe* a condition and *declare* what follows, and
the evaluator decides what that means. Three properties follow, and none are achievable with
rules-as-functions:

- **Determinism is structural.** §13.1 requires that the same project version, ruleset version and
  inputs produce the same result. A declarative condition has nowhere to hide a clock.
- **Explanations are free.** §13.3 requires every emitted action to answer "why is this required?"
  A rule carrying its own rationale, remediation and references answers that without per-rule
  explanation code, which would rot immediately.
- **Rules can be reviewed by people who do not read TypeScript.** A security rule only a developer
  can audit is a security rule nobody audits.

The condition language is deliberately small. It expresses field comparisons, set membership,
presence and boolean combination, and cannot express arbitrary computation. That limit is the point:
an expression language rich enough to be convenient is rich enough to be non-deterministic.

---

## 2. Rule fields

| Field | Required | Meaning |
|---|:-:|---|
| `id` | ✅ | Structured, e.g. `SEC-WEB-AUTH-001`. Locatable by prefix without a lookup table. |
| `version` | ✅ | Bumped when the rule's meaning changes. A stored finding keeps the version that produced it. |
| `title` | ✅ | One line, shown in findings. |
| `description` | ✅ | What the rule requires. |
| `category` | ✅ | One of the 14 below. |
| `severity` | ✅ | `MANDATORY`, `RECOMMENDED`, `ADVISORY`. |
| `source` | ✅ | Where the authority comes from. Decides conflicts. |
| `projectTypeScope` | | Empty means every type. |
| `lifecycleScope` | | Empty means every state. |
| `methodologyScope` | | Empty means every methodology. |
| `conditionMode` | | `ALL` or `ANY`. |
| `conditions` | | Empty means the rule applies wherever it is in scope. |
| `requiredInputs` | | Intake fields needed before the rule can be evaluated at all. |
| `emittedRequirements` | | Each carries a mandatory `verification`. |
| `emittedTasks` | | |
| `emittedTests` | | |
| `emittedGates` | | Criteria attached to a gate. |
| `emittedRisks` | | |
| `calculationEffects` | | Declarative, with ranges rather than single figures. |
| `rationale` | ✅ | §13.3: why is this required? |
| `remediation` | ✅ | What to do about it. A finding with no remediation is a complaint. |
| `references` | | Required for mandatory legal/security rules. |
| `activeFrom` | ✅ | |
| `deprecatedFrom` | | A withdrawn rule stays in the catalogue so stored findings remain explainable. |

### Refused at definition time

`defineRule` refuses a rule that:

- emits nothing and affects no calculation — it would count towards the total and do nothing;
- is mandatory, legal or security, and cites no source — an uncitable obligation becomes folklore
  that nobody can challenge or retire;
- has a test claiming to verify a requirement the rule does not emit — a traceability arrow pointing
  at nothing;
- is deprecated before it becomes active;
- reuses an emission key within itself.

---

## 3. Conditions

**Subjects:** `INTAKE`, `PROJECT`, `GRAPH`, `METHODOLOGY`, `LIFECYCLE`.

**Operators:** `EQUALS`, `NOT_EQUALS`, `IN`, `NOT_IN`, `INCLUDES_ANY`, `INCLUDES_ALL`, `IS_ANSWERED`, `IS_UNANSWERED`, `IS_TRUE`, `IS_FALSE`, `GREATER_THAN`, `LESS_THAN`, `EXISTS`, `NOT_EXISTS`.

`IS_ANSWERED` is deliberately separate from `EXISTS`. An intake field can hold a value while its
state says the user does not know — the value is the marker they chose — so "has a row" and "the user
committed to an answer" are different questions. Conflating them is how a plan comes to treat "I
don't know" as a fact.

### The three outcomes

| Outcome | Meaning |
|---|---|
| `APPLIED` | Conditions met. Emissions produced. |
| `NOT_APPLICABLE` | Conditions genuinely not met. |
| `INDETERMINATE` | The rule needs an input the project has not answered. |

The third is the one that matters. An engine with only the first two silently reports "does not
apply" for every rule blocked by missing information — which is how a project comes to look compliant
because nobody filled in the form. A security rule conditioned on "the system holds payment data"
must not quietly not apply to every project that skipped the question.

---

## 4. Precedence (§13.2)

Most authoritative first:

1. `LEGAL_SECURITY` — a legal or security obligation
2. `ORGANIZATION_POLICY` — organisation policy
3. `PROJECT_CONSTRAINT` — an explicit project constraint
4. `PROJECT_TYPE_PACK` — the project-type rules
5. `METHODOLOGY_PACK` — the methodology rules
6. `RECOMMENDED_DEFAULT` — a recommended default

The order is an argument, not a list. Legal and security obligations sit above organisational policy
because an organisation cannot policy its way out of the law. Explicit project constraints sit above
the project-type pack because the person doing the work knows something the taxonomy does not.
Recommended defaults sit last because that is what a default is.

### Conflicts are not always resolved

§13.2: **"Never resolve conflicting critical rules silently."**

| Situation | Outcome |
|---|---|
| Different sources, at most one mandatory | Resolved by precedence; what was overridden is recorded. |
| Two mandatory rules, different sources | **Unresolvable.** Reported, and the emission is withheld. |
| Two mandatory rules, same source | **Unresolvable**, and reported as a defect in the ruleset. |
| Equal precedence, neither mandatory | **Unresolvable** — precedence is the only tiebreaker and it has run out. |

Emitting one side of an unresolvable conflict would be resolving it, quietly, in favour of whichever
rule happened to be evaluated first.

---

## 5. The catalogue

| Category | Minimum (gap-spec §14) | In the catalogue |
|---|--:|--:|
| `INTAKE` | 20 | 20 |
| `REQUIREMENTS` | 20 | 20 |
| `ARCHITECTURE` | 25 | 25 |
| `PLANNING` | 20 | 20 |
| `RESOURCE` | 15 | 15 |
| `BUDGET` | 20 | 20 |
| `TESTING` | 35 | 37 |
| `SECURITY` | 35 | 50 |
| `ACCESSIBILITY` | 10 | 10 |
| `DEPLOYMENT` | 20 | 20 |
| `PRODUCTION_VERIFICATION` | 15 | 15 |
| `OPERATIONS` | 10 | 10 |
| `DOCUMENTATION` | 10 | 10 |
| `GOVERNANCE` | 15 | 15 |
| **Total** | **270** | **287** |

**186** mandatory, **91**
recommended, **10** advisory.
**137** cite an external source.
Between them the rules emit **139** requirements,
**39** tests and **73** gate criteria.

Gap-spec §14: *"The rules must be meaningful. Do not create artificial rules solely to meet a
number."* The counts above are a floor rather than a target, and the refusals in §2 are what make a
padded rule difficult to write: a rule has to make a specific claim about a specific consequence to
survive definition.

### INTAKE (20)

| Id | Title | Severity | Applies to |
|---|---|---|---|
| `DIS-OBJ-001` | A project needs a stated objective before it needs a plan | MANDATORY | all project types |
| `DIS-OBJ-002` | An objective should be observable | RECOMMENDED | all project types |
| `DIS-TYPE-001` | Project type selects the rule packs, so it is not optional | MANDATORY | all project types |
| `DIS-USER-001` | Who this is for changes almost every decision | RECOMMENDED | all project types |
| `DIS-DATA-001` | What data is held decides the entire compliance surface | MANDATORY | all project types |
| `DIS-SCOPE-001` | A fixed deadline needs an agreed scope | MANDATORY | all project types |
| `DIS-BUDGET-001` | Without a budget the plan has no ceiling to check against | RECOMMENDED | all project types |
| `DIS-TEAM-001` | A team of one has no redundancy | RECOMMENDED | all project types |
| `DIS-SKILL-001` | Unstated skill gaps come out of the schedule anyway | RECOMMENDED | all project types |
| `DIS-EXIST-001` | Existing code and infrastructure constrain what is possible | RECOMMENDED | all project types |
| `DIS-THIRD-001` | Third parties are dependencies with their own timelines | RECOMMENDED | all project types |
| `DIS-UNKNOWN-001` | An unknown must be recorded to be planned around | MANDATORY | all project types |
| `DIS-ASSUME-001` | An assumption must say what breaks if it is wrong | RECOMMENDED | all project types |
| `DIS-COMPLIANCE-001` | Named compliance regimes change the plan structurally | MANDATORY | all project types |
| `DIS-AVAIL-001` | High availability is a cost, not an adjective | RECOMMENDED | all project types |
| `DIS-A11Y-001` | Accessibility is decided at the start or paid for at the end | MANDATORY | all project types |
| `DIS-MAINT-001` | Who maintains it afterwards changes what should be built | RECOMMENDED | all project types |
| `DIS-RESEARCH-001` | Deferred research must be recorded as deferred | RECOMMENDED | all project types |
| `DIS-CAPACITY-001` | Available hours are not the same as headcount | RECOMMENDED | all project types |
| `DIS-DOMAIN-001` | Domains and certificates have lead times | ADVISORY | all project types |

### REQUIREMENTS (20)

| Id | Title | Severity | Applies to |
|---|---|---|---|
| `REQ-VERIFY-001` | Every requirement states how it will be verified | MANDATORY | all project types |
| `REQ-ATOMIC-001` | A requirement covers one thing | RECOMMENDED | all project types |
| `REQ-TRACE-001` | Every requirement traces to an objective | MANDATORY | all project types |
| `REQ-PRIORITY-001` | Priorities have to distinguish things | RECOMMENDED | all project types |
| `REQ-NFR-001` | Non-functional requirements need numbers | MANDATORY | all project types |
| `REQ-CONFLICT-001` | Contradictory requirements must be resolved, not averaged | MANDATORY | all project types |
| `REQ-CHANGE-001` | Requirement changes after a baseline go through change control | MANDATORY | all project types |
| `REQ-ACCEPT-001` | Acceptance criteria are written before the work, not after | RECOMMENDED | all project types |
| `REQ-SCOPE-001` | What is out of scope is recorded too | RECOMMENDED | all project types |
| `REQ-USER-001` | Requirements describe behaviour, not implementation | ADVISORY | all project types |
| `REQ-AMBIG-001` | Ambiguous words in requirements are resolved before build | RECOMMENDED | all project types |
| `REQ-ASSUME-001` | A requirement built on an assumption records it | RECOMMENDED | all project types |
| `REQ-REGRESS-001` | A requirement that is removed is recorded as removed | MANDATORY | all project types |
| `REQ-STAKE-001` | Every requirement has someone who can decide about it | RECOMMENDED | all project types |
| `REQ-DATA-001` | Requirements touching personal data name the data | MANDATORY | all project types |
| `REQ-ERROR-001` | Requirements say what happens when things go wrong | RECOMMENDED | all project types |
| `REQ-LEGACY-001` | Replacing something means knowing what it currently does | MANDATORY | all project types |
| `REQ-BASELINE-001` | Requirements are baselined before build starts | MANDATORY | all project types |
| `REQ-DUP-001` | The same requirement stated twice will diverge | ADVISORY | all project types |
| `REQ-COMPLIANCE-001` | Compliance obligations become requirements, not a separate list | MANDATORY | all project types |

### ARCHITECTURE (25)

| Id | Title | Severity | Applies to |
|---|---|---|---|
| `ARC-ADR-001` | Decisions that are expensive to reverse are written down | MANDATORY | all project types |
| `ARC-ADR-002` | A superseded decision is superseded, not deleted | RECOMMENDED | all project types |
| `ARC-CONTEXT-001` | A system context diagram exists before the components do | MANDATORY | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP, API_BACKEND_PLATFORM |
| `ARC-COMP-001` | Components are identified before work is estimated against them | MANDATORY | all project types |
| `ARC-DATA-001` | The data model is designed before the schema is written | MANDATORY | all project types |
| `ARC-DATA-002` | Invariants belong in the database where the database can hold them | RECOMMENDED | all project types |
| `ARC-INTEG-001` | Integration boundaries state what happens when they fail | MANDATORY | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP, API_BACKEND_PLATFORM |
| `ARC-IDEMPOTENT-001` | Anything that can be retried must be safe to retry | MANDATORY | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP, API_BACKEND_PLATFORM |
| `ARC-STATE-001` | State transitions are validated centrally | MANDATORY | all project types |
| `ARC-AUTH-001` | Authorisation is a layer, not a per-endpoint decision | MANDATORY | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP, API_BACKEND_PLATFORM |
| `ARC-TENANT-001` | Multi-tenancy is decided at the start | MANDATORY | SAAS_WEB_APP |
| `ARC-ENV-001` | Environments are defined and differ only in configuration | MANDATORY | all project types |
| `ARC-CONFIG-001` | Configuration comes from the environment | MANDATORY | all project types |
| `ARC-OBSERVE-001` | Observability is designed in, not added during the first incident | MANDATORY | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP, API_BACKEND_PLATFORM |
| `ARC-ASYNC-001` | Background work needs a delivery guarantee | MANDATORY | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP, API_BACKEND_PLATFORM |
| `ARC-ASYNC-002` | Events that must not be lost use the outbox pattern | RECOMMENDED | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP, API_BACKEND_PLATFORM |
| `ARC-CACHE-001` | Every cache states how it is invalidated | RECOMMENDED | all project types |
| `ARC-SCALE-001` | Scaling limits are known before they are reached | RECOMMENDED | all project types |
| `ARC-STATELESS-001` | Application processes hold no state that matters | RECOMMENDED | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP, API_BACKEND_PLATFORM |
| `ARC-DEP-001` | A dependency is a decision with a maintenance cost | RECOMMENDED | all project types |
| `ARC-COUPLE-001` | Two components must not share a database table | RECOMMENDED | all project types |
| `ARC-VERSION-001` | Published interfaces have a versioning and deprecation policy | MANDATORY | API_BACKEND_PLATFORM |
| `ARC-MIGRATE-001` | Schema changes are migrations, applied the same way everywhere | MANDATORY | all project types |
| `ARC-MIGRATE-002` | Migrations are backwards compatible for one release | RECOMMENDED | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP, API_BACKEND_PLATFORM |
| `ARC-SECRET-001` | The architecture says where secrets live | MANDATORY | all project types |

### PLANNING (20)

| Id | Title | Severity | Applies to |
|---|---|---|---|
| `PLN-WBS-001` | Work is broken down before it is scheduled | MANDATORY | all project types |
| `PLN-WBS-002` | A work item longer than about a week is not understood yet | RECOMMENDED | all project types |
| `PLN-DEP-001` | Dependencies must form no cycles | MANDATORY | all project types |
| `PLN-DEP-002` | External dependencies get lead times, not assumptions | MANDATORY | all project types |
| `PLN-CRIT-001` | The critical path is identified | RECOMMENDED | all project types |
| `PLN-MILE-001` | Milestones are verifiable, not calendar dates | MANDATORY | all project types |
| `PLN-BUFFER-001` | Contingency is explicit and held centrally | RECOMMENDED | all project types |
| `PLN-PARALLEL-001` | Parallel work needs people to be parallel | MANDATORY | all project types |
| `PLN-RISK-001` | An empty risk register means nobody looked | MANDATORY | all project types |
| `PLN-RISK-002` | A risk needs a mitigation and an owner | RECOMMENDED | all project types |
| `PLN-SEQ-001` | Riskiest work goes first where it can | RECOMMENDED | all project types |
| `PLN-GATE-001` | Every phase has an exit criterion | MANDATORY | all project types |
| `PLN-REPLAN-001` | A plan that has been overtaken is replanned, not ignored | RECOMMENDED | all project types |
| `PLN-METHOD-001` | Methodology never removes a mandatory security or release gate | MANDATORY | all project types |
| `PLN-ITER-001` | Iterations end with something demonstrable | RECOMMENDED | all project types |
| `PLN-WIP-001` | Work in progress is limited | RECOMMENDED | all project types |
| `PLN-SOLO-001` | Solo delivery needs written decisions more, not less | RECOMMENDED | all project types |
| `PLN-DONE-001` | Done is defined once, in advance | MANDATORY | all project types |
| `PLN-HANDOVER-001` | Handover work is in the plan, not after it | MANDATORY | all project types |
| `PLN-CHANGE-001` | Scope added must displace scope or move the date | MANDATORY | all project types |

### RESOURCE (15)

| Id | Title | Severity | Applies to |
|---|---|---|---|
| `RES-CAP-001` | Capacity is hours available, not headcount | MANDATORY | all project types |
| `RES-CAP-002` | Plan for leave, illness and public holidays | RECOMMENDED | all project types |
| `RES-CAP-003` | Nobody is a hundred per cent productive on project work | RECOMMENDED | all project types |
| `RES-SKILL-001` | Work assigned to someone still learning takes longer | RECOMMENDED | all project types |
| `RES-BUS-001` | Knowledge concentrated in one person is a scheduling risk | RECOMMENDED | all project types |
| `RES-ONBOARD-001` | New people reduce capacity before they add to it | RECOMMENDED | all project types |
| `RES-CONTEXT-001` | Splitting a person across projects costs more than the split suggests | RECOMMENDED | all project types |
| `RES-REVIEW-001` | Review capacity is capacity | MANDATORY | all project types |
| `RES-KEY-001` | Key people are named and their availability confirmed | MANDATORY | all project types |
| `RES-EXTERNAL-001` | External resources need contracts before they need tasks | RECOMMENDED | all project types |
| `RES-ONCALL-001` | On-call is a commitment with a cost | MANDATORY | all project types |
| `RES-HANDOFF-001` | Every handoff between people is a delay | ADVISORY | all project types |
| `RES-LEAVE-001` | Known absences are in the schedule | MANDATORY | all project types |
| `RES-SPEC-001` | Specialists are a bottleneck even when they are available | RECOMMENDED | all project types |
| `RES-TRACK-001` | Actual effort is recorded against estimates | RECOMMENDED | all project types |

### BUDGET (20)

| Id | Title | Severity | Applies to |
|---|---|---|---|
| `BUD-RANGE-001` | Estimates are ranges | MANDATORY | all project types |
| `BUD-RANGE-002` | A range is not summarised by its midpoint | MANDATORY | all project types |
| `BUD-BASIS-001` | Every estimate records what it assumed | MANDATORY | all project types |
| `BUD-CURRENCY-001` | Money carries its currency everywhere | MANDATORY | all project types |
| `BUD-VAT-001` | Budgets state whether tax is included | MANDATORY | all project types |
| `BUD-RUN-001` | Running costs are budgeted, not only build costs | MANDATORY | all project types |
| `BUD-CONT-001` | Contingency is sized to uncertainty, not by habit | RECOMMENDED | all project types |
| `BUD-UNKNOWN-001` | Unknowns increase the range, they do not vanish | MANDATORY | all project types |
| `BUD-TRACK-001` | Spend is tracked against the plan while there is still time to act | MANDATORY | all project types |
| `BUD-CHANGE-001` | A change request states its cost before it is approved | MANDATORY | all project types |
| `BUD-LICENCE-001` | Licence costs scale with something — know what | RECOMMENDED | all project types |
| `BUD-CLOUD-001` | Cloud costs need a ceiling and an alert | MANDATORY | all project types |
| `BUD-SUNK-001` | Money already spent is not a reason to continue | ADVISORY | all project types |
| `BUD-DEBT-001` | Deliberate shortcuts are recorded as debt with a cost | RECOMMENDED | all project types |
| `BUD-COMPARE-001` | Estimates are compared against the same project’s history | ADVISORY | all project types |
| `BUD-PHASE-001` | Estimates get narrower as the project proceeds | ADVISORY | all project types |
| `BUD-EXIT-001` | The cost of leaving a dependency is part of choosing it | RECOMMENDED | all project types |
| `BUD-SECURITY-001` | Security work is budgeted, not absorbed | MANDATORY | all project types |
| `BUD-REWORK-001` | Rework is budgeted, because there will be some | RECOMMENDED | all project types |
| `BUD-A11Y-001` | Accessibility remediation costs more than accessible design | RECOMMENDED | all project types |

### TESTING (37)

| Id | Title | Severity | Applies to |
|---|---|---|---|
| `QA-COVER-001` | Coverage is measured against requirements, not lines | MANDATORY | all project types |
| `QA-COVER-002` | A test must be able to fail | RECOMMENDED | all project types |
| `QA-FLAKE-001` | Flaky tests are diagnosed, not retried | MANDATORY | all project types |
| `QA-ASSERT-001` | Assertions wait rather than sleep | RECOMMENDED | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP |
| `QA-E2E-001` | The critical journeys are tested end to end | MANDATORY | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP |
| `QA-E2E-002` | End-to-end tests run against a freshly built application | MANDATORY | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP |
| `QA-UNIT-001` | Business logic is testable without infrastructure | RECOMMENDED | all project types |
| `QA-INT-001` | Integration tests use the real database engine | MANDATORY | all project types |
| `QA-MOCK-001` | Mocking your own code proves your own code agrees with itself | RECOMMENDED | all project types |
| `QA-DATA-001` | Tests do not depend on each other’s leftovers | MANDATORY | all project types |
| `QA-NEG-001` | Test the refusals, not only the successes | MANDATORY | all project types |
| `QA-BOUND-001` | Boundaries are tested at the boundary | RECOMMENDED | all project types |
| `QA-REGRESS-001` | Every fixed defect gets a test that would have caught it | MANDATORY | all project types |
| `QA-CI-001` | The suite runs in CI on every change | MANDATORY | all project types |
| `QA-CI-002` | A failing test is never disabled to make the build green | MANDATORY | all project types |
| `QA-PERF-001` | Performance is measured against a defined journey | RECOMMENDED | all project types |
| `QA-LOAD-001` | Load is tested against something like production | RECOMMENDED | all project types |
| `QA-A11Y-001` | Automated accessibility checks run on every page | MANDATORY | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP |
| `QA-A11Y-002` | Keyboard-only operation is tested by a person | MANDATORY | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP |
| `QA-BROWSER-001` | Tests run on more than one browser engine | RECOMMENDED | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP |
| `QA-MOBILE-001` | Mobile viewports are tested, not inferred | RECOMMENDED | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP |
| `QA-CONTRACT-001` | API contracts are tested against the published schema | MANDATORY | API_BACKEND_PLATFORM |
| `QA-MIGRATION-001` | Migrations are tested against realistic data | MANDATORY | all project types |
| `QA-CONCURRENCY-001` | Concurrent access to shared state is tested concurrently | RECOMMENDED | all project types |
| `QA-IDEMPOTENT-001` | Operations that can be retried are tested for repetition | MANDATORY | all project types |
| `QA-ERROR-001` | Failure paths are tested as well as success paths | RECOMMENDED | all project types |
| `QA-SEED-001` | Test fixtures are deterministic | MANDATORY | all project types |
| `QA-TIME-001` | Time-dependent behaviour takes time as an input | MANDATORY | all project types |
| `QA-TZ-001` | Time zones and daylight saving are tested explicitly | RECOMMENDED | all project types |
| `QA-I18N-001` | Text handling is tested with more than ASCII | RECOMMENDED | all project types |
| `QA-SNAPSHOT-001` | Snapshot tests are reviewed, not regenerated | RECOMMENDED | all project types |
| `QA-SEC-001` | Security tests run in the same suite as everything else | MANDATORY | all project types |
| `QA-DOC-001` | A test explains why it exists | ADVISORY | all project types |
| `QA-COUNT-001` | Test count is not a quality measure | ADVISORY | all project types |
| `QA-ENV-001` | The test environment resembles production in the ways that matter | RECOMMENDED | all project types |
| `QA-EXCEPTION-001` | Accepted test failures are recorded with an owner and a date | MANDATORY | all project types |
| `QA-SMOKE-001` | A smoke test runs against production after every release | MANDATORY | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP |

### SECURITY (50)

| Id | Title | Severity | Applies to |
|---|---|---|---|
| `SEC-AUTH-001` | Authentication needs its own verification pack | MANDATORY | all project types |
| `SEC-AUTHZ-001` | Object-level authorisation must be tested, not assumed | MANDATORY | all project types |
| `SEC-AUTHZ-002` | A forbidden object must be indistinguishable from a missing one | MANDATORY | all project types |
| `SEC-AUTHZ-003` | Authorisation happens on the server | MANDATORY | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP, API_BACKEND_PLATFORM |
| `SEC-TENANT-001` | Tenant isolation must be tested across tenants, not within one | MANDATORY | SAAS_WEB_APP |
| `SEC-TENANT-002` | Defence in depth below the application layer | RECOMMENDED | SAAS_WEB_APP |
| `SEC-PAY-001` | Card data should not enter the system at all | MANDATORY | all project types |
| `SEC-PRIV-001` | Personal data needs a lawful basis and a retention limit | MANDATORY | all project types |
| `SEC-PRIV-002` | Subject access and deletion must be possible before launch | MANDATORY | all project types |
| `SEC-PRIV-003` | Personal data must not reach the logs | MANDATORY | all project types |
| `SEC-TLS-001` | Everything is served over TLS, and says so | MANDATORY | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP, API_BACKEND_PLATFORM |
| `SEC-COOKIE-001` | Session cookies are HttpOnly, Secure and SameSite | MANDATORY | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP, API_BACKEND_PLATFORM |
| `SEC-CSP-001` | A content security policy without unsafe-inline | MANDATORY | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP |
| `SEC-HEADER-001` | Security headers are verified in production, not only in code | MANDATORY | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP, API_BACKEND_PLATFORM |
| `SEC-INPUT-001` | Untrusted input is validated at the boundary, against a schema | MANDATORY | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP, API_BACKEND_PLATFORM |
| `SEC-INPUT-002` | Mass assignment must be impossible | MANDATORY | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP, API_BACKEND_PLATFORM |
| `SEC-XSS-001` | Stored content is the highest-risk surface | MANDATORY | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP |
| `SEC-SQL-001` | Queries are parameterised, including the dynamic ones | MANDATORY | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP, API_BACKEND_PLATFORM |
| `SEC-SSRF-001` | User-supplied URLs must not reach internal networks | MANDATORY | all project types |
| `SEC-UPLOAD-001` | Uploaded files are untrusted content with a filename attached | MANDATORY | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP, API_BACKEND_PLATFORM |
| `SEC-SECRET-001` | Secrets are not in the repository, and that is checked automatically | MANDATORY | all project types |
| `SEC-SECRET-002` | Secrets must be rotatable without a code change | MANDATORY | all project types |
| `SEC-DEP-001` | Dependency vulnerabilities fail the build | MANDATORY | all project types |
| `SEC-DEP-002` | A dependency that is not used should be removed rather than patched | RECOMMENDED | all project types |
| `SEC-DEP-003` | Dependencies are pinned and the lockfile is committed | MANDATORY | all project types |
| `SEC-RATE-001` | Expensive and unauthenticated actions are rate-limited | MANDATORY | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP |
| `SEC-AUDIT-001` | Security-relevant events are recorded and cannot be edited | MANDATORY | all project types |
| `SEC-LOG-001` | Log values must not be able to forge log entries | RECOMMENDED | all project types |
| `SEC-ERR-001` | Error responses must not carry internal detail | MANDATORY | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP, API_BACKEND_PLATFORM |
| `SEC-THREAT-001` | A threat model exists before the security work is planned | RECOMMENDED | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP |
| `SEC-AI-001` | AI output is untrusted input | MANDATORY | AI_ENABLED_WEB_APP |
| `SEC-AI-002` | What is sent to a model leaves the boundary | MANDATORY | AI_ENABLED_WEB_APP |
| `SEC-DEPLOY-001` | The application does not connect to the database as a superuser | MANDATORY | all project types |
| `SEC-CSRF-001` | State-changing requests need cross-site request protection | MANDATORY | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP, API_BACKEND_PLATFORM |
| `SEC-SESSION-001` | Sessions expire and can be revoked | MANDATORY | all project types |
| `SEC-SESSION-002` | The session identifier changes when privilege changes | MANDATORY | all project types |
| `SEC-PWD-001` | Password storage and policy follow current guidance | MANDATORY | all project types |
| `SEC-RECOVERY-001` | Account recovery is as strong as authentication | MANDATORY | all project types |
| `SEC-ADMIN-001` | Administrative access is separated and recorded | MANDATORY | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP |
| `SEC-BACKUP-001` | Backups are encrypted and restoring from one has been tried | MANDATORY | all project types |
| `SEC-INCIDENT-001` | There is an agreed way to handle a security incident | MANDATORY | all project types |
| `SEC-MFA-001` | Multi-factor authentication for privileged accounts | RECOMMENDED | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP |
| `SEC-CRYPTO-001` | No hand-written cryptography | MANDATORY | all project types |
| `SEC-SUPPLY-001` | The build pipeline is a production system | RECOMMENDED | all project types |
| `SEC-CONFIG-001` | Configuration is validated at startup, not discovered at runtime | MANDATORY | all project types |
| `SEC-ENV-001` | Production data does not go into other environments | MANDATORY | all project types |
| `SEC-API-001` | Public APIs need documented authentication and versioning | MANDATORY | API_BACKEND_PLATFORM |
| `SEC-MOBILE-001` | A mobile app cannot keep a secret | MANDATORY | MOBILE_APP |
| `SEC-REVIEW-001` | Security-relevant changes are reviewed by someone else | MANDATORY | all project types |
| `SEC-DOS-001` | Payload size and recursion depth are bounded | MANDATORY | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP, API_BACKEND_PLATFORM |

### ACCESSIBILITY (10)

| Id | Title | Severity | Applies to |
|---|---|---|---|
| `A11Y-CONTRAST-001` | Text contrast is measured, not judged by eye | MANDATORY | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP |
| `A11Y-FOCUS-001` | Focus is always visible | MANDATORY | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP |
| `A11Y-TARGET-001` | Touch targets are at least 24 by 24 pixels | MANDATORY | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP, MOBILE_APP |
| `A11Y-REFLOW-001` | Content reflows at 320 pixels without horizontal scrolling | MANDATORY | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP |
| `A11Y-SEMANTIC-001` | Structure is expressed semantically | MANDATORY | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP |
| `A11Y-STATUS-001` | Status is never conveyed by colour alone | MANDATORY | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP |
| `A11Y-FORM-001` | Every form control has a programmatic label | MANDATORY | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP |
| `A11Y-ERROR-001` | Errors are announced, not only shown | MANDATORY | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP |
| `A11Y-MOTION-001` | Reduced-motion preferences are respected | MANDATORY | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP, MOBILE_APP |
| `A11Y-MANUAL-001` | A person tests with a screen reader | MANDATORY | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP |

### DEPLOYMENT (20)

| Id | Title | Severity | Applies to |
|---|---|---|---|
| `DEP-PIPE-001` | Deployment is automated and repeatable | MANDATORY | all project types |
| `DEP-ROLLBACK-001` | A rollback plan exists and has been tried | MANDATORY | all project types |
| `DEP-MIGRATE-001` | Data migrations have a reverse path or an accepted risk | MANDATORY | all project types |
| `DEP-ZERO-001` | Deployments should not require downtime | RECOMMENDED | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP, API_BACKEND_PLATFORM |
| `DEP-STAGE-001` | Releases go through a staging environment first | MANDATORY | all project types |
| `DEP-ARTIFACT-001` | The artefact that was tested is the artefact that ships | MANDATORY | all project types |
| `DEP-NOTES-001` | Release notes say what changed | MANDATORY | all project types |
| `DEP-APPROVE-001` | Production deployment is authorised by a person | MANDATORY | all project types |
| `DEP-WINDOW-001` | Do not deploy when nobody is available to respond | RECOMMENDED | all project types |
| `DEP-SECRET-001` | Deployment credentials are scoped to what they deploy | MANDATORY | all project types |
| `DEP-HEALTH-001` | Health checks test dependencies, not just the process | MANDATORY | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP, API_BACKEND_PLATFORM |
| `DEP-CANARY-001` | Significant changes go out gradually where possible | RECOMMENDED | SAAS_WEB_APP, PUBLIC_WEB_APP, ECOMMERCE, MOBILE_APP |
| `DEP-FLAG-001` | Feature flags have an owner and a removal date | RECOMMENDED | all project types |
| `DEP-DNS-001` | DNS and certificates are prepared before release day | MANDATORY | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP |
| `DEP-CERT-001` | Certificate renewal is automated and monitored | MANDATORY | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP |
| `DEP-ROLLFORWARD-001` | Decide in advance whether the response is rollback or roll forward | RECOMMENDED | all project types |
| `DEP-CONFIG-001` | Configuration differences between environments are documented | MANDATORY | all project types |
| `DEP-BACKUP-001` | Take a backup before a risky deployment | MANDATORY | all project types |
| `DEP-STORE-001` | App store review is an external dependency with a timetable | MANDATORY | MOBILE_APP |
| `DEP-VERIFY-001` | Every deployment is verified from outside | MANDATORY | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP |

### PRODUCTION_VERIFICATION (15)

| Id | Title | Severity | Applies to |
|---|---|---|---|
| `PRD-AVAIL-001` | Availability is checked from outside the network | MANDATORY | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP |
| `PRD-TLS-001` | TLS is verified on the real hostname | MANDATORY | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP |
| `PRD-HEADER-001` | Security headers are verified on the live response | MANDATORY | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP |
| `PRD-JOURNEY-001` | Critical journeys are walked in production | MANDATORY | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP |
| `PRD-AUTH-001` | Authentication is verified in production | MANDATORY | all project types |
| `PRD-MONITOR-001` | Monitoring is confirmed to be receiving data | MANDATORY | all project types |
| `PRD-LOG-001` | Logs are confirmed to be arriving where someone can read them | MANDATORY | all project types |
| `PRD-ALERT-001` | At least one alert is fired deliberately to prove the path works | MANDATORY | all project types |
| `PRD-BACKUP-001` | The first production backup is verified by restoring it | MANDATORY | all project types |
| `PRD-PERF-001` | Performance is measured in production, not inferred from staging | RECOMMENDED | all project types |
| `PRD-IDENTITY-001` | Confirm which build is actually running | MANDATORY | all project types |
| `PRD-DATA-001` | Confirm the production database is the production database | MANDATORY | all project types |
| `PRD-SAFARI-001` | Verify on a real browser over HTTPS, including Safari | MANDATORY | PUBLIC_WEB_APP, SAAS_WEB_APP, ECOMMERCE, AI_ENABLED_WEB_APP, INTERNAL_BUSINESS_APP |
| `PRD-ERROR-001` | Confirm errors reach the error tracker | MANDATORY | all project types |
| `PRD-ROLLBACK-001` | Confirm rollback works from the current production state | RECOMMENDED | all project types |

### OPERATIONS (10)

| Id | Title | Severity | Applies to |
|---|---|---|---|
| `OPS-OWNER-001` | Someone owns the system after launch | MANDATORY | all project types |
| `OPS-ALERT-001` | Alerts go to a person, not to an inbox nobody reads | MANDATORY | all project types |
| `OPS-RUNBOOK-001` | Common failures have runbooks | RECOMMENDED | all project types |
| `OPS-MAINT-001` | Recurring maintenance is scheduled, not remembered | MANDATORY | all project types |
| `OPS-DEP-001` | Dependencies are updated regularly, not in one large jump | RECOMMENDED | all project types |
| `OPS-INCIDENT-001` | There is a defined incident process | MANDATORY | all project types |
| `OPS-POSTMORTEM-001` | Incidents produce a blameless review | RECOMMENDED | all project types |
| `OPS-CAPACITY-001` | Capacity is watched before it is exhausted | RECOMMENDED | all project types |
| `OPS-DEBT-001` | Technical debt is recorded where it will be seen | RECOMMENDED | all project types |
| `OPS-LIMIT-001` | Known limitations are written down for the people who inherit them | MANDATORY | all project types |

### DOCUMENTATION (10)

| Id | Title | Severity | Applies to |
|---|---|---|---|
| `DOC-README-001` | Someone new can run the system from the documentation alone | MANDATORY | all project types |
| `DOC-DECISION-001` | The reasoning is documented, not only the outcome | MANDATORY | all project types |
| `DOC-OPS-001` | Operational documentation covers running it, not building it | MANDATORY | all project types |
| `DOC-API-001` | API documentation is generated from the implementation | MANDATORY | API_BACKEND_PLATFORM |
| `DOC-DIAGRAM-001` | A diagram of the system exists and is current | RECOMMENDED | all project types |
| `DOC-CURRENT-001` | Documentation that cannot be kept current should be deleted | ADVISORY | all project types |
| `DOC-HANDOVER-001` | Handover includes access, not only documents | MANDATORY | all project types |
| `DOC-SEARCH-001` | Documentation lives where people will look for it | RECOMMENDED | all project types |
| `DOC-ASSUME-001` | Handover documentation lists the assumptions the system rests on | MANDATORY | all project types |
| `DOC-EVIDENCE-001` | Compliance evidence is collected as it is produced | MANDATORY | all project types |

### GOVERNANCE (15)

| Id | Title | Severity | Applies to |
|---|---|---|---|
| `GOV-CHANGE-001` | Post-baseline changes go through change control | MANDATORY | all project types |
| `GOV-CHANGE-002` | A change request states its impact before approval | MANDATORY | all project types |
| `GOV-APPROVE-001` | Approvals are attributable to a person | MANDATORY | all project types |
| `GOV-SOD-001` | The same person does not both request and approve | MANDATORY | all project types |
| `GOV-BASELINE-001` | A baseline is immutable | MANDATORY | all project types |
| `GOV-AUDIT-001` | Governance decisions are recorded in an append-only log | MANDATORY | all project types |
| `GOV-EXCEPTION-001` | Every exception has an owner, a reason and an expiry | MANDATORY | all project types |
| `GOV-GATE-001` | A gate override is a decision, recorded as one | MANDATORY | all project types |
| `GOV-ROLE-001` | Permissions are granted by role, and roles are reviewed | MANDATORY | all project types |
| `GOV-VENDOR-001` | Third-party services are assessed before they hold data | MANDATORY | all project types |
| `GOV-DECISION-001` | Decisions record who was entitled to make them | RECOMMENDED | all project types |
| `GOV-REPORT-001` | Status reporting distinguishes measured from estimated | RECOMMENDED | all project types |
| `GOV-ESCALATE-001` | There is a defined way to escalate a blocked decision | RECOMMENDED | all project types |
| `GOV-CLOSE-001` | A project is closed deliberately | MANDATORY | all project types |
| `GOV-ARCHIVE-001` | An archived project is read-only but restorable | MANDATORY | all project types |


---

## 6. Determinism (§13.1)

The evaluator is pure: no clock, no randomness, no database. The date rules are evaluated as of is an
input. Results are returned in catalogue order, because the interface renders findings in the order
it receives them and a list that reshuffles between two identical runs looks like the project
changed.

The suite asserts byte-identical output across ten consecutive runs, and that reordering the intake
does not change the result.
