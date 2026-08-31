# ADR-0002 — Stack selection and infrastructure adaptation for a Docker-less machine

- **Status:** Accepted
- **Date:** 2026-08-31
- **Phase:** 0
- **Related:** ADR-0001 (greenfield baseline), `docs/audit/ENVIRONMENT_AUDIT.md`, `docs/REPOSITORY_REALITY.md`

---

## Context

`MASTER_IMPLEMENTATION_PLAN.md` §3.2 recommends a stack: Next.js App Router · React · TypeScript ·
Tailwind · **PostgreSQL** · **Redis + BullMQ** for jobs · **S3-compatible** object storage · OIDC auth ·
transactional outbox eventing.

ADR-0001 established there is no existing stack to inventory, so gap-spec §2.2's "version inventory"
becomes a decision record. Two environment facts constrain it, both verified rather than assumed:

1. **Docker is not installed and no daemon is available.** There is no local container runtime.
2. **C: has ~10.9 GB free** (E: has ~47.7 GB). Disk headroom is limited on the system drive.

Available and verified: Node v22.23.2, pnpm 11.22.0, npm 10.9.4, git 2.50.0, GitHub CLI 2.97.0
(authenticated), all Playwright browsers already installed, 16 CPU cores, 23.7 GB RAM, npm registry
reachable.

Two sibling projects on this machine (`E:\Project\plan`, `E:\Project\qa`) run pnpm workspaces on
Node ≥22 with TypeScript, Vitest and Playwright, and are deployed to production. They are read-only
evidence of what already works on this hardware.

## Problem

Docker's absence breaks the two infrastructure recommendations that assume a local daemon:

- **PostgreSQL** — the conventional local setup is a Postgres container. Without Docker there is no
  local Postgres.
- **Redis + BullMQ** — BullMQ requires Redis. Without Docker there is no local Redis.

Gap-spec §82 anticipates exactly this and forbids assuming otherwise: the agent *"must not assume …
database already exists … Redis is required if queue design changes"*. Plan §38 adds: *"never introduce
major infrastructure without evidence it is needed."*

The naive fallback — SQLite locally, Postgres in production — is **rejected outright**. This system
depends on Postgres-specific behaviour that SQLite cannot emulate: row-level security (plan §3.2 requires
RLS as defence-in-depth), `SERIALIZABLE`/`REPEATABLE READ` semantics for the atomic change-request
transaction (gap-spec §28), recursive CTEs for dependency traversal and impact propagation (plan §15),
full-text search (plan §3.2 search), `jsonb`, and real check/exclusion constraints. Divergent dev and
production databases would mean the tenant-isolation and transaction tests — the highest-value tests in
the suite — prove nothing about production.

## Decision

**Keep PostgreSQL. Change how it is obtained locally. Replace Redis with Postgres.**

### 1. Database — PostgreSQL everywhere, via PGlite locally

| Environment | Postgres provider |
|---|---|
| Local dev | **PGlite** (`@electric-sql/pglite` 0.5.8) — real Postgres compiled to WASM, runs in Node, ~3.7 MB, no daemon |
| Test | PGlite, one fresh in-memory instance per test file |
| Preview / staging / production | Managed PostgreSQL over the wire (`pg` 8.23.0) |

PGlite is not a Postgres emulator — it is the actual Postgres engine built to WebAssembly. SQL semantics,
transaction isolation, recursive CTEs, `jsonb`, constraints and RLS behave as in production, so the same
migrations and the same queries run in all environments.

It also solves a testing problem the plan creates: 600+ tests including ~50 tenant-isolation tests need
strong isolation between cases. A fresh in-memory PGlite instance per test file is faster than truncating
a shared server database and cannot leak state between files.

**Accepted limitation:** PGlite is single-connection and single-process. It cannot exercise connection
pooling, concurrent-writer contention, or lock behaviour under parallel load. Those are genuinely
different in production. **Mitigation:** concurrency-sensitive tests — optimistic-concurrency conflicts
(gap-spec §49), idempotency under double-submit (§48), the atomic change transaction (§28) — must also
run against a real networked Postgres in CI before the staging gate. Recorded as a Phase-1 CI
requirement, not left implicit.

### 2. Jobs — pg-boss on Postgres, not Redis + BullMQ

**`pg-boss` 12.29.0** replaces Redis + BullMQ. It is a job queue built on Postgres.

Rationale beyond Docker's absence:

- **The outbox becomes trivially correct.** Gap-spec §47 requires material domain changes to write outbox
  entries *inside the same DB transaction*. With the queue in Postgres, enqueue and domain write share
  one transaction — no dual-write, no lost-update window between committing a change and enqueuing its
  side effect. With Redis this requires a separate outbox table plus a relay process to stay correct.
- **One fewer production dependency**, one fewer failure mode, one fewer thing to back up and secure.
- pg-boss natively provides the job semantics gap-spec §46 demands: retries with backoff, attempt counts,
  dead-lettering, scheduling, singleton/throttled jobs.

Plan §22's actual requirements — idempotent, retryable, observable, tenant-scoped, correlation-linked,
dead-lettered — are properties of *our* job layer, not of Redis. All are satisfied.

Reconsider Redis only on evidence: sustained throughput Postgres cannot absorb, or a need for queue
primitives pg-boss lacks. Per plan §38, not before.

### 3. Object storage — interface first, provider later

Evidence storage (gap-spec §32, §35) needs hashes, signed URLs, randomised keys and encryption at rest.
V1 defines an `ObjectStore` interface with a local filesystem adapter for dev/test and an S3-compatible
adapter for deployed environments. The concrete provider is chosen at Phase 11 when deployment target is
settled — deciding now would be guessing.

