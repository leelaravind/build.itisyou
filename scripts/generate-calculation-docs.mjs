#!/usr/bin/env node
/**
 * Generate `docs/CAPACITY_CALCULATION_SPEC.md` and `docs/BUDGET_CALCULATION_SPEC.md`.
 *
 * Contract: gap-spec §19 requires the capacity specification, §21 the budget one.
 *
 * Generated for the same reason as the other four: a specification that has drifted from the
 * implementation is worse than none. These two in particular describe *arithmetic*, and a document
 * claiming a 12% leave deduction while the code applies 20% would make every figure in the product
 * unreconcilable with its own explanation.
 *
 * `pnpm docs:calc --check` fails CI if the committed files no longer match the code.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const CAPACITY_OUT = join(process.cwd(), 'docs', 'CAPACITY_CALCULATION_SPEC.md');
const BUDGET_OUT = join(process.cwd(), 'docs', 'BUDGET_CALCULATION_SPEC.md');

const load = (path) => import(pathToFileURL(join(process.cwd(), path)).href);

const { DEFAULT_DEDUCTIONS, SCHEDULE_PROBLEMS } = await load(
  'packages/execution/src/scheduling.ts',
);

const { COMPLEXITY_HOURS, COMPLEXITY_LEVELS, ADJUSTMENTS, ESTIMATOR_VERSION, CONFIDENCE_CLASSES } =
  await load('packages/finance/src/estimate.ts');

const { COST_TYPES, BUDGET_STATES, STATE_MEANING, BUDGET_ENGINE_VERSION } = await load(
  'packages/finance/src/budget.ts',
);

const { CURRENCIES } = await load('packages/finance/src/money.ts');

const { FEASIBILITY_STATUSES, HEALTH_STATUSES, NEXT_ACTION_PRIORITIES } = await load(
  'packages/finance/src/feasibility.ts',
);

const code = (s) => `\`${s}\``;
const pct = (n) => `${String(Math.round(n * 100))}%`;

/* -------------------------------------------------------------------------- */
/* CAPACITY_CALCULATION_SPEC.md                                               */
/* -------------------------------------------------------------------------- */

const complexityRows = COMPLEXITY_LEVELS.map((level) => {
  const hours = COMPLEXITY_HOURS[level];
  const spread = (hours.conservative / hours.optimistic).toFixed(1);
  return `| ${code(level)} | ${String(hours.optimistic)} | ${String(hours.expected)} | ${String(hours.conservative)} | ${spread}× |`;
});

const adjustmentRows = Object.values(ADJUSTMENTS).map(
  (a) =>
    `| ${code(a.key)} | ${String(a.factor.optimistic)}× | ${String(a.factor.expected)}× | ${String(a.factor.conservative)}× | ${a.reason} |`,
);

const capacityContent = `# CAPACITY AND ESTIMATION CALCULATION SPECIFICATION

> **Generated file — do not edit by hand.**
> Source of truth: \`packages/execution/src/scheduling.ts\`, \`packages/finance/src/estimate.ts\`.
> Regenerate with \`pnpm docs:calc\`. CI runs \`pnpm docs:calc --check\`.

**Contract:** \`IMPLEMENTATION_GAP_CLOSURE_SPEC.md\` §18 (resource model), §19 (capacity) and §20
(estimation); \`MASTER_IMPLEMENTATION_PLAN.md\` §12.3 (no fake precision).

**Estimator version:** ${ESTIMATOR_VERSION}

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
| Leave and sickness | ${pct(DEFAULT_DEDUCTIONS.leaveProportion)} | Statutory leave and ordinary sickness across a year. |
| Meetings and overhead | ${pct(DEFAULT_DEDUCTIONS.overheadProportion)} | Meetings, administration, reviewing other people's work, and interruption. |

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

${SCHEDULE_PROBLEMS.map((p) => `- ${code(p)}`).join('\n')}

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
${complexityRows.join('\n')}

The band on ${code('UNKNOWN')} is deliberately enormous. That is what "we have not looked at this"
actually means, and narrowing it to something comfortable would be inventing knowledge — the
discomfort of the number is the signal that the item needs sizing.

### Adjustments

Separate from the base figure, each carrying its own explanation, so a finished estimate reads as an
argument rather than as a number. "Ninety hours" is unarguable; "sixteen base, doubled for unfamiliar
technology, plus twenty per cent rework" can be disagreed with in exactly one place.

| Adjustment | Optimistic | Expected | Conservative | Why |
|---|--:|--:|--:|---|
${adjustmentRows.join('\n')}

An adjustment the engine does not recognise is **refused, not ignored**. Silently dropping one would
produce an estimate that is quietly too low, and the omission would be invisible.

### Confidence

${CONFIDENCE_CLASSES.map(code).join(', ')} — derived from the width of the range rather than asserted.
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
`;

/* -------------------------------------------------------------------------- */
/* BUDGET_CALCULATION_SPEC.md                                                 */
/* -------------------------------------------------------------------------- */

