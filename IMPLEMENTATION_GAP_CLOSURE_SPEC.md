# IMPLEMENTATION GAP-CLOSURE & MISSING-INFORMATION SPECIFICATION

**Document type:** Mandatory companion to `MASTER_IMPLEMENTATION_PLAN.md`  
**Status:** LOCK BEFORE BROAD IMPLEMENTATION  
**Date:** 2026-08-31  
**Purpose:** Eliminate every remaining ambiguity, assumption, missing contract, failure mode, and implementation gap before autonomous implementation proceeds.

---

# 0. HOW THIS DOCUMENT MUST BE USED

This document is not a replacement for the Master Implementation Plan.

Use both documents together:

1. `MASTER_IMPLEMENTATION_PLAN.md`
2. `IMPLEMENTATION_GAP_CLOSURE_SPEC.md`

The Master Implementation Plan defines the system and execution phases.

This document defines:

- unresolved decisions
- missing specifications
- exact contracts to produce
- mandatory acceptance criteria
- dangerous assumptions to eliminate
- edge cases
- failure modes
- project rules
- verification requirements
- V1 boundaries
- implementation evidence requirements
- what Claude Code must discover from the real repository before coding

When this document says **MUST**, treat it as mandatory unless a repository-level constraint makes it technically impossible.

If any conflict exists between:
- exported Stitch design
- repository implementation
- Master Implementation Plan
- this document

the agent must:

1. identify the conflict;
2. record it;
3. preserve the product behaviour and architecture intent;
4. choose the smallest justified adaptation;
5. update architecture documentation;
6. test the adaptation;
7. never silently ignore the conflict.

---

# 1. FINAL PRE-IMPLEMENTATION GAPS

The following information is not allowed to remain implicit.

Every item below must become either:

- VERIFIED FROM REPOSITORY
- FORMALLY DECIDED
- FORMALLY DEFERRED
- NOT APPLICABLE

before the related implementation phase is considered complete.

---

# 2. REPOSITORY REALITY CHECK

Before broad implementation, determine the exact physical state of the repository.

Create:

`docs/REPOSITORY_REALITY.md`

It must include:

## 2.1 Source structure

Record:

- root folders
- apps
- packages
- generated code
- handwritten code
- design exports
- public assets
- documentation folders
- tests
- infrastructure files
- scripts
- CI files
- deployment files
- database files
- environment examples
- lockfiles
- package manager
- monorepo tooling if any

## 2.2 Version inventory

Record exact versions for:

- Node.js
- package manager
- Next.js
- React
- TypeScript
- Tailwind
- test runner
- Playwright
- Storybook
- database client/ORM
- PostgreSQL
- Redis
- queue library
- schema validator
- editor library
- graph library
- auth SDK
- lint/format tooling

Do not install or upgrade blindly.

First determine what already exists.

## 2.3 Generated-design classification

Every generated design/code file must be classified as:

- KEEP AS-IS
- KEEP AND REFACTOR
- VISUAL REFERENCE ONLY
- DUPLICATE
- UNUSED
- BROKEN
- REPLACE WITH SHARED COMPONENT
- UNKNOWN

No large-scale deletion until this map exists.

## 2.4 Baseline evidence

Before implementation:

- clean install
- typecheck
- lint
- build
- current tests
- current screenshots
- current Lighthouse/performance baseline if meaningful
- current accessibility scan
- secret scan
- dependency vulnerability scan

Store baseline results.

---

# 3. DESIGN HANDOFF COMPLETENESS

Create:

`docs/DESIGN_HANDOFF_SPEC.md`

The design handoff is complete only when the implementation team has extracted the following.

## 3.1 Exact design tokens

Must define:

- background
- surface-1
- surface-2
- surface-3
- border-default
- border-strong
- text-primary
- text-secondary
- text-muted
- accent-primary
- accent-hover
- accent-active
- success
- warning
- danger
- info
- blocked
- unknown
- approval
- focus ring

Also define:

- font families
- fallback font stack
- display font
- body font
- monospace font
- font weights
- font-size scale
- line-height scale
- letter-spacing scale
- spacing scale
- container widths
- border radii
- shadows
- breakpoints
- animation duration
- easing
- z-index system

Do not guess exact token values if the export contains them.

Extract them first.

## 3.2 Component state completeness

Every reusable component must have, where applicable:

- default
- hover
- active
- focus
- disabled
- loading
- error
- success
- selected
- unselected
- read-only
- permission denied
- empty
- overflow/long text
- mobile

## 3.3 Required responsive behaviour

Define exact behaviour at:

- mobile
- small tablet
- large tablet
- laptop
- desktop
- wide desktop

The implementation must not merely shrink desktop UI.

## 3.4 Dense-screen responsive rules

For:

- dependency graph
- traceability graph
- architecture diagram
- timeline
- calendar
- work breakdown
- budget table
- risk register
- test matrix
- audit log

define:

- desktop primary representation
- tablet fallback
- mobile fallback
- accessible alternative

## 3.5 Missing designs

If any locked screen is not present in the export:

1. use the established design system;
2. reuse existing primitives;
3. preserve navigation and visual language;
4. build the missing screen from the locked screen specification;
5. document that it was derived rather than directly exported.

---

# 4. EXACT V1 PRODUCT SCOPE

The project must avoid becoming an unlimited software-consulting platform in V1.

## 4.1 V1 supported project classes

V1 should formally support:

1. Public web application
2. SaaS web application
3. Internal business web application
4. API/backend platform
5. Mobile application planning
6. AI-enabled web application
7. Developer tooling / internal platform
8. Ecommerce/web transaction system

## 4.2 V1 partially supported

May be accepted with explicit limitations:

- data platforms
- desktop applications
- embedded software
- large distributed systems
- regulated software
- legacy modernization

The UI must communicate limitations.

## 4.3 Out of V1

Do not claim complete domain expertise for:

- construction delivery
- pharmaceutical trials
- medical-device certification
- aerospace certification
- automotive functional safety
- civil engineering
- legal case management
- manufacturing plant planning

