# DEVELOPMENT STORY

A continuous, honest record of how this platform was built: decisions, reasons, alternatives, failures,
root causes, fixes, test evidence, security findings, deployment milestones and lessons learned.

Required by `MASTER_IMPLEMENTATION_PLAN.md` §0.4. Entry template from
`IMPLEMENTATION_GAP_CLOSURE_SPEC.md` §75. **This document is written as work happens, never
reconstructed at the end.**

---

## Project origin

Two specification documents and a folder of 50 Google Stitch design exports arrived in `E:\Project\build`
on 2026-08-31. No code. The brief: build a **Software Project Intelligence, Planning, Execution and
Governance Platform** — a system that encodes professional software-delivery practice well enough to
guide anyone from a beginner with an idea to an enterprise delivery organisation, across the full
lifecycle: Idea → Discovery → Planning → Approval → Execution → Verification → Release → Production →
Operations → Completion → Archive.

The product is explicitly *not* a task manager, a Jira clone, a Kanban board, or an LLM wrapper. Its
value is a **deterministic engine**: rules, gates, calculations, traceability and impact propagation that
produce the same answer every time and can explain why. External AI is an optional, provider-neutral
research input that is never trusted without validation — and V1 ships with no paid AI API dependency at
all.

---

## Entry 001 — Phase 0 opened: the repository is not what the plan assumes

- **Date:** 2026-08-31
- **Phase:** 0 — Repository + design handoff verification
- **Objective:** Establish the physical truth of the repository and the design handoff before any code.

### What I found

I read both contract documents in full first, as instructed — 2,287 lines of master plan and 2,855 lines
of gap-closure spec — before touching anything else.

Then I inventoried the repository, and the headline finding was immediate: **it is greenfield.** The plan
is written throughout as though a codebase already exists. §4.1 asks me to identify "current framework
versions", "existing generated Stitch code", "existing CI/CD" and "TypeScript state". None of it exists.
There are two markdown documents, 101 design files, and nothing else.

Three findings mattered enough to act on immediately.

**1. `E:\Project\plan` is a different product with a live session in it.**

`E:\Project` holds three sibling trees. I inspected the other two read-only to understand what I was
looking at. `E:\Project\plan` turned out to be `plan.itisyou.app` — a personal/financial planning app
with routes for revenue, runway, forecast, scenarios and actuals, 15 commits, already deployed to
production. Not this project.

More importantly, its `.next` build cache and a `.scratch/debug2.mjs` had been written within the
preceding twenty minutes, and its working tree had 29 modified files. **Another Claude Code session is
actively working in that directory right now.** Under the machine-wide session-isolation rules, writing
there — or running a build, or touching its git state — could destroy another session's work.

I recorded a hard scope boundary: this implementation writes only under `E:\Project\build`. The sibling
trees are read-only reference material for learning which toolchain versions already work on this
machine, and nothing more. This is written into `docs/REPOSITORY_AUDIT.md` §3 so it survives context
compaction.

**2. The exported HTML is the visual source of truth but cannot ship.**

I verified this by reading the exports rather than assuming. Every one of the 50 pages loads
`cdn.tailwindcss.com` — the *browser* build of Tailwind, which compiles CSS at runtime in the client.
That is a direct contradiction of the CSP requirement in plan §18, and it breaks offline. Fonts (Geist,
JetBrains Mono) and Material Symbols come from Google's CDN, which conflicts with the data-minimisation
requirement in §19. The `tailwind.config` token block is duplicated in all 50 files, where §4.3 demands
one version-controlled source. And there is no behaviour at all — static markup, no state, no routing,
no shared shell.

So the disposition is: **preserve the exports verbatim in-repo as the visual and structural contract,
and re-implement against real shared components.** That is exactly the pairing plan §4.2 and §23 call
for. Nothing is discarded; nothing is copy-pasted either.

**3. Five of the ten Phase-0 gate criteria are undefined, not passing or failing.**

Plan §4.4 gates Phase 0 on "clean install works · build works · lint works · typecheck works · baseline
tests run". Against an empty source tree, these have no truth value. I could not honestly mark them pass
— plan §38 forbids fabricating results, and gap-spec §82 explicitly warns against assuming a database or
a chosen stack already exists. Marking them fail would stall the project on a condition no amount of
auditing can satisfy, because they measure a codebase Phase 0 is not meant to produce.

### Decision

Recorded as **ADR-0001**: split the Phase-0 gate by evaluability. The six criteria that need a codebase
(install, build, lint, typecheck, tests, dependency scan) move to the Phase-1 gate, which the plan
already defines as "green foundation pipeline". Everything measurable now — design inventory, token
inventory, secret scan, documented risks, repository understood — stays at the Phase-0 gate.

No requirement is weakened. Each is enforced at the first point it can actually be measured, and Phase 1
cannot close until all six are genuinely green with recorded command output.

A second consequence of greenfield: the "version inventory" that gap-spec §2.2 asks me to *survey*
becomes a *decision record with rationale*. There is no existing stack to discover, so versions get
pinned deliberately, preferring what a sibling project has already proven works on this hardware.

### Alternatives considered

I rejected scaffolding a minimal app inside Phase 0 purely so the criteria could pass — that blurs a
phase boundary the plan draws deliberately, and is a larger adaptation than needed. I also rejected
editing the plan's gate definition in place, because gap-spec §0 forbids silently rewriting the plan;
an ADR is the sanctioned mechanism for exactly this.

### Verification

- Secret scan across all `*.md`, `*.json`, `*.html`, `*.ts`, `*.js`: **clean**. Every hit was prose about
  secret handling, a `<input type="password">` placeholder in the signup design, or mock UI copy naming a
  test called `test_expired_token_rejection`. No `.env`, no key material.
- Git initialised at `E:\Project\build` so that "small verified commits" and "last known-good state"
  (§38) are achievable at all. The 15 MB source zip is git-ignored; the extracted designs are tracked so
  the visual source of truth is versioned and diffable.

### Remaining risk

Seven risks logged in `docs/REPOSITORY_AUDIT.md` §6. The two that will shape the next decisions: 14 of
the 64 locked screens have no design export and must be derived rather than invented (R2); and the
plan's infrastructure assumption — PostgreSQL, Redis, BullMQ, S3 — may exceed what this machine can
actually run, which the environment audit is resolving before I commit to a persistence strategy (R4).

### Artefacts

`docs/REPOSITORY_AUDIT.md`, `docs/adr/ADR-0001-greenfield-baseline.md`, `.gitignore`, `.gitattributes`,
this file.

---

## Entry 002 — What the designs actually contain, and what they are missing

- **Date:** 2026-08-31
- **Phase:** 0 — Design handoff verification
- **Objective:** Extract the design tokens, audit all 50 screens, and reconcile them against the 64
  locked screens before writing a single component.

### Method

I ran two audits in parallel — a full structural extraction of all 50 exports, and a toolchain/capability
survey of the machine — while I read the contracts. Then I verified the load-bearing claims myself rather
than accepting them, because a wrong finding here propagates into every component.

That verification mattered. My own first pass flagged twelve files as defining a `warning` colour token;
checking the actual matches showed they were Material Symbols **icon names**, not tokens. The correction
inverted the finding: there is no warning colour anywhere. Worth the extra command.

### The colour system is sound; the scales are not

Hashing the 50 inline `tailwind.config` blocks gives 34 distinct hashes, which looks like serious token
drift. It is not. Stitch emits JSON keys in arbitrary order. After normalising quote style and
whitespace: **47 colour tokens, identical values, present in all 50 files, zero conflicts.** The palette
is trustworthy.

The non-colour scales are where the handoff breaks down. Six defects, each verified:

**`border-subtle` is used 67 times and defined zero times.** Not in any config, not in `DESIGN.md`'s
frontmatter — yet `DESIGN.md`'s *prose* leans on it constantly ("use a `border-subtle` to define edges",
"ghost buttons use `border-subtle`", "data tables with `border-subtle` separators"). Under the CDN build
these classes silently produce no border colour. Resolved to `outline-variant`, which is exactly the role
the prose describes.

**The radius scale is shifted one full step, and `rounded-full` is not round.** `DESIGN.md` says
`full: 9999px`; every export emits `full: 0.75rem`. Every name below it is displaced too, and
`rounded-sm`/`rounded-md`/`rounded-xs` are used but undefined, falling back to Tailwind's stock values.
`rounded-full` appears 351 times across all 50 screens — avatars, status dots, progress bars.

I did not resolve this by preferring one document over the other. I opened `team_resources/screen.png`
and looked. **The avatars are rounded squares, not circles.** The emitted `0.75rem` is what was actually
rendered and approved, and `DESIGN.md`'s own prose independently agrees: *"status indicators … should
remain geometric … to avoid the playfulness associated with circular pills."* So the token contract and
the render disagree on the *name*, not the *intent*. Resolution: adopt `DESIGN.md`'s scale so
`rounded-full` regains its conventional meaning, and remap the usages one step so the rendered output is
identical. Both correctness and fidelity, no compromise.

**Two of six Quality Gate states have no colour defined anywhere.** `DESIGN.md` prose mandates
"Blocked: Amber icon" and "Exception: Purple icon". There is no amber token. There is no purple token.
Quality Gates is a core governance surface with six states — NOT_READY, READY, PASS, FAIL, BLOCKED,
EXCEPTION — and a third of them were unspecified. Had this not surfaced in Phase 0, they would have been
invented in a component file and the divergence found at visual review, or never. Derived both, and made
contrast verification a mandatory automated test rather than a review note.

Also absent from all 50 exports: shadows, breakpoints, z-index, motion durations and easing — five of the
categories gap-spec §3.1 requires. And `headline-sm`, used across 8 screens, defined nowhere.

### Two findings that change more than styling

**EmptyState and Modal exist in zero exports.** `execution_board` carries the comment
`<!-- Empty State visually implied by space -->`. The designer knowingly skipped it. Both primitives must
be designed net-new — and every one of the 50 screens needs empty, loading, error and permission states
that simply were not drawn.

**Two exports carry off-domain fixture copy.** `recommendations_exceptions` talks about "Titanium Alloy"
and "Thermal Tolerance"; `change_request_center` discusses "high-tensile alloy", "grade steel" and load
capacity against ISO-9001. Aerospace and manufacturing are **explicitly out of V1 scope** (gap-spec §4.3,
which names them among domains the product must not claim expertise in). The layouts are fine; the
content contradicts the product boundary. Fixture copy gets replaced with software-domain content.

### Screen reconciliation came out clean

64 locked screens, 50 exported. All 50 map 1:1 to a locked screen — nothing orphaned, nothing duplicated.
The 14 gaps cluster sensibly: six mid-intake/AI-import screens, Login, Preferences, and the six mobile
screens. Each is derived from the established system with a recorded basis, never invented.

A pleasant confirmation from the render: the top nav reads `Home · Plan · Execute · Control · Documents ·
Insights` — precisely what plan §2.4 specifies. Design and contract agree.

A less pleasant one: the exports contain **three different sidebar shells** with inconsistent items and
CTA labels, and `project_health` has its items in scrambled order. That gets reconciled into one shell
with contextual sections.

### The design contradicts the spec on AI agents

`team_resources` shows "Claude-3-Opus / Senior Agent" as a resource card sitting next to "Dr. Elena
Rostova / Lead Architect". Gap-spec §18.2 is blunt: *"Do not pretend an AI coding tool is a human
employee."*

Looking closely, the conflict is narrower than it first reads — the design already differentiates. The
human shows "Capacity 95%" with a continuous bar; the agent shows "Compute Allocation: High" with a
segmented one, and they carry distinct `HUM` / `AI` badges. So I kept the visual treatment exactly as
designed and moved the enforcement to where it actually matters: the domain model. An AI agent is a
`Capability` attached to a team, never a human `Resource`. It carries no salary, cannot be an approver,
cannot hold accountability for a gate or sign-off. Invariants and tests, not UI convention.

### Artefacts

`docs/audit/DESIGN_AUDIT.md` (811 lines), `docs/audit/ENVIRONMENT_AUDIT.md`,
`docs/DESIGN_HANDOFF_SPEC.md`, `docs/DESIGN_SCREEN_MAP.md`. Thirteen known issues opened, KI-001…KI-013.

---

## Entry 003 — No Docker, so the infrastructure plan had to change

- **Date:** 2026-08-31
- **Phase:** 0 — Stack decision
- **Objective:** Choose a stack on evidence from this machine, not on recall.

### The constraint

The environment audit returned one fact that reshaped the infrastructure: **Docker is not installed and
no daemon is available.** Also relevant: C: has only ~10.9 GB free, so nothing large should land there.

Plan §3.2 recommends PostgreSQL plus Redis and BullMQ. Both conventionally arrive as local containers.
Neither can.

### What I rejected first

The obvious fallback is SQLite locally, Postgres in production. I rejected it outright, and the reason is
worth recording because it is the single most tempting shortcut available in this project.

This system's correctness argument rests on Postgres-specific behaviour: row-level security as
defence-in-depth for tenant isolation, serialisable transaction semantics for the atomic change-request
apply, recursive CTEs for dependency traversal and impact propagation, full-text search, real check
constraints. SQLite has none of it. Developing on SQLite would mean the ~50 tenant-isolation tests — the
highest-value tests in the entire suite — prove nothing whatsoever about production. That is worse than
having no tests, because it manufactures false confidence.

### What I chose

**PGlite** for local dev and test: real Postgres compiled to WebAssembly, running in Node, no daemon, 3.7
MB. Not an emulator — the actual engine. Same SQL semantics, same isolation levels, same RLS, so the same
migrations and queries run everywhere.

It also happens to solve a testing problem the plan creates. 600+ tests need real isolation between
cases; a fresh in-memory PGlite instance per test file is both faster than truncating a shared database
and impossible to leak state through.

I recorded its real limitation rather than glossing it: PGlite is single-connection, so it cannot exercise
pooling or concurrent-writer contention. Those genuinely differ in production. Mitigation is concrete —
the concurrency-sensitive suites (optimistic concurrency, idempotency under double-submit, the atomic
change transaction) must **also** run against a networked Postgres in CI before the staging gate. Written
into the Phase-1 CI requirements, not left as good intentions.

**pg-boss** replaces Redis and BullMQ. Gap-spec §82 explicitly forbids assuming Redis is required, and
§38 forbids introducing infrastructure without evidence it is needed. But the real argument is better
than "Docker is missing":

