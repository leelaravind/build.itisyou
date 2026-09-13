# Final product status

**Date:** 2026-09-13 · **Commit:** see the final report header · **Contract:** `FINAL_PRODUCT_COMPLETION_IMPLEMENTATION_PLAN.md`

## Verdict

**V1 is not complete, and production is not deployed.** The guest-first product works end to end on
real Cloudflare and Neon infrastructure and is verified there. What stops a V1 release is one owner
action (an identity provider client — nobody can sign in for real) and the open items in
`COMPLETION_REGISTER.md`, none of them P0.

This pass started from a staging environment that no longer existed and a set of claims that were true
only on the embedded database's superuser path. It ends with staging rebuilt and verified, four P0
defects of that kind fixed and guarded by tests that connect as the production role, and every claim
below backed by a record under `artifacts/test-evidence/`.

## At a glance

| | |
|---|---|
| Staging | https://govintel-web-staging.kpleelaaravind.workers.dev — deployed, health `ok`, database `NORMAL`, TLS/HSTS/nonce-CSP verified, rollback drilled |
| Production | `build.itisyou.app` — **not deployed**; blocked on the identity provider (owner) and the register's open items |
| Unit and integration tests | see `FINAL_TEST_REPORT.md` for the final run |
| End-to-end | local Chromium; staging Chromium, WebKit and iOS Safari; CI five-browser matrix green at `949a76e` (4 shards × 340 tests, 0 failed) |
| Security | restricted role verified (no superuser/BYPASSRLS/owner), pooled isolation 6/6 on staging and on a restored copy, every tenant table under forced RLS, 404-not-403 enforced, secret and dependency scans clean, SAST (Semgrep, 74 rules) 0 findings |
| Accessibility | axe WCAG 2.2 AA on every route, landmarks, keyboard reachability, reflow at 320 px, a keyboard-only journey from start to plan |
| Migrations and recovery | migration 003 applied to staging with row counts sampled before and after (unchanged, 0 keyless rows); production's path 001→002→003 verified from its current fingerprint; rollback drilled in 9 s / 11 s; point-in-time restore drilled (ready in 9 s, restricted role intact, isolation 6/6 on the copy) |
| Final report | `artifacts/test-evidence/pdf/FINAL_TEST_REPORT.pdf` |

## What was fixed in this pass

See `artifacts/test-evidence/FAILURE_RECEIPTS.md` (FR-001 to FR-015) and `COMPLETION_REGISTER.md`
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

## Blocked on the owner

`OWNER_ACTIONS.md`: (1) an OIDC client for staging and production — four values, one of them secret;
(2) a decision on the production database plan; (3) optionally, deleting the suspended old staging
database.

## Deliberately not done

Recorded in the register with reasons: multi-member organisations, search / command palette /
notifications, project export, distinct mobile screens, the outbox transport. Nothing on that list is
presented anywhere in the product as working.
