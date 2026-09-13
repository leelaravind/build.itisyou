# FINAL PRODUCT COMPLETION IMPLEMENTATION PLAN

Supplied by the owner on 2026-09-13 as the final execution contract. It sits above
`MASTER_IMPLEMENTATION_PLAN.md` and `IMPLEMENTATION_GAP_CLOSURE_SPEC.md` for *how* the work is finished
and verified; those two remain the source of *what* V1 is.

## 0. Purpose

This document is the final autonomous completion contract for build.itisyou.

The objective is not to continue from assumptions, old session notes, or stale implementation claims.
The objective is to inspect the actual repository, establish the current truth, finish every remaining
coding and UI task required for a complete V1 product, verify it with meaningful automated testing,
deploy through the available Cloudflare infrastructure, and leave only genuinely external/account-only
integrations as explicit final connection points.

Claude Code must act as lead architect, senior full-stack engineer, frontend/UI engineer,
backend/domain engineer, database engineer, QA automation engineer, security engineer, accessibility
engineer, performance engineer, DevOps/release engineer, and technical writer.

The actual repository and running system are the source of truth.

## 1. Non-negotiable execution contract

### 1.1 First principle

Do not assume the project is complete because a prior document says a phase is complete, a previous
session reported success, tests pass, a route exists, a component renders, infrastructure exists, a
database table exists, a feature has a schema, or a README says something is implemented.

Prove the current state from code, runtime behavior, tests, database state, API behavior, rendered UI,
CI, staging, deployment configuration, and observable evidence.

### 1.2 Autonomous operating loop

For every material work item: inspect; understand existing behavior; identify intended behavior; design
the smallest correct change; implement; run focused automated tests; capture failure evidence; diagnose
root cause; fix; re-run affected tests; run relevant regression; verify behavior in a realistic
environment; update documentation; save test evidence; commit only verified work.

Never declare success based only on code changes.

### 1.3 Failure rule

If a test fails, do not weaken the test merely to make it green. Determine whether the test or product
is wrong, preserve the original failure output, fix the root cause, rerun the exact failing test, rerun
adjacent regression, and record the fix and proof.

If a proposed fix cannot be verified, revert it, restore the last known-good state, record the
unresolved issue, and continue with other safe work.

### 1.4 Questions and stopping

Do not stop for routine engineering choices, reversible architecture decisions, naming, refactoring
choices, test design, implementation details, UI polishing, local environment fixes, build-system
issues, ordinary Cloudflare configuration already accessible, ordinary GitHub actions already
accessible, or progress updates.

Stop only for a truly external, irreversible, or owner-only dependency such as an unavailable
secret/credential, creation of an external account not accessible through existing tools, a
legal/business fact that must come from the owner, an irreversible destructive production action not
already approved, or a material product scope decision with multiple incompatible interpretations.

Even then, finish every unblocked task first, leave the integration point complete, write the exact
missing value/action, and keep the rest of the product moving.

## 2. Authoritative inputs

Read these before implementation if present: MASTER_IMPLEMENTATION_PLAN.md,
IMPLEMENTATION_GAP_CLOSURE_SPEC.md, docs/DEVELOPMENT_STORY.md, docs/HANDOFF.md, docs/ARCHITECTURE.md,
docs/PROJECT_DIGITAL_TWIN.md, docs/RULES_ENGINE.md, docs/RULE_CATALOGUE.md, docs/QUALITY_GATES.md,
docs/CALCULATION_SPEC.md, docs/AI_INTERCHANGE.md, docs/API.md, docs/SECURITY.md, docs/PRIVACY.md,
docs/PERMISSIONS_MATRIX.md, docs/TEST_STRATEGY.md, docs/TEST_EVIDENCE.md, docs/DEPLOYMENT_RUNBOOK.md,
docs/ROLLBACK.md, docs/OBSERVABILITY.md, docs/DATA_RETENTION.md, docs/KNOWN_ISSUES.md,
docs/CHANGELOG_IMPLEMENTATION.md, docs/CLOUDFLARE_DEPLOYMENT_ARCHITECTURE.md, migration/recovery
policies, Wrangler/OpenNext configuration, GitHub Actions workflows, exported Stitch designs and design
assets.

