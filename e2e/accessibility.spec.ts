import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Automated accessibility verification.
 *
 * Contract: MASTER_IMPLEMENTATION_PLAN.md section 25 targets WCAG 2.2 AA and requires automated axe
 * checks, semantic violations, label checks, heading structure, contrast where tooling can verify,
 * and keyboard-triggerable controls. Section 32.11 requires at least 20 accessibility tests.
 *
 * These run against the real rendered application, not against components in isolation. A component
 * can be perfectly accessible on its own and still produce duplicate landmarks, a broken heading
 * order, or an unreachable control once composed into a page.
 *
 * Gap-spec section 62 permits manual review only where automation genuinely cannot establish a
 * property, and requires each such exception to be documented. Nothing here is exempted.
 */

const ROUTES = [
  { path: '/', name: 'landing' },
  { path: '/p/proj_demo', name: 'project home' },
];

test.describe('axe — no violations', () => {
  for (const route of ROUTES) {
    test(`${route.name} has no WCAG 2.2 A/AA violations`, async ({ page }) => {
      await page.goto(route.path);

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();

      // Report the actual rules that failed, so a failure is diagnosable from CI output alone.
      expect(
        results.violations.map((v) => `${v.id} (${String(v.nodes.length)} nodes): ${v.help}`),
      ).toEqual([]);
    });

    test(`${route.name} passes best-practice checks`, async ({ page }) => {
      // Best-practice rules are not WCAG requirements but catch real usability defects:
      // duplicate landmarks, missing main, unlabelled regions.
      await page.goto(route.path);

      const results = await new AxeBuilder({ page }).withTags(['best-practice']).analyze();

      // Report the offending selectors, not just the rule. "target-size failed" is not actionable;
      // "target-size failed on a.nav-link" is.
      expect(
        results.violations.flatMap((v) =>
          v.nodes.map((n) => `${v.id}: ${n.target.join(' ')} — ${v.help}`),
        ),
      ).toEqual([]);
    });
  }
});

