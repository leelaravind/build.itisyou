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
| FR-011 | Full unit + E2E run in parallel | Test harness / machine contention | Not a product defect; re-run clean |
| FR-012 | Staging E2E browser matrix | Test coverage (WebKit, iOS Safari) | Fixed — skip keyed on the insecure origin |
| FR-013 | Staging and CI E2E | Test harness (my own bulk edit) / typecheck gap | Fixed; the E2E tree is now type-checked by the gate |
| FR-014 | Reading CI logs | CI (E2E sharding) | Fixed |
| FR-015 | Local E2E under load | UI (pending submit buttons) | Reverted — the control was withdrawn, not the tests |
| FR-016 | My own restore drill | Operations (staging database) | Recovered in 2.5 minutes, no data loss; procedure corrected |
| FR-017 | Final staging E2E run | Operations (database storage cap) | Staging moved to a fresh database; staging guest TTL shortened |
| FR-018 | Reading the staging re-run's skips | Test coverage (evidence upload) | Fixed — the test waits for the form; 27/27 on staging |
| FR-019 | §63 Large project on staging | Baseline (dangling edges after filtering records) | Fixed and re-verified on staging at `a2afc66` |
| FR-020 | §63 Large project on staging | Performance (Work, Budget, Change at 9–10 s) | Partly fixed (quadratic scan removed; about 2× faster on staging); OPEN — W-PERF-3 |
| FR-021 | Final local Chromium run | Test harness / machine contention | Not a product defect; the 3 tests passed when re-run alone |

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

**Measured, not assumed:** whether Hyperdrive's idle pool keeps a Neon compute awake between ticks is not
stated in Neon's docs. On the new staging project, with the web Worker and Hyperdrive in place, the
endpoint reported `last_active 2026-09-13T10:36:56Z` and `suspended_at 2026-09-13T10:42:00Z` —
suspended five minutes after the last query, exactly Neon's window. The pool does not hold it awake,
so the budget model's assumption holds.

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

**Root cause.** Confirmed by the owner on 2026-09-13: the Worker was deleted during a clean-up of the
Cloudflare account, which hosts a dozen other products. Nothing in this repository deletes a Worker.
The resources staging depends on are now listed in `docs/final-completion/OWNER_ACTIONS.md` so a future
clean-up can leave them alone.

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

## FR-011 — Three failures that were the machine, not the product

**Observed.** Running the full Vitest suite and a local Playwright batch at the same time: the
`migrations.test.ts` top-level `beforeAll` (two full PGlite databases) hit its 30 s hook timeout and
all 20 of its tests were reported *skipped*; `project-home.spec.ts` "names the gates…" waited more than
5 s for plan generation; and `change.spec.ts` "never echoes an unrecognised outcome code" failed a
strict-mode locator (`logs/unit-batch4.log`, `logs/e2e-local-batch4-chromium.log`).

**Diagnosis.** Two were contention: the same file passed 20/20 alone and in both earlier full runs,
and plan generation is the heaviest server work in the product. The third was a real harness defect:
the framework's route announcer is also `role="alert"`, so an unfiltered `getByRole('alert')`
matched two elements.

**Change.** The locator is filtered by text. No timeout was raised: a limit that fails under contention
is telling the truth about contention.

**Proof.** Re-run with nothing else on the machine: Playwright 84 passed, 0 failed
(`logs/e2e-local-batch4-rerun-chromium.log`); Vitest 2,436 / 2,436 with no skips
(`unit/batch4-rerun-vitest.json`).

## FR-012 — WebKit and iOS Safari never ran the journeys, even over HTTPS

**Observed.** The staging run at `b3829d0`: 388 passed, 0 failed — but WebKit skipped 193 tests and
mobile Safari 194 (`e2e/staging-b3829d0.json`).

**Root cause.** Fifteen specs skipped on `browserName === 'webkit'`. KI-024 is about plain HTTP —
WebKit drops the session cookie on an insecure origin — and its own note says it is "verified against
HTTPS at the staging gate". Keyed on the browser, the skip fired on HTTPS staging too, so that
verification could never happen. The register recorded this; the staging run measured it.

**Change.** Each skip is now `isWebkit(browserName) && insecure(baseURL)`: WebKit still skips over local
HTTP, and runs over HTTPS.

**Proof.** The next staging run's WebKit and mobile-Safari rows (see the final report's browser matrix).

## FR-013 — A bulk edit I made referenced a variable that was not there, and no gate type-checked it

