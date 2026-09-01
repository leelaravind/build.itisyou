# PROJECT DIGITAL TWIN SCHEMA

> **Generated file — do not edit by hand.**
> Source of truth: `packages/twin/src/`. Regenerate with `pnpm docs:twin`.
> CI runs `pnpm docs:twin --check` and fails if this file has drifted from the code.

**Contract:** `IMPLEMENTATION_GAP_CLOSURE_SPEC.md` §8 (canonical contract, node and edge classes,
graph invariants, versioning); `MASTER_IMPLEMENTATION_PLAN.md` §6 (Phase 6) and §34 (the gate:
deterministic generation from a golden fixture).

---

## 1. What this is

The Digital Twin is the **canonical project graph**, not a view over one. Every calculation, gate,
report and document in the platform reads from it. That is the reason the taxonomy below is closed
and the legality matrix is an allowlist: a graph in which anything can relate to anything cannot
support a traceability claim, and it looks identical to one that can.

Two properties follow from that, and both are enforced rather than documented:

- **Nodes carry provenance, not just data.** A graph that cannot distinguish "the user confirmed
  this" from "an AI inferred it" cannot honestly explain any number computed from it.
- **Identity is stable; content is versioned.** A node id never changes. History lives in the change
  log and in baselines, never in duplicated node rows — gap-spec §8.4 is explicit that versioning
  must not copy the database.

---

## 2. Node classes (32)

| Class | Reads as | May contain | Notes |
|---|---|---|---|
| `PROJECT` | project | `OBJECTIVE`, `REQUIREMENT`, `ARCHITECTURE_COMPONENT`, `ARCHITECTURE_DECISION`, `PHASE`, `WORKSTREAM`, `MILESTONE`, `RESOURCE`, `BUDGET_ITEM`, `RISK`, `BLOCKER`, `GATE`, `TEST`, `EVIDENCE`, `DOCUMENT`, `ENVIRONMENT`, `ASSUMPTION`, `UNKNOWN`, `CHANGE_REQUEST`, `BASELINE`, `SCENARIO`, `FORECAST`, `INCIDENT`, `OPERATIONAL_TASK` | — |
| `OBJECTIVE` | objective | — | — |
| `REQUIREMENT` | requirement | `REQUIREMENT` | — |
| `ARCHITECTURE_COMPONENT` | architecture component | `ARCHITECTURE_COMPONENT` | — |
| `ARCHITECTURE_DECISION` | architecture decision | — | — |
| `PHASE` | phase | `WORKSTREAM`, `MILESTONE`, `EPIC`, `TASK`, `CHECKPOINT`, `GATE` | — |
| `WORKSTREAM` | workstream | `MILESTONE`, `EPIC`, `TASK`, `CHECKPOINT` | — |
| `MILESTONE` | milestone | `EPIC`, `TASK`, `CHECKPOINT` | — |
| `EPIC` | epic | `TASK`, `CHECKPOINT` | — |
| `TASK` | task | `SUBTASK` | — |
| `SUBTASK` | subtask | — | — |
| `CHECKPOINT` | checkpoint | — | — |
| `RESOURCE` | resource | — | — |
| `BUDGET_ITEM` | budget item | `BUDGET_ITEM` | — |
| `ESTIMATE` | estimate | — | — |
| `RISK` | risk | — | — |
| `BLOCKER` | blocker | — | — |
| `TEST` | test | — | — |
| `EVIDENCE` | evidence | — | immutable |
| `GATE` | gate | — | — |
| `APPROVAL` | approval | — | immutable |
| `DOCUMENT` | document | — | — |
| `DEPLOYMENT` | deployment | — | — |
| `ENVIRONMENT` | environment | — | — |
| `INCIDENT` | incident | — | — |
| `OPERATIONAL_TASK` | operational task | — | — |
| `ASSUMPTION` | assumption | — | uncertainty |
| `UNKNOWN` | unknown | — | uncertainty |
| `CHANGE_REQUEST` | change request | — | — |
| `BASELINE` | baseline | — | immutable |
| `SCENARIO` | scenario | `FORECAST` | — |
| `FORECAST` | forecast | — | — |

**Node states:** `ACTIVE`, `SUPERSEDED`, `WITHDRAWN`.

A superseded node stays in the graph. The record is of what was believed, not only of what is
believed now.

### Immutable classes

- `BASELINE`
- `EVIDENCE`
- `APPROVAL`

Immutability is enforced in three places: `applyNodeChange` throws, `checkInvariants` reports
`IMMUTABLE_NODE_CHANGED`, and the database refuses the write. The guarantee should not rest on any
one of them being correct.

