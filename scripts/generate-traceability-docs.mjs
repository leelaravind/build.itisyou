#!/usr/bin/env node
/**
 * Generate `docs/TRACEABILITY_MODEL_SPEC.md` from `packages/traceability/src/`.
 *
 * The eighth generated document. This one matters because the chain it describes is the Phase-10
 * gate: a specification claiming a hop the code does not walk would make the gate unauditable, and
 * the drift would be invisible until somebody tried to reproduce a trace by hand.
 *
 * `pnpm docs:trace --check` fails CI when the committed file no longer matches the code.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const OUT = join(process.cwd(), 'docs', 'TRACEABILITY_MODEL_SPEC.md');

const load = (path) => import(pathToFileURL(join(process.cwd(), path)).href);

const { CHAIN, CHAIN_VERSION, LINK_STATUSES } = await load('packages/traceability/src/chain.ts');

const { REQUIREMENT_KINDS, QUALITY_ATTRIBUTES, VERIFICATION_METHODS, PRIORITIES } = await load(
  'packages/traceability/src/requirements.ts',
);

const { LAYERS, COMPONENT_KINDS, DECISION_STATES, mayDependOn } = await load(
  'packages/traceability/src/architecture.ts',
);

const { GAP_KINDS } = await load('packages/traceability/src/gaps.ts');

const code = (s) => `\`${s}\``;

const hopRows = CHAIN.map(
  (hop) =>
    `| ${code(hop.key)} | ${code(hop.from)} | ${code(hop.via)} | ${code(hop.to)} | ${hop.direction === 'INBOUND' ? 'inbound' : 'outbound'} | ${hop.required ? '**yes**' : 'no'} |`,
);

const absenceRows = CHAIN.map((hop) => `| ${code(hop.key)} | ${hop.absenceMeans} |`);

const layerMatrix = [
  `| from ↓ / to → | ${LAYERS.join(' | ')} |`,
  `|---|${LAYERS.map(() => '---').join('|')}|`,
  ...LAYERS.map(
    (from) =>
      `| **${from}** | ${LAYERS.map((to) => (mayDependOn(from, to) ? 'yes' : '—')).join(' | ')} |`,
  ),
];

const content = `# TRACEABILITY MODEL SPECIFICATION

> **Generated file — do not edit by hand.**
> Source of truth: \`packages/traceability/src/{requirements,architecture,chain,gaps}.ts\`.
> Regenerate with \`pnpm docs:trace\`. CI runs \`pnpm docs:trace --check\`.

**Contract:** \`MASTER_IMPLEMENTATION_PLAN.md\` Phase 10 ("complete Requirement→Release chain
verified"); \`IMPLEMENTATION_GAP_CLOSURE_SPEC.md\` §15.2, §15.3, §25, §32.

**Chain version:** ${CHAIN_VERSION}

---

## 1. What a requirement has to be

A requirement is the only thing in this platform that can *justify* work existing. Everything
downstream — components, tasks, tests, evidence, approvals — is defensible only by pointing back at
one, so the quality of the requirement set is a hard ceiling on the quality of everything else.

The central check is whether the requirement **can be failed**. "The system must be fast" cannot be
passed or failed; it can only be argued about. A requirement nobody can fail is not a requirement, it
is a wish, and a project that marks it satisfied has not satisfied anything.

**Kinds:** ${REQUIREMENT_KINDS.map(code).join(', ')}

**Quality attributes:** ${QUALITY_ATTRIBUTES.map(code).join(', ')}

Deliberately not the full ISO 25010 tree. A taxonomy larger than the questions feeding it produces
categories nothing can ever land in, which reads as coverage and is not.

**Verification methods:** ${VERIFICATION_METHODS.map(code).join(', ')}

There is deliberately no \`ASSERTION\` member. Every method listed produces something a second person
can examine. "Somebody said so" is what the *absence* of a method already means, and giving it a name
would make it selectable.

**Priorities:** ${PRIORITIES.map(code).join(', ')}

\`WONT\` is retained rather than deleted. A requirement decided against is a decision, and deleting it
loses the decision — six months later somebody asks why the system does not do X and there is no
record that the question was answered.

### Defects that block, and defects that do not

Blocking is reserved for the ones that make a release claim indefensible: a \`MUST\` with no
verification method, a \`MUST\` quality attribute with no measure, and a regulatory requirement
verified only by demonstration.

Subjective wording is **advisory**. Blocking on it would train people to write requirements that pass
the word filter rather than requirements that can be failed, which is strictly worse than the problem.

---

## 2. Architecture

### Layers

${layerMatrix.join('\n')}

Inward and same-layer are legal; outward is not.

\`DOMAIN → INFRASTRUCTURE\` is the interesting cell and it is deliberately **illegal**, which is where
this differs from layering schemes that treat infrastructure as innermost. Domain logic that reaches
into infrastructure cannot be tested or reasoned about without it, which is the property that made
separating the domain worth doing. Infrastructure is depended *upon* through an interface the domain
owns, so the arrow points inward at the type level even where the call goes outward at runtime.

**Component kinds:** ${COMPONENT_KINDS.map(code).join(', ')}

### Decisions

**States:** ${DECISION_STATES.map(code).join(', ')}

A decision that records no **alternatives** is refused when accepted. The reason to record a decision
is not documentation; it is that six months later somebody will propose the obvious thing, and the
only way to know whether the obvious thing was already considered is if the rejection was written
down at the time. A record of only what was chosen cannot answer the question it exists to answer.

An alternative listed with no reason for its rejection is dropped rather than counted — otherwise a
decision could satisfy the check with a list of words.

---

## 3. The Requirement → Release chain

| Hop | From | Edge | To | Direction | Required |
|---|---|---|---|---|---|
${hopRows.join('\n')}

Every triple above is legal under \`EDGE_LEGALITY\` in \`@govintel/twin/edges\`, and a test asserts it.
That test exists because the first version of this chain did **not** satisfy it: it had components
*satisfying* requirements and tests *verifying* tasks, neither of which the twin permits. Those hops
could never match anything, so every trace came back with no design and no test — and nothing failed,
because an empty result looks exactly like a project that has not done the work.

The chain is a **tree rooted at the requirement**, not a line. Work, tests and deployments all attach
to the requirement directly; only evidence and approval hang off an earlier hop. That is why each hop
names where it departs from rather than inheriting whatever the previous one reached.

### What an absent hop means

| Hop | Absence means |
|---|---|
${absenceRows.join('\n')}

### Link statuses

${LINK_STATUSES.map(code).join(', ')}

**There are more than two.** A link can be present, absent, or present-but-not-yet-demonstrable — a
test that exists and has never run, evidence with no artefact hash, an approval still pending.
Collapsing that third case into "absent" understates work that has been done; collapsing it into
"present" is a lie.

And \`STALE\` is the status that earns this module its keep: **a chain whose every edge exists can
still be broken.** If the requirement changed after the evidence was captured, the evidence attests
to a different requirement. Every link is present, a presence-checking tool reports complete
coverage, and the claim is false.

A trace is **complete** only when every required hop is \`LINKED\`. \`UNVERIFIED\` and \`STALE\` both fail
it, because both describe a chain that looks complete and does not support its claim.

---

## 4. Gaps, in both directions

${GAP_KINDS.map(code).join(', ')}

Forward traceability — does every requirement reach work, tests and evidence — is the half every tool
implements. **Backward traceability is the half that gets left out**, and it catches the more
expensive problem: work that traces back to no requirement is either scope nobody asked for, or a
requirement nobody wrote down. Neither is visible from the forward direction, where the report can be
a wall of green while a third of the build is unaccounted for.

Rule-generated work is exempt from the backward check. The rule *is* the recorded reason — it names
the obligation and cites its source. Reporting the platform's own output as unjustified would fill
that section with noise and teach people to skim it, which is precisely where real scope creep would
then hide.

### Only the first broken hop blocks

A requirement with no work also has no evidence. Reporting every broken hop as blocking turns the
report into a wall, and a wall hides the other requirements' real problems.

### Not assessable is a third state

A requirement with no verification method cannot be traced to a test, and reporting that as a
*missing test* would blame the wrong thing — nobody can write the test until somebody decides what
would demonstrate the requirement. Those requirements are counted separately, as neither complete nor
gapped.

A \`REQUIREMENT\` node the model cannot read is reported too, rather than skipped. Silently excluding
it would make a malformed requirement the safest kind to have.

---

## 5. No percentage, anywhere

The report carries absolute counts — requirements, complete, blocked, not assessable — and no ratio.

"87% traceable" is the same failure as the unexplained 83/100 that §23 forbids: it is unactionable,
it is optimisable, and it moves for reasons nobody can see. What a reader needs is *which* requirement
has no test, and the id so they can go and look.

## 6. Silence has to be distinguishable

§25 requires healthy items to stay quiet, which creates a specific hazard: **an empty report and a
report on an empty project look identical**, and one of them is much worse news than the other. So an
empty result is never rendered as success — the summary says which of the two it is.
`;

const check = process.argv.includes('--check');

if (check) {
  let existing;

  try {
    existing = readFileSync(OUT, 'utf8');
  } catch {
    console.error('docs/TRACEABILITY_MODEL_SPEC.md is missing. Run `pnpm docs:trace`.');
    process.exit(1);
  }

  if (existing !== content) {
    console.error(
      'docs/TRACEABILITY_MODEL_SPEC.md is out of date with the traceability source. Run `pnpm docs:trace`.',
    );
    process.exit(1);
  }

  console.log('Traceability model specification is up to date.');
} else {
  writeFileSync(OUT, content, 'utf8');
  console.log('Wrote docs/TRACEABILITY_MODEL_SPEC.md');
}
