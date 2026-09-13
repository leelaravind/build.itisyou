# Final test report — build.itisyou

Generated 2026-09-13T11:10:51.388Z at `949a76e` by `scripts/evidence/final-report.mjs` from recorded evidence only.

## Verdict

**NOT RELEASE-READY — no recorded failure, but required checks are blocked or not checked**

| PASSED | FAILED | NOT_CHECKED | BLOCKED | DEFERRED |
|---|---|---|---|---|
| 22 | 0 | 1 | 2 | 1 |

## Required checks

| Area | Check | Status | Evidence |
|---|---|---|---|
| Static | Formatting | **PASSED** | pnpm format:check — exit 0 at fc830b8, 11 s |
| Static | Lint | **PASSED** | pnpm lint — exit 0 at fc830b8, 57 s |
| Static | Typecheck | **PASSED** | pnpm typecheck — exit 0 at fc830b8, 8 s |
| Static | Generated documentation drift | **PASSED** | pnpm docs:check — exit 0 at fc830b8, 4 s |
| Unit and integration | Vitest (domain, rules, lifecycle, interchange, twin, database, worker, components) | **PASSED** | 2450/2450 passed (artifacts/test-evidence/unit/batch6-vitest.json) |
| Security | Secret scan | **PASSED** | pnpm scan:secrets — exit 0 at fc830b8, 2 s |
| Security | Dependency vulnerability scan | **PASSED** | pnpm audit --audit-level=moderate — exit 0 at fc830b8, 1 s |
| Security | Tenant isolation under a real pool, as the restricted role (staging Neon) | **PASSED** | pnpm verify:isolation — exit 0 at fc830b8, 3 s |
| Security | Cross-tenant attack suite (isolation.spec, 404-not-403) | **PASSED** | 12 passed, 0 failed, 0 skipped in artifacts/test-evidence/e2e/staging-fc830b8.json |
| Security | Security headers and CSP | **PASSED** | 42 passed, 0 failed, 0 skipped in artifacts/test-evidence/e2e/staging-fc830b8.json |
| Security | CSRF origin checks | **PASSED** | 18 passed, 0 failed, 0 skipped in artifacts/test-evidence/e2e/staging-fc830b8.json |
| Accessibility | axe WCAG 2.2 AA, landmarks, keyboard, reflow | **PASSED** | 61 passed, 0 failed, 5 skipped in artifacts/test-evidence/e2e/staging-fc830b8.json |
| E2E | Local critical journeys (PGlite, Chromium) | **PASSED** | 112 passed, 0 failed, 0 flaky, 3 skipped (artifacts/test-evidence/e2e/local-batch6-chromium.json) |
| E2E | Staging release suite (Cloudflare + Neon) | **PASSED** | 732 passed, 6 failed, 0 flaky, 66 skipped (artifacts/test-evidence/e2e/staging-fc830b8.json); all 6 failures passed on a later staging re-run (artifacts/test-evidence/e2e/staging-fc830b8-webkit-rerun.json) — causes in FAILURE_RECEIPTS |
| CI | GitHub Actions at the latest recorded run | **PASSED** | run 34752927029 at 949a76e: success |
| Database | Schema applied to staging by the migration tool | **PASSED** | node --experimental-strip-types scripts/migrate.mjs — exit 0 at fc830b8, 2 s |
| Deployment | Staging web Worker deployed | **PASSED** | wsl -e bash /mnt/e/Project/.claude-scratch/tmp/wsl-deploy.sh — exit 0 at 949a76e, 498 s |
| Deployment | Staging cron Worker deployed with the budgeted schedule | **PASSED** | cd apps/worker && npx wrangler deploy --env staging — exit 0 at efdb739, 28 s |
| Deployment | Staging health, version and database reachability | **PASSED** | node scripts/evidence/deploy-check.mjs https://govintel-web-staging.kpleelaaravind.workers.dev 949a76e — exit 0 at 949a76e, 1 s |
| Rollback | Staging rollback drill (roll back, verify, roll forward) | **PASSED** | bash /e/Project/.claude-scratch/tmp/rollback-drill.sh — exit 0 at b3829d0, 21 s |
| Performance | Latency smoke against staging | **PASSED** | node scripts/evidence/perf-smoke.mjs https://govintel-web-staging.kpleelaaravind.workers.dev — exit 0 at b3829d0, 7 s |
| Recovery | Point-in-time database restore drill (restored copy verified as the restricted role) | **PASSED** | pnpm verify:isolation — exit 0 at 949a76e, 3 s |
| Security | Static application security testing (SAST) | **NOT_CHECKED** | No SAST tool runs in this repository or in CI (plan §18, gap-spec §66). Type-aware lint, secret scanning and dependency audit are not a substitute and are not reported as one |
| Identity | Sign-in against a real identity provider | **BLOCKED** | No OIDC client exists for any environment (OWNER_ACTIONS.md item 1). Verified against a local mock issuer only |
| Production | Production deployment and post-deploy verification | **BLOCKED** | Not deployed: release gates are not all green (identity provider, open P1s in COMPLETION_REGISTER.md) |
| Mobile | Distinct mobile screens 59–64 | **DEFERRED** | Pages reflow to 320 px and pass the reflow checks; distinct screens are not built (register W-MOB-1) |