---

## 3. Edge classes (17)

| Class | Reads as | Legal pairings | Notes |
|---|---|--:|---|
| `CONTAINS` | "cannot contain" | 44 | acyclic, at most one |
| `DEPENDS_ON` | "cannot depend on" | 31 | acyclic |
| `BLOCKS` | "cannot block" | 37 | acyclic |
| `IMPLEMENTS` | "cannot implement" | 8 | — |
| `SATISFIES` | "cannot satisfy" | 5 | — |
| `DERIVED_FROM` | "cannot be derived from" | 35 | acyclic |
| `VERIFIES` | "cannot verify" | 12 | — |
| `EVIDENCED_BY` | "cannot be evidenced by" | 9 | — |
| `OWNED_BY` | "cannot be owned by" | 14 | at most one |
| `ASSIGNED_TO` | "cannot be assigned to" | 6 | — |
| `FUNDED_BY` | "cannot be funded by" | 7 | — |
| `MITIGATES` | "cannot mitigate" | 8 | — |
| `IMPACTS` | "cannot impact" | 28 | — |
| `DEPLOYS_TO` | "cannot deploy to" | 2 | — |
| `APPROVED_BY` | "cannot be approved by" | 6 | — |
| `INVALIDATES` | "cannot invalidate" | 17 | — |
| `SUPERSEDES` | "cannot supersede" | 10 | acyclic |

**Acyclic:** `CONTAINS`, `DEPENDS_ON`, `BLOCKS`, `DERIVED_FROM`, `SUPERSEDES` — a cycle in any of these is an error, not a
warning. A containment loop is a hierarchy with no root; a `BLOCKS` loop is a deadlock the plan
would otherwise present as a schedule.

**At most one:** `CONTAINS`, `OWNED_BY` — two parents means every roll-up counts
the node twice, silently.

---

## 4. Legality matrix

Deny by default. Of 17408 possible `(edge class, from, to)` combinations,
**279** are legal — 1.6%.

The two rules gap-spec §8.3 names explicitly:

- A `TEST` **may** `VERIFIES` a `REQUIREMENT`.
- A `TASK` **may not**. Work near a requirement is not evidence that it is met, and a
  traceability matrix that conflates the two produces a compliance report that is confidently wrong.

#### `CONTAINS`

| From | May point at |
|---|---|
| `PROJECT` | `OBJECTIVE`, `REQUIREMENT`, `ARCHITECTURE_COMPONENT`, `ARCHITECTURE_DECISION`, `PHASE`, `WORKSTREAM`, `MILESTONE`, `RESOURCE`, `BUDGET_ITEM`, `RISK`, `BLOCKER`, `GATE`, `TEST`, `EVIDENCE`, `DOCUMENT`, `ENVIRONMENT`, `ASSUMPTION`, `UNKNOWN`, `CHANGE_REQUEST`, `BASELINE`, `SCENARIO`, `FORECAST`, `INCIDENT`, `OPERATIONAL_TASK` |
| `REQUIREMENT` | `REQUIREMENT` |
| `ARCHITECTURE_COMPONENT` | `ARCHITECTURE_COMPONENT` |
| `PHASE` | `WORKSTREAM`, `MILESTONE`, `EPIC`, `TASK`, `CHECKPOINT`, `GATE` |
| `WORKSTREAM` | `MILESTONE`, `EPIC`, `TASK`, `CHECKPOINT` |
| `MILESTONE` | `EPIC`, `TASK`, `CHECKPOINT` |
| `EPIC` | `TASK`, `CHECKPOINT` |
| `TASK` | `SUBTASK` |
| `BUDGET_ITEM` | `BUDGET_ITEM` |
| `SCENARIO` | `FORECAST` |

Anything not listed is refused. 44 of 1024 possible pairings are legal.

#### `DEPENDS_ON`

| From | May point at |
|---|---|
| `REQUIREMENT` | `REQUIREMENT` |
| `ARCHITECTURE_COMPONENT` | `ARCHITECTURE_COMPONENT` |
| `PHASE` | `PHASE`, `MILESTONE`, `GATE` |
| `WORKSTREAM` | `WORKSTREAM`, `PHASE` |
| `MILESTONE` | `MILESTONE`, `PHASE`, `EPIC`, `TASK`, `GATE` |
| `EPIC` | `EPIC`, `TASK`, `REQUIREMENT` |
| `TASK` | `TASK`, `SUBTASK`, `EPIC`, `ARCHITECTURE_COMPONENT` |
| `SUBTASK` | `SUBTASK`, `TASK`, `ARCHITECTURE_COMPONENT` |
| `CHECKPOINT` | `CHECKPOINT`, `TASK`, `MILESTONE` |
| `DEPLOYMENT` | `DEPLOYMENT`, `GATE`, `ENVIRONMENT`, `ARCHITECTURE_COMPONENT` |
| `OPERATIONAL_TASK` | `OPERATIONAL_TASK`, `TASK` |

