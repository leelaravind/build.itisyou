# Product status matrix

As of `b3829d0`, 2026-09-13. One row per surface or flow (contract §3.3). **Status** uses the
contract's vocabulary: complete, partial, mocked, disconnected, broken, untested, not implemented.
"Complete" means the flow changes real state and a test proves it through the browser or against the
real engine — not that a page renders.

Auth column: **G** guest session, **U** signed-in user, **—** public. Every project surface resolves
access through `accessibleProject` and answers 404 for unknown and forbidden alike.

## Surfaces

| Surface / flow | Route | Backend | Database | Auth | Status | Missing behaviour | Tests | Sev | Workstream | Proof |
|---|---|---|---|---|---|---|---|---|---|---|
| Landing | `/` | none | none | — | complete | Pipeline illustration uses illustrative values (labelled) | axe, security headers, E2E | P3 | UI | `e2e/accessibility.spec.ts` |
| How it works | `/how-it-works` | none | none | — | complete | — | E2E | — | UI | `e2e/guest-intake.spec.ts` |
| Start a project (guest) | `/start` | `startProject` | guest_sessions, organizations, projects | — → G | complete | Rate-limit message is generic | E2E, rate-limit unit | P3 | Guest-first | `e2e/guest-intake.spec.ts` |
| Intake wizard | `/intake/[id]` | `answerQuestion` | intake_answers | G/U | partial | `?error=` feedback not shown; `intake_answers` has no RLS and no `organization_id` on write | E2E incl. keyboard, "I don't know" | P2 | Intake | `e2e/guest-intake.spec.ts` |
| External-AI prompt | `/intake/[id]/prompt` | interchange/prompt, redaction | intake_answers | G/U | complete | Project name not redacted (register) | E2E, 121 unit | P2 | AI interchange | `e2e/ai-import.spec.ts` |
| AI import: paste, validate | `/intake/[id]/import` | interchange/validate (14 layers) | ai_imports | G/U | complete | `ai_imports` has no RLS; `organization_id` unset | E2E, unit | P2 | AI interchange | `e2e/ai-import.spec.ts` |
| AI import: preview, accept/reject | `/intake/[id]/import/[importId]` | `acceptImport` materialises | ai_imports, intake_answers, projects, audit_events | G/U | complete | — | E2E asserts the model changes | — | AI interchange | `e2e/ai-import.spec.ts` |
| Plan generation | `/plan/[id]` | twin/generate, execution/decompose | twin_nodes, twin_edges | G/U | complete | No version bump or audit on regenerate | E2E, no-JS journey | P2 | Twin | `e2e/plan.spec.ts` |
| Lifecycle transitions | `/plan/[id]` (LifecycleCard) | `transitionProject` | projects, audit_events | G/U | **complete (fixed this pass)** | Approval-gated moves need a recorded approval, which the evidence page records | 166 golden + 10 new seam tests, E2E | — | Lifecycle | FR-009 |
| Quality gates / rules | `/plan/[id]/rules` | rules/evaluate, gates | twin (projected) | G/U | complete | Methodology fixed to AGILE | E2E, 5 rule suites | P2 | Rules | `e2e/rules.spec.ts` |
| Evidence and approvals | `/plan/[id]/evidence` | `recordEvidence`, `recordApproval`, R2 | evidence, approvals, audit_events | G/U | partial | Approver is the requester (no segregation for approvals); role fixed to PROJECT_OWNER | E2E incl. upload, download isolation | P2 | Evidence | `e2e/lifecycle.spec.ts` |
| Evidence download | `/plan/[id]/evidence/[eid]/download` | R2 get | evidence | G/U | complete | — | E2E cross-guest 404 | — | Evidence | `e2e/lifecycle.spec.ts` |
| Traceability index | `/plan/[id]/trace` | traceability/chain | twin (projected) | G/U | complete | TEST hop still breaks for about half of requirements on the fixture (honestly reported) | E2E + element budget | P2 | Traceability | `e2e/trace.spec.ts` |
| One requirement's chain | `/plan/[id]/trace/[...rid]` | traceability/chain | twin | G/U | complete | — | E2E | — | Traceability | `e2e/trace.spec.ts` |
| Work / Today / board | `/plan/[id]/work` | execution/board, scheduling | twin | G/U | partial | `resources: []` — capacity detections cannot fire | E2E | P2 | Execution | `e2e/work.spec.ts` |
| Budget and capacity | `/plan/[id]/budget` | finance/* | twin, intake | G/U | partial | Assumed £500/day, UNKNOWN complexity, default GBP, no cost lines | E2E, finance unit | P2 | Budget | `e2e/budget.spec.ts` |
| Change requests | `/plan/[id]/change` | `requestChange`, `decideChange`, `applyChange` | change_requests, twin_nodes, projects, audit_events | G/U | partial | Outcome query strings not displayed; no ADDITION option in the form | E2E, change unit | P2 | Change | `e2e/change.spec.ts` |
| Baseline | `/plan/[id]/baseline` | governance/baseline | twin | G/U | mocked | Preview only — no baseline is ever stored (`twin_baselines` has no writer) | E2E | P2 | Baseline | `e2e/baseline.spec.ts` |
| Release readiness | `/plan/[id]/release` | release/readiness | twin | G/U | partial | Every operational input is `[]` — gates evaluate, inputs cannot be recorded | E2E | P1 | Release | `e2e/release.spec.ts` |
| Closure | `/plan/[id]/close` | completion/closure | twin | G/U | partial | Failing tests, security findings, stale documents hard-coded to 0 | E2E | P1 | Completion | `e2e/close.spec.ts` |
| Project Home | `/p/[id]` | lifecycle, gates, audit, change | projects, audit_events, change_requests, twin | G/U | **complete (new this pass)** | No health score or forecast (none is computed from data yet) | 6 E2E incl. 404 and axe | P3 | Project home | `e2e/project-home.spec.ts` |
| Portfolio / project list | `/portfolio` | projects list | projects | G/U | **complete (new this pass)** | No cross-project roll-up (the page says so) | E2E incl. cross-guest isolation | P3 | Organisation | `e2e/portfolio.spec.ts` |
| Sign in / sign out | `/login`, `/auth/callback` | OIDC (PKCE, state, nonce, JWKS) | users, organizations, memberships, sessions, audit_events | — → U | **complete in code; BLOCKED_EXTERNAL at runtime** | No provider client configured anywhere; returning-user guest merge (KI-066) | 19 OIDC attack unit, 12 RLS sign-in, 7 E2E vs mock | P1 | Identity | FR-006 |
| Error / not-found | any | — | — | — | complete (new) | — | E2E via 404 status assertions | — | UI states | `app/error.tsx`, `app/not-found.tsx` |
| Loading states | plan, intake | — | — | — | not implemented | Streaming boundaries break 404-not-403 (FR-007); needs a non-streaming approach | — | P3 | UI states | FR-007 |
| Design reference | `/design/reference` | none | none | — | complete (non-production) | 404 in production | axe, keyboard, reflow | — | Design system | `e2e/accessibility.spec.ts` |
| Health endpoint | `/api/health` | `select 1` | any | — | complete | — | E2E staging | — | Operations | `e2e/staging.spec.ts` |

## Flows that cross surfaces

| Flow | Status | Evidence |
|---|---|---|
| Guest: start → intake → prompt → import → accept → plan → gates → work → trace → budget → change | complete | E2E suites above, Chromium local (batch 3: 79 passed) |
| Guest → first sign-in keeps the work | complete in code, BLOCKED_EXTERNAL at runtime | `packages/db/test/sign-in.test.ts` as `govintel_app`; `e2e/auth.spec.ts` vs mock issuer |
| Returning user with new guest work | partial — kept apart and disclosed, not merged | KI-066; `e2e/auth.spec.ts` |
| Lifecycle IDEA → … → LIVE → COMPLETED | partial — engine and wiring complete; RELEASE_READY → LIVE needs production checks the product cannot record yet | FR-009; release row above |
| Guest data expiry | complete | FR-005; cron every 3 h |
| Organisation with several members | not implemented (V1 has one owner per organisation) | `@govintel/organization/membership` has no caller |
| Notifications, search, command palette | not implemented | `@govintel/discovery/*` has no caller |
| Project export | not implemented | register |
| Mobile screens 59–64 | not implemented as distinct screens; pages reflow to 320 px | `e2e/mobile.spec.ts` |