## Test totals

Unit and integration (Vitest, latest run): **2450 passed, 0 failed** of 2450.

| Area | Passed | Failed |
|---|---|---|
| apps/web | 257 | 0 |
| apps/worker | 23 | 0 |
| packages/change | 57 | 0 |
| packages/completion | 44 | 0 |
| packages/db | 349 | 0 |
| packages/design | 10 | 0 |
| packages/discovery | 39 | 0 |
| packages/execution | 121 | 0 |
| packages/finance | 84 | 0 |
| packages/governance | 248 | 0 |
| packages/intake | 63 | 0 |
| packages/interchange | 155 | 0 |
| packages/organization | 36 | 0 |
| packages/release | 77 | 0 |
| packages/resilience | 34 | 0 |
| packages/rules | 376 | 0 |
| packages/shared | 211 | 0 |
| packages/traceability | 86 | 0 |
| packages/twin | 180 | 0 |

## End-to-end runs and browser matrix

### artifacts/test-evidence/e2e/local-batch2-chromium.json

39 passed · 9 failed · 0 flaky · 3 skipped · 109 s

| Project | Passed | Failed | Flaky | Skipped |
|---|---|---|---|---|
| chromium | 39 | 9 | 0 | 3 |

### artifacts/test-evidence/e2e/local-batch2-rerun-chromium.json

47 passed · 3 failed · 0 flaky · 3 skipped · 60 s

| Project | Passed | Failed | Flaky | Skipped |
|---|---|---|---|---|
| chromium | 47 | 3 | 0 | 3 |

### artifacts/test-evidence/e2e/local-batch3-chromium.json

79 passed · 0 failed · 0 flaky · 3 skipped · 72 s

| Project | Passed | Failed | Flaky | Skipped |
|---|---|---|---|---|
| chromium | 79 | 0 | 0 | 3 |

### artifacts/test-evidence/e2e/local-batch4-chromium.json

74 passed · 2 failed · 0 flaky · 0 skipped · 128 s

| Project | Passed | Failed | Flaky | Skipped |
|---|---|---|---|---|
| chromium | 74 | 2 | 0 | 0 |

### artifacts/test-evidence/e2e/local-batch4-rerun-chromium.json

84 passed · 0 failed · 0 flaky · 0 skipped · 104 s

| Project | Passed | Failed | Flaky | Skipped |
|---|---|---|---|---|
| chromium | 84 | 0 | 0 | 0 |

### artifacts/test-evidence/e2e/local-batch5-chromium.json

56 passed · 30 failed · 0 flaky · 3 skipped · 173 s

| Project | Passed | Failed | Flaky | Skipped |
|---|---|---|---|---|
| chromium | 56 | 30 | 0 | 3 |

