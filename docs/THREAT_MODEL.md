# THREAT MODEL

> **Generated file — do not edit by hand.**
> Source of truth: `packages/release/src/security.ts`.
> Regenerate with `pnpm docs:threats`. CI runs `pnpm docs:threats --check`.

**Contract:** `IMPLEMENTATION_GAP_CLOSURE_SPEC.md` §34, which requires a threat model before
production and names the 19 threats below.

---

## Why this is generated

A threat model written as prose starts decaying the day it is written, and nothing notices, because
prose does not fail a build. This one is held in code: each threat carries its mitigations, the tests
that demonstrate them, and its residual risk. A threat with **no recorded verification** appears in
the release report as a gap rather than being assumed handled, and the security gate reads the same
data this document is generated from.

## What it does not claim

4 of 19 threats have no recorded verification: malicious uploaded evidence, webhook forgery, queue poisoning, data export abuse. Most are mitigated by a feature not existing yet, which is a real mitigation and a fragile one — adding the feature reintroduces the threat in full.

A threat model that claimed complete coverage would be the least believable kind. Every entry states
a residual risk, and those statements are the part worth arguing with.

---

## Threats

### Guest session abuse

**Attacker goal.** Create unlimited guest projects, or resurrect an expired guest session to reach data left behind in it.

**Mitigations**

- Guest sessions are opaque, signed and expiring; the cookie carries no identifier that can be guessed or enumerated.
- Guest project creation is rate-limited per session and per address (§36).
- Guest data expires on a stated schedule rather than accumulating indefinitely (§5.3).

**How we know**

- e2e/guest-intake.spec.ts — a different session cannot open the project
- apps/web/test/server/signed-cookie.test.ts — a tampered, unsigned or truncated cookie is refused
- packages/db/test/guest.test.ts — an expired session resolves to nothing

**Residual risk.** A guest who keeps their own cookie retains access for the session lifetime. That is the feature; the limit is the lifetime.

---

### Account takeover

**Attacker goal.** Sign in as somebody else, by guessing, replaying or intercepting their credentials.

**Mitigations**

- Authentication is delegated to an OIDC provider; this platform never holds a password.
- ID tokens are verified for signature, issuer, audience, expiry and nonce together — the four checks whose independent omission are each a published bypass.
- PKCE (S256), a per-request state and a per-request nonce defend the code exchange, the callback and replay respectively.
- Sessions are revoked server-side on sign-out, carry an idle and an absolute timeout, and end immediately when the account is locked.
- Sign-in and callback are rate-limited (§36).

**How we know**

- apps/web/test/server/oidc.test.ts — tokens signed by an unpublished key, from another issuer, for another application, expired, replayed, or carrying no nonce are each refused
- packages/db/test/session.test.ts — the idle window never rolls past the absolute expiry
- e2e/security-headers.spec.ts

**Residual risk.** A compromised identity provider account compromises this one. That is the trade for not holding passwords, and it is the right trade, but it is not zero.

---

### Cross-tenant access

**Attacker goal.** Read or change another organisation’s data.

**Mitigations**

- Row-level security with FORCE ROW LEVEL SECURITY, under a NOSUPERUSER application role (SEC-001).
- Every query runs inside a tenant context set from the session, never from a request parameter.

**How we know**

- packages/db tenant isolation tests
- e2e/budget.spec.ts and e2e/trace.spec.ts — a second guest receives 404

**Residual risk.** RLS protects the database. A defect in code that legitimately runs with a tenant context set is not caught by it.

---

### Insecure direct object reference

**Attacker goal.** Reach an object by supplying its identifier, without being entitled to it.

**Mitigations**

- Ownership is checked before permission, and a failure returns 404 rather than 403 — a 403 confirms the object exists.
- Identifiers are UUIDs, so they cannot be enumerated by counting.

**How we know**

- e2e/work.spec.ts — an unknown id is indistinguishable from a forbidden one
- e2e/budget.spec.ts — a second guest’s form rewrite is refused

**Residual risk.** A UUID that leaks through a shared link or a log is a valid identifier for anyone holding it.

---

### Privilege escalation

**Attacker goal.** Act with a role you do not hold.

**Mitigations**

- Permissions are a deny-by-default allowlist; a permission absent from the matrix is refused rather than inherited.
- Role is resolved server-side per request and never read from the client.

**How we know**

