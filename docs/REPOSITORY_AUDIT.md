# REPOSITORY AUDIT — Phase 0

**Date:** 2026-08-31
**Auditor:** Autonomous implementation agent
**Contract refs:** `MASTER_IMPLEMENTATION_PLAN.md` §4.1, `IMPLEMENTATION_GAP_CLOSURE_SPEC.md` §2
**Repository root:** `E:\Project\build`

---

## 1. Headline finding

**The repository is greenfield.** It contains specification documents and design exports only. There is
no application source code, no `package.json`, no lockfile, no framework, no CI configuration, no
database configuration and no deployment configuration.

This is a **material conflict** with the Master Implementation Plan, which is written on the premise of
"exported Stitch designs already present in the repository" alongside pre-existing generated code
(§4.1 asks the agent to identify "current framework versions", "existing generated Stitch code",
"existing CI/CD"). None of that exists.

The conflict is recorded in `docs/adr/ADR-0001-greenfield-baseline.md` and the adaptation is described
in §7 below. No plan behaviour is discarded — only the Phase-0 gate criteria are re-sequenced, because
they are vacuous against an empty source tree.

---

## 2. Physical inventory

| Path | Type | Size | Classification |
|---|---|---:|---|
| `MASTER_IMPLEMENTATION_PLAN.md` | Contract doc | 44,356 B / 2,287 lines | KEEP AS-IS |
| `IMPLEMENTATION_GAP_CLOSURE_SPEC.md` | Contract doc | 49,563 B / 2,855 lines | KEEP AS-IS |
| `stitch_project_blueprint_system/` | Design export tree, 101 files | ~17 MB | VISUAL REFERENCE ONLY (see §4) |
| `stitch_project_blueprint_system.zip` | Source archive of the above | 15,371,555 B | UNUSED after extraction — git-ignored |
| `.claude/settings.local.json` | Local agent skill overrides | 178 B | KEEP AS-IS, not application config |

Total application source files: **0**.

### 2.1 Structure that does NOT exist

Confirmed absent by directory listing, not inferred:

- `apps/`, `packages/`, `src/`, `lib/`, `server/`, `web/`
- `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`
- `tsconfig.json`, `eslint.config.*`, `.prettierrc`
- `vitest.config.*`, `playwright.config.*`, `.storybook/`
- `.github/`, any CI definition
- `Dockerfile`, `docker-compose.yml`, `wrangler.*`, `vercel.json`, `fly.toml`
- `migrations/`, `prisma/`, `drizzle.config.*`
- `.env.example`
- `public/`, static assets, self-hosted fonts, icon sets

### 2.2 Version control

Git was **not** initialised at audit start. The audit initialised a repository at `E:\Project\build` so
the plan's "small verified commits" and "last known-good state" requirements (§38) are satisfiable.

- Branch: `main`
- Commits at audit start: 0
- `.gitignore` and `.gitattributes` authored during this audit
- The 15 MB source zip is git-ignored; the extracted designs are tracked, so the visual source of truth
  is versioned and diffable

---

## 3. Sibling directories — explicitly OUT OF SCOPE

`E:\Project` contains two other project trees. Both are separate products with their own git histories.
Neither is this project, and neither may be modified.

| Path | What it actually is | Evidence | Disposition |
|---|---|---|---|
| `E:\Project\plan` | A **different product** — `plan.itisyou.app`, a personal/financial planning app (revenue, runway, forecast, scenarios, actuals, goals). Next.js monorepo on Cloudflare Workers. 15 commits, deployed to production. | `git log`; routes under `apps/web/src/app/plan/*`; commit "Deterministic financial engine: revenue through runway" | **DO NOT TOUCH.** Read-only reference for toolchain versions already proven on this machine. |
| `E:\Project\qa` | A third project with its own `ARCHITECTURE.md`, `BUGS.md`, Vite + Cloudflare Worker stack. | Directory listing; own `.git` | **DO NOT TOUCH.** |

> **Active-session hazard.** At audit time `E:\Project\plan` had build artefacts (`apps/web/.next/**`)
> and `.scratch/debug2.mjs` written within the preceding ~20 minutes, and 29 modified files in its
> working tree. Another Claude Code session is **actively working in it**. Per the machine-wide
> session-isolation rules, this audit performed read-only inspection only, and will perform no writes,
> builds, installs, git operations or process signals against that tree for the remainder of this
> implementation.

---

## 4. Design export classification

Per gap-closure spec §2.3, every generated design file must be classified.

