# SECURITY ARCHITECTURE

**Contract:** `MASTER_IMPLEMENTATION_PLAN.md` §18 (security architecture), §19 (privacy), §20 (audit),
`IMPLEMENTATION_GAP_CLOSURE_SPEC.md` §7 (tenancy), §34 (threat model), §54 (log redaction),
§65 (pre-live attack suite).

**Status:** live document, updated as controls are implemented and verified. A control is listed as
*verified* only when an automated test exercises it; plan §38 forbids claiming a security control
without probing it.

---

## 1. The governing principle

> A security control that is present but inert is more dangerous than one that is absent.

An absent control is visible in a review. An inert one reads as protection, gets recorded as
protection, and fails silently. §2 is a worked example of exactly that, found in this codebase.

Every control below therefore names **how it is verified**, not just what it is.

---

## 2. Finding SEC-001 — row-level security was defined and doing nothing

**Discovered:** Phase 3, 2026-08-31
**Severity if shipped:** P0 — complete cross-tenant disclosure with no visible symptom
**Status:** RESOLVED, with regression protection

### What happened

Row-level security policies were written on all five tenant-owned tables (`projects`,
`project_members`, `memberships`, `audit_events`, `outbox_events`), each with a `USING` and a
`WITH CHECK` clause keyed on a session variable, and each table set to `FORCE ROW LEVEL SECURITY`.

The isolation suite then failed: a query for one tenant returned **all three tenants' rows**. The
policies existed. They were being ignored entirely.

### Root cause

Two PostgreSQL behaviours compounding:

1. **Superusers bypass row-level security unconditionally.** There is no policy, setting or grant
   that makes RLS apply to a superuser. It is not a permission check that can be tightened.
2. **`FORCE ROW LEVEL SECURITY` does not address this.** It closes a different and narrower hole —
   by default a table's *owner* is exempt from its own policies, and `FORCE` removes that exemption.
   It has no effect on superusers.

PGlite connects as `postgres`, a superuser. Every policy was inert.

The same trap exists in production and is easy to walk into: the migration user is very often the
same account as the application user, and that account is very often the database owner or a
superuser. In that configuration RLS is defined, documented, reviewed — and enforcing nothing.

### Why this nearly passed

The first observation was "three rows where the test expected two". The most available explanation
was a wrong fixture. Adjusting the *assertion* rather than the *setup* would have turned the suite
green, and the resulting state would have been:

- policies present in the migration,
- an isolation suite passing,
- this document asserting that tenant isolation is enforced at the database layer,
- and no isolation at the database layer at all.

Nothing downstream would have contradicted it. This is recorded because the failure mode generalises:
**when a security test produces an unexpected result, the null hypothesis must be that the control
is broken, not that the test is wrong.**

### Fix

A dedicated least-privilege role that queries actually run as:

```sql
CREATE ROLE govintel_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
GRANT USAGE ON SCHEMA public TO govintel_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO govintel_app;
```

The role holds DML and nothing else: no DDL, no ownership, no superuser. Request handling issues
`SET ROLE govintel_app` before touching tenant data, alongside `set_config` for the tenant key.

`FORCE ROW LEVEL SECURITY` is retained — it is still required, because the application role must not
gain an exemption if it ever becomes a table owner through a future migration.

### Regression protection

| Guard | Location |
|---|---|
| Unfiltered `SELECT` returns only the current tenant's rows | `database-isolation.test.ts` |
| A query with **no tenant set** returns nothing (fails closed) — run as the app role, since a superuser would prove nothing | `database-isolation.test.ts` |
| `INSERT` into another tenant is rejected (`WITH CHECK`) | `database-isolation.test.ts` |
| `UPDATE` reassigning a row to another tenant is rejected | `database-isolation.test.ts` |
| `DELETE` cannot reach another tenant's rows | `database-isolation.test.ts` |
| Aggregates do not leak hidden-row counts | `database-isolation.test.ts` |
| Joins cannot reach across tenants | `database-isolation.test.ts` |
| All five tables report `relrowsecurity` **and** `relforcerowsecurity` true, read from `pg_class` | `database-isolation.test.ts` |
| The application role name is pinned by a test, so deployment cannot silently connect as owner | `database-isolation.test.ts` |

### Deployment requirement arising from this finding

