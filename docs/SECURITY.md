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

## 2c. Finding SEC-003 - the tenant scope was safe only because the database had one connection

Found in Phase 19 while designing the Cloudflare deployment, before any deployment happened.

### What it was

`withTenant` established the tenant scope with `SET ROLE` and `set_config(..., false)`, cleaned up in
a `finally`.

The third argument to `set_config` is `is_local`. **`false` means session-scoped** - the setting
persists on the connection until something changes it. `SET ROLE` is session-scoped too.

The code was explicit that it knew this, and the comment is the finding:

> *The whole scope is serialised: `SET ROLE` and the tenant setting are connection state, so an
> interleaved request would run under another tenant's scope. **On a single-connection database that
> is not a theoretical risk.***

That sentence is exactly true of PGlite and exactly false of anything pooled. The `serialised()`
mutex - introduced for a completely different reason, PGlite having one connection (KI-013) - was
silently the thing making tenant isolation safe.

### Why it would not have been caught

Every isolation test passes under the old implementation. They run against PGlite, where a leaked
session setting has nowhere to leak *to*: one connection, one request at a time, cleanup always runs.

The suite proved the right property against the one environment in which the bug cannot reproduce.

### What it would have done

Behind Hyperdrive, a connection returns to the pool still carrying an organisation. The `finally`
narrows the window rather than closing it - a process that dies mid-request, or an isolate evicted
between the query and the reset, hands the next request a primed connection.

Row-level security would then apply that organisation **correctly**. Every query would return the
wrong tenant's rows, no error would be raised, and nothing in the system would report it.

### The fix

One shared `applyTenantScope`, called inside a transaction, with `SET LOCAL ROLE` and
`set_config(..., true)`.

Both are discarded when the transaction ends - whether it commits, rolls back, or the connection
dies. **There is no window and no cleanup to fail to run**, which is a stronger guarantee than a
shorter window.

Three further changes came with it:

- **One implementation, not two.** The test helper previously duplicated the production statements,
  so the isolation suite verified a *copy* of the mechanism. Both now call the same function.
- **The callback receives the transaction**, typed as such. Handing it the database would compile
  while letting a caller issue queries outside the scope, under the owner role, seeing everything.
- **Serialisation is now a PGlite concern only.** It no longer carries any isolation meaning, and the
  deployed path does not serialise.

### The regression tests

`packages/db/test/tenant-scope.test.ts` - eleven tests that attack the mechanism rather than the
outcome, because the outcome was already correct.

Two of them are deliberately tests *of Postgres*: one shows a session-scoped setting surviving its
transaction, one shows a transaction-scoped setting not surviving. They establish that the two forms
genuinely differ, so the rest is testing something real rather than a convention.

The load-bearing test asserts the scope leaves no residue **with no cleanup step present at all** -
if it passes, there is nothing for a pooled connection to carry.

Verified by reintroducing the defect: reverting `applyTenantScope` to the session-scoped form fails
four tests, including *"shows nothing at all once the scope has ended"* — which is the disclosure
itself, written as an assertion.

The abort test passes under *both* implementations, and that is worth stating rather than glossing:
Postgres rolls back a session-scoped `SET` when a transaction aborts, so the old code was safe on that
path. It was unsafe on the commit path, which is the ordinary one.

### Related: SEC-003b - Hyperdrive query caching

The same root cause one layer up. Hyperdrive caches on the query and its parameters, and under RLS
two tenants issue byte-identical queries while being entitled to different rows - the discriminating
input is connection state, not a parameter.

Caching is **disabled** for V1 (`--caching-disabled` at Hyperdrive creation). The data is small per
tenant and mutable, the benefit is marginal, and the failure mode is cross-tenant disclosure.
Recorded as a decision rather than left as a default nobody examined. See KI-050.

### Measured, not argued

Everything above was reasoning about a mechanism. On 2026-09-01 a real staging environment made it
an observation.