Future industry packs may support them.

---

# 5. GUEST SESSION CONTRACT

The guest-first workflow needs an exact data model.

## 5.1 Guest capabilities

Anonymous users may:

- start a project
- answer intake
- use "I don't know"
- generate AI request
- import AI result
- validate
- preview generated project
- browse a limited generated result

## 5.2 Guest persistence

Decide and implement a safe temporary persistence strategy.

Recommended:

- random guest session ID
- HttpOnly secure cookie
- server-side temporary project state
- expiry
- no user-identifying account required

Do not store full sensitive project data permanently without signup.

## 5.3 Guest expiry

Default proposed V1:

- guest projects expire automatically
- configurable exact period during implementation
- user is warned before leaving if unsaved
- signup/save converts guest project atomically

## 5.4 Save conversion

Conversion must preserve:

- project ID or durable mapping
- intake
- imported AI response
- generated preview
- assumptions
- warnings
- project version
- timestamps

No duplicate project must be created from repeated save requests.

Test concurrent double-submit.

---

# 6. ACCOUNT & IDENTITY DECISIONS

## 6.1 Authentication contract

Use provider-neutral OIDC architecture.

Do not couple domain entities directly to one identity provider.

User identity key:

- issuer
- subject

Optional profile:

- email
- display name
- avatar URL

## 6.2 Login methods

Implementation plan should support at minimum one production login method.

Future compatibility:

- passwordless email
- Google
- Microsoft
- enterprise OIDC/SAML bridge

Do not implement every provider in V1 unless required.

## 6.3 Session controls

Must define:

- session duration
- idle timeout
- absolute timeout
- logout behaviour
- session revocation
- passwordless/email-link expiry if used
- MFA behaviour if provider supports it
- account lock/security event policy

---

# 7. ORGANIZATION & TENANCY MODEL

## 7.1 Tenant hierarchy

Canonical hierarchy:

Organization
→ Projects
→ Project memberships/resources

A user can belong to multiple organizations.

## 7.2 Organization roles

Proposed V1:

- OWNER
- ADMIN
- MEMBER
- AUDITOR

## 7.3 Project roles

Proposed V1:

- PROJECT_OWNER
- PROJECT_MANAGER
- ENGINEER
- REVIEWER
- APPROVER
- VIEWER

## 7.4 Exact permissions matrix

Create:

`docs/PERMISSIONS_MATRIX.md`

Matrix must cover every sensitive action.

Examples:

- create project
- edit intake
- import AI result
- approve AI import
- edit requirements
- edit architecture
- edit budget
- view budget
- view evidence
- upload evidence
- delete evidence
- create baseline
- approve gate
- override gate
- request exception
- approve exception
- deploy/release mark
- archive project
- export project
- manage members
- manage integrations
- view audit logs

## 7.5 Tenant isolation

Every tenant-owned query must require tenant context.

Tests must attempt cross-tenant access using:

- direct IDs
- predictable IDs
- list endpoints
- filtering
- search
- export
- evidence download
- jobs
- notifications
- audit endpoints
- change requests
- documents
- integration events

---

# 8. PROJECT DIGITAL TWIN — CANONICAL CONTRACT

The Digital Twin is not merely a dashboard concept.

It is the canonical project graph and versioned state.

Create:

`docs/PROJECT_DIGITAL_TWIN_SCHEMA.md`

## 8.1 Node classes

Minimum node types:

- project
- objective
- requirement
- architecture component
- architecture decision
- phase
- workstream
- milestone
- epic
- task
- subtask
- checkpoint
- resource
- budget item
- estimate
- risk
- blocker
- test
- evidence
- gate
- approval
- document
- deployment
- environment
- incident
- operational task
- assumption
- unknown
- change request
- baseline
- scenario
- forecast

## 8.2 Edge classes

Minimum relationship types:

- contains
- depends_on
- blocks
- implements
- satisfies
- derived_from
- verifies
- evidenced_by
- owned_by
- assigned_to
- funded_by
- mitigates
- impacts
- deploys_to
- approved_by
- invalidates
- supersedes

## 8.3 Graph invariants

Examples:

- dependency cycles must be detected
- parent hierarchy cannot contain self
- task cannot verify requirement
- test may verify requirement
- evidence may support test/gate/approval
- baseline is immutable
- archived project is read-only except permitted restoration
- completed gate cannot silently change when source evidence changes; it becomes stale/revalidation-required

## 8.4 Versioning

Every material change should be associated with project version/correlation ID.

Do not copy the entire database for every version.

Use:

- stable entities
- versioned records/snapshots where needed
- audit log
- immutable baseline snapshot
- calculation snapshots

---

# 9. PROJECT INTAKE CONTRACT

Create:

`docs/INTAKE_SCHEMA.md`

## 9.1 Required categories

- idea/summary
- project type
- objectives
- target users
- key capabilities
- budget
- deadline
- team
- skills
- working capacity
- existing stack
- existing code
- infrastructure
- domains
- APIs
- third parties
- data types
- privacy
- security
- compliance
- deployment
- availability expectations
- performance expectations
- accessibility expectations
- maintenance expectations

## 9.2 Every question must support one of

- confirmed answer
- unknown
- unsure
- use recommended default
- defer to external research

## 9.3 Information status

Each intake field must have:

- value
- state
- provenance
- confidence
- last updated
- who confirmed it

States:

- CONFIRMED
- PROVIDED
- ASSUMED
- UNKNOWN
- EXTERNAL_RESEARCH_REQUIRED
- CONFLICTING

---

# 10. MISSING-INFORMATION ENGINE

The engine must classify missing information.

## 10.1 Critical

Without it, the system cannot produce a safe/reliable project plan.

Examples:

- fundamental project type
- major delivery target
- required data sensitivity when security decisions depend on it
- impossible/missing currency when budget calculation is requested

## 10.2 Recommended

Can proceed using assumptions, but quality decreases.

## 10.3 Optional