Documents are guidance, not proof. If documentation conflicts with the real repository, document the
discrepancy and reconcile it.

## 3. Phase A — Repository truth audit

Before broad implementation, crawl the entire repository.

### 3.1 Repository inventory

Produce a machine-readable inventory covering packages, applications, routes, API routes, server
actions, domain modules, database modules, migrations, queues/jobs, Cloudflare Worker code, tests, test
fixtures, configuration, scripts, deployment files, CI workflows, design assets, docs, generated
artifacts, unused/dead directories, external integrations, feature flags, TODO/FIXME/HACK markers,
placeholder implementations, mock-only features, unreferenced schemas, unused database tables, unused
bindings, uncalled domain functions, orphaned routes/screens, duplicated logic, and commented-out
implementation.

Save `docs/final-completion/REPOSITORY_AUDIT.md` and `artifacts/final-completion/repository-inventory.json`.

### 3.2 Build baseline

Run and record dependency install, lint, formatting check, typecheck, build, unit tests, integration
tests, domain tests, database tests, secret scan, dependency vulnerability scan, migration checks,
documentation drift checks, UI/component tests, E2E smoke, and current CI status. Capture exact
command, exit code, runtime, commit SHA, and result.

### 3.3 Current product map

Build a route/screen/flow map with status: complete, partially implemented, mocked, disconnected,
broken, inaccessible, untested, deprecated, or not implemented. Save as
`docs/final-completion/PRODUCT_STATUS_MATRIX.md`. Each row must include feature/screen/flow, entry
route, backend dependency, database dependency, auth requirement, current status, missing behavior,
test coverage, severity, workstream, and completion proof.

### 3.4 Old-claim reconciliation

For every major claim in handoff or development-story docs, verify whether it is still true, mark
stale claims, and correct docs. Do not inherit status blindly.

## 4. Phase B — Product completeness register

Create one authoritative completion register: `docs/final-completion/COMPLETION_REGISTER.md`. Every
missing or partial feature becomes a work item, classified P0 release blocker, P1 serious
product/security blocker, P2 important completeness issue, or P3 polish/non-blocking. Group by
dependency, not arbitrary screen order.

Recommended workstreams: lifecycle and gates; project intake; guest-first flow; authentication and
identity; project ownership/claiming; external-AI interchange; project digital twin; rules and decision
engine; project decomposition; requirements and traceability; verification/test/evidence chain;
quality gates; resource/capacity; budget/estimation; dependency graph; impact analysis; change
requests; approvals/sign-offs; baseline/versioning; documents; evidence/object storage; audit writes;
risk/blocker management; deployment/release; production verification; operations; project
health/forecast; scenario planning; next-action/exception engine; notifications;
organization/members/roles; settings/preferences; responsive/mobile; accessibility; security
hardening; performance; observability; data portability/export; completion/handover; final release
readiness.

The register is not a backlog for the user to manage manually. Claude Code owns execution order.

## 5. Phase C — Finish core product behavior

The product is complete only when workflows work across UI, backend, database, rules, and evidence.

- **5.1 Project intake** — guest start without signup, supported project classes, required/optional
  fields, "I don't know", constraints/resources/budget/deadline, information status, save/resume,
  validation, error recovery, mobile behavior, keyboard accessibility, persistence, guest tenant
  isolation.
- **5.2 Discovery and missing-information engine** — critical unknowns identified, assumptions
  explicit, research needs separated from user facts, prompt generation deterministic from state, no
  hidden chain-of-thought requested/stored, critical missing information blocks unsafe finalization.
- **5.3 External AI interchange** — full loop: intake → prompt package → copy/export → external model →
  paste/upload structured response → schema parse → semantic validation → conflict detection → preview
  → accept/reject → project model materialization → questions/requirements/state updated. No accepted
  response may merely change a status flag. Required: versioned JSON Schema, provenance, validation
  errors, partial/invalid handling, duplicate import safety, idempotency, import evidence, user review
  before material changes.
- **5.4 Project Digital Twin** — canonical model, typed nodes/edges, ownership, versions, provenance,
  dependency traversal, impact traversal, no competing canonical truth in documents, scalable query
  behavior, graph integrity tests.
