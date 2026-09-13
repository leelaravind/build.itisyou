# Completion register

The one authoritative list of what stands between the repository and a complete V1 (contract §4).
It supersedes `docs/V1_GAP_REGISTER.md` for execution order; that file stays as the record of what
was found on 2026-09-01.

Severity: **P0** release blocker · **P1** serious product/security blocker · **P2** important
completeness issue · **P3** polish. Status: **DONE** (verified, with proof) · **OPEN** · **BLOCKED_EXTERNAL**
(code complete, needs an owner-held value) · **DEFERRED** (deliberately out of V1, with the reason).

Order is dependency and risk, not screen order. "Proof" points at a test, a receipt in
`artifacts/test-evidence/FAILURE_RECEIPTS.md`, or a gate record under `artifacts/test-evidence/json/gates/`.

## Closed in this pass

| ID | Sev | Workstream | Item | Status | Proof |
|---|---|---|---|---|---|
| W-OPS-1 | P0 | Operations | Cron schedule exhausted the database quota; budget now enforced by a test | DONE | FR-001, `apps/worker/test/schedule.test.ts` |
| W-OPS-2 | P0 | Deployment | Staging re-provisioned (new Neon project, Hyperdrive repointed) and redeployed | DONE | FR-004, `staging-*` gate records |
| W-OPS-3 | P1 | Outbox | Dead-letter pass unreachable; final attempts dead-lettered before consumption | DONE | FR-002, `apps/worker/test/drain.test.ts` |
| W-SEC-1 | P1 | Security | High `sharp` advisory in the toolchain | DONE | FR-003 |
| W-RET-1 | P0 | Retention | Guest purge failed under RLS on the first audited guest | DONE | FR-005 |
| W-ID-1 | P0 | Identity | First sign-in failed under RLS; conversion claimed nothing | DONE | FR-006, `packages/db/test/sign-in.test.ts` |
| W-SEC-2 | P1 | Tenant isolation | Sessionless caller saw every guest's rows in development | DONE | FR-008 |
| W-LC-1 | P0 | Lifecycle / gates | Approvals hard-coded `[]`; evidence invisible to ten surfaces and the transition | DONE | FR-009, `approval-record.test.ts` |
| W-UI-1 | P1 | Project home | Fabricated `/p/[id]` replaced by a real Project Home | DONE | `e2e/project-home.spec.ts` |
| W-UI-2 | P2 | UI states | Error and not-found boundaries in the design system | DONE | `app/error.tsx`, `app/not-found.tsx` |
| W-ORG-1 | P2 | Organisation | Portfolio lists the caller's projects; signed-in landing no longer empty | DONE | `e2e/portfolio.spec.ts` |
| W-SEC-3 | P1 | Tenant isolation | `intake_answers` and `ai_imports` get a real tenant key and forced RLS (migration 003); writers set the key | DONE in code; staging cutover recorded in `staging-migrate-003` | `database-isolation.test.ts` (4 new), `migrations.test.ts` (8 new) |
| W-OPS-4 | P1 | Operations | Production cron Worker configured (Hyperdrive, budgeted schedule); drain skipped where no queue is bound | DONE (config; production not deployed) | `worker-production-dry-run` gate, `schedule.test.ts` costs production |
| W-COMP-1 | P1 | Completion | Closure counts unrun tests and quarantined evidence; security findings and stale documents are UNKNOWN, not zero | DONE | `completion.test.ts` (2 new) |
| W-UI-4 | P2 | UI | Lifecycle refusals and change-request outcomes are shown, mapped to safe sentences; unknown codes are never echoed | DONE | `e2e/change.spec.ts` (2 new) |
| W-REL-1 | P1 | Release / production verification | The release page reads plans, production checks and deployment approvals from recorded evidence instead of empty lists; checks with no evidence stay NOT_CHECKED; a plan is rehearsed only from a test report or deployment record | DONE (mapping unit-tested; an end-to-end proof needs a project driven through the five earlier gates, not built) | `packages/release/test/records.test.ts` (10) |
| W-BASE-1 | P2 | Baseline | Baselines are recorded: stored with checksum and reason in `twin_baselines`, audited in the same transaction, re-verified from storage, numbered, and compared with today's plan | DONE | `e2e/baseline.spec.ts` (3 new) |
| W-A11Y-1 | P2 | Accessibility | Keyboard-only journey: start, intake, plan and Project Home without a pointer | DONE (spec); see the E2E record for the run | `e2e/keyboard.spec.ts` |
| W-REL-2 | P2 | Release | The three §15.9 checks with no criterion (authentication, APIs, deployment identity) are now blocking MANUAL criteria of the Production Verification gate, so all ten production checks can be recorded through the product | DONE | `records.test.ts`, `docs/GATE_CATALOGUE.md` regenerated |
| W-SEC-4 | P1 | Security | SAST did not exist in any form (plan §18, gap-spec §66). Semgrep's public TypeScript/JavaScript/Node rulesets now run locally and in CI's security job, failing on any finding; first run 74 rules on 187 files, 0 findings | DONE | `json/gates/security-sast-semgrep.json`, `security/semgrep.json` |
| W-TEST-1 | P1 | Test coverage | WebKit and iOS Safari skipped every journey even over HTTPS; the skip is now keyed on the insecure origin | DONE | FR-012, staging browser matrix |
| W-TEST-2 | P1 | Test coverage | Evidence-upload journeys skipped themselves on staging, where R2 is bound, because the test counted the form before it rendered | DONE | FR-018, `json/gates/e2e-staging-5093b06-upload.json` (27/27, 0 skipped) |
| W-OPS-6 | P1 | Capacity | E2E traffic filled the staging branch to Neon's 512 MiB cap; staging moved to a fresh project and its guest TTL is 6 hours | DONE | FR-017, `staging2-migrate`, `staging2-isolation` |
| W-RULE-1 | P2 | Rules | Methodology was hard-coded to AGILE at four call sites. Rule input now reads the intake answer `team.methodology` (a select field) through `methodologyFromAnswer`; every surface builds its rule input in `lib/server/project-rules.ts` | DONE (register entry corrected at the end of the pass; the code landed in `949a76e`) | `packages/rules/test/methodology-answer.test.ts` (4), unit run at `a3778c9` |