Gap-spec §47 requires material domain changes to write outbox entries **inside the same database
transaction**. With the queue living in Postgres, enqueue and domain write share one transaction — the
outbox is correct by construction. With Redis you need a separate outbox table and a relay process, and a
window where a change is committed but its side effect is not yet enqueued. Fewer moving parts *and* a
stronger guarantee. Plan §22's actual requirements — idempotent, retryable, observable, tenant-scoped,
dead-lettered — are properties of our job layer, not of Redis.

### The stack

Node 22.23.2 · pnpm 11.22.0 · Next.js 16.3.3 · React 19.2.8 · TypeScript 5.9.x · Tailwind 4.3.3 ·
Drizzle 0.45.2 · PGlite 0.5.8 · pg-boss 12.29.0 · Zod 4.5.4 · Vitest 4.1.11 · Playwright 1.62.1.
Every version resolved from the live registry or by direct invocation during the audit.

One deliberate non-choice: **TypeScript 7 is `latest`, and I did not take it.** It is the Go-based
compiler rewrite. The only evidence available on this machine is two production-deployed sibling projects,
both pinned to ^5.9.2, and the surrounding toolchain has no verified compatibility here. Adopting an
unverified compiler for a codebase whose correctness argument rests on strict typing trades real risk for
no delivered benefit. It is a Phase-1 spike with an explicit decision point instead of a coin flip now.

Tailwind 4 brought a smaller surprise worth noting: it is CSS-first (`@theme`), so the exports'
`tailwind.config` blocks cannot be copied into a config file at all. The tokens port to CSS variables and
the export configs become reference material.

### Structure

A pnpm workspace, modular monolith. The plan mandates the monolith, but that constrains *deployment*, not
*source layout*. Splitting the domain, rules, calculation, graph and interchange engines into packages
means the rules engine physically cannot import the web app, and the deterministic engines test in pure
Node with no DOM and no framework. Sibling `plan` runs this exact shape in production, so it is proven
here rather than merely idiomatic.

### Verification

Every package version confirmed against the live npm registry. Node, pnpm and git confirmed by direct
invocation — note the environment agent reported Node 22.21.0 and my own run showed **22.23.2**; I
recorded the value I verified myself.

### Artefacts

`docs/adr/ADR-0002-stack-and-infrastructure.md`, `docs/REPOSITORY_REALITY.md`, `docs/KICKOFF_REPORT.md`.

**Phase-0 gate: GREEN.** Design inventory, token inventory, secret scan, known issues and repository
understanding all pass. The six criteria requiring a codebase are enforced at the Phase-1 gate per
ADR-0001. No blockers.

---

## Entry 004 — Foundation, and the CSP fight that took four attempts

- **Date:** 2026-08-31
- **Phase:** 1 — Foundation
- **Objective:** Stand up the workspace, strict TypeScript, lint, test stack, error taxonomy, logging
  and CI — and close the six gate criteria ADR-0001 deferred from Phase 0.

### The foundation itself

pnpm workspace with `apps/web` and `packages/shared`, TypeScript at maximum strictness
(`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`), ESLint on
`strictTypeChecked` + `stylisticTypeChecked`, Vitest, Playwright, and a CI pipeline of four jobs.

**203 unit tests, all green.** The security-relevant pieces got the most coverage, deliberately:

- **56 redaction tests.** The logger redacts centrally, not at call sites, because a convention every
  caller has to remember is one that eventually gets forgotten — and that failure is silent,
  permanent (logs ship and get retained), and usually discovered during a breach review. The tests
  assert on the *serialised* record, not the redactor's return value, so a leak anywhere in the object
  graph is caught. They cover secrets under 32 different key names, eight credential shapes under
  innocuous keys, secrets inside error messages and cause chains, and secrets interpolated into the
  log message itself.
- **`TENANT_ISOLATION` maps to 404, not 403.** A 403 confirms the resource exists and belongs to
  someone else, and existence is data. Gap-spec §7.5 requires cross-tenant probing to disclose
  nothing at all.
- **Provenance overwrite rules are antisymmetric, and equal trust never wins.** Two USER_CONFIRMED
  values that disagree is a genuine conflict for the user to settle, not something to resolve by
  arrival order. This is what stops an AI inference silently replacing a user-confirmed budget.

### Settling TypeScript 7 with evidence instead of deferring it

ADR-0002 left TS 7 as a Phase-1 spike. It resolved itself the moment I checked peer ranges:
**`typescript-eslint@8.68.0` requires `typescript >=4.8.4 <6.1.0`.** TypeScript 7.0.2 sits outside
that, so adopting it would mean no type-aware linting at all — losing `no-floating-promises`,
`no-misused-promises`, `switch-exhaustiveness-check` and `no-unnecessary-condition` on a codebase whose
correctness argument rests on the type system. Decision closed: 5.9.3.

### Two failures worth recording

**`.ts` import extensions.** The packages are consumed as source — each `exports` map points at
`./src/*.ts` — but `tsc --build` rejected the extensions until `allowImportingTsExtensions` was paired
with `emitDeclarationOnly`. Correct outcome anyway: no JavaScript needs emitting.

**My own ESLint config was broken in a way that looked like a plugin bug.** I spread
`tseslint.configs.disableTypeChecked` into an object that *also* defined `rules`, and the later `rules`
key silently overwrote the entire rule-disabling map the spread carried. The symptom was a type-aware
rule crashing on the config file itself. Split into two entries.

### The CSP fight

This is the one worth writing down properly, because I got the diagnosis wrong twice before the real
cause surfaced.

**The finding.** My E2E suite asserts no console errors on the landing page. It failed: Next 16 injects
inline bootstrap scripts, which `script-src 'self'` blocks. 13 tests passed, that one caught it.

The cheap fix is `'unsafe-inline'`. I rejected it. This platform hosts user-authored rich-text
documents (plan §17), which gap-spec §34 names explicitly as a stored-XSS surface —
`'unsafe-inline'` disables precisely the protection that surface depends on. Weakening the assertion
would also have violated plan §30's rule against weakening a valid failing test.

**Attempt one: nonces.** Moved CSP into middleware with a per-request nonce. Still failed — because the
page was statically prerendered, and a nonce generated per response cannot exist in HTML rendered at
build time. Static prerendering and nonce-based CSP are mutually exclusive. Recorded as KI-014 and
accepted: the product is overwhelmingly authenticated and tenant-scoped, so little is cacheable across
users anyway. `export const dynamic = 'force-dynamic'`.

**Attempt two: `strict-dynamic`.** Dropped it. It disables host-based allowlisting, which was blocking
Next's own same-origin chunks. `'self'` plus a nonce is the stronger practical policy here.

Nonces then appeared on every script tag, and Chromium and Firefox went green. **WebKit and
mobile-safari did not** — "SSL connect error", eight times. Cause: `upgrade-insecure-requests`. WebKit
honours it strictly and upgrades `http://127.0.0.1` to HTTPS, where no TLS listener exists. Chromium
and Firefox exempt loopback; WebKit doesn't.

**Attempt three failed for a reason that had nothing to do with the code.** I fixed it, rebuilt,
re-tested — still failing. Fixed it differently, rebuilt, still failing. I was about to conclude the
approach was wrong when I added a debug header and saw it wasn't present in the response at all.

The server had never restarted. My kill loop used `netstat -ano | grep "LISTENING.*:3000"` — but
`netstat` prints the port *before* the `LISTENING` state, so the pattern never matched, the port stayed
occupied, `next start` exited 1, and a stale process from three builds earlier kept answering. Every
"still failing" result was measuring code I had already replaced.

Two lessons. First, when a fix doesn't take effect, verify the change actually reached the running
system before doubting the fix — I burned three cycles on a correct fix I believed was wrong. Second,
the debug header was what broke the loop: one observation beat three rounds of reasoning.

With a genuinely fresh server, both of my candidate fixes turned out to work. I kept the host-based
one — loopback never gets `upgrade-insecure-requests`, every real host does — because it also forces
plain-HTTP requests up to HTTPS in deployed environments, which the protocol-based check would not.

**Result: 70 E2E tests passing across Chromium, Firefox, WebKit, mobile Chrome and mobile Safari.**

### KI-007 is now closed by construction

The P1 from Phase 0 — exports depending on `cdn.tailwindcss.com` and Google Fonts at runtime — cannot
regress into the shipped app. Three tests assert the CSP names no CDN host, and one asserts the landing
page fetches nothing off-origin. The failure mode is caught by a test, not by remembering.

### Verifying the verifier

I planted five credential types (AWS key ID, GitHub PAT, Postgres DSN, Anthropic key, Google API key)
and confirmed the secret scanner caught all five and reported locations without echoing values into
logs. A scanner that reports clean but cannot detect anything is worse than none — plan §38 forbids
claiming a security control without verifying it, and that applies to the tooling too.

It then caught a real hit on my own CI file: the ephemeral Postgres service credential. Working as
intended; resolved with the inline `secret-scan-ignore` marker the scanner provides for exactly that.

### Disk

C: has 8.69 GB free on this machine. This project puts nothing there — `node_modules`, `.next`,
`test-results` and the pnpm store all live on E:, and this session's scratch on C: is 90 KB. Added
`cache-dir` and `state-dir` on E: to `.npmrc` so nothing leaks there later.

### Artefacts

`package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`, `vitest.config.ts`,
`playwright.config.ts`, `.github/workflows/ci.yml`, `packages/shared/**`, `apps/web/**`,
`scripts/{scan-secrets,count-tests,clean}.mjs`, `docs/KNOWN_ISSUES.md`.

---

## Entry 005 — The design system, and proving the derived colours were right

- **Date:** 2026-08-31
- **Phase:** 2 — Design system + app shell
- **Objective:** Build the token layer and core primitives, and close the three Phase-0 gate blockers
  that were still open on the design side.

### Verifying the colours I invented

Phase 0 found that two of the six Quality Gate states — BLOCKED and EXCEPTION — had **no colour
defined anywhere in the handoff**. `DESIGN.md` prose mandates amber and purple; no export contains
either. I derived `#ffc16a` and `#d0bcff` by matching the luminance of the three accents that *were*
extracted, and wrote at the time that the values were "unverified and must be adjusted if they fail".

They didn't fail. Measured against the shipped stylesheet:

| Token | on `surface-container-low` |
|---|---:|
| `primary` (extracted) | 10.08 |
| `success` (extracted) | 10.05 |
| `danger` (extracted) | 10.11 |
| **`warning` (derived)** | **10.69** |
| **`exception` (derived)** | **10.07** |

A spread of under 0.7 across all five. The luminance-parity method didn't just clear the 4.5:1
threshold — it put the derived colours in the same optical register as the palette they had to live
beside, which is what "same optical register" was supposed to mean.

The test parses `globals.css` rather than reading a TypeScript mirror of the tokens. A mirror is free
to drift from what actually renders; parsing the real stylesheet means the test can only pass for
values the browser is genuinely given.

### Making the accessibility rule structural

Plan §25 requires that status never be conveyed by colour alone. The tempting implementation is a
badge component that *accepts* an optional icon. That fails eventually: some call site out of forty
omits it, and the omission is invisible to everyone except the users who need it.

So `StatusChip` has no `color` or `icon` prop at all. A caller names a *status*; the icon, label and
tone come from a descriptor table. Rendering a status without its accessible channel is not
expressible through the API. Tests assert every gate, health, severity and validation state has a
unique icon *and* a unique label — PASS and FAIL differing only by colour would be invisible to the
most common form of colour blindness.

### The test that caught me immediately

`DESIGN_HANDOFF_SPEC.md` §6.4 promised a test asserting no component references a token outside the
frozen set — "what would have caught D1 and D4 at authoring time". D1 was `border-subtle`, used 67
times across the exports and defined in none of them; D4 was `headline-sm`, used on 8 screens and
defined nowhere. Tailwind emits no error for an unknown utility, so nothing else in the toolchain
catches this.

I wrote that test, ran it, and it immediately failed on **my own code**: `gap-3xs` in `StatTile` and
`AppShell` — a plausible-looking token I had invented while writing the component. Exactly the D1
defect, committed by me, four days after documenting why it must never happen again.

I then planted three deliberate offenders (`gap-nonexistent`, `rounded-massive`, `border-not-a-color`)
and confirmed the test catches undefined colour, spacing and radius, and passes clean on restore. Same
discipline as the secret scanner: a checker that has never caught anything is not known to work.

### Reconciling three sidebars into two

KI-011: the exports carry three different sidebar shells. Read closely, they are not three designs.

Shells A (22 screens) and B (15 screens) differ *only* in that B appends Export and Archive — and the
`team_resources` render shows both sets present simultaneously. That settles it: one shell that lost
items in some exports, not two designs. Shell C is organisation-level, a genuinely different context,
and stays separate — merging it would put project navigation in front of a user who has not chosen a
project.

So the shell takes its sections as data. That is what lets one component serve both contexts.

### Two real accessibility defects, found by tests I wrote to find them

The axe suite runs against the rendered application rather than isolated components, because a
component can be perfectly accessible alone and still produce duplicate landmarks or an unreachable
control once composed. Both routes came back with **zero axe violations**, but two of my own
hand-written checks failed:

**Reflow at 320px.** Real defect: four icon buttons in the header overflowed by 12px. I improved the
test to name the offending elements rather than just asserting "something overflows", which is how I
found it in one run instead of guessing. Settings and Help now hide below `sm`; they remain reachable
from the sidebar, and the full set returns with mobile navigation in Phase 16.

**prefers-reduced-motion.** This one was my test being wrong, not the code. The `0.01ms` override
computes to `1e-05s`, so a string comparison against `"0.01ms"` failed while the rule worked
perfectly. Fixed by comparing numerically. Worth recording because the instinct on a red test is to
change the code — here the code was right.

### Artefacts

`apps/web/src/app/globals.css` (the frozen token layer), `components/ui/*` (StatusChip, Button,
EmptyState, DataTable, StatTile, Modal, MaterialIcon), `components/shell/*` (AppShell, navigation),
`app/p/[projectId]/page.tsx`, `e2e/accessibility.spec.ts`, `test/design/*`.

---

## Entry 006 — Tenancy, and the security control that was doing nothing

