#!/usr/bin/env node
/**
 * Generate `docs/RULE_FORMAT_SPEC.md` and `docs/GATE_CATALOGUE.md` from the rules source.
 *
 * Contract: gap-spec §13 requires the rule format specification, §15 the gate catalogue.
 *
 * Generated for the same reason the permissions matrix and the twin schema are: a specification that
 * has drifted from the implementation is worse than none, because it tells a reader the engine
 * refuses something it now permits. The rule catalogue in particular is 287 entries — nobody would
 * maintain a listing of it by hand, and a stale one would misrepresent which obligations are in
 * force.
 *
 * `pnpm docs:rules --check` fails CI if the committed files no longer match the code.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const FORMAT_OUT = join(process.cwd(), 'docs', 'RULE_FORMAT_SPEC.md');
const GATE_OUT = join(process.cwd(), 'docs', 'GATE_CATALOGUE.md');

const load = (path) => import(pathToFileURL(join(process.cwd(), path)).href);

const {
  RULE_CATEGORIES,
  RULE_SEVERITIES,
  CONDITION_SUBJECTS,
  CONDITION_OPERATORS,
  CONDITION_MODES,
  RULE_FORMAT_VERSION,
} = await load('packages/rules/src/schema.ts');

const { RULES, RULESET_VERSION, MINIMUM_RULES, countByCategory, summariseCatalogue } = await load(
  'packages/rules/src/catalogue.ts',
);

const { SOURCE_PRECEDENCE, describeSource } = await load('packages/rules/src/precedence.ts');
const { GATES } = await load('packages/rules/src/gates.ts');
const { LIFECYCLE_STATES, TRANSITIONS, ARCHIVABLE_FROM } = await load(
  'packages/rules/src/lifecycle.ts',
);
const { METHODOLOGIES, METHODOLOGY_PROFILES } = await load('packages/rules/src/methodology.ts');

const code = (s) => `\`${s}\``;
const counts = countByCategory();
const summary = summariseCatalogue();

/* -------------------------------------------------------------------------- */
/* RULE_FORMAT_SPEC.md                                                        */
/* -------------------------------------------------------------------------- */

function categoryTable() {
  const rows = RULE_CATEGORIES.map((category) => {
    const actual = counts[category];
    const minimum = MINIMUM_RULES[category];
    return `| ${code(category)} | ${String(minimum)} | ${String(actual)} |`;
  });

  return [
    '| Category | Minimum (gap-spec §14) | In the catalogue |',
    '|---|--:|--:|',
    ...rows,
    `| **Total** | **270** | **${String(RULES.length)}** |`,
  ].join('\n');
}

function ruleListing() {
  const blocks = [];

  for (const category of RULE_CATEGORIES) {
    const rules = RULES.filter((r) => r.category === category);
    if (rules.length === 0) continue;

    const rows = rules.map((rule) => {
      const scope =
        rule.projectTypeScope.length > 0 ? rule.projectTypeScope.join(', ') : 'all project types';
      return `| ${code(rule.id)} | ${rule.title} | ${rule.severity} | ${scope} |`;
    });

    blocks.push(
      [
        `### ${category} (${String(rules.length)})`,
        '',
        '| Id | Title | Severity | Applies to |',
        '|---|---|---|---|',
        ...rows,
        '',
      ].join('\n'),
    );
  }

  return blocks.join('\n');
}

