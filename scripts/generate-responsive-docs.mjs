#!/usr/bin/env node
/**
 * Generate `docs/RESPONSIVE_CONTRACT.md` from `packages/design/src/responsive.ts`.
 *
 * §3.3 and §3.4 ask for exact behaviour at six sizes and four answers about each of ten dense
 * representations. That is forty statements, which is exactly the kind of table that rots in prose
 * without anybody noticing — so it is generated, and `pnpm docs:responsive --check` fails CI when the
 * document and the contract disagree.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const OUT = join(process.cwd(), 'docs', 'RESPONSIVE_CONTRACT.md');

const load = (path) => import(pathToFileURL(join(process.cwd(), path)).href);

const { BREAKPOINTS, BREAKPOINT_SPEC, DENSE_REPRESENTATIONS, DENSE_SPEC, MIN_TOUCH_TARGET_PX } =
  await load('packages/design/src/responsive.ts');

const code = (s) => `\`${s}\``;

const breakpointRows = BREAKPOINTS.map((b) => {
  const spec = BREAKPOINT_SPEC[b];
  return `| ${code(b)} | ${String(spec.from)}px | ${spec.prefix === null ? '— (base)' : code(spec.prefix)} | ${spec.behaviour} |`;
});

const denseSections = DENSE_REPRESENTATIONS.map((key) => {
  const spec = DENSE_SPEC[key];

  return `### ${key.toLowerCase().replace(/_/g, ' ')}

| Size | Representation |
|---|---|
| Desktop | ${spec.desktop} |
| Tablet | ${spec.tablet} |
| Mobile | ${spec.mobile} |

**Accessible alternative.** ${spec.accessibleAlternative}

Present at every size: ${spec.alwaysPresent ? '**yes**' : 'no'}.`;
});

const content = `# RESPONSIVE CONTRACT

> **Generated file — do not edit by hand.**
> Source of truth: \`packages/design/src/responsive.ts\`.
> Regenerate with \`pnpm docs:responsive\`. CI runs \`pnpm docs:responsive --check\`.

**Contract:** \`IMPLEMENTATION_GAP_CLOSURE_SPEC.md\` §3.3 (responsive behaviour), §3.4 (dense-screen
rules), §3.5 (missing designs); \`MASTER_IMPLEMENTATION_PLAN.md\` Phase 16.

---

## 1. Breakpoints

§3.3's six sizes. The widths are Tailwind's, because inventing a second scale would mean every class
in the codebase is written against one and reasoned about against another.

| Size | From | Prefix | Behaviour |
|---|--:|---|---|
${breakpointRows.join('\n')}

**Mobile is the base layer, not an override.** §3.3 says the implementation "must not merely shrink
desktop UI", and writing mobile as the default with enhancements upward is what makes that true
rather than aspirational: a layout that exists only as a set of overrides has a desktop shape
underneath it, and the overrides are where it breaks.

**Wide desktop stops widening.** Line length is a readability constraint rather than a space one. A
paragraph stretched across 1800px is harder to read than the same paragraph at 700px, so extra width
becomes margin.

### How this is enforced

Prose cannot check itself, so the contract is tested through its symptom: **a shrunk desktop scrolls
sideways.** \`e2e/mobile.spec.ts\` asserts that every route — public pages and all ten project
surfaces — fits a 412px viewport with no horizontal overflow.

That test found a real defect on the first run: a three-column panel on the landing page needed about
425px and never stacked, so the whole document was wider than the phone. Nothing looked broken; the
page simply had to be dragged sideways to read, which is exactly what §3.3 is about.

---

## 2. Touch targets

Minimum: **${String(MIN_TOUCH_TARGET_PX)}px**.

WCAG 2.2 §2.5.8 sets 24px, but that is the level below which a target *fails*. Designing to a failure
threshold means every rounding error is a defect. ${String(MIN_TOUCH_TARGET_PX)}px is roughly the pad
of an adult finger, which is the constraint the criterion is approximating.

Checked by **measuring rendered boxes**, not by inspecting classes. A class that should produce 44px
and does not — because something overrode it, or the element is inline — is precisely the failure a
class-based check cannot see.

Targets inside a sentence are exempt, as §2.5.8 exempts them; enforcing it there would mean no prose
could contain a link.

---

## 3. Dense representations

§3.4 names ten and asks four things about each. The fourth — the accessible alternative — is listed
**separately from the mobile fallback**, and treating them as the same thing is the mistake this
contract exists to prevent.

A mobile fallback is what a small screen gets. An accessible alternative is what somebody gets who
cannot perceive the visual form **at any size**. A screen-reader user on a 27-inch monitor needs the
alternative, and a design that ships it only below 640px has not provided one.

So the rule here is stronger than §3.4 strictly requires: **the accessible alternative is always in
the document**, and the visual representation is supplementary to it. That inverts the usual
arrangement, where a table sits behind a toggle as a degraded thing — and it is the only arrangement
where the alternative cannot rot, because everybody is looking at it.

A test asserts, for every representation, that the accessible alternative is not merely a restatement
of the mobile fallback. Writing them as the same sentence is how the alternative ends up behind a
media query.

${denseSections.join('\n\n')}

---

## 4. Derived screens (§3.5)

Where a locked screen was not in the Stitch export, it was built from the established design system
and its primitives, preserving the navigation and visual language, and recorded as derived rather
than exported in \`docs/DESIGN_SCREEN_MAP.md\`.
`;

const check = process.argv.includes('--check');

if (check) {
  let existing;

  try {
    existing = readFileSync(OUT, 'utf8');
  } catch {
    console.error('docs/RESPONSIVE_CONTRACT.md is missing. Run `pnpm docs:responsive`.');
    process.exit(1);
  }

  if (existing !== content) {
    console.error(
      'docs/RESPONSIVE_CONTRACT.md is out of date with the responsive contract. Run `pnpm docs:responsive`.',
    );
    process.exit(1);
  }

  console.log('Responsive contract is up to date.');
} else {
  writeFileSync(OUT, content, 'utf8');
  console.log('Wrote docs/RESPONSIVE_CONTRACT.md');
}
