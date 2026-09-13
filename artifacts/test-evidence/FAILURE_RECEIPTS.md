# Failure receipts — final completion pass

Started 2026-09-13 against `553a551`. One receipt per meaningful failure found during the final
completion pass: what failed, the evidence, the root cause, the change, and the proof that the change
fixed it without breaking anything next to it. Receipts are appended, never edited to look better.

| ID | Found by | Area | Status |
|---|---|---|---|
| FR-001 | Probing staging | Operations / database capacity | Fixed in code; staging re-provisioned (see FR-004) |
| FR-002 | Writing FR-001's tests | Outbox drainer | Fixed |
| FR-003 | Baseline `pnpm audit` | Dependency security | Fixed |
| FR-004 | Probing staging | Deployment | Staging re-provisioned and redeployed at `efdb739` |
| FR-005 | Reading the purge against the RLS policies | Guest retention | Fixed |
| FR-006 | Reading sign-in against the RLS policies | Authentication / tenancy | Fixed (first sign-in); returning-user merge is a known issue |
| FR-007 | Local E2E after my own change | Security (404-not-403) | Fixed — the change was reverted |
| FR-008 | A new E2E test | Tenant isolation (development parity) | Fixed |
| FR-009 | Inventory of graph readers | Lifecycle / gates | Fixed |
| FR-010 | E2E rerun | Test isolation | Fixed |

---

## FR-001 — The cron schedule spent the database's entire compute quota

**Observed.** `GET https://govintel-web-staging.kpleelaaravind.workers.dev/api/health` returned
Cloudflare `error code: 1042`. Querying the staging branch directly through the Neon API:

```
NeonDbError: Server error (HTTP status 402): {"message":"Your account or project has exceeded the
compute time quota. Upgrade your plan to increase limits." ...}
```

**Evidence.** Neon project `tiny-mode-81422275` (free plan `free_v3`), branch `staging`:
`active_time_seconds` 839,488 and `compute_time_seconds` 396,247 between 2026-09-01T09:09Z and
`compute_last_active_at` 2026-09-11T02:18Z. That is about 845,000 s of wall-clock, so the compute was
awake **97% of the time**, averaging 0.47 CU. Neon's free plan gives 100 CU-hours per project per month
and "when you run out of CU-hours … your compute is suspended until the next billing period"
(neon.com/docs/introduction/plans). Quota resets 2026-10-01.

**Root cause.** `apps/worker/wrangler.toml` scheduled the drainer `* * * * *`. Neon scales a compute to
zero only after five idle minutes, so a query every minute meant the compute never slept; the cron
alone cost ~182 CU-hours a month. Production's worker was going to carry the same schedule, so this is
a production-availability defect that staging found first, not a staging quirk.

**Change.** Cron is now `17 */3 * * *`. `apps/worker/src/schedule.ts` models what a schedule costs
(wakes merged across the scale-to-zero window, 0.5 CU average, circular day) and
`apps/worker/test/schedule.test.ts` reads every `crons = [...]` out of `wrangler.toml` and fails if any
environment's schedule would spend more than a fifth of the monthly quota.

**Proof.** `pnpm vitest run --project=node apps/worker` → 22 passed. Planting the original schedule back
fails `keeps env.staging.triggers within a fifth of the monthly compute quota`
(`logs/receipts/FR-002-planted-defects.log`). Hourly also fails (36 CU-h/month), deliberately.

**Still to measure.** Whether Hyperdrive's idle pool keeps a Neon compute awake between ticks is not
stated in Neon's docs. It is measured after the redeploy by sampling `active_time_seconds` an hour
apart, rather than assumed.

## FR-002 — The dead-letter pass never ran in the one situation it exists for

**Observed.** While writing tests for the drainer (FR-001), two defects the register had listed
(`queues`, major) and one it had not.

1. `drain()` returned early when the claim was empty, before `deadLetterExhausted()`. The claim
   excludes rows at `MAX_ATTEMPTS`, so when every pending row had failed for good nothing was claimed
   and the pass that reports them never ran.
2. The dead-letter pass marked a row the moment its attempt count reached `MAX_ATTEMPTS` — in the same
   tick that published its final attempt, before the consumer ran. A delivery that then succeeded was
   left both processed and dead-lettered, with an error line reporting a lost side effect.

**Root cause.** Both are ordering errors in one function: "after the final attempt" was implemented as
"after the final publish".

**Change.** The drainer moved to `apps/worker/src/drain.ts` so it can run against real Postgres. The
dead-letter pass always runs, and treats a row as exhausted only once its last claim has expired
unprocessed.

