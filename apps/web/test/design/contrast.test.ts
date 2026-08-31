/**
 * Colour contrast verification.
 *
 * Contract: MASTER_IMPLEMENTATION_PLAN.md section 25 targets WCAG 2.2 AA and requires contrast to be
 * verified "where tooling can verify"; docs/DESIGN_HANDOFF_SPEC.md section 6 makes this a mandatory
 * check before Phase 2 closes, because five status colours (`warning`, `blocked`, `exception`,
 * `info`, `unknown`) were **derived** rather than extracted - they exist in no Stitch export.
 *
 * The token values are parsed out of the shipped `globals.css` rather than mirrored in TypeScript.
 * A mirror would be free to drift from what actually renders; parsing the real stylesheet means this
 * test can only ever pass for values the browser is really given.
 *
 * WCAG 2.2 AA thresholds:
 *   4.5:1  normal body text
 *   3.0:1  large text (>=18.66px bold or >=24px) and non-text UI boundaries
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const cssPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'src',
  'app',
  'globals.css',
);
const css = readFileSync(cssPath, 'utf8');

/** Extract every `--color-*` custom property declared in the stylesheet. */
function extractColorTokens(source: string): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const [, name, value] of source.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8});/g)) {
    if (name !== undefined && value !== undefined) tokens.set(name, value.toLowerCase());
  }
  return tokens;
}

const tokens = extractColorTokens(css);

function toRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h.slice(0, 6);
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const channels = toRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

function token(name: string): string {
  const value = tokens.get(name);
  if (value === undefined) throw new Error(`Token --color-${name} is not defined in globals.css`);
  return value;
}

/** Round to 2dp so failure messages read cleanly. */
function ratio(fg: string, bg: string): number {
  return Math.round(contrastRatio(token(fg), token(bg)) * 100) / 100;
}

describe('token extraction', () => {
  it('finds the full extracted palette in the shipped stylesheet', () => {
    // 47 extracted from the exports, plus the derived status aliases and --color-subtle (D1).
    expect(tokens.size).toBeGreaterThanOrEqual(47);
  });

  it('defines every colour the gate states need', () => {
    // Two of the six Quality Gate states had no colour anywhere in the handoff.
    for (const name of [
      'success',
      'danger',
      'warning',
      'blocked',
      'exception',
      'info',
      'unknown',
    ]) {
      expect(tokens.has(name), `--color-${name} missing`).toBe(true);
    }
  });
});

describe('body text contrast (AA, 4.5:1)', () => {
  const surfaces = [
    'background',
    'surface-container-low',
    'surface-container',
    'surface-container-high',
  ];

  it.each(surfaces)('on-surface is readable on %s', (surface) => {
    expect(ratio('on-surface', surface)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(surfaces)('on-surface-variant is readable on %s', (surface) => {
    expect(ratio('on-surface-variant', surface)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('derived status colours (AA, 4.5:1)', () => {
  // These are the values with no basis in any export. If any fails, the derivation is wrong and the
  // token must change - not the threshold.
  const surfaces = ['background', 'surface-container-low', 'surface-container'];

  it.each(surfaces)('warning is readable on %s', (surface) => {
    expect(ratio('warning', surface)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(surfaces)('exception is readable on %s', (surface) => {
    expect(ratio('exception', surface)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(surfaces)('blocked is readable on %s', (surface) => {
    expect(ratio('blocked', surface)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('extracted status colours (AA, 4.5:1)', () => {
  const surfaces = ['background', 'surface-container-low', 'surface-container'];

  it.each(surfaces)('success is readable on %s', (surface) => {
    expect(ratio('success', surface)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(surfaces)('danger is readable on %s', (surface) => {
    expect(ratio('danger', surface)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(surfaces)('primary is readable on %s', (surface) => {
    expect(ratio('primary', surface)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('status colours are distinguishable from each other', () => {
  // Non-colour encoding is mandatory (plan section 25), but colours that read as the same hue defeat
  // rapid scanning even for sighted users. `blocked` intentionally equals `warning` per DESIGN.md.
  const distinct = ['success', 'danger', 'warning', 'exception', 'primary'] as const;

  it.each(distinct.flatMap((a, i) => distinct.slice(i + 1).map((b) => [a, b] as const)))(
    '%s and %s are not the same value',
    (a, b) => {
      expect(token(a)).not.toBe(token(b));
    },
  );

  it('blocked deliberately shares the warning amber', () => {
    // DESIGN.md maps both to amber. Recorded as intentional so a future reader does not "fix" it.
    expect(token('blocked')).toBe(token('warning'));
  });
});

describe('interactive element contrast', () => {
  it('primary button label is readable on the primary fill (4.5:1)', () => {
    expect(ratio('on-primary', 'primary')).toBeGreaterThanOrEqual(4.5);
  });

  it('the focus ring is visible against every surface (3:1 for UI boundaries)', () => {
    // WCAG 2.2 adds Focus Appearance; an invisible focus ring fails keyboard users outright.
    for (const surface of ['background', 'surface-container-low', 'surface-container-high']) {
      expect(ratio('primary', surface), `focus ring on ${surface}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('default borders are perceivable against their surface (3:1)', () => {
    expect(ratio('outline', 'surface-container-low')).toBeGreaterThanOrEqual(3);
  });
});

describe('muted text', () => {
  it('text-muted meets AA on the main content surface', () => {
    // `--color-subtle` and `unknown` both alias `outline`. If this fails, the muted tone is too dim
    // to be body text and must be restricted to non-text use.
    expect(ratio('unknown', 'surface-container-low')).toBeGreaterThanOrEqual(4.5);
  });
});
