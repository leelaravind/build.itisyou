# CLOUDFLARE DEPLOYMENT ARCHITECTURE — PHASE 19

**Decision:** Cloudflare is the primary hosting platform. PostgreSQL is preserved as the system of
record. Object storage is R2. No D1.

**Contract:** `MASTER_IMPLEMENTATION_PLAN.md` Phases 19–20; `IMPLEMENTATION_GAP_CLOSURE_SPEC.md`
§7.5 (tenant isolation), §35 (upload security), §36 (rate limits), §46 (job semantics), §47 (outbox),
§51 (recovery), §52 (degraded mode).

Hand-written, like `MIGRATION_POLICY.md` and `DEPLOYMENT_RUNBOOK.md`. It describes decisions and
their reasons, not code, and generating it would make it look enforced when it is not.

---

## 0. Summary

| Concern | Choice | Cloudflare-native? |
|---|---|---|
| Application runtime | **Workers** via `@opennextjs/cloudflare` | yes |
| System of record | **External managed PostgreSQL** | no — by decision |
| DB connection pooling | **Hyperdrive** | yes |
| Object storage (evidence) | **R2** | yes |
| Background work | **Queues** + **Cron Triggers**, draining the outbox | yes |
| Durable multi-step orchestration | **not adopted for V1** | — |
| Rate limiting (§36) | **Cloudflare Rate Limiting rules** at the edge | yes |
| Session storage | **none needed** — signed stateless cookies | n/a |
| Cache / KV | **not needed for V1** | — |
| Identity (OIDC) | **external, still unchosen** | no |

**Minimum external services: two.** A managed PostgreSQL provider, and — when authentication ships —
an OIDC provider. Everything else is Cloudflare-native or unnecessary.

---

## 1. Runtime: Workers, not Pages

The user framing said "Pages/Workers where compatible". The answer is **Workers**, and the distinction
matters enough to state.

This application is Next.js 16 App Router, and the production build reports **every route as
`ƒ (Dynamic) — server-rendered on demand`**. There is no static surface to put on Pages. It uses
server components and server actions throughout — the intake wizard, plan generation, and the AI
import flow are all server actions.

`@opennextjs/cloudflare` builds a Next.js application into a Worker and is the supported path for
full App Router applications. The older `@cloudflare/next-on-pages` route targeted Pages Functions and
the Edge runtime, which does not support the Node APIs this codebase uses.

### What this requires from the code

**`nodejs_compat` must be enabled.** Three modules import Node builtins:

| Module | Import | Used for |
|---|---|---|
| `packages/db/src/client.ts` | `createHash` from `node:crypto` | The schema fingerprint (KI-026) |
| `packages/twin/src/versioning.ts` | `createHash` from `node:crypto` | Baseline checksums |
| `packages/shared/src/correlation.ts` | `randomUUID` from `node:crypto` | Correlation ids |

All three are satisfied by `nodejs_compat`. None needs rewriting, and rewriting them to WebCrypto
would change a synchronous call into an asynchronous one throughout the versioning and baseline code
for no benefit.

**PGlite never ships.** It is development-only and already guarded: `initialise()` throws when
`APP_ENV` is a deployed value, with a comment explaining that the failure would otherwise be silent.
That guard was written before this decision and it holds under it unchanged.

**CPU time is the limit to watch, not wall time.** The deterministic core is CPU-bound — the budget
page runs rule evaluation, decomposition, estimation, budget roll-up, feasibility and health on one
request. Measured at **under one second** locally for a fully planned project (`e2e/staging.spec.ts`).
That is comfortable, and the smoke test exists to notice if it stops being.

---

## 2. The blocking change: tenant context must become transaction-scoped

**This is the one item that must change before any deployment, and it is a security issue rather than
a compatibility one.**

`withTenant` in `apps/web/src/lib/server/database.ts` sets tenant context like this:

```ts
await db.execute(sql`SET ROLE ${sql.raw(APP_ROLE)}`);
await db.execute(sql`SELECT set_config('app.current_organization_id', ${organizationId}, false)`);
```

The third argument to `set_config` is `is_local`. **`false` means session-scoped**: the setting
persists on the connection until it is changed or the session ends. Same for `SET ROLE`.

The code knows this and says so:

> *The whole scope is serialised: `SET ROLE` and the tenant setting are connection state, so an
> interleaved request would run under another tenant's scope. **On a single-connection database that
> is not a theoretical risk.***

