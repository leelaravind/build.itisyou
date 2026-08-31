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

<!-- Entries are appended below as work proceeds. Newest last. -->
