# IMPLEMENTATION KICKOFF REPORT

**Date:** 2026-08-31
**Required by:** `IMPLEMENTATION_GAP_CLOSURE_SPEC.md` §86 — the mandatory output after reading both plans
and before writing broad code.
**Phase-0 verdict:** **GREEN — proceed** (with the adaptation in ADR-0001).

The thirteen items below are the exact list §86 requires.

---

## 1. Repository findings

The repository is **greenfield**. Two contract documents, 50 Stitch design exports, one design-system
token spec, one local settings file. **Zero source files.** No manifest, lockfile, framework, CI,
database or deployment configuration. No git history — a repository was initialised during this audit so
that "small verified commits" and "last known-good state" (plan §38) are achievable at all.

Both plans are written on the premise that a codebase already exists. It does not. This is the single
largest reconciliation in Phase 0 and is handled in §4 below.

Two sibling directories share `E:\Project` and are **not** this project: `E:\Project\plan` is
`plan.itisyou.app`, a deployed financial-planning app, and `E:\Project\qa` is a third project. At audit
time `plan` had build artefacts written within the preceding ~20 minutes and 29 modified files — **another
Claude session is live in it.** Hard boundary recorded: this implementation writes only under
`E:\Project\build`.

Secret scan: **clean.** No credentials, no `.env`, no key material.

## 2. Design export findings

50 screens, each `code.html` + `screen.png`, plus `technical_precision_command/DESIGN.md`.

**Structurally sound.** All 50 parse, close their tags, and contain no lorem or placeholder text. There
are no broken exports at the file level.

**The colour system is fully consistent** — 47 tokens, identical values, present in all 50 files. A naive
hash suggests 34 different configs; that is only key ordering. Worth verifying rather than assuming in
either direction.

Thirteen defects were found and catalogued (KI-001…KI-013 in `docs/REPOSITORY_REALITY.md` §5). The ones
that change implementation:

- **`border-subtle` is referenced 67 times and defined nowhere.** Resolved to `outline-variant`.
- **The radius scale is shifted one step, and `rounded-full` is `0.75rem` — not a circle.** Resolved
  against the rendered PNG (avatars *are* rounded squares) plus `DESIGN.md` prose ("avoid … circular
  pills"). Canonical scale adopted, usages remapped, so visual output is unchanged.
- **No `warning`, `blocked`, `unknown`, `info` or `exception` colour exists** — yet Quality Gates has six
  states including BLOCKED and EXCEPTION, and `DESIGN.md` prose mandates amber and purple for them. Two of
  six gate states had no defined colour anywhere in the handoff. Derived, with contrast verification made
  a mandatory test.
- **Shadows, breakpoints, z-index, motion duration and easing are absent from every export.** Defined in
  `docs/DESIGN_HANDOFF_SPEC.md` §5.
- **EmptyState and Modal appear in zero exports.** `execution_board` literally carries the comment
  `<!-- Empty State visually implied by space -->`. Both must be designed net-new from the system.
- **Two exports carry off-domain fixture copy** — `recommendations_exceptions` ("Titanium Alloy",
  "Thermal Tolerance") and `change_request_center` ("high-tensile alloy", "grade steel"). Aerospace and
  manufacturing are explicitly **out of V1 scope** (gap-spec §4.3). Fixture copy is replaced with
  software-domain content; the layouts are unaffected.
- **Three different sidebar shells** across the exports, with inconsistent items and CTA labels.
  Reconciled into one shell with contextual sections.

Every export loads `cdn.tailwindcss.com` and Google Fonts **at runtime** — a direct CSP conflict
(plan §18). Resolved by construction: Tailwind compiles at build time and fonts are self-hosted.

**Screen coverage:** the plan locks 64 screens; 50 are exported. All 50 map 1:1 to a locked screen with
nothing orphaned. The 14 gaps cluster cleanly — 6 mid-intake/AI-import screens, Login, Preferences, and
the 6 mobile screens — and are **derived** from the established design system per gap-spec §3.5, never
invented. Full map in `docs/DESIGN_SCREEN_MAP.md`.

**Confirmed by the render:** the primary navigation in the exports is `Home · Plan · Execute · Control ·
Documents · Insights` — exactly what plan §2.4 specifies. The design and the plan agree.

## 3. Actual stack

Nothing pre-existed, so the stack is **chosen with recorded rationale** rather than discovered
(ADR-0001). Every version was resolved from the live registry or by direct invocation during this audit.

Node 22.23.2 · pnpm 11.22.0 · Next.js 16.3.3 · React 19.2.8 · TypeScript 5.9.x · Tailwind 4.3.3 ·
Drizzle 0.45.2 · PGlite 0.5.8 · pg 8.23.0 · pg-boss 12.29.0 · Zod 4.5.4 · Vitest 4.1.11 ·
Playwright 1.62.1. Structure: pnpm workspace, modular monolith. Full table and reasoning in ADR-0002.

## 4. Conflicts with the plan

| # | Conflict | Resolution |
|---|---|---|
| 1 | Plan assumes an existing codebase; none exists. Five Phase-0 gate criteria are undefined rather than pass/fail. | **ADR-0001** — split the gate by evaluability. The six criteria needing a codebase move to the Phase-1 gate, which the plan already defines as "green foundation pipeline". Nothing is dropped. |
| 2 | Plan §3.2 recommends Redis + BullMQ; **Docker is not installed**, so no local Redis. | **ADR-0002** — pg-boss on Postgres. Gap-spec §82 explicitly forbids assuming Redis is required. Bonus: the transactional outbox (gap-spec §47) becomes correct by construction, since enqueue and domain write share one transaction. |
| 3 | Plan §3.2 requires PostgreSQL; no Docker means no local Postgres. | **ADR-0002** — PGlite, real Postgres compiled to WASM, in dev and test; managed Postgres when deployed. SQLite was **rejected**: RLS, recursive CTEs and isolation levels cannot be exercised, so the tenant-isolation tests would prove nothing about production. |
| 4 | `DESIGN.md` radius scale contradicts the emitted configs. | Resolved against the **rendered PNG**, which is the visual source of truth per plan §4.2. Canonical scale + usage remap preserves both correct semantics and exact fidelity. |
| 5 | Design shows AI coding agents as peer resource cards; gap-spec §18.2 forbids modelling them as employees. | Keep the visual treatment — the design already differentiates (`HUM`/`AI` badges, "Capacity" vs "Compute Allocation"). Enforce the distinction in the **domain model**: an AI agent is a `Capability` attached to a team, carries no salary, cannot approve, cannot hold gate accountability. Enforced by invariants and tested. |
| 6 | Export fixture copy includes aerospace/manufacturing content that gap-spec §4.3 puts out of V1 scope. | Replace fixture copy with software-domain content. Layouts unaffected. |
| 7 | Tailwind v4 is CSS-first (`@theme`), so the exports' `tailwind.config` blocks cannot be copied. | Tokens port to CSS variables. The export configs are a *reference*, not a file to import. |

No conflict is a blocker. Each has the smallest justified adaptation, recorded per gap-spec §0.

## 5. Missing files / screens

- **14 of 64 locked screens** have no export — listed with derivation basis in `docs/DESIGN_SCREEN_MAP.md` §1.1.
- **EmptyState and Modal** primitives — absent from all 50 exports, designed net-new.
- **Five token categories** — shadows, breakpoints, z-index, motion, easing — defined in the handoff spec.
- **Everything else**: there is no application yet.

## 6. Architecture adjustments

The locked architecture is preserved. Three adjustments, all downward in complexity and all evidence-led:

1. **Jobs on Postgres, not Redis.** Fewer moving parts, and a correct outbox by construction.
2. **PGlite for local Postgres.** Same engine everywhere; no daemon.
3. **pnpm workspace packages** enforce modular-monolith boundaries at the source level — the rules engine
   cannot import the web app, and the deterministic engines test in pure Node with no DOM.

Nothing on the plan's do-not-lose list (gap-spec §88) is affected.

## 7. Database strategy

PostgreSQL everywhere. PGlite (WASM Postgres) locally and in tests — a fresh in-memory instance per test
file, which is both faster and more isolated than truncating a shared database, and matters for the ~50
tenant-isolation tests. Managed Postgres when deployed. Drizzle owns schema and version-controlled
migrations. Tenant isolation is enforced **twice**: application-layer scoping plus row-level security as
defence-in-depth (plan §3.2).

**Accepted limitation:** PGlite is single-connection, so it cannot exercise pooling or concurrent-writer
contention. Concurrency-sensitive suites — optimistic concurrency, idempotency under double-submit, the
atomic change transaction — must **also** run against networked Postgres in CI before the staging gate.
Recorded as a Phase-1 CI requirement, not left implicit.

## 8. Auth strategy

Provider-neutral OIDC, identity keyed on `(issuer, subject)` per gap-spec §6.1. **No domain entity couples
to an identity vendor.** The concrete provider is deferred to Phase 3 — choosing now would be guessing,
and the contract requires the provider to remain replaceable.

Guest-first is a first-class path, not an afterthought: anonymous users complete intake, generate the AI
prompt, import, validate and preview. Guest state is server-side under a random session ID in an HttpOnly
secure cookie, with expiry, and converts to an account **atomically and idempotently** — double-submit
must not create two projects (gap-spec §5.4, §48).

## 9. Test strategy

600+ meaningful tests, written **per phase alongside the code**, never batched at the end. Per-phase
minimums come from plan §0.3. Vitest for unit/integration/domain/API; Playwright for the 40 critical
journeys plus accessibility via axe.

The rule that shapes everything: a failing test is never deleted or weakened to get green CI. If a fix
cannot be validated, the change is reverted to last-known-good, the evidence is preserved, and a
known-issue entry is opened (plan §30).

The deterministic engines — rules, calculations, impact propagation — are the highest-value test targets
because they are pure functions over versioned inputs. Golden-fixture tests there catch more than UI
tests do. The golden fixture is the plan's own: **GST Compliance Platform**, enterprise web app,
12-person team, £180,000, 8 months — which, conveniently, is the same fixture the designs were mocked
with, so design parity and test parity reinforce each other.

## 10. Security risks (initial)

Highest-risk surfaces, from the threat model started in Phase 0:

1. **Cross-tenant access** — the top risk. Every tenant-owned query requires tenant context; enforced in
   the application layer *and* by RLS; ~50 dedicated isolation tests attempting access via direct IDs,
   lists, search, exports, evidence downloads, jobs, notifications and audit endpoints.
2. **Malicious AI import JSON** — untrusted input by definition. 14 validation layers before anything is
   materialised; never mutates the canonical project during validation.
3. **Malicious evidence upload** — MIME allowlist, extension/MIME consistency, size caps, randomised
   storage keys, signed downloads, no user-controlled paths, content-disposition safety, hashing.
4. **Stored XSS in living documents** — rich text is the classic vector; sanitisation on write and render.
5. **Guest session abuse** — rate limits on guest project creation, expiry, no permanent sensitive storage
   before signup.
6. **Prompt data leakage** — the external-AI boundary is the one place project data deliberately leaves.
   Requires the copy-safety screen showing exactly what leaves, detected sensitive items, and redactions
   (gap-spec §11.3).
7. **Secrets in logs** — automated tests proving passwords, tokens, cookies and auth headers never appear
   in log output (gap-spec §54).

The CSP conflict (KI-007) is resolved by construction and cannot reach the shipped app.

## 11. Phase-0 execution sequence — completed

1. Read both contracts in full. ✅
2. Inventory the repository; establish that it is greenfield. ✅
3. Identify and fence off the sibling projects, including the live session in `E:\Project\plan`. ✅
4. Initialise version control; author `.gitignore` / `.gitattributes`. ✅
5. Secret scan — **clean**. ✅
6. Audit all 50 design exports: structure, nav, tables, forms, states, IA. ✅
7. Extract and diff design tokens across all 50 configs; prove consistency. ✅
8. Verify the machine's real toolchain and capability. ✅
9. Reconcile 64 locked screens against 50 exports; map routes and components. ✅
10. Record conflicts and the smallest justified adaptations (ADR-0001, ADR-0002). ✅
11. Produce the required audit documents. ✅
12. Open known issues KI-001…KI-013. ✅
13. This report. ✅

## 12. Blockers

**None.**

Nothing prevents Phase 1. The one genuinely unresolvable-by-audit condition — the five undefined gate
criteria — is handled by ADR-0001 rather than by guessing or stalling. No unresolved *product* decision
makes implementation unsafe, which is gap-spec §86's stated bar for proceeding without asking.

Two items need a user decision **later**, neither blocking now:

- **Deployment target** (Phase 19). The domain layer must not depend on it, so it can be chosen late.
- **Auth provider** (Phase 3). The OIDC contract is provider-neutral, so this is a configuration choice.

## 13. Can implementation safely proceed?

**Yes.**

The repository is understood. The designs are audited, their defects catalogued, and their tokens
extracted and proven consistent. The stack is chosen on verified evidence from this machine rather than
recalled. Every conflict between the plan and reality is documented with a recorded adaptation. The
secret scan is clean. Thirteen known issues are open, none of them P0, and the one P1 is resolved by
construction.

**Phase-0 gate: GREEN.** Proceeding to Phase 1 — Foundation.

---

## Appendix — Phase-0 gate scorecard

| Plan §4.4 criterion | Verdict | Evidence |
|---|---|---|
| Clean install works | **Deferred → Phase 1** | No manifest exists (ADR-0001) |
| Build works | **Deferred → Phase 1** | No build system exists (ADR-0001) |
| Lint works | **Deferred → Phase 1** | No config, no source (ADR-0001) |
| Typecheck works | **Deferred → Phase 1** | No TypeScript exists (ADR-0001) |
| Baseline tests run | **Deferred → Phase 1** | No runner, no tests (ADR-0001) |
| Dependency scan complete | **Deferred → Phase 1** | Zero dependencies to scan (ADR-0001) |
| Design inventory exists | **PASS** | `docs/audit/DESIGN_AUDIT.md`, `docs/DESIGN_SCREEN_MAP.md` |
| Design token inventory exists | **PASS** | `docs/DESIGN_HANDOFF_SPEC.md` — 47 tokens extracted, consistency proven |
| No secrets in repository | **PASS** | Full-tree scan clean; `REPOSITORY_AUDIT.md` §5.1 |
| Known issues documented | **PASS** | KI-001…KI-013, `REPOSITORY_REALITY.md` §5 |
| Repository understood and reproducible | **PASS** | `REPOSITORY_AUDIT.md`, `REPOSITORY_REALITY.md` |
