# IMPACT PROPAGATION SPECIFICATION

> **Generated file — do not edit by hand.**
> Source of truth: `packages/change/src/{propagation,impact,request}.ts`.
> Regenerate with `pnpm docs:impact`. CI runs `pnpm docs:impact --check`.

**Contract:** `IMPLEMENTATION_GAP_CLOSURE_SPEC.md` §26 (dependency graph), §27 (impact propagation),
§27.1 (staleness), §28 (change request atomicity); `MASTER_IMPLEMENTATION_PLAN.md` Phase 12.

**Impact engine version:** 1.0.0

---

## 1. Propagation is decided per relationship, and most do not

§27 requires that every relationship type defines *whether* change propagates. The obvious
implementation propagates through every edge, and it is useless: any change reports several dozen
affected items, everything in a project is eventually connected to everything, and people stop
reading impact reports by the third one they see.

So this is a **deny-by-default allowlist**, like edge legality and RBAC before it.
9 of the 17 edge classes carry no
propagation at all, and each absence is deliberate rather than an omission.

Two worth naming:

- `CONTAINS` does not propagate. A project containing a changed task is not itself stale, and
  propagating up containment makes every change reach the project root — from which everything is
  reachable.
- `OWNED_BY` does not propagate. Changing a requirement does not affect who owns it.

| Edge | Direction | Effect | Why |
|---|---|---|---|
| `CONTAINS` | — | **does not propagate** | — |
| `DEPENDS_ON` | inbound | `REVALIDATION_REQUIRED` | Something built on this may no longer be built on what it thought. The dependant is not wrong yet, and it cannot be assumed right. |
| `BLOCKS` | — | **does not propagate** | — |
| `IMPLEMENTS` | inbound | `REVALIDATION_REQUIRED` | Work built to meet a requirement that has since changed may be right, wrong, or half-right. Somebody has to compare it against the new version; the graph cannot. |
| `SATISFIES` | inbound | `REVALIDATION_REQUIRED` | What satisfied the old version may not satisfy the new one. |
| `DERIVED_FROM` | inbound | `STALE` | A derived value was computed from an input that has changed. It is reproducible, so it is stale rather than invalid — recalculating is cheap and the old value is still the record of what was believed. |
| `VERIFIES` | inbound | `INVALIDATED` | A test verifies a specific claim. When the claim changes, what the test demonstrated is no longer about the current requirement — it passed against something else. |
| `EVIDENCED_BY` | outbound | `STALE` | The artefact still records what happened when it was captured. Whether it still supports the claim depends on what changed, and that is a judgement rather than a deduction. |
| `OWNED_BY` | — | **does not propagate** | — |
| `ASSIGNED_TO` | — | **does not propagate** | — |
| `FUNDED_BY` | — | **does not propagate** | — |
| `MITIGATES` | outbound | `REVALIDATION_REQUIRED` | A mitigation was chosen for a risk as it stood. If the risk changed, whether the mitigation still addresses it is exactly the question nobody asks unless prompted. |
| `IMPACTS` | — | **does not propagate** | — |
| `DEPLOYS_TO` | — | **does not propagate** | — |
| `APPROVED_BY` | outbound | `INVALIDATED` | §33: an approval is a decision about a specific version of a subject. When the subject changes materially, the approver approved something else, and treating their decision as still standing would put their name on a choice they did not make. |
| `INVALIDATES` | — | **does not propagate** | — |
| `SUPERSEDES` | — | **does not propagate** | — |

**Direction** is relative to how the edge is stored. `inbound` means impact travels from the edge's
target to its source — a `TEST` *verifies* a `REQUIREMENT`, so when the requirement changes, impact
reaches the test by walking that edge backwards. Getting this wrong produces an impact report that is
confidently empty.

---

## 2. Staleness (§27.1)

> "Do not delete dependent evidence/results automatically."

| State | Meaning |
|---|---|
| `CURRENT` | Unaffected by this change. |
| `STALE` | Made against an older version. It may still hold; somebody has to look. |
| `REVALIDATION_REQUIRED` | Must be re-run or re-decided before it can be relied on again. Not necessarily wrong — unverifiable until somebody does the work. |
| `INVALIDATED` | No longer holds. What it demonstrated was about something that has since changed materially. |

The distinction doing the work is `STALE` versus `INVALIDATED`. Stale means the claim was made
against an older version and *might* still hold — somebody has to look. Invalidated means it
definitely does not hold any more. Collapsing them either buries real breakage in a pile of maybes,
or makes every change look like it destroyed the project.

Nothing is deleted. A marked artefact still carries what it showed and when, so a reviewer can decide
whether the change actually affected it; deleting it destroys the only record of what was true before.

---

## 3. Distance weakens severity, and reachability survives it

Each hop weakens the verdict by one step: `INVALIDATED` → `REVALIDATION_REQUIRED` → `STALE`.

But `STALE` is the **floor** for anything reachable within 4 hops through
propagating edges. An earlier version let severity decay all the way to nothing, which meant a
`STALE` rule produced no result at all beyond the first hop — and §27's own worked example,
"architecture component changed → costs", never arrived, because the estimate is two hops out through
`DERIVED_FROM`.

