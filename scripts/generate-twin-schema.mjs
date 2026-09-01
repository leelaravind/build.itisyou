#!/usr/bin/env node
/**
 * Generate `docs/PROJECT_DIGITAL_TWIN_SCHEMA.md` from the twin source.
 *
 * Contract: gap-spec §8 requires this document. Generated rather than hand-written for the same
 * reason the permissions matrix is: a schema document that has drifted from the code is worse than
 * none, because it tells a reader the graph refuses something it now permits.
 *
 * The legality matrix in particular could not be maintained by hand — it is 17 edge classes over 32
 * node classes — and a stale copy of it would misrepresent what the traceability report actually
 * proves.
 *
 * `pnpm docs:twin --check` fails CI if the committed file no longer matches the code.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const OUTPUT = join(process.cwd(), 'docs', 'PROJECT_DIGITAL_TWIN_SCHEMA.md');

const load = (path) => import(pathToFileURL(join(process.cwd(), path)).href);

const { NODE_CLASSES, CONTAINMENT, IMMUTABLE_CLASSES, UNCERTAINTY_CLASSES, NODE_STATES } =
  await load('packages/twin/src/nodes.ts');

const {
  EDGE_CLASSES,
  EDGE_LEGALITY,
  ACYCLIC_EDGES,
  SINGLE_PARENT_EDGES,
  checkEdgeLegality,
  describe,
  describeEdge,
} = await load('packages/twin/src/edges.ts');

const { INVARIANT_CODES } = await load('packages/twin/src/invariants.ts');
const { CHANGE_KINDS } = await load('packages/twin/src/versioning.ts');
const { GENERATOR_VERSION } = await load('packages/twin/src/generate.ts');

/* -------------------------------------------------------------------------- */

const code = (s) => `\`${s}\``;

function nodeClassTable() {
  const rows = NODE_CLASSES.map((cls) => {
    const contains = CONTAINMENT[cls] ?? [];
    const notes = [];
    if (IMMUTABLE_CLASSES.includes(cls)) notes.push('immutable');
    if (UNCERTAINTY_CLASSES.includes(cls)) notes.push('uncertainty');

    return `| ${code(cls)} | ${describe(cls)} | ${
      contains.length === 0 ? '—' : contains.map(code).join(', ')
    } | ${notes.length === 0 ? '—' : notes.join(', ')} |`;
  });

  return ['| Class | Reads as | May contain | Notes |', '|---|---|---|---|', ...rows].join('\n');
}

function edgeClassTable() {
  const rows = EDGE_CLASSES.map((cls) => {
    const notes = [];
    if (ACYCLIC_EDGES.includes(cls)) notes.push('acyclic');
    if (SINGLE_PARENT_EDGES.includes(cls)) notes.push('at most one');

    const legal = countLegal(cls);

    return `| ${code(cls)} | "cannot ${describeEdge(cls)}" | ${String(legal)} | ${
      notes.length === 0 ? '—' : notes.join(', ')
    } |`;
  });

  return ['| Class | Reads as | Legal pairings | Notes |', '|---|---|--:|---|', ...rows].join('\n');
}

function countLegal(edgeClass) {
  let n = 0;
  for (const from of NODE_CLASSES) {
    for (const to of NODE_CLASSES) {
      if (checkEdgeLegality(edgeClass, from, to).ok) n += 1;
    }
  }
  return n;
}

function legalitySection() {
  const blocks = [];

  for (const edgeClass of EDGE_CLASSES) {
    const lines = [];

    if (edgeClass === 'CONTAINS') {
      for (const from of NODE_CLASSES) {
        const allowed = CONTAINMENT[from] ?? [];
        if (allowed.length === 0) continue;
        lines.push(`| ${code(from)} | ${allowed.map(code).join(', ')} |`);
      }
    } else {
      const legality = EDGE_LEGALITY[edgeClass] ?? {};
      for (const from of NODE_CLASSES) {
        const allowed = legality[from];
        if (allowed === undefined || allowed.length === 0) continue;
        lines.push(`| ${code(from)} | ${allowed.map(code).join(', ')} |`);
      }
    }

    blocks.push(
      [
        `#### ${code(edgeClass)}`,
        '',
        '| From | May point at |',
        '|---|---|',
        ...lines,
        '',
        `Anything not listed is refused. ${String(countLegal(edgeClass))} of ${String(
          NODE_CLASSES.length * NODE_CLASSES.length,
        )} possible pairings are legal.`,
        '',
      ].join('\n'),
    );
  }

  return blocks.join('\n');
}

const totalPairings = NODE_CLASSES.length * NODE_CLASSES.length * EDGE_CLASSES.length;
let totalLegal = 0;
for (const edgeClass of EDGE_CLASSES) totalLegal += countLegal(edgeClass);