The pre-fix implementation was restored faithfully from commit `0fd0cac` and run against a Neon
PostgreSQL through a four-connection pool, with forty requests from two tenants interleaved:

    { "WRONG TENANT": 18, "correct": 20, "empty": 2 }

**Eighteen of forty requests returned another tenant's row.** The fixed implementation returns 40/40.

The two failure classes are counted separately on purpose. `empty` is a malfunction: somebody sees a
blank page and complains, and it gets fixed. `WRONG TENANT` is the disclosure, and nobody complains,
because the data that arrives looks entirely plausible to whoever receives it.

This is now a standing gate — `pnpm verify:isolation` (`scripts/verify-pooled-isolation.mjs`). It
refuses to run unless `APP_ENV=staging`, because it writes and removes rows and a check that merely
*asks* to be pointed at the right database eventually gets pointed at the wrong one.

It also settles what the PGlite suite could not. Those tests were thorough and structurally
incapable of failing: one connection, serialised behind a mutex, so a leaked scope had nowhere to
leak to. Passing tests were evidence of nothing, and there was no way to tell from inside them.

### Related: SEC-003c - the deployed database is not the development one

The same sentence a third time, and it cost two live defects on the first staging deployment.

Drizzle's PGlite adapter returns `{ rows: [...] }` from `execute()`. Its postgres-js adapter returns
the array itself. Both satisfy the declared return type, so reading `.rows` compiles against either
and is correct against only one - and every test in this project runs on PGlite.

The outbox drainer threw `TypeError` on every cron tick, leaving claimed rows unpublished; the schema
fingerprint check would have returned `null` for every deployed database, so the web Worker would have
refused to serve against a schema that was in fact correct. Neither could fail locally. See KI-052.

The general form is worth stating plainly: **a test suite that runs only against the development
database cannot see anything that differs about the deployed one**, and the differences are not
limited to performance. They include result shapes, privilege models and pooling behaviour - which is
to say, exactly the things security controls are built on.

### A Neon-specific privilege note

`neondb_owner` - the role the migration runs as and the role Hyperdrive connects as - has
**`rolbypassrls = true`**, confirmed by querying `pg_roles` on the staging branch.

So `FORCE ROW LEVEL SECURITY` does not constrain it, and `SET LOCAL ROLE govintel_app` is not defence
in depth on top of RLS: **it is the only thing that makes RLS apply at all.** A tenant-scoped query
that skipped the role switch would see every tenant's rows while every policy remained defined and
listed in the catalogue.

That is SEC-001 restated for a managed provider, and it is verified rather than assumed - the
isolation gate asserts `govintel_app` is neither a superuser nor a `BYPASSRLS` role, so a future
provider change or a mistaken `ALTER ROLE` fails a check instead of silently removing the control.

### The pattern

All of these are the same sentence: **state that lives on the connection is invisible to anything
that pools, caches, or substitutes for it** - and so are the assumptions a local database lets you
make. Worth carrying into any future work that introduces a layer between the application and the
database.

---

## 2d. Finding SEC-004 - a production credential in a build artefact

Found in Phase 19 by `pnpm scan:secrets`, before anything was committed.

`@opennextjs/cloudflare` inlines the resolved environment into
`.open-next/cloudflare/next-env.mjs`. With a Neon-linked `.env.local` present, that file contained a
live **production** `DATABASE_URL` - host, user and password - written in plain text as an exported
constant.

`.open-next/` was not in `.gitignore`. Thirty-four files were untracked but stageable, so a single
`git add -A` would have committed a production database credential to the repository.

**Resolved** by ignoring `.open-next/` and `.wrangler/`. Nothing reached the index or the history.

Two things are worth keeping from it.

The first is that the scanner found it only because of a change made hours earlier for an unrelated
reason. `neon link` had written a real DSN into `.env.local`, and the scanner - which walked the disk
using a hand-maintained skip list - failed the gate on a correctly-placed local credential. The fix
was to scan exactly the set of files git can see:

    git ls-files --cached --others --exclude-standard