**Proof.** `apps/worker/test/drain.test.ts`, 9 tests against PGlite. Planting the early return back
fails `dead-letters exhausted rows even when nothing else is pending` and
`gives the final attempt its chance before dead-lettering it`; restoring passes 22/22.

## FR-003 — High-severity advisory in `sharp` through the deploy toolchain

**Observed.** Baseline `pnpm audit --audit-level=moderate` exited 1:
`sharp <0.35.4 — GHSA-g89c-p67h-r497, GHSA-2jg2-4ch7-h545 (libheif), high`, paths
`wrangler > miniflare > sharp` (`logs/baseline-audit-deps.log`).

**Root cause.** miniflare's own range resolves `sharp@0.35.2`. Reachable only from deploy tooling, never
from the deployed Worker, but the audit is a release gate and is right to fail.

**Change.** `pnpm-workspace.yaml` override `'sharp@<0.35.4': '^0.35.4'`. The patched version was already
in the lockfile for another dependent, so this unifies rather than introduces.

**Proof.** `pnpm audit --audit-level=moderate` → "No known vulnerabilities found"; `sharp@0.35.2` count
in `pnpm-lock.yaml` → 0.

## FR-004 — The staging web Worker no longer exists

**Observed.** `workers_list` on account `a0365f6aaae5fe32b3fdb8fa08fd000c` returns 31 Workers.
`govintel-worker-staging` and `build-itisyou-web-production` are present; **`govintel-web-staging` is
not.** Its Hyperdrive configuration (`fa38480586e44cebab20fe15ac2121a0`) and R2 bucket
(`govintel-evidence-staging`) still exist. The workers.dev URL answers with error 1042.

**Root cause.** Not determinable from this repository: nothing in it deletes a Worker. The account is
shared with at least a dozen other products whose sessions manage their own Workers. Recorded as
observed rather than guessed at.

**Consequence.** Staging had to be re-provisioned as well as redeployed: the old database is suspended
until 2026-10-01 (FR-001), so a fresh Neon project is created for staging and the existing Hyperdrive
configuration repointed at it.

**Fix and proof.** New Neon project `silent-forest-67621251` (`build-itisyou-staging`), schema applied by
`pnpm migrate` (`logs/staging-migrate.log`), `govintel_app` verified with no superuser, bypassrls,
createdb or createrole. Pooled isolation gate against it as `govintel_app`: 6/6
(`logs/staging-isolation.log`). Hyperdrive `fa384805…` repointed with caching still disabled. Web Worker
rebuilt under WSL and deployed (`logs/staging-deploy-web-efdb739.log`, 18 min); `SESSION_SECRET` set;
`/api/health` → `{"status":"ok","mode":"NORMAL","commit":"efdb739"}`. Cron Worker redeployed with
`schedule: 17 */3 * * *` (`logs/staging-deploy-worker.log`).

## FR-005 — The guest purge could see none of the rows it was deleting

**Observed.** `purgeExpiredGuestSessions` ran every delete through the unscoped handle. The Worker
connects as `govintel_app`, and `projects` and `audit_events` force row-level security, so unscoped
they are empty. Run as that role against an expired guest with one audit event:

```
error: update or delete on table "organizations" violates RESTRICT setting of foreign key
constraint "audit_events_organization_id_fkey" on table "audit_events"
```

(`logs/receipts/FR-005-old-purge-under-rls.log`.) The audit delete matched nothing, the organisation
delete cascaded (referential actions ignore RLS) into audit rows it could not see, and the single
transaction failed — the whole sweep, on every run. KI-065's fix (`553a551`) was tested only as
PGlite's superuser, for whom RLS does not exist, and had never been deployed.

**Change.** One transaction per guest, each inside `applyTenantScope` for that guest's organisation,
so the policy allows exactly that guest's rows. One undeletable guest now fails alone and is counted
(`sessionsFailed`, logged at error by the Worker).

**Proof.** Three new tests run the sweep with `SET ROLE govintel_app`: the audited project is deleted, a
stuck guest fails alone while the other is deleted, another tenant's events survive. The old
implementation fails all three; the new passes 35/35 in `guest.test.ts` and 337/337 across
`packages/db`.

## FR-006 — The first real sign-in would have failed

**Observed.** `completeSignIn` did its database work through `withUnscoped`. `memberships`, `projects`
and `audit_events` force RLS with a `WITH CHECK`. As the restricted role: the membership insert for a
new organisation is refused by the policy, an existing user's membership lookup returns nothing, and
the guest conversion's `UPDATE projects` claims zero rows. Every sign-in journey had run only against
PGlite as superuser; staging has no identity provider, so the deployed path had never executed.

