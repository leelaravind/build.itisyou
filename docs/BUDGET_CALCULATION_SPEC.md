# BUDGET CALCULATION SPECIFICATION

> **Generated file — do not edit by hand.**
> Source of truth: `packages/finance/src/money.ts`, `budget.ts`, `feasibility.ts`.
> Regenerate with `pnpm docs:calc`. CI runs `pnpm docs:calc --check`.

**Contract:** `IMPLEMENTATION_GAP_CLOSURE_SPEC.md` §21 (budget), §22 (feasibility), §23 (health),
§24 (next action); `MASTER_IMPLEMENTATION_PLAN.md` §12.3 (no fake precision).

**Budget engine version:** 1.0.0

---

## 1. Money

Amounts are held as **integers in minor units**. Floating-point arithmetic on money accumulates error
that is invisible until a total is off by a penny and somebody has to explain why — `0.1 + 0.2 !== 0.3`
is the whole argument.

Rounding is **half away from zero**, symmetrically. `Math.round(-0.5)` is `-0` in JavaScript, which
rounds a negative half *up*; money must round symmetrically or the direction of an error depends on
its sign.

### Currencies

Not every currency has two decimal places, and assuming so inflates a yen amount a hundredfold. The
list is deliberately short — adding one is a decision — and anything absent is refused rather than
guessed.

| Code | Name | Minor units |
|---|---|--:|
| `GBP` | Pound sterling | 2 |
| `EUR` | Euro | 2 |
| `USD` | US dollar | 2 |
| `CAD` | Canadian dollar | 2 |
| `AUD` | Australian dollar | 2 |
| `CHF` | Swiss franc | 2 |
| `SEK` | Swedish krona | 2 |
| `NOK` | Norwegian krone | 2 |
| `DKK` | Danish krone | 2 |
| `PLN` | Polish złoty | 2 |
| `INR` | Indian rupee | 2 |
| `JPY` | Japanese yen | 0 |
| `KRW` | South Korean won | 0 |

### Combining currencies is refused

Adding two currencies needs a rate, and a rate used without being recorded is exactly what §21.1
forbids. Which rate applies at what time is a question only the caller can answer.

---

## 2. Exchange rates (§21.1)

> **"Do not silently use live FX without recording rate provenance."**

Every conversion returns three things: the original amount, the converted amount, and the rate —
including its **source** and the date it was **observed** (not the date the conversion ran).

A conversion with an empty source is refused. A converted figure whose rate is unrecorded cannot be
reproduced: six months later the rate has moved, the total no longer reconciles, and there is no way
to tell whether the difference is a rate change, a scope change or a mistake.

Conversion goes **through major units**, because the exponents may differ. £12.34 at 190 JPY/GBP is
about ¥2,345, not ¥234,460.

---

## 3. Ranges

Every cost is a range. Plan §12.3 forbids fake precision, and a single figure for anything estimated
is exactly that — a number read as a commitment.

There is deliberately **no midpoint accessor**. Averaging a range discards the information the range
carried, and once a midpoint exists everyone downstream treats it as the number.

A committed cost simply has a range of zero width, which is a statement rather than an absence.

---

## 4. Cost types (§21.2)

`ONE_TIME`, `RECURRING_MONTHLY`, `RECURRING_ANNUAL`, `USAGE_BASED`, `HUMAN_EFFORT`, `CONTINGENCY`, `UNKNOWN`

Recurring costs are multiplied by the periods the budget covers. Without that a monthly licence
appears once and the annual figure is out by a factor of twelve.

## 5. Budget states (§21.3)

| State | Meaning |
|---|---|
| `ESTIMATED` | A figure the engine or a person produced. Nobody has agreed to spend it. |
| `ALLOCATED` | Set aside for this. Not yet promised to anyone. |
| `COMMITTED` | Promised — a signed contract, a purchase order, a hire. |
| `ACTUAL` | Spent. Entered by hand or imported; this platform does not reconcile with an accounting system. |
| `FORECAST` | What the remaining work is expected to cost, given what has happened so far. |

### Actuals (§21.4)

Actual costs are entered by hand or imported. **This platform does not reconcile with an accounting
system**, and any total containing actuals says so — §21.4 is explicit that reconciliation must not be
claimed unless implemented.

