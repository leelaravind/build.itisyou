/**
 * MaterialIcon tests.
 *
 * Contract: plan §19 (data minimisation), KI-007 (the CSP forbids fetching a font at runtime),
 * plan §25 (an icon is the non-colour channel, so it has to actually appear).
 *
 * ## What these are really guarding
 *
 * The component previously rendered the icon's *name* into a span and relied on a ligature font to
 * turn it into a glyph. The font was never added: no `@font-face`, no file, and the class the span
 * carried was not defined anywhere. So every icon on all 50 screens drew its own name in the body
 * font — the header brand mark read `settings_suggest`, and `arrow_forward` spilled out of every
 * button.
 *
 * It survived a full accessibility suite and 800-odd end-to-end assertions because icons are
 * `aria-hidden` (axe steps over them) and the suites address the product by role and by text, which
 * were both still correct. The only test that ever noticed was a phone-width overflow check, and all
 * it could say was that something was six pixels too wide.
 *
 * So these tests assert the thing that was missing rather than the thing that was already true: that
 * what reaches the DOM is *geometry*, and that no icon renders its own name.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MaterialIcon } from '../../src/components/ui/MaterialIcon.tsx';
import { ICON_PATHS, ICON_VIEW_BOX } from '../../src/components/ui/icon-paths.ts';

describe('an icon renders as geometry, not as its name', () => {
  it('draws paths', () => {
    const { container } = render(<MaterialIcon name="arrow_forward" />);
    const svg = container.querySelector('svg');

    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('viewBox')).toBe(ICON_VIEW_BOX);

    const paths = container.querySelectorAll('path');
    expect(paths.length).toBeGreaterThan(0);
    // Real path data, not an empty element that would render as nothing at all.
    expect(paths[0]?.getAttribute('d')?.length ?? 0).toBeGreaterThan(20);
  });

  it('never puts the icon name in the text of the page', () => {
    const { container } = render(<MaterialIcon name="settings" />);

    /*
     * The regression in one assertion. `textContent` was the icon's name, and that is exactly what
     * the user saw.
     */
    expect(container.textContent).toBe('');
    expect(screen.queryByText('settings')).toBeNull();
  });

  it('takes its colour from the surrounding text', () => {
    // `currentColor` is why a single icon set works on every surface and in both themes.
    const { container } = render(<MaterialIcon name="check" />);
    expect(container.querySelector('svg')?.getAttribute('fill')).toBe('currentColor');
  });

  it('is sized in both dimensions so a row of icons lines up', () => {
    const { container } = render(<MaterialIcon name="check" size={14} />);
    const svg = container.querySelector('svg');

    expect(svg?.getAttribute('width')).toBe('14');
    expect(svg?.getAttribute('height')).toBe('14');
    // Without this an icon is squashed by a long label beside it in a flex row.
    expect(svg?.getAttribute('class')).toContain('shrink-0');
  });
});

describe('an icon is decorative unless it is given a name', () => {
  it('is hidden from assistive technology by default', () => {
    const { container } = render(<MaterialIcon name="warning" />);

    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    // Focusable SVGs put an empty stop in the tab order in some engines.
    expect(container.querySelector('svg')?.getAttribute('focusable')).toBe('false');
  });

  it('exposes a label when the icon carries the meaning on its own', () => {
    render(<MaterialIcon name="lock" label="Restricted" />);

    // The icon stays hidden; the label is what assistive technology reads.
    expect(screen.getByText('Restricted')).toBeInTheDocument();
  });
});

describe('the generated icon set', () => {
  it('has geometry for every icon it claims to have', () => {
    // Not `paths.length === 0`: the generated tuples are `as const`, so the type checker already
    // knows that cannot happen and rejects the comparison. The path data itself is what it cannot
    // see.
    const empty = Object.entries(ICON_PATHS).filter(([, paths]) =>
      paths.some((d) => d.trim() === ''),
    );

    expect(empty).toEqual([]);
  });

  it('contains no icon whose paths are a placeholder', () => {
    /*
     * A guard against a plausible bad fix: emitting a stub for an icon that could not be resolved,
     * which compiles, renders and draws nothing — the same silent failure in a new costume.
     */
    const suspicious = Object.entries(ICON_PATHS).filter(([, paths]) =>
      paths.every((d) => d.length < 20),
    );

    expect(suspicious).toEqual([]);
  });
});