### 4.1 What the export contains

`stitch_project_blueprint_system/` holds 50 screen folders, each with `code.html` + `screen.png`, plus
`technical_precision_command/DESIGN.md` — the design-system token specification.

### 4.2 Classification

| Artefact | Count | Classification | Rationale |
|---|---:|---|---|
| `*/screen.png` | 50 | **VISUAL REFERENCE ONLY** | Rendered mockups. The pixel source of truth for review and visual-regression targets. Never shipped. |
| `*/code.html` | 50 | **REPLACE WITH SHARED COMPONENT** | Structurally authoritative (layout, copy, table columns, states) but not shippable — see §4.3. Each page is re-implemented against shared primitives, never copied. |
| `technical_precision_command/DESIGN.md` | 1 | **KEEP AS-IS → extract to tokens** | Authoritative token values. Frozen into version-controlled design tokens in Phase 2. |
| `stitch_project_blueprint_system.zip` | 1 | **UNUSED** | Redundant after extraction. Git-ignored; kept on disk as the untouched original. |

### 4.3 Why the exported HTML cannot ship as-is

Verified by reading the exports, not assumed:

1. **Runtime CDN dependency.** Every page loads `https://cdn.tailwindcss.com?plugins=forms,container-queries`
   — the Tailwind *browser* build, which compiles CSS in the client at runtime. Explicitly not for
   production, defeats the CSP that §18 of the plan requires, and breaks offline.
2. **Remote fonts and icons.** Geist, JetBrains Mono and Material Symbols are fetched from
   `fonts.googleapis.com` / `fonts.gstatic.com`. These must be self-hosted for CSP and for the data
   minimisation required by §19.
3. **Config duplicated 50 times.** The `tailwind.config` token block is inlined in every page. Plan §4.3
   requires one version-controlled source of truth.
4. **No behaviour.** Static markup only — no state, data binding, interactivity, routing, or
   accessibility wiring beyond raw semantics.
5. **No shared shell.** Sidebar/topbar/page-header markup is repeated per page. Plan §23 requires shared
   components before duplicated page markup.

**Conclusion:** the exports are the *visual and structural* source of truth and are preserved verbatim
in-repo, but the shipped application is a re-implementation against a real component library. This is
what plan §4.2 mandates ("The Stitch exports are the visual source of truth") together with §23
("Implement shared components before duplicating page markup").

### 4.4 Screen coverage against the locked screen list

Plan §24 locks **64 numbered screens**. The export supplies **50**. Coverage analysis and the per-screen
map are in `docs/DESIGN_SCREEN_MAP.md`; the detailed structural extraction is in
`docs/audit/DESIGN_AUDIT.md`. Missing screens are *derived* from the established design system per
gap-spec §3.5, never invented in a new visual language.

---

## 5. Baseline evidence

Gap-closure spec §2.4 requires baseline install / typecheck / lint / build / test / scan results before
implementation.

| Baseline check | Result | Evidence |
|---|---|---|
| Clean install | **N/A — no manifest** | No `package.json`. Nothing to install. |
| Typecheck | **N/A — no TypeScript** | No `tsconfig.json`, no `.ts` files. |
| Lint | **N/A — no config, no source** | No ESLint config, no source files. |
| Build | **N/A — no build system** | No build tooling of any kind. |
| Tests | **N/A — no test runner** | No test files, no runner. |
| Existing screenshots | **PRESENT** | 50 `screen.png` design renders form the visual baseline. |
| Lighthouse / performance | **N/A** | No application to measure. First meaningful measurement at the Phase-2 shell gate. |
| Accessibility scan | **N/A for app** | No application. Scanning the CDN-dependent exports would measure Stitch's output, not our build. First real axe run at the Phase-2 gate. |
| **Secret scan** | **PASS — clean** | See §5.1. |
| **Dependency vulnerability scan** | **N/A — zero dependencies** | No manifest, no lockfile, no transitive tree. First real scan at the Phase-1 gate. |

These N/A results are recorded honestly rather than reported as passes. They are **not** evidence of a
healthy baseline; they are evidence of an empty one. §7 covers the gate consequence.

### 5.1 Secret scan detail

Scanned every `*.md`, `*.json`, `*.html`, `*.ts`, `*.js` in the tree for credential patterns:
API-key/secret/password/token keywords, `-----BEGIN … PRIVATE KEY-----`, `sk-…`, `ghp_…`, `AKIA…`.

**Result: no credentials found.** All matches are benign:

- Contract-document prose *about* secret handling ("never expose secrets", "secret scanning").
- `save_project_govintel_platform/code.html` — a signup form's `<input type="password">` with a
  `••••••••` placeholder. Markup, not a value.
- `testing_verification_govintel_platform/code.html` — mock UI copy naming a failing test
  `test_expired_token_rejection`. Fixture text, not a token.

No `.env` file exists. No key material of any kind is present in the repository.

---

## 6. Risks and blockers identified

| # | Risk | Severity | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Plan assumes an existing codebase; none exists. Every "verify the current version of X" instruction is unanswerable. | **High** | Phase-0 gate as literally written cannot pass. | ADR-0001: re-sequence gate criteria; the stack is *chosen with recorded rationale* rather than *discovered*. See §7. |
| R2 | 14 of 64 locked screens have no design export. | Medium | Risk of visual drift when deriving them. | Derive strictly from extracted tokens and existing primitives; mark each DERIVED in the screen map; review against sibling screens. |
| R3 | Another Claude session is live in `E:\Project\plan`. | **High** | Concurrent writes could corrupt that session's work. | Hard scope boundary: this implementation writes only under `E:\Project\build`. Recorded in §3. |
| R4 | The plan's infra stack (PostgreSQL + Redis + BullMQ + S3) may exceed what this machine can actually run. | Medium | Phase 3 could stall on unavailable infrastructure. | Environment audit determines real capability first (`docs/audit/ENVIRONMENT_AUDIT.md`); an ADR records the smallest justified adaptation if Docker/Postgres are unavailable. |
| R5 | Export product naming is inconsistent ("GovIntel Platform" vs "GST Compliance Platform" vs `Screen NN:` prefixes). | Low | Inconsistent UI copy if copied blindly. | Canonicalise the product name; treat "GST Compliance Platform" as the *golden fixture project name* (plan §31) — which is exactly what it is — not the product name. |
| R6 | 600+ meaningful automated tests required against a from-scratch codebase. | Medium | Late-phase crunch, or filler tests. | Tests authored per-phase alongside the code, tracked against the plan §0.3 minimums. Never batched at the end. |
| R7 | Exports depend on `cdn.tailwindcss.com` and Google Fonts at runtime. | Medium | Direct CSP violation if carried into the app. | Self-host fonts and icons; compile Tailwind at build time. Recorded in §4.3. |

No **blocker** prevents Phase 0 from completing. R1 requires a documented adaptation, not a stop.

---

## 7. Phase-0 gate disposition

Plan §4.4 requires, for PASS: clean install works · build works · lint works · typecheck works ·
baseline tests run · design inventory exists · design token inventory exists · no secrets in repository ·
dependency scan complete · known issues documented.

Against an empty source tree the first five are not failures — they are **undefined**. Reporting them as
"pass" would be fabrication; reporting them as "fail" would be equally wrong.

**Disposition — smallest justified adaptation** (per gap-spec §0 and §87):

- Criteria *evaluable now* — design inventory, token inventory, secret scan, known issues, repository
  understood — are evaluated at the Phase-0 gate.
- Criteria requiring a codebase — install, build, lint, typecheck, tests, dependency scan — move to the
  **Phase-1 foundation gate**, which the plan already defines as "green foundation pipeline" (§34
  Phase 1). Phase 1 cannot be declared complete until all six are genuinely green.

This weakens no requirement. It sequences each so it is measured when it can be measured. Recorded in
`docs/adr/ADR-0001-greenfield-baseline.md`.

---

## 8. Documents produced by this audit

- `docs/REPOSITORY_AUDIT.md` — this file (plan §4.1)
- `docs/REPOSITORY_REALITY.md` — physical state and version inventory (gap-spec §2)
- `docs/audit/DESIGN_AUDIT.md` — per-screen structural extraction of all 50 exports
- `docs/audit/ENVIRONMENT_AUDIT.md` — toolchain and machine capability
- `docs/DESIGN_SCREEN_MAP.md` — 64 locked screens ↔ exports ↔ routes ↔ components (plan §4.2)
- `docs/DESIGN_HANDOFF_SPEC.md` — token/state/responsive completeness (gap-spec §3)
- `docs/adr/ADR-0001-greenfield-baseline.md` — the plan-vs-reality conflict and its adaptation
- `docs/KICKOFF_REPORT.md` — the gap-spec §86 pre-implementation report
- `docs/DEVELOPMENT_STORY.md` — started at Phase 0, maintained continuously