### 4. Application stack

| Concern | Choice | Version | Basis |
|---|---|---|---|
| Runtime | Node.js | 22.23.2 | Installed and verified; both siblings require ≥22 |
| Package manager | pnpm | 11.22.0 | Installed; pinned by both siblings; shared store on E: (952 MB) conserves scarce C: space |
| Framework | Next.js App Router | 16.3.3 | Plan §3.2; current `latest`; sibling `plan` runs this exact version in production |
| UI | React | 19.2.8 | Current `latest`; required by Next 16 |
| Language | TypeScript | **5.9.x** | See §"TypeScript 7" below |
| Styling | Tailwind CSS | 4.3.3 | Plan §3.2; sibling `qa` runs Tailwind 4 in production. **Note:** v4 is CSS-first (`@theme`), so tokens port to CSS variables, not `tailwind.config.js` |
| ORM / migrations | Drizzle ORM + drizzle-kit | 0.45.2 / 0.31.10 | SQL-first migrations under version control (plan §3.2, gap-spec §50); one driver story across PGlite and `pg`; does not obscure RLS |
| Validation | Zod | 4.5.4 | AI interchange JSON Schema (plan §11), env validation, API contracts |
| Unit/integration tests | Vitest | 4.1.11 | Current `latest`; proven in both siblings |
| E2E / a11y | Playwright | 1.62.1 | Current `latest`; **browsers already installed** — no download against limited C: space |
| Jobs | pg-boss | 12.29.0 | §2 above |
| Local Postgres | PGlite | 0.5.8 | §1 above |
| Prod Postgres driver | pg | 8.23.0 | Standard |

**TypeScript 7 (`latest` = 7.0.2) is deliberately not adopted in Phase 1.** It is the Go-based compiler
rewrite. The evidence available on this machine — two production-deployed projects — both pin ^5.9.2, and
the surrounding toolchain (ESLint TS plugins, Next's type layer, Drizzle's inference) has no verified
compatibility here. Choosing an unverified compiler for a codebase whose correctness argument rests on
strict typing trades a real risk for no delivered benefit. TS 7 adoption is a **Phase-1 evaluation task**
with a concrete decision point: if a spike typechecks the foundation cleanly, adopt it; otherwise stay on
5.9 and record why.

### 5. Repository structure — pnpm workspace, modular monolith

Plan §3.1 mandates a modular monolith. That constrains *deployment* (one deployable unit), not *source
layout*. A pnpm workspace with the domain split into packages gives:

- enforced boundaries — the rules engine cannot import from the web app
- the deterministic engines testable in a pure Node environment with no DOM and no framework
- a clean extraction path if a bounded context later justifies its own service

Proven on this machine: sibling `plan` runs exactly this shape (web app + 6 packages) in production.

Planned layout:

```
apps/web            Next.js App Router — UI + API routes
packages/domain     Digital Twin entities, invariants, lifecycle state machine
packages/rules      Deterministic rules engine + rule packs
packages/calc       Calculation, budget, capacity, estimation, forecast engines
packages/graph      Dependency graph, impact propagation, traceability
packages/interchange AI interchange schemas + the validation pipeline
packages/db         Drizzle schema, migrations, tenant-scoped repositories
packages/shared     Error taxonomy, correlation IDs, provenance types
```

Exact package boundaries are confirmed against the domain model in Phase 1; this is the starting shape,
not a frozen one.

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| SQLite locally, Postgres in production | Divergent semantics. RLS, recursive CTEs, isolation levels and FTS cannot be exercised locally, so the tenant-isolation and transaction tests would prove nothing about production. The single highest-risk shortcut available here. |
| Require the user to install Docker | Changes machine-wide tooling under a running session (forbidden by the operating rules), and PGlite makes it unnecessary. |
| Managed Postgres for local dev too | Every test run needs network; parallel test files contend on one database; slow, flaky, and unusable offline. |
| Redis + BullMQ via a managed Redis | Adds a production dependency and reintroduces the dual-write outbox problem that pg-boss eliminates. No evidence it is needed (plan §38). |
| Single-package app, no workspace | Nothing structurally prevents the UI importing domain internals or the rules engine depending on React. Boundary erosion is the main long-term risk to a modular monolith. |
| TypeScript 7 now | Unverified toolchain compatibility on this machine, against a codebase whose correctness argument depends on the type system. Deferred to a Phase-1 spike with a decision point. |

## Consequences

**Positive**

- Same Postgres engine in every environment; migrations and queries are portable by construction.
- No Docker, no Redis, no daemon — the whole stack runs from `pnpm install`.
- Transactional outbox is correct by construction rather than by careful coordination.
- Playwright browsers already present; nothing large downloads to the constrained C: drive.
- pnpm store lives on E:, conserving C:.

**Negative / accepted cost**

- PGlite cannot exercise connection pooling or concurrent-writer contention. **Mitigated** by requiring
  concurrency-sensitive suites to also run against networked Postgres in CI before the staging gate.
- Tailwind v4's CSS-first configuration means the extracted tokens port to `@theme` CSS variables rather
  than a JS config, so the export's `tailwind.config` blocks are a *reference*, not a file to copy.
- pg-boss puts queue load on the primary database. Acceptable at V1 scale; revisit on measured evidence.
- Staying on TypeScript 5.9 means a later migration to 7.

**Verification**

- Every version above was resolved from the live npm registry during this audit, not recalled.
- Node, pnpm and git versions were confirmed by direct invocation.
- The Phase-1 gate must show green install, build, lint, typecheck, test and dependency scan on this exact
  stack before Phase 1 closes (ADR-0001).