Flooring at stale is honest: the thing *is* downstream of a change, and stale means exactly "may
still hold; somebody has to look".

Impact reaching a node by two paths takes the **worse** verdict, never an average.

### Depth limit

Traversal stops at 4 hops, and the report says when it did. A truncated analysis
presented as complete is the specific way an impact tool lies: nobody can tell from the output that
something was left out.

The limit also guarantees termination independently of the visited set. `DEPENDS_ON` cycles are
invalid (§26.2) and they exist in real projects, and an impact analyser that hangs on one is useless
at exactly the moment somebody is trying to understand a mess.

---

## 4. Change kinds

`MATERIAL`, `COSMETIC`, `WITHDRAWAL`, `ADDITION`

`COSMETIC` propagates **nothing**. That single rule is what keeps impact reports worth reading: a
project where renaming a requirement invalidates its test suite produces reports that are mostly
noise, and a noisy report gets skimmed — including on the occasion it matters.

`ADDITION` propagates nothing either. Nothing pointed at it before it existed.

`WITHDRAWAL` escalates to `INVALIDATED` regardless of the edge. Dependants have not merely lost
currency; they have lost their subject.

---

## 5. What the report says

Every impacted node carries **the path that reached it**, hop by hop, each hop carrying the rule's own
reasoning.

"47 items affected" is a number nobody can act on or dispute. "The deployment approval needs
revalidating, because it approved a deployment that depends on a component you changed" is something a
reader can follow and disagree with. An impact analysis nobody can check is one people stop believing
the first time it is wrong, and after that it is worse than having none.

Counts are absolute. There is no proportion of the project anywhere in the output.

### Claim-bearing classes

`REQUIREMENT`, `ARCHITECTURE_DECISION`, `TEST`, `EVIDENCE`, `APPROVAL`, `GATE`, `BASELINE`, `DOCUMENT`, `DEPLOYMENT`, `ESTIMATE`, `BUDGET_ITEM`

These are ranked first within a severity, because a stale `EVIDENCE` is something somebody does
something about and a stale `PHASE` is something the impact passed through.

---

## 6. Change request atomicity (§28)

| State | Meaning | May become |
|---|---|---|
| `DRAFT` | Being written. Nothing has been calculated against it yet. | `PENDING_APPROVAL`, `REJECTED` |
| `PENDING_APPROVAL` | The impact has been calculated and shown, and somebody has to decide. | `APPROVED`, `REJECTED`, `SUPERSEDED` |
| `APPROVED` | Decided, and not yet applied. Still subject to the concurrency check. | `APPLIED`, `REJECTED`, `SUPERSEDED` |
| `APPLIED` | In the project, with a new version recorded. | — (terminal) |
| `REJECTED` | Somebody decided against it. That is a decision and it is retained. | — (terminal) |
| `SUPERSEDED` | The project moved on before this was applied. Not rejected — nobody decided against it — and no longer applicable, because the impact was calculated against a project that no longer exists. | — (terminal) |

`APPROVED → PENDING_APPROVAL` is deliberately **absent**. If the base version moves, the request
becomes `SUPERSEDED` and a new one is raised. Silently returning it to pending would let an approval
be reused across a project version it was never given against.

### The step that matters

§28 lists ten steps. Nine are ordinary. Step 5 — "check optimistic concurrency" — is the reason the
list exists:

> Somebody previews a change against version 12, goes to a meeting, comes back and approves it.
> Meanwhile the project is at version 15. Applying now applies a decision that was made about a
> different project. The approver saw an impact report that is no longer true, and their name ends up
> on a choice they did not make.

Nothing errors without the check. The change applies cleanly and the record looks complete.

A request whose base version has moved becomes `SUPERSEDED` rather than `REJECTED`. Nobody decided
against it; the world moved, and those need different follow-ups.

### The preview and the application share one plan

`plan()` produces it, the preview renders it, `apply()` executes it. A preview computed by separate
code from the application is a second implementation, and the first time the two diverge it surfaces
to a user as "the system did something other than what it showed me".

### Refusals

`ILLEGAL_TRANSITION`, `STALE_BASE_VERSION`, `NOT_APPROVED`, `NO_CHANGES`, `NO_RATIONALE`, `APPROVER_IS_REQUESTER`, `UNKNOWN_NODE`

`APPROVER_IS_REQUESTER` is worth naming: self-approval records a decision with nobody independent
behind it, which is worse than no approval at all, because the record looks complete.

### What needs approval

Not a size threshold. Nobody agrees on what counts as a big change, and a threshold is a number people
learn to stay under.

A change needs approval when it **invalidates something somebody already decided**, or breaks a claim
the project relies on, or withdraws something. All three are facts about the graph rather than
judgements about scale.

An approval is reported as invalidated only when **its own subject** changed. Two hops out it is
merely revalidation-required — the approver approved a deployment, and it is the deployment that
depends on what changed. Claiming at any distance to have voided somebody's decision is the point at
which approvers stop reading the notification.

### After the transaction

Follow-up work is **named rather than performed**. Running a notification inside the transaction means
a failed notification rolls back a successful change, which is the wrong trade in both directions: the
change is what matters, and a notification is retryable.
