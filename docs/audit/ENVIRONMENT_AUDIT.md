# Environment Audit Report

**Generated:** 2026-08-31  
**System:** Windows 11 Home Single Language (10.0.26200)  
**Machine:** Development workstation  
**Auditor:** Automated toolchain verification script

---

## 1. Toolchain Availability Matrix

| Tool | Version | Available | Notes |
|------|---------|-----------|-------|
| **Node.js** | v22.21.0 | ✓ Yes | Current LTS compatible |
| **npm** | 10.9.4 | ✓ Yes | Bundled with Node.js |
| **pnpm** | 11.22.0 | ✓ Yes | Workspace manager (pinned in sibling repos) |
| **yarn** | 1.22.22 | ✓ Yes | Legacy package manager |
| **bun** | — | ✗ No | Not installed |
| **corepack** | 0.34.0 | ✓ Yes | Node.js package manager shim |
| **git** | 2.50.0.windows.2 | ✓ Yes | Version control |
| **python** | 3.14.0 | ✓ Yes | Default python command |
| **python3** | 3.12.10 | ✓ Yes | Explicit python3 command |
| **pip** | 25.3 (Python 3.14) | ✓ Yes | Python package manager |
| **docker** | — | ✗ No | Not installed; daemon unavailable |
| **psql** | — | ✗ No | PostgreSQL CLI not found |
| **sqlite3** | — | ✗ No | SQLite3 CLI not found |
| **gh** | 2.97.0 | ✓ Yes | GitHub CLI authenticated |
| **wrangler** | — | ✗ No | Cloudflare Workers CLI (install per project) |
| **cloudflared** | — | ✗ No | Cloudflare Tunnel agent not installed globally |
| **vercel** | — | ✗ No | Vercel CLI not installed globally |
| **netlify** | — | ✗ No | Netlify CLI not installed globally |

---

## 2. System Resources

| Resource | Value | Status |
|----------|-------|--------|
| **CPU Cores** | 16 logical | ✓ Good |
| **Total RAM** | 23.68 GB | ✓ Good |
| **E: Free Space** | 47.66 GB / 59.36 GB | ✓ Adequate |
| **C: Free Space** | 10.88 GB / 284.65 GB | ⚠ Low |

**Note:** C: drive has less than 11 GB free. Monitor for disk-space-related build failures.

---

## 3. Package Managers & Global State

### pnpm Global Store

- **Location:** `E:\.pnpm-store\v11`
- **Size:** 952.17 MB
- **Status:** ✓ Configured and populated

### npm Registry Configuration

