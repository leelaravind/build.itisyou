# CAPACITY AND ESTIMATION CALCULATION SPECIFICATION

> **Generated file — do not edit by hand.**
> Source of truth: `packages/execution/src/scheduling.ts`, `packages/finance/src/estimate.ts`.
> Regenerate with `pnpm docs:calc`. CI runs `pnpm docs:calc --check`.

**Contract:** `IMPLEMENTATION_GAP_CLOSURE_SPEC.md` §18 (resource model), §19 (capacity) and §20
(estimation); `MASTER_IMPLEMENTATION_PLAN.md` §12.3 (no fake precision).

**Estimator version:** 1.0.0

---

## 1. Available capacity

§19's formula:

    Available Capacity = Working Hours
                       − Leave
                       − Non-project allocation
                       − Meetings/overhead allowance
                       − Operational/support commitment

Every subtraction in that list is something plans routinely omit, and each omission points the same
way: a schedule built on nominal headcount is wrong from the first week and the error compounds.

**Each deduction is itemised rather than folded into a single factor.** "You have 22 hours" invites
disagreement with no way to locate it; "37.5, minus 4.5 leave, minus 7.5 overhead, minus 3.75 other
projects" locates the disagreement precisely.

### Defaults

Applied only where a figure was not supplied, and every result that uses one says so.

| Deduction | Default | Why |
|---|--:|---|
| Leave and sickness | 12% | Statutory leave and ordinary sickness across a year. |
| Meetings and overhead | 20% | Meetings, administration, reviewing other people's work, and interruption. |

### Order of operations

Allocation is applied **last, to what remains**. Applying it first would deduct a full person's
overhead from a half person's time, which produces a negative figure for anyone below about half
allocation.

Splitting a person across projects costs more than the arithmetic suggests. That is recorded as an
assumption on the result rather than applied as a factor: the size of the effect is disputed, and
applying an unmeasured number would be inventing precision.

---

## 2. What the scheduler refuses to let pass

§19 requires detecting overload, impossible parallel assignments, missing skill coverage and
single-person bottlenecks. The full set:

- `OVERLOAD`
- `IMPOSSIBLE_PARALLELISM`
- `MISSING_SKILL`
- `SINGLE_PERSON_BOTTLENECK`
- `NO_CAPACITY`
- `UNASSIGNED_WORK`

Two distinctions worth stating:

- **Overload is an error when even the optimistic estimate does not fit**, and a warning when it fits
  only if everything goes well. The second is not a plan, but it is not arithmetic impossibility
  either, and reporting both identically teaches people to ignore the category.
- **Unassigned work is not reported for a solo project.** Assigning every task to the only person is
  the "useless assignment bureaucracy" §18.3 says to avoid.

---

## 3. AI tools are capabilities, not employees

§18.2 is explicit, and the distinction is not pedantic. A capability changes how fast some work goes;
an employee can be assigned accountability.

So an AI capability has **no role, no assignments, and no way to own anything** — §18.2 says directly
that an AI tool "does not own approvals" and "cannot be responsible for legally required human
accountability".

Its effect on effort is a **range**, and it is reported as an assumption rather than added to the
hours available. Folding an unmeasured multiplier into a capacity figure would turn a disputed effect
into something that looks like a measurement.

---

## 4. Estimation

§20 opens with: **"Do not pretend to know exact delivery time."**

Every estimate is three points — optimistic, expected, conservative — and there is no single-figure
accessor anywhere in the interface. The moment one exists, everyone downstream uses it and the range
becomes decoration.

### Base hours by complexity

Conventions, not measurements. Every estimate that uses them says so.

| Complexity | Optimistic | Expected | Conservative | Spread |
|---|--:|--:|--:|--:|
| `TRIVIAL` | 0.5 | 1 | 2 | 4.0× |
| `SMALL` | 2 | 4 | 8 | 4.0× |
| `MEDIUM` | 8 | 16 | 32 | 4.0× |
| `LARGE` | 24 | 56 | 120 | 5.0× |
| `UNKNOWN` | 4 | 40 | 160 | 40.0× |

The band on `UNKNOWN` is deliberately enormous. That is what "we have not looked at this"
actually means, and narrowing it to something comfortable would be inventing knowledge — the
discomfort of the number is the signal that the item needs sizing.

### Adjustments

Separate from the base figure, each carrying its own explanation, so a finished estimate reads as an
argument rather than as a number. "Ninety hours" is unarguable; "sixteen base, doubled for unfamiliar
technology, plus twenty per cent rework" can be disagreed with in exactly one place.

| Adjustment | Optimistic | Expected | Conservative | Why |
|---|--:|--:|--:|---|
| `UNFAMILIAR_TECHNOLOGY` | 1.2× | 1.6× | 2.5× | The technology is new to whoever is doing the work. Learning time is real time, and it is usually planned as though it were zero. |
| `EXISTING_CODEBASE` | 1.1× | 1.4× | 2× | Working inside an existing system means discovering undocumented behaviour that something depends on. |
| `REWORK_ALLOWANCE` | 1.05× | 1.2× | 1.4× | Review feedback, changed understanding and defects found in verification all produce real work that estimates systematically omit. |
| `COMPLIANCE_EVIDENCE` | 1.1× | 1.3× | 1.6× | Compliance work is mostly evidence collection, and evidence gathered as you go still takes time that feature estimates do not include. |
| `HIGH_AVAILABILITY` | 1.15× | 1.4× | 1.8× | Redundancy, failover and the testing that proves either work are additional to the feature itself. |
| `ACCESSIBILITY_RETROFIT` | 3× | 5× | 10× | Accessibility added after the design is finished means reworking markup, focus order and colour decisions across every page. |
| `AI_ASSISTED` | 0.5× | 0.8× | 1× | An AI coding tool is available. The effect varies enormously by task and nobody has measured it for this team on this codebase, so the range widens as well as shifting. |

An adjustment the engine does not recognise is **refused, not ignored**. Silently dropping one would
produce an estimate that is quietly too low, and the omission would be invisible.

### Confidence

`LOW`, `MEDIUM`, `HIGH` — derived from the width of the range rather than asserted.
A range spanning a factor of four is not a high-confidence estimate no matter how carefully it was
produced, and letting a caller declare confidence independently would let the two disagree.

| Spread (conservative ÷ optimistic) | Confidence |
|---|---|
| ≤ 2.5× | HIGH |
| ≤ 5× | MEDIUM |
| > 5× | LOW |

### Aggregation

Points are summed **independently**, which is the conservative choice: it assumes everything goes
badly together at the conservative end and well together at the optimistic one.

A statistical roll-up would produce a narrower and more flattering range, and it assumes the estimates
are independent. They are not — projects go wrong for reasons that affect many tasks at once: a wrong
architectural assumption, a departure, a dependency that turned out harder. Narrowing the range on an
independence assumption that does not hold is precisely the fake precision §20 opens by forbidding.

The confidence of a total is the **lowest** of its parts, not an average. A total containing one
unsized item is not medium-confidence because everything else was well understood.

### Provenance (§20.4)

Every estimate records its source, formula, engine version, assumptions, inputs, and whether it was
manually overridden and why. An override is *supported* rather than prevented — a system that refuses
human judgement gets worked around, and the workaround leaves no record at all — but the reason is
mandatory.

---

## 5. What this never produces

**A delivery date.** A date computed from ranges is fake precision with a calendar attached. What the
engine produces is a range of effort, a range of capacity, and the assumptions behind both.