Anything not listed is refused. 31 of 1024 possible pairings are legal.

#### `BLOCKS`

| From | May point at |
|---|---|
| `TASK` | `PHASE`, `WORKSTREAM`, `MILESTONE`, `EPIC`, `TASK`, `SUBTASK`, `CHECKPOINT`, `OPERATIONAL_TASK` |
| `RISK` | `PHASE`, `WORKSTREAM`, `MILESTONE`, `EPIC`, `TASK`, `SUBTASK`, `CHECKPOINT`, `OPERATIONAL_TASK` |
| `BLOCKER` | `PHASE`, `WORKSTREAM`, `MILESTONE`, `EPIC`, `TASK`, `SUBTASK`, `CHECKPOINT`, `OPERATIONAL_TASK`, `REQUIREMENT`, `OBJECTIVE`, `DEPLOYMENT`, `GATE` |
| `INCIDENT` | `PHASE`, `WORKSTREAM`, `MILESTONE`, `EPIC`, `TASK`, `SUBTASK`, `CHECKPOINT`, `OPERATIONAL_TASK`, `DEPLOYMENT` |

Anything not listed is refused. 37 of 1024 possible pairings are legal.

#### `IMPLEMENTS`

| From | May point at |
|---|---|
| `ARCHITECTURE_COMPONENT` | `REQUIREMENT`, `ARCHITECTURE_DECISION` |
| `EPIC` | `REQUIREMENT`, `OBJECTIVE` |
| `TASK` | `REQUIREMENT`, `OBJECTIVE` |
| `SUBTASK` | `REQUIREMENT` |
| `DEPLOYMENT` | `REQUIREMENT` |

Anything not listed is refused. 8 of 1024 possible pairings are legal.

#### `SATISFIES`

| From | May point at |
|---|---|
| `REQUIREMENT` | `OBJECTIVE` |
| `EVIDENCE` | `REQUIREMENT` |
| `GATE` | `REQUIREMENT`, `OBJECTIVE` |
| `DOCUMENT` | `REQUIREMENT` |

Anything not listed is refused. 5 of 1024 possible pairings are legal.

#### `DERIVED_FROM`

| From | May point at |
|---|---|
| `OBJECTIVE` | `DOCUMENT`, `ASSUMPTION` |
| `REQUIREMENT` | `OBJECTIVE`, `REQUIREMENT`, `ASSUMPTION`, `DOCUMENT`, `CHANGE_REQUEST` |
| `ARCHITECTURE_COMPONENT` | `ARCHITECTURE_DECISION` |
| `ARCHITECTURE_DECISION` | `REQUIREMENT`, `ASSUMPTION`, `RISK` |
| `PHASE` | `REQUIREMENT`, `OBJECTIVE`, `SCENARIO` |
| `EPIC` | `REQUIREMENT` |
| `TASK` | `REQUIREMENT`, `EPIC` |
| `BUDGET_ITEM` | `ESTIMATE`, `RESOURCE`, `ASSUMPTION` |
| `ESTIMATE` | `TASK`, `EPIC`, `PHASE`, `REQUIREMENT`, `ASSUMPTION`, `RESOURCE` |
| `RISK` | `ASSUMPTION`, `UNKNOWN`, `REQUIREMENT` |
| `ASSUMPTION` | `UNKNOWN` |
| `SCENARIO` | `BASELINE`, `FORECAST` |
| `FORECAST` | `ESTIMATE`, `SCENARIO`, `BASELINE` |

Anything not listed is refused. 35 of 1024 possible pairings are legal.

#### `VERIFIES`

| From | May point at |
|---|---|
| `TEST` | `REQUIREMENT`, `OBJECTIVE`, `ARCHITECTURE_COMPONENT`, `MILESTONE` |
| `GATE` | `REQUIREMENT`, `PHASE`, `MILESTONE`, `DEPLOYMENT` |
| `APPROVAL` | `GATE`, `MILESTONE`, `CHANGE_REQUEST`, `BASELINE` |

Anything not listed is refused. 12 of 1024 possible pairings are legal.

#### `EVIDENCED_BY`