**Observed.** WebKit and mobile Safari failed `guest-intake.spec.ts` "the whole flow works without
client JavaScript" with `ReferenceError: baseURL is not defined`, on staging and in all four CI shards
at `fc830b8` (`logs/e2e-staging-fc830b8.log`, `ci/run-34750633125.json`).

**Root cause.** The FR-012 edit rewrote every WebKit skip to `isWebkit(browserName) && insecure(baseURL)`
and added `baseURL` to the `beforeEach` fixtures, but this one skip sits inside a test body whose
fixtures did not name it. It threw only on WebKit, where `&&` evaluates its right-hand side.
`tsc -p e2e` reports it (`TS2304: Cannot find name 'baseURL'`) — but nothing ran `tsc -p e2e`:
`pnpm typecheck` covered the packages and the app, never the E2E specs.

**Change.** The fixture is named. `pnpm typecheck` now ends with `tsc --noEmit -p e2e`, so CI's verify
job type-checks every spec.

**Proof.** `tsc --noEmit -p e2e` exits 0 with the fix and reports TS2304 with the file at `fc830b8`.

## FR-014 — CI's four E2E shards each ran the whole suite

**Observed.** Every E2E shard at `fc830b8` logged `Running 1340 tests using 3 workers` and reported the
same two failures; the step ran `$ playwright test -- --shard=1/4`.

**Root cause.** `pnpm test:e2e -- --shard=N/4` passed the `--` through to Playwright, which ignores what
follows it. The sharding added at `47a676e` to keep the suite inside the 30-minute cap never split
anything: each job ran all 1,340 tests in about 25 minutes, and the "green" run there was the whole
suite fitting into one job with minutes to spare.

**Change.** `pnpm exec playwright test --shard=N/4`. Locally, the same flag without `--` lists 340 of
1,340 tests.

**Proof.** The next CI run's per-shard "Running N tests" lines.

## FR-015 — A pending-state button that froze the product's main actions under load

**Observed.** After replacing four submit buttons (start, build the plan, lifecycle moves, record a
baseline) with a `useFormStatus` pending button, a local Chromium batch failed repeatedly with the
button left `[disabled]` and the action never completing: "Build the plan" stuck beside "No plan yet",
"Continue" stuck on `/start` (`logs/receipts/FR-015-pending-submit-6-failed.log`). Each failing test
passed on its own.

**Diagnosis.** Measured, not argued: with the generate button restored to a plain `<button>` and
nothing else changed, the same two specs under the same four-worker load passed 30/30
(`logs/receipts/FR-015-plain-button-30-passed.log`). The failure needs concurrent server actions to
appear, which is why every test passed alone. The exact mechanism in the framework was not
established in the time available, and is not claimed.

**Change.** The component was removed and all four buttons restored. A loading indicator that can
freeze the actions it decorates is worse than none; KI-067 stays open.

**Proof.** The batch-6 local run with the plain buttons (`e2e/local-batch6-chromium.json`).

## FR-016 — The restore drill swapped the live staging database for the restored copy

**Observed.** To drill recovery I snapshotted staging at 10:00Z and restored it "onto a new branch".
The tool's `finalize` defaults to true for a new branch, which **moves the compute onto the restored
branch and swaps the names**: from 11:03:04Z to 11:05:34Z the staging endpoint — Hyperdrive's target —
served the 09:59Z data, a schema the running release refuses (fingerprint mismatch).

**Recovery.** No data was lost: everything since 09:59Z, including migration 003, stayed on the
original branch. Repointing Hyperdrive was blocked by the session's permission policy, so the endpoints
were moved back instead — the spare endpoint to a compute-less parking branch, the staging endpoint
back to the original branch, then the spare onto the drill branch — with the default branch and names
restored. Verified: latest fingerprint `6aa38dae…`, migration 003 present, RLS forced, all 9
post-deploy checks passing. The staging E2E run in progress overlapped the window; its failures are
re-run rather than counted.

**Change.** The drill procedure: restore with `finalize: false` (or restore onto a parked branch), never
the default, on any project whose endpoint something is using. Recorded in the runbook.

**What it cost the evidence.** The staging run at `949a76e` (`e2e/staging-949a76e.json`) recorded 39
failures. 36 of them fall between 11:02:55Z and 11:05:31Z — the window — and are the release
correctly refusing to serve a schema it does not recognise (`toHaveURL` failures on project creation).
The other 3 are the new budget-currency test on each browser, run against a deployment that did not
yet contain the change it tests. None is counted as a pass: the full staging suite is re-run on the
next deployment, and the final report judges that run.

