#!/usr/bin/env node
/**
 * Turn the Material Symbols names used in the source into inlined SVG geometry.
 *
 * Contract: plan section 19 (data minimisation), KI-007 (the CSP forbids fetching fonts at runtime).
 *
 * ## Why this script exists
 *
 * `MaterialIcon` used to render the icon's *name* into a span carrying the class
 * `material-symbols-outlined`, on the assumption that a ligature font would turn that word into a
 * glyph. The class was never defined, no `@font-face` was ever written and no font file was ever
 * committed, so every icon on all 50 screens rendered as its own name in the body font - the header
 * brand mark read "settings_suggest". Nothing caught it: icons are `aria-hidden`, so axe skips them,
 * and the end-to-end suites address the product by role and text.
 *
 * Inlining the geometry removes the failure mode rather than fixing this instance of it. There is no
 * font to load, so there is nothing to load late, load partially, or fail to load - and no flash of
 * ligature text on a cold cache, which a correctly configured icon font still shows.
 *
 * The generated module is the only list of icons that exists. `MaterialIcon` accepts `keyof` it, so
 * an icon name that is not in the set is a type error at build time rather than a word on a screen.
 * That is what turns "we fixed the icons" into "the icons cannot break this way again".
 *
 * Three names in the source were Material *Icons* names that Material Symbols does not have at all -
 * `settings_suggest`, `insights` and `auto_fix_high`. They could never have rendered under any font.
 * They are replaced at their call sites, and this script fails on an unknown name so a fourth cannot
 * be introduced quietly.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SVG_DIR = join(ROOT, 'node_modules', '@material-symbols', 'svg-400', 'outlined');
const OUT = join(ROOT, 'apps', 'web', 'src', 'components', 'ui', 'icon-paths.ts');
/*
 * Tests are scanned too. A test that renders an icon is a call site like any other, and one that
 * names an icon the product does not have is a test asserting against something that cannot render.
 */
const SOURCES = [
  join(ROOT, 'apps', 'web', 'src'),
  join(ROOT, 'apps', 'web', 'test'),
  join(ROOT, 'packages'),
];

/** Every icon carries this box. A different one would silently render at the wrong scale. */
const VIEW_BOX = '0 -960 960 960';

/** Windows separators, normalised, so the messages and the generated header read the same everywhere. */
function toPosix(path) {
  return path.split(String.fromCharCode(92)).join('/');
}

function sourceFiles() {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '.next') continue;
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(path) && !path.endsWith('icon-paths.ts')) found.push(path);
    }
  };
  SOURCES.forEach(walk);
  return found;
}

/**
 * The icon names a `name={...}` expression can evaluate to.
 *
 * Deliberately over-collects: a ternary picking between two icons must contribute both, or the
 * branch nobody screenshotted ships an icon that is not there.
 *
 * What it must *not* collect is the operand of a comparison. `name={tone === 'bad' ? 'error' :
 * 'info'}` mentions three strings and draws two of them; counting `bad` as an icon fails the build
 * over a string that was never an icon name. So comparisons are removed before the literals are
 * read, which leaves exactly the values the expression can produce.
 */
function iconLiterals(expression) {
  const values = expression
    .replace(/[!=]==?\s*'[a-z0-9_]+'/g, '')
    .replace(/'[a-z0-9_]+'\s*[!=]==?/g, '');

  return [...values.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
}

/** Every icon name the source asks for, with where it asked. */
function usedNames() {
  const uses = new Map();
  const add = (name, file) => {
    if (!uses.has(name)) uses.set(name, new Set());
    uses.get(name).add(toPosix(relative(ROOT, file)));
  };

  for (const file of sourceFiles()) {
    const src = readFileSync(file, 'utf8');

    for (const tag of src.matchAll(/<MaterialIcon\b[^>]*?\/?>/gs)) {
      for (const literal of tag[0].matchAll(/name=(?:"([a-z0-9_]+)"|\{([^}]*)\})/gs)) {
        if (literal[1] !== undefined) add(literal[1], file);
        for (const inner of iconLiterals(literal[2] ?? '')) add(inner, file);
      }
    }

    /*
     * `icon` props on anything that forwards one — `Button`, `EmptyState`, `StatTile`.
     *
     * Collecting only `<MaterialIcon name=…>` missed six icons that reach the component through a
     * prop instead of directly, and the type checker is what found them: `IconName` rejected
     * `"add"`, `"flag"`, `"schedule"`, `"search"`, `"notifications"` and `"save"` at their call
     * sites the moment the props were typed. A scanner that under-collects now breaks the build
     * rather than shipping a word.
     */
    for (const literal of src.matchAll(/\bicon=(?:"([a-z0-9_]+)"|\{([^}]*)\})/gs)) {
      if (literal[1] !== undefined) add(literal[1], file);
      for (const inner of iconLiterals(literal[2] ?? '')) add(inner, file);
    }

    for (const entry of src.matchAll(/\bicon:\s*'([a-z0-9_]+)'/g)) add(entry[1], file);

    /*
     * The body of anything declared to return an `IconName`.
     *
     * The tone-to-icon helpers on the plan pages map a status onto an icon and never mention
     * `MaterialIcon` at all, so nothing above sees them. Keying off the return type rather than the
     * function name means a new helper is picked up without being added to a list here.
     */
    for (const fn of src.matchAll(/\):\s*IconName\s*\{([\s\S]*?)\n\}/g)) {
      for (const inner of iconLiterals(fn[1])) add(inner, file);
    }
    for (const entry of src.matchAll(/\bICON_NAME\('([a-z0-9_]+)'\)/g)) add(entry[1], file);
  }

  return uses;
}

