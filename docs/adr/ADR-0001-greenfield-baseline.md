# ADR-0001 — Greenfield baseline and Phase-0 gate re-sequencing

- **Status:** Accepted
- **Date:** 2026-08-31
- **Phase:** 0
- **Supersedes:** none
- **Related:** `docs/REPOSITORY_AUDIT.md` §1, §7

---

## Context

`MASTER_IMPLEMENTATION_PLAN.md` is written on the premise that a repository already exists containing
generated Stitch code, a chosen framework, dependencies, CI and deployment configuration. §4.1 instructs
the agent to *identify* "current framework versions", "existing generated Stitch code", "existing CI/CD",
"TypeScript state" and "dependency health". §4.4 gates Phase 0 on "clean install works · build works ·
lint works · typecheck works · baseline tests run".

The actual repository at `E:\Project\build` contains:

- two specification documents,
- 50 Stitch design exports plus one design-system token spec,
- one `.claude/settings.local.json`,
- **zero** application source files, no manifest, no lockfile, no toolchain, no CI, no git history.

Gap-closure spec §0 requires that when the repository conflicts with the plan, the agent must identify
the conflict, record it, preserve product behaviour and architecture intent, choose the smallest
justified adaptation, update architecture documentation, test the adaptation, and never silently ignore
it. §82 additionally warns the agent must not assume "database already exists" or "authentication is
already chosen".

## Problem

Five of the ten Phase-0 gate criteria are **undefined** rather than passing or failing:

| Criterion | State against an empty tree |
|---|---|
| clean install works | undefined — nothing to install |
| build works | undefined — no build system |
| lint works | undefined — no config, no source |
| typecheck works | undefined — no TypeScript |
| baseline tests run | undefined — no runner, no tests |
| dependency scan complete | undefined — zero dependencies |

Declaring these "pass" would be fabricated evidence, which plan §38 forbids ("never fabricate test
results"). Declaring them "fail" would block the project on a condition that no amount of auditing can
satisfy, because the criteria measure a codebase that Phase 0 is not supposed to create.

## Decision

**Split the Phase-0 gate by evaluability.**

1. **Evaluated at the Phase-0 gate** (measurable against what physically exists):
   - repository understood and inventoried
   - design inventory exists
   - design token inventory exists
   - no secrets in repository
   - known issues and risks documented
   - conflicts with the plan documented

2. **Moved to the Phase-1 foundation gate** (require a codebase to be meaningful):
   - clean install works
   - build works
   - lint works
   - typecheck works
   - baseline tests run
   - dependency vulnerability scan complete

The plan already defines the Phase-1 gate as "green foundation pipeline" (§34), so these six criteria
land where the plan itself expects them. **Phase 1 may not be declared complete until all six are
genuinely green with recorded evidence.**

3. **Stack is chosen, not discovered.** Because there is no existing stack to inventory, the version
   inventory required by gap-spec §2.2 becomes a *decision record with rationale* rather than a survey.
   Versions are pinned explicitly and recorded in `docs/REPOSITORY_REALITY.md`, preferring versions
   already proven to work on this machine where a sibling project demonstrates them.

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| Declare the Phase-0 gate PASS with the five criteria marked pass | Fabricates evidence. Directly violates plan §38 and gap-spec §64/§82. |
| Declare the Phase-0 gate FAIL and stop for user input | The condition is unsatisfiable by auditing alone; stopping delivers nothing. Gap-spec §86 says to proceed automatically unless a genuine unresolved *product* decision makes implementation unsafe. This is a sequencing artefact, not a product decision. |
| Scaffold a minimal app inside Phase 0 so the criteria can pass | Blurs the phase boundary the plan draws, and the plan explicitly assigns scaffolding to Phase 1. Rejected as a larger adaptation than necessary. |
| Rewrite the plan's gate definition in place | Gap-spec §0 forbids silently rewriting the plan. An ADR is the sanctioned mechanism. |

## Consequences

**Positive**

- Phase 0 produces honest evidence and can complete.
- No gate criterion is dropped; each is enforced at the first point it is measurable.
- The stack decision becomes explicit and reviewable rather than an accident of what happened to exist.

**Negative / accepted cost**

- The Phase-1 gate carries more weight than the plan originally implied, and becomes the real
  "foundation is sound" checkpoint.
- Baseline comparison metrics (performance, accessibility, bundle size) have no historical value to
  compare against. First measurements at the Phase-2 shell gate become the baseline instead. Recorded as
  a known limitation.

**Verification**

- `docs/REPOSITORY_AUDIT.md` §5 records each baseline check with its true state, not an assumed one.
- The Phase-1 gate will record actual command output for all six deferred criteria before Phase 1 is
  marked complete.
