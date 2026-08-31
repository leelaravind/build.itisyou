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

<!-- Entries are appended below as work proceeds. Newest last. -->