- packages/auth permission matrix tests
- docs/PERMISSIONS_MATRIX.md is generated

**Residual risk.** A role granted in error by an administrator is indistinguishable from an intended one.

---

### Malicious imported AI JSON

**Attacker goal.** Get invalid or hostile structure into the Project Digital Twin through the interchange.

**Mitigations**

- The interchange is treated as a security boundary: size limits, depth limits, schema validation, then semantic validation, before anything is written.
- AI output carries EXTERNAL_AI_INFERENCE provenance, which loses to every user-confirmed fact.
- Nothing is applied without explicit user acceptance.

**How we know**

- packages/interchange validation tests
- e2e/ai-import.spec.ts

**Residual risk.** A well-formed but wrong import that a user accepts becomes project data. The provenance record is what makes it traceable afterwards.

---

### Malicious uploaded evidence

**Attacker goal.** Store a file that harms whoever later downloads it, or that executes where it is stored.

**Mitigations**

- Size limit, MIME allowlist, and an extension/MIME consistency check (§35).
- Randomised storage keys; no user-controlled object path; no public bucket.
- Downloads are served with Content-Disposition set so nothing renders in place.

**How we know**

> **Not verified.** The mitigation above is believed rather than demonstrated. This appears
> in the release report as a gap rather than being assumed handled.

**Residual risk.** Not yet implemented — upload is out of scope until the evidence surface exists. Recorded here so it is a known gap rather than an oversight.

---

### Stored cross-site scripting in documents

**Attacker goal.** Persist markup that executes in another user’s browser.

**Mitigations**

- All user text is rendered as text; there is no HTML-injection path in the rendering layer.
- A Content-Security-Policy without unsafe-inline means an injected script has nothing to run under.

**How we know**

- e2e/security-headers.spec.ts — CSP is present and strict

**Residual risk.** A future rich-text or document-preview feature would reopen this and needs its own review.

---

### Injection

**Attacker goal.** Get input interpreted as code — SQL, shell, or template.

**Mitigations**

- All database access goes through parameterised queries; no string-built SQL.
- No user input reaches a shell.

**How we know**

- packages/db query tests

**Residual risk.** Dynamic identifiers in DDL are the exception, and they come from code rather than from users.

---

### Server-side request forgery through integrations

**Attacker goal.** Make the server fetch a URL an attacker chooses, reaching internal services.

**Mitigations**

- V1 makes no outbound requests on behalf of users; the AI interchange is paste-based precisely so there is no fetch.

**How we know**

- e2e/security-headers.spec.ts — the landing page loads no third-party resources

**Residual risk.** Any future integration that fetches a user-supplied URL reintroduces this in full and needs an allowlist before it ships.

---

### Webhook forgery

**Attacker goal.** Send a request that the platform believes came from a trusted system.

**Mitigations**

- No inbound webhooks in V1.

**How we know**

> **Not verified.** The mitigation above is believed rather than demonstrated. This appears
> in the release report as a gap rather than being assumed handled.

**Residual risk.** Not applicable yet. Recorded so that adding webhooks is visibly a security change.

---

### Queue poisoning

**Attacker goal.** Enqueue work that crashes the worker or runs with unintended authority.

**Mitigations**

- No background queue in V1; all work is request-scoped.

**How we know**

> **Not verified.** The mitigation above is believed rather than demonstrated. This appears
> in the release report as a gap rather than being assumed handled.

**Residual risk.** Not applicable yet, and the same note applies as for webhooks.

---

### Replay

**Attacker goal.** Repeat a captured request to duplicate its effect.

**Mitigations**

- State-changing requests are POSTs with an origin check and a same-site cookie.
- Idempotency keys on operations where repetition would be harmful (§48).

**How we know**

- e2e/security-headers.spec.ts

**Residual risk.** Idempotency is not yet applied to every mutation; the ones that exist are the ones that needed it.

---

### Data export abuse

**Attacker goal.** Use the export feature to extract more than the exporter is entitled to, or to extract repeatedly.

**Mitigations**

- Export is tenant-scoped by the same context as every read, and rate-limited (§36).

**How we know**

> **Not verified.** The mitigation above is believed rather than demonstrated. This appears
> in the release report as a gap rather than being assumed handled.

**Residual risk.** Export is not implemented yet. A legitimate exporter can still take everything they can read; that is what export means.

---

### Audit log tampering

**Attacker goal.** Remove or alter the record of what was done.

