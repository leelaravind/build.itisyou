# KNOWN ISSUES

**Severity scale** (gap-spec §76): `P0 BLOCKER` · `P1 CRITICAL` · `P2 MAJOR` · `P3 MINOR` · `P4 COSMETIC`

Production cannot launch with an unresolved P0 or P1 unless formally waived with documented rationale
by an authorised owner — and **a security P0 is never waivable**.

**Current status: no open P0. No open P1.**

---

## Open

| ID | Sev | Issue | Opened | Disposition |
|---|---|---|---|---|
| KI-005 | P2 | No `warning`, `info`, `blocked`, `unknown` or `exception` colour token exists in any export, yet Quality Gates has six states including BLOCKED and EXCEPTION, and `DESIGN.md` prose mandates amber and purple. | Phase 0 | **Mitigated, verification pending.** Values derived in `docs/DESIGN_HANDOFF_SPEC.md` §3 and implemented in `globals.css`. Contrast must be asserted by an automated test before Phase 2 closes. |
| KI-008 | P3 | EmptyState and Modal primitives appear in zero exports. `execution_board` carries the comment `<!-- Empty State visually implied by space -->`. | Phase 0 | Designed net-new from the system in Phase 2. Every screen also needs empty/loading/error/permission states that were never drawn. |
| KI-009 | P2 | Two exports carry off-domain fixture copy: `recommendations_exceptions` ("Titanium Alloy", "Thermal Tolerance") and `change_request_center` ("high-tensile alloy", "grade steel", ISO-9001 load capacity). Aerospace and manufacturing are explicitly out of V1 scope (gap-spec §4.3). | Phase 0 | Fixture copy replaced with software-domain content when those screens are built. Layouts unaffected. |
| KI-010 | P3 | Product naming inconsistent across exports: 25 "GovIntel Platform", 11 "GovIntel", 11 "GST Compliance Platform", 1 unbranded; 3 leftover `Screen NN:` prefixes. | Phase 0 | Canonicalised in `docs/DESIGN_SCREEN_MAP.md` §13. "GST Compliance Platform" is the golden *fixture project* name (plan §31), not product chrome. |
| KI-011 | P2 | Three distinct sidebar shells across the exports with inconsistent items and CTA labels; `project_health` has scrambled item order. | Phase 0 | Reconciled into one shell with contextual sections in Phase 2. |
| KI-012 | P2 | Design shows AI coding agents as peer resource cards; gap-spec §18.2 forbids modelling them as employees. | Phase 0 | **Resolved by design.** Visual treatment kept (it already differentiates: `HUM`/`AI` badges, "Capacity" vs "Compute Allocation"); the distinction is enforced in the domain model — an AI agent is a `Capability`, carries no salary, cannot approve, cannot hold gate accountability. Domain invariants land in Phase 6. |
| KI-013 | P3 | PGlite is single-connection and cannot exercise connection pooling or concurrent-writer contention. | Phase 0 | **Mitigated.** The `concurrency-postgres` CI job runs a real networked Postgres 17 service. The job exists and the service is wired; the suites themselves arrive in Phase 3. |
| KI-014 | P3 | Every route is dynamically rendered, because nonce-based CSP and static prerendering are mutually exclusive. The public landing page loses static caching. | Phase 1 | Accepted. The product is overwhelmingly authenticated and tenant-scoped, so little is cacheable across users. Revisit for the landing page only in Phase 4, and only via hash-based CSP — never by relaxing to `'unsafe-inline'`. |
| KI-015 | P4 | **Playwright cannot spawn workers from Git Bash on this machine** (`spawn UNKNOWN`, errno -4094). PowerShell works. | Phase 1 | Local-only; CI runs on Ubuntu and is unaffected. Run `pnpm test:e2e` from PowerShell. |
| KI-016 | P3 | `style-src` retains `'unsafe-inline'` because Next injects styles without a nonce. | Phase 1 | Accepted for now. Styles cannot execute script, so the exposure is materially smaller than an inline-script allowance. Revisit if Next gains style nonces. |

## Resolved

| ID | Sev | Issue | Opened | Resolved | Resolution |
|---|---|---|---|---|---|
| KI-017 | P3 | Vitest `client` project failed with "Timeout waiting for worker to respond" as soon as a second component test file existed. | Phase 2 | Phase 2 | **Root cause was a silently-ignored config option, not the environment.** `poolOptions` was removed in Vitest 4, so the forks pool stayed in effect; each forked worker re-imported `@testing-library/jest-dom` at ~42s, blowing the 60s pool timeout. Fixed by moving to the v4 top-level API (`pool: 'threads'`, `isolate`, `maxWorkers`) plus distinct `sequence.groupOrder` per project. Setup time fell from 41.8s to 1.9s; the full suite runs in 13s. **I initially misdiagnosed this as a Git Bash shell problem** — one client file happened to fit inside the timeout and two did not, which made it look shell-dependent. |
| KI-001 | P2 | `border-subtle` referenced 67× across the exports, defined in none of them. | Phase 0 | Phase 1 | Aliased to `outline-variant` (`#3e4850`) as `--color-subtle` in `globals.css`. `DESIGN.md` prose describes exactly that role. |
| KI-002 | P2 | Border-radius scale shifted one step; `rounded-full` emitted as `0.75rem`, so nothing is round. | Phase 0 | Phase 1 | Resolved against the rendered PNG — avatars *are* rounded squares, so the emitted value is what was approved. `DESIGN.md`'s scale is canonical in `globals.css`; usages remap one step at the component layer. Remap table in `DESIGN_HANDOFF_SPEC.md` D2. |
| KI-003 | P3 | Font fallback stack missing from 46 of 50 exports. | Phase 0 | Phase 1 | Full fallback stacks defined for `--font-sans` and `--font-mono`. |
| KI-004 | P3 | `headline-sm` used in 8 screens, defined nowhere. | Phase 0 | Phase 1 | Added at 20px/28px/600 — the only gap in the existing scale, matching the section-heading contexts that use it. |
| KI-006 | P2 | Shadows, breakpoints, z-index, motion duration and easing absent from every export. | Phase 0 | Phase 1 | All defined in `DESIGN_HANDOFF_SPEC.md` §5 and implemented in `globals.css`. |
| KI-007 | **P1** | Exports load `cdn.tailwindcss.com` and Google Fonts at runtime — direct CSP conflict. | Phase 0 | Phase 1 | **Resolved structurally.** Tailwind compiles at build time; the CSP names no CDN host. Three E2E tests assert the policy blocks `cdn.tailwindcss.com`, `fonts.googleapis.com` and `fonts.gstatic.com`, and one asserts the landing page fetches nothing off-origin. The exported pattern cannot regress into the shipped app without CI failing. |

---

## Notes on severity

KI-007 was the only P1 and is now closed by construction rather than by convention — the failure mode
is caught by a test, not by remembering. That is the standard the rest should meet as they close.

No issue in this register is currently blocking Phase 2.