That answers the question the scanner is actually asking, since its own failure message says *remove
it from the tree and history* and a gitignored file is in neither. It also has the property that
matters here: **a file is scanned precisely when it is not ignored.** `.open-next` was not ignored, so
it was in scope, so the credential was found. Under the previous design the directory would have had
to be added to a second hand-maintained list to be scanned - and nobody adds build output to a list
of things to scan.

The second is the general hazard, which is **not** resolved by the `.gitignore` entry: any build run
on a machine holding real credentials bakes them into an artefact. CI must never publish `.open-next`
as a build artefact, and build output must not be copied off a machine that has a populated
`.env.local`. See KI-054.

---

## 2e. Finding SEC-005 - four paths that were safe or correct only as the superuser

Found 2026-09-13 in the final completion pass; receipts FR-005, FR-006, FR-008 and W-SEC-3 in
`artifacts/test-evidence/FAILURE_RECEIPTS.md` and `docs/final-completion/COMPLETION_REGISTER.md`.

SEC-001's lesson — a superuser does not see row-level security — applied again, one level out. The
embedded development database connects as a superuser, so every local test, journey and development
request ran on the one path production never takes:

| Path | As superuser | As `govintel_app` under forced RLS |
|---|---|---|
| Sign-in (`completeSignIn`) | Worked | First sign-in threw on the membership insert (`WITH CHECK`); the guest conversion claimed no rows |
| Guest expiry sweep | Worked | Deleted audit events it could not see, then failed on their `RESTRICT` key — every run |
| Caller with no tenant (`withDatabase`) | **Returned every tenant's rows** (development only) | Returned nothing |
| `intake_answers`, `ai_imports` | No policy at all | No policy at all — tenant data guarded only by application checks |

**Fixes.** Sign-in runs each tenant-table step inside `applyTenantScope` and adopts the guest's
organisation instead of moving rows, because an `UPDATE` of `organization_id` cannot pass a
single-tenant policy for both the old and new row (`packages/db/src/sign-in.ts`). The sweep deletes
each guest in its own scoped transaction. A caller with no tenant runs as the restricted role with no
tenant set, locally too. Migration 003 gives the two tables a real key and forced RLS.

**Regression protection.** `packages/db/test/sign-in.test.ts` and the "as the restricted role" block in
`guest.test.ts` run whole flows under `SET ROLE govintel_app`; the pre-fix code fails them. The pooled
isolation gate re-ran 6/6 on staging after migration 003.

**The pattern.** A control verified only on a role that bypasses it has not been verified. New code
that touches tenant tables should have a test that connects as `govintel_app`.

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

## 9b. The external-AI interchange as a security boundary

**Contract:** plan §11; gap-spec §11.3, §12.1–§12.3. Phase 5.

The interchange is the only place in the product where data deliberately leaves the tenant boundary,
and the only place where content of entirely unknown provenance is invited back in. Both directions
are treated as hostile.

### 9b.1 What actually crosses the boundary

Nothing is sent by the platform. The user copies a prompt and pastes a reply — which means the
platform cannot be compromised by a malicious *provider*, only by malicious *content*. It also means
there is no API key to leak and no paid dependency, which is a locked product requirement (plan §2.3)
rather than a cost decision.

Outbound, `packages/interchange/src/redaction.ts` runs nine detectors over everything destined for
the prompt. Anything classified `RESTRICTED` is redacted unconditionally; the rest is counted and
shown. The copy-safety screen (gap-spec §11.3) states what is included, what was removed and what was
flagged **before** the copy button, never after — an E2E test asserts that DOM ordering structurally,
so a reword cannot silently invert it. Nothing can be un-pasted.

### 9b.2 Untrusted input never reaches the canonical project

An import is written verbatim to `ai_imports` and stays there. It is parsed, validated and previewed
from that staging row, and only an explicit user decision moves it forward. The guarantee that
untrusted content cannot mutate the project rests on three independent locks, deliberately not one:

1. **The state machine** (`staging.ts`) has no `RAW → MATERIALIZED` edge. Every path to
   materialisation passes through `VALIDATED`.
