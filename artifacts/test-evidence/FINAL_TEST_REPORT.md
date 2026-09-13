# Final test report — build.itisyou

Generated 2026-09-13T09:39:21.062Z at `b3829d0` by `scripts/evidence/final-report.mjs` from recorded evidence only.

## Verdict

**NOT READY — at least one required check failed**

| PASSED | FAILED | NOT_CHECKED | BLOCKED | DEFERRED |
|---|---|---|---|---|
| 12 | 2 | 8 | 2 | 1 |

## Required checks

| Area | Check | Status | Evidence |
|---|---|---|---|
| Static | Formatting | **FAILED** | pnpm format:check — exit 1 at 553a551, 25 s |
| Static | Lint | **PASSED** | pnpm lint — exit 0 at b3829d0, 73 s |
| Static | Typecheck | **PASSED** | pnpm typecheck — exit 0 at 553a551, 13 s |
| Static | Generated documentation drift | **PASSED** | pnpm docs:check — exit 0 at 553a551, 11 s |
| Unit and integration | Vitest (domain, rules, lifecycle, interchange, twin, database, worker, components) | **PASSED** | 2421/2421 passed (artifacts/test-evidence/unit/batch2-vitest.json) |
| Security | Secret scan | **PASSED** | pnpm scan:secrets — exit 0 at 553a551, 1 s |
| Security | Dependency vulnerability scan | **FAILED** | pnpm audit --audit-level=moderate — exit 1 at 553a551, 1 s |
| Security | Tenant isolation under a real pool, as the restricted role (staging Neon) | **PASSED** | pnpm verify:isolation — exit 0 at efdb739, 6 s |
| Security | Cross-tenant attack suite (isolation.spec, 404-not-403) | **PASSED** | 4 passed, 0 failed, 0 skipped in artifacts/test-evidence/e2e/local-batch3-chromium.json |
| Security | Security headers and CSP | **NOT_CHECKED** | security-headers.spec not in any recorded run |
| Security | CSRF origin checks | **NOT_CHECKED** | csrf.spec not in any recorded run |
| Accessibility | axe WCAG 2.2 AA, landmarks, keyboard, reflow | **PASSED** | 22 passed, 0 failed, 0 skipped in artifacts/test-evidence/e2e/local-batch3-chromium.json |
| E2E | Local critical journeys (PGlite, Chromium) | **PASSED** | 79 passed, 0 failed, 0 flaky, 3 skipped (artifacts/test-evidence/e2e/local-batch3-chromium.json) |
| E2E | Staging release suite (Cloudflare + Neon) | **NOT_CHECKED** | No staging Playwright record |
| CI | GitHub Actions at the latest recorded run | **NOT_CHECKED** | run 34749541918 at b3829d0: in_progress |
| Database | Schema applied to staging by the migration tool | **PASSED** | pnpm migrate — exit 0 at efdb739, 5 s |
| Deployment | Staging web Worker deployed | **PASSED** | wsl -e bash /mnt/e/Project/.claude-scratch/tmp/wsl-deploy.sh — exit 0 at b3829d0, 484 s |
| Deployment | Staging cron Worker deployed with the budgeted schedule | **PASSED** | cd apps/worker && npx wrangler deploy --env staging — exit 0 at efdb739, 28 s |
| Deployment | Staging health, version and database reachability | **NOT_CHECKED** | No staging health record |
| Rollback | Staging rollback drill (roll back, verify, roll forward) | **NOT_CHECKED** | No rollback drill record |
| Performance | Latency smoke against staging | **NOT_CHECKED** | No performance smoke record |
| Recovery | Database restore drill | **NOT_CHECKED** | Drilled 2026-09-02 against the previous staging project (docs/DEPLOYMENT_RUNBOOK.md); not repeated in this pass |
| Identity | Sign-in against a real identity provider | **BLOCKED** | No OIDC client exists for any environment (OWNER_ACTIONS.md item 1). Verified against a local mock issuer only |
| Production | Production deployment and post-deploy verification | **BLOCKED** | Not deployed: release gates are not all green (identity provider, open P1s in COMPLETION_REGISTER.md) |
| Mobile | Distinct mobile screens 59–64 | **DEFERRED** | Pages reflow to 320 px and pass the reflow checks; distinct screens are not built (register W-MOB-1) |

## Test totals

Unit and integration (Vitest, latest run): **2421 passed, 0 failed** of 2421.

| Area | Passed | Failed |
|---|---|---|
| apps/web | 257 | 0 |
| apps/worker | 22 | 0 |
| packages/change | 57 | 0 |
| packages/completion | 42 | 0 |
| packages/db | 337 | 0 |
| packages/design | 10 | 0 |
| packages/discovery | 39 | 0 |
| packages/execution | 121 | 0 |
| packages/finance | 84 | 0 |
| packages/governance | 248 | 0 |
| packages/intake | 63 | 0 |
| packages/interchange | 155 | 0 |
| packages/organization | 36 | 0 |
| packages/release | 67 | 0 |
| packages/resilience | 34 | 0 |
| packages/rules | 372 | 0 |
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

## CI

- Run 34749541918 at `b3829d0` — **in_progress**
  - Secret and dependency scan: success
  - Concurrency suites against networked Postgres: success
  - End-to-end and accessibility (1/4): in progress
  - Cloudflare Worker build: success
  - End-to-end and accessibility (3/4): in progress
  - Format, lint, typecheck, unit tests: failure
  - End-to-end and accessibility (2/4): in progress
  - End-to-end and accessibility (4/4): in progress

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

## Not connected, deliberately

- Identity provider (OIDC client): BLOCKED on the owner — see `docs/final-completion/OWNER_ACTIONS.md`.
- Notifications, search, command palette, integrations: DEFERRED (register).

