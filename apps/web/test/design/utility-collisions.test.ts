/**
 * Utility-namespace collisions.
 *
 * Contract: docs/DESIGN_HANDOFF_SPEC.md §6.4 requires that a component cannot silently reference a
 * token that means something other than what the author intended.
 *
 * This exists because of a real defect, found by an E2E assertion rather than by review. Tailwind
 * resolves `max-w-<name>` through the **spacing** namespace before the container one. The design
 * system defines `--spacing-md`, `--spacing-xl`, `--spacing-2xl` and `--spacing-3xl`, so every
 * `max-w-3xl` in the application meant **64px**, and every `max-w-md` meant **16px**.
 *
 * The pages still rendered. Text wrapped, colours were right, nothing threw — the main column had
 * simply collapsed to the width of its longest word. It surfaced only when a heading measured zero
 * pixels wide and Playwright reported it as hidden, which reads as a test bug rather than a layout
 * one. Nothing in review would have caught it: `max-w-3xl` is the most ordinary class in Tailwind.
 *
 * The tests below assert the general rule, not the five classes that were wrong. A test that only
 * banned `max-w-3xl` would pass while the next spacing token added reintroduced the same collision.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
const css = readFileSync(join(root, 'app', 'globals.css'), 'utf8');

/** Every token name declared under a given Tailwind namespace. */
function tokenNames(namespace: string): Set<string> {
  const names = new Set<string>();
  const pattern = new RegExp(`--${namespace}-([a-z0-9-]+):`, 'g');
  for (const [, name] of css.matchAll(pattern)) {
    // `--text-body-md--line-height` style modifiers are not tokens in their own right.
    if (name !== undefined && !name.includes('--')) names.add(name);
  }
  return names;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (full.endsWith('.tsx') || full.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

const files = sourceFiles(root);

/** Every `max-w-x` / `min-w-x` / `max-h-x` class used anywhere in the application. */
function widthClassesUsed(): { file: string; className: string; suffix: string }[] {
  const found: { file: string; className: string; suffix: string }[] = [];

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const [full, prefix, suffix] of source.matchAll(
      /\b((?:max|min)-[wh])-([a-z0-9]+(?:xl)?)\b/g,
    )) {
      if (prefix === undefined || suffix === undefined) continue;
      // Arbitrary values (`max-w-[1440px]`) are explicit by construction and cannot collide.
      found.push({ file, className: full, suffix });
    }
  }

  return found;
}

describe('sizing utilities cannot silently resolve to a spacing token', () => {
  const spacing = tokenNames('spacing');

  it('the spacing scale is actually being read', () => {
    // Guards the guard. If the extraction broke, every assertion below would pass vacuously.
    expect(spacing.has('md')).toBe(true);
    expect(spacing.has('3xl')).toBe(true);
  });

  it('finds sizing utilities to check', () => {
    expect(widthClassesUsed().length).toBeGreaterThan(0);
  });

  it('no width or height utility names a token that is also a spacing token', () => {
    /*
     * `max-w-md` is not a typo — it is a real Tailwind class with a real meaning. The problem is that
     * *this* design system gives `md` a second meaning, and the spacing one wins. So the rule is not
     * "avoid these class names"; it is "a sizing utility must not name something the spacing scale
     * also names", which stays correct as the token set grows.
     */
    const collisions = widthClassesUsed()
      .filter((u) => spacing.has(u.suffix))
      .map(
        (u) => `${u.file.slice(root.length + 1)}: ${u.className} resolves to --spacing-${u.suffix}`,
      );

    expect(collisions).toEqual([]);
  });
});

describe('the container tokens the application actually uses are defined', () => {
  const containers = tokenNames('container');

  it('declares the named content widths', () => {
    // Named rather than numbered so nothing in the spacing scale can ever shadow them.
    expect([...containers].sort()).toEqual(
      expect.arrayContaining(['content', 'form', 'narrow', 'prose', 'wide']),
    );
  });

  it('gives every container token a width that could hold a column of text', () => {
    // The failure being guarded against was a max-width of 64px. Any content container below a few
    // hundred pixels is the same defect wearing a different number.
    for (const name of ['content', 'form', 'narrow', 'prose', 'wide']) {
      const match = new RegExp(`--container-${name}:\\s*(\\d+)px`).exec(css);
      expect(match, `--container-${name} should be declared in px`).not.toBeNull();
      expect(Number(match?.[1] ?? 0)).toBeGreaterThan(320);
    }
  });

  it('every max-w-* utility in the application names a defined container token', () => {
    // The other half of the collision: a container name that does not exist produces no CSS at all,
    // which looks identical to "the design just does not constrain this element".
    const unknown = files.flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return [...source.matchAll(/\bmax-w-([a-z][a-z0-9-]*)\b/g)]
        .map(([, name]) => name)
        .filter((name): name is string => name !== undefined)
        .filter(
          (name) => !containers.has(name) && name !== 'full' && name !== 'fit' && name !== 'none',
        )
        .map((name) => `${file.slice(root.length + 1)}: max-w-${name}`);
    });

    expect(unknown).toEqual([]);
  });
});