That last sentence is exactly true of PGlite and exactly false of Hyperdrive. Hyperdrive pools
connections; a connection carrying `app.current_organization_id` returns to the pool and is handed to
the next request. The `finally` block resets it, which narrows the window without closing it — a
process that dies mid-request, or an isolate evicted between the query and the reset, leaves a
connection primed with another tenant's identity.

Row-level security would then apply the wrong tenant, correctly, and every query would return the
wrong organisation's rows while every test still passed.

### The fix

Wrap the scope in an explicit transaction and make both settings transaction-local:

```ts
return db.transaction(async (tx) => {
  await tx.execute(sql`SET LOCAL ROLE ${sql.raw(APP_ROLE)}`);
  await tx.execute(sql`SELECT set_config('app.current_organization_id', ${organizationId}, true)`);
  return fn(tx);
});
```

`SET LOCAL` and `is_local = true` are discarded when the transaction ends, **whether it commits,
rolls back, or the connection dies**. There is no window, and no `finally` to fail to run. It is also
correct under transaction-mode poolers generally, so the choice of pooler stops being load-bearing.

The `serialised()` wrapper can then go: it exists solely because PGlite is single-connection (KI-013),
and keeping it against a pooled database would serialise every request in the isolate for no reason.

**A regression test must accompany this**, and the existing isolation suite is the wrong shape for it
— it runs against PGlite, where the bug cannot reproduce. The test needs two concurrent tenant scopes
on a pooled connection, asserting that neither observes the other's rows. Recorded as **KI-049**.

---

## 3. Data: external PostgreSQL behind Hyperdrive

PostgreSQL is preserved. D1 is not a substitute and was never a candidate:

- The schema depends on **row-level security** with `FORCE ROW LEVEL SECURITY` and a `NOSUPERUSER`
  application role (SEC-001). This is the primary tenant isolation control. D1 is SQLite and has no
  equivalent — isolation would move into application code, which is precisely the arrangement SEC-001
  exists to avoid.
- The DDL uses `jsonb`, `citext`-style constraints, dollar-quoted trigger bodies, and generated
  documentation derived from Postgres introspection.
- PGlite in development **is** Postgres — the same parser, the same constraint semantics, the same
  error messages. That is the property that makes development behaviour transfer, and swapping the
  production engine for a different one would discard it.

**Hyperdrive** sits between the Worker and the database. It provides connection pooling (Workers
cannot hold a connection pool across isolates) and caches read queries at the edge.

### Query caching must be disabled or scoped carefully

Hyperdrive's query cache is keyed on the query and its parameters. Under RLS, **two tenants can issue
byte-identical queries and be entitled to different rows** — the discriminating input is
`app.current_organization_id`, which is connection state rather than a query parameter.

For V1: **disable Hyperdrive query caching.** The application's data is small per tenant and mutable,
the caching benefit is marginal, and the failure mode is cross-tenant disclosure. Recorded as a
deliberate configuration decision rather than an oversight.

### Provider

Any managed PostgreSQL that Hyperdrive can reach. Neon is the natural default — serverless, scales to
zero, and explicitly supported by Hyperdrive — but nothing in the codebase names it, and it remains a
connection string.

---

## 4. Object storage: R2

Evidence artefacts (§32, §35). Not yet implemented — the evidence *model* exists, upload does not, and
the threat model records that honestly (`malicious-evidence-upload`, verification: none, residual
risk: *"Not yet implemented — recorded here so it is a known gap rather than an oversight."*).

R2 satisfies §35's requirements directly:

| §35 requirement | How |
|---|---|
| Size limit | Enforced in `checkUpload` before the object is written |
| MIME allowlist | `ALLOWED_MIME_TYPES` — deny-by-default, SVG deliberately absent |
| Extension/MIME consistency | `checkUpload` |
| Randomised storage key | Key is a generated id, never a filename |
| No direct public bucket | R2 buckets are private by default; no public bucket binding |
| Signed download URLs | R2 presigned URLs, short-lived |
| Content-Disposition safety | Set on the response, so nothing renders in place |
| No execution | R2 serves bytes; no execution surface |
| No user-controlled object path | Path derived from tenant and evidence id, never from input |
| Hash | Computed and stored; `verifyEvidence` compares against it |
| Tenant ownership | Key prefixed by organisation; access checked before signing |

R2's absence of egress fees also removes the incentive that makes teams cache evidence in places with
weaker access control.

---

## 5. Background work: Queues and Cron, not Redis