2. **The application** refuses to accept an import whose stored validation does not set
   `canMaterialize`.
3. **The database** refuses the row outright:
   `CHECK (state NOT IN ('ACCEPTED','MATERIALIZED') OR validation IS NOT NULL)`.

The third lock exists because the first two are application code, and application code has bugs.

### 9b.3 What the AI is structurally unable to claim

`aiProvenanceSchema` admits exactly three values: `EXTERNAL_SOURCE`, `EXTERNAL_AI_INFERENCE` and
`ASSUMPTION`. `USER_CONFIRMED` and `DETERMINISTIC_CALCULATION` are **not representable** in the
interchange schema, so a response asserting one is rejected at the shape layer rather than judged on
its merits later.

This matters more than it first appears. The entire trust ordering in `packages/shared/provenance.ts`
depends on `USER_CONFIRMED` (rank 100) meaning *a person said so*. An AI able to assert it could
overwrite anything in the project by claiming the user had already agreed. The schema, not a policy
check, is what prevents that.

A related consequence, which caught out a test before it caught out the code: an uncited AI inference
(rank 20) **cannot** overwrite a value the platform merely assumed (rank 30). That is correct — a
guess should not displace a considered default — and the test asserting otherwise was wrong, not the
implementation. The test was split: uncited inference conflicts; a cited `EXTERNAL_SOURCE` claim
(rank 50) wins.

### 9b.4 The fourteen validation layers, and the order they run in

`validate.ts` runs the layers of gap-spec §12.1 in a fixed order, and the order is load-bearing:

- **`PAYLOAD_SIZE` and `ENCODING` first**, before anything parses the content. A 512KB ceiling is
  enforced against the raw bytes, so an oversized or malformed payload is refused without ever being
  handed to the JSON parser.
- **`SCHEMA_VERSION` before `JSON_SCHEMA`.** A response written against a different contract must be
  reported as unsupported, not as a list of shape errors that invites the user to "fix" it.
- **`POLICY_SECURITY` early**, so injection-shaped content is refused before the more expensive
  semantic layers run on it.
- **`REFERENCE_INTEGRITY`** resolves `dependsOn` edges and detects cycles with an iterative walk. A
  recursive one is a stack-overflow denial of service on attacker-supplied graph depth.

The schema is `.strict()` throughout: an unknown property is a rejection, not a warning. A response
carrying fields this platform does not understand was written against something other than this
contract.

### 9b.5 Untrusted content in logs and in the DOM

`safeExcerpt` strips control characters and angle brackets from anything quoted back to the user or
written to a log. Both halves matter: a newline in a log line forges an entry, and angle brackets in
the DOM do the obvious. The import payload itself is **never** logged — only its id, status and issue
count — because the point of the airlock is that untrusted content does not spread beyond the staging
row.

Rendering is React text interpolation throughout. No import value reaches `dangerouslySetInnerHTML`,
and none is used to build a URL, class name or element id. An E2E test pastes a payload containing
`<img src=x onerror=...>` and `<script>` and asserts no script executed and no element was created.

### 9b.6 No hidden reasoning is requested or stored

The prompt explicitly instructs the model not to include chain-of-thought, and the schema has nowhere
to put it. What is stored is `rationale` (one or two sentences), `provenance`, `confidence`,
`sources` and `assumptions`. Retaining a model's internal deliberation would mean keeping a large
volume of unverified text of unclear provenance attached to a customer's project, for no benefit the
user can act on.

### 9b.7 Rate limiting

AI import validation is the most expensive operation an unauthenticated caller can trigger, and is
rate-limited accordingly (`ai-import`, gap-spec §36). The limiter's current weaknesses are KI-022.

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
| Materialisation of accepted imports into the Digital Twin | 6 | Acceptance currently records the decision and stops; the canonical entities do not exist yet |
| Real migrations, replacing the schema-fingerprint rebuild | 19 | KI-026 — the rebuild path destroys data and is refused in deployed environments |