### artifacts/test-evidence/e2e/local-batch5-rerun-chromium.json

80 passed · 6 failed · 0 flaky · 3 skipped · 113 s

| Project | Passed | Failed | Flaky | Skipped |
|---|---|---|---|---|
| chromium | 80 | 6 | 0 | 3 |

### artifacts/test-evidence/e2e/local-batch6-chromium.json

112 passed · 0 failed · 0 flaky · 3 skipped · 135 s

| Project | Passed | Failed | Flaky | Skipped |
|---|---|---|---|---|
| chromium | 112 | 0 | 0 | 3 |

### artifacts/test-evidence/e2e/staging-b3829d0.json

388 passed · 0 failed · 0 flaky · 410 skipped · 370 s

| Project | Passed | Failed | Flaky | Skipped |
|---|---|---|---|---|
| chromium | 243 | 0 | 0 | 23 |
| webkit | 73 | 0 | 0 | 193 |
| mobile-safari | 72 | 0 | 0 | 194 |

### artifacts/test-evidence/e2e/staging-fc830b8-webkit-rerun.json

68 passed · 0 failed · 0 flaky · 2 skipped · 480 s

| Project | Passed | Failed | Flaky | Skipped |
|---|---|---|---|---|
| webkit | 34 | 0 | 0 | 1 |
| mobile-safari | 34 | 0 | 0 | 1 |

### artifacts/test-evidence/e2e/staging-fc830b8.json

732 passed · 6 failed · 0 flaky · 66 skipped · 1017 s

| Project | Passed | Failed | Flaky | Skipped |
|---|---|---|---|---|
| chromium | 245 | 0 | 0 | 23 |
| webkit | 236 | 5 | 0 | 27 |
| mobile-safari | 251 | 1 | 0 | 16 |

## CI

- Run 34749541918 at `b3829d0` — **failure**
  - Secret and dependency scan: success
  - Concurrency suites against networked Postgres: success
  - End-to-end and accessibility (1/4): success
  - Cloudflare Worker build: success
  - End-to-end and accessibility (3/4): success
  - Format, lint, typecheck, unit tests: failure
  - End-to-end and accessibility (2/4): success
  - End-to-end and accessibility (4/4): success
- Run 34750633125 at `fc830b8` — **failure**
  - Concurrency suites against networked Postgres: success
  - Secret and dependency scan: success
  - End-to-end and accessibility (1/4): failure
  - Format, lint, typecheck, unit tests: success
  - End-to-end and accessibility (2/4): failure
  - Cloudflare Worker build: success
  - End-to-end and accessibility (3/4): failure
  - End-to-end and accessibility (4/4): failure
- Run 34752927029 at `949a76e` — **success**
  - Concurrency suites against networked Postgres: success
  - End-to-end and accessibility (3/4): success
  - Cloudflare Worker build: success
  - End-to-end and accessibility (2/4): success
  - Format, lint, typecheck, unit tests: success
  - End-to-end and accessibility (1/4): success
  - End-to-end and accessibility (4/4): success
  - Secret and dependency scan: success

## Gate records