### The evaluation asked for

**There is no Redis or BullMQ in this codebase.** Verified: no dependency, no import, no configuration.
§46 (job semantics) and §47 (outbox) are *modelled* in `packages/resilience` and no worker is built.
The threat model states it plainly — *"No background queue in V1; all work is request-scoped."*

So this is not a migration decision with semantics to preserve. It is a greenfield choice, and that
changes the answer: **Cloudflare Queues can be adopted without changing application semantics, because
there are no queue semantics yet to change.**

### The design, which the outbox already dictates

§47 requires that side effects are recorded **inside the transaction that carries the domain change**.
Cloudflare Queues cannot participate in a Postgres transaction — but neither can Redis, SQS, or any
other broker. That is exactly why the outbox pattern exists, and `packages/resilience/src/outbox.ts`
already refuses to write an entry outside a transaction:

> *An outbox entry written outside the transaction that carries the change reintroduces the race it
> exists to remove. The change commits, the entry does not, and nothing fails — so nobody learns that
> a committed change had no consequences.*

The deployment shape follows from that, unchanged:

1. A request commits its domain change **and** its outbox rows in one Postgres transaction.
2. A **Cron Trigger** Worker runs on a schedule, calls `nextBatch()`, and publishes to **Queues**.
3. A **queue consumer** Worker performs the side effect, keyed by the entry's idempotency key.
4. Failures classify through `classify()` into retryable or terminal; Queues' own retry and
   dead-letter behaviour maps onto `FAILED_RETRYABLE` and `FAILED_TERMINAL` without translation.

At-least-once delivery is what Queues provides and what the outbox already assumes — which is why
every entry carries a mandatory idempotency key rather than trusting the consumer to be careful.

### Why not Workflows

Cloudflare Workflows is for durable, long-running, multi-step orchestration with checkpointing between
steps. Nothing in V1 is shaped like that: every outbox side effect is a single idempotent action
(notify an approver, recalculate derived values, mark evidence stale).

Adopting Workflows would add a programming model and a failure surface to solve a problem this system
does not have. If a genuinely multi-step durable process appears — a long backfill, a multi-party
approval with waits — Workflows is the right tool then. Recorded as **not adopted, with the condition
that would change it**, rather than left unmentioned.

### Why not Redis

The two things Redis would classically provide here are both already answered:

- **A queue.** Queues, above.
- **Rate limiting counters.** §6 below.

Adding Redis would mean a third external service, a second consistency model, and an operational
surface, in exchange for nothing this design needs.

---

## 6. Rate limiting: at the edge, not in the application

§36 requires rate limits on auth endpoints, guest project creation, AI import validation, file upload,
search, export, expensive graph analysis, login attempts and invites, with tiered limits that do not
block legitimate use.

**Cloudflare Rate Limiting rules** implement this at the edge, which is strictly better than the
application-level design §36 implies:

- A request rejected at the edge never reaches a Worker, so an attack costs nothing in compute.
- No shared counter store, and therefore no Redis.
- Per-path and per-method rules map directly onto §36's list.

The one thing that stays in the application is **per-session guest project creation**, because the
limit is per guest session rather than per address, and the session is a signed cookie the edge does
not interpret. That check belongs where the session is understood.

---

## 7. Sessions: nothing to store

Guest sessions are opaque signed cookies with no server-side state — recorded in the threat model
under `guest-session-abuse`. There is no session store to provide, so Workers KV and Durable Objects
are both unnecessary.

This is worth stating explicitly because "put sessions in KV" is the reflexive Cloudflare answer, and
adopting it here would add a consistency model (KV is eventually consistent) to solve a problem that
does not exist.

---

## 8. Minimum external services still required

**Two.**

### 1. Managed PostgreSQL — required now

The system of record. Non-negotiable given the RLS-based isolation model, and preserved by decision.

Reached through Hyperdrive. Any provider Hyperdrive can connect to; nothing in the codebase names one.

### 2. OIDC provider — required when authentication ships

Still deferred, and unchanged by this decision. The platform holds no passwords by design
(`account-takeover` in the threat model), so an external identity provider is required the moment
accounts exist. Guest-first means V1 functions without it.

Cloudflare Access could serve this for internal deployments; a public product needs a general IdP.
The interfaces remain provider-neutral either way.

### Explicitly *not* required