- **5.5 Lifecycle and quality gates** — every transition executable through supported product
  behavior; preconditions, blockers, approvals, exceptions, deterministic reasons, invalid transition
  rejection, gate criteria fed by actual rules, gate result persistence, re-evaluation when inputs
  change, stale gate invalidation, UI explanation. Rules must actually be able to block or warn.
- **5.6 Rules engine** — all rules loaded, executable, context-aware, precedence-correct, project-type
  aware, methodology aware, explainable, tested, linked to gates where intended, not silently
  discarded. No filler rules.
- **5.7 Traceability chain** — Requirement → Work → Verification Method → Test/Check → Execution Result
  → Evidence. Do not mark tests executed if they have not run. Do not require "test" verification for
  artifacts whose valid method is inspection/review/documentation. Distinguish specified vs executed
  vs passed. Store evidence only after execution. Flag ambiguity rather than guessing. Close all
  required hops for release-blocking requirements.
- **5.8 Change requests** — create, review, decide, reject, apply, version bump, impact preview,
  approval requirements, solo-safe behavior, tenant isolation, audit trail, baseline interaction.
- **5.9 Documents** — living projections of canonical state where possible: generation, regeneration,
  controlled edits, version history, staleness, references, export, no silent divergence from the twin.
- **5.10 Evidence** — decide whether object/file evidence is V1. If required, R2 end-to-end with safe
  upload validation, limits, private-by-default access, metadata, tenant isolation, deletion/retention,
  tests. If not, remove/defer misleading unused infrastructure and document the boundary.
- **5.11 Outbox/queues** — decide whether domain events are V1. If required: real producers inside
  domain transactions, outbox persistence, Cron drain, Queues, idempotent consumption, retries,
  dead-letter, observability, tests. If not, remove partial dead infrastructure or explicitly defer it.
  Do not leave a table, drainer, consumer, and queue with zero producers and call it complete.

## 6. Phase D — Authentication and identity

Do not block the rest of coding if external OIDC secrets are absent. Complete provider-neutral OIDC,
authorization code flow, PKCE, nonce/state, issuer validation, discovery, token validation, identity
key (issuer, subject), client secret handling, session issuance, session revocation, guest → signed-in
claiming, membership lookup per request, immediate revocation, login/logout UI, error states, expired
state, account conflicts, callback validation, tenant resolution after login, ownership authorization,
BOLA/IDOR protection, and redirect safety. If real provider values exist, test against the real
provider on staging. If not, leave exact config keys ready and continue.

## 7. Phase E — UI/UX completion

Use the existing Stitch/exported design system as the primary visual source. Do not redesign randomly.
Inspect every route at desktop, tablet, and mobile: layout, components, spacing, typography, icons,
hierarchy, empty/loading/warning/error/blocked/success/permission/disabled states, responsive
behavior, keyboard behavior, focus, touch targets, overflow, long content, data density,
accessibility. If a backend feature exists without usable UI, build the UI following existing patterns
and add tests. If UI exists but is disconnected, wire real data/actions, remove fake values, add
loading/error behavior. Preserve Beginner / Professional / Enterprise progressive disclosure using one
engine. Project Home must answer: where are we, what is next, what is blocked, what changed, what needs
attention. Preserve exception-first behavior. At minimum verify mobile Project Home, Today/Focus, Task
Detail, Approval, Project Health, and Notifications, and ensure other pages degrade safely on mobile.

## 8. Phase F — Accessibility

Target WCAG 2.2 AA: semantic landmarks, headings, labels, forms, error associations, keyboard
navigation, focus order, visible focus, dialogs, drawers, menus, command palette, contrast, non-color
status, touch targets, reduced motion, screen-reader names, icons, tables, graphs with textual
alternatives, responsive zoom, automated accessibility tooling. Manual-only checks must be explicitly
documented, not silently claimed.

## 9. Phase G — Security completion