| Record | Environment | Result | Commit | Duration |
|---|---|---|---|---|
| baseline-format | local | FAILED | 553a551 (dirty) | 25 s |
| baseline-lint | local | PASSED | 553a551 (dirty) | 157 s |
| baseline-docs-check | local | PASSED | 553a551 (dirty) | 11 s |
| baseline-secrets | local | PASSED | 553a551 (dirty) | 1 s |
| baseline-audit-deps | local | FAILED | 553a551 (dirty) | 1 s |
| baseline-typecheck | local | PASSED | 553a551 (dirty) | 13 s |
| baseline-unit | local | PASSED | 553a551 (dirty) | 126 s |
| staging-migrate | staging | PASSED | efdb739 | 5 s |
| staging-isolation | staging-neon | PASSED | efdb739 (dirty) | 6 s |
| staging-deploy-web-efdb739 | staging | PASSED | efdb739 (dirty) | 1086 s |
| unit-batch2 | local | PASSED | efdb739 (dirty) | 116 s |
| staging-deploy-worker | staging | PASSED | efdb739 (dirty) | 28 s |
| e2e-local-batch2-chromium | local-pglite | FAILED | efdb739 (dirty) | 120 s |
| e2e-local-batch2-rerun-chromium | local-pglite | FAILED | efdb739 (dirty) | 62 s |
| e2e-local-batch3-chromium | local-pglite | PASSED | efdb739 (dirty) | 74 s |
| staging-deploy-web-b3829d0 | staging | PASSED | b3829d0 | 484 s |
| lint-b3829d0-fix | local | PASSED | b3829d0 (dirty) | 73 s |
| e2e-staging-b3829d0 | staging-cloudflare-neon | PASSED | b3829d0 (dirty) | 372 s |
| staging-rollback-drill | staging | PASSED | b3829d0 (dirty) | 21 s |
| staging-perf-smoke | staging | PASSED | b3829d0 (dirty) | 7 s |
| staging-health-b3829d0 | staging | PASSED | b3829d0 (dirty) | 1 s |
| unit-batch4 | local | FAILED | b3829d0 (dirty) | 139 s |
| e2e-local-batch4-chromium | local-pglite | FAILED | b3829d0 (dirty) | 139 s |
| worker-production-dry-run | production-dry-run | PASSED | b3829d0 (dirty) | 6 s |
| e2e-local-batch4-rerun-chromium | local-pglite | PASSED | b3829d0 (dirty) | 106 s |
| unit-batch4-rerun | local | PASSED | b3829d0 (dirty) | 54 s |
| staging-build-web-fc830b8 | staging | PASSED | fc830b8 | 364 s |
| staging-migrate-003 | staging | PASSED | fc830b8 (dirty) | 2 s |
| staging-deploy-web-fc830b8 | staging | PASSED | fc830b8 (dirty) | 95 s |
| staging-health-fc830b8 | staging | PASSED | fc830b8 (dirty) | 1 s |
| staging-isolation-fc830b8 | staging-neon | PASSED | fc830b8 (dirty) | 3 s |
| e2e-staging-fc830b8 | staging-cloudflare-neon | FAILED | fc830b8 (dirty) | 1018 s |
| e2e-staging-fc830b8-webkit-rerun | staging-cloudflare-neon | PASSED | fc830b8 (dirty) | 482 s |
| e2e-local-batch5-chromium | local-pglite | FAILED | fc830b8 (dirty) | 176 s |
| unit-batch5 | local | FAILED | fc830b8 (dirty) | 58 s |
| e2e-local-batch5-rerun-chromium | local-pglite | FAILED | fc830b8 (dirty) | 115 s |
| e2e-local-batch6-chromium | local-pglite | PASSED | fc830b8 (dirty) | 136 s |
| unit-batch6 | local | PASSED | fc830b8 (dirty) | 58 s |
| static-format | local | PASSED | fc830b8 (dirty) | 11 s |
| static-typecheck | local | PASSED | fc830b8 (dirty) | 8 s |
| static-docs-check | local | PASSED | fc830b8 (dirty) | 4 s |
| security-secrets | local | PASSED | fc830b8 (dirty) | 2 s |
| security-audit-deps | local | PASSED | fc830b8 (dirty) | 1 s |
| static-lint | local | PASSED | fc830b8 (dirty) | 57 s |
| staging-deploy-web-949a76e | staging | PASSED | 949a76e | 498 s |
| staging-health-949a76e | staging | PASSED | 949a76e (dirty) | 1 s |
| recovery-restore-drill-isolation | staging-restored-branch | PASSED | 949a76e (dirty) | 3 s |

## Failures found, and what happened to them

Full receipts: `artifacts/test-evidence/FAILURE_RECEIPTS.md`.

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

## Not connected, deliberately

- Identity provider (OIDC client): BLOCKED on the owner — see `docs/final-completion/OWNER_ACTIONS.md`.
- Notifications, search, command palette, integrations: DEFERRED (register).

