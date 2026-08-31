/**
 * Token completeness.
 *
 * Contract: docs/DESIGN_HANDOFF_SPEC.md section 6.4 — "A test asserts no component references a token
 * outside the frozen set — this is what would have caught D1 and D4 at authoring time."
 *
 * D1 was `border-subtle`: used 67 times across the Stitch exports, defined in none of them, silently
 * resolving to no colour. D4 was `headline-sm`, used on 8 screens and defined nowhere. Both are the
 * same failure — a utility class that looks right, compiles fine, and renders nothing.
 *
 * Tailwind gives no error for an unknown utility. Nothing else in the toolchain will catch this
 * class of defect, so this test is the only thing standing between the codebase and a repeat.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..', '..');
const srcRoot = join(appRoot, 'src');
const css = readFileSync(join(srcRoot, 'app', 'globals.css'), 'utf8');

/** Custom-property families declared in the `@theme` block. */
function declared(prefix: string): Set<string> {
  const names = new Set<string>();
  for (const [, name] of css.matchAll(new RegExp(`--${prefix}-([a-zA-Z0-9-]+):`, 'g'))) {
    if (name !== undefined) names.add(name);
  }
  return names;
}

const colors = declared('color');
const spacing = declared('spacing');
const radii = declared('radius');
const fontSizes = declared('text');
const fonts = declared('font');

/** Tailwind ships these regardless of the theme block. */
const BUILTIN_SPACING = new Set([
  'px',
  '0',
  '0.5',
  '1',
  '1.5',
  '2',
  '2.5',
  '3',
  '3.5',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  '11',
  '12',
  '14',
  '16',
  '20',
  '24',
  '28',
  '32',
  '36',
  '40',
  '44',
  '48',
  '52',
  '56',
  '60',
  '64',
  '72',
  '80',
  '96',
  'auto',
  'full',
]);

const BUILTIN_COLORS = new Set(['transparent', 'current', 'inherit', 'white', 'black']);

const BUILTIN_RADII = new Set(['none', 'full', 'sm', 'md', 'lg', 'xl', '2xl', '3xl']);

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (['.ts', '.tsx'].includes(extname(full))) yield full;
  }
}

interface Usage {
  readonly file: string;
  readonly utility: string;
  readonly value: string;
}

/**
 * Collect utility classes from `className` string literals and from the class maps in `status.ts`.
 * Deliberately conservative: it only inspects string literals, so a dynamically built class name
 * would be missed. Those are rare here by design — the token maps are static objects.
 */