**The deployed application must not connect as a superuser or as the table owner.** This is a
deployment configuration requirement, not a code one, and code cannot enforce it — which is why it
is recorded here and pinned by a test rather than left as tribal knowledge. It becomes a pre-live
checklist item in Phase 19.

---

## 2b. Finding SEC-002 — a moderate CVE introduced by an unused dependency

**Discovered:** Phase 3, 2026-08-31, by the CI dependency scan
**Severity:** Moderate (GHSA-67mh-4wv8-2f99)
**Status:** RESOLVED by removal

`pnpm audit` failed on `esbuild <= 0.24.2`, reached through
`drizzle-kit > @esbuild-kit/esm-loader > @esbuild-kit/core-utils > esbuild`. The advisory allows any
website to send requests to esbuild's development server and read the response.

**Assessment.** The exposure was limited — `drizzle-kit` is a devDependency, the vulnerable path is
esbuild's dev server, and nothing here runs it. Three fixes were available: pin a patched esbuild
via a pnpm override, upgrade `drizzle-kit`, or remove the dependency.

**Resolution: removed.** `drizzle-kit` was declared but never used. Its only appearance in the
codebase was a comment explaining why the schema DDL is hand-written *instead* of generated by it.
Plan §38 forbids introducing infrastructure without evidence it is needed, and a dependency that is
unused *and* vulnerable fails that test twice over. It can be re-added at a patched version if
migration generation later earns its place.

**What this demonstrates.** The dependency scan had been passing for two phases and started failing
the moment a transitively-vulnerable package entered the tree. The gate did its job on its first
real opportunity — which is the argument for running it on every push rather than before releases.

---

## 3. Tenant isolation

Layered, because cross-tenant disclosure is the highest-severity failure this system can produce and
a single forgotten `where` clause must not be sufficient to cause it.

| Layer | Mechanism | Verified by |
|---|---|---|
| Type system | `TenantScope` is a required argument; a query without tenant context is a compile error | `tenancy.test.ts` |
| Application | `assertBelongsTo` re-checks every fetched row against the caller's scope | `tenancy.test.ts` (14 entity types) |
| Application | `filterToTenant` reports removed rows rather than filtering silently, so a leaking query is alertable | `tenancy.test.ts` |
| Database | Row-level security with `FORCE`, under a non-superuser role | `database-isolation.test.ts` |

### Cross-tenant responses answer 404, never 403

A 403 confirms that the resource exists and belongs to someone else. Existence is tenant data, so a
403 *is* the disclosure. The `TENANT_ISOLATION` error category maps to 404, and tests assert the
response is byte-identical to a genuine miss — same status, same message — so ids cannot be
enumerated by comparing replies. The owning organisation appears only in `details`, which
`toWireFormat()` omits entirely and the logger redacts.

`TENANT_ISOLATION` is a distinct category from `AUTHORIZATION` precisely so it can be alerted on
separately: a tenant-boundary breach is a security incident, not a permission miss.

---

## 4. Authorisation

Full matrix: `docs/PERMISSIONS_MATRIX.md` — **generated from `packages/db/src/rbac.ts`**, with CI
failing on drift. A hand-maintained authorisation matrix drifts, and a drifted security document
tells a reviewer the system behaves one way while it behaves another.

- **Deny by default.** A permission added to the enum but forgotten in the matrix is denied.
- **Union of organisation and project grants**, not a maximum of two independent answers.
- **Separation of duties encoded as data:** ENGINEER cannot approve; APPROVER cannot edit what they
  approve; `gate:override` belongs to no project role.
- **Guests hold a narrow, non-role permission set** covering the trial journey only — notably no
  evidence upload, which would open a malware surface with no accountable owner before signup.

---

## 5. Audit immutability

`audit_events` is append-only, enforced by `BEFORE UPDATE` and `BEFORE DELETE` triggers that raise
`insufficient_privilege`. Enforced by trigger rather than convention: "we never call UPDATE on it" is
a promise, and an audit trail the application can edit is not an audit trail.

Organisations with audit history cannot be deleted (`ON DELETE RESTRICT`) — cascading would erase the
trail as a side effect of routine administration.

Verified by tests that attempt both operations and assert the trigger's own message on the error
cause chain. A bare `rejects.toThrow()` would also pass if the statement failed for an unrelated
reason, so the assertion names the specific cause.

---

## 6. Transport and content security