**Root cause.** Two, compounding: unscoped writes to tenant tables, and a conversion design (move the
guest's rows to a new organisation) that row-level security makes impossible — an `UPDATE` that changes
the tenant key must satisfy the policy for both the old and the new row, and the audit trail is
immutable by trigger anyway.

**Change.** `packages/db/src/sign-in.ts`, `establishAccount`: on a first sign-in the guest's
organisation *becomes* the account's (renamed, owner membership inserted inside its own scope, projects
drop their guest link). No row changes tenant. A returning user's guest work is left with the guest
session and the user is told (`/portfolio?guest=kept`); merging needs a privileged, audited transfer
and is recorded as a known issue, not improvised.

**Proof.** `packages/db/test/sign-in.test.ts`, 12 tests, all as `govintel_app`, including two that pin
why the old path cannot work (an unscoped conversion claims nothing; an unscoped membership insert is
refused). End to end: the sign-up journey in `e2e/auth.spec.ts` against the mock issuer, and a new
returning-user journey asserting the notice and that the guest work stays reachable.

## FR-007 — A loading boundary turned every "not yours" 404 into a 200

**Observed.** After I added `loading.tsx` to `/plan/[projectId]` and `/intake/[projectId]`, nine E2E
tests failed on Chromium, seven of them isolation assertions: `Expected: 404 / Received: 200`
(`logs/receipts/FR-007-loading-boundary-404-became-200.log`).

**Root cause.** A loading boundary makes the framework stream: the status line is sent with the loading
shell, before the page runs, so a `notFound()` inside it can only change the body. The 404-not-403 rule
(plan §32.12) is a *status* guarantee. Streamed content also needs JavaScript to be swapped in, which
failed the no-JavaScript plan journey.

**Change.** Both loading boundaries removed. My own change, caught by the isolation suite before it was
committed. The error and not-found boundaries (which do not stream) remain.

**Proof.** The same five specs re-run: all nine pass (`logs/e2e-local-batch2-rerun-chromium.log`).

## FR-008 — A visitor with no session was shown every guest's project (development)

**Observed.** The new "never lists another guest's project" test failed: a fresh browser context on
`/portfolio` saw the other guest's project.

**Root cause.** `withDatabase` for a caller with no tenant returned the unscoped handle and relied on RLS
to return nothing. That is true only when the connection is the restricted role. Deployed connections
are; the embedded development database connects as superuser. The guarantee depended on the
environment, so local tests could not detect a leak.

**Change.** A caller with no tenant now runs in a transaction with `SET LOCAL ROLE govintel_app` and no
tenant setting — every policy compares against NULL, in development exactly as in production.

**Proof.** The portfolio isolation test re-run (`logs/e2e-local-batch3-chromium.log`).

## FR-009 — Recorded evidence and approvals could never move a project

**Observed.** `transitionProject` passed a literal `[]` for approvals, with a comment saying it would
change "when the approvals table lands"; the table had landed. And ten surfaces plus the transition
itself built their graph from raw twin rows, without the evidence/approval projection only the evidence
page used. So `PLANNED → APPROVED` and `RELEASE_READY → LIVE` were refused for every project, and every
MANUAL gate criterion looked unmet everywhere but one page.

**Change.** `loadPlanRows` — which every page calls — now returns the projected rows
(`loadProjectRows`), so no page can build the graph without evidence. Both lifecycle functions use
`loadProjectGraph` and real approvals, mapped by `approvalFromRecord` (unknown subjects or states map to
nothing rather than being cast).

**Proof.** `packages/governance/test/approval-record.test.ts`, 10 tests through the same
`evaluateTransition` the action calls: a stored baseline approval at the current version allows
`PLANNED → APPROVED`; a later version is `APPROVAL_STALE`; rejected, requested, other-subject and
uninterpretable rows are `APPROVAL_MISSING`.

## FR-010 — The sign-up journey was only a sign-up on a fresh database

**Observed.** On the batch-2 re-run `carries the guest's project onto the new account` failed: signed
in, project page 404.

**Root cause.** The test used a fixed address and the local database outlives a run, so the second run
was a returning user — correctly kept separate under FR-006's design. It had passed on earlier reruns
only because the superuser path moved rows across tenants, which production cannot do.

**Change.** A new identity per run for the sign-up journey, and a separate returning-user journey that
asserts what should happen to them.