Useful but not required for V1 plan generation.

## 10.4 Rule-driven questioning

Missing-information requirements must come from rule packs, not hardcoded scattered UI logic.

---

# 11. EXTERNAL-AI PROMPT PACKAGE

Create:

`docs/EXTERNAL_AI_PROMPT_PROTOCOL.md`

The platform must generate a complete, provider-neutral one-shot package.

## 11.1 Prompt package must contain

- purpose
- project context
- confirmed facts
- unknowns
- assumptions allowed
- prohibited assumptions
- missing questions
- research requests
- source requirements
- output schema
- exact output restrictions
- version identifiers

## 11.2 External AI instructions

It should be instructed to:

- ask the user critical clarification questions before final output if needed
- avoid inventing missing facts
- mark assumptions
- separate researched claims from inference
- include concise evidence/source references where relevant
- return only the required final structured object
- not include hidden chain-of-thought
- include confidence/provenance

## 11.3 Copy safety screen

Before copying prompt, show:

- what data will leave the platform
- sensitive items detected
- redactions applied
- external AI privacy warning
- organization policy

---

# 12. AI IMPORT VALIDATION — FULL CONTRACT

Structural JSON validation is not enough.

Create:

`docs/AI_IMPORT_VALIDATION_RULES.md`

## 12.1 Validation layers

1. payload size
2. encoding
3. JSON syntax
4. JSON Schema
5. supported schema version
6. reference integrity
7. field domain validation
8. semantic invariants
9. conflict validation
10. provenance validation
11. confidence validation
12. policy/security validation
13. completeness validation
14. generation readiness

## 12.2 Conflict examples

Reject or require resolution when:

- user says budget = £20,000 but AI says £200,000 as fact
- user says no mobile app but AI marks mobile as confirmed requirement
- user deadline is fixed but AI silently changes it
- AI claims compliance requirement without basis
- AI creates nonexistent dependency references
- AI marks assumption as user-confirmed
- AI returns a project type outside supported V1 taxonomy without fallback

## 12.3 Safe import

Do not mutate canonical project on validation.

Use staging import:

RAW
→ PARSED
→ VALIDATED
→ REVIEWED/ACCEPTED
→ MATERIALIZED

---

# 13. RULE ENGINE — FORMAL DSL / DATA FORMAT

The rule engine must be data-driven.

Create:

`docs/RULE_FORMAT_SPEC.md`

Recommended rule fields:

- id
- version
- title
- description
- category
- severity
- project_type_scope
- lifecycle_scope
- conditions
- required_inputs
- emitted_requirements
- emitted_tasks
- emitted_tests
- emitted_gates
- emitted_risks
- calculation_effects
- rationale
- remediation
- references
- active_from
- deprecated_from

## 13.1 Rule determinism

Given:
- same project version
- same ruleset version
- same inputs

the engine must return the same result.

## 13.2 Rule conflicts

Define precedence:

1. legal/security mandatory rules
2. organization policy
3. project explicit constraints
4. project-type rule pack
5. methodology rule pack
6. recommended defaults

Never resolve conflicting critical rules silently.

## 13.3 Rule explanations

Every important emitted action should answer:

**Why is this required?**

---

# 14. INITIAL RULE CATALOGUE — MINIMUM 250

Create categories and target counts.

Suggested:

| Category | Minimum rules |
|---|---:|
| Intake/discovery | 20 |
| Requirements | 20 |
| Architecture | 25 |
| Project planning | 20 |
| Resource/capacity | 15 |
| Budget/estimation | 20 |
| Testing/QA | 35 |
| Security | 35 |
| Accessibility | 10 |
| Deployment/release | 20 |
| Production verification | 15 |
| Operations/maintenance | 10 |
| Documentation/handover | 10 |
| Change control/governance | 15 |
| **Total** | **270** |

The rules must be meaningful.

Do not create artificial rules solely to meet a number.

---

# 15. QUALITY GATE CATALOGUE

Create:

`docs/GATE_CATALOGUE.md`

Each gate must define exact criteria.

## 15.1 Discovery Gate

Examples:

- project objective defined
- project type known/assumed
- critical constraints captured
- major unknowns identified
- external research performed or explicitly deferred

## 15.2 Requirements Gate

- critical requirements captured
- acceptance/verification method defined
- critical unknown requirements resolved
- privacy/security requirements included where applicable
- orphan critical objectives identified

## 15.3 Architecture Gate

- system context exists
- key components identified
- data architecture defined
- integration boundaries known
- security architecture exists
- deployment topology defined
- critical ADRs captured

## 15.4 Planning Gate

- work breakdown exists
- dependencies valid
- estimates present
- team/resource assignment feasible
- budget calculation complete
- major risks captured
- milestones defined

## 15.5 Development Gate

- implementation work for release scope complete
- required code review/verification evidence present
- required unit/integration testing threshold met

## 15.6 Testing Gate

- required test categories executed
- critical failures zero
- accepted exceptions documented
- requirement verification coverage meets policy

## 15.7 Security Gate

- security findings reviewed
- release-blocking findings resolved
- auth/authz verification complete
- dependency/secret scans acceptable
- required threat/security tests complete

## 15.8 Release Readiness Gate

- deployment plan
- rollback plan
- migration plan
- release notes
- approvals
- monitoring
- backup readiness
- environment configuration

## 15.9 Production Verification Gate

- availability
- TLS
- security headers
- critical journeys
- auth
- APIs
- monitoring
- logging
- backup/restore assumptions
- deployment identity

## 15.10 Operational Readiness Gate

- ownership
- alerts
- incident process
- support/maintenance tasks
- known limitations
- technical debt
- backup schedule

## 15.11 Completion/Handover Gate

- requirements dispositioned
- tests complete
- security resolved/accepted
- documents complete
- ownership transferred
- credentials/admin ownership transferred
- known debt recorded
- final evidence captured

---

# 16. METHODOLOGY ENGINE

The product cannot hardcode one delivery method.

Supported V1:

- Agile/Scrum-like
- Kanban/continuous flow
- Waterfall/sequential
- Hybrid
- Solo/agent-assisted execution profile

Methodology affects:

- work decomposition
- milestone structure
- iteration boundaries
- gate placement
- planning cadence
- change handling

Methodology must not bypass mandatory security/release gates.

---

# 17. PROJECT DECOMPOSITION RULES

Canonical hierarchy:

Project
→ Phase
→ Workstream
→ Milestone
→ Epic
→ Task
→ Subtask
→ Checkpoint

Not every project requires every hierarchy depth.

Example:

Solo small project:
Project → Phase → Milestone → Task

Enterprise:
Project → Phase → Workstream → Milestone → Epic → Task → Subtask

Avoid fake hierarchy.

---

# 18. RESOURCE MODEL — EXACT BEHAVIOUR

## 18.1 Human resources

Fields:

- role
- skills
- cost
- capacity
- working days
- availability dates
- timezone
- project allocation

## 18.2 Coding agents / AI tools

Represent as capabilities, not employees.

Examples:

- Claude Code available
- IDE agent available
- test-generation agent available

An AI tool may influence:

- execution profile
- suggested parallelism
- effort assumptions

But:
- it has no employment cost unless subscription/API costs exist
- it does not own approvals
- it cannot be responsible for legally required human accountability
- its work requires verification based on project policy

## 18.3 Solo developer behaviour

The system must still decompose the project.

But avoid useless assignment bureaucracy.

The purpose is:

- sequencing
- checkpoints
- dependencies
- verification
- progress
- risk
- budget
- focus

not team ceremony.

---

# 19. CAPACITY CALCULATION SPEC

Create:

`docs/CAPACITY_CALCULATION_SPEC.md`

Define:

Available Capacity =
Working Hours
- Leave
- Non-project allocation
- Meetings/overhead allowance
- Operational/support commitment

Project capacity must be time-bucketed.

Support:

- weekly
- monthly
- milestone window

Detect:

- overload
- impossible parallel assignments
- missing skill coverage
- single-person bottleneck

---

# 20. ESTIMATION ENGINE — V1 FORMALIZATION

Do not pretend to know exact delivery time.

## 20.1 Inputs

- task complexity
- effort range
- team capacity
- dependencies
- parallelism
- skill matching
- contingency
- project type
- quality/security burden

## 20.2 Output

Use:

- optimistic
- expected
- conservative

or:

- min
- expected
- max

## 20.3 Confidence

Confidence classes:

- LOW
- MEDIUM
- HIGH

## 20.4 Estimation provenance

Every estimate must record:

- source
- formula
- assumptions
- engine version
- manually overridden?
- override reason

---

# 21. BUDGET ENGINE — MISSING DECISIONS

Create:

`docs/BUDGET_CALCULATION_SPEC.md`

## 21.1 Currency

A project has one base currency.

External costs may have original currency.

Store:

- original amount/currency
- converted base amount
- FX source/time when conversion exists

Do not silently use live FX without recording rate provenance.

## 21.2 Cost types

- one-time
- recurring monthly
- recurring annual
- usage-based
- human hourly/daily/salary-derived
- contingency
- unknown/TBD

## 21.3 Budget states

- ESTIMATED
- ALLOCATED
- COMMITTED
- ACTUAL
- FORECAST

## 21.4 Actuals

V1 actual costs may be manually entered/imported.

Do not claim accounting-system-grade reconciliation unless implemented.

## 21.5 Contingency

Must be explicit and explainable.

Never hide contingency inside inflated task estimates.

---

# 22. FEASIBILITY ENGINE

Feasibility is not a magic score.

Dimensions:

- scope feasibility
- timeline feasibility
- budget feasibility
- resource feasibility
- skill feasibility
- technical feasibility
- security/compliance feasibility
- dependency feasibility

Status:

- FEASIBLE
- FEASIBLE_WITH_RISK
- UNREALISTIC
- UNKNOWN

Each status must include reasons.

---

# 23. PROJECT HEALTH ENGINE

Do not create an unexplained 83/100.

Health dimensions:

- scope
- schedule
- budget
- quality
- security
- resources
- risk
- dependencies

Status:

- HEALTHY
- WATCH
- AT_RISK
- CRITICAL
- UNKNOWN

Each status must link to causes.

---

# 24. NEXT ACTION ENGINE

The user should not need to inspect every module.

Determine next action using priorities.

Proposed priority order:

1. Critical security/release blocker
2. Failed mandatory gate
3. Active blocker on critical path
4. Required approval
5. Critical missing information
6. Overdue milestone
7. Budget/schedule critical variance
8. Current-phase mandatory task
9. Upcoming checkpoint
10. Normal planned task

Return:

- action
- reason
- urgency
- related entity
- recommended owner

---

# 25. EXCEPTION-FIRST ENGINE

Healthy items remain quiet.

Surface only:

- failed
- blocked
- overdue
- at risk
- unapproved
- missing evidence
- stale
- conflicting
- over budget
- capacity overload
- security finding
- traceability gap
- invalid lifecycle transition

Allow user to expand healthy details.

---

# 26. DEPENDENCY GRAPH IMPLEMENTATION

## 26.1 Node scale classes

Test at least:

- 20 nodes
- 100 nodes
- 500 nodes
- 2,000 nodes

V1 UI does not have to render every node simultaneously.

May use:

- clustering
- filtering
- progressive expansion
- virtualized lists

## 26.2 Cycle handling

Cycle categories:

- invalid strict dependency cycle
- informational relationship cycle

Not all graph cycles are invalid.

`depends_on` cycles are invalid.

`related_to` may cycle.

---

# 27. IMPACT PROPAGATION RULES

Create:

`docs/IMPACT_PROPAGATION_SPEC.md`

Every relationship type must define whether change propagates.

Example:

Requirement changed:
→ affected implementation tasks
→ affected tests
→ evidence may become stale
→ gate may require re-evaluation
→ documents may be stale

