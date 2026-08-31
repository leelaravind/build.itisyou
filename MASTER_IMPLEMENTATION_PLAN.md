# MASTER IMPLEMENTATION PLAN — Software Project Intelligence, Planning, Execution & Governance Platform

**Document status:** IMPLEMENTATION MASTER PLAN V1  
**Date:** 2026-08-31  
**Execution model:** Autonomous coding-agent implementation with zero manual testing by default  
**Design source of truth:** Exported Stitch designs already present in the repository  
**Architecture status:** Architecture V1 locked  
**Screen architecture status:** Locked  
**Primary implementation principle:** Complex backend, simple interface; reveal complexity only when useful.

---

# 0. NON-NEGOTIABLE EXECUTION CONTRACT

The coding agent must treat this document as the primary implementation contract.

The agent must operate as an autonomous:

- senior software architect
- senior full-stack engineer
- backend/domain engineer
- frontend/design-system engineer
- database engineer
- QA automation engineer
- security engineer
- DevOps/SRE engineer
- accessibility engineer
- performance engineer
- technical writer
- release engineer

The agent must not simply generate code until the repository is understood.

## 0.1 Mandatory autonomous workflow

For every phase:

1. Inspect.
2. Plan.
3. Implement.
4. Test automatically.
5. Diagnose failures automatically.
6. Fix automatically.
7. Rerun affected tests.
8. Run required regression tests.
9. Verify the result.
10. Record evidence.
11. Update documentation.
12. Commit only a verified state.
13. If the fix cannot be validated, revert the attempted change to the last known-good state.
14. Continue to the next phase only when the phase gate passes.

## 0.2 Zero manual testing

Manual testing is **not** the default verification mechanism.

The project must have fully automated:

- unit tests
- component tests
- domain/rules-engine tests
- schema tests
- contract tests
- database tests
- API tests
- integration tests
- end-to-end browser tests
- accessibility tests
- authorization/tenant-isolation tests
- security regression tests
- migration tests
- build tests
- deployment smoke tests
- production verification tests
- rollback verification

Human/manual review may be used only where automation cannot technically establish the requirement, and such exceptions must be documented explicitly.

## 0.3 Minimum automated test volume

The final system must contain **at least 600 meaningful automated test cases**.

These must not be filler assertions.

Target distribution:

| Test area | Minimum |
|---|---:|
| Domain model + invariants | 70 |
| Deterministic rules engine | 100 |
| Lifecycle + quality gates | 45 |
| AI interchange/schema/semantic validation | 55 |
| Budget/estimation/resource calculations | 50 |
| Dependency/impact propagation | 50 |
| API + contract tests | 55 |
| Authentication/RBAC/tenant isolation | 50 |
| Frontend components + states | 45 |
| Playwright critical journeys | 40 |
| Accessibility | 20 |
| Security regression | 20 |
| Migrations/recovery/jobs/idempotency | 20 |
| **Minimum total** | **620** |

The final count may be larger.

## 0.4 Continuous development-story document

Create and continuously maintain:

`docs/DEVELOPMENT_STORY.md`

It must record throughout implementation:

- project origin
- product goal
- locked architecture
- major technical decisions
- why each decision was made
- design handoff findings
- technologies selected
- rejected alternatives
- trade-offs
- failures
- bugs discovered
- root causes
- autonomous fixes
- test evidence
- security findings
- deployment milestones
- rollback exercises
- lessons learned
- final verified production state

Do not reconstruct this only at the end.

## 0.5 Required supporting documentation

Maintain at minimum:

- `docs/ARCHITECTURE.md`
- `docs/DOMAIN_MODEL.md`
- `docs/PROJECT_DIGITAL_TWIN.md`
- `docs/RULES_ENGINE.md`
- `docs/RULE_CATALOGUE.md`
- `docs/QUALITY_GATES.md`
- `docs/CALCULATION_SPEC.md`
- `docs/AI_INTERCHANGE.md`
- `docs/API.md`
- `docs/SECURITY.md`
- `docs/PRIVACY.md`
- `docs/PERMISSIONS_MATRIX.md`
- `docs/TEST_STRATEGY.md`
- `docs/TEST_EVIDENCE.md`
- `docs/DEPLOYMENT.md`
- `docs/ROLLBACK.md`
- `docs/OBSERVABILITY.md`
- `docs/DATA_RETENTION.md`
- `docs/KNOWN_ISSUES.md`
- `docs/CHANGELOG_IMPLEMENTATION.md`
- `docs/DEVELOPMENT_STORY.md`

---

# 1. PRODUCT DEFINITION

This product is **not**:

- a task manager
- a Jira clone
- a Kanban-only product
- a calendar app
- an AI chatbot
- a generic LLM wrapper
- a prompt generator alone

It is a:

> **Software Project Intelligence, Planning, Execution and Governance Platform**

Its job is to encode professional software-delivery practices into a system that can guide:

- a beginner with only an idea
- a solo developer
- a solo developer using coding agents
- a startup
- a 5–20 person team
- a project manager
- a larger engineering organization
- an enterprise

from:

**Idea → Discovery → Planning → Approval → Execution → Verification → Release → Production → Operations → Completion → Archive**

---

# 2. LOCKED PRODUCT PRINCIPLES

## 2.1 Deterministic core

The platform must remain useful without any integrated AI API.

The deterministic system owns:

- structure
- validation
- lifecycle
- rules
- quality gates
- calculations
- planning
- traceability
- dependencies
- impact propagation
- budget tracking
- resource planning
- auditability
- execution state
- evidence
- version history

External AI provides optional research/reasoning input only.

## 2.2 External-AI one-shot workflow

The platform does not need paid AI credits for V1.

Flow:

1. User provides project details.
2. Platform detects missing/unknown information.
3. Platform generates a strict external-AI prompt package.
4. User copies it to ChatGPT/Claude/Gemini/another model.
5. External AI may ask the user any critical missing questions there.
6. External AI produces the final structured machine-readable response.
7. User pastes/uploads the response into this platform.
8. Platform validates syntax.
9. Platform validates schema.
10. Platform validates semantic/domain correctness.
11. Platform rejects invalid/conflicting/unsafe output.
12. Deterministic engine creates/updates the project model.

## 2.3 Guest-first

Core trial flow must work without login.

Guest must be able to:

- create project
- complete intake
- generate external-AI prompt
- import structured result
- validate result
- preview generated project

Authentication is introduced naturally when the user wants to:

- save
- persist
- continue later
- collaborate
- manage an organization

## 2.4 UX

Locked UX principles:

- progressive disclosure
- beginner/professional/enterprise complexity modes
- Project Home
- Next Action engine
- Today/Focus
- phase-based navigation
- contextual tools
- global search/command palette
- views over shared data rather than duplicated features
- role-aware UI
- smart defaults
- exception-first management
- consistent detail drawer
- global project-status header
- complexity scaling

Primary navigation should remain approximately:

**Home · Plan · Execute · Control · Documents · Insights**

---

# 3. TARGET TECHNICAL ARCHITECTURE

## 3.1 Architectural style

Use a **modular monolith first**.

Do not start with microservices.

Reason:

- strong consistency is required
- many domain operations touch multiple related entities
- transactions matter
- implementation complexity must stay controlled
- service extraction can happen later around stable bounded contexts

## 3.2 Recommended stack

### Frontend
- Next.js App Router
- React
- TypeScript
- Tailwind CSS
- Storybook
- TanStack Query only where client-side server state is genuinely needed
- Tiptap for structured living documents
- React Flow or equivalent for graph/relationship visualizations
- accessible drag/drop library for board/tree interaction

### Backend
- TypeScript
- Node.js
- modular domain/application/infrastructure layers
- REST API
- OpenAPI-first contracts

### Database
- PostgreSQL
- patched supported production version
- migrations under version control
- row-level security as defence-in-depth
- tenant filtering also enforced in the application layer

### Jobs
- Redis
- BullMQ

### Object/evidence storage
- S3-compatible object storage
- encryption at rest
- signed access
- hashes recorded for evidence integrity

### Search
V1:
- PostgreSQL full-text/search initially if adequate
- introduce dedicated search service only if validated by scale/UX needs

Do not add infrastructure simply because it appeared in research.

### Authentication
- standards-based OIDC-capable authentication
- provider must remain replaceable
- organization + project RBAC

### Eventing
V1:
- transactional outbox
- internal domain events

Later:
- Kafka only when multiple independently deployed consumers justify it

### ML
Do not build ML models in core V1.

Create clean interfaces for later:

- effort prediction
- delivery forecasting
- budget forecasting
- risk prediction
- resource optimization
- task sequencing
- estimation calibration

---

# 4. REPOSITORY HANDOFF GATE — PHASE 0

Before feature coding, inspect the actual repository.

## 4.1 Repository audit

The agent must identify:

- repository structure
- package manager
- current framework versions
- current branch
- current commit
- build commands
- lint commands
- test commands
- deployment configuration
- environment configuration
- existing generated Stitch code
- static assets
- fonts
- images
- icons
- design tokens
- component files
- routing
- dead/duplicate generated files
- TypeScript state
- dependency health
- security vulnerabilities
- existing CI/CD
- existing docs

Create:

`docs/REPOSITORY_AUDIT.md`

## 4.2 Design handoff verification

Map exported designs to implementation screens.

Create:

`docs/DESIGN_SCREEN_MAP.md`

Each entry:

- screen number
- screen name
- route
- source design file/component
- implementation component
- desktop status
- tablet status
- mobile status
- empty state
- loading state
- error state
- permission state
- notes

No design should be discarded casually.

The Stitch exports are the visual source of truth.

If a screen is missing, derive it from the established design system rather than inventing a new visual language.

## 4.3 Design token extraction

Extract and freeze:

- colors
- semantic colors
- typography
- font sizes
- font weights
- line heights
- spacing
- radii
- borders
- shadows
- widths
- breakpoints
- z-index hierarchy
- motion durations
- focus states
- status colors

Put them in version-controlled design tokens.

## 4.4 Phase-0 gate

PASS only if:

- clean install works
- build works
- lint works
- typecheck works
- baseline tests run
- design inventory exists
- design token inventory exists
- no secrets in repository
- dependency scan complete
- current known issues documented

---

# 5. DOMAIN ARCHITECTURE

The canonical model is the **Project Digital Twin**.

The Digital Twin is the versioned connected model of the project.

Core entities:

1. Organization
2. User
3. Membership
4. Role
5. Permission
6. Project
7. ProjectVersion
8. Intake
9. Constraint
10. Assumption
11. Unknown
12. Decision
13. Requirement
14. ArchitectureComponent
15. ArchitectureRelationship
16. Phase
17. Workstream
18. Milestone
19. Epic
20. Task
21. Subtask
22. Dependency
23. Resource
24. Skill
25. CapacityAllocation
26. Budget
27. BudgetItem
28. Estimate
29. Risk
30. Blocker
31. Test
32. TestResult
33. Evidence
34. Gate
35. GateCriterion
36. Approval
37. ChangeRequest
38. ImpactAnalysis
39. Baseline
40. Variance
41. Document
42. DocumentVersion
43. TraceLink
44. AIInterchange
45. AIImport
46. ValidationResult
47. LifecycleTransition
48. Deployment
49. Environment
50. ProductionVerification
51. Incident
52. OperationalTask
53. Retrospective
54. LessonLearned
55. AuditEvent
56. OutboxEvent
57. Integration
58. Notification
59. Scenario
60. Forecast

Every project-owned row must have project and tenant scope where applicable.

---

# 6. PROJECT LIFECYCLE STATE MACHINE

Canonical states:

1. IDEA
2. DISCOVERY
3. PLANNING
4. PLANNED
5. APPROVED
6. IN_PROGRESS
7. VERIFYING
8. RELEASE_READY
9. LIVE
10. OPERATING
11. COMPLETED
12. ARCHIVED

No arbitrary state changes.

Transitions must be centrally validated.

Examples:

- PLANNED → APPROVED requires required approvals.
- IN_PROGRESS → VERIFYING requires development gate readiness.
- VERIFYING → RELEASE_READY requires testing/security/release gates.
- RELEASE_READY → LIVE requires deployment authorization.
- LIVE → OPERATING requires production verification.
- OPERATING → COMPLETED requires handover/completion gate.

Create golden transition tests for every allowed and prohibited transition.

---

# 7. DETERMINISTIC RULES ENGINE

This is one of the main intellectual-property layers.

## 7.1 Rule format

Each rule must have:

- stable rule ID
- version
- title
- category
- project types
- conditions
- inputs
- outputs
- severity
- explanation
- evidence/reference where relevant
- remediation
- effective date
- deprecated date
- test cases

Example:

`SEC-WEB-AUTH-001`

IF:
- project.type = public_web_app
- authentication = true

THEN:
- security authentication test pack required
- authorization test pack required
- session-management verification required
- release security gate cannot pass until evidence exists

## 7.2 Rule categories

At minimum:

- discovery
- requirements
- architecture
- methodology
- estimation
- budgeting
- resources
- scheduling
- dependencies
- QA
- security
- privacy
- accessibility
- deployment
- production readiness
- operations
- maintenance
- handover
- compliance
- traceability
- approvals
- risk
- change control

## 7.3 Initial rules target

Do not try to author thousands manually on day one.

V1 target:
- at least 250 curated deterministic rules
- strong coverage of software/web project classes
- extensible versioned rule-pack structure

Later rule packs:
- mobile
- API
- data platform
- AI/ML system
- regulated enterprise
- ecommerce
- internal tooling
- public SaaS

---

# 8. PROJECT DECOMPOSITION ENGINE

Required hierarchy:

**Project → Phase → Workstream → Milestone → Epic → Task → Subtask → Checkpoint**

The engine must:

- generate stable IDs
- preserve ordering
- create dependencies
- calculate readiness
- detect cycles
- identify critical dependencies
- maintain owner/capacity relationships
- maintain requirement traceability
- support regeneration without duplicating unchanged entities
- preserve user modifications
- identify conflicts when regeneration would overwrite approved work

Execution profiles:

1. Solo human
2. Solo + coding agents
3. Small team
4. Medium team
5. Enterprise
6. Hybrid human + AI-assisted workforce

The methodology remains professional; assignment and parallelism adapt to capacity.

---

# 9. QUALITY GATES

Canonical gates:

1. Discovery Gate
2. Requirements Gate
3. Architecture Gate
4. Planning Gate
5. Development Gate
6. Testing Gate
7. Security Gate
8. Release Readiness Gate
9. Deployment Gate
10. Production Verification Gate
11. Operational Readiness Gate
12. Completion/Handover Gate

Gate states:

- NOT_READY
- READY
- PASS
- FAIL
- BLOCKED
- EXCEPTION

Each criterion must have:

- criterion ID
- rule source
- required evidence
- automated/manual classification
- status
- owner
- failure reason
- exception policy
- approval requirement

Exceptions must be explicit and auditable.

---

# 10. REQUIREMENTS TRACEABILITY

Canonical chain:

**Requirement → Architecture → Work → Implementation → Test → Evidence → Release**

The platform must detect:

- orphan requirements
- unimplemented requirements
- untested requirements
- tests without requirement linkage where linkage is expected
- missing evidence
- release items with failed verification
- stale trace links after change requests

Trace links must be queryable and visualizable.

---

# 11. EXTERNAL AI INTERCHANGE

Use versioned JSON Schema.

Separate versions:

- interchange schema version
- prompt template version
- ruleset version
- validator version
- project version

Do not merge them into one version.

## 11.1 Validation pipeline

1. input size validation
2. MIME/content validation
3. JSON parsing
4. JSON Schema validation
5. reference validation
6. type/domain validation
7. semantic invariant validation
8. conflict detection against user-confirmed data
9. confidence/provenance validation
10. restricted-data/security policy validation
11. generation readiness decision

