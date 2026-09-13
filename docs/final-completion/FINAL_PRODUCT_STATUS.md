# Final product status

**Date:** 2026-09-13 · **Commit:** see the final report header · **Contract:** `FINAL_PRODUCT_COMPLETION_IMPLEMENTATION_PLAN.md`

## Verdict

**V1 is not complete, and production is not deployed.** The guest-first product works end to end on
real Cloudflare and Neon infrastructure and is verified there. Nothing in `COMPLETION_REGISTER.md` is
P0, and every open P1 is an owner action: an identity provider client (nobody can sign in for real, and
gap-spec §6.2 requires a production login method), GitHub billing (CI cannot run), and the production
database plan. The remaining engineering items are P2 and below, each with a next step.

This pass started from a staging environment that no longer existed and a set of claims that were true
only on the embedded database's superuser path. It ends with staging rebuilt and verified, four P0
defects of that kind fixed and guarded by tests that connect as the production role, and every claim
below backed by a record under `artifacts/test-evidence/`.

## At a glance

| | |
|---|---|
| Staging | https://govintel-web-staging.kpleelaaravind.workers.dev — serving `a2afc66` (version `918e868e`), the last code change, health `ok`, database `NORMAL`, 9/9 post-deploy checks (TLS, HSTS, nonce CSP, framing, nosniff, 404 rule), perf smoke within budget, rollback drilled; database Neon `proud-truth-36178526` |
| Production | `build.itisyou.app` — **not deployed**; blocked on the identity provider (owner) and the register's open items |
| Unit and integration tests | **2,457 / 2,457** passed at `a2afc66` (Vitest, 65 files; `json/gates/unit-final.json`). That includes §63's Small, Medium and Large fixtures through the traceability engines; the Large one has 12,106 nodes and 23,105 relationships |
| End-to-end | **All five browsers on staging, 0 unresolved failures.** Firefox and mobile Chrome at `a3778c9` (the only code change since is the baseline graph fix, FR-019, verified on staging separately): **516 passed, 0 failed, 0 flaky, 30 skipped**. The skips: 16 sign-in journeys (no identity provider on staging, an owner action), 12 phone-only tests on desktop Firefox, and 2 waiting for mobile navigation (DEFERRED). Chromium, WebKit and iOS Safari at `5093b06`: full run plus re-run after FR-017, and the upload block 27/27 (FR-018). Local Chromium. CI five-browser matrix green at `949a76e` |
| CI | **Blocked from `5093b06` by GitHub billing** — no job starts (runs `34754927664`, `34758533871` at `a3778c9`: 8 jobs, 0 steps). Last verdict green at `949a76e`; later commits verified by the same gates locally (format, lint, typecheck, docs, secrets, unit, SAST at `a3778c9`) and on staging |
| Security | restricted role verified (no superuser/BYPASSRLS/owner), pooled isolation 6/6 on staging and on a restored copy, every tenant table under forced RLS, 404-not-403 enforced, secret and dependency scans clean, SAST (Semgrep, 74 rules) 0 findings |
| Accessibility | axe WCAG 2.2 AA on every route, landmarks, keyboard reachability, reflow at 320 px, a keyboard-only journey from start to plan |
| Migrations and recovery | migration 003 applied to staging with row counts sampled before and after (unchanged, 0 keyless rows); production's path 001→002→003 verified from its current fingerprint; rollback drilled in 9 s / 11 s; point-in-time restore drilled (ready in 9 s, restricted role intact, isolation 6/6 on the copy) |
| Performance | Perf smoke within budget. §63 Large project (12,106 nodes, 23,105 relationships) seeded into staging as the restricted role: **all 11 project pages render**, but Work, Budget and Change take 9–10 s at p95 and Project Home and Plan 2.3–2.5 s, against a 1.5 s budget — open as W-PERF-3 (FR-020) |
| Final report | `artifacts/test-evidence/pdf/FINAL_TEST_REPORT.pdf` |

## What was fixed in this pass

See `artifacts/test-evidence/FAILURE_RECEIPTS.md` (FR-001 to FR-020) and `COMPLETION_REGISTER.md`
"Closed in this pass". In one line each:

- The cron that spent the database's whole monthly quota in ten days, now budgeted by a test.
- Sign-in that would have failed on first use under row-level security; guest work now carried over
  by adopting the guest's organisation.
- The guest purge that could not delete what it could not see.
- A development database that showed a visitor every guest's project.
- A lifecycle that could never pass an approval gate, and ten surfaces blind to recorded evidence.
- Tenant keys and forced RLS on intake answers and AI imports (migration 003).
- A real Project Home and project list in place of a fabricated page; error and not-found states;
  action outcomes that reach the user. (Loading states were tried twice and withdrawn with evidence —
  FR-007, FR-015.)
- Release and closure pages that read recorded evidence instead of empty lists and zeros.
- Recorded baselines.
- WebKit and iOS Safari running the journeys over HTTPS for the first time.
- CI's four E2E shards, which had each been running the whole suite, now split it (26 → 12 minutes),
  and the E2E specs are type-checked.
- SAST where there was none: Semgrep in CI, 0 findings.
- Production verification recordable for all ten §15.9 checks; a methodology question that reaches the
  rules; the budget page saying when its currency is assumed.
- Two staging capacity failures found by running things — the compute quota (FR-001) and the storage
  cap (FR-017) — with the causes fixed and budgeted, and a point-in-time restore drilled.
- Evidence-upload journeys that had been skipping themselves on staging because a test counted a form
  before it rendered (FR-018); now exercised against the real R2 bucket, 27/27.
- A baseline page that crashed (500) for any project whose twin links a test to evidence; found by
  seeding §63's Large project into staging, fixed and re-verified there (FR-019).

## Blocked on the owner

`OWNER_ACTIONS.md`: (1) an OIDC client for staging and production — four values, one of them secret;
(2) a decision on the production database plan; (3) GitHub Actions billing, so CI runs again;
(4–6) optionally, deleting two retired staging databases and the restore-drill branch.

## Deliberately not done

Recorded in the register with reasons: multi-member organisations, search / command palette /
notifications, project export, distinct mobile screens, the outbox transport. Nothing on that list is
presented anywhere in the product as working.