Hard blockers: no app superuser, no BYPASSRLS role, no owner role for production app, forced RLS where
required, guest and signed-in tenancy both covered, pooled connection safety, transaction-local tenant
context, no unsafe cross-request DB socket reuse, BOLA/IDOR protection, permission+ownership binding,
CSRF/state protections, OIDC state/nonce, safe redirects, secret scanning, dependency scanning, no
secrets in OpenNext artifacts, no secrets in repo/history/logs/screenshots, CSP, HSTS, secure cookies,
upload controls, rate limiting, log redaction, audit trails, SSRF defenses where applicable,
XSS/HTML sanitization, SQL injection protections, mass-assignment defenses, replay/idempotency
protections, safe errors, tenant-aware caching rules, and Hyperdrive query caching disabled where RLS
state is not part of the cache key. Create targeted attack/regression tests.

## 10. Phase H — Database and migrations

Non-destructive additive migration path, exact known source fingerprints, explicit target fingerprint,
rollback known before apply, unknown shapes refused, schema verification after migration,
constraints/RLS/policies/roles verified, data counts sampled before/after, migration idempotency where
intended, backups/recovery, restore privilege verification. Do not solve migrations by dropping
populated environments. Document hard-cutover behavior if exact fingerprint matching prevents
mixed-version rollout.

## 11. Phase I — Performance and reliability

Measure real behavior for landing, intake, project home, budget, graph, requirements, traceability,
plan generation, change request, import, authentication, key API routes, database-intensive flows,
concurrent health requests, concurrent tenant requests, browser parallelism, and queue processing if
used. Distinguish product latency from browser test-runner contention, local machine contention, and
infrastructure latency.

## 12. Phase J — Automated test program

Not a vanity number. Minimum final target: 800 meaningful automated test cases, unless the existing
suite already substantially exceeds this and quality is demonstrably stronger. Existing valid tests
count. No filler tests. Guidance: domain/invariants 80+; rules engine 120+; lifecycle/gates 60+; AI
interchange 60+; Digital Twin/traceability 70+; budget/estimation/resources 60+;
dependency/impact/change requests 60+; auth/identity/RBAC/tenant isolation 80+; API/contracts/server
actions 70+; database/migrations/recovery 50+; frontend components/states 80+; browser E2E critical
journeys 80+; accessibility 30+; security regression/attack tests 40+; deployment/health/rollback/jobs
30+. At release gate cover Chromium, Firefox, WebKit, Edge/Chrome equivalent as CI supports, and mobile
viewport coverage. Where flakiness appears, reproduce, isolate, determine product vs harness vs machine
contention, fix root cause, and do not silently retry away real failures.

## 13. Test evidence folder

`artifacts/test-evidence/` with subfolders such as unit/, integration/, database/, security/,
accessibility/, e2e/, performance/, deployment/, rollback/, screenshots/, traces/, logs/, junit/,
json/, html/, pdf/. For each major run store timestamp, commit, environment, command, duration, total,
passed, failed, skipped, flaky, retry count, exit code, and artifacts. For every meaningful failure
discovered during final completion, save original failure, environment, exact test,
screenshot/trace/log if relevant, diagnosis, root cause, code change, rerun proof, and regression
proof. Summary in `artifacts/test-evidence/FAILURE_RECEIPTS.md`.

## 14. Final test report PDF

Generate `artifacts/test-evidence/FINAL_TEST_REPORT.md`, `artifacts/test-evidence/FINAL_TEST_REPORT.json`,
`artifacts/test-evidence/pdf/FINAL_TEST_REPORT.pdf`. The PDF must be generated from real test output
and contain product, version/commit, date/time, environments tested, tooling, totals,
pass/fail/skipped/flaky counts, category breakdown, browser matrix, database environments, security
findings, accessibility findings, performance evidence, migration evidence, tenant-isolation evidence,
auth evidence, deployment evidence, rollback evidence, failures found, root causes, fixes, regression
proof, remaining known issues, external integrations intentionally left unconnected, and final
readiness verdict. Clearly distinguish PASSED / FAILED / NOT_CHECKED / BLOCKED / DEFERRED. Never
convert NOT_CHECKED into PASSED.

## 15. Phase K — Local-first completion

Run the full product locally as far as possible before broad staging work.