Statuses:

- VALID
- VALID_WITH_WARNINGS
- INCOMPLETE
- CONFLICTING
- UNSUPPORTED
- INVALID
- UNSAFE

Never silently convert an invalid response into a project.

## 11.2 Provenance classes

Every important imported claim must be marked as:

- USER_CONFIRMED
- USER_PROVIDED
- EXTERNAL_SOURCE
- EXTERNAL_AI_INFERENCE
- ASSUMPTION
- DETERMINISTIC_CALCULATION
- FUTURE_ML_PREDICTION

The UI must never present assumption/inference as confirmed fact.

---

# 12. CALCULATION ENGINE

All important project numbers require provenance.

## 12.1 Calculation classes

- task effort
- phase duration
- resource capacity
- schedule
- budget
- burn
- forecast-at-completion
- contingency
- risk exposure
- scenario delta
- baseline variance

## 12.2 Calculation requirements

Every material calculation must record:

- calculation ID
- engine version
- formula/rule version
- source inputs
- units
- result
- timestamp
- deterministic/learned classification

## 12.3 No fake precision

If evidence is weak:
- use range
- use confidence
- label assumption
- explain basis

Do not produce a fake single-number estimate.

---

# 13. BUDGET ENGINE

Categories:

1. people
2. contractors
3. software
4. AI subscriptions
5. cloud
6. domains
7. APIs
8. testing
9. security
10. compliance
11. deployment
12. marketing/release
13. operations
14. maintenance
15. contingency

Track:

- estimated
- allocated
- committed
- actual
- remaining
- forecast

Budget changes must propagate to:

- project health
- scenario comparison
- baseline variance
- recommendations
- change requests

---

# 14. RESOURCE & CAPACITY ENGINE

Resource types:

- human
- AI-assisted human
- coding agent/tool
- external vendor
- shared organizational resource

Track:

- role
- skills
- availability
- working calendar
- capacity
- allocation
- cost
- assignments
- overload
- utilization
- bottleneck risk

Do not pretend an AI coding tool is a human employee.

Represent it as an execution capability attached to the human/team.

---

# 15. DEPENDENCY GRAPH + IMPACT ENGINE

This is another signature capability.

## 15.1 Dependency types

- requires
- blocks
- depends_on
- implements
- verifies
- evidenced_by
- deploys_to
- owned_by
- funded_by
- affected_by
- derived_from

## 15.2 Impact algorithm

For every change:

1. identify changed nodes
2. find directly connected nodes
3. traverse allowed impact relationships
4. classify direct/indirect/critical impact
5. calculate affected requirements
6. calculate affected architecture
7. calculate affected tasks
8. calculate affected tests
9. calculate affected evidence
10. recalculate schedule
11. recalculate budget
12. recalculate risk
13. identify documents requiring revision
14. identify approvals invalidated
15. produce preview
16. require approval for material changes
17. apply atomically
18. create new project version

Must handle cycles safely.

Must not create infinite propagation.

---

# 16. BASELINES & VARIANCE

Allow approved project plans to be frozen.

Baseline contains:

- scope
- requirements
- architecture snapshot
- milestones
- schedule
- resources
- budget
- risks
- gates

Compare:

**Baseline vs Current Plan vs Actual**

Variance:

- scope variance
- cost variance
- schedule variance
- milestone variance
- resource variance

Never mutate a frozen baseline.

---

# 17. LIVING DOCUMENT SYSTEM

First-class project documents:

1. Project Brief
2. Requirements
3. Architecture
4. Project Plan
5. Budget
6. Resource Plan
7. Risk Register
8. Test Strategy
9. Security Plan
10. Deployment Plan
11. Operations Plan
12. Decision Log
13. Assumption Register
14. Change Log
15. Retrospective
16. Handover

Every document:

- has stable ID
- version history
- owner
- status
- related project entities
- approval status
- timestamps
- diff
- audit history

V1 should use versioned editing, not real-time Google-Docs-style collaboration unless already supported naturally.

---

# 18. SECURITY ARCHITECTURE

Minimum requirements:

- secure authentication
- OIDC-ready identity
- MFA support where provider supports it
- server-side authorization
- strict tenant isolation
- object-level authorization
- project-level authorization
- least privilege
- secure session handling
- CSRF protection where relevant
- CSP
- secure headers
- input validation
- output encoding
- file-upload validation
- rate limiting
- abuse controls
- no secrets in logs
- no project-sensitive payloads in telemetry
- encrypted object storage
- secret-manager references only
- webhook signature verification
- dependency scanning
- secret scanning
- SAST
- vulnerable dependency blocking policy
- immutable audit trail

Security testing must cover OWASP-style API/object authorization failures.

---

# 19. PRIVACY ARCHITECTURE

Privacy-first requirements:

- data minimization
- purpose limitation
- configurable retention
- export
- deletion
- tenant-scoped data
- explicit external-AI boundary
- no automatic use of customer project data for future ML training
- sensitive-data redaction before external-AI prompt copy
- optional organization policy to disable external-AI workflow
- clear "data leaving this platform" summary

External-AI policy modes:

1. DISABLED
2. REDACTED_ONLY
3. APPROVED_PROVIDERS_ONLY
4. USER_CHOICE

---

# 20. AUDIT & VERSIONING

Audit immutable events for:

- authentication
- permission change
- project creation
- intake change
- requirement change
- architecture change
- task change
- budget change
- risk change
- gate evaluation
- approval
- evidence link
- AI import
- change request
- baseline
- deployment
- lifecycle transition
- export
- archive

Audit entry:

- actor
- tenant
- action
- entity
- correlation ID
- timestamp
- safe before/after summary/hash
- reason where available

---

# 21. API CONTRACT

Use REST + OpenAPI.

Contract-first.

Required groups:

- `/v1/projects`
- `/v1/intakes`
- `/v1/ai-interchanges`
- `/v1/ai-imports`
- `/v1/work-breakdowns`
- `/v1/tasks`
- `/v1/dependencies`
- `/v1/requirements`
- `/v1/traceability`
- `/v1/resources`
- `/v1/budgets`
- `/v1/risks`
- `/v1/tests`
- `/v1/evidence`
- `/v1/gates`
- `/v1/approvals`
- `/v1/change-requests`
- `/v1/impact-analyses`
- `/v1/baselines`
- `/v1/documents`
- `/v1/audit`
- `/v1/scenarios`
- `/v1/forecasts`
- `/v1/organizations`
- `/v1/members`
- `/v1/integrations`
- `/v1/search`
- `/v1/notifications`

Mutations must use:

- idempotency keys for duplicate-sensitive commands
- optimistic concurrency/version checks
- correlation IDs
- atomic database transactions

Long operations return jobs rather than blocking requests.

---

# 22. BACKGROUND JOB ARCHITECTURE

Jobs:

- project generation
- large impact analysis
- document export
- report generation
- evidence processing
- integration synchronization
- notification fan-out
- search indexing
- production verification batches

Every job must be:

- idempotent
- retryable
- observable
- tenant-scoped
- correlation-ID linked
- safe against duplicate delivery
- dead-lettered or surfaced after terminal failure

---

# 23. FRONTEND IMPLEMENTATION

The exported Stitch designs are the visual source.

Implement shared components before duplicating page markup.

Core primitives:

- AppShell
- PrimaryNav
- SecondaryNav
- ProjectSwitcher
- ProjectStatusHeader
- CommandPalette
- Search
- Button
- Input
- Select
- Textarea
- Checkbox
- Radio
- Toggle
- Badge
- StatusBadge
- SeverityBadge
- Progress
- Card
- Table
- Drawer
- Dialog
- Tabs
- Stepper
- Wizard
- EmptyState
- LoadingState
- ErrorState
- PermissionState
- ApprovalState
- GateState
- Timeline
- Calendar
- WorkTree
- Board
- DependencyGraph
- TraceabilityGraph
- ArchitectureGraph
- BudgetSummary
- RiskRegister
- DocumentSurface
- EvidenceUploader
- ScenarioComparison
- NotificationCenter

Use Storybook for states.

---

# 24. SCREEN IMPLEMENTATION MAP

Implement all locked screens.

## Entry & intake

1. Public Landing
2. Start New Project
3. Project Intake Wizard
4. Resources & Constraints
5. What We Know
6. Missing Information
7. External AI Prompt
8. Import AI Response
9. Import Validation
10. Generated Project Preview

## Command center

11. Project Feasibility
12. Project Home
13. Today / Focus
14. Project Roadmap
15. Timeline / Calendar
16. Dependency Graph
17. Milestones
18. Work Breakdown
19. Execution Board
20. Task Detail

## Resources & finance

21. Team & Resources
22. Workload & Capacity
23. Budget & Cost Control
24. Risks & Blockers

## Engineering control

25. Requirements
26. Requirement Traceability
27. Architecture
28. Quality Gates
29. Testing & Verification
30. Security

## Release/operations

31. Deployment & Release
32. Production Verification
33. Operations

## Change intelligence

34. Impact Analysis
35. Change Request Center
36. Decisions & Assumptions
37. Baselines & Variance
38. Project Health
39. Forecasts & Estimates
40. Scenario Planning
41. Recommendations & Exceptions

## Documents

42. Documents Hub
43. Document Viewer/Editor
44. Evidence
45. Change History
46. Approvals & Sign-offs
47. Retrospective
48. Completion & Handover
49. Project Specification

## Persistence & organization

50. Save Project / Sign Up
51. Login
52. My Projects
53. Organization Overview
54. Members & Roles
55. Organization Resources
56. Preferences
57. Integrations
58. Project Settings

## Mobile

59. Mobile Project Home
60. Mobile Today
61. Mobile Task Detail
62. Mobile Approval
63. Mobile Project Health
64. Mobile Notifications

## Required reusable states

- empty
- loading
- processing
- success
- warning
- error
- blocked
- unknown
- incomplete
- needs approval
- awaiting external AI
- invalid AI response
- no permission
- interrupted
- completed

---

# 25. ACCESSIBILITY

Target WCAG 2.2 AA.

Automate:

- axe checks
- semantic violations
- labels
- heading structure
- contrast where tooling can verify
- keyboard-triggerable controls

Explicit E2E coverage:

- full keyboard intake
- keyboard command palette
- keyboard board/task movement alternative
- keyboard graph node exploration alternative
- focus restoration after drawer/dialog close
- accessible error summary
- screen-reader-friendly gate status
- non-color status indicators
- 200% zoom/reflow critical flows

Graphs must provide an equivalent accessible relationship list/table.

---

# 26. OBSERVABILITY

Implement:

- structured logs
- traces
- metrics
- correlation IDs
- job metrics
- API latency
- error rates
- database pool health
- queue depth
- failed jobs
- deployment markers
- production verification status

Do not log:

- project source code
- uploaded documents
- secrets
- tokens
- sensitive user-entered project details unnecessarily
- raw external-AI payloads in general logs

---

# 27. DATABASE RELIABILITY

Required:

- atomic writes
- foreign keys
- unique constraints
- check constraints
- version columns
- optimistic concurrency
- tenant-scoped indexes
- migration rollback/forward strategy
- migration verification
- backups
- restore testing
- no destructive migration without safe transition
- reconciliation checks after material migrations

Never assume a successful migration command means data correctness.

---

# 28. ENVIRONMENTS & DEPLOYMENT

Environments:

1. local
2. test
3. preview
4. staging
5. production

Automated path:

**PR/branch → CI → preview → automated verification → staging → full verification → production → production verification**

Production must not be considered successful merely because deployment command exited 0.

Verify:

- DNS/host
- HTTPS/TLS
- correct application identity
- security headers
- public route health
- authenticated route health
- API health
- DB connectivity
- object storage
- background jobs
- critical user journey
- no obvious client/server errors
- production version/commit identity

---

# 29. ROLLBACK

Before production:

- record previous known-good deployment
- record current candidate
- ensure DB compatibility
- document rollback command/process

After production deploy failure:

1. stop promotion
2. collect evidence
3. determine app-only vs migration issue
4. rollback safely
5. verify previous known-good version
6. document incident
7. fix on isolated branch/worktree
8. rerun full affected test suite

Perform at least one rollback drill before final release.

---

# 30. AUTONOMOUS BUG-FIX POLICY

When any test fails:

1. capture exact failing test
2. capture logs/artifacts
3. classify failure
4. identify likely root cause
5. implement smallest justified fix
6. rerun failing test
7. rerun related suite
8. rerun regression suite required by impact
9. verify no unrelated regression
10. record fix in development story

If no validated fix is achieved:
- revert the attempted change
- keep evidence
- create known-issue entry
- do not silently suppress or delete the test

Never weaken a test just to obtain green CI unless the requirement itself was proven incorrect.

---

# 31. TEST DATA STRATEGY

Create deterministic fixtures:

- solo project
- AI-assisted solo project
- 3-person startup
- 12-person professional team
- 100-person enterprise
- zero-budget project
- unrealistic deadline
- security-sensitive public app
- project with missing information
- invalid AI import
- conflicting AI import
- circular dependency
- budget overrun
- failed gate
- approval rejection
- major architecture change
- completed/handover project
- cross-tenant access attempt

Golden project fixture:

**GST Compliance Platform**
- enterprise web application
- 12-person team
- £180,000 budget
- 8-month target

Use this consistently for design parity and deep system tests.

---

# 32. DETAILED AUTOMATED TEST PLAN

## 32.1 Domain/model — minimum 70

Cover:

- valid creation
- invalid states
- tenant ownership
- project versioning
- immutable baseline
- parent-child hierarchy
- relationship constraints
- unique IDs
- optimistic concurrency
- audit generation

## 32.2 Rules engine — minimum 100

Cover:

- every initial critical rule
- positive condition
- negative condition
- boundary inputs
- version selection
- conflicting rules
- deprecated rules
- missing input
- explanation generation
- rule-pack isolation

## 32.3 Lifecycle/gates — minimum 45

Cover all allowed/prohibited transitions and gate states.

## 32.4 AI interchange — minimum 55

Cover:

- invalid JSON
- wrong schema
- wrong version
- extra properties
- missing required fields
- invalid references
- conflict with user-confirmed fact
- unsupported project type
- unsafe restricted data
- provenance absence
- impossible dates
- cyclic phase refs
- huge payload limits
- duplicate IDs

## 32.5 Calculations — minimum 50

Golden calculations for:

- capacity
- budget
- forecast
- variance
- contingency
- scenario comparison
- schedule
- effort range
- actual vs plan

## 32.6 Impact/dependency — minimum 50

Cover:

- direct impact
- transitive impact
- cycle protection
- no-impact change
- approval invalidation
- budget recalculation
- schedule recalculation
- risk propagation
- doc invalidation
- test invalidation

## 32.7 API/contract — minimum 55

Cover happy/error/auth/idempotency/concurrency cases.

## 32.8 Auth/tenant isolation — minimum 50

Attempt Organization A → Organization B access through:

- direct object IDs
- lists
- search
- document endpoints
- evidence
- downloads
- jobs
- notifications
- audit
- integrations
- exports

Expected result: no cross-tenant data disclosure.

## 32.9 Frontend — minimum 45

Components and hard states.

## 32.10 Playwright — minimum 40

Critical journeys:

1. anonymous start
2. intake
3. unknown answers
4. AI prompt copy
5. AI import
6. validation failure
7. validation success
8. preview
9. signup-to-save
10. login
11. Project Home
12. Today
13. task update
14. dependency update
15. budget update
16. risk creation
17. gate failure
18. evidence upload
19. gate pass
20. approval
21. requirement trace
22. architecture view
23. test view
24. security view
25. deployment readiness
26. production verification
27. change request
28. impact analysis
29. change approval
30. baseline
31. scenario comparison
32. document version
33. retrospective
34. handover
35. organization users
36. permission denied
37. mobile Project Home
38. mobile Today
39. keyboard flow
40. logout/session expiry