Architecture component changed:
→ implementation tasks
→ integration tests
→ deployment
→ security review
→ costs
→ timeline

Budget change:
→ project health
→ feasibility
→ scenarios
→ baseline variance

## 27.1 Staleness

Do not delete dependent evidence/results automatically.

Mark them:

- CURRENT
- STALE
- INVALIDATED
- REVALIDATION_REQUIRED

---

# 28. CHANGE REQUEST ATOMICITY

Before material change is applied:

1. capture current project version
2. calculate impact
3. show impact
4. receive required approval
5. check optimistic concurrency
6. apply all material changes transactionally
7. recalculate derived values
8. generate audit events
9. create new project version
10. enqueue non-transactional follow-up jobs

If transaction fails:
- no partial project mutation

---

# 29. BASELINE POLICY

Baselines are deliberate governance snapshots.

## 29.1 Baseline types

V1:

- APPROVED_PLAN
- RELEASE_BASELINE

Optional later:

- MONTHLY_CONTROL_BASELINE
- CONTRACT_BASELINE

## 29.2 Baseline creation

Requires:

- named version
- creator
- timestamp
- reason
- snapshot hash
- relevant approval if policy requires it

## 29.3 Never edit baseline

Create a new baseline.

---

# 30. DOCUMENT SYSTEM — V1 LIMIT

V1 document model:

- structured rich text
- versioned
- one saved canonical version at a time
- optimistic concurrency
- history/diff
- approval
- entity links

Do not build:
- Google Docs-scale real-time collaboration
- complex comments/mentions presence system
unless existing repository already provides it.

---

# 31. DOCUMENT AUTO-GENERATION RULES

Documents may be generated/updated from project state.

Important distinction:

- canonical structured project data
- human-readable generated document

Canonical data wins.

If user manually edits generated prose:
- preserve edits
- do not silently overwrite
- identify affected sections during regeneration
- offer merge/update

---

# 32. EVIDENCE MODEL

Evidence types:

- test report
- screenshot
- log extract
- deployment record
- scan report
- approval artifact
- document
- external report
- manual attestation if unavoidable

Each evidence record stores:

- immutable ID
- file/object hash
- MIME type
- size
- uploader
- timestamp
- project
- related entities
- optional source metadata
- retention class

---

# 33. APPROVAL SYSTEM

Approval is separate from normal task completion.

Approval object:

- subject type
- subject ID
- requested by
- requested at
- approver role
- approver user
- state
- decision
- reason/comment
- decided at
- subject version

If subject changes after approval:
- approval becomes stale/invalid as policy dictates

---

# 34. SECURITY MODEL — EXPANDED REQUIREMENTS

Create threat model before production.

Create:

`docs/THREAT_MODEL.md`

Cover:

- guest session abuse
- account takeover
- cross-tenant access
- insecure direct object reference
- privilege escalation
- malicious imported AI JSON
- malicious uploaded evidence
- stored XSS in documents
- injection
- SSRF through integrations
- webhook forgery
- queue poisoning
- replay
- data export abuse
- audit log tampering
- prompt data leakage
- sensitive log leakage
- denial of service
- dependency compromise

---

# 35. FILE UPLOAD SECURITY

Required:

- size limit
- MIME allowlist
- extension/MIME consistency check
- randomized storage key
- no direct public bucket
- malware scanning if practical for production upload types
- signed download URLs
- content-disposition safety
- no execution
- no user-controlled object path
- hash
- tenant ownership

---

# 36. RATE LIMITS & ABUSE

Rate-limit:

- auth endpoints
- guest project creation
- AI import validation
- file upload
- search
- export
- expensive graph/impact analysis
- login attempts
- invite actions

Use tiered limits.

Do not block normal legitimate usage with overly low limits.

---

# 37. PRIVACY & DATA CLASSIFICATION

Create:

`docs/DATA_CLASSIFICATION.md`

Classes:

- PUBLIC
- INTERNAL
- CONFIDENTIAL
- RESTRICTED

Examples:

RESTRICTED:
- secrets
- credentials
- private keys
- authentication tokens

CONFIDENTIAL:
- proprietary architecture
- source code snippets
- customer business requirements
- financial project data

External AI prompt policy uses classification.

---

# 38. RETENTION POLICY

Create:

`docs/DATA_RETENTION_POLICY.md`

Define retention for:

- guest projects
- active projects
- archived projects
- deleted projects
- evidence
- audit logs
- AI raw imports
- AI generated prompts
- exports
- background-job logs
- security logs
- backups

Deletion must consider backup expiry.

Do not promise immediate physical deletion from backups if not technically true.

---

# 39. EXPORT & PORTABILITY

V1 should support project export.

Recommended:

- canonical JSON
- human-readable project bundle/report

Export must include version metadata.

Sensitive evidence may require separate permissions.

---

# 40. AUDIT IMMUTABILITY

Audit records cannot be editable via normal CRUD.

Allow:
- append
- query
- retention policy

Do not allow:
- update event
- delete individual event through product UI

If legal deletion requires special handling, document the strategy.

---

# 41. SEARCH CONTRACT

V1 should not require a separate search service unless repository/scale proves it necessary.

Start with PostgreSQL search if adequate.

Search scope:

- projects
- tasks
- requirements
- risks
- documents
- decisions
- milestones

Every search result must enforce permission and tenant scope server-side.

---

# 42. COMMAND PALETTE

Commands may include:

- go to project
- open task
- create task
- create risk
- open budget
- open requirements
- open quality gates
- create change request
- search documents

Dangerous commands must require normal authorization and confirmations.

Command palette is not a security bypass.

---

# 43. NOTIFICATIONS

V1 notification types:

- assignment
- approval required
- gate failed
- blocker created
- milestone approaching
- change request
- project exception
- security release blocker

Avoid excessive low-value notifications.

Support read/unread.

Email/slack integrations later unless explicitly approved.

---

# 44. INTEGRATIONS — V1 BOUNDARY

Integrations screen can exist even when connectors are not implemented.