function collectUsages(): Usage[] {
  const usages: Usage[] = [];
  const pattern =
    // Greedy on the value: a lazy quantifier truncates `text-on-surface` to `text-on`, which then
    // reports every legitimate token as undefined. The trailing `\b` is omitted for the same reason.
    /(?:^|[\s'"`])(?:(?:sm|md|lg|xl|2xl|hover|focus|focus-visible|active|disabled|group-hover|last|first|not-sr-only):)*(bg|text|border|ring|outline|fill|stroke|from|to|via|gap|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|rounded|font|shadow)-([a-zA-Z0-9][a-zA-Z0-9-]*?)(?:\/\d+)?(?=[\s'"`]|$)/g;

  for (const file of walk(srcRoot)) {
    const source = readFileSync(file, 'utf8');
    const rel = relative(appRoot, file);

    // Only strings that plausibly hold class names.
    for (const [, literal] of source.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`\n]*)`/g)) {
      if (
        literal === undefined ||
        !/\b(?:bg|text|border|gap|rounded|font|p|px|py)-/.test(literal)
      ) {
        continue;
      }
      for (const [, utility, value] of literal.matchAll(pattern)) {
        if (utility !== undefined && value !== undefined) {
          usages.push({ file: rel, utility, value });
        }
      }
    }
  }

  return usages;
}

const usages = collectUsages();

describe('the scanner actually sees the codebase', () => {
  it('finds utility classes to check', () => {
    // A scanner that silently matches nothing would pass forever while proving nothing.
    expect(usages.length).toBeGreaterThan(50);
  });

  it('reads the theme block', () => {
    expect(colors.size).toBeGreaterThanOrEqual(47);
    expect(spacing.size).toBeGreaterThan(0);
  });
});

describe('every colour utility references a defined token', () => {
  it('uses no undefined colour', () => {
    const offenders = usages
      .filter((u) =>
        ['bg', 'text', 'border', 'ring', 'outline', 'fill', 'stroke'].includes(u.utility),
      )
      // `outline-offset-N` and `outline-N` set geometry, not colour.
      .filter((u) => !(u.utility === 'outline' && /^(offset-)?\d+$/.test(u.value)))
      // Non-colour values legitimately share these prefixes.
      .filter((u) => !fontSizes.has(u.value))
      .filter((u) => !fonts.has(u.value))
      .filter(
        (u) =>
          ![
            'left',
            'right',
            'center',
            'justify',
            'wrap',
            'nowrap',
            'balance',
            'pretty',
            'ellipsis',
            'clip',
            'dashed',
            'dotted',
            'solid',
            'none',
            'collapse',
            'separate',
            'medium',
            'semibold',
            'bold',
            'normal',
            'mono',
            'sans',
            'serif',
            'offset',
            // Border side and width utilities share the `border-` prefix but carry no colour.
            'b',
            't',
            'l',
            'r',
            'x',
            'y',
            'e',
            's',
            '2',
            '1',
            '0',
            '4',
            '8',
          ].includes(u.value),
      )
      .filter((u) => !colors.has(u.value) && !BUILTIN_COLORS.has(u.value));

    const detail = offenders.map((o) => `${o.file}: ${o.utility}-${o.value}`);
    expect(detail, `undefined colour tokens:\n${detail.join('\n')}`).toEqual([]);
  });
});

describe('every spacing utility references a defined token', () => {
  it('uses no undefined spacing value', () => {
    // This is the check that catches `gap-3xs` — a plausible-looking token that does not exist.
    const offenders = usages
      .filter((u) =>
        [
          'gap',
          'p',
          'px',
          'py',
          'pt',
          'pb',
          'pl',
          'pr',
          'm',
          'mx',
          'my',
          'mt',
          'mb',
          'ml',
          'mr',
        ].includes(u.utility),
      )
      .filter((u) => !spacing.has(u.value) && !BUILTIN_SPACING.has(u.value));

    const detail = offenders.map((o) => `${o.file}: ${o.utility}-${o.value}`);
    expect(detail, `undefined spacing tokens:\n${detail.join('\n')}`).toEqual([]);
  });
});

describe('every radius utility references a defined token', () => {
  it('uses no undefined radius', () => {
    const offenders = usages
      .filter((u) => u.utility === 'rounded')
      .filter((u) => !radii.has(u.value) && !BUILTIN_RADII.has(u.value));

    const detail = offenders.map((o) => `${o.file}: rounded-${o.value}`);
    expect(detail, `undefined radii:\n${detail.join('\n')}`).toEqual([]);
  });
});

describe('typography utilities reference defined scale entries', () => {
  it('uses no undefined text size', () => {
    const known = new Set([...fontSizes, ...colors]);
    const offenders = usages
      .filter((u) => u.utility === 'text')
      .filter(
        (u) =>
          !/^(left|right|center|justify|wrap|nowrap|balance|pretty|ellipsis|clip)$/.test(u.value),
      )
      .filter((u) => !known.has(u.value) && !BUILTIN_COLORS.has(u.value));

    const detail = offenders.map((o) => `${o.file}: text-${o.value}`);
    expect(detail, `undefined text tokens:\n${detail.join('\n')}`).toEqual([]);
  });

  it('uses no undefined font family', () => {
    const offenders = usages
      .filter((u) => u.utility === 'font')
      .filter((u) => !/^(medium|semibold|bold|normal|light|thin|black|extrabold)$/.test(u.value))
      .filter((u) => !fonts.has(u.value) && !fontSizes.has(u.value));

    const detail = offenders.map((o) => `${o.file}: font-${o.value}`);
    expect(detail, `undefined font tokens:\n${detail.join('\n')}`).toEqual([]);
  });
});

describe('the frozen palette is respected', () => {
  it("defines the design-system radius scale from DESIGN.md, not the exports' shifted one", () => {
    // D2: the exports emit every radius name one step down, with `full` at 0.75rem.
    expect(css).toContain('--radius-full: 9999px');
    expect(css).toContain('--radius-xl: 0.75rem');
    expect(css).toContain('--radius-lg: 0.5rem');
  });

  it("defines --color-subtle, the alias for the export's undefined border-subtle", () => {
    expect(colors.has('subtle')).toBe(true);
  });

  it('defines headline-sm, used on 8 screens and absent from the handoff', () => {
    expect(fontSizes.has('headline-sm')).toBe(true);
  });
});
