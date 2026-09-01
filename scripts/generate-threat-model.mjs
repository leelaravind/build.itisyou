#!/usr/bin/env node
/**
 * Generate `docs/THREAT_MODEL.md` from `packages/release/src/security.ts`.
 *
 * Gap-spec §34 says "Create: docs/THREAT_MODEL.md" and lists nineteen threats. The decision to hold
 * that list in code and generate the document is the point of the whole exercise: a threat model in
 * prose starts decaying the day it is written, and nobody notices because prose does not fail a
 * build.
 *
 * Here each threat carries its mitigations, the tests that demonstrate them, and its residual risk;
 * a threat with no recorded verification appears in the release report as a gap. So the document and
 * the gate read the same data, and `pnpm docs:threats --check` fails CI when they diverge.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const OUT = join(process.cwd(), 'docs', 'THREAT_MODEL.md');

const load = (path) => import(pathToFileURL(join(process.cwd(), path)).href);

const { THREATS, FINDING_SEVERITIES, FINDING_STATES, FINDING_SOURCES } = await load(
  'packages/release/src/security.ts',
);

const { PRODUCTION_CHECKS } = await load('packages/release/src/deployment.ts');

const code = (s) => `\`${s}\``;

const sections = THREATS.map((threat) => {
  const mitigations = threat.mitigations.map((m) => `- ${m}`).join('\n');

  const verification =
    threat.verifiedBy.length === 0
      ? '> **Not verified.** The mitigation above is believed rather than demonstrated. This appears\n> in the release report as a gap rather than being assumed handled.'
      : threat.verifiedBy.map((v) => `- ${v}`).join('\n');

  return `### ${threat.title}

**Attacker goal.** ${threat.goal}

**Mitigations**

${mitigations}

**How we know**

${verification}

**Residual risk.** ${threat.residualRisk}`;
});

const unverified = THREATS.filter((t) => t.verifiedBy.length === 0);

const content = `# THREAT MODEL

> **Generated file — do not edit by hand.**
> Source of truth: \`packages/release/src/security.ts\`.
> Regenerate with \`pnpm docs:threats\`. CI runs \`pnpm docs:threats --check\`.

**Contract:** \`IMPLEMENTATION_GAP_CLOSURE_SPEC.md\` §34, which requires a threat model before
production and names the ${String(THREATS.length)} threats below.

---

## Why this is generated

A threat model written as prose starts decaying the day it is written, and nothing notices, because
prose does not fail a build. This one is held in code: each threat carries its mitigations, the tests
that demonstrate them, and its residual risk. A threat with **no recorded verification** appears in
the release report as a gap rather than being assumed handled, and the security gate reads the same
data this document is generated from.

## What it does not claim

${
  unverified.length === 0
    ? 'Every threat below records at least one verification.'
    : `${String(unverified.length)} of ${String(THREATS.length)} threats have no recorded verification: ${unverified
        .map((t) => t.title.toLowerCase())
        .join(
          ', ',
        )}. Most are mitigated by a feature not existing yet, which is a real mitigation and a fragile one — adding the feature reintroduces the threat in full.`
}

A threat model that claimed complete coverage would be the least believable kind. Every entry states
a residual risk, and those statements are the part worth arguing with.

---

## Threats

${sections.join('\n\n---\n\n')}

---

## Findings

Findings discovered against these threats are recorded with a severity, a state, and a source.

**Severities:** ${FINDING_SEVERITIES.map(code).join(', ')}

\`INFORMATIONAL\` is retained rather than tidied away. Informational findings are frequently the first
half of a chain — an information disclosure harmless alone, and the reconnaissance step for something
that is not.

**States:** ${FINDING_STATES.map(code).join(', ')}

\`ACCEPTED\` and \`FALSE_POSITIVE\` are deliberately distinct. "It is real and we are shipping anyway"
and "we looked and it is not real" are different claims, they age differently, and only one needs
revisiting when the system changes around it. Both require a rationale and a named decider; without
those the two become the same button.

**Sources:** ${FINDING_SOURCES.map(code).join(', ')}

### What blocks a release

Critical and high findings block while open or in progress. "In progress" at a release gate is a
decision made by omission, so it counts as outstanding.

Medium and below do not block. That is a policy statement rather than a fact about severity, and it
lives in one function so a project with a different risk appetite changes it once.

---

## Production verification

§15.9 requires ${String(PRODUCTION_CHECKS.length)} checks against the running system:
${PRODUCTION_CHECKS.map(code).join(', ')}.

**This platform cannot observe production.** It records what somebody checked and what they kept. An
unrecorded check is therefore \`NOT_CHECKED\`, and the gate returns **indeterminate** rather than
passed.

That distinction is the most consequential default in the codebase. Software that reports its own
production as healthy because nobody entered a failure is making the single most damaging false claim
available to it — and this is the record people go back to after something has gone wrong.

Equally, a check that ran and failed is **failed**, not indeterminate. If the two read the same, a
release record cannot distinguish "we looked and it is broken" from "nobody looked", and the second
gets quietly treated as the first.
`;

const check = process.argv.includes('--check');

if (check) {
  let existing;

  try {
    existing = readFileSync(OUT, 'utf8');
  } catch {
    console.error('docs/THREAT_MODEL.md is missing. Run `pnpm docs:threats`.');
    process.exit(1);
  }

  if (existing !== content) {
    console.error(
      'docs/THREAT_MODEL.md is out of date with the threat catalogue. Run `pnpm docs:threats`.',
    );
    process.exit(1);
  }

  console.log('Threat model is up to date.');
} else {
  writeFileSync(OUT, content, 'utf8');
  console.log('Wrote docs/THREAT_MODEL.md');
}
