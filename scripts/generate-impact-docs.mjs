#!/usr/bin/env node
/**
 * Generate `docs/IMPACT_PROPAGATION_SPEC.md` from `packages/change/src/`.
 *
 * §27 says "Create: docs/IMPACT_PROPAGATION_SPEC.md" and "Every relationship type must define
 * whether change propagates". Generating it from the rules guarantees the second sentence: the
 * document enumerates every edge class the twin has, and an edge with no rule appears as **does not
 * propagate** rather than being silently absent from a hand-written table.
 *
 * That is the difference that matters here. A prose version of this table would omit an edge by
 * accident and nobody would ever notice, because an unlisted edge and a non-propagating edge look
 * identical from the outside.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const OUT = join(process.cwd(), 'docs', 'IMPACT_PROPAGATION_SPEC.md');

const load = (path) => import(pathToFileURL(join(process.cwd(), path)).href);

const { EDGE_CLASSES } = await load('packages/twin/src/edges.ts');

const { STALENESS, STALENESS_MEANING, CHANGE_KINDS, CLAIM_BEARING, ruleFor } = await load(
  'packages/change/src/propagation.ts',
);

const { MAX_DEPTH, IMPACT_VERSION } = await load('packages/change/src/impact.ts');

const { REQUEST_STATES, STATE_MEANING, TRANSITIONS, REFUSALS } = await load(
  'packages/change/src/request.ts',
);

const code = (s) => `\`${s}\``;

const edgeRows = EDGE_CLASSES.map((edge) => {
  const rule = ruleFor(edge);

  if (rule === undefined) {
    return `| ${code(edge)} | — | **does not propagate** | — |`;
  }

  return `| ${code(edge)} | ${rule.direction === 'INBOUND' ? 'inbound' : 'outbound'} | ${code(rule.effect)} | ${rule.because} |`;
});

const stalenessRows = STALENESS.map((state) => `| ${code(state)} | ${STALENESS_MEANING[state]} |`);

const stateRows = REQUEST_STATES.map(
  (state) =>
    `| ${code(state)} | ${STATE_MEANING[state]} | ${TRANSITIONS[state].length === 0 ? '— (terminal)' : TRANSITIONS[state].map(code).join(', ')} |`,
);

const nonPropagating = EDGE_CLASSES.filter((edge) => ruleFor(edge) === undefined);

const content = `# IMPACT PROPAGATION SPECIFICATION

> **Generated file — do not edit by hand.**
> Source of truth: \`packages/change/src/{propagation,impact,request}.ts\`.
> Regenerate with \`pnpm docs:impact\`. CI runs \`pnpm docs:impact --check\`.

**Contract:** \`IMPLEMENTATION_GAP_CLOSURE_SPEC.md\` §26 (dependency graph), §27 (impact propagation),
§27.1 (staleness), §28 (change request atomicity); \`MASTER_IMPLEMENTATION_PLAN.md\` Phase 12.

**Impact engine version:** ${IMPACT_VERSION}

---

## 1. Propagation is decided per relationship, and most do not

§27 requires that every relationship type defines *whether* change propagates. The obvious
implementation propagates through every edge, and it is useless: any change reports several dozen
affected items, everything in a project is eventually connected to everything, and people stop
reading impact reports by the third one they see.

So this is a **deny-by-default allowlist**, like edge legality and RBAC before it.
${String(nonPropagating.length)} of the ${String(EDGE_CLASSES.length)} edge classes carry no
propagation at all, and each absence is deliberate rather than an omission.

Two worth naming:

- \`CONTAINS\` does not propagate. A project containing a changed task is not itself stale, and
  propagating up containment makes every change reach the project root — from which everything is
  reachable.
- \`OWNED_BY\` does not propagate. Changing a requirement does not affect who owns it.

| Edge | Direction | Effect | Why |
|---|---|---|---|
${edgeRows.join('\n')}

**Direction** is relative to how the edge is stored. \`inbound\` means impact travels from the edge's
target to its source — a \`TEST\` *verifies* a \`REQUIREMENT\`, so when the requirement changes, impact
reaches the test by walking that edge backwards. Getting this wrong produces an impact report that is
confidently empty.

---

## 2. Staleness (§27.1)

> "Do not delete dependent evidence/results automatically."

| State | Meaning |
|---|---|
${stalenessRows.join('\n')}

The distinction doing the work is \`STALE\` versus \`INVALIDATED\`. Stale means the claim was made
against an older version and *might* still hold — somebody has to look. Invalidated means it
definitely does not hold any more. Collapsing them either buries real breakage in a pile of maybes,
or makes every change look like it destroyed the project.

Nothing is deleted. A marked artefact still carries what it showed and when, so a reviewer can decide
whether the change actually affected it; deleting it destroys the only record of what was true before.

---

## 3. Distance weakens severity, and reachability survives it

Each hop weakens the verdict by one step: \`INVALIDATED\` → \`REVALIDATION_REQUIRED\` → \`STALE\`.

But \`STALE\` is the **floor** for anything reachable within ${String(MAX_DEPTH)} hops through
propagating edges. An earlier version let severity decay all the way to nothing, which meant a
\`STALE\` rule produced no result at all beyond the first hop — and §27's own worked example,
"architecture component changed → costs", never arrived, because the estimate is two hops out through
\`DERIVED_FROM\`.

Flooring at stale is honest: the thing *is* downstream of a change, and stale means exactly "may
still hold; somebody has to look".

Impact reaching a node by two paths takes the **worse** verdict, never an average.

### Depth limit

Traversal stops at ${String(MAX_DEPTH)} hops, and the report says when it did. A truncated analysis
presented as complete is the specific way an impact tool lies: nobody can tell from the output that
something was left out.

The limit also guarantees termination independently of the visited set. \`DEPENDS_ON\` cycles are
invalid (§26.2) and they exist in real projects, and an impact analyser that hangs on one is useless
at exactly the moment somebody is trying to understand a mess.

---

## 4. Change kinds

${CHANGE_KINDS.map(code).join(', ')}

\`COSMETIC\` propagates **nothing**. That single rule is what keeps impact reports worth reading: a
project where renaming a requirement invalidates its test suite produces reports that are mostly
noise, and a noisy report gets skimmed — including on the occasion it matters.

\`ADDITION\` propagates nothing either. Nothing pointed at it before it existed.

\`WITHDRAWAL\` escalates to \`INVALIDATED\` regardless of the edge. Dependants have not merely lost
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

${CLAIM_BEARING.map(code).join(', ')}

These are ranked first within a severity, because a stale \`EVIDENCE\` is something somebody does
something about and a stale \`PHASE\` is something the impact passed through.

---

## 6. Change request atomicity (§28)

| State | Meaning | May become |
|---|---|---|
${stateRows.join('\n')}

\`APPROVED → PENDING_APPROVAL\` is deliberately **absent**. If the base version moves, the request
becomes \`SUPERSEDED\` and a new one is raised. Silently returning it to pending would let an approval
be reused across a project version it was never given against.

### The step that matters

§28 lists ten steps. Nine are ordinary. Step 5 — "check optimistic concurrency" — is the reason the
list exists:

> Somebody previews a change against version 12, goes to a meeting, comes back and approves it.
> Meanwhile the project is at version 15. Applying now applies a decision that was made about a
> different project. The approver saw an impact report that is no longer true, and their name ends up
> on a choice they did not make.

Nothing errors without the check. The change applies cleanly and the record looks complete.

A request whose base version has moved becomes \`SUPERSEDED\` rather than \`REJECTED\`. Nobody decided
against it; the world moved, and those need different follow-ups.

### The preview and the application share one plan

\`plan()\` produces it, the preview renders it, \`apply()\` executes it. A preview computed by separate
code from the application is a second implementation, and the first time the two diverge it surfaces
to a user as "the system did something other than what it showed me".

### Refusals

${REFUSALS.map(code).join(', ')}

\`APPROVER_IS_REQUESTER\` is worth naming: self-approval records a decision with nobody independent
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
`;

const check = process.argv.includes('--check');

if (check) {
  let existing;

  try {
    existing = readFileSync(OUT, 'utf8');
  } catch {
    console.error('docs/IMPACT_PROPAGATION_SPEC.md is missing. Run `pnpm docs:impact`.');
    process.exit(1);
  }

  if (existing !== content) {
    console.error(
      'docs/IMPACT_PROPAGATION_SPEC.md is out of date with the propagation rules. Run `pnpm docs:impact`.',
    );
    process.exit(1);
  }

  console.log('Impact propagation specification is up to date.');
} else {
  writeFileSync(OUT, content, 'utf8');
  console.log('Wrote docs/IMPACT_PROPAGATION_SPEC.md');
}