const stateRows = BUDGET_STATES.map((s) => `| ${code(s)} | ${STATE_MEANING[s]} |`);

const currencyRows = Object.entries(CURRENCIES).map(
  ([codeName, currency]) =>
    `| ${code(codeName)} | ${currency.name} | ${String(currency.exponent)} |`,
);

const budgetContent = `# BUDGET CALCULATION SPECIFICATION

> **Generated file — do not edit by hand.**
> Source of truth: \`packages/finance/src/money.ts\`, \`budget.ts\`, \`feasibility.ts\`.
> Regenerate with \`pnpm docs:calc\`. CI runs \`pnpm docs:calc --check\`.

**Contract:** \`IMPLEMENTATION_GAP_CLOSURE_SPEC.md\` §21 (budget), §22 (feasibility), §23 (health),
§24 (next action); \`MASTER_IMPLEMENTATION_PLAN.md\` §12.3 (no fake precision).

**Budget engine version:** ${BUDGET_ENGINE_VERSION}

---

## 1. Money

Amounts are held as **integers in minor units**. Floating-point arithmetic on money accumulates error
that is invisible until a total is off by a penny and somebody has to explain why — \`0.1 + 0.2 !== 0.3\`
is the whole argument.

Rounding is **half away from zero**, symmetrically. \`Math.round(-0.5)\` is \`-0\` in JavaScript, which
rounds a negative half *up*; money must round symmetrically or the direction of an error depends on
its sign.

### Currencies

Not every currency has two decimal places, and assuming so inflates a yen amount a hundredfold. The
list is deliberately short — adding one is a decision — and anything absent is refused rather than
guessed.

| Code | Name | Minor units |
|---|---|--:|
${currencyRows.join('\n')}

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

${COST_TYPES.map(code).join(', ')}

Recurring costs are multiplied by the periods the budget covers. Without that a monthly licence
appears once and the annual figure is out by a factor of twelve.

## 5. Budget states (§21.3)

| State | Meaning |
|---|---|
${stateRows.join('\n')}

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

- Contingency is a **distinct type**, never a cost line. Adding a line of type \`CONTINGENCY\` is
  refused.
- Contingency with **no justification** is refused. An unexplained allowance is the ten-per-cent
  convention with a different name.
- The roll-up reports it **separately at every level**. \`withContingency\` is offered as a distinct
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

**Feasibility statuses:** ${FEASIBILITY_STATUSES.map(code).join(', ')}
**Health statuses:** ${HEALTH_STATUSES.map(code).join(', ')}

### Where UNKNOWN sits

Deliberately between the bad and the good. It is not a failure — plenty of projects legitimately
cannot answer a question yet — but treating it as healthy would let a project be reported as fine
because nobody had filled anything in.

Three cases where that matters:

- **A budget with no ceiling** is \`UNKNOWN\`, not feasible. A budget that cannot be exceeded because
  none was set is not a healthy budget, and reporting it as feasible rewards not answering.
- **Undecidable compliance** is \`UNKNOWN\`, not risk. Not knowing whether obligations apply is a
  different state from knowing they are outstanding.
- **An empty risk register** is \`UNKNOWN\`, not healthy. Every project has risks; a register with none
  means nobody looked.

### Evidence

Every cause carries evidence pointing at something in the project — a node id, a rule id, a schedule
problem code — so a reader can go and look. A cause with no evidence is an assertion, and an engine
whose assertions cannot be checked is one people stop believing the first time they disagree.

---

## 9. Next action (§24)

The priority order, reproduced exactly. First match wins; this is not a scoring function.

${NEXT_ACTION_PRIORITIES.map((p, i) => `${String(i + 1)}. ${code(p)}`).join('\n')}

When nothing matches, the result is **null** rather than a cheerful placeholder. "Nothing needs your
attention" is a claim, and inventing one would be the same kind of false reassurance as an unexplained
score.
`;

/* -------------------------------------------------------------------------- */

const check = process.argv.includes('--check');

const targets = [
  [CAPACITY_OUT, capacityContent, 'docs/CAPACITY_CALCULATION_SPEC.md'],
  [BUDGET_OUT, budgetContent, 'docs/BUDGET_CALCULATION_SPEC.md'],
];

if (check) {
  let ok = true;

  for (const [path, content, name] of targets) {
    let existing;
    try {
      existing = readFileSync(path, 'utf8');
    } catch {
      console.error(`${name} is missing. Run \`pnpm docs:calc\`.`);
      ok = false;
      continue;
    }

    if (existing !== content) {
      console.error(`${name} is out of date with the calculation source. Run \`pnpm docs:calc\`.`);
      ok = false;
    }
  }

  if (!ok) process.exit(1);
  console.log('Capacity and budget specifications are up to date.');
} else {
  for (const [path, content, name] of targets) {
    writeFileSync(path, content, 'utf8');
    console.log(`Wrote ${name}`);
  }
}