/** The `d` of every path in one icon. Anything that is not a path is refused rather than dropped. */
function geometry(name) {
  const svg = readFileSync(join(SVG_DIR, `${name}.svg`), 'utf8');

  const box = /viewBox="([^"]+)"/.exec(svg)?.[1];
  if (box !== VIEW_BOX)
    throw new Error(`${name}: viewBox is "${box ?? 'absent'}", expected "${VIEW_BOX}"`);

  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>[\s\S]*$/, '');
  const paths = [...inner.matchAll(/<path\b[^>]*\bd="([^"]+)"[^>]*\/?>/g)].map((m) => m[1]);

  const leftover = inner.replace(/<path\b[^>]*\/?>/g, '').trim();
  if (leftover !== '')
    throw new Error(`${name}: contains markup that is not a path: ${leftover.slice(0, 80)}`);
  if (paths.length === 0) throw new Error(`${name}: no path data`);

  return paths;
}

const uses = usedNames();
const names = [...uses.keys()].sort();
const available = new Set(readdirSync(SVG_DIR).map((f) => f.replace(/\.svg$/, '')));

/*
 * A name the source uses and Material Symbols does not have.
 *
 * Fatal, and worth being loud about: this is the exact defect the script was written for, and a
 * warning here would let it back in the moment somebody was in a hurry.
 */
const unknown = names.filter((n) => !available.has(n));
if (unknown.length > 0) {
  for (const name of unknown) {
    console.error(`unknown icon "${name}" used in: ${[...uses.get(name)].join(', ')}`);
  }
  console.error(`\n${String(unknown.length)} icon name(s) do not exist in Material Symbols.`);
  process.exit(1);
}

const entries = names.map((name) => [name, geometry(name)]);
const total = entries.reduce((sum, [, paths]) => sum + paths.join('').length, 0);

const body = entries
  .map(([name, paths]) => `  ${name}: [${paths.map((d) => `'${d}'`).join(', ')}],`)
  .join('\n');

const generated = `/**
 * Material Symbols geometry, inlined.
 *
 * GENERATED by \`scripts/generate-icons.mjs\` from \`@material-symbols/svg-400\`. Do not edit by hand -
 * run \`pnpm icons\` instead.
 *
 * Only the ${String(names.length)} icons the product actually uses are here. The set is the type
 * \`MaterialIcon\` accepts, so an icon that does not exist fails to compile rather than rendering as
 * its own name, which is what used to happen.
 *
 * Licensed under the Apache License 2.0, as the upstream icons are.
 */

export const ICON_PATHS = {
${body}
} as const;

/** Every icon the product can draw. */
export type IconName = keyof typeof ICON_PATHS;

/** The box every icon is drawn in. */
export const ICON_VIEW_BOX = '${VIEW_BOX}';
`;

/*
 * Formatted the way the repository formats everything else.
 *
 * Without this the generator and `pnpm format` disagree for ever: format rewrites the file, and the
 * next `--check` reports it out of date against output that was never wrong. Emitting through
 * Prettier means the generated file is already in its final shape.
 */
const formatted = await format(generated, {
  ...(await resolveConfig(OUT)),
  filepath: OUT,
});

const summary = `${String(names.length)} icons, ${String(Math.round(total / 1024))} KB of path data`;

/*
 * `--check` is what CI runs, alongside the other generators.
 *
 * The type checker already catches an icon that is used but not generated. What it cannot catch is
 * the file being edited by hand, or geometry drifting from the upstream package after an upgrade —
 * both of which produce a module that compiles and draws the wrong shape.
 */
if (process.argv.includes('--check')) {
  const existing = readFileSync(OUT, 'utf8');

  if (existing !== formatted) {
    console.error(`${toPosix(relative(ROOT, OUT))} is out of date. Run: pnpm icons`);
    process.exit(1);
  }

  console.log(`icons up to date (${summary})`);
} else {
  writeFileSync(OUT, formatted, 'utf8');
  console.log(`${summary} -> ${toPosix(relative(ROOT, OUT))}`);
}
