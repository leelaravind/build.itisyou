# REPOSITORY REALITY

**Date:** 2026-08-31
**Contract ref:** `IMPLEMENTATION_GAP_CLOSURE_SPEC.md` §2
**Purpose:** The exact physical state of the repository and the machine, recorded before any code is
written. Every value here was obtained by running a command or parsing a file — none is recalled or
assumed.

---

## 1. Source structure (gap-spec §2.1)

| Category | Present? | Detail |
|---|---|---|
| Root folders | Yes | `stitch_project_blueprint_system/`, `.claude/`, plus `docs/` created by this audit |
| `apps/` | **No** | — |
| `packages/` | **No** | — |
| Generated code | **No** | — |
| Handwritten code | **No** | Zero source files of any language |
| Design exports | **Yes** | 101 files: 50 × (`code.html` + `screen.png`) + 1 `DESIGN.md` |
| Public assets | **No** | Exports reference fonts/icons from Google CDNs at runtime |
| Documentation | Yes | 2 contract documents at root; `docs/` created by this audit |
| Tests | **No** | — |
| Infrastructure files | **No** | — |
| Scripts | **No** | — |
| CI files | **No** | — |
| Deployment files | **No** | — |
| Database files | **No** | — |
| Environment examples | **No** | No `.env.example`, no `.env` |
| Lockfiles | **No** | — |
| Package manager | **None configured** | pnpm selected — ADR-0002 |
| Monorepo tooling | **None** | pnpm workspace planned — ADR-0002 |

**Total application source files: 0.** See `docs/REPOSITORY_AUDIT.md` for the full inventory and the
consequences for the Phase-0 gate.

---

## 2. Version inventory (gap-spec §2.2)

Because nothing pre-exists, this is a **decision record with rationale**, not a survey — the adaptation
recorded in ADR-0001. Reasoning for each choice is in ADR-0002.

### 2.1 Verified present on this machine

Confirmed by direct invocation during this audit:

| Tool | Version | Notes |
|---|---|---|
| Node.js | **22.23.2** | `node -v` |
| pnpm | **11.22.0** | Global store on E: (952 MB), conserving limited C: space |
| npm | 10.9.4 | Registry reachable |
| git | 2.50.0.windows.2 | |
| GitHub CLI | 2.97.0 | Authenticated as `leelaravind` |
| Playwright browsers | Chromium, Firefox, WebKit | **Already installed** — no large download needed |

### 2.2 Verified ABSENT

| Tool | Consequence |
|---|---|
| **Docker** | No daemon. No local Postgres or Redis container. **Drives the ADR-0002 adaptation.** |
| psql / sqlite3 CLI | No manual DB shell; not required — Drizzle + PGlite cover dev and test |
| wrangler / vercel / netlify / cloudflared | Not installed globally by design; added per-project when the deployment target is chosen |

### 2.3 Machine capability

| Resource | Value | Relevance |
|---|---|---|
| CPU cores | 16 | Supports parallel Vitest/Playwright workers |
| RAM | 23.7 GB | Ample |
| Disk C: free | **12.5 GB / 285 GB (4.4%)** | **Critical.** A full C: terminates the Claude Code process mid-run. Nothing of ours goes here. |
| Disk E: free | **26.3 GB / 59 GB (44%)** | Repository, pnpm store, and small scratch/temp. Not roomy — no bulk artifacts. |
| Disk G: free | 419 GB / 932 GB (45%) | External HDD. The only roomy volume: downloads, dumps, archives, browser binaries. |

Disk figures measured 2026-09-05; C: has stayed near the 10.9 GB originally recorded, so the
constraint is real and not merely precautionary. Temp goes to E:, anything large goes to G:.
Redirects live in `E:/Project/.claude-scratch/env.sh` (and `env.ps1`) — source one before any command
that writes non-trivial data. `.npmrc` already pins `store-dir`, `cache-dir`, and `state-dir` to E:.

### 2.4 Selected stack — pinned versions

All resolved from the live npm registry during this audit. Rationale in ADR-0002.

| Concern | Package | Version |
|---|---|---|
| Framework | `next` | 16.3.3 |
| UI | `react` / `react-dom` | 19.2.8 |
| Language | `typescript` | **5.9.x** (not 7.x — ADR-0002) |
| Styling | `tailwindcss` | 4.3.3 (CSS-first `@theme`) |
| ORM | `drizzle-orm` / `drizzle-kit` | 0.45.2 / 0.31.10 |
| Local + test Postgres | `@electric-sql/pglite` | 0.5.8 |
| Deployed Postgres driver | `pg` | 8.23.0 |
| Jobs | `pg-boss` | 12.29.0 (**not** BullMQ/Redis) |
| Validation | `zod` | 4.5.4 |
| Unit/integration tests | `vitest` | 4.1.11 |
| E2E / accessibility | `@playwright/test` | 1.62.1 |

### 2.5 Deferred, deliberately