**Mitigations**

- Audit rows are append-only: no update or delete grant exists for the application role (§40).

**How we know**

- packages/db audit immutability tests

**Residual risk.** A database superuser can still alter anything. Defence against that is operational, not application-level, and pretending otherwise would be the more dangerous claim.

---

### Prompt data leakage

**Attacker goal.** Get sensitive project data into an external AI prompt where it leaves the tenant.

**Mitigations**

- The prompt package is shown to the user in full before it leaves; nothing is sent automatically.
- A copy-safety screen names what the package contains (§11.3).

**How we know**

- e2e/ai-import.spec.ts
- packages/interchange prompt tests

**Residual risk.** A user who pastes the package into a provider has sent it to that provider. The control is that they can see exactly what they are sending.

---

### Sensitive log leakage

**Attacker goal.** Read secrets or personal data out of logs.

**Mitigations**

- The logger redacts by key and by pattern before writing (§54).
- A secret scan runs in CI over the whole repository.

**How we know**

- packages/shared logging redaction tests
- scripts/scan-secrets.mjs — verified against five planted credential types

**Residual risk.** Redaction is a denylist over known shapes. A secret in an unrecognised shape passes it.

---

### Denial of service

**Attacker goal.** Make the platform unavailable, cheaply.

**Mitigations**

- Tiered rate limits on the expensive endpoints: auth, project creation, import validation, upload, search, export, graph analysis (§36).
- Graph analysis is bounded: cycle detection is iterative and node scale classes cap traversal (§26.1).

**How we know**

- packages/twin graph tests — cycle detection on large graphs

**Residual risk.** Volumetric attacks are handled at the edge, not here. That is a deployment concern and it is recorded as one rather than claimed as solved.

---

### Dependency compromise

**Attacker goal.** Reach the platform through something it installs.

**Mitigations**

- A lockfile with exact versions; `pnpm audit` at moderate and above runs in CI.
- No postinstall scripts are permitted for new dependencies without review.

**How we know**

- pnpm audit:deps in the gate

**Residual risk.** An audit only knows about published advisories. A compromised package nobody has reported yet passes cleanly, and no amount of scanning changes that.

---

## Findings

Findings discovered against these threats are recorded with a severity, a state, and a source.

**Severities:** `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, `INFORMATIONAL`

`INFORMATIONAL` is retained rather than tidied away. Informational findings are frequently the first
half of a chain — an information disclosure harmless alone, and the reconnaissance step for something
that is not.

**States:** `OPEN`, `IN_PROGRESS`, `RESOLVED`, `ACCEPTED`, `FALSE_POSITIVE`

`ACCEPTED` and `FALSE_POSITIVE` are deliberately distinct. "It is real and we are shipping anyway"
and "we looked and it is not real" are different claims, they age differently, and only one needs
revisiting when the system changes around it. Both require a rationale and a named decider; without
those the two become the same button.

**Sources:** `DEPENDENCY_SCAN`, `SECRET_SCAN`, `STATIC_ANALYSIS`, `PENETRATION_TEST`, `CODE_REVIEW`, `THREAT_MODEL`, `INCIDENT`, `EXTERNAL_REPORT`

### What blocks a release

Critical and high findings block while open or in progress. "In progress" at a release gate is a
decision made by omission, so it counts as outstanding.

Medium and below do not block. That is a policy statement rather than a fact about severity, and it
lives in one function so a project with a different risk appetite changes it once.

---

## Production verification

§15.9 requires 10 checks against the running system:
`AVAILABILITY`, `TLS`, `SECURITY_HEADERS`, `CRITICAL_JOURNEYS`, `AUTHENTICATION`, `APIS`, `MONITORING`, `LOGGING`, `BACKUP_RESTORE`, `DEPLOYMENT_IDENTITY`.

**This platform cannot observe production.** It records what somebody checked and what they kept. An
unrecorded check is therefore `NOT_CHECKED`, and the gate returns **indeterminate** rather than
passed.

That distinction is the most consequential default in the codebase. Software that reports its own
production as healthy because nobody entered a failure is making the single most damaging false claim
available to it — and this is the record people go back to after something has gone wrong.

Equally, a check that ran and failed is **failed**, not indeterminate. If the two read the same, a
release record cannot distinguish "we looked and it is broken" from "nobody looked", and the second
gets quietly treated as the first.