- **Date:** 2026-08-31
- **Phase:** 3 — Database, tenancy, RBAC, auth
- **Objective:** Build the tenant boundary, the permission matrix and the guest-to-account
  conversion — the security-critical core.

### The RLS suite nearly passed for the wrong reason

I wrote row-level security policies on all five tenant-owned tables, ran the isolation suite, and
every test failed with all three tenants' rows returned. The policies were defined. They were doing
nothing.

**PostgreSQL exempts superusers from row-level security unconditionally**, and `FORCE ROW LEVEL
SECURITY` — which I had set — only covers the table *owner*, not a superuser. PGlite connects as
`postgres`. Every policy was being silently ignored.

The uncomfortable part is how close this came to passing. My first instinct on seeing three rows
where I expected two was that the test fixture was wrong. Had I "fixed" the assertion instead of the
setup, the suite would have gone green, the document would have said "row-level security enforced",
and the control would have been decorative. Plan §38 says never claim a security control without
verifying it, and this is exactly the shape that failure takes: not a missing control, a present one
that does nothing.

The fix is a `NOSUPERUSER` role that queries actually run as, which is also what production must do.
I added a test pinning that constraint so a deployment cannot quietly connect as the owner and
undo it.

The audit triggers had the mirror-image problem: they were working all along, but Drizzle wraps
driver errors as `Failed query: …`, so the trigger's own message sits on the cause chain. A bare
`rejects.toThrow()` would have passed — and would also have passed if the statement failed for a
completely unrelated reason. Walking the cause chain keeps the assertion about the thing it claims
to test.

### Fifteen minutes of CI I would not have noticed until much later

A fresh PGlite instance per test is the most obviously-isolated arrangement, and it is what I wrote.
It measured ~1.5 seconds per instance: 33 tests in 50 seconds. Extrapolated to the 600-test target
that is roughly **fifteen minutes of CI spent on process construction**.

One instance per file with `TRUNCATE` between tests gives an identical isolation guarantee — every
table emptied, nothing survives into the next test — in milliseconds. **50s → 3.7s.** Worth doing at
33 tests; painful to retrofit at 600.

### Design decisions that are security decisions

**Cross-tenant access answers 404, not 403.** A 403 confirms the resource exists and belongs to
someone else, and existence is itself tenant data. Tests assert the cross-tenant response is
byte-identical to a genuine miss, so an attacker cannot enumerate ids by comparing replies.

**Permissions combine as a union, not a maximum.** An organisation ADMIN who happens to be only a
VIEWER on a project still has admin authority over it — organisation admin *is* a grant over the
tenant's projects. Evaluating the two scopes independently and taking the lower answer would break
legitimate administration while looking more secure.

**Separation of duties is data, not a special case in a handler.** An ENGINEER cannot approve a gate;
an APPROVER cannot edit what they approve. Combining edit and approve in one grant is how approval
becomes theatre. Gate override belongs to no project role at all.

**Guests get no evidence upload.** Accepting file uploads before signup opens a malware surface with
no accountable owner behind it.

### Double-submit, which the spec names by name

Gap-spec §5.4 requires that repeated save requests create no duplicate project, and calls out
concurrent double-submit explicitly. It is the most likely race in this product: the user finishes a
long unsaved flow, presses Save, sees nothing for a second, presses again.

Two mechanisms, because they cover different failures. `SELECT … FOR UPDATE` on the session row
serialises concurrent conversions, so the second waits rather than racing — without it both would
read `convertedAt = null` and both would proceed. `convertedAt` then acts as the idempotency marker
so a replay after commit returns the existing result. A replay reports `converted: false` rather
than throwing: the user double-clicked, they did nothing wrong.

The test runs both conversions through `Promise.all` and asserts exactly one project exists and
exactly one caller reports having done the work.

### A document that cannot go stale

`docs/PERMISSIONS_MATRIX.md` is generated from `rbac.ts`, not written by hand, and CI fails if the
committed file has drifted. A hand-maintained authorisation matrix drifts, and a drifted security
document is worse than none — it tells a reviewer the system behaves one way while it behaves
another. I verified the check by planting drift and confirming it fails.

### Artefacts

`packages/db/src/{schema,rbac,tenancy,client,guest}.ts`, four test suites (RBAC, tenancy guard,
database isolation, guest conversion), `docs/PERMISSIONS_MATRIX.md`, `scripts/generate-permissions-matrix.mjs`.
554 tests passing.

---

## Entry 007 — Identity, and the vulnerability that passes every permission test

- **Date:** 2026-08-31
- **Phase:** 3 — closing the gate
- **Objective:** OIDC identity resolution and the authorisation middleware, then the full Phase-3
  security regression.

### Keeping the provider replaceable

Gap-spec §6.1 requires provider-neutral OIDC and forbids coupling domain entities to one identity
provider. The identity module therefore names no provider at all: it takes a claims object and
resolves it to a local user. Whoever verified the token — a hosted SDK, a JWKS verifier, an
enterprise SAML bridge — is the caller's concern, and swapping them changes nothing here.

Two decisions worth stating because they are the ones people get wrong:

**The module never verifies a token; it takes claims already verified.** Mixing verification into
resolution is how "we trusted the `sub` claim from an unverified JWT" happens. The parameter type is
named `VerifiedIdentityClaims` specifically so a caller passing unverified input has to lie about it
in writing.

**Identity is keyed on `(issuer, subject)`, never email.** Email is mutable, can be reassigned to a
different person after someone leaves an organisation, and two providers can assert the same address
for two different people. Keying on it is a well-trodden account-takeover route. There are tests
proving the same `sub` from two issuers is two people, and that a shared email across issuers is
likewise two people.

The lockout path is deliberately vague to the caller: confirming an account exists *and* is locked is
an enumeration oracle, and telling an attacker their lockout worked is free information.

### The vulnerability that passes every permission test

The authorisation middleware exists mostly to enforce an ordering, and the ordering is the whole
point:

1. authenticate (401)
2. establish tenant membership (404)
3. check the object belongs to that tenant (404)
4. check the permission (403)

Steps 3 and 4 are separate and ordered on purpose. A handler that checks "does this role hold
`requirements:edit`?" without checking "does this requirement belong to the caller's tenant?" is
OWASP Broken Object Level Authorisation — and it **passes every permission test you can write**. The
caller genuinely holds the permission. The RBAC matrix is correct. The bug is that nobody asked
which object.