const content = `# PROJECT DIGITAL TWIN SCHEMA

> **Generated file — do not edit by hand.**
> Source of truth: \`packages/twin/src/\`. Regenerate with \`pnpm docs:twin\`.
> CI runs \`pnpm docs:twin --check\` and fails if this file has drifted from the code.

**Contract:** \`IMPLEMENTATION_GAP_CLOSURE_SPEC.md\` §8 (canonical contract, node and edge classes,
graph invariants, versioning); \`MASTER_IMPLEMENTATION_PLAN.md\` §6 (Phase 6) and §34 (the gate:
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

## 2. Node classes (${String(NODE_CLASSES.length)})

${nodeClassTable()}

**Node states:** ${NODE_STATES.map(code).join(', ')}.

A superseded node stays in the graph. The record is of what was believed, not only of what is
believed now.

### Immutable classes

${IMMUTABLE_CLASSES.map((c) => `- ${code(c)}`).join('\n')}

Immutability is enforced in three places: \`applyNodeChange\` throws, \`checkInvariants\` reports
\`IMMUTABLE_NODE_CHANGED\`, and the database refuses the write. The guarantee should not rest on any
one of them being correct.

---

## 3. Edge classes (${String(EDGE_CLASSES.length)})

${edgeClassTable()}

**Acyclic:** ${ACYCLIC_EDGES.map(code).join(', ')} — a cycle in any of these is an error, not a
warning. A containment loop is a hierarchy with no root; a \`BLOCKS\` loop is a deadlock the plan
would otherwise present as a schedule.

**At most one:** ${SINGLE_PARENT_EDGES.map(code).join(', ')} — two parents means every roll-up counts
the node twice, silently.

---

## 4. Legality matrix

Deny by default. Of ${String(totalPairings)} possible \`(edge class, from, to)\` combinations,
**${String(totalLegal)}** are legal — ${((totalLegal / totalPairings) * 100).toFixed(1)}%.

The two rules gap-spec §8.3 names explicitly:

- A ${code('TEST')} **may** ${code('VERIFIES')} a ${code('REQUIREMENT')}.
- A ${code('TASK')} **may not**. Work near a requirement is not evidence that it is met, and a
  traceability matrix that conflates the two produces a compliance report that is confidently wrong.

${legalitySection()}

---

## 5. Graph invariants

Checked across the whole graph, not at the point of a single mutation — acyclicity, single parentage
and gate staleness can each be broken by an edge that was individually legal.

| Code | Severity | What it catches |
|---|---|---|
| \`ILLEGAL_EDGE\` | error | A pairing the legality matrix refuses |
| \`SELF_REFERENCE\` | error | A node related to itself |
| \`CYCLE\` | error | A loop in an acyclic relation |
| \`MULTIPLE_PARENTS\` | error | Two containers or two owners |
| \`ORPHANED_NODE\` | warning | Outside the structure, so absent from every total |
| \`IMMUTABLE_NODE_CHANGED\` | error | An edit to a baseline, evidence or approval |
| \`ARCHIVED_PROJECT_MUTATED\` | error | A change to an archived project |
| \`STALE_GATE\` | error | A passed gate whose basis has since changed |
| \`UNVERIFIED_REQUIREMENT\` | warning | Nothing tests it |
| \`CROSS_PROJECT_EDGE\` | error | A node from another tenant |

${String(INVARIANT_CODES.length)} codes, each with a message written for the project owner rather
than for a log.

### Gate staleness

Gap-spec §8.3: *"a completed gate cannot silently change when source evidence changes; it becomes
stale/revalidation-required."*

The word doing the work is **silently**. The gate's own recorded result is left alone — reopening it
automatically would destroy the record of what was concluded and when, and a compliance trail that
rewrites itself is not a trail. What changes is that the graph now reports the conclusion is no
longer safe to rely on, via an \`INVALIDATES\` edge.

---

## 6. Versioning

Gap-spec §8.4 forbids copying the database per version. Three mechanisms, each answering a different
question:

| Question | Mechanism |
|---|---|
| What is true now? | The nodes and edges. One row per entity. |
| What changed, when, why, by whom? | The change log — one entry per material change. |
| What did we commit to at that moment? | A baseline: a complete, immutable, checksummed snapshot. |

**Change kinds:** ${CHANGE_KINDS.map(code).join(', ')}.

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

**Generator version:** ${GENERATOR_VERSION}.

The Phase-6 gate is deterministic generation from a golden fixture. Three things are therefore banned
in \`generate.ts\`, and each ban is load-bearing:

- **No \`Date.now()\`.** The timestamp is an input.
- **No random ids.** Node ids derive from a stable path (\`…:req:accessibility\`), so two runs
  produce comparable plans and the change log stays meaningful across regeneration.
- **No unordered iteration.** Everything walks declared order or sorts explicitly, including the
  topological sort's tie-break.

The suite asserts byte-identical output across ten consecutive runs for each of four fixtures, that
ids are stable and non-random, that the resulting graph satisfies every invariant — and that
different inputs produce different graphs, without which the other assertions would pass for a
generator that returned nothing.
`;

const check = process.argv.includes('--check');

if (check) {
  let existing = '';
  try {
    existing = readFileSync(OUTPUT, 'utf8');
  } catch {
    console.error('docs/PROJECT_DIGITAL_TWIN_SCHEMA.md is missing. Run `pnpm docs:twin`.');
    process.exit(1);
  }

  if (existing !== content) {
    console.error(
      'docs/PROJECT_DIGITAL_TWIN_SCHEMA.md is out of date with packages/twin/src/.\n' +
        'Run `pnpm docs:twin` and commit the result.',
    );
    process.exit(1);
  }

  console.log('Digital Twin schema is up to date.');
} else {
  writeFileSync(OUTPUT, content, 'utf8');
  console.log(
    `Wrote ${OUTPUT} (${String(NODE_CLASSES.length)} node classes, ${String(
      EDGE_CLASSES.length,
    )} edge classes).`,
  );
}