const formatContent = `# RULE FORMAT SPECIFICATION

> **Generated file — do not edit by hand.**
> Source of truth: \`packages/rules/src/\`. Regenerate with \`pnpm docs:rules\`.
> CI runs \`pnpm docs:rules --check\` and fails if this file has drifted from the code.

**Contract:** \`IMPLEMENTATION_GAP_CLOSURE_SPEC.md\` §13 (formal DSL, determinism, precedence,
explanations) and §14 (the initial catalogue); \`MASTER_IMPLEMENTATION_PLAN.md\` §7 (the deterministic
rules engine).

**Rule format version:** ${RULE_FORMAT_VERSION} · **Ruleset version:** ${RULESET_VERSION}

---

## 1. Why the rules are data

A rule written as code can do anything: read a clock, call a service, mutate the project it is
evaluating. A rule written as data can only *describe* a condition and *declare* what follows, and
the evaluator decides what that means. Three properties follow, and none are achievable with
rules-as-functions:

- **Determinism is structural.** §13.1 requires that the same project version, ruleset version and
  inputs produce the same result. A declarative condition has nowhere to hide a clock.
- **Explanations are free.** §13.3 requires every emitted action to answer "why is this required?"
  A rule carrying its own rationale, remediation and references answers that without per-rule
  explanation code, which would rot immediately.
- **Rules can be reviewed by people who do not read TypeScript.** A security rule only a developer
  can audit is a security rule nobody audits.

The condition language is deliberately small. It expresses field comparisons, set membership,
presence and boolean combination, and cannot express arbitrary computation. That limit is the point:
an expression language rich enough to be convenient is rich enough to be non-deterministic.

---

## 2. Rule fields

| Field | Required | Meaning |
|---|:-:|---|
| \`id\` | ✅ | Structured, e.g. \`SEC-WEB-AUTH-001\`. Locatable by prefix without a lookup table. |
| \`version\` | ✅ | Bumped when the rule's meaning changes. A stored finding keeps the version that produced it. |
| \`title\` | ✅ | One line, shown in findings. |
| \`description\` | ✅ | What the rule requires. |
| \`category\` | ✅ | One of the ${String(RULE_CATEGORIES.length)} below. |
| \`severity\` | ✅ | ${RULE_SEVERITIES.map(code).join(', ')}. |
| \`source\` | ✅ | Where the authority comes from. Decides conflicts. |
| \`projectTypeScope\` | | Empty means every type. |
| \`lifecycleScope\` | | Empty means every state. |
| \`methodologyScope\` | | Empty means every methodology. |
| \`conditionMode\` | | ${CONDITION_MODES.map(code).join(' or ')}. |
| \`conditions\` | | Empty means the rule applies wherever it is in scope. |
| \`requiredInputs\` | | Intake fields needed before the rule can be evaluated at all. |
| \`emittedRequirements\` | | Each carries a mandatory \`verification\`. |
| \`emittedTasks\` | | |
| \`emittedTests\` | | |
| \`emittedGates\` | | Criteria attached to a gate. |
| \`emittedRisks\` | | |
| \`calculationEffects\` | | Declarative, with ranges rather than single figures. |
| \`rationale\` | ✅ | §13.3: why is this required? |
| \`remediation\` | ✅ | What to do about it. A finding with no remediation is a complaint. |
| \`references\` | | Required for mandatory legal/security rules. |
| \`activeFrom\` | ✅ | |
| \`deprecatedFrom\` | | A withdrawn rule stays in the catalogue so stored findings remain explainable. |

### Refused at definition time

\`defineRule\` refuses a rule that:

- emits nothing and affects no calculation — it would count towards the total and do nothing;
- is mandatory, legal or security, and cites no source — an uncitable obligation becomes folklore
  that nobody can challenge or retire;
- has a test claiming to verify a requirement the rule does not emit — a traceability arrow pointing
  at nothing;
- is deprecated before it becomes active;
- reuses an emission key within itself.

---

## 3. Conditions

**Subjects:** ${CONDITION_SUBJECTS.map(code).join(', ')}.

**Operators:** ${CONDITION_OPERATORS.map(code).join(', ')}.

\`IS_ANSWERED\` is deliberately separate from \`EXISTS\`. An intake field can hold a value while its
state says the user does not know — the value is the marker they chose — so "has a row" and "the user
committed to an answer" are different questions. Conflating them is how a plan comes to treat "I
don't know" as a fact.

### The three outcomes

| Outcome | Meaning |
|---|---|
| \`APPLIED\` | Conditions met. Emissions produced. |
| \`NOT_APPLICABLE\` | Conditions genuinely not met. |
| \`INDETERMINATE\` | The rule needs an input the project has not answered. |

The third is the one that matters. An engine with only the first two silently reports "does not
apply" for every rule blocked by missing information — which is how a project comes to look compliant
because nobody filled in the form. A security rule conditioned on "the system holds payment data"
must not quietly not apply to every project that skipped the question.

---

## 4. Precedence (§13.2)

Most authoritative first:

${SOURCE_PRECEDENCE.map((s, i) => `${String(i + 1)}. ${code(s)} — ${describeSource(s)}`).join('\n')}

The order is an argument, not a list. Legal and security obligations sit above organisational policy
because an organisation cannot policy its way out of the law. Explicit project constraints sit above
the project-type pack because the person doing the work knows something the taxonomy does not.
Recommended defaults sit last because that is what a default is.

### Conflicts are not always resolved

§13.2: **"Never resolve conflicting critical rules silently."**

| Situation | Outcome |
|---|---|
| Different sources, at most one mandatory | Resolved by precedence; what was overridden is recorded. |
| Two mandatory rules, different sources | **Unresolvable.** Reported, and the emission is withheld. |
| Two mandatory rules, same source | **Unresolvable**, and reported as a defect in the ruleset. |
| Equal precedence, neither mandatory | **Unresolvable** — precedence is the only tiebreaker and it has run out. |

Emitting one side of an unresolvable conflict would be resolving it, quietly, in favour of whichever
rule happened to be evaluated first.

---

## 5. The catalogue

${categoryTable()}

**${String(summary.bySeverity.MANDATORY)}** mandatory, **${String(summary.bySeverity.RECOMMENDED)}**
recommended, **${String(summary.bySeverity.ADVISORY)}** advisory.
**${String(summary.withReferences)}** cite an external source.
Between them the rules emit **${String(summary.emittedRequirements)}** requirements,
**${String(summary.emittedTests)}** tests and **${String(summary.emittedGateCriteria)}** gate criteria.

Gap-spec §14: *"The rules must be meaningful. Do not create artificial rules solely to meet a
number."* The counts above are a floor rather than a target, and the refusals in §2 are what make a
padded rule difficult to write: a rule has to make a specific claim about a specific consequence to
survive definition.

${ruleListing()}

---

## 6. Determinism (§13.1)

The evaluator is pure: no clock, no randomness, no database. The date rules are evaluated as of is an
input. Results are returned in catalogue order, because the interface renders findings in the order
it receives them and a list that reshuffles between two identical runs looks like the project
changed.

The suite asserts byte-identical output across ten consecutive runs, and that reordering the intake
does not change the result.
`;