---

## 6. Contingency (§21.5)

> **"Contingency must be explicit and explainable. Never hide contingency inside inflated task
> estimates."**

Buffer distributed into every estimate is consumed by whichever task happens to overrun first, and
nobody can see it going — the project looks fine until the padding runs out. Held as a named line,
spending it is a decision somebody takes, and the remaining amount is a real signal.

So:

- Contingency is a **distinct type**, never a cost line. Adding a line of type `CONTINGENCY` is
  refused.
- Contingency with **no justification** is refused. An unexplained allowance is the ten-per-cent
  convention with a different name.
- The roll-up reports it **separately at every level**. `withContingency` is offered as a distinct
  figure rather than as *the* total — a single number that silently includes the allowance is
  contingency hidden one layer up from where §21.5 forbids hiding it.

### Sizing

Sized from the actual uncertainty rather than by convention, and every component is named so the
figure can be argued with — and so it can **shrink** when an unknown is resolved. A contingency
nobody can decompose never shrinks; it just gets spent.

| Driver | Contribution | Cap |
|---|--:|--:|
| Each unresolved critical unknown | 10% | 40% |
| Each unconfirmed assumption | 3% | 15% |
| Unfamiliar technology | 15% | — |
| Existing system to work inside | 10% | — |
| Baseline where nothing specific is outstanding | 5% | — |

The baseline exists because zero contingency asserts that nothing unexpected will happen, which has
never been true of any project.

---

## 7. Variance

Compared against the **conservative** end of the estimate, not the expected one. An estimate is a
range, and being above the middle of a range is not an overrun — reporting it as one trains people to
ignore variance warnings, which is how the real overrun goes unnoticed.

---

## 8. Feasibility (§22) and health (§23)

> §22: **"Feasibility is not a magic score."**
> §23: **"Do not create an unexplained 83/100."**

Those are the same instruction twice, and they rule out the thing most tools do. A single number is
attractive because it fits in a dashboard and useless for the same reason: nobody can act on 83,
nobody can argue with 83, and it moves for reasons nobody can see. Worse, it invites optimising the
score rather than the project.

**There is no numeric score anywhere in either result type.** Both return dimensions, each with a
status and the specific causes that produced it, and an overall status that is the **worst dimension**
— with that dimension named.

Averaging would let one unrealistic dimension disappear into seven feasible ones, and a project that
cannot be staffed is not seven-eighths feasible.

**Feasibility statuses:** `FEASIBLE`, `FEASIBLE_WITH_RISK`, `UNREALISTIC`, `UNKNOWN`
**Health statuses:** `HEALTHY`, `WATCH`, `AT_RISK`, `CRITICAL`, `UNKNOWN`

### Where UNKNOWN sits

Deliberately between the bad and the good. It is not a failure — plenty of projects legitimately
cannot answer a question yet — but treating it as healthy would let a project be reported as fine
because nobody had filled anything in.

Three cases where that matters:

- **A budget with no ceiling** is `UNKNOWN`, not feasible. A budget that cannot be exceeded because
  none was set is not a healthy budget, and reporting it as feasible rewards not answering.
- **Undecidable compliance** is `UNKNOWN`, not risk. Not knowing whether obligations apply is a
  different state from knowing they are outstanding.
- **An empty risk register** is `UNKNOWN`, not healthy. Every project has risks; a register with none
  means nobody looked.

### Evidence

Every cause carries evidence pointing at something in the project — a node id, a rule id, a schedule
problem code — so a reader can go and look. A cause with no evidence is an assertion, and an engine
whose assertions cannot be checked is one people stop believing the first time they disagree.

---

## 9. Next action (§24)

The priority order, reproduced exactly. First match wins; this is not a scoring function.

1. `CRITICAL_SECURITY_BLOCKER`
2. `FAILED_MANDATORY_GATE`
3. `BLOCKER_ON_CRITICAL_PATH`
4. `REQUIRED_APPROVAL`
5. `CRITICAL_MISSING_INFORMATION`
6. `OVERDUE_MILESTONE`

When nothing matches, the result is **null** rather than a cheerful placeholder. "Nothing needs your
attention" is a claim, and inventing one would be the same kind of false reassurance as an unexplained
score.