| Control | Value | Verified by |
|---|---|---|
| CSP | Per-request nonce; `script-src 'self' 'nonce-…'`, no `unsafe-inline`, no `unsafe-eval` in production | `e2e/security-headers.spec.ts` |
| CSP — CDN | Policy names no CDN host; the page fetches nothing off-origin | `e2e/security-headers.spec.ts` |
| `upgrade-insecure-requests` | Emitted for real hosts, omitted on loopback | `e2e/security-headers.spec.ts` |
| HSTS | `max-age=63072000; includeSubDomains; preload` | `e2e/security-headers.spec.ts` |
| `X-Frame-Options` / `frame-ancestors` | `DENY` / `'none'` | `e2e/security-headers.spec.ts` |
| `X-Content-Type-Options` | `nosniff` | `e2e/security-headers.spec.ts` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | `e2e/security-headers.spec.ts` |
| `Permissions-Policy` | camera, microphone, geolocation denied | `e2e/security-headers.spec.ts` |
| `X-Powered-By` | absent — version disclosure hands an attacker a CVE shortlist | `e2e/security-headers.spec.ts` |

`'unsafe-inline'` was explicitly rejected for `script-src` rather than adopted as a quick fix for
Next's inline bootstrap scripts. The platform hosts user-authored rich text (plan §17), which
gap-spec §34 names as a stored-XSS surface; `'unsafe-inline'` disables exactly the protection that
surface depends on. `style-src` retains it (KI-016) because Next injects styles without a nonce and
styles cannot execute script — a materially smaller exposure, recorded rather than glossed.

---

## 7. Secrets and logging

- **Redaction is applied by the logger**, not by call sites. A convention every caller must remember
  is one that will eventually be forgotten, and the failure is silent, permanent (logs are shipped
  and retained) and usually found during a breach review. 56 tests cover key-name matching, value-
  shape matching, error messages, cause chains, and secrets interpolated into log messages.
- **Secret scanner** runs in CI over the working tree. Verified by planting five credential types
  (AWS key id, GitHub PAT, Postgres DSN, Anthropic key, Google API key) and confirming all five are
  caught, with locations reported but values never echoed into CI logs.
- **Scope limit, stated plainly:** the scanner checks the working tree, not git history. A secret
  that was committed and later removed still lives in history and requires rotation plus history
  rewriting. The scanner cannot do that and does not pretend to.
- **Environment validation never quotes a value.** A malformed `DATABASE_URL` would print its
  password into startup logs, so errors name the variable only.

---

## 8. Error handling

- `safeMessage` (user-facing) is structurally separate from `details` (diagnostic). `toWireFormat()`
  emits only code, category, message, correlation id and retry hint — never details, cause or stack.
- An unknown throw is never promoted to a user-facing message: it could embed a connection string or
  a token from a third-party library.
- `AppError.message` carries the safe message, so an accidental `String(err)` cannot leak.

---

## 9. Test performance note (non-security, recorded here because it protects the suite)

The database suite originally created a fresh PGlite instance per test — the most obviously-isolated
arrangement. At ~1.5s per instance, 33 tests took 50 seconds, which extrapolates to roughly fifteen
minutes of CI at the 600-test target.

A slow security suite is a security risk in its own right: suites that hurt get run less often, get
excluded from pre-commit hooks, and eventually get marked `skip` under deadline pressure.

Replaced with one instance per test file and `TRUNCATE … RESTART IDENTITY CASCADE` between tests.
Identical isolation guarantee — every table emptied, nothing survives into the next test — at
**3.7 seconds instead of 50**. Tables are enumerated explicitly rather than discovered, so a new
table nobody adds to the reset list shows up as state leaking between tests.

---

## 10. Open items

| Item | Phase | Note |
|---|---|---|
| Threat model (`docs/THREAT_MODEL.md`) | 3–4 | Gap-spec §34 requires it before production |
| Rate limiting | 4 | Guest project creation, auth, AI import, upload, export |
| File upload security | 13 | MIME allowlist, extension/MIME consistency, randomised keys, signed URLs, hashing |
| Stored-XSS sanitisation for documents | 13 | The highest-risk content surface |
| SSRF controls on integration URLs | 17 | |
| Authorisation attack suite | 18 | Gap-spec §65 — BOLA, privilege escalation, IDOR, mass assignment |
| Non-superuser DB role in deployment config | 19 | Arising from SEC-001; pre-live checklist item |
| Rollback and restore drills | 18–19 | |