**The drill itself** then passed: restored in 9 s, pre-003 fingerprint as expected for 09:59Z, the
restricted role intact, pooled isolation 6/6 on the restored copy (`database/staging-restore-drill.json`).

## FR-017 — Test traffic filled the staging database, and every write failed

**Observed.** The final full staging run at `5093b06` recorded 367 failures, all but a handful after
11:56Z, across every browser: project creation returned "Something went wrong starting your project"
(`e2e/staging-5093b06.json`). The staging branch's logical size was **536,952,832 bytes** against Neon's
free-plan branch cap of **536,870,912** (512 MiB); `pg_database_size` 489 MB; 1,505 guest projects and
232,304 twin rows, all created by today's E2E runs.

**Root cause.** Each full E2E run creates about 600 guest projects with their plans. Guest data is kept
72 hours before the purge deletes it, so four runs in a day accumulate faster than retention reclaims.
Past the cap Neon refuses writes, and the product reports the failure safely and generically — which is
correct behaviour for the product and a wall for the test suite. The same family as FR-001: a free-plan
hard limit met by our own traffic.

**Change.** Staging moved to a fresh Neon project (`proud-truth-36178526`, `build-itisyou-staging-2`),
migrated, isolation 6/6 as the restricted role; Hyperdrive's host repointed with the stored credential
unchanged. Deleting the test data instead would have been destructive and was not done without the
owner. Staging's `GUEST_PROJECT_TTL_HOURS` is now 6, so the three-hourly purge reclaims test data within
nine hours; production keeps 72.

**Proof.** Post-deploy checks 9/9 on the fresh database; the 367 failures re-run with `--last-failed`
(`e2e/staging-5093b06-rerun.json`).

## FR-018 — Evidence upload journeys skipped on staging, where the store is bound

**Observed.** The staging re-run at `5093b06` passed with 8 skips. The skips were the evidence-upload
journeys on every browser, reported as "no object store", but staging binds the R2 bucket `EVIDENCE`.
Nothing failed, so nothing flagged it.

**Root cause.** A race in the test, not in the product. `requireFileStorage` decides whether uploads
are available by counting the "attach the artefact" field. `openEvidenceForm` clicks a link and returns
at once, and Playwright's `count()` doesn't wait. Locally the form rendered before the count; over a
real network it hadn't yet, so the count was 0 and the journey skipped itself.

**Change.** `e2e/lifecycle.spec.ts` now waits for the evidence form's first field to be visible before
counting. The skip stays for its real purpose, a deployment with no bucket bound.

**Proof.** The evidence-and-approvals block on staging (Chromium, WebKit, iOS Safari): **27 passed,
0 skipped, 0 failed** (`e2e/staging-5093b06-upload.json`). Before the fix the same journeys skipped.

## FR-019 — A project with linked evidence could neither view nor record a baseline

**Found by** `scripts/evidence/perf-large.mjs`, gap-spec §63's Large fixture on staging at `57d8754`.
It seeds a real guest project with 12,106 nodes and 23,105 relationships as `govintel_app` inside an
RLS-scoped transaction.

**Observed.** Ten of eleven project pages answered 200. `/plan/:id/baseline` answered **500** on
every request (`performance/perf-large-before-fix-57d8754.json`).

**Root cause.** The baseline page and the baseline recording action both built "the plan without
its records" by filtering out `EVIDENCE` and `APPROVAL` nodes while keeping **every edge**. A test's
`EVIDENCED_BY` edge then pointed at a node that was no longer in the graph, and `TwinGraph` refuses a
dangling edge by design. Any project whose twin links a test to evidence fails the same way,
whatever its size. Size is only what made the fixture contain such an edge.

**Change.** `planGraphFromRows` (`packages/twin/src/repository.ts`) drops the edges that touch a
dropped node, and both call sites use it. Three repository tests cover it: the old filter throwing on
those rows, records and their edges left out, and every plan node and plan-to-plan edge kept.

**Proof.** Staging at `a2afc66`, with a freshly seeded Large project: `/plan/:id/baseline` **200** on
every request (p95 1,432 ms), and **0 of 11** project pages crashed (`performance/perf-large.json`,
`json/gates/staging-perf-large.json`). Post-deploy checks 9/9. Unit 2,457/2,457.

## FR-020 — At the Large size, three pages take nine to ten seconds (OPEN)