V1 integration states:

- AVAILABLE
- CONNECTED
- NOT_CONNECTED
- PLANNED

Do not fake functionality.

Recommended actual first integration only if implementation bandwidth allows:

- source control

Then:

- CI/CD
- calendar
- monitoring

---

# 45. SOURCE CONTROL INTEGRATION CONTRACT

If built:

Track:

- provider
- repo
- branch
- commit
- PR/MR
- deployment link
- task association

Webhook events must:

- verify signature
- deduplicate event
- tenant/project map safely
- store provider event ID
- tolerate retry/out-of-order delivery

---

# 46. BACKGROUND JOB FAILURE SEMANTICS

Every job has:

- queued
- running
- succeeded
- failed_retryable
- failed_terminal
- cancelled

Store:

- attempt count
- last error code
- correlation ID
- tenant
- project
- idempotency key

No raw secrets in failure payload.

---

# 47. TRANSACTIONAL OUTBOX

Material domain changes that need asynchronous side effects must write outbox entries inside the same DB transaction.

Examples:

- project version created
- gate changed
- approval granted
- change request applied
- deployment recorded

Worker processes outbox idempotently.

---

# 48. IDEMPOTENCY CONTRACT

Require idempotency for:

- signup conversion
- project generation
- AI import materialization
- evidence registration
- approval decision
- change application
- baseline creation
- deployment record
- webhook ingestion

Repeated request must not duplicate side effects.

---

# 49. OPTIMISTIC CONCURRENCY

Use version field / ETag on mutable critical entities.

If stale client writes:
- reject with conflict
- return current version
- do not silently last-write-wins critical project data

---

# 50. DATABASE MIGRATION POLICY

Create:

`docs/MIGRATION_POLICY.md`

Rules:

- additive first
- backfill separately for large data
- dual-read/write only where needed
- destructive migration after safe transition
- migration test on production-like snapshot/fixture
- migration reconciliation
- rollback or forward-fix strategy documented

---

# 51. BACKUP & RECOVERY TARGETS

Before production, define:

- RPO
- RTO

Do not invent claims.

Initial V1 proposed targets must be explicitly accepted during deployment design.

Test:

- database restore
- object storage recovery assumption
- secrets/config restoration
- application redeploy

---

# 52. READ-ONLY DEGRADED MODE

Plan for dependency failures.

If non-critical subsystem fails:

Examples:
- search unavailable
- queue unavailable
- integration unavailable

Core project read access should remain available where safe.

If DB is unavailable:
- fail safely
- do not show stale mutation success

---

# 53. OBSERVABILITY SLOs

Define initial internal service objectives.

Track:

- API availability
- API error rate
- p95 latency
- job success rate
- queue age
- DB saturation
- production critical journey synthetic result

Do not expose unsupported uptime promises publicly.

---

# 54. LOG REDACTION

Create automated tests proving sensitive values are not logged.

Patterns:

- passwords
- Authorization headers
- cookies
- API keys
- private keys
- tokens
- raw restricted project fields

---

# 55. ERROR TAXONOMY

Create stable application error codes.

Categories:

- VALIDATION
- AUTHENTICATION
- AUTHORIZATION
- CONFLICT
- NOT_FOUND
- RATE_LIMIT
- DEPENDENCY
- INTERNAL
- JOB_FAILED
- UNSUPPORTED
- SECURITY_POLICY
- TENANT_ISOLATION

UI should map codes to safe messages.

---

# 56. API PAGINATION & FILTERING

All potentially unbounded collections must paginate.

Examples:

- tasks
- audit logs
- evidence
- requirements
- risks
- projects
- notifications

Use stable cursor pagination where appropriate.

---

# 57. API VERSIONING

Use `/v1`.

Breaking API changes require new contract/version.

AI interchange schema version is independent.

---

# 58. OPENAPI QUALITY GATE

OpenAPI spec must validate.

Contract tests must ensure:

- implementation matches documented status codes
- required fields match
- auth requirements match
- examples validate
- error schema consistent

---

# 59. FRONTEND DATA OWNERSHIP

Avoid duplicated derived logic in frontend.

Backend/domain owns:

- lifecycle decisions
- gate decisions
- calculations
- impact analysis
- authorization
- feasibility
- project health

Frontend may:

- format
- filter
- sort
- visualize

Do not reimplement critical business rules in UI.

---

# 60. STORYBOOK REQUIRED FIXTURES

Storybook stories should include:

- normal
- empty
- loading
- error
- permission denied
- long content
- max-density
- mobile
- high-risk status
- accessibility examples

For graphs:
- small
- medium
- large/clustered

---

# 61. VISUAL REGRESSION

Use screenshot/visual regression where practical for:

- app shell
- landing
- intake
- Project Home
- Today
- Budget
- Quality Gates
- Impact Analysis
- Documents
- mobile critical screens

Do not rely only on pixel diff for functional correctness.

---

# 62. ACCESSIBILITY MANUAL EXCEPTION POLICY

The project default is zero manual testing.

However, some accessibility properties cannot be fully proven by automated tools.

Where manual accessibility review is technically necessary:

- document exact check
- document why automation is insufficient
- keep it as a release evidence item

Automate as much as technically possible.

---

# 63. PERFORMANCE FIXTURES

Test realistic and large fixtures.

At minimum:

### Small
- 1 user
- 30 tasks
- 20 requirements
- 10 tests

### Medium
- 12 people
- 500 tasks
- 150 requirements
- 300 tests
- 100 risks/doc links

### Large
- 100 people
- 5,000 tasks
- 1,000 requirements
- 3,000 tests
- 10,000 relationships

The V1 UI may paginate/cluster.

But it must not crash.

---

# 64. TEST COUNT QUALITY RULE

The minimum 600+ automated tests must not be satisfied using trivial copies.

A meaningful test must verify:

- a distinct rule
- a boundary
- an invariant
- an authorization condition
- a workflow
- a failure mode
- an accessibility contract
- a calculation

Mutation testing may be used on critical deterministic engines if practical.