| Concern | Status | Decided at |
|---|---|---|
| Auth provider | Deferred | Phase 3. Contract is provider-neutral OIDC keyed on `(issuer, subject)` per gap-spec §6.1; the domain must not couple to a vendor. |
| Object storage provider | Deferred | Phase 11. `ObjectStore` interface + filesystem adapter first (ADR-0002 §3). |
| Deployment target | Deferred | Phase 19. Must not constrain the domain layer. |
| Storybook | Deferred | Phase 2, with the design system. |
| Rich-text editor (Tiptap) | Deferred | Phase 13, with the document system. |
| Graph rendering library | Deferred | Phase 10, evaluated against the 2,000-node fixture required by gap-spec §26.1. |
| TypeScript 7 adoption | Evaluation task | Phase 1 spike with an explicit decision point (ADR-0002). |

### 2.6 Not required, with evidence

Gap-spec §82 forbids assuming these are needed. Each is recorded as **not adopted** with a reason:

| Technology | Status | Reason |
|---|---|---|
| Redis | Not adopted | pg-boss provides the required job semantics on Postgres and makes the transactional outbox correct by construction (ADR-0002 §2). |
| Kafka | Not adopted | Plan §3.2 defers it until multiple independently deployed consumers exist. None do. |
| Separate search service | Not adopted | Plan §3.2 and gap-spec §41 both start with Postgres full-text search. Adopt a search service only on measured evidence. |
| GraphQL | Not adopted | Plan §21 specifies REST + OpenAPI, contract-first. |
| Microservices | Not adopted | Plan §3.1 mandates a modular monolith first. |
| ML models | Not adopted in V1 | Plan §3.2 and §37 — clean interfaces only; no training. |
| Paid AI API | **Prohibited in V1** | Plan §2.2 and the goal directive. External AI is one-shot, manual, provider-neutral. |

---

## 3. Generated-design classification (gap-spec §2.3)

Full classification in `docs/REPOSITORY_AUDIT.md` §4.2. Summary:

| Artefact | Count | Classification |
|---|---:|---|
| `*/screen.png` | 50 | VISUAL REFERENCE ONLY |
| `*/code.html` | 50 | REPLACE WITH SHARED COMPONENT |
| `technical_precision_command/DESIGN.md` | 1 | KEEP AS-IS → extract to tokens |
| `stitch_project_blueprint_system.zip` | 1 | UNUSED (git-ignored) |

**No artefact is classified BROKEN at the file level.** All 50 exports parse, close their tags, and
contain no placeholder or lorem text. Defects are at the *token and content* level, not the file level,
and are catalogued in `docs/DESIGN_HANDOFF_SPEC.md` §4 (D1–D6) and §8.

---

## 4. Baseline evidence (gap-spec §2.4)

Recorded in `docs/REPOSITORY_AUDIT.md` §5. Summary: the secret scan **passes clean**; install, typecheck,
lint, build, test and dependency scan are **N/A against an empty tree** and are enforced at the Phase-1
gate per ADR-0001. These are recorded as undefined, not as passes.

---

## 5. Known issues opened at Phase 0

| ID | Severity | Issue | Source |
|---|---|---|---|
| KI-001 | P2 MAJOR | `border-subtle` referenced 67× but defined nowhere | Handoff spec D1 |
| KI-002 | P2 MAJOR | Border-radius scale shifted one step; `rounded-full` = 0.75rem, not a circle | Handoff spec D2 |
| KI-003 | P3 MINOR | Font fallback stack missing from 46 of 50 exports | Handoff spec D3 |
| KI-004 | P3 MINOR | `headline-sm` used in 8 screens, defined nowhere | Handoff spec D4 |
| KI-005 | P2 MAJOR | No `warning`, `info`, `blocked`, `unknown` or `exception` colour token exists, yet Quality Gates needs BLOCKED and EXCEPTION states | Handoff spec §3 |
| KI-006 | P2 MAJOR | Shadows, breakpoints, z-index, motion duration and easing absent from every export | Handoff spec D5 |
| KI-007 | P1 CRITICAL | Exports depend on `cdn.tailwindcss.com` and Google Fonts at runtime — direct CSP conflict | Handoff spec D6 |
| KI-008 | P3 MINOR | **EmptyState and Modal appear in zero exports.** `execution_board` carries the comment `<!-- Empty State visually implied by space -->` | Design audit; verified directly |
| KI-009 | P2 MAJOR | Two exports carry **off-domain fixture copy**: `recommendations_exceptions` ("Titanium Alloy", "Thermal Tolerance") and `change_request_center` ("high-tensile alloy", "grade steel", load capacity). Aerospace and manufacturing are explicitly **out of V1 scope** per gap-spec §4.3 | Design audit; verified directly |
| KI-010 | P3 MINOR | Product naming inconsistent across exports: 25 "GovIntel Platform", 11 "GovIntel", 11 "GST Compliance Platform", 1 unbranded; 3 leftover `Screen NN:` prefixes | Design audit |
| KI-011 | P2 MAJOR | Three distinct sidebar shells across the exports with inconsistent items and CTA labels; `project_health` has scrambled item order | Design audit |
| KI-012 | P2 MAJOR | Design shows AI coding agents as peer resource cards; gap-spec §18.2 forbids modelling them as employees | Handoff spec §8 C1 |
| KI-013 | P3 MINOR | PGlite cannot exercise connection pooling or concurrent-writer contention | ADR-0002 §1 |

All are tracked in `docs/KNOWN_ISSUES.md` from Phase 1 onward. None is a P0. KI-007 is P1 but is resolved
by construction — the application compiles Tailwind at build time and self-hosts fonts, so the defect
cannot reach the shipped app.