- Guest journey: open site → start project → intake → unknown values → discovery → generate AI prompt
  → import result → validate → accept → project preview → save/continue → project home → plan →
  lifecycle/gates → work breakdown → traceability → risks → budget → change request → completion path.
- Signed-in journey when provider or mock issuer is available: sign in → guest project remains
  accessible → ownership claim → tenant context → project creation → project listing → logout →
  revoked access → no cross-tenant visibility.
- Organization journey where V1 supports it.
- Failure journeys: invalid AI response, missing required information, blocked gate, unauthorized
  project, expired session, DB error/degraded mode, failed upload, migration mismatch, unavailable
  external integration.

Local completion is not enough for behaviors that depend on real Cloudflare/Postgres/OIDC semantics.

## 16. Phase L — Staging

Once local gates are green, deploy staging using the existing Cloudflare/Neon architecture. Verify
correct build/version, TLS, CSP/HSTS, Hyperdrive, restricted DB role, tenant isolation, database
fingerprint, routes, server actions, auth where configured, guest flow, AI interchange, lifecycle,
change requests, uploads if used, queues if used, browser E2E, accessibility, performance smoke, and
rollback readiness. Run the release browser suite against staging.

## 17. Phase M — Production preparation

If a required secret/account value is missing, prepare all code and configuration, leave no dummy
secret, leave a documented placeholder, and continue other work. Before production require: no
unresolved P0; no unresolved P1 security issue; all release gates evaluated; backup/recovery path;
rollback known; production DB role restricted; migrations validated; secret scan clean; dependency
scan acceptable; CI green; staging green; final test report generated; known issues reviewed; domain
ready.

## 18. Phase N — Production deployment

Use build.itisyou.app. Production deployment is approved once readiness gates are genuinely green.
After deploy automatically verify hostname, TLS, application identity, commit/version, health
endpoint, database connectivity, database fingerprint, restricted DB role, RLS/tenant isolation,
critical guest flow, critical signed-in flow if real OIDC connected, critical project flow, main
pages, CSP/HSTS/security headers, object storage if used, queues/jobs if used, performance smoke,
observability, and browser smoke. If verification fails: capture evidence, rollback, verify recovery,
fix root cause, redeploy, and reverify.

## 19. External integrations policy

If something external cannot be connected (Auth0 secret, owner-only API token, real legal/business
information, email provider account, third-party webhook), do not stop the whole project. Finish
adapter/integration code, config schema, UI states, mock/local automated tests, and failure behavior.
Document exact environment variables, callback URLs/scopes, mark runtime verification
BLOCKED_EXTERNAL, and continue. At the end create `docs/final-completion/OWNER_ACTIONS.md` containing
only actions Claude Code genuinely cannot perform. Each item states exact action, provider/location,
exact value needed, whether secret, where to store it, and how to verify after addition.

## 20. Cloud access policy

Use existing Cloudflare access autonomously where available for Worker configuration, Hyperdrive, R2,
Queues, Cron, routes/custom domains, secrets already safely available, staging deployment, production
deployment after readiness gates, health verification, and rollback. Do not expose secrets in
repository, committed Wrangler files, build artifacts, logs, screenshots, documentation, or chat
output. Do not create unnecessary infrastructure merely because Cloudflare offers it.

## 21. GitHub/CI policy

If a GitHub remote exists, verify actual remote, workflows execute, fix CI-specific failures, ensure
final commit is pushed, ensure release gates run in CI, and do not claim CI verified from local
rehearsal. If CI jobs are cancelled by newer pushes, confirm the final/latest commit receives a real
verdict. Generate CI evidence in the test-evidence package.

## 22. Documentation during execution

Continuously maintain docs/DEVELOPMENT_STORY.md with what was attempted, observed, failed, why, what
changed, test evidence, security implications, deployment implications, and lessons learned. Also
maintain security, known issues, architecture, deployment runbook, migration policy,
rollback/recovery, test strategy/evidence, API, permissions matrix, data model, rules/gates, AI
interchange, retention/privacy, and implementation changelog. Documentation must match the code at
the end.

## 23. Release quality bar