That is why `authorizeObject` binds both checks into one call rather than leaving them as two calls
a handler might get in the wrong order. There are tests for the canonical case (an ENGINEER holding
`requirements:edit` reaching another tenant's requirement), for privilege escalation (an
organisation OWNER's authority conferring nothing in another tenant), and for the ordering itself —
cross-tenant and not-found must be indistinguishable, because if permission were checked first, a
caller *holding* the permission would see 404 vs 403 and learn which ids exist.

### Membership is read per request, not trusted from a claim

A role baked into a token stays valid until the token expires, which means a revoked admin keeps
admin rights for the remainder of their session — precisely the window in which revocation matters.
`buildUserPrincipal` reads membership from the database every time. There is a test that changes a
role mid-flight and asserts the next principal reflects it.

The cost is a query per request. That is the right trade for an authorisation decision, and it is
cheap: a single indexed lookup on `(organization_id, user_id)`.

### Non-membership answers 404

Consistent with the rest: a 403 on an organisation the caller does not belong to would confirm the
organisation exists.

### Artefacts

`packages/db/src/{identity,authorize}.ts`, `packages/db/test/authorize.test.ts` (45 tests),
`docs/SECURITY.md` — which records SEC-001 (the inert RLS finding) in full, including the deployment
requirement it produced and the nine regression guards now protecting it.

---

## Entry 008 — "I don't know" is an answer, and four bugs that looked like each other

- **Date:** 2026-08-31
- **Phase:** 4 — Intake and the guest-first flow
- **Objective:** Landing, start, and the intake wizard, working end to end with no account.

### The idea the whole phase is built on

A conventional form models an unanswered question as `null`. That cannot distinguish four things
that demand completely different behaviour: *not reached yet*, *genuinely does not know*, *assume
something sensible*, and *research this externally*. The second and fourth are what drive the
external-AI prompt package; the third is what licenses the engine to assume; only the first means
"no information exists". Collapsing them into `null` destroys the information this product runs on.

So every field carries a state, and the wizard offers all five answer modes **as buttons**, not as
options hidden in a dropdown. A mode you have to go looking for pushes people towards guessing, and
a guess recorded as a provided answer is worse than an honest unknown: the engine plans against it
and the research request never asks about it.

Two consequences follow that are easy to get backwards, and both are tested:

- **A resolved unknown counts as progress.** Scoring it as zero would mean the completion bar never
  fills for the person being most candid about what they don't know.
- **A resolved critical field does not block generation.** The user made a decision; blocking on it
  would make the product unusable for exactly the inexperienced user it exists to serve. Only a
  genuinely *unanswered* critical field blocks. It surfaces as a prominent assumption instead.

The database enforces the honest version too: a check constraint requires a value to be absent
exactly when the state says there is no answer. That stops the worst intake bug — a field displayed
as "unknown" with a stale value underneath still feeding the planning engine.

### Removing a fabricated claim from the design

The landing export reads **"Trusted by 10,000+ engineering teams"**. This product has no users. A
platform whose entire pitch is deterministic honesty cannot open with an invented number, so the
trust row now states something true and checkable about the engine, and the version pill reads
`APP_VERSION` or claims nothing. Layout and hierarchy are unchanged. An E2E test asserts no
social-proof claim reappears. Recorded as KI-021.

### Four bugs that produced almost identical symptoms

Every one showed up as "the form submitted and nothing happened". They had nothing in common.

**1. `redirect()` inside a `try`.** Next implements `redirect()` by throwing `NEXT_REDIRECT`. My
`catch` swallowed it and converted a successful navigation into a generic failure — so *every*
answer appeared to save and none did. Both server actions now compute a destination and navigate
after the try block.

**2. Rate limits sized as if they were per-caller.** The counter is global across all callers, but I
set `guest-project-create: 10` per minute — a number that made sense per person and blocks the entire
product under any real traffic. Gap-spec §36 warns about exactly this ("do not block normal
legitimate usage"). The E2E suite hit it immediately, which is the cheapest possible way to find out.

**3. PGlite is single-connection.** Concurrent requests interleave on one session and writes were
silently lost. This is KI-013, logged at Phase 0 as an accepted limitation — it just arrived in the
application rather than in the tests. All development-database access is now serialised behind a
promise queue.

**4. My own tests racing the navigation.** Two assertions read the DOM immediately after `click()`,
before the redirect rendered. The passing tests happened to use auto-retrying assertions; these used
bare `textContent()` and `getAttribute()`. The code was correct; the tests were wrong.

The pattern worth remembering: four unrelated causes, one symptom. Each time the temptation was to
assume it was the same bug as last time.

### The stale server, twice

WebKit failures sent me hunting a cookie problem for some time before I noticed the responses had no
trace of my changes. Playwright's `reuseExistingServer: !process.env.CI` was reusing a server I had
started manually for an unrelated check — the same trap that cost time in Phase 1.

It is now `reuseExistingServer: false` unconditionally. A few seconds of startup per run is nothing
against the cost of debugging a phantom failure, and this failure mode is genuinely deceptive: it
looks exactly like a real, reproducible regression against a fix that is already correct.

### One genuine cross-browser finding, scoped honestly

WebKit does not return the guest session cookie on the request after the form POST when served over
plain HTTP, and reports the cookie's `SameSite` as `None` where the server set `Lax`. That is the
tell: a cookie WebKit treats as `SameSite=None` must carry `Secure`, and on `http://` it cannot, so
it is dropped.

By construction that cannot occur in a deployed environment, where the cookie is `Secure`. But it is
inferred rather than proven, and a silent failure of the guest journey on Safari would be severe —
so KI-024 makes a Safari run of this journey against HTTPS a **mandatory staging-gate check**. If it
reproduces there it is a real P1 and blocks release. The affected assertions are skipped only on
WebKit, with the reason attached; every one still runs on Chromium and Firefox.

### Two real accessibility defects found by the mobile axe run

**WCAG 2.2 target-size (2.5.8).** Header links were bare 12px text, roughly 16px tall, and checkboxes
were 16px. Both are under the 24px minimum and genuinely hard to hit on a phone. Now 44px targets.

**Reflow at 320px.** The public header overflowed. The wordmark now hides below `sm`, with the
accessible name preserved.

### Result

**669 unit tests. 267 E2E across five browsers.** All eight gate criteria green. The anonymous
journey works end to end — including with JavaScript disabled, which was a deliberate design
constraint: a wizard that needs a hydrated bundle to record an answer fails on a slow connection at
exactly the wrong moment, after the user has already invested effort.

---

<!-- Entries are appended below as work proceeds. Newest last. -->

---

## Entry 009 — an airlock for someone else's AI, and a layout bug that had been there for three phases

**Phase 5 — external-AI interchange. 830 unit tests, 330 E2E tests, all nine gate criteria green.**

### The shape of the problem

The product's position on AI is unusual and worth restating, because everything in this phase follows
from it: the platform never calls a model. There is no API key, no provider account, no paid
dependency. The user copies a request, takes it to whatever assistant they already pay for, and
pastes the reply back.

That removes an entire category of risk — no vendor lock-in, no per-token cost, no provider outage —
and creates exactly one in its place. Content of completely unknown provenance arrives, by paste,
into a system whose whole pitch is that its numbers are explainable and its facts are traceable.

So the interchange is built as an airlock rather than as an import feature. Two directions, both
treated as hostile.

### Outbound: the disclosure has to come first

The copy-safety screen is not a footnote on the prompt page; it is most of the page. Fields included,
fields removed automatically, fields flagged for the user to look at — stated **above** the copy
button, because nothing can be un-pasted and a warning placed after the action has already failed.

The E2E test for this does not read the copy. It compares DOM positions:

```ts
return (heading.compareDocumentPosition(button) & 4) !== 0 ? 'disclosure-first' : 'button-first';
```

A test that asserted the warning text exists would keep passing if someone moved it below the button.
A test that asserts the ordering cannot.

### Inbound: three locks, because application code has bugs

A pasted response is written verbatim to `ai_imports` and stays there. Validated from the staging row,
previewed from the staging row, and moved forward only by an explicit decision. Three independent
things must all fail before untrusted content could reach the project:

1. The state machine has no `RAW → MATERIALIZED` edge.
2. The application refuses to accept an import whose validation did not set `canMaterialize`.
3. The database refuses the row:
   `CHECK (state NOT IN ('ACCEPTED','MATERIALIZED') OR validation IS NOT NULL)`.

The third is the one that matters. The first two are code I wrote, and I have been wrong before in
this project — SEC-001 was a security control that existed entirely on paper.

### What the AI is structurally unable to say

The interchange schema admits exactly three provenance values: `EXTERNAL_SOURCE`,
`EXTERNAL_AI_INFERENCE`, `ASSUMPTION`. `USER_CONFIRMED` is not representable.

This is the single most important line in the phase. The trust ordering depends on `USER_CONFIRMED`
(rank 100) meaning *a person said so*. An AI that could assert it could overwrite anything by claiming
the user had already agreed. That is prevented by the schema, not by a policy check that might be
skipped on some path.

### A test that was wrong, and the code that was right

One of my Phase-5 tests was called *"lets a claim overwrite a value the platform merely assumed"* and
it failed. My first instinct was that the conflict layer had a bug.

It did not. `ASSUMPTION` ranks 30 and `EXTERNAL_AI_INFERENCE` ranks 20, so an uncited AI guess
correctly **cannot** displace a value the platform had reasoned its way to. The test encoded my
assumption about the ordering rather than the ordering itself. I split it in two: an uncited inference
conflicts, and a cited `EXTERNAL_SOURCE` claim (rank 50) wins.

Worth recording because the reflex — "the test failed, so the code is broken" — is wrong roughly as
often as it is right, and in this project it has now been wrong twice in a row.

### Three stale artefacts, three phases running

Every new route in the interchange spec returned 404. That reads as a routing bug, and I spent time
looking for one.

`next start` serves whatever is in `.next`. I had not rebuilt. The suite was testing the previous
commit.

This is the third time a stale artefact has produced a confident, reproducible failure against code
that was already correct. KI-025 covers the first two — both a stale *server*, fixed with
`reuseExistingServer: false`. This was a stale *build*, which that setting does nothing about. The
Playwright `webServer` command now builds before it starts, in CI too, because a conditional would
restore the hole it closes.

### The bug the fingerprint found

With the build fixed, the insert failed: `relation "ai_imports" does not exist`.

The development bootstrap decided whether to create the schema by asking one question — *does the
`projects` table exist?* That question has the right answer exactly once. Every table added after a
data directory was created was silently missing from it, and would have stayed missing for every
remaining phase.

The fix is a SHA-256 fingerprint of the DDL, recorded in the database and compared on boot. It detects
drift generally instead of fixing the one table. It is explicitly **not** a migration system: it can
say the structure changed, not how to get from one version to the other. That is the right trade for a
disposable local database and the wrong one for anything holding real data, so the rebuild path throws
if `APP_ENV` names a deployed environment (KI-026).

Thirteen tests guard it. The first version of one of them compared a rebuilt database against another
rebuilt database — a tautology that would have passed just as happily with `ai_imports` missing from
both. It now compares the built database against the **Drizzle schema**, which is the disagreement
that actually causes the bug. Verified by deleting `ai_imports` from the DDL and confirming three
tests fail.

### The layout bug that had been there since Phase 2

Then a heading was reported as hidden. It was in the DOM, `visibility: visible`, `opacity: 1`. Zero
pixels wide.

Walking up the tree: `<main class="max-w-3xl">` had a computed `max-width` of **64px**.

Tailwind resolves `max-w-<name>` through the **spacing** namespace before the container one. This
design system defines `--spacing-3xl: 64px`. So `max-w-3xl` meant 64 pixels. `max-w-md` meant
sixteen. Across every page, since the design tokens landed in Phase 2.

What makes it a good bug is why nobody caught it. The pages *rendered*. Text wrapped, colours were
right, nothing threw — the main column had simply collapsed to the width of its longest word.
`max-w-4xl` was unaffected, because no `--spacing-4xl` exists, so the breakage was inconsistent
enough to look like ordinary layout variation. And `max-w-3xl` is the most ordinary class in Tailwind;
no reviewer would look twice at it.

Fixed with named container tokens that no spacing token can shadow. The guard asserts the general rule
— *no sizing utility may name a token the spacing scale also names* — rather than banning the five
classes that happened to be wrong, because banning the five would pass right up until someone added
`--spacing-4xl`. Verified by putting `max-w-md` back into the login page and watching two tests fail.
Recorded as design defect D7 and KI-028.

### A file that grep called binary

Incidentally: `grep` reported `validate.ts` as a binary file. It contained literal control bytes,
including a NUL, inside a regex character class where I had meant to write escape sequences. The code
was *correct* — the character class matched exactly what it should — but the file was opaque to grep,
diff, and anything that normalises text.

Rewriting them as `\uXXXX` took two attempts, because typing the escape text produced the raw bytes
again. The third attempt built the replacement from numeric character codes with no literals at all.
KI-029.

### The hostile payloads

The unit suite already covered the fourteen validation layers exhaustively. What it could not cover is
whether a *user* is actually stopped — an engine that refuses a payload is worthless if the page then
offers an Accept button anyway. So each hostile E2E case asserts both: the response is refused, **and**
the Accept button is absent.

- A claim asserting `USER_CONFIRMED`.
- Instructions dressed as data (*"ignore all previous instructions…"*).
- A response written against schema version 9.9.9.
- A dependency cycle between requirements.
- An unknown top-level property (`executeSql`).
- Text that is not JSON.
- `<img src=x onerror=...>` and `<script>` in a value — asserting nothing executed.
- A 600KB payload.

Plus the case that matters most for adoption: a response wrapped in *"Sure — here is the analysis:"*
and a markdown fence, which is what real assistants actually return. Rejecting that would push people
into hand-editing JSON, which is worse for everyone.

### Two timeouts that were not defects

The full suite surfaced two timeouts that were budgets rather than bugs. Axe walks the whole
accessibility tree and re-runs about a hundred rules; alone it takes seconds, but with four browser
workers contending it exceeded the 30s per-test limit and Firefox's software compositor crashed
outright. And the schema-drift tests build real Postgres instances, three to six seconds each.

Both got their own budget — `test.slow()` and a file-scoped `testTimeout` — rather than a raised global
timeout, which would hide genuine slowness in the eight hundred tests that should finish in
milliseconds. The Playwright worker count is also now capped at four, because the application is
backed by a single-connection database (KI-013): every request queues behind the last, so extra
browser workers buy no parallelism and only lengthen the queue.

### Result

| Gate | Result |
|---|---|
| `format:check` | pass |
| `lint` | pass |
| `typecheck` | pass |
| `test` | 830 passed |
| `test:e2e` | 330 passed, 65 skipped (documented WebKit-over-HTTP scope, KI-024) |
| `docs:check` | pass |
| `scan:secrets` | clean, 116 files |
| `audit:deps` | no known vulnerabilities |
| `build` | pass |

Materialisation into the Digital Twin is deliberately not implemented: the canonical entities do not
exist until Phase 6. Acceptance records the decision and stops, which is the honest state of the
system rather than a stub pretending to apply something.

---

## Entry 010 — a graph that refuses things, and a dollar sign that ate a trigger

**Phase 6 — Project Digital Twin. 1,036 unit tests, 384 E2E tests, all nine gate criteria green.**

### The distinction the whole phase rests on

Gap-spec §8 says the Digital Twin is the canonical project graph, "not merely a dashboard concept".
That sentence decides everything else. A dashboard can afford a loose schema because nothing depends
on it; this is the thing every calculation, gate, report and document reads from.

So the taxonomy is closed — 32 node classes, 17 edge classes, both `as const` — and, more
importantly, **which pairings are legal is an allowlist**. Of the 17,408 possible
`(edge class, from, to)` combinations, 267 are permitted. 1.5%.

That number is asserted by a test, and the assertion is not a style preference. A permissive matrix
would pass every specific rule below while making the graph structurally meaningless, and it would
look identical to a strict one from the outside.

### The rule that makes traceability mean anything

Gap-spec §8.3 names it directly: a **test** may verify a requirement; a **task** may not.

The distinction is the entire basis of the traceability matrix. If work could verify a requirement,
the matrix would report "verified" for anything anyone had touched — and a compliance report that is
confidently wrong is worse than none, because it stops people looking. Both directions are tests, and
the refusal explains itself: *"A task cannot verify anything."*

### Three mechanisms, because there are three questions

Gap-spec §8.4 forbids copying the database per version. The obvious implementation — duplicate every
node on every edit — is wrong three ways at once: unbounded growth, "what is the current value"
becomes a query rather than a lookup, and it still fails to answer what anyone actually asks.

| Question | Mechanism |
|---|---|
| What is true now? | The nodes and edges. One row per entity. |
| What changed, when, why? | The change log — one entry per material change, holding only the fields that differed. |
| What did we commit to then? | A baseline: complete, immutable, checksummed. |

A baseline *is* a full copy, deliberately. What the spec forbids is copying on every change; a
baseline is taken when a plan is agreed and must survive everything it referred to moving on.

Its SHA-256 is computed over a canonical serialisation with sorted keys, deliberately **excluding**
timestamps and revision counts — two graphs with identical content saved at different moments are the
same plan, and a checksum that disagreed would make baselines useless for comparison.

### Determinism as a feature, not an implementation detail

The Phase-6 gate is "deterministic generation from golden fixture". The product's claim is that its
plans are reproducible and explainable, and that claim survives exactly as long as the generator has
no clock, no randomness and no unordered iteration.

Three bans, each load-bearing:

- **No `Date.now()`.** The timestamp is an input. A generator that stamps its own output cannot
  produce byte-identical results twice, so the golden test could not be written at all.
- **No random ids.** Node ids derive from a stable path — `…:req:accessibility`. Random ids would
  make two versions of a plan incomparable and the change log useless: every regeneration would read
  as though everything had been replaced.
- **No unordered iteration.** Including the topological sort's tie-break, which without an explicit
  sort returns map-insertion order — stable enough to pass a two-run test and not a guarantee.

The suite asserts byte-identical output across **ten** runs per fixture, not two. A generator
depending on `Map` ordering or a hash-built `Set` is usually stable across two.

And it asserts that different inputs produce different graphs — without which every determinism test
would pass for a generator that returned nothing.

### A test that would have passed with the table missing

The first version of the schema-agreement test built two databases from the same DDL and diffed
them. That is a tautology: both come from one string, so it would have passed just as happily with
`ai_imports` missing from both.

It now compares the built database against the **Drizzle schema**, which is the disagreement that
actually causes the bug — a table declared in `schema.ts` and never added to the DDL typechecks,
passes review, and fails at runtime. Verified by deleting `ai_imports` from the DDL and confirming
three tests fail.

### The dollar sign

Every scripted edit in this project goes through `String.prototype.replace`. The twin DDL includes a
trigger:

```sql
CREATE OR REPLACE FUNCTION twin_baselines_immutable() RETURNS trigger AS $$
```

It arrived in the file as `AS $`. `replace` with a **string** replacement interprets `$$` as an
escaped dollar sign. So are the `$&`, `$1` and back-reference patterns. The whole schema then failed to apply with
"syntax error at or near $", three layers from anything resembling the cause.

A replacer *function* receives the replacement verbatim, which is what should have been used. Swept
the rest of the repository for the same corruption; nothing else was affected.

### A check that was present and inert

`rowsFromGraph` accepted an `archived` flag and forwarded it to the invariant pass. The archived
invariant only fires when it is told *what changed* — and the flag was forwarded without that, so a
write to an archived project sailed through.

The test caught it in the least useful way possible: it was named *"refuses to write to an archived
project"* and asserted `.not.toThrow()`. It passed. Both the name and the assertion agreed with the
broken behaviour.

Writing the whole graph *is* changing every node in it, and saying so is what makes the rule apply.
This is the same shape as SEC-001 — a control that exists on paper and does nothing — which is now
the second time in this project a security-adjacent check has been inert while looking present.

### Two E2E tests that proved less than they claimed

**"another guest cannot trigger generation"** fired an unauthenticated POST at the route and asserted
the status was not 2xx. The transport rejects that before any application code runs, so it would have
passed against an action with no ownership check whatsoever.

Rewritten as a real BOLA attempt: a genuine second guest, with a valid session, on a page they are
entitled to, submitting the real form with the hidden project id rewritten to someone else's. That
request reaches the server action. Verified by deleting the ownership check and confirming the test
fails.

**"states what it had to assume"** accepted "we assumed" *or* "do not know". The second is on the
page for nearly every project, so it passed without the assumptions section existing.

Tightening it found a real defect. The generator's most consequential assumption — that it fell back
to a generic phase structure because the project type was unknown, and that the security, testing and
release obligations keyed off project type are therefore **absent** — lived only in a summary array
that the page never read. An assumption the user cannot see is indistinguishable from a decision
nobody had to make. It is now a node in the graph, rendered with the rest.

### What the plan page had to get right

Every item carries its provenance **beside it**, never in a tooltip: "Worked out by the engine",
"You confirmed this", "Assumed". A reader who cannot tell an engine conclusion from a confirmed fact
cannot judge either, and provenance nobody reads is provenance that does not exist.

The plan is reachable before the intake is finished, and that is deliberate. Gating it behind
twenty-five answers would defeat the engine's entire purpose — producing something honest from
partial information and saying what it assumed. A user who must finish the questionnaire before
seeing anything leaves at question four.

### Result

| Gate | Result |
|---|---|
| `format:check` | pass |
| `lint` | pass |
| `typecheck` | pass |
| `test` | 1,036 passed |
| `test:e2e` | 384 passed, 101 skipped (documented WebKit-over-HTTP scope, KI-024) |
| `docs:check` | permissions matrix and twin schema both current |
| `scan:secrets` | clean, 136 files |
| `audit:deps` | no known vulnerabilities |
| `build` | pass |

`docs/PROJECT_DIGITAL_TWIN_SCHEMA.md` is generated from `packages/twin/src/` and checked in CI. The
legality matrix is 17 classes over 32 — it could not be maintained by hand, and a stale copy would
misrepresent what the traceability report proves.

Estimates, budgets and the rules engine arrive in Phases 7 and 9. The graph deliberately has no
numbers in it yet: a figure with no formula version, no recorded inputs and no stated assumptions
carries an authority it has not earned, and the snapshot structure that prevents that is in place
before anything starts producing them.

---

## Entry 011 — 287 rules, and four tests that were wrong about their own subject

**Phase 7 — rules, lifecycle and quality gates. 1,358 unit tests, 435 E2E tests, all gate criteria
green.**

### Why the rules are data

Gap-spec §13 says the engine must be data-driven. That is easy to read as an architecture preference
and it is not; it is what makes three separate requirements achievable at all.

A rule written as code can read a clock, call a service, or mutate the project it is evaluating. A
rule written as data can only *describe* a condition and *declare* what follows. So:

- **Determinism is structural** rather than a discipline. A declarative condition has nowhere to hide
  a clock.
- **Explanations are free.** §13.3 wants every emitted action to answer "why is this required?"; a
  rule carrying its own rationale and remediation answers it without per-rule explanation code, which
  would rot within a month.
- **Rules can be reviewed by people who do not read TypeScript.** A security rule only a developer can
  audit is a security rule nobody audits.

The condition language is deliberately small — comparisons, set membership, presence, and `ALL`/`ANY`.
No nesting. A rule needing three levels of boolean structure is two rules squashed together, and a
squashed rule cannot be explained: the engine can say "this fired", not "this fired because of the
middle clause of the second disjunct".

### The distinction the whole engine rests on

Every rule evaluates to one of three outcomes, and the third is the one that matters:

- `APPLIED`
- `NOT_APPLICABLE`
- `INDETERMINATE` — the rule needs an input the project has not answered

An engine with only the first two silently reports "does not apply" for every rule blocked by missing
information. A security rule conditioned on *the system holds payment data* would quietly not apply to
every project that skipped the question, and the plan would show **no payment obligations at all** —
indistinguishable from a project that genuinely has none.

So an unanswered input returns `UNKNOWN` from the condition evaluator, and `UNKNOWN` propagates:
under `ALL`, one definite `FALSE` settles it, but an unknown alongside only trues does not. The page
shows what cannot be decided *above* the findings, with the questions that would settle it, because
that is the part the user can act on.

### Never resolving a critical conflict

§13.2 orders six sources of authority and then adds: *"Never resolve conflicting critical rules
silently."*

That sentence rules out the obvious implementation. Sorting by precedence and taking the winner
produces a plan that looks decided when it is not. If a legal obligation and an explicit project
constraint genuinely contradict each other, nobody in the system is entitled to pick — resolving it
may mean changing the project rather than changing a setting.

So conflicts have two outcomes. Ordinary ones resolve by precedence and record what was overridden.
Critical ones — two `MANDATORY` rules from different authorities — resolve to *nothing*: they are
reported, the emission is **withheld**, and whatever depended on it stays blocked. Emitting one side
anyway would be resolving it, quietly, in favour of whichever rule was evaluated first.

Two mandatory rules from the *same* authority are also unresolvable, and reported as a defect in the
ruleset rather than in the project. Picking arbitrarily between two deliberately-written rules would
hide a catalogue mistake behind a project-level message.

### The catalogue: 287 rules, and what stops them being padding

Gap-spec §14 sets minimum counts per category and adds: *"The rules must be meaningful. Do not create
artificial rules solely to meet a number."*

That is unenforceable by counting, which is why the counts are a floor rather than a target. What *is*
enforceable is the structure that makes a padded rule hard to write. `defineRule` refuses a rule that:

- emits nothing and affects no calculation — it would count towards the total and do nothing;
- is mandatory, legal or security, and cites no source;
- has a test claiming to verify a requirement the rule does not emit;
- is deprecated before it becomes active.

The citation rule fired twice while I was writing the packs, on `PRD-AUTH-001` and
`REQ-COMPLIANCE-001`. Both were genuinely uncitable as written, and an uncitable mandatory obligation
becomes folklore that nobody can challenge or retire. I added the actual sources rather than a
plausible-looking one — a fabricated citation is worse than none, because it looks checkable.

Every rule states a specific consequence. Not "follow best practice" but *"a 403 tells an attacker the
identifier is real"*, *"a backup nobody has restored from is a belief about a backup"*, *"an alert
delivered to an unread inbox is worse than no alert, because it makes people believe they are
covered"*.

### The lifecycle: all 144 pairs

Plan §6 asks for golden tests covering **every allowed and prohibited transition**. Twelve states is
144 ordered pairs, and the suite generates all of them rather than listing a selection.

The exhaustiveness is the point. A hand-picked set tests the transitions somebody thought of, and the
dangerous ones are the ones nobody thought of. Twelve are also named individually with why they are
refused — `IDEA → LIVE` because nothing has been decided, built or checked; `LIVE → COMPLETED`
because production verification would be skipped.

Backwards transitions are deliberately present. Verification finding something and returning a project
to `IN_PROGRESS` is the system working, and a machine that only moves forward forces people to lie
about where they are. An unevaluated gate counts as **not passed** — treating it as satisfied would
make every gate optional for anyone who never ran it.

### Gates that read the graph rather than asking

Gap-spec §15 requires each gate to define **exact criteria**. A criterion phrased as "security
reviewed" is a checkbox; a criterion has to be a question the platform can answer.

39 of the 56 criteria are answered from the project graph. The rest need an EVIDENCE or APPROVAL node
— still stricter than a checkbox, because something has to exist in the record, attributable and
timestamped.

A criterion that cannot be decided returns *undecidable* rather than *failed*, and a gate with any
undecidable blocking criterion is `INDETERMINATE`. Same reasoning as the rule evaluator: collapsing
them into failure teaches people that gate failures are noise.

### Four tests that were wrong about their own subject

**The conflict test could not produce a conflict.** My helper derived a requirement's priority from
its severity, so two `MANDATORY` rules always emitted `MUST` — they agreed, no conflict was detected,
and the withholding test passed against an engine that might have done nothing. Priority is now a
separate parameter.

**The manual-criteria test caught a misclassification, not a bug.** It asserted every `MANUAL`
criterion fails on an empty graph. `exceptions-documented` passed, because a project with no failing
tests has nothing to document. Looking at it, the check reads the graph and decides — producing the
evidence is a human act, but *checking whether it exists* is not. The classification was wrong, so I
changed the code rather than the test.

**The applied-count test asserted the wrong property.** I wrote `expect(applied).toBeLessThan(220)` on
the theory that a long list is unusable. It failed at 249. Measuring rather than adjusting: **164 of
the 287 rules have no conditions and no scope at all** — "estimates are ranges", "work is broken
down", "a test must be able to fail". Those genuinely do apply to every project, and narrowing them to
shorten a list would make the catalogue less true to make a screen tidier. The premise was wrong, not
the engine. Replaced with an assertion that the *conditional* rules discriminate: at least a fifth of
them must answer differently for two unlike projects.

**An E2E helper never arrived.** `reachRules` clicked "See the findings" then asserted a level-1
heading was visible — which is true on the plan page too, so it resolved before the navigation and
every later assertion ran against the wrong page. The failures read as missing content rather than as
a helper that never got there.

### One real defect the linter surfaced

The findings page read `project.projectType === null`. The column is `notNull` with a default of
`'UNKNOWN'`, so the check was dead and `'UNKNOWN'` was being passed through as a real project type —
which would make every type-scoped rule report `NOT_APPLICABLE`. A project that never answered the
question would have silently escaped every type-specific security obligation, and the page would have
shown them as not applying.

`no-unnecessary-condition` caught it as a types-have-no-overlap error. The lint rule found a semantic
bug, which is not what it is for.

### Result

| Gate | Result |
|---|---|
| `format:check` | pass |
| `lint` | pass |
| `typecheck` | pass |
| `test` | 1,358 passed |
| `test:e2e` | 435 passed, 135 skipped (documented WebKit-over-HTTP scope, KI-024) |
| `docs:check` | permissions matrix, twin schema, rule format spec and gate catalogue all current |
| `scan:secrets` | clean, 157 files |
| `audit:deps` | no known vulnerabilities |
| `build` | pass |

`docs/RULE_FORMAT_SPEC.md` and `docs/GATE_CATALOGUE.md` are generated from
`packages/rules/src/` and checked in CI. The rule listing alone is 287 entries — nobody would
maintain it by hand, and a stale copy would misrepresent which obligations are in force.

The methodology engine supports the five delivery methods gap-spec §16 names, and each profile states
what it is **bad** at as well as what it is good at. A tool presenting every option as equally
suitable is not helping anyone choose, and the choice matters most to the people least equipped to
make it. `gatesFor()` returns every gate for every methodology, and `canSkipGate()` returns `false`
unconditionally — a function rather than a constant, so a future change that wanted an exception would
have to make it return something else, which is a change someone would notice in review.

---

## Entry 012 — the level that groups one thing

**Phase 8 — work decomposition and execution. 1,466 unit tests, 483 E2E tests, all gate criteria
green.**

### One sentence, and most of the phase

Gap-spec §17 gives the canonical hierarchy — eight levels, Project down to Checkpoint — and then
adds: *"Not every project requires every hierarchy depth. Avoid fake hierarchy."*

That second sentence is where nearly all of this phase's difficulty lived. A workstream containing one
epic containing one task is three rows of ceremony wrapped around a day's work, and it makes the plan
*harder* to read while looking more thorough. §18.3 says the same about solo delivery: decompose, but
without "useless assignment bureaucracy".

So the depth is derived from the project. Team size, task count, parallel areas and whether governance
needs an audit trail decide which optional levels earn a place, and every decision — included or
omitted — is explained on the page. The rule is stated as a property the tests assert: **a level earns
its place only if it groups more than one thing.**

### Three defects, all the same defect

The fake-hierarchy check found all three, and each one looked different until it did not.

**The decomposer created what it detected.** It built epics, reported them as fake hierarchy, and left
them there. Detecting a defect the engine chose to introduce is not a check; it is a disclaimer. The
depth chosen up front is a *prediction* from the shape of the project, and what the work actually
needs is only knowable once it has been placed — so containers holding fewer than two things are now
collapsed and their children re-parented. That is exactly the "fold it into its parent" the finding
recommends, done rather than suggested.

**Rules emit work for phases a project does not have.** A rule assigns a task to the "operate" phase
because most project types have one; an internal tool does not. The result was an epic under a
milestone that was never created — a dangling edge, and an epic grouping a single task. Phase keys are
now normalised to phases the project actually has, falling back to the *last* phase rather than the
first: work a rule assigned to operation belongs later, not at discovery.

**Workstreams and epics divide by the same axis.** This one I did not reason out; the check found it.
The engine has exactly two axes — the phase, and the family of work the emitting rule belongs to — and
workstreams already use both. An epic beneath one contains that workstream's tasks and nothing else.
Every workstream had exactly one epic, the collapse pass removed them, and the twelve-person fixture
came out with *no workstreams at all* despite asking for three parallel areas.

The fix is a deviation from §17's enterprise example, and it is recorded as one (KI-032). An
organisation with a genuine third axis would justify both levels. Adding them without one would be
putting rows on every screen to match a diagram.

Milestones turned out to have the same shape of problem: a milestone divides by phase, a workstream by
phase *and* family, so a milestone above one always contains exactly that workstream. Milestones are
now in the task chain only when workstreams are absent — which matches **both** of §17's worked
examples, the solo one having milestones and no workstreams, the enterprise one the reverse.

### A model that made the spec's own example illegal

The Phase-6 containment table allowed each level to contain only the *next* one. §17's solo example is
`Project → Phase → Milestone → Task`, and under that table a phase could not contain a task — so the
decomposer produced the shape the spec prescribes and failed the twin's edge-legality check.

"Not every project requires every hierarchy depth" means levels get skipped, which means each level has
to be able to contain anything below it. Fixed, and recorded as KI-033.

The same investigation found that `TEST` had nowhere legal to attach at all: it appears in no
containment list, so every generated test was an orphan — and `MUST_BE_CONTAINED` does not include
`TEST`, so nothing warned. Tests and evidence now hang off the project, which is where they belong: a
test written during build runs at verification and again at every release, so attaching it to one phase
would misrepresent when it matters.

### Capacity, and what plans leave out

Gap-spec §19's formula is a list of subtractions:

    Available Capacity = Working Hours − Leave − Non-project allocation − Overhead − Support

Every one of those is something plans routinely omit, and each omission points the same way. So each
deduction is itemised rather than folded into a single factor. "You have 22 hours" invites disagreement
with no way to locate it; "37.5, minus 4.5 leave, minus 7.5 overhead, minus 3.75 other projects"
locates it precisely.

Allocation is applied **last**, to what remains. Applying it first deducts a full person's overhead
from a half person's time, which produces a negative figure for anyone under about half allocation.

Where a default is used, the result says so: *"assumed at 12% of contracted hours, because none was
recorded"*. And splitting a person across projects costs more than the arithmetic suggests — that is
stated as an assumption rather than silently applied, because the size of the effect is disputed and
applying an unmeasured factor would be inventing precision.

### AI tools are capabilities, not employees

§18.2 is explicit, and the distinction is not pedantic. A capability changes how fast some work goes;
an employee can be assigned accountability. So `AiCapability` has no role, no assignments, and no way
to own anything — because §18.2 says directly that an AI tool "does not own approvals" and "cannot be
responsible for legally required human accountability".

Its effect on effort is a *range*, and it is reported as an assumption rather than added to the hours
available. Folding an unmeasured multiplier into a capacity figure would turn a disputed effect into
something that looks like a measurement.

### Today is not the backlog with a heading

The board is a view of state; the Today list is the one that makes a claim. So it is ranked, capped at
five, and every entry carries the reason it is there — *"other work is waiting on this"*, *"this is
finished and waiting for someone"*. Blocked work and work whose dependencies are unfinished are
excluded: a focus list containing things you cannot start teaches people the list is not actionable.

Review is its own board column, deliberately. Folding it into "in progress" hides the most common queue
in software delivery — work that is finished, waiting for someone, and counted as active. A team can
then be entirely busy with nothing moving.

And completion counts *tasks*, with the caveat travelling alongside the number rather than sitting in
small text: tasks are not equal in size, so "60% complete" is the proportion of items, not of the work.
That difference is where every optimistic status report comes from.

### An E2E test that lied about the hierarchy

The work page reported the hierarchy as "milestone → epic → task". The depth was computed from the
decomposer's own nodes, and `PROJECT` and `PHASE` come from the Phase-6 generator — so the page
claimed a plan with no project and no phases.

Computing it over the merged structure fixed the display and had a second effect: the fake-hierarchy
check now sees phases too, so a phase holding a single milestone is reported. It was not before.

### Result

| Gate | Result |
|---|---|
| `format:check` | pass |
| `lint` | pass |
| `typecheck` | pass |
| `test` | 1,466 passed |
| `test:e2e` | 483 passed, 167 skipped (documented WebKit-over-HTTP scope, KI-024) |
| `docs:check` | all four generated documents current |
| `scan:secrets` | clean, 168 files |
| `audit:deps` | no known vulnerabilities |
| `build` | pass |

The gate is "solo + 12-person fixtures produce valid execution plans", and *valid* is doing a lot of
work in that sentence. Broken out, it means: the graph satisfies its own invariants, no level groups a
single thing, every task traces to a rule or a requirement that required it, and — the one that matters
most — the two fixtures produce genuinely different shapes. A decomposer that produced the same
structure for one person and twelve would pass every other assertion and be useless.

Both fixtures are built by running the *real* generator and the *real* rule evaluator. A fixture
assembled by hand would test the decomposer against a shape I imagined rather than the shape the rest
of the platform actually produces.

---

## Entry 013 — Phase 9: money, and the discipline of refusing to be precise

Phase 9 is the arithmetic phase: effort, capacity, cost, contingency, feasibility, health. It is also
the phase where the contract is most insistent about what _not_ to build. Four separate prohibitions,
all pointing the same way:

- §20: "Do not pretend to know exact delivery time."
- §21.1: "Do not silently use live FX without recording rate provenance."
- §21.5: "Contingency must be explicit and explainable. Never hide contingency inside inflated task
  estimates."
- §22 and §23: "Feasibility is not a magic score" / "Do not create an unexplained 83/100."

Every one of those forbids something that is easy to build and looks good in a screenshot. Taken
together they describe a product that is harder to demo and much harder to be wrong with.

### Money is integers, and rounds symmetrically

`0.1 + 0.2 !== 0.3` is the whole argument for holding amounts as integers in minor units. The second
decision is less obvious: rounding is **half away from zero**, because `Math.round(-0.5)` is `-0` in
JavaScript. That rounds a negative half _up_, so the direction of a rounding error would depend on the
sign of the amount — refunds would drift one way and charges the other.

Currencies carry their exponent. JPY and KRW have none, and assuming two decimal places inflates a yen
figure a hundredfold. The list is deliberately short; anything absent is refused rather than guessed
at, because a guessed exponent produces a plausible number that is wrong by a factor of a hundred.

Adding two currencies is refused outright. It needs a rate, and a rate used without being recorded is
exactly what §21.1 forbids — six months later the total no longer reconciles and nobody can say
whether the difference is the rate, the scope, or a mistake.

### There is no midpoint

`MoneyRange` has no midpoint accessor, and `EffortEstimate` has no single-figure accessor. This is the
one design decision in the phase I am most confident about, and it is enforced by absence rather than
by documentation.

The moment such an accessor exists, every caller downstream uses it — it is shorter, it fits in a
column, and it never has to explain itself. The range becomes decoration, and the product is back to
quoting a number it cannot support. Averaging a range also discards precisely the information the
range was carrying.

Aggregation sums the three points independently, which is deliberately the conservative choice: it
assumes things go badly together at the conservative end. A statistical roll-up would produce a
narrower, more flattering range on an independence assumption that does not hold — projects go wrong
for reasons that hit many tasks at once. And the confidence of a total is the **lowest** of its parts,
not an average: a total containing one unsized item is not medium-confidence because everything else
was understood.

### The UNKNOWN band is uncomfortable on purpose

An unsized task estimates at 4 / 40 / 160 hours — a factor of forty. That is not a placeholder waiting
to be tuned; it is what "nobody has looked at this" actually means. Narrowing it to something
comfortable would be the platform inventing knowledge, and the discomfort of the number is the signal
that the item needs sizing.

The budget page currently estimates every generated task as UNKNOWN, because that is the truth: sixty
tasks nobody has sized produce a range of 255 to 13,440 hours. A tool that showed 2,880 hours there
would look far more competent and would be lying.

### Contingency held as a line, not as padding

§21.5's reasoning is worth restating because it is not obvious. Buffer distributed into every estimate
gets consumed by whichever task overruns first, and nobody can see it going — the project looks fine
right up until the padding runs out. Held as a named line, spending it is a decision somebody takes.

So: contingency is a distinct type, adding a cost line of type `CONTINGENCY` is refused, contingency
with no justification is refused, and the roll-up reports it separately at every level.
`withContingency` exists as a distinct figure rather than as _the_ total — a single number silently
including the allowance is contingency hidden one layer above where §21.5 forbids hiding it.

It is sized from the actual uncertainty and every component is named, which matters mostly because it
lets the figure **shrink**. A contingency nobody can decompose never shrinks; it just gets spent.

### No score, anywhere

There is no numeric field in either the feasibility or the health result, and that is asserted
structurally rather than by review, so adding one later is a visible change to the type.

Both assessments return dimensions with causes, and an overall status that is the **worst** dimension,
naming it. Averaging would let one unrealistic dimension disappear into seven feasible ones, and a
project that cannot be staffed is not seven-eighths feasible.

`UNKNOWN` sits deliberately between the bad statuses and the good ones. It is not a failure — plenty
of projects legitimately cannot answer a question yet — but treating it as healthy would let a project
report as fine because nobody had filled anything in.

### The defect the unit suite could not see

Which brings me to the one real bug in the phase, and to how it was found.

`budgetHealth` asked `input.budget === undefined`. `budgetFeasibility` asked
`input.budgetCeilingKnown !== true`. Those look like the same question and are not: the first means
"nothing has been costed", the second means "costs exist with nothing to measure them against".

The budget page always constructs a budget — it needs somewhere to put the contingency. So for a
project with no budget whatsoever, feasibility reported `Budget unknown` and health reported
`Budget healthy`, from the same input, on the same page, eleven lines apart.

Every unit fixture that omitted the ceiling also omitted the budget object, so the two branches never
disagreed in a test. What surfaced it was reading the rendered page in a failing E2E assertion's
output — the contradiction was sitting in plain text in the diff.

Health is the dimension a reader scans first, so reporting it healthy is the "healthy because nobody
filled in the form" failure §23 exists to prevent, in its most consequential position. Fixed by having
health ask the same question feasibility already asked, with a regression test that fails when the
check is removed (verified by removing it) and a counterpart asserting a recorded ceiling still
reports healthy — otherwise the fix could degrade into a dimension that is permanently undecidable.

### A test that forbade the right thing for the wrong reason

The other failure in this phase was mine, in a test. `expect(body).not.toMatch(/\bscore\b/i)` failed —
on the page's own sentence saying there is no score.

Refusing to _produce_ a thing and refusing to _name_ it are different, and the disclaimer is the
useful half: it tells a reader who expects a score why there isn't one. The assertion now forbids the
word appearing near a number, which is the actual prohibition, and additionally requires the
disclaimer to be present, so the test cannot pass for a page that simply says less.

That is the fifth time in this project an unexpected test result turned out to be the test being wrong
about its own subject rather than the code being broken. The distinguishing question each time has
been the same: read what the code actually produced, rather than adjusting until green.

### Two specifications, generated

Gap-spec §19 and §21 both say "Create:" a document. Both are now generated from source — the sixth and
seventh generated documents — and checked in CI.

These two matter more than the earlier four because they describe _arithmetic_. A document claiming a
12% leave deduction while the code applies 20% would make every figure in the product unreconcilable
with its own explanation, and the drift would be invisible until somebody tried to reproduce a number
by hand.

### Where Phase 9 stands

1,550 unit tests and 519 E2E tests pass; format, lint, typecheck, generated-doc, secret-scan,
dependency-audit and production build are all clean. The calculation golden suite the plan names as
the Phase-9 gate is green at 84 tests.

---

## Entry 014 — Phase 10: traceability, and a bug that reported nothing

Phase 10's gate is one line: "complete Requirement→Release chain verified". The chain is the argument
a project makes for believing it did what it said — requirement, design, work, test, evidence,
approval, release — and its whole value is in being *walkable*, node by node, rather than asserted.

### A requirement has to be capable of being failed

A requirement is the only thing here that can justify work existing. Everything downstream is
defensible only by pointing back at one, so the quality of the requirement set is a hard ceiling on
everything else.

The central check is testability. "The system must be fast" cannot be passed or failed; it can only
be argued about. Detecting that when the requirement is written is cheap. Discovering it at the
release gate, when somebody has to decide on the day whether "fast" was achieved, is not.

Two calibration decisions are worth recording:

**Subjective wording is advisory, not blocking.** Blocking on it would train people to write
requirements that pass the word filter rather than requirements that can be failed, which is strictly
worse than the problem. The list of terms is deliberately short for the same reason — a check that
fires on reasonable prose gets switched off, taking the useful cases with it.

**A regulatory requirement verified only by demonstration is blocked.** A demonstration convinces the
people in the room and nobody else. A regulator asking two years later needs something they can
examine.

There is no `ASSERTION` verification method. "Somebody said so" is what the *absence* of a method
already means, and giving it a name would make it selectable.

### The bug: a report that was empty and confident

The first version of the chain had components *satisfying* requirements and tests *verifying tasks*.
Neither edge is legal under the twin's `EDGE_LEGALITY`. `SATISFIES` is reserved for requirement →
objective and evidence → requirement; a component realises a requirement, which is `IMPLEMENTS`. And
the twin is explicit that a **task** cannot verify a requirement — only a **test** can, with a comment
saying that conflating the two "produces a compliance report that is confidently wrong".

I wrote a chain that could not match anything, over a graph model that had already written down why.

The failure mode is the interesting part. Nothing threw. Every hop simply found nothing, so every
trace came back with no design and no test — and **an empty trace looks exactly like a project that
has not done the work**. If the fixtures had been slightly different I would have shipped a
traceability engine that reported every project as untraced and been unable to tell it was broken.

Worse: my strongest test — "does not credit a test that verifies a different requirement" — *passed*.
It passed because the hop returned MISSING for every requirement, including the one it was supposed
to find. The test that existed to prove the walk was a genuine path was passing because the walk
found nothing at all.

Three things came out of it:

1. **A guard that checks every hop against `checkEdgeLegality`.** Reintroducing the defect now fails
   that test by name, plus seven others. Verified by putting the bug back.
2. **A second guard** that each hop departs from a point appearing earlier in the chain, so a hop
   cannot silently read an empty frontier.
3. **An E2E test that asserts the page reports a non-zero requirement count.** Unit fixtures are
   constructed by hand and can agree with a wrong model; only walking a graph the application
   actually produced could catch this class of error.

The chain also turned out not to be a line. It is a **tree rooted at the requirement**: work, tests
and deployments all attach to the requirement directly, and only evidence and approval hang off an
earlier hop. Threading one frontier through in order was what made the TEST hop look at tasks.

That correction invalidated another test's premise — one asserting that removing the work edge
cascades into the test and evidence hops. It does not, and should not: a test verifying the
requirement survives the work being deleted. The behaviour it was guarding (only the earliest broken
hop blocks) is still worth guarding, so it was rewritten to break two hops by two independent causes.

### Backward traceability

Forward — does every requirement reach work, a test, evidence — is the half every tool implements.
Backward is the half that gets left out, and it catches the more expensive problem: work that traces
back to no requirement is either scope nobody asked for or a requirement nobody wrote down. Neither is
visible from the forward direction, where the report can be a wall of green while a third of the build
is unaccounted for.

Rule-generated work is exempt. The rule *is* the recorded reason — it names the obligation and cites
its source. Reporting the platform's own output as unjustified would fill that section with noise and
teach people to skim it, which is precisely where real scope creep would then hide.

### A chain whose every edge exists can still be broken

If the requirement changed after the evidence was captured, the evidence attests to a different
requirement. Every link is present, a presence-checking tool reports complete coverage, and the claim
is false.

That is what `STALE` is for, and it is the check that earns this module its keep. Alongside it,
`UNVERIFIED` covers the third outcome that two-state models collapse: a test that exists and has never
run, evidence with no artefact hash, an approval still pending. Folding that into "absent" understates
work that has been done; folding it into "present" is the lie above.

Counting an unrun test as coverage would mean the report improves the moment somebody creates a test
file. That is not an incentive to have.

### Holding the platform to its own standard

Phase 10 introduced a standard for requirements, and the engine writes requirements of its own. A
platform that applies a rule to the user's requirements and exempts the ones it writes itself is
asserting that its own conclusions need no justification — exactly the position it exists to argue
against.

When the standard first ran against the generator's output, every generated requirement failed: they
carried a priority and nothing else. No kind, no verification method, no criteria. The generator was
changed, not the check — seven rules now declare what kind of obligation they are, how they are
verified, and what would count as meeting them.

Two failures came out of that, and the second is the more interesting.

**The first was mine.** I marked the personal-data requirement as `REGULATORY` *and* gave it the
`PRIVACY` quality attribute. A requirement is one kind; naming both puts it in two categories with
different checks, and the quality-attribute check would demand a number where the real obligation is
to hold a record. Fixed in the generator.

**The second was not fixable, and should not have been.** Availability is recorded in the intake as
prose — "99.9% during working hours" — and prose is not something a test can be run against. So the
generated requirement genuinely has no measurable criterion, and the check genuinely fires.

The temptation was to parse a number out of the sentence. That would be inventing structure the user
never supplied, which is the same failure as inventing the number. The right answer is that the
platform reports it: the user's answer cannot be tested and they need to know, and without the check
"99.9% during working hours" would sit in the requirement set looking like a specification until
somebody at the release gate had to decide whether it had been met.

So the test was split along a line that turned out to be worth naming: **defects the platform is
responsible for, and defects the answer is responsible for.** The platform must never emit a
requirement broken in a way the user cannot fix by answering better — no missing verification method,
no missing criteria, no regulatory obligation with nothing to show for it. Those would be the engine's
own omissions dressed up as the project's problem.

### Two E2E lessons

**A locator that matches nothing fails silently in the useful direction.** I anchored the page helper
on `getByRole('heading', { name: /^traceability$/i })`. "Traceability" on that page is an eyebrow
label, not a heading. And `getByRole('term', { name })` matches no `dt`, because `dt` and `dd` do not
compute an accessible name from their contents.

**Waiting for the network is not waiting for the page.** The intake driver awaited `networkidle` after
each answer, which resolves immediately after a streamed server action. The next iteration read the
heading of the question it had just answered, decided it had handled it, and clicked "I don't know"
through the entire wizard without ever reaching the two questions the helper exists to answer. Fixed
by waiting for the question text to change.

Both of those produced the same shape of failure as the chain bug: something that found nothing and
carried on as though nothing was there.

### No percentage

The report carries absolute counts and no ratio. "87% traceable" is the same failure as the
unexplained 83/100 §23 forbids — unactionable, optimisable, and it moves for reasons nobody can see.
What a reader needs is *which* requirement has no test, and the id so they can go and look.

And §25's "healthy items stay quiet" creates a specific hazard: an empty report and a report on an
empty project render identically, and one is much worse news than the other. So the empty case is
written out explicitly rather than falling through to silence.

### Where Phase 10 stands

1,630 unit tests and 546 E2E tests pass; format, lint, typecheck, generated-doc, secret-scan,
dependency-audit and production build are clean. `docs/TRACEABILITY_MODEL_SPEC.md` is the eighth
generated document.

---

## Entry 015 — Phase 11: the gates people cite afterwards

Phase 11 builds the six gates from §15.6 to §15.11 — testing, security, release readiness, production
verification, operational readiness, handover — and composes them into one release decision.

These are the gates that produce a *record*. Somebody screenshots the release page into a change
ticket, and if something goes wrong three months later that screenshot is what gets read. Which means
the cost of an over-confident rendering here is different in kind from anywhere else in the platform:
elsewhere a wrong figure misleads somebody making a decision, and here it retroactively justifies one.

Almost every design choice below follows from that.

### An unchecked production check is not a passed one

§15.9 asks for ten checks against the running system: availability, TLS, security headers, critical
journeys, auth, APIs, monitoring, logging, backup/restore, deployment identity.

**This platform cannot observe production.** It can only record what somebody checked and what they
kept. So the default is `NOT_CHECKED`, and the gate returns **indeterminate** rather than passed.

That is the most consequential default in the codebase. Software reporting its own production as
healthy because nobody entered a failure is making the single most damaging false claim available to
it, and there is no honest reading of a check nobody ran.

The counterpart matters as much: a check that ran and *failed* is `FAILED`, not indeterminate. If the
two read the same, a release record cannot distinguish "we looked and it is broken" from "nobody
looked", and the second gets quietly treated as the first.

### Exceptions are the mechanism by which a gate stops meaning anything

§15.6 asks for "accepted exceptions documented". That sounds like a formality and it is the line the
whole gate lives or dies on. One exception is a judgement call. Fifteen undated, unowned exceptions
is a gate that passes every time and tells you nothing — and it gets there one reasonable decision at
a time, with nobody ever deciding to make the gate meaningless.

So an exception carries a reason, an owner, an expiry and a subject, and each of those exists because
of a specific way exceptions go bad. An expired one is *reported* rather than silently dropped:
dropping it would re-block the gate with no explanation, and whoever accepted it could not tell
whether their decision had lapsed or been reversed.

Two properties fell out of this that are worth stating.

**An excepted finding is still reported, marked.** If excusing a problem and fixing it produced
identical output, nobody at review could tell them apart. And a gate resting on four live exceptions
passes *differently* from one resting on none — the result says which.

**Exceptions have to apply consistently, or the mechanism is decorative.** This was a real bug. A
live exception unblocked the failing-test finding, and the coverage check then reported the identical
failure under a different name and blocked anyway. So accepting a failure could never actually clear
the gate. Fixed by having coverage respect the same exceptions — while still reporting the
requirement as an observation, because a requirement whose only verification is an excepted failing
test is not verified.

### A gate that must fail in order to be reached is not a gate

The other real bug, and a more interesting one.

`checkDeployment` decided whether to evaluate the ten production checks from `target ===
'PRODUCTION'`. That conflates two questions that look like one: *is this release destined for
production*, and *has production been verified*. The Release Readiness Gate — which asks whether the
plans exist, before anything has shipped — therefore demanded evidence from a deployment it had not
yet authorised. It could never pass, so nothing after it could ever be evaluated.

The fix is an explicit `verifyProduction` flag. The lesson is that the two questions deserved
separate names from the start; deriving one from the other read as economy and was a category error.

### Three gate outcomes, and the ordering is enforced

A gate whose prerequisite has not passed is `INDETERMINATE`, not `FAILED`. Saying it failed would
blame it for a problem belonging to an earlier gate — sending somebody to fix production verification
when the actual issue is that nobody approved the release.

Testing and security are deliberately independent of each other and both come first. Nothing about
the security position depends on the test position or the reverse, and making one wait on the other
would hide real problems behind unrelated ones.

### The threat model lives in code

§34 says "Create: `docs/THREAT_MODEL.md`" and names nineteen threats. Writing that as prose would have
satisfied the letter of it, and the document would have started decaying the same day — because prose
does not fail a build.

So the nineteen threats are a data structure. Each carries its mitigations, the tests that
demonstrate them, and its residual risk. A threat with **no recorded verification** appears in the
release report as a gap rather than being assumed handled, and the document is generated from the
same data the security gate reads.

Six of the nineteen currently have no verification, and most of those are mitigated by a feature not
existing yet — no webhooks, no queue, no uploads, no outbound fetches. That is a real mitigation and
a fragile one: adding the feature reintroduces the threat in full, and now the model says so rather
than the knowledge living in somebody's memory.

Every threat also states a residual risk, and those are the sentences worth arguing with. Audit logs
are append-only against the application role and a database superuser can still alter anything;
dependency audits only know about published advisories; redaction is a denylist over known shapes. A
threat model claiming complete coverage would be the least believable kind.

### What the E2E caught that the unit tests could not

I wrote a test asserting the release page argues each blocker rather than naming it. It failed, and
it was right to: `GateOutcome.blockers` was a list of strings. The reasoning existed in every
underlying module — every finding carries a `why` — and was being discarded at the point the gates
composed them.

So the release page would have been the one surface in the entire platform stating a verdict with no
argument behind it, on the page most likely to be pasted into an approval ticket. `blockers` and
`observations` now carry `{ summary, why }` and the page renders both.

The unit suite could not have caught this. It asserted the blockers were present and correct, which
they were. What was missing was only visible by looking at the rendered page — the same lesson as
KI-034 in Phase 9 and KI-035 in Phase 10, arriving for the third time from a different direction.

Two smaller test-side corrections, both of premise rather than of code. One asserted the rollback
plan's wording appears on a fresh project's page; it does not, because a fresh project stops at the
testing gate and release readiness is never reached — the property worth guarding was that *every*
blocker carries a reason, not which sentence appears. The other was a strict-mode locator ambiguity
between a gate row and the blocker row inside it: the fourth time in this project, and the fourth
time the feature worked and the selector needed tightening.

### Some smaller positions

**Test categories name what they cannot show.** A green unit suite demonstrates that functions behave
as their authors expected, which is a much narrower claim than "it works". `ACCESSIBILITY` says
plainly that a clean automated scan is not accessibility compliance — roughly a third of WCAG cannot
be checked automatically, and reporting a passing scan as conformance is the most common accessibility
lie.

**Coverage is per requirement, never a percentage.** Line coverage is a proxy for a proxy: a suite
can execute every line and assert nothing, and once it is a target it gets optimised. Named
requirements can be acted on.

**An unclassified test defaults to MAJOR, not MINOR.** Defaulting down would make forgetting to
classify the safest option.

**Mitigated is not resolved.** The symptom has stopped and the cause has not, which means the
mitigation is now load-bearing without anybody having decided that. And `REVIEWED` sits beyond
`RESOLVED`, because fixing an outage and understanding it are different work and the second is the
one that gets skipped.

**Technical debt is recorded, not resolved.** A handover gate demanding zero debt would be failed by
every real project, waived every time, and would stop being a gate. What it demands is disclosure —
undisclosed debt is what makes a handover a betrayal rather than a transfer. An *empty* register on a
project that delivered work is itself reported: zero recorded debt does not mean there is none, it
means nobody wrote them down.

**Ownership is six separate areas.** A single owner field produces one name that is wrong for four of
them. Data protection in particular is a legal obligation with a clock on it, and it is the one most
often left unassigned.

### Where Phase 11 stands

1,697 unit tests and 573 E2E tests pass; format, lint, typecheck, generated-doc, secret-scan,
dependency-audit and production build are clean. `docs/THREAT_MODEL.md` is the ninth generated
document. The Phase-11 gate — the release-readiness flow works end to end — is met by a test that
walks a complete project through all six gates to `releasable`, which also stops every negative test
in that file from passing against a flow that never passes anything.

---

## Entry 016 — Phase 12: what a change would break

Phase 12 answers one question: if I change this, what else stops being true?

The obvious implementation propagates through every edge and reports a count. It is useless in a
specific way that is worth naming, because it is the failure most impact-analysis features have.
Everything in a project is eventually connected to everything, so every change reports several dozen
affected items; a count cannot be acted on and cannot be disputed; and the first time it is visibly
wrong the reader stops believing it. From then on the feature is worse than not having it.

So two decisions carry the design.

**Propagation is a deny-by-default allowlist.** Nine of the seventeen edge classes carry no
propagation at all. `CONTAINS` does not propagate — a project containing a changed task is not itself
stale, and propagating up containment makes every change reach the project root, from which
everything is reachable. `OWNED_BY` does not propagate — changing a requirement does not affect who
owns it.

**Every affected item carries the path that reached it**, hop by hop, with the rule's own reasoning at
each step. "47 items affected" versus "the deployment approval needs revalidating, because it
approved a deployment that depends on a component you changed". The second is checkable, and a claim
nobody can check is one people stop believing.

### Stale is not invalidated

§27.1 gives four states and forbids deleting dependent evidence automatically. The distinction doing
the work is stale versus invalidated: stale means the claim was made against an older version and
*might* still hold, so somebody has to look; invalidated means it definitely does not hold. Collapse
them one way and real breakage is buried in a pile of maybes; collapse them the other and every change
looks like it destroyed the project.

Nothing is deleted. A marked artefact still carries what it showed and when, which is the only record
of what was true before.

### The severity model I got wrong twice

Severity decays with distance — a test verifying a changed requirement is invalidated, the evidence
behind that test is stale, a document further out merely needs review. That much was right from the
start.

What was wrong was letting the decay run to nothing. A `STALE` rule weakened once became `CURRENT`,
which meant stale relationships produced no result beyond the first hop — and §27's own worked example,
"architecture component changed → costs", never arrived, because the estimate is two hops out through
`DERIVED_FROM`. The golden scenario caught it: six assertions failed together, all of them things §27
explicitly names.

The fix is that `STALE` is the floor for anything reachable within the depth limit. That is honest —
the thing *is* downstream of a change, and stale means precisely "may still hold, somebody has to
look". Only the stronger verdicts decay.

The second mistake was in the other direction. My golden scenario asserted the deployment's approval
comes back invalidated. It does not: two hops out it is revalidation-required, because the approver
approved a *deployment*, and it is the deployment that depends on what changed. I nearly changed the
code to make the test pass. The right answer is that claiming at any distance to have voided
somebody's decision is the point at which approvers stop reading the notification — so an approval is
reported invalidated only when its own subject changed, and there are now two tests holding both
halves of that line.

### An edge the model was missing

The golden scenario failed initially in a more interesting way: changing an architecture component
reached two nodes.

That was correct given the rules. It was also useless, and §27 explicitly requires "architecture
component changed → implementation tasks, integration tests, deployment". The reason it could not
work is that the twin had no edge between work and a component: `DEPENDS_ON` permitted
`TASK → TASK` and `ARCHITECTURE_COMPONENT → ARCHITECTURE_COMPONENT` but nothing across. Work and
components were siblings under a requirement with no relation between them.

What decided it was that **two modules had independently needed that edge and neither could have
it**. Phase 10's architecture checker looks for work committed against a component that is still
proposed — a check that could never fire. Phase 12's propagation needs the same edge for the
traversal §27 requires. Two independent needs is evidence the model is missing something rather than
that both callers are wrong, so `TASK`, `SUBTASK` and `DEPLOYMENT` may now depend on an
`ARCHITECTURE_COMPONENT`. Tests reach a component through `VERIFIES`, which was already legal — that
is what an integration test is.

This is the third time this project a defect has been "the code assumed an edge model different from
the one the twin enforces". The first two were mine getting it wrong (KI-033, KI-035). This one was
the model being incomplete, and the way to tell them apart was asking who else needed it.

### The step §28 exists for

The atomicity sequence lists ten steps. Nine are ordinary. Step 5 — "check optimistic concurrency" —
is the reason the list exists:

> Somebody previews a change against version 12, goes to a meeting, comes back and approves it.
> Meanwhile the project is at version 15. Applying now applies a decision made about a different
> project. The approver saw an impact report that is no longer true, and their name ends up on a
> choice they did not make.

Nothing errors without that check. The change applies cleanly and the record looks complete. It is the
kind of defect that is only visible if you go looking for it, and it produces exactly the artefact
somebody cites afterwards.

A request whose base version has moved becomes `SUPERSEDED`, not `REJECTED`. Nobody decided against
it; the world moved. And there is deliberately no route from `APPROVED` back to `PENDING_APPROVAL` —
that would let an approval be reused across a project version it was never given against, which is
the whole thing the check prevents.

### One plan, not two implementations

`plan()` produces what applying the change will do; the preview renders it; `apply()` executes it.

A preview computed by separate code from the application is a second implementation, and the first
time the two diverge it surfaces to a user as "the system did something other than what it showed
me". A test asserts the applied plan is the *same object* the preview rendered, which is the cheapest
possible guard against that ever becoming two code paths.

`apply()` also does not touch the database. It decides whether the change may be applied and what
applying it means; the caller performs all of it in one transaction. That is what §28 step 6 requires,
and it is also what makes the concurrency case testable at all — a function that both decided and
wrote could only be tested against a database, and the concurrency path would be the hardest thing in
it to reach.

Follow-up work is named rather than performed. Running a notification inside the transaction means a
failed notification rolls back a successful change.

### What the E2E caught

The page reported "nothing else in the project depends on what you changed" for every requirement.
That sentence was true of the graph it was analysing and false of the project.

The stored graph holds requirements, phases and risks; the work, tests and evidence that hang off them
are produced by the decomposer at render time, which the other surfaces merge in and this one did not.
So the page was analysing a graph missing everything that could be affected — and because the module
handles "nothing affected" gracefully and says so in plain English, the output looked considered
rather than broken.

That is the fourth time in four phases that a defect was visible only by looking at the rendered page.
The pattern is consistent enough now to state as a rule: a unit suite verifies a function against the
data you gave it, and cannot tell you that you gave it the wrong data.

### Some smaller positions

**Cosmetic changes propagate nothing.** A project where renaming a requirement invalidates its test
suite produces impact reports that are mostly noise, and a noisy report gets skimmed — including on
the occasion it matters.

**Withdrawal escalates regardless of edge.** Dependants have not merely lost currency; they have lost
their subject.

**Truncation is reported.** A traversal that stopped at its depth limit says so, because a truncated
analysis presented as complete is the specific way an impact tool lies: nobody can tell from the
output that something was left out.

**Termination is guaranteed twice over** — a visited set and a depth limit. `DEPENDS_ON` cycles are
invalid and they exist in real projects, and an impact analyser that hangs on one is useless at
exactly the moment somebody is trying to understand a mess. A 2,000-node fan-out is tested, per §26.1.

**Self-approval is refused.** It records a decision with nobody independent behind it, which is worse
than no approval at all, because the record looks complete.

### Where Phase 12 stands

1,754 unit tests and 597 E2E tests pass; format, lint, typecheck, generated-doc, secret-scan,
dependency-audit and production build are clean. `docs/IMPACT_PROPAGATION_SPEC.md` is the eighth
generated document, and it enumerates *every* edge class — an edge with no rule appears as "does not
propagate" rather than being silently absent, because an unlisted edge and a non-propagating edge look
identical in a hand-written table.

The Phase-12 gate — a major architecture-change golden scenario verified — is met by a scenario that
reaches implementation work, the integration test, its evidence, the deployment, the approval on it,
the dependent component, the estimate, the budget line derived from it, and the risk the component
mitigates, each by a path the report shows.

---

## Entry 017 — Phase 13: records that mean something later

Phase 13 is the governance layer: baselines, evidence, approvals, documents and the audit log. What
connects them is that every one is a record somebody will read after the fact, usually when something
has gone wrong and they need to know what was true at a particular moment.

That reframes what "correct" means for this code. The question is not whether a function returns the
right value today; it is whether the record it produces will still support a claim in two years, in
front of somebody who was not there.

### Enforcement by absence

Two of §29 and §40's requirements are prohibitions: never edit a baseline, never update or delete an
audit event.

Both are enforced by the functions **not existing**. Not a guard that throws — an absence. A guard is
a decision somebody can reverse in a hurry at two in the morning with a comment saying "temporary".
A missing function is one they have to notice they are adding.

There is a test for each, asserting no export matches `edit`/`update`/`amend`/`delete`. Both are
pure reflection, which is exactly the kind of test that can be quietly vacuous, so I planted an
`editBaseline` and a `deleteEvent` and confirmed both tests fail by name. They do.

### Redaction, not deletion

§40 says "if legal deletion requires special handling, document the strategy", which is the most
interesting sentence in the section because the requirement is real and the obvious implementation is
wrong.

An erasure request can cover personal data that ended up in an audit payload. Deleting the row
satisfies the request and destroys the sequence — and a log with unexplained gaps proves nothing
about anything near them, because a missing row cannot be distinguished from a row that was never
written.

So: the event keeps its id, its position, its timestamp, its actor, its category and its action. The
named payload keys go, replaced by a record of what was removed, by whom, and under what authority.
A reader sees an event that happened, in its place, with a note saying part of it was removed. That
is strictly more truthful than a gap.

A redaction with no recorded authority is refused — the basis is what distinguishes a lawful erasure
from somebody removing an inconvenient record. Redacting an already-redacted event is refused too,
because that would overwrite the record of the first redaction, which is the one thing a second
redaction must not do. And the redaction is itself appended to the log as an auditable act.

There is a test asserting a redacted log still verifies with no sequence gap. That is the property the
whole strategy exists to preserve.

### Quarantine, not deletion either

The same shape, arrived at independently, in the evidence model. Evidence failing its integrity check
is quarantined and kept.

The fact that evidence was tampered with is the most important thing the system knows about it, and
deleting the record destroys exactly that. A quarantined record still says what it claimed, who
uploaded it and when — which is what an investigation needs.

It also keeps the *absence* of evidence meaningful. If tampered records were deleted, a missing one
could mean "never existed" or "was removed", and nobody could tell which.

The consequence worth writing a test for: a retention sweep cannot delete quarantined evidence
regardless of its class. Housekeeping that tidies away the record of tampering is the most convenient
possible bug, and while it ran it would look like housekeeping working correctly.

### The integrity check that must not repair itself

A baseline failing verification is not fixed by recomputing its hash. That would erase the only sign
anything was wrong.

The explanation says so, in the result, because a boolean answers "is this broken" and what somebody
needs at the moment they ask is what it means: until the difference is explained, this baseline
cannot be used as evidence of what was agreed. That is a much stronger statement than `false`.

### Two instructions pulling opposite ways

§31 is the hardest thing in this phase. Canonical data wins; preserve user edits; do not silently
overwrite; identify affected sections; offer merge.

Resolve it badly and you get one of the two failure modes every document generator has. Overwrite,
and somebody's carefully worded paragraph disappears without warning — the second time it happens
they stop using the feature. Never overwrite, and the document drifts from the project until it is
actively misleading, which is worse, because it still looks authoritative.

The resolution is per-section provenance. A section nobody has touched regenerates silently: there is
nothing to lose. A section somebody edited is never overwritten; regeneration produces a proposal
showing what the data now says beside what the section holds, and a person decides.

Two details that took thinking about:

**The proposal says what ignoring it would mean** — "the document says something the project no
longer does". A prompt reading "these differ" is a chore. One that says what it costs is a reason.

**Accepting a proposal returns the section to GENERATED.** Leaving it EDITED would prompt forever,
which teaches people to dismiss the prompt — and then the next one, and the one that mattered.

### Deliberate asymmetries

Several places in this phase have rules that apply in one direction and not the other, and each one
took a decision:

**A rejection needs a reason; an approval does not.** A rejection with no reason leaves the requester
guessing at what would make it acceptable, so the next attempt is a guess too. An approval is complete
on its own: the thing was found acceptable as it stood.

**A release baseline needs an approval; an approved plan does not.** The plan is often the artefact
the approval is *about*, so requiring the approval first would make it impossible to produce.

**An approval goes stale when its subject changes; a rejection does not.** A rejection records what
somebody thought of the version they saw, and that remains true.

### The strict reading of §33

"If subject changes after approval: approval becomes stale/invalid as policy dictates." The policy
chosen is strict — a materially changed subject invalidates the approval.

The lenient reading makes a claim about a person. An approver who signed off version 3 has not signed
off version 7, and any system treating their approval as still standing has put their name on a
decision they did not make. That is worse than an inconvenient re-approval, and it is the kind of
error nobody discovers until the moment it matters most.

The same logic decides two smaller things. A decision is refused outright if the subject moved
between the request and the decision — recording it against the requested version misattributes it,
and recording it against the current one claims the approver reviewed a request nobody showed them.
And a stale approval does not count towards a multi-party sign-off, or the gate could be satisfied by
decisions made about a version nobody is shipping.

Sign-off requires **every** named role, not any one of them. "Any of" is how a multi-party sign-off
quietly becomes a single-party one: the fastest approver clears it and the others never look.

### Absent rather than present-and-unused

§29.1 names two more baseline types as "optional later". They are not in the enum.

An enum member nothing produces looks like a supported feature to everyone reading the type, and the
first person to select it discovers it does nothing. The same reasoning removed `ASSERTION` from the
verification methods in Phase 10 and kept `NOT_CHECKED` meaningful in Phase 11 — a type that offers a
choice the system does not honour is worse than one that offers fewer.

SVG is absent from the upload allowlist for a different reason and with the same shape: it is an image
to a user and a script host to a browser, and it is the single most common way an image upload becomes
stored cross-site scripting.

### Nothing surprising this time

For the first phase in five, no defect was found only in the rendered page. The seventy-two unit tests
passed on the first run, which in this project is unusual enough to be worth checking rather than
celebrating — hence planting the two violations to confirm the absence tests were not vacuous.

What that probably reflects is that this phase has less coupling than the last four. Traceability,
release readiness and impact all had to agree with a graph model that existed elsewhere, and every
defect came from assuming rather than reading it. Governance mostly defines its own shapes and builds
on primitives Phase 6 already tested.

### Where Phase 13 stands

1,826 unit tests and 624 E2E tests pass; format, lint, typecheck, generated-doc, secret-scan,
dependency-audit and production build are clean. `docs/GOVERNANCE_MODEL_SPEC.md` is the ninth
generated document.

The Phase-13 gate — immutable baseline plus evidence audit verified — is met by: the absence tests,
verified by planting violations; a tampered-baseline test proving the checksum detects modification
and removal; a redacted-log test proving the sequence survives a lawful erasure; and a
quarantine-retention test proving housekeeping cannot delete the record of tampering.

---

## Entry 018 — Phase 14: closing, and the strongest claim the platform makes

The Phase-14 gate reads: *a project can formally close only when criteria pass or accepted exceptions
exist.* The first clause is ordinary. The second is one careless implementation away from being a
bypass, and a bypass here matters more than anywhere else, because "this project closed successfully"
is the strongest claim this platform ever makes about anything.

### Closure exceptions are held higher than release exceptions

Phase 11 built exceptions that expire, are owned, and are named on the gate result. Those properties
are right for a release, where somebody will review the exception in a month.

At closure there is nobody left to review anything, so the same shape would be wrong. The differences:

- **Permanent, with no expiry.** A closure exception is a statement rather than a deferral, and it
  has to be written as one.
- **Accepted by somebody other than the person closing the project.** Accepting your own exception on
  the way out records a decision with nobody independent behind it — and the record looks complete,
  which is what makes it worse than no exception at all.
- **A consequence, not just a reason.** A reason explains the outgoing team's decision. A consequence
  tells the incoming team what it means for them, and they are the only people who will ever read it.

I gave this its own type rather than reusing `@govintel/release/testing`'s `Exception`. Sharing it
would have meant either an expiry nobody honours or a nullable field that quietly makes release
exceptions permanent too.

And a malformed exception excuses nothing. Otherwise the highest-standard gate in the platform could
be cleared by an exception with no reason, no owner and no consequence — which is not an accepted
exception, it is a blank line where one should be.

### The distinction I nearly missed

Criteria have four outcomes here, not three: met, not met, **excepted**, and **unknown**.

The fourth came from asking what an exception is actually for. An exception accepts a shortfall
somebody knows about. If a criterion cannot be evaluated at all — because, say, some requirements
record no way of being verified, so whether they were met is undecidable in either direction — then
there is nothing to accept, and letting an exception cover it turns *"we could not tell"* into *"we
decided it was fine"*.

That is the more dangerous of the two by a long way, and the two look identical on a closure record.
So `UNKNOWN` cannot be excepted, and the message says why: the underlying question has to be answered
first.

I planted the defect afterwards — collapsing `UNKNOWN` into `NOT_MET` so an exception could reach it —
and two tests fail, one of them by name.

### Archiving is not a way around the gate

Archiving a project as **cancelled** is always allowed. Work gets cancelled; clients leave; the record
is the most useful thing that survives, because somebody will ask why.

Archiving it as **completed** is a claim about the project — the same claim the closure criteria
decide. So that specific combination is refused unless closure was assessed. Without that refusal the
closure gate is optional, reachable by anybody who prefers the archive button.

The related refusal: archiving cannot proceed while evidence under a regulatory or indefinite
retention obligation is quarantined. That obligation does not end because the project did, and
archiving with the evidence unusable satisfies the letter of retention while defeating it — invisibly,
until somebody asks for the evidence and it is not usable.

Note that the rule is about the *obligation*, not the quarantine. Blocking on every quarantined record
would make archiving impossible for any project that ever found a hash mismatch, which is a rule
people would route around.

### Lessons that transfer

Most retrospective records are worthless, and the reason is not that people write them badly. The
format does not demand the thing that makes a lesson usable, so what gets recorded is a feeling —
"communication could have been better", "we underestimated" — and a feeling cannot be applied by
somebody who was not there.

Four parts, three of them required: what was **expected**, what **happened**, **why** they differed,
and what would be done **differently**.

The expectation is the one people skip and the one that decides everything. Without it there is no way
to tell whether the outcome was a surprise, a known risk that materialised, or exactly what everybody
predicted and nobody acted on — and those need completely different responses.

The fourth part has a check that catches intentions dressed as actions: "be more careful with
estimates" against "obtain a real sample file before estimating any import". It is **advisory**, for
the same reason the subjective-wording check in Phase 10 is advisory — a rule that rejects real
writing gets worked around, and the workaround produces worse lessons that pass the check.

There is also a `WORKED` category, and a retrospective with nothing in it is reported. A retrospective
recording only failures teaches the next team what to avoid and nothing about what to repeat, and it
makes the exercise something people dread, which is how retrospectives stop happening.

### A small type-system lesson

The test asserting closure blocks with no retrospective originally wrote `retrospective: undefined`.
That fails under `exactOptionalPropertyTypes`, which distinguishes *absent* from *present and
undefined*.

The fix was to build the fixture by omission — and it is the better test for a reason beyond
appeasing the compiler. The module checks `=== undefined`, and callers can only ever produce the
absent form. A test that could only construct the other one would be exercising a case the type
system forbids.

### Where Phase 14 stands

1,868 unit tests and 648 E2E tests pass; format, lint, typecheck, generated-doc, secret-scan,
dependency-audit and production build are clean.

The Phase-14 gate — a project can formally close only when criteria pass or accepted exceptions exist
— is met, with the second clause held to a standard that stops it becoming the first clause's
loophole: malformed exceptions excuse nothing, self-accepted ones are refused, undecidable criteria
cannot be excepted at all, and a project resting on exceptions never renders identically to one
resting on none.