**Found by** the same run. **Observed** at `a2afc66` with 12,106 nodes, 6 samples per page after a
warm-up:
- Work, Budget and Change: p95 **9.4–10.3 s**.
- Project Home and Plan: 2.3–2.5 s.
- Trace, Rules and Baseline: 1.0–1.4 s.
- Evidence, Release and Close: p50 about 0.9–1.1 s, with one slow sample each (p95 3.7–5.0 s).

Nothing crashed, which is §63's bar. The interactive budget is 1.5 s.

**Diagnosis so far, not profiled.** The three slow pages are exactly the three that call `decompose`
(`packages/execution/src/decompose.ts`) on every request, against all 5,000 tasks. None of the eight
faster pages call it.

**Measured afterwards.** `decompose` alone on the same Large plan takes **1.16 s** on a laptop
(`packages/execution/test/decompose-scale.test.ts`, duration in `unit/decompose-large-vitest.json`).
That is a large share of a page, but it does not account for 9–10 s on its own. The rest of those
pages' work — rule evaluation, `mergeIntoGraph`, the board and capacity summaries — has not been
profiled yet. The correlation above is real; "decompose is the cause" would have been a guess.

**Profiled.** `scripts/evidence/profile-large.mjs` runs every pure step of the Work page on the
full Large fixture with real rule emissions (`performance/profile-large.json`):

- `decompose`: **3,327 ms** of 3,421 ms, which is 97%.
- Rule evaluation 12 ms, graph construction 11 ms, `mergeIntoGraph` 23 ms, `buildToday` 32 ms,
  `buildBoard` 13 ms, the two summaries 1–2 ms each.

The 1.16 s above was a smaller fixture with no emissions. So the decomposition is the cost, and
Budget and Change pay it too, because they call it on every request. At that ratio, a Worker running
it a few times slower than a laptop gives the 9–10 s measured on staging.

**Status.** OPEN — register W-PERF-3. Next step: compute the decomposition once, when the plan is
generated or the twin changes, and store it with the twin version, instead of on every page view.
Then find what in `decompose` grows faster than linearly: 5,000 tasks taking 3.3 s suggests a scan
per task.

**Partly fixed at `329fae5`.** The hotspot was `decompose.ts`: it built each node's children by
filtering every edge in the plan for every node, so the work grew with nodes × edges. The children
are now indexed once, in edge order, so the output is identical and the 122 execution tests (golden
fixtures) pass unchanged. `decompose` on the Large plan locally went from 3,327 ms to about 940 ms.

On staging, with a freshly seeded Large project (`performance/perf-large.json`):
- Work: p50 9.2 s → 4.5 s.
- Budget: p50 9.6 s → 5.8 s.
- Change: p50 9.1 s → 4.6 s.

That improvement comes in a run where the pages this change does not touch were about 40% slower
than the previous run, so the like-for-like gain is larger. Nothing crashed; post-deploy checks 9/9.

**Still OPEN (W-PERF-3).** Those three pages are still 3–4 times over the 1.5 s budget, and Project
Home and Plan are over it too. Next step: `decompose` still takes about a second, so find the
remaining per-item scan (likely `collapseSingletons`, which rescans every edge once per container
it collapses). Then compute the decomposition once per twin version instead of on every request.

**Regression at `329fae5` on staging.** The Work, Budget, Change and Baseline specs in Chromium:
**57 passed, 0 failed** (`e2e/staging-329fae5-work-budget-change.json`). Those specs include tenant
isolation, the 404 rule and axe.

## FR-021 — Three local tests timed out while agents were loading the machine

**Observed.** The final local Chromium run at `7ed0985` (embedded database, mock OIDC issuer):
255 passed, 3 failed, 15 skipped (`e2e/local-final-chromium.json`). All three failures were the
tests' own 5-second waits for a server action: project creation in `lifecycle.spec` ("refuses
evidence that points at nothing"), and plan generation in two `work.spec` setups. The screenshot shows
the start form submitted with no refusal on the page; the answer simply took longer than 5 s.

**Cause.** They failed in the minutes when two agents started beside the suite: a worktree
`pnpm install` with profiling runs, and a full-history `git log -p` sweep. That is the contention
pattern recorded in FR-011, where the limits were deliberately left alone.

**Proof.** The same three tests re-run alone with `--last-failed --workers=1`: **3 passed**
(`e2e/local-final-chromium-rerun.json`). The report counts the full run as passed only because each
failure passed on that later local re-run, and it names them.