| From | May point at |
|---|---|
| `REQUIREMENT` | `EVIDENCE`, `TEST` |
| `MILESTONE` | `EVIDENCE` |
| `ESTIMATE` | `EVIDENCE` |
| `TEST` | `EVIDENCE` |
| `GATE` | `EVIDENCE` |
| `APPROVAL` | `EVIDENCE` |
| `DEPLOYMENT` | `EVIDENCE` |
| `INCIDENT` | `EVIDENCE` |

Anything not listed is refused. 9 of 1024 possible pairings are legal.

#### `OWNED_BY`

| From | May point at |
|---|---|
| `PROJECT` | `RESOURCE` |
| `OBJECTIVE` | `RESOURCE` |
| `REQUIREMENT` | `RESOURCE` |
| `PHASE` | `RESOURCE` |
| `WORKSTREAM` | `RESOURCE` |
| `EPIC` | `RESOURCE` |
| `TASK` | `RESOURCE` |
| `RISK` | `RESOURCE` |
| `BLOCKER` | `RESOURCE` |
| `GATE` | `RESOURCE` |
| `DOCUMENT` | `RESOURCE` |
| `INCIDENT` | `RESOURCE` |
| `OPERATIONAL_TASK` | `RESOURCE` |
| `CHANGE_REQUEST` | `RESOURCE` |

Anything not listed is refused. 14 of 1024 possible pairings are legal.

#### `ASSIGNED_TO`

| From | May point at |
|---|---|
| `EPIC` | `RESOURCE` |
| `TASK` | `RESOURCE` |
| `SUBTASK` | `RESOURCE` |
| `CHECKPOINT` | `RESOURCE` |
| `INCIDENT` | `RESOURCE` |
| `OPERATIONAL_TASK` | `RESOURCE` |

Anything not listed is refused. 6 of 1024 possible pairings are legal.

#### `FUNDED_BY`

| From | May point at |
|---|---|
| `PHASE` | `BUDGET_ITEM` |
| `WORKSTREAM` | `BUDGET_ITEM` |
| `EPIC` | `BUDGET_ITEM` |
| `TASK` | `BUDGET_ITEM` |
| `RESOURCE` | `BUDGET_ITEM` |
| `DEPLOYMENT` | `BUDGET_ITEM` |
| `OPERATIONAL_TASK` | `BUDGET_ITEM` |

Anything not listed is refused. 7 of 1024 possible pairings are legal.

#### `MITIGATES`

| From | May point at |
|---|---|
| `REQUIREMENT` | `RISK` |
| `ARCHITECTURE_DECISION` | `RISK` |
| `EPIC` | `RISK` |
| `TASK` | `RISK` |
| `TEST` | `RISK` |
| `GATE` | `RISK` |
| `OPERATIONAL_TASK` | `RISK`, `INCIDENT` |

Anything not listed is refused. 8 of 1024 possible pairings are legal.

#### `IMPACTS`

| From | May point at |
|---|---|
| `RISK` | `MILESTONE`, `BUDGET_ITEM`, `ESTIMATE`, `OBJECTIVE`, `PHASE` |
| `INCIDENT` | `ENVIRONMENT`, `DEPLOYMENT`, `MILESTONE`, `OBJECTIVE` |
| `ASSUMPTION` | `ESTIMATE`, `REQUIREMENT`, `PHASE`, `BUDGET_ITEM`, `FORECAST` |
| `UNKNOWN` | `ESTIMATE`, `REQUIREMENT`, `PHASE`, `BUDGET_ITEM` |
| `CHANGE_REQUEST` | `REQUIREMENT`, `OBJECTIVE`, `PHASE`, `EPIC`, `TASK`, `BUDGET_ITEM`, `ESTIMATE`, `MILESTONE`, `ARCHITECTURE_COMPONENT`, `BASELINE` |

Anything not listed is refused. 28 of 1024 possible pairings are legal.

#### `DEPLOYS_TO`

| From | May point at |
|---|---|
| `ARCHITECTURE_COMPONENT` | `ENVIRONMENT` |
| `DEPLOYMENT` | `ENVIRONMENT` |

Anything not listed is refused. 2 of 1024 possible pairings are legal.

#### `APPROVED_BY`

| From | May point at |
|---|---|
| `MILESTONE` | `APPROVAL` |
| `GATE` | `APPROVAL` |
| `DOCUMENT` | `APPROVAL` |
| `DEPLOYMENT` | `APPROVAL` |
| `CHANGE_REQUEST` | `APPROVAL` |
| `BASELINE` | `APPROVAL` |

Anything not listed is refused. 6 of 1024 possible pairings are legal.

#### `INVALIDATES`