---

# 65. SECURITY ATTACK TESTS BEFORE LIVE

Before production, automatically perform authorized security checks against staging/controlled targets.

Include safe automated tests for:

- object authorization bypass
- role escalation
- invalid session reuse
- CSRF where relevant
- injection payloads
- stored XSS
- unsafe file upload
- path traversal
- oversized payload
- rate-limit bypass
- webhook replay/forgery
- unsafe redirect
- SSRF-like integration input
- tenant data isolation
- mass assignment/property authorization
- error data leakage
- security headers

Never attack third-party systems outside authorized scope.

---

# 66. PRE-LIVE CHECKLIST

Mandatory automated pre-live gate:

## Application
- build green
- all required tests green
- no P0/P1 defects
- migrations green
- staging verified

## Security
- secret scan
- dependency scan
- SAST
- authorization attack suite
- security headers
- CSP
- secure cookies
- rate limits

## Data
- backup available
- restore tested
- retention configuration
- migration reconciliation

## Operations
- monitoring
- alerts
- logs
- correlation IDs
- rollback target
- deployment identity

## Product
- privacy/terms/support routes where required
- no fake integrations
- no broken navigation
- responsive critical flows

---

# 67. POST-LIVE VERIFICATION

Immediately after live deployment run:

- DNS
- TLS
- correct hostname
- HTTP status
- page identity
- security headers
- landing page
- signup/login
- critical authenticated journey
- API health
- DB read/write
- object storage
- job worker
- core guest flow
- production version/commit
- error monitoring

Production is not "done" until these pass.

---

# 68. REGULAR POST-LIVE CHECKS

Create scheduled operational checks.

Examples:

- dependency vulnerability scan
- uptime/synthetic critical journey
- backup status
- DB health
- queue failure rate
- error-rate regression
- certificate expiry
- domain expiry warning
- security header drift
- permissions regression tests during deployments
- restore drill schedule
- package update review

---

# 69. REGULATORY / COMPLIANCE CHECK ENGINE

The system should distinguish:

- platform's own compliance obligations
- project-specific compliance recommendations

Do not claim certification automatically.

V1 can provide:

- checklist
- evidence tracking
- requirements/gate mapping
- status

Possible project-specific packs later:

- GDPR/privacy
- PCI DSS
- SOC 2 readiness
- ISO 27001 controls mapping
- accessibility standards

Do not label the customer's project "compliant" unless the required evidence and scope genuinely support that claim.

---

# 70. PROJECT COMPLETION RULES

100% tasks completed does not equal project completion.

Completion requires:

- completion gate
- unresolved risks accepted
- technical debt recorded
- docs complete
- security disposition
- release/operations state
- evidence
- ownership/handover

---

# 71. PROJECT ARCHIVE RULES

Archived project:

- read-only by default
- searchable according to permissions
- audit retained
- may be restored by authorized role
- restore action audited

---

# 72. SCENARIO PLANNING CONTRACT

Scenario is a forked planning model, not a forked live project.

Scenario can alter:

- budget
- team size
- deadline
- execution profile
- major architecture assumption

Compare:

- duration
- cost
- feasibility
- risk
- resource demand
- milestones

Scenario changes must not mutate baseline/live plan until adopted.

---

# 73. FORECAST CONTRACT

V1 forecasts are deterministic.

Examples:

- completion-date forecast
- cost-at-completion
- resource overload forecast

Label:

`DETERMINISTIC FORECAST`

Future ML outputs must be labelled separately.

---

# 74. FUTURE ML DATA READINESS

Even though ML is deferred, capture data correctly now.

Possible future training features:

- estimated effort
- actual effort
- planned duration
- actual duration
- team composition
- task types
- blockers
- risk events
- estimate revisions
- budget variance

Do not collect data solely for ML without user/business need.

No customer data becomes training data automatically.

---

# 75. DEVELOPMENT STORY — REQUIRED ENTRY TEMPLATE

Every major implementation entry should include:

- date
- phase
- objective
- files changed
- decision
- reason
- alternatives considered
- tests run
- failures
- root cause
- fix
- verification
- remaining risk
- commit/version

---

# 76. KNOWN-ISSUE SEVERITY

Use:

- P0 BLOCKER
- P1 CRITICAL
- P2 MAJOR
- P3 MINOR
- P4 COSMETIC

Production cannot launch with unresolved P0/P1 unless formally waived with documented rationale by authorized owner—and security P0 should not be waivable.

---

# 77. DEFINITION OF IMPLEMENTATION READY

Implementation can move beyond foundation only when:

- repository audited
- designs mapped
- stack verified
- domain schema drafted
- permissions matrix drafted
- AI interchange schema drafted
- rule format drafted
- gate catalogue drafted
- calculation spec drafted
- security threat model initialized
- test architecture green
- CI green

---

# 78. DEFINITION OF RELEASE CANDIDATE

RC requires:

- all V1 critical flows implemented
- all required screens implemented/derived
- all rules/gates operational
- no P0/P1
- 600+ meaningful tests
- security suite pass
- tenant isolation pass
- migration pass
- accessibility acceptance
- performance acceptance
- staging deployment pass
- rollback drill pass
- backup/restore pass
- docs current

---

# 79. FINAL EVIDENCE PACK

At the end produce:

`docs/FINAL_VERIFICATION_REPORT.md`

Include:

- production URL
- release version
- commit
- deployment timestamp
- test count
- test categories
- pass/fail
- security scan summary
- accessibility summary
- performance summary
- migration result
- backup/restore result
- rollback drill result
- production verification
- known limitations
- final architecture reconciliation
- final screen coverage
- final V1 scope
- deferred items

---

# 80. REQUIRED IMPLEMENTATION ARTEFACTS

By project completion, repository should contain at least:

## Architecture
- architecture
- domain model
- Digital Twin schema
- permissions
- rules
- gates
- calculations
- impact propagation
- AI interchange
- privacy/security
- threat model