The product is not done because source compiles, CI is green, test count is high, staging deploys,
every screen has HTML, or all database tables exist. It is complete only when real user journeys work,
workflows change real state correctly, lifecycle/gates are meaningful, security boundaries hold,
traceability is honest, UI is usable, responsive behavior is acceptable, accessibility gates are met,
failures are recoverable, deployment can be verified, tests prove important claims, and unresolved
external items are explicit and isolated.

## 24. Final definition of done

- **Product** — all V1-required flows implemented; no release-blocking placeholder behavior; no
  mock-only production path; lifecycle works; project state advances; AI import affects real model;
  traceability closes honestly; change requests work; documents/evidence work as scoped; project
  home/next action/health useful; guest and signed-in behavior correct.
- **UI** — desktop complete; tablet acceptable; mobile critical flows complete; no missing icons; no
  broken visual states; no raw debug UI; no obvious placeholder copy; loading/error/empty/blocked
  states implemented.
- **Backend/domain** — invariants enforced; rules connected; gates connected; audit writes;
  migrations; idempotency; concurrency behavior; errors explicit.
- **Security** — restricted app DB role; RLS; tenant isolation; authz; secret hygiene; dependency
  scan; CSP/HSTS; upload safety; no known P0/P1 security issue.
- **QA** — hundreds of meaningful tests; final release suite green; real browser coverage; evidence
  folder populated; failure receipts complete; final PDF generated.
- **Deployment** — staging green; rollback path proven; production deployed if all gates and required
  external values are available; production verified; otherwise production correctly blocked with a
  minimal owner checklist.
- **Documentation** — current; no false claims; no PASSED where not checked; final status report
  present.

## 25. Required final artifacts

docs/final-completion/REPOSITORY_AUDIT.md, docs/final-completion/PRODUCT_STATUS_MATRIX.md,
docs/final-completion/COMPLETION_REGISTER.md, docs/final-completion/FINAL_PRODUCT_STATUS.md,
docs/final-completion/OWNER_ACTIONS.md, artifacts/final-completion/repository-inventory.json,
artifacts/test-evidence/FAILURE_RECEIPTS.md, artifacts/test-evidence/FINAL_TEST_REPORT.md,
artifacts/test-evidence/FINAL_TEST_REPORT.json, artifacts/test-evidence/pdf/FINAL_TEST_REPORT.pdf.
Where existing repository conventions require another path, use the existing convention but preserve
equivalent artifacts.

## 26. Final status report

At the end provide one concise final status with final commit SHA, product completeness verdict,
staging URL, production URL if deployed, total meaningful automated tests, pass/fail/flaky/skipped
counts, browser matrix, security verdict, accessibility verdict, migration/recovery verdict,
production verdict, external integrations still blocked, path to final PDF, and owner actions if any.
Do not bury blockers in prose.

## 27. Execution order

Repository truth audit → baseline build/test/security scan → product status matrix → completion
register → P0 security/data-integrity blockers → lifecycle/gate correctness → auth/guest ownership
correctness → AI interchange completion → traceability/test/evidence completion → change
requests/baselines/audit → evidence/outbox/queue decision and implementation → remaining core product
flows → UI completeness → responsive/mobile → accessibility → performance/reliability → full local
test gate → staging deploy → staging full browser/security gate → final evidence package + PDF →
production readiness → production deployment if possible → production verification → final
docs/status.

## 28. First action

Do not start by coding. Crawl the full repository, inspect current docs and handoff, all
routes/screens/components, DB schema/migrations/RLS, CI and Cloudflare config, all tests/current
results, then build REPOSITORY_AUDIT.md, PRODUCT_STATUS_MATRIX.md, and COMPLETION_REGISTER.md, run the
current baseline, identify the dependency-critical P0/P1 path, and continue implementation
autonomously. Once the audit is complete, do not wait for approval to proceed unless a genuine
owner-only dependency is reached.

## 29. Final principle

Optimize for a finished, correct, secure, observable, maintainable product with evidence. Do not
optimize for looking complete, hitting a test-count vanity target, satisfying stale documentation,
producing green CI by weakening assertions, or rushing production.

The goal is that a real user can use build.itisyou end to end and the system can prove that its
important claims are true.
