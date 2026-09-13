# Failure receipts — final completion pass

Started 2026-09-13 against `553a551`. One receipt per meaningful failure found during the final
completion pass: what failed, the evidence, the root cause, the change, and the proof that the change
fixed it without breaking anything next to it. Receipts are appended, never edited to look better.

| ID | Found by | Area | Status |
|---|---|---|---|
| FR-001 | Probing staging | Operations / database capacity | Fixed in code; staging re-provisioned (see FR-004) |
| FR-002 | Writing FR-001's tests | Outbox drainer | Fixed |
| FR-003 | Baseline `pnpm audit` | Dependency security | Fixed |
| FR-004 | Probing staging | Deployment | See receipt |

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