## Delivery
- implementation plan
- development story
- screen map
- design handoff
- test strategy
- test evidence
- deployment
- rollback
- operations
- final verification

## Machine-readable contracts
- OpenAPI
- JSON Schema
- rule schemas
- configuration schema
- database migrations

---

# 81. CLAUDE CODE EXECUTION PRIORITY

If implementation pressure exists, use this order:

1. correctness
2. tenant/security boundary
3. data integrity
4. deterministic project engine
5. testability
6. core user flow
7. design fidelity
8. performance
9. integrations
10. future ML

Do not sacrifice 1–6 to build more integrations or flashy analytics.

---

# 82. WHAT MUST NOT BE ASSUMED

Claude Code must not assume:

- all Stitch screens are implemented
- all exported code is production quality
- all designs are responsive
- database already exists
- authentication is already chosen
- a separate search engine is required
- Redis is required if queue design changes
- Kafka is required
- GraphQL is required
- ML is required
- all integrations are implemented
- all project types can be fully planned
- compliance status can be automated completely
- AI output is trustworthy
- successful deployment equals healthy production
- build success equals correctness
- unit tests alone are enough

---

# 83. WHAT MUST REMAIN DETERMINISTIC

The following should not depend on LLM output at runtime:

- lifecycle state transitions
- authorization
- tenant isolation
- gate evaluation mechanics
- schema validation
- dependency integrity
- baseline immutability
- core calculations
- budget totals
- resource capacity arithmetic
- audit logging
- change transaction application
- project versioning
- release-blocking policy
- provenance classification mechanics

---

# 84. SAFE USE OF AI DURING IMPLEMENTATION

Claude Code may use AI reasoning to:

- implement
- refactor
- diagnose
- generate candidate tests
- inspect code
- propose rules

But it must verify outputs with deterministic tests.

Do not accept generated logic solely because an AI produced it.

---

# 85. V1 PRODUCT SUCCESS CRITERIA

V1 is successful if a user can:

1. arrive without an account;
2. describe an idea;
3. answer what they know;
4. mark unknowns;
5. generate a structured external-AI request;
6. import the AI result;
7. see validation errors/conflicts;
8. generate a deterministic project;
9. understand feasibility;
10. see roadmap/tasks/dependencies;
11. see budget/resources/risks;
12. see requirements/architecture/traceability;
13. see quality gates/testing/security;
14. manage changes with impact analysis;
15. maintain living documents/evidence;
16. save with signup;
17. continue execution;
18. verify release readiness;
19. verify production;
20. complete/handover the project.

That journey matters more than implementing every possible enterprise integration.

---

# 86. FIRST CLAUDE CODE OUTPUT REQUIRED AFTER READING BOTH PLANS

Before writing broad code, Claude Code must produce a concise implementation kickoff report containing:

1. repository findings
2. design export findings
3. actual stack
4. conflicts with plan
5. missing files/screens
6. architecture adjustments
7. database strategy
8. auth strategy
9. test strategy
10. security risks
11. exact Phase-0 execution sequence
12. blockers
13. whether implementation can safely proceed

Then proceed automatically if the gate passes.

Do not wait for manual testing.

Do not wait for routine approval unless a genuine unresolved product decision makes implementation unsafe.

---

# 87. FINAL GAP-CLOSURE RULE

If the coding agent discovers any new ambiguity not covered here:

1. do not guess silently;
2. classify the ambiguity;
3. inspect repository/docs/designs;
4. infer only when evidence is strong;
5. record the assumption explicitly;
6. use the safest reversible implementation;
7. create automated tests for the assumption;
8. update this specification or an ADR;
9. continue if the decision is reversible and low risk;
10. stop only when the decision is irreversible, security-critical, legal/compliance-sensitive, destructive, or materially changes product scope.

---

# 88. IMPLEMENTATION DO-NOT-LOSE CHECKLIST

The following features are easy to accidentally simplify away and must remain present in architecture even if phased:

- guest-first flow
- save-on-signup
- "I don't know" intake
- external AI one-shot workflow
- machine-readable interchange
- validation before materialization
- provenance
- deterministic rules
- reason/explanation for recommendations
- Digital Twin
- lifecycle state machine
- quality gates
- project decomposition
- solo/AI-assisted/team scaling
- budget allocation
- resource/capacity planning
- dependency graph
- impact propagation
- requirements traceability
- change requests
- baselines
- versioning
- living documents
- evidence
- approvals
- risks/blockers
- testing
- security
- pre-live checks
- post-live checks
- operational readiness
- regulatory/compliance checklists
- project handover
- retrospective
- lessons learned
- future ML readiness
- exception-first UX
- Today/Focus
- Next Action
- progressive disclosure
- Beginner/Professional/Enterprise complexity scaling
- zero manual testing by default
- 600+ meaningful automated tests
- autonomous fix/retest/regression
- revert unverifiable fixes
- continuous development story
- automated staging and production verification
- rollback drill
- backup/restore verification

---

# 89. RELATIONSHIP TO FUTURE GOAL PROMPT

The future Claude Code goal prompt must summarize and enforce the two implementation documents without trying to duplicate them.

The goal prompt should instruct the coding agent to:

- read both plans first
- treat them as authoritative
- begin with repository/design verification
- implement autonomously
- use zero manual testing by default
- continuously test/fix/retest
- maintain the development story
- preserve design fidelity
- keep the deterministic engine central
- enforce security/privacy/tenant isolation
- deploy only through verified gates
- verify production
- rollback on failed verification
- never declare completion without evidence

The detailed rules remain in the repository documents.

The goal prompt should stay concise enough to function as a persistent operating instruction.

---

# 90. STATUS AFTER THIS DOCUMENT

After this document is placed in the repository together with the Master Implementation Plan:

**Planning status: READY FOR GOAL PROMPT.**

**Implementation status: CONDITIONAL READY.**

Implementation becomes fully ready when Claude Code completes the repository/design Phase-0 verification and confirms the actual codebase can support the locked plan without unresolved critical conflicts.