/* -------------------------------------------------------------------------- */
/* GATE_CATALOGUE.md                                                          */
/* -------------------------------------------------------------------------- */

function gateSection(gate) {
  const rows = gate.criteria.map(
    (c) =>
      `| ${code(c.key)} | ${c.statement} | ${c.kind === 'AUTOMATIC' ? 'automatic' : 'evidence'} | ${c.blocking ? '**blocking**' : 'reported'} |`,
  );

  const rationales = gate.criteria.map((c) => `- **${c.statement}** ${c.rationale}`);

  return [
    `## ${gate.title}`,
    '',
    gate.purpose,
    '',
    '| Criterion | Must be true | Decided by | Effect |',
    '|---|---|---|---|',
    ...rows,
    '',
    '### Why each criterion exists',
    '',
    ...rationales,
    '',
  ].join('\n');
}

const transitionRows = TRANSITIONS.map(
  (t) =>
    `| ${code(t.from)} → ${code(t.to)} | ${t.gates.length === 0 ? '—' : t.gates.map(code).join(', ')} | ${t.meaning} |`,
);

const automatic = GATES.flatMap((g) => g.criteria).filter((c) => c.kind === 'AUTOMATIC').length;
const totalCriteria = GATES.flatMap((g) => g.criteria).length;

const gateContent = `# QUALITY GATE CATALOGUE

> **Generated file — do not edit by hand.**
> Source of truth: \`packages/rules/src/gates.ts\`, \`lifecycle.ts\`, \`methodology.ts\`.
> Regenerate with \`pnpm docs:rules\`. CI runs \`pnpm docs:rules --check\`.

**Contract:** \`IMPLEMENTATION_GAP_CLOSURE_SPEC.md\` §15 (eleven gates, each with exact criteria) and
§16 (methodology engine); \`MASTER_IMPLEMENTATION_PLAN.md\` §6 (lifecycle state machine).

---

## 1. What "exact criteria" means here

A criterion phrased as "security reviewed" is a checkbox someone ticks. A criterion has to be a
question the platform can answer from the project graph, or it is a self-assessment with extra steps.

**${String(automatic)} of ${String(totalCriteria)} criteria are answered automatically** from the
graph. The rest require an EVIDENCE or APPROVAL node — which is still stricter than a checkbox:
something has to exist in the record, attributable and timestamped.

A criterion that cannot be decided returns *undecidable* rather than *failed*, and a gate with any
undecidable blocking criterion is \`INDETERMINATE\`. "We checked and it is not met" and "we cannot tell
yet" are different states, and collapsing them into failure teaches people that gate failures are
noise.

---

## 2. The eleven gates

${GATES.map(gateSection).join('\n---\n\n')}

---

## 3. The lifecycle, and which gates each transition needs

${LIFECYCLE_STATES.length} states. Anything not listed below is refused — deny by default, for the
same reason the graph's edge legality is: the dangerous transitions are the ones nobody thought of.
\`IDEA\` straight to \`LIVE\` is not a state change but a lie.

| Transition | Requires | What it asserts |
|---|---|---|
${transitionRows.join('\n')}

A project may be archived from any state (${String(ARCHIVABLE_FROM.length)} of
${String(LIFECYCLE_STATES.length)}) and restored from the archive. Archival is not deletion, and a
one-way door would make people avoid archiving things that should be archived.

Backwards transitions are deliberately present. Verification finding something and returning the
project to \`IN_PROGRESS\` is the system working; a machine that only moves forward forces people to
lie about where they are.

An unevaluated gate counts as **not passed**. Treating it as satisfied would make every gate optional
for anyone who simply never ran it.

---

## 4. Methodology (§16)

${METHODOLOGIES.map((m) => `- **${METHODOLOGY_PROFILES[m].label}** — ${METHODOLOGY_PROFILES[m].summary}`).join('\n')}

| Methodology | Decomposition | Gate cadence | Change handling |
|---|---|---|---|
${METHODOLOGIES.map((m) => {
  const p = METHODOLOGY_PROFILES[m];
  return `| ${p.label} | ${p.decomposition} | ${p.gateCadence} | ${p.changeHandling} |`;
}).join('\n')}

### The constraint

§16: **"Methodology must not bypass mandatory security/release gates."**

A methodology decides *how work is organised* — how it is sliced, when it is reviewed, how change is
handled. It does not decide *which obligations apply*. Conflating the two is the most common way a
lighter process becomes a lighter standard, and it happens gradually: a ceremony, then a review, then
a gate, each justified by the methodology rather than by anyone deciding the check was unnecessary.

Every methodology therefore receives every gate. What varies is cadence.

### Each one's weakness, stated

${METHODOLOGIES.map((m) => `- **${METHODOLOGY_PROFILES[m].label}** is poorly suited to: ${METHODOLOGY_PROFILES[m].poorlySuitedTo}`).join('\n')}

A tool presenting every option as equally suitable is not helping anyone choose, and the choice
matters most to the people least equipped to make it.
`;

/* -------------------------------------------------------------------------- */

const check = process.argv.includes('--check');

const targets = [
  [FORMAT_OUT, formatContent, 'docs/RULE_FORMAT_SPEC.md'],
  [GATE_OUT, gateContent, 'docs/GATE_CATALOGUE.md'],
];

if (check) {
  let ok = true;

  for (const [path, content, name] of targets) {
    let existing;
    try {
      existing = readFileSync(path, 'utf8');
    } catch {
      console.error(`${name} is missing. Run \`pnpm docs:rules\`.`);
      ok = false;
      continue;
    }

    if (existing !== content) {
      console.error(`${name} is out of date with packages/rules/src/. Run \`pnpm docs:rules\`.`);
      ok = false;
    }
  }

  if (!ok) process.exit(1);
  console.log('Rule format spec and gate catalogue are up to date.');
} else {
  for (const [path, content, name] of targets) {
    writeFileSync(path, content, 'utf8');
    console.log(`Wrote ${name}`);
  }
  console.log(`${String(RULES.length)} rules, ${String(GATES.length)} gates.`);
}