| From | May point at |
|---|---|
| `REQUIREMENT` | `TEST`, `GATE` |
| `TEST` | `GATE`, `APPROVAL` |
| `EVIDENCE` | `GATE`, `APPROVAL`, `TEST` |
| `INCIDENT` | `GATE`, `APPROVAL`, `DEPLOYMENT` |
| `CHANGE_REQUEST` | `GATE`, `APPROVAL`, `BASELINE`, `EVIDENCE`, `TEST`, `ESTIMATE`, `FORECAST` |

Anything not listed is refused. 17 of 1024 possible pairings are legal.

#### `SUPERSEDES`

| From | May point at |
|---|---|
| `REQUIREMENT` | `REQUIREMENT` |
| `ARCHITECTURE_DECISION` | `ARCHITECTURE_DECISION` |
| `PHASE` | `PHASE` |
| `ESTIMATE` | `ESTIMATE` |
| `DOCUMENT` | `DOCUMENT` |
| `ASSUMPTION` | `ASSUMPTION`, `UNKNOWN` |
| `BASELINE` | `BASELINE` |
| `SCENARIO` | `SCENARIO` |
| `FORECAST` | `FORECAST` |

Anything not listed is refused. 10 of 1024 possible pairings are legal.


---

## 5. Graph invariants

Checked across the whole graph, not at the point of a single mutation — acyclicity, single parentage
and gate staleness can each be broken by an edge that was individually legal.

| Code | Severity | What it catches |
|---|---|---|
| `ILLEGAL_EDGE` | error | A pairing the legality matrix refuses |
| `SELF_REFERENCE` | error | A node related to itself |
| `CYCLE` | error | A loop in an acyclic relation |
| `MULTIPLE_PARENTS` | error | Two containers or two owners |
| `ORPHANED_NODE` | warning | Outside the structure, so absent from every total |
| `IMMUTABLE_NODE_CHANGED` | error | An edit to a baseline, evidence or approval |
| `ARCHIVED_PROJECT_MUTATED` | error | A change to an archived project |
| `STALE_GATE` | error | A passed gate whose basis has since changed |
| `UNVERIFIED_REQUIREMENT` | warning | Nothing tests it |
| `CROSS_PROJECT_EDGE` | error | A node from another tenant |

10 codes, each with a message written for the project owner rather
than for a log.

### Gate staleness

Gap-spec §8.3: *"a completed gate cannot silently change when source evidence changes; it becomes
stale/revalidation-required."*

The word doing the work is **silently**. The gate's own recorded result is left alone — reopening it
automatically would destroy the record of what was concluded and when, and a compliance trail that
rewrites itself is not a trail. What changes is that the graph now reports the conclusion is no
longer safe to rely on, via an `INVALIDATES` edge.

---

## 6. Versioning

Gap-spec §8.4 forbids copying the database per version. Three mechanisms, each answering a different
question:

| Question | Mechanism |
|---|---|
| What is true now? | The nodes and edges. One row per entity. |
| What changed, when, why, by whom? | The change log — one entry per material change. |
| What did we commit to at that moment? | A baseline: a complete, immutable, checksummed snapshot. |

**Change kinds:** `NODE_CREATED`, `NODE_UPDATED`, `NODE_SUPERSEDED`, `NODE_WITHDRAWN`, `EDGE_CREATED`, `EDGE_REMOVED`.

A baseline *is* a full copy, deliberately. What §8.4 forbids is copying on every change; a baseline
is taken when a plan is agreed — a handful of times in a project's life — and must be self-contained,
because its purpose is to remain readable once everything it referred to has moved on.

Its SHA-256 checksum is computed over a canonical serialisation with sorted keys, excluding
timestamps and revision counts. Two graphs with identical content hash identically regardless of
construction order; any later edit is detectable.

### Calculation snapshots

A stored figure records its formula version, its inputs, the nodes it depended on, and the
assumptions it had to make. Without those, "the budget said £180,000" cannot be explained six months
later — and carries an authority it has not earned.

---

## 7. Deterministic generation

**Generator version:** 1.0.0.

The Phase-6 gate is deterministic generation from a golden fixture. Three things are therefore banned
in `generate.ts`, and each ban is load-bearing:

- **No `Date.now()`.** The timestamp is an input.
- **No random ids.** Node ids derive from a stable path (`…:req:accessibility`), so two runs
  produce comparable plans and the change log stays meaningful across regeneration.
- **No unordered iteration.** Everything walks declared order or sorts explicitly, including the
  topological sort's tie-break.

The suite asserts byte-identical output across ten consecutive runs for each of four fixtures, that
ids are stable and non-random, that the resulting graph satisfies every invariant — and that
different inputs produce different graphs, without which the other assertions would pass for a
generator that returned nothing.