| Service | Why not |
|---|---|
| Redis | No queue semantics to preserve; Queues + Cron cover it, edge rate limiting covers the rest |
| S3 or equivalent | R2 |
| A search service | §41 says start with PostgreSQL search and this scale does not justify more |
| A session store | Sessions are stateless signed cookies |
| A cache | Hyperdrive caching is deliberately off; nothing else needs one at this scale |
| A secrets manager | Worker secrets |
| D1 | Would discard RLS, the primary isolation control |

---

## 9. What must change in the code

Deliberately short. The provider-neutrality held.

| # | Change | Why | Risk if skipped |
|---|---|---|---|
| 1 | **Transaction-scoped tenant context** (§2) | Session state does not survive pooling | **Cross-tenant disclosure** |
| 2 | Production Postgres adapter in `database.ts` | The deployed branch currently throws by design | No deployment |
| 3 | Remove `serialised()` on the deployed path | Exists only for PGlite's single connection | Every request serialised in the isolate |
| 4 | `@opennextjs/cloudflare` build + `wrangler.toml` | Build target | No deployment |
| 5 | `nodejs_compat` flag | Three `node:crypto` imports | Build failure |
| 6 | Hyperdrive query caching **off** | Cache key cannot see RLS tenant context | **Cross-tenant disclosure** |
| 7 | Cron Trigger + queue consumer Workers | Drains the outbox | Side effects recorded and never performed |

Items 1 and 6 are the two that are security issues rather than deployment tasks, and both come from
the same root cause: **connection-level state is invisible to anything that pools or caches above it.**

## 10. What does not change

The deterministic core, the twin, the rule engine, the calculation engines, traceability, governance,
change intelligence, closure and every generated document are untouched. None of them knows what a
database is — they take a graph and return a result, which is why the deployment decision arrived at
Phase 19 without needing a rewrite.

That was the point of deferring it, and it held.

---

## 11. As built, 2026-09-01

The design above was written before anything ran. This section records what was actually deployed and
what deploying it changed, because a design document that never gets marked up against reality is a
document nobody can trust the second time.

| Component | As designed | As built |
|---|---|---|
| Runtime | Workers via OpenNext | Unchanged. `govintel-web-staging` |
| Background work | A second Worker, Queues, Cron | Unchanged. `govintel-worker-staging`, cron `* * * * *` |
| Database | External PostgreSQL behind Hyperdrive | Neon `tiny-mode-81422275`, branch `staging`. Hyperdrive `fa38480586e44cebab20fe15ac2121a0`, **caching disabled** |
| Object storage | R2, private | `govintel-evidence-staging` |
| Minimum external services | Two | Confirmed: managed PostgreSQL now, an OIDC provider when auth ships |
| D1, Redis, BullMQ, Workflows | Not introduced | Not introduced |

### Four assumptions in this document that were wrong

The design survived contact largely intact. These four did not, and each is now recorded against the
section that asserted it.

**§3 said nothing in the application would know Cloudflare is there**, because Hyperdrive presents an
ordinary connection string. True of the *string* and false of how it arrives: Hyperdrive is an object
binding and cannot be copied into `process.env`. One module now names Cloudflare —
`connection-string.ts` — and nothing behind it does (KI-053, KI-056).

**§3 assumed a pooled handle held for the process**, which is how every previous deployment target
this project considered would work. A Worker may not use a socket opened by a different request, so
the deployed path opens a connection per operation. That is not a compromise: §3's own sentence is
*"Hyperdrive pools connections for a runtime that cannot hold a pool itself"*, and holding one anyway
was the contradiction (KI-057).

**§5 described the outbox as the mechanism for recording side effects.** The mechanism is built and
verified; no domain path emits into it. `outbox_events` held zero rows after 1,539 projects created
through the UI (KI-059).

**§9 listed what must change in the code** and was accurate as far as it went. It could not list the
three defects that only a running deployment exposes — a driver result shape, an environment
validation rule, and a connection lifetime — which between them accounted for every hour of the
deployment that was not spent waiting for a build.

---

## 12. What this document does not claim

Staging is deployed and verified. **Phase 20 is not evaluated, and the Phase-19 gate is green only
for staging.**

The ten §15.9 production checks remain `NOT_CHECKED`, and per the platform's own model that makes the
production verification gate **indeterminate, not passed**. Recording it otherwise here would be the
exact failure that gate was built to prevent.

RPO and RTO remain proposals (`DEPLOYMENT_RUNBOOK.md` §7). §51 says *"do not invent claims"*, and a
recovery target nobody has drilled is an invention.