- **npm_config_registry:** Not set (using default https://registry.npmjs.org)
- **Proxy Settings:** None detected
- **Node Extra CA Certs:** Not set
- **Network Status:** ✓ npm registry is reachable

### Git Configuration

- **Git Version:** 2.50.0.windows.2 (Windows-native build)
- **Status:** ✓ Operational

### GitHub CLI

- **Version:** 2.97.0 (released 2026-07-31)
- **Authentication:** ✓ Logged in as `leelaravind`
- **Token Scopes:** gist, read:org, repo, workflow
- **Protocol:** HTTPS for git operations

---

## 4. Browser Automation & Testing

### Playwright Browsers Installed

Browsers cached at `C:\Users\kplee\AppData\Local\ms-playwright`:

| Browser | Versions | Status |
|---------|----------|--------|
| **Chromium** | 1194, 1234 | ✓ Multiple versions |
| **Chromium Headless Shell** | 1194, 1234 | ✓ Available |
| **Firefox** | 1495, 1538 | ✓ Multiple versions |
| **WebKit** | 2215, 2336 | ✓ Multiple versions |
| **ffmpeg** | 1011 | ✓ Video codec available |
| **winldd** | 1007 | ✓ Windows dependency tool |

**Total Browsers:** 12 separate installations across 4 engine families. Cross-browser testing is ready.

> **Cache location is a known deviation.** REPOSITORY_REALITY 2.3 requires browser binaries off
> C:, but these 12 installs (2.2 GB) predate that rule and still sit under
> `C:/Users/kplee/AppData/Local/ms-playwright`. They are left in place because other concurrent
> sessions may be mid-run against them. New installs go to `G:/claude-temp/ms-playwright` via
> `PLAYWRIGHT_BROWSERS_PATH`, set in `E:/Project/.claude-scratch/env.sh`. Reclaim the C: copy with
> `pnpm exec playwright uninstall --all` only when no other session is running Playwright.

---

## 5. Latest Published Versions (npm registry)

Checked 2026-08-31 via `npm view` against https://registry.npmjs.org

| Package | Latest | Notes |
|---------|--------|-------|
| **next** | 16.3.3 | Not currently used in sibling repos |
| **react** | 19.2.8 | qa: ^19.2.0 (current) |
| **react-dom** | 19.2.8 | qa: ^19.2.0 (current) |
| **typescript** | 7.0.2 | Both repos: ^5.9.2 (outdated) |
| **vitest** | 4.1.11 | plan: ^4.1.11 (current), qa: ^3.2.4 (outdated) |
| **@playwright/test** | 1.62.1 | plan: ^1.62.1 (current), qa: ^1.55.0 (outdated) |
| **tailwindcss** | 4.3.3 | qa: ^4.1.13 (current) |
| **drizzle-orm** | 0.45.2 | Not used in sibling repos |
| **prisma** | 8.0.0-rc.12 | Release candidate; not used in sibling repos |
| **zod** | 4.5.4 | Not used in sibling repos |
| **eslint** | 10.9.1 | Both repos: ^9.35.0 (outdated) |

---

## 6. Proven Stack from Sibling Repositories

### `E:\Project\plan` — plan.itisyou.app

**Purpose:** Deterministic, privacy-conscious financial and business planning workspace

**Configuration:**
- **Package Manager:** pnpm@11.22.0 (pinned via `packageManager` field)
- **Node Engine:** >=22.0.0
- **Repository Type:** pnpm monorepo

**Structure:**
- **Apps:** `web` (Next.js frontend with financial domain)
- **Packages (shared):** `financial-engine`, `money`, `period`, `schemas`, `testing`, `ui`, `validation`

**Key Dependencies (DevDependencies):**
- @playwright/test: ^1.62.1
- @vitest/coverage-v8: ^4.1.11
- eslint: ^9.35.0
- typescript: ^5.9.2
- vitest: ^4.1.11
- @vitejs/plugin-react: ^6.1.1
- @axe-core/playwright: ^4.13.0

**Test Projects (vitest.config.ts):**
- `engine` — Node environment, pure financial logic (no DOM)
- `client` — jsdom environment, React components and persistence
- `server` — Node environment, API and security layer

**E2E Testing (playwright.config.ts):**
- e2e-desktop, e2e-tablet, e2e-mobile (local builds)
- a11y (accessibility audit)
- staging-verification, production-verification (deployment validation)

---

### `E:\Project\qa` — qa.itisyou.app

**Purpose:** Privacy-first QA engineering workbench

**Configuration:**
- **Package Manager:** No `packageManager` field in package.json; pnpm inferred from workspace conventions
- **Node Engine:** >=22.0.0
- **Build Tools:** Vite + React + Tailwind + Cloudflare Workers

**Runtime Dependencies:**
- react: ^19.2.0
- react-dom: ^19.2.0
- react-router: ^7.9.1
- @fontsource-variable/inter: ^5.3.0
- @fontsource-variable/jetbrains-mono: ^5.3.0

**Key DevDependencies:**
- @playwright/test: ^1.55.0 (outdated vs plan)
- vitest: ^3.2.4 (outdated vs plan)
- wrangler: ^4.38.0 (Cloudflare Workers CLI)
- tailwindcss: ^4.1.13
- vite: ^7.1.5
- typescript: ^5.9.2
- eslint: ^9.35.0

**Test Projects (vitest.config.ts):**
- `unit` — Node environment (unit, property, golden, integration, security, adversarial tests)
- `dom` — jsdom environment (component and storage tests)

**E2E Testing (playwright.config.ts):**
- e2e (generic)
- a11y (accessibility)
- visual (visual regression)
- offline
- production (production verification)

**Build Pipeline:**
- Vite build output → `dist/`
- Service worker compilation with precache manifest
- SEO plugin: auto-generates sitemap.xml and robots.txt
- Cloudflare Worker as entry point

**Deployment:** Wrangler to Cloudflare (wrangler.jsonc configured)

---

## 7. Package Version Consistency

### Versions in Common

| Package | plan | qa | Latest | Status |
|---------|------|-----|--------|--------|
| typescript | ^5.9.2 | ^5.9.2 | 7.0.2 | ⚠ Both outdated |
| eslint | ^9.35.0 | ^9.35.0 | 10.9.1 | ⚠ Both outdated (1 major) |
| @types/node | ^22.15.0 | ^22.15.0 | ? | ✓ Consistent |
| @vitejs/plugin-react | ^6.1.1 (plan) | ^5.0.2 (qa) | ? | ⚠ Different majors |
| @playwright/test | ^1.62.1 | ^1.55.0 | 1.62.1 | ⚠ qa is outdated |
| vitest | ^4.1.11 | ^3.2.4 | 4.1.11 | ⚠ qa is outdated (1 major) |

### Version Divergence Risks

1. **TypeScript 5.9.2 → 7.0.2:** Major version jump; check breaking changes before upgrade.
2. **eslint 9.35.0 → 10.9.1:** Minor version; likely safe to upgrade in next cycle.
3. **@vitejs/plugin-react:** Major version difference between repos (6.x vs 5.x). This is intentional per plan's newer setup.
4. **@playwright/test & vitest in qa:** Outdated by 1 version; consider aligning with plan on next maintenance pass.

---

## 8. Environment Variables & Proxies

**Scanned Environment:**
- npm_config_* variables: None set
- HTTP_PROXY: Not set
- HTTPS_PROXY: Not set
- NODE_EXTRA_CA_CERTS: Not set

**Registry Access:** Direct connection to npm via HTTPS; no proxy or custom CA in play.

---

## 9. Constraints and Risks

### High Priority

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **No Docker daemon** | Cannot run Postgres/MySQL containers locally | Use embedded SQLite for dev, managed databases for staging/prod. Check .env for DB_URL configuration. |
| **No psql / sqlite3 CLI** | Cannot inspect or manage databases from command line | Install as needed per project; consider adding to setup docs. |
| **Low C: drive space (10.88 GB)** | Build artifacts, node_modules, Docker images will accumulate | Monitor disk; clean up periodically. Consider moving pnpm store to E: (already done). |

### Medium Priority

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **TypeScript 5.9.2 is outdated** | Potential security/compatibility issues on next major update | Plan TypeScript upgrade for next sprint; test thoroughly. |
| **ESLint 9.35.0 is outdated** | Flat config migration in ESLint 9 already done; 10.x is available | Non-urgent; align on next maintenance pass. |
| **qa has older vitest & Playwright** | Missed bug fixes and new features in plan | Update qa's test suites on next feature branch; verify test compatibility. |
| **No globally installed wrangler/vercel/netlify** | Must install per-project or use npx | This is intentional and correct for version pinning. Document in project setup. |
| **bun not available** | Cannot benchmark or test with bun runtime | Install if needed; otherwise, stay with Node/pnpm for consistency. |

### Low Priority

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **Two Python versions installed** | Minor confusion on `python` vs `python3` | Both are usable; document which to use in project guidelines. |
| **yarn still present** | Unused but takes disk space | Can uninstall if project is pnpm-only; keep for now unless disk pressure increases. |

---

## 10. Readiness Assessment

### Green (Ready to Build)

- ✓ Node.js 22.21.0 / npm 10.9.4 / pnpm 11.22.0
- ✓ git 2.50.0, GitHub CLI authenticated
- ✓ Multiple Playwright browsers installed (Chromium, Firefox, WebKit)
- ✓ npm registry reachable
- ✓ vitest configured and proven in both sibling repos
- ✓ TypeScript strict mode enabled in both repos
- ✓ ESLint + TypeScript-eslint rules enforced

### Yellow (Monitor / Plan)

- ⚠ C: drive space low; monitor and clean periodically
- ⚠ TypeScript 5.9.2 is 1 major version behind (7.0.2); plan upgrade
- ⚠ qa test suite has older vitest (3.2.4) and Playwright (1.55.0); align with plan

### Red (Blockers)

- ✗ No Docker daemon for local Postgres containers; design DB strategy (SQLite dev, hosted staging/prod)
- ✗ No psql or sqlite3 CLI; install if needed for manual database work

---

## 11. Recommendations for Greenfield Project

### Immediate Actions

1. **Install project CLI tools per-project:**
   ```powershell
   pnpm add -D wrangler   # If using Cloudflare Workers (per qa pattern)
   ```

2. **Install database tools as needed:**
   ```powershell
   choco install sqlite   # or scoop/winget, or npm sqlite3
   # OR use pnpm add -D sqlite3 for Node.js access
   ```

3. **Create .editorconfig, .nvmrc, and .npmrc** using pattern from plan repo.

4. **Pin pnpm version** in package.json via `packageManager` field (both plan and qa do this).

5. **Configure database strategy** in README:
   - Dev: SQLite (file-based) or in-memory with vitest
   - Staging: Managed Postgres (e.g., Supabase, Railway, AWS RDS)
   - Production: Managed Postgres with backups

### Build Configuration

1. Copy vitest project setup from plan (three-project split: engine, client, server).
2. Use Playwright for E2E (desktop, mobile, a11y, staging/prod verification).
3. Follow qa's Vite + Tailwind + Cloudflare Workers pattern if deploying to Cloudflare.

### Testing & Deployment

- **Unit/Integration:** vitest (Node environment)
- **Component:** vitest (jsdom environment)
- **E2E:** Playwright (cross-browser)
- **Accessibility:** Playwright + axe-core (a11y plugin)
- **Deployment:** gh (GitHub), wrangler (Cloudflare), or manual CI/CD

### Baseline Package Versions

Copy the version ranges from plan's package.json as a starting point:
- Node: >=22.0.0
- pnpm: 11.22.0
- typescript: ^5.9.2 (plan to upgrade in near term)
- vitest: ^4.1.11
- @playwright/test: ^1.62.1
- tailwindcss: ^4.1.13
- eslint: ^9.35.0

---

## Summary

This machine is **ready for greenfield development**. Node.js 22, pnpm 11, and comprehensive browser automation are in place. The two sibling repos (plan.itisyou.app and qa.itisyou.app) provide proven patterns for monorepo structure, testing strategy, and Cloudflare deployment. Main constraints: no Docker daemon (plan for file-based or hosted databases) and low C: drive space (monitor and clean).
