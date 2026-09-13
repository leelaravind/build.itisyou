import { test, expect, type Page } from '@playwright/test';

/**
 * A whole journey with the keyboard alone (plan §32.10 journey 39, plan §25 "full keyboard intake").
 *
 * Every control in the product is reachable by Tab — the accessibility suite checks that page by
 * page. What only a journey can show is that a person who cannot use a pointer can get *through* the
 * product: start a project, answer the intake, build the plan and reach Project Home, without a single
 * click. A focus trap, a control that only responds to a mouse event, or a step whose submit button
 * is unreachable would each stop this test where they would stop the person.
 */

const WEBKIT_TAB_NOTE =
  'WebKit omits links from the Tab order unless the OS setting "Full Keyboard Access" is on (KI-018)';

/** Tab forward until the focused element is a `tag` whose text matches, or fail saying where focus went. */
async function tabTo(page: Page, tag: string, text?: RegExp, limit = 60): Promise<void> {
  for (let i = 0; i < limit; i += 1) {
    await page.keyboard.press('Tab');
    const hit = await page.evaluate(
      ({ tag, source, flags }) => {
        const el = document.activeElement;
        if (el?.tagName !== tag) return false;
        return source === null || new RegExp(source, flags).test(el.textContent ?? '');
      },
      { tag, source: text?.source ?? null, flags: text?.flags ?? '' },
    );
    if (hit) return;
  }
  const where = await page.evaluate(
    () => document.activeElement?.outerHTML.slice(0, 120) ?? 'none',
  );
  throw new Error(`never reached a ${tag} ${String(text)} by Tab; focus ended on ${where}`);
}

test.describe('the keyboard-only journey', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName === 'webkit', WEBKIT_TAB_NOTE);
  });

  test('starts a project, answers the intake and builds the plan without a pointer', async ({
    page,
  }) => {
    test.slow();
    await page.goto('/start');

    // The idea field, then type, then Tab to the submit button and press Enter.
    await tabTo(page, 'TEXTAREA');
    await page.keyboard.type('A volunteer shift planner for a community kitchen.');
    await tabTo(page, 'BUTTON', /continue/i);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/intake\/[0-9a-f-]{36}/);
    const projectId = /\/intake\/([^/?]+)/.exec(page.url())?.[1] ?? '';

    // Answer three questions with "I don't know", reached by Tab and pressed with Enter.
    for (let step = 0; step < 3; step += 1) {
      const heading = page.getByRole('heading', { level: 2 }).first();
      const asked = await heading.innerText();
      await tabTo(page, 'BUTTON', /i don.t know/i);
      await page.keyboard.press('Enter');
      await expect(heading).not.toHaveText(asked, { timeout: 15_000 });
    }

    // Build the plan by keyboard.
    await page.goto(`/plan/${projectId}`);
    await tabTo(page, 'BUTTON', /build the plan/i);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: /what the engine produced/i })).toBeVisible({
      timeout: 15_000,
    });

    // And reach Project Home through its link, by keyboard.
    await page.goto(`/p/${projectId}`);
    await tabTo(page, 'A', /work and today/i);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/plan/${projectId}/work`));
  });
});