## 32.11 Accessibility — minimum 20

## 32.12 Security — minimum 20

Include:

- BOLA
- broken function authorization
- privilege escalation
- insecure direct object refs
- CSRF where relevant
- injection inputs
- upload spoofing
- oversized payload
- path traversal attempts
- webhook forgery
- rate-limit abuse
- secret leakage checks
- unsafe redirect
- SSRF-like integration URL inputs
- security headers
- cookie/session flags

## 32.13 Jobs/migrations/recovery — minimum 20

---

# 33. PERFORMANCE TARGETS

Define measurable budgets during implementation.

Initial targets:

- normal authenticated page LCP target ≤ 2.5s on representative connection/device
- interaction latency target ≤ 200ms for normal UI operations where no server-heavy job is required
- API p95 normal read target ≤ 400ms under defined test load
- API p95 normal mutation target ≤ 700ms under defined test load
- heavy analysis runs asynchronously
- no dependency graph should freeze main thread on representative large fixture
- large tables must virtualize/paginate as necessary

Record actual validated limits rather than claiming targets were achieved without evidence.

---

# 34. IMPLEMENTATION PHASES

## Phase 0 — Handoff, audit, baseline
Tasks:
- repo audit
- design inventory
- token extraction
- build baseline
- test baseline
- security baseline
- docs bootstrap

Gate:
- repository understood and reproducible

## Phase 1 — Foundation
Tasks:
- monorepo/app structure if needed
- TypeScript strict config
- formatting/linting
- Storybook
- testing stack
- env validation
- logging/correlation IDs
- base error model
- CI

Gate:
- green foundation pipeline

## Phase 2 — Design system + shell
Tasks:
- tokens
- core primitives
- application shell
- navigation
- status header
- command/search shell
- responsive layout
- hard states

Gate:
- Storybook/component accessibility green

## Phase 3 — Database + tenancy + auth
Tasks:
- schema
- migrations
- tenancy
- memberships
- RBAC
- audit foundation
- session/auth
- authorization middleware

Gate:
- tenant-isolation suite green

## Phase 4 — Intake + guest flow
Tasks:
- landing
- project start
- intake
- resources/constraints
- confirmed/assumed/unknown
- guest persistence strategy
- preview state

Gate:
- anonymous E2E flow green through prompt creation

## Phase 5 — External AI interchange
Tasks:
- schema
- prompt template engine
- data-leaving summary/redaction
- import
- syntax/schema/semantic validation
- provenance
- correction loop

Gate:
- golden valid/invalid payload suite green

## Phase 6 — Project Digital Twin
Tasks:
- canonical entities
- versions
- trace links
- domain invariants
- project generation transaction

Gate:
- deterministic generation from golden fixture

## Phase 7 — Rules + lifecycle + quality gates
Tasks:
- rule DSL/data model
- initial rule packs
- evaluator
- explanations
- lifecycle state machine
- quality gates

Gate:
- rules/lifecycle golden suites green

## Phase 8 — Work decomposition + execution
Tasks:
- phases
- workstreams
- milestones
- epics
- tasks/subtasks
- board
- Today
- Project Home
- dependencies

Gate:
- solo + 12-person fixtures produce valid execution plans

## Phase 9 — Budget/resource/forecast core
Tasks:
- capacity
- resource assignment
- budget categories
- estimate formulas
- variance
- deterministic forecast
- feasibility
- scenarios

Gate:
- calculation golden suite green

## Phase 10 — Requirements/architecture/traceability
Tasks:
- requirement management
- architecture components
- graph
- traceability
- missing-link detection

Gate:
- complete Requirement→Release chain verified

## Phase 11 — Testing/security/release/operations domain
Tasks:
- tests
- test evidence
- security requirements/findings
- deployment
- production checks
- operations
- incidents
- technical debt

Gate:
- release-readiness flow works end-to-end

## Phase 12 — Change intelligence
Tasks:
- change requests
- impact traversal
- preview
- recalculation
- approval
- application
- version creation

Gate:
- major architecture-change golden scenario verified

## Phase 13 — Baselines/documents/evidence/approvals
Tasks:
- baseline freeze
- variance
- Tiptap document system
- versions
- evidence repository
- approvals
- sign-offs
- change history

Gate:
- immutable baseline + evidence audit verified

## Phase 14 — Completion/retrospective/handover
Tasks:
- retrospective
- lessons
- completion gate
- handover
- archive

Gate:
- project can formally close only when criteria pass/accepted exceptions exist

## Phase 15 — Organization features
Tasks:
- organizations
- members
- roles
- resources
- preferences
- integrations UI
- portfolio overview

Gate:
- multi-project/role behavior verified

## Phase 16 — Mobile/responsive completion
Tasks:
- mobile Project Home
- Today
- task
- approval
- health
- notifications
- graph/table graceful fallback

Gate:
- defined mobile E2Es/accessibility pass

## Phase 17 — Search/integrations
V1 priority only.

Implement only integrations actually approved for V1.

Do not let integration scope delay the deterministic core.

## Phase 18 — Hardening
Tasks:
- complete 600+ tests
- security regression
- performance
- accessibility
- resilience
- backup/restore
- rollback
- migration drill
- failure injection where practical

Gate:
- release candidate