## Open — P0 and P1, in execution order

| ID | Sev | Workstream | Item | Depends on | Next step |
|---|---|---|---|---|---|
| W-ID-2 | P1 | Identity | No identity provider client exists for staging or production | — | BLOCKED_EXTERNAL — see `OWNER_ACTIONS.md` item 1 |
| W-CI-1 | P1 | CI | GitHub no longer starts Actions jobs for this private repository (payment / spending limit) from `5093b06`; the last verdict is green at `949a76e` | — | BLOCKED_EXTERNAL — `OWNER_ACTIONS.md` item 3. Meanwhile every CI gate is run locally and recorded |
| W-OPS-5 | P1 | Capacity | Production on Neon's free plan has 100 CU-hours/month (suspends until month end when exceeded) and a 512 MiB branch cap (writes fail when reached — staging hit it, FR-017); there is no alert | W-OPS-1 | Owner decision on plan (OWNER_ACTIONS item 2); meanwhile the schedule budget holds scheduled work to a fifth |

## Open — P2

| ID | Workstream | Item | Next step |
|---|---|---|---|
| W-UI-5 | UI states | No loading state. Two approaches tried and withdrawn: streaming boundaries broke the 404 rule (FR-007), and `useFormStatus` pending buttons froze actions under concurrent load (FR-015) | Investigate FR-015's mechanism in isolation before trying a third |
| W-ID-3 | Identity | Returning user's guest work is kept apart, not merged (KI-066) | A SECURITY DEFINER transfer function owned by the migration role, audited, re-keying project rows between two organisations the caller owns |
| W-GOV-1 | Approvals | `recordApproval` records the requester as approver with role fixed to PROJECT_OWNER — no segregation of duties for approvals (change requests do have it) | Accepted for V1 with the reason stated: every V1 organisation has exactly one member (no invites — W-ORG-2), so self-approval is the only approval possible. The segregation rule becomes required the day a second member can join |
| W-BUD-1 | Budget / resources | Assumed day rate and UNKNOWN complexity (both stated on the page), `resources: []`. The currency default is now disclosed when no currency was given | Intake fields for rate and people; pass them to finance and capacity engines |
| W-TRACE-1 | Traceability | About half the requirements on the fixture still break at TEST | Honest as reported; closes when test cases are authored per requirement |
| W-PERF-1 | Performance | §63's fixtures now exist for the domain engines. `packages/traceability/test/scale.test.ts` builds Small, Medium and Large project graphs (Large: 12,106 nodes, 23,105 relationships, 5,000 tasks, 1,000 requirements, 3,000 tests, 100 people). It runs them through graph construction, traceability, gap analysis and invariants, with exact expected counts and time budgets (Large about 125 ms against a 5 s budget). Still missing: server time for the plan, trace and budget pages at those sizes on staging, which needs a way to load a large twin into a staging project | Seed a Large project into staging through the repository layer as the restricted role, then run `perf-smoke.mjs` against its pages |

## Open — P3 and deferred

| ID | Item | Status |
|---|---|---|
| W-OUT-1 | Outbox: no producer writes `outbox_events`, handlers are log-only (§43/§44: V1 has no transport to deliver to). **Also found:** the drainer claims rows as `govintel_app` with no tenant scope, and `outbox_events` forces RLS, so it would claim nothing even once producers exist — the same defect class as FR-005. Production is configured without a queue. | DEFERRED, with the reason stated. When a transport exists: a SECURITY DEFINER claim function (migration), then producers beside the audit writes already in each transaction |
| W-DISC-1 | Search, command palette, notifications (`@govintel/discovery/*`, built and unit-tested, no UI) | DEFERRED — no V1 flow depends on them; recorded rather than shipped half-wired |
| W-EXP-1 | Project export | DEFERRED (register marked it not required for V1) |
| W-MOB-1 | Distinct mobile screens 59–64 | DEFERRED — every page reflows to 320 px and passes the reflow test; distinct screens are not built |
| W-ORG-2 | Multi-member organisations, invites | DEFERRED — one owner per organisation in V1 |
| W-UI-3 | `navigation.ts` lists 19 routes that do not exist; reachable only on `/design/reference`, which production 404s and no journey links to | OPEN, P3 — reclassified from P2; map to the real `/plan/[id]/*` routes when AppShell is adopted, or delete with W-DEAD-1 |
| W-DEAD-1 | 31 modules with no direct production caller | OPEN, P3 — listed in the inventory; delete or wire per module |

## How this register is kept

An item moves to DONE only with a proof column that points at something a reviewer can run. Items
found after this date are appended, never folded into existing rows.