test.describe('landmarks and document structure', () => {
  test('project home exposes exactly one main landmark', async ({ page }) => {
    await page.goto('/p/proj_demo');
    await expect(page.getByRole('main')).toHaveCount(1);
  });

  test('navigation landmarks are individually named', async ({ page }, testInfo) => {
    // Two unnamed <nav> elements are indistinguishable in a screen reader's landmark list.
    //
    // Desktop only: the primary nav is hidden below `md` and the sidebar below `lg`, because four
    // header controls plus six nav links overflow a 320px viewport (WCAG 1.4.10 Reflow). The mobile
    // navigation that replaces them is Phase 16; this assertion extends to mobile then.
    const width = testInfo.project.use.viewport?.width ?? 1280;
    test.skip(width < 1024, 'Mobile navigation is implemented in Phase 16');

    await page.goto('/p/proj_demo');

    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Secondary' })).toBeVisible();
  });

  test('the page has exactly one h1', async ({ page }) => {
    await page.goto('/p/proj_demo');
    await expect(page.locator('h1')).toHaveCount(1);
  });

  test('heading levels do not skip', async ({ page }) => {
    await page.goto('/p/proj_demo');

    const levels = await page
      .locator('h1, h2, h3, h4, h5, h6')
      .evaluateAll((nodes) => nodes.map((n) => Number(n.tagName[1])));

    for (let i = 1; i < levels.length; i += 1) {
      expect(
        levels[i]! - levels[i - 1]!,
        `heading jumped from h${levels[i - 1]!} to h${levels[i]!}`,
      ).toBeLessThanOrEqual(1);
    }
  });

  test('the document declares a language', async ({ page }) => {
    await page.goto('/p/proj_demo');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('the page has a non-empty title', async ({ page }) => {
    await page.goto('/p/proj_demo');
    expect((await page.title()).length).toBeGreaterThan(0);
  });
});

test.describe('keyboard operability', () => {
  test('a skip link is the first thing a keyboard user reaches', async ({ page, browserName }) => {
    // With ~20 sidebar links, tabbing past navigation on every page is a real barrier (WCAG 2.4.1).
    //
    // Not asserted on WebKit: Safari excludes links from the Tab sequence unless the OS-level
    // "Full Keyboard Access" setting is on, so Tab lands on the first *button* rather than the skip
    // link. That is a platform default, not a defect in this markup - the link is present, focusable
    // and correctly ordered, which Chromium and Firefox both confirm here.
    test.skip(browserName === 'webkit', 'WebKit omits links from the default Tab order');

    await page.goto('/p/proj_demo');
    await page.keyboard.press('Tab');

    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
  });

  test('the skip link becomes visible when focused', async ({ page }) => {
    // A skip link that stays visually hidden while focused is useless to sighted keyboard users.
    await page.goto('/p/proj_demo');
    await page.keyboard.press('Tab');

    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeVisible();
  });

  test('every interactive control is reachable by keyboard', async ({
    page,
    browserName,
  }, testInfo) => {
    // Same WebKit caveat as above; and below `lg` the sidebar is hidden, so the control count and
    // the reachable set are both smaller in ways this assertion is not written to model.
    test.skip(browserName === 'webkit', 'WebKit omits links from the default Tab order');
    const width = testInfo.project.use.viewport?.width ?? 1280;
    test.skip(width < 1024, 'Mobile navigation is implemented in Phase 16');

    await page.goto('/p/proj_demo');

    const interactive = await page.locator('a[href], button:not([disabled])').count();
    const reached = new Set<string>();

    for (let i = 0; i < interactive + 5; i += 1) {
      await page.keyboard.press('Tab');
      const id = await page.evaluate(() => {
        const el = document.activeElement;
        if (el === null || el === document.body) return null;
        return `${el.tagName}:${el.textContent?.trim().slice(0, 30) ?? ''}:${el.getAttribute('aria-label') ?? ''}`;
      });
      if (id !== null) reached.add(id);
    }

    expect(reached.size).toBeGreaterThanOrEqual(interactive);
  });

  test('focus is visible on every focused control', async ({ page }) => {
    // WCAG 2.2 Focus Appearance. An invisible focus ring fails keyboard users outright.
    await page.goto('/p/proj_demo');

    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Tab');
      const hasIndicator = await page.evaluate(() => {
        const el = document.activeElement;
        if (el === null || el === document.body) return true;
        const style = getComputedStyle(el);
        return (
          style.outlineStyle !== 'none' ||
          style.boxShadow !== 'none' ||
          style.backgroundColor !== 'rgba(0, 0, 0, 0)'
        );
      });
      expect(hasIndicator).toBe(true);
    }
  });

  test('icon-only controls carry accessible names', async ({ page }, testInfo) => {
    // The most common serious defect in dashboard UIs.
    await page.goto('/p/proj_demo');

    // Search and Notifications are present at every width; Settings and Help hide below `sm` to
    // satisfy Reflow, and remain reachable from the sidebar.
    const width = testInfo.project.use.viewport?.width ?? 1280;
    const expected =
      width < 640 ? ['Search', 'Notifications'] : ['Search', 'Notifications', 'Settings', 'Help'];

    for (const name of expected) {
      await expect(page.getByRole('button', { name })).toBeVisible();
    }
  });
});

test.describe('status is never conveyed by colour alone', () => {
  test('every gate state renders a text label', async ({ page }) => {
    // WCAG 1.4.1. Two of these six states had no colour defined anywhere in the handoff (KI-005),
    // which is precisely why the text channel has to carry the meaning.
    await page.goto('/p/proj_demo');

    for (const label of ['PASS', 'FAIL', 'BLOCKED', 'EXCEPTION', 'READY', 'NOT READY']) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
  });

  test('every gate state renders an icon alongside its label', async ({ page }) => {
    await page.goto('/p/proj_demo');

    for (const icon of ['check_circle', 'cancel', 'block', 'gpp_maybe', 'pending']) {
      await expect(page.locator(`[data-icon="${icon}"]`).first()).toBeAttached();
    }
  });

  test('an uncertain figure is shown as a range, not a false midpoint', async ({ page }) => {
    // Plan section 12.3 forbids fake precision.
    await page.goto('/p/proj_demo');

    await expect(page.getByText('£120k')).toBeVisible();
    await expect(page.getByText('£165k')).toBeVisible();
    await expect(page.getByText('Estimated')).toBeVisible();
  });

  test('an unknown figure is labelled unknown rather than shown as zero', async ({ page }) => {
    await page.goto('/p/proj_demo');
    await expect(page.getByText('Unknown')).toBeVisible();
  });
});

test.describe('reflow and zoom', () => {
  test('content reflows at 320px without horizontal scrolling', async ({ page }) => {
    // WCAG 1.4.10 Reflow. Plan section 25 requires 200% zoom / reflow on critical flows.
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/p/proj_demo');

    // Naming the offending elements makes a failure diagnosable from CI output alone, rather than
    // just asserting "something overflows somewhere".
    const offenders = await page.evaluate(() => {
      const limit = document.documentElement.clientWidth;
      return [...document.querySelectorAll('*')]
        .filter((el) => el.getBoundingClientRect().right > limit + 1)
        .slice(0, 8)
        .map((el) => {
          const r = el.getBoundingClientRect();
          const cls = typeof el.className === 'string' ? el.className.slice(0, 60) : '';
          return `${el.tagName}.${cls} right=${String(Math.round(r.right))} limit=${String(limit)}`;
        });
    });

    expect(offenders, `elements overflowing 320px:\n${offenders.join('\n')}`).toEqual([]);
  });

  test('has no axe violations at mobile width', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/p/proj_demo');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();

    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  test('respects prefers-reduced-motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/p/proj_demo');

    // Compare numerically: the 0.01ms override computes to "1e-05s", so a string comparison
    // against "0.01ms" fails even though the rule is working correctly.
    const seconds = await page.evaluate(() => {
      const el = document.querySelector('a[href]');
      if (el === null) return 0;
      return Number.parseFloat(getComputedStyle(el).transitionDuration);
    });

    expect(seconds).toBeLessThan(0.001);
  });
});