## Phase 19 — Staging
Tasks:
- deploy
- migrate
- seed safe staging fixture
- full automated E2E
- security headers
- API tests
- performance smoke
- rollback readiness

Gate:
- staging green

## Phase 20 — Production
Tasks:
- production deployment
- automated production verification
- version identity
- critical journey
- health
- telemetry check
- rollback target recorded

Gate:
- production verified

## Phase 21 — Final verification
Tasks:
- full evidence collection
- docs finalization
- development story
- known issues
- test count
- release manifest
- final architecture reconciliation

Output final implementation report.

---

# 35. DEFINITION OF DONE

The project is not done because:

- pages render
- TypeScript compiles
- build passes
- deployment succeeded
- screenshots look close

DONE requires:

1. All approved V1 features implemented.
2. All locked critical screens implemented.
3. Designs mapped and reconciled.
4. Project Digital Twin operational.
5. Rules engine operational.
6. Lifecycle/gates operational.
7. AI interchange validated deterministically.
8. Budget/resource/dependency/impact engines operational.
9. Requirements traceability operational.
10. Living docs/versioning/audit operational.
11. Security/tenant isolation verified.
12. At least 600 meaningful automated tests present and passing.
13. No known critical/high security defect.
14. No unresolved P0/P1 functional defect.
15. Accessibility acceptance achieved to declared scope.
16. Backup/restore validated.
17. Rollback validated.
18. Staging verified.
19. Production deployed.
20. Production independently re-verified.
21. Development story complete.
22. Architecture documentation matches actual implementation.
23. Test evidence recorded.
24. Deployment commit/version recorded.
25. Remaining non-blocking limitations explicitly documented.

---

# 36. V1 BOUNDARIES

Build in V1:

- deterministic project engine
- guest intake
- external-AI prompt/import contract
- software-project-focused rule packs
- Project Digital Twin
- execution planning
- lifecycle
- quality gates
- requirements
- architecture
- dependencies
- budget
- resources
- risks
- testing/security/release/operations
- change impact
- baselines
- documents
- audit
- project/organization persistence
- core dashboards
- responsive critical flows

Defer unless required by existing implementation:

- proprietary ML training
- Kafka
- microservices
- real-time collaborative document editing
- dozens of integrations
- construction/healthcare/non-software industry packs
- fully autonomous external-AI API calls
- heavy portfolio optimization models

---

# 37. FUTURE ML CONTRACT

When enough real, consented, high-quality historical project data exists:

Possible models:

1. effort prediction
2. completion-date prediction
3. budget overrun probability
4. risk escalation prediction
5. resource bottleneck prediction
6. estimation calibration
7. task-order optimization

Requirements before enabling ML:

- separate training consent/policy
- training dataset lineage
- feature provenance
- model versioning
- evaluation
- bias/error analysis
- confidence calibration
- rollback
- deterministic fallback
- explanation of prediction
- never silently replace deterministic facts with model output

---

# 38. AGENT OPERATING RULES

The coding agent MUST:

- prefer correctness over speed
- inspect before editing
- preserve approved designs
- preserve user data
- never fabricate test results
- never claim deployment without probing it
- never claim a security control without verifying it
- never hide failed tests
- never delete failing tests to make CI green
- never expose secrets
- never put secrets in docs/logs/screenshots
- never make unrelated system changes
- never introduce major infrastructure without evidence it is needed
- keep the architecture modular
- keep V1 deterministic
- update docs continuously
- capture exact versions
- make small verified commits
- use isolated branches/worktrees for risky autonomous fixes
- revert unverifiable fixes
- maintain a last-known-good state

---

# 39. FINAL AUTONOMOUS EXECUTION PROMPT

Implement this platform from the repository using this document as the authoritative implementation contract.

First perform Phase 0: repository and design-handoff verification.

Do not begin broad feature implementation until Phase 0 passes.

Then execute phases sequentially, while allowing safe parallelization only where contracts are already frozen.

For every change:
- identify impact
- implement
- test
- diagnose
- fix
- retest
- regression test
- verify
- document

Maintain a minimum of 600 meaningful automated tests by final release.

Use the exported Stitch designs as the visual source of truth.

Where designs are incomplete, extend the existing design system rather than inventing a conflicting UI.

Keep the deterministic rules/project engine as the core system. External AI is optional and provider-neutral.

Do not add paid AI API dependency to V1.

Maintain strict tenant isolation, privacy boundaries, provenance, calculation explainability, auditability, and version history.

Autonomously deploy through staging and production only after required gates pass. After deployment, run automated production verification. If production verification fails, execute the documented rollback path and verify recovery.

Continuously update `docs/DEVELOPMENT_STORY.md`.

Do not declare the project complete until every Definition of Done item is satisfied and evidence is recorded.

---

# 40. FIRST ACTION FOR CLAUDE CODE

Start with:

**PHASE 0 — REPOSITORY + DESIGN HANDOFF VERIFICATION**

Produce:

1. repository inventory
2. design/export inventory
3. screen-to-file map
4. actual technology/version inventory
5. dependency/security scan
6. baseline build result
7. baseline test result
8. initial architecture reconciliation
9. risks/blockers
10. proposed exact implementation sequence based on what physically exists in the repo

Then continue autonomously if the Phase-0 gate is green.

If the repository materially conflicts with this implementation plan, do not silently rewrite the plan. Document the conflict, choose the smallest justified adaptation, update the architecture/implementation decision record, and preserve the locked product behavior.
