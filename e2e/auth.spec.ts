import { expect, test, type Page } from '@playwright/test';

/**
 * Signing in, through the browser, against a real OIDC exchange.
 *
 * Contract: plan §32.10 names login, signup-to-save, logout/session-expiry, organization users and
 * permission-denied as required Playwright journeys; gap-spec §6.1 (provider-neutral identity), §6.3
 * (session controls), §5.4 (guest-to-account conversion), §67 (post-live verification of
 * signup/login and one authenticated journey).
 *
 * ## What these are for
 *
 * The whole authentication stack — the authorization request, PKCE, state, nonce, ID-token
 * validation against a JWKS, the session store, guest conversion, logout — was written and
 * unit-tested and had never once run end to end. Unit tests prove each piece behaves; only this
 * proves they are joined together, and "joined together" is what was missing everywhere else in this
 * codebase.
 *
 * The provider is `e2e/support/mock-oidc.mjs`, a separate process speaking OIDC. The application is
 * pointed at it by configuration and cannot tell it is not real — no bypass, no test-only branch in
 * the product. It refuses an authorization request without `state` or a PKCE challenge, so the
 * application cannot quietly stop sending them.
 *
 * Skipped against a deployed environment: staging has no provider configured, and pointing one at a
 * mock issuer would be a worse idea than having no test.
 */

const NO_PROVIDER = 'Runs against the local mock issuer; deployed environments have no provider.';

function deployed(baseURL: string | undefined): boolean {
  return !(baseURL ?? '').startsWith('http://localhost');
}

/** Sign in through the provider, as `email`. Returns once the application says it worked. */
async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.getByRole('button', { name: /continue to your identity provider/i }).click();

  // Now on the provider's own origin, which is the point: this is a redirect-based login.
  await expect(page.getByRole('heading', { name: /mock identity provider/i })).toBeVisible();

  await page.getByLabel(/email/i).fill(email);
  await page.getByRole('button', { name: /^sign in$/i }).click();

  await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible();
}

test.describe('signing in', () => {
  test.beforeEach(({ baseURL }) => {
    test.skip(deployed(baseURL), NO_PROVIDER);
  });

  test('completes the round trip and leaves the user signed in', async ({ page, baseURL }) => {
    await signIn(page, 'first@example.test');

    // Back on our own origin, not the provider's.
    expect(page.url().startsWith(baseURL ?? '')).toBe(true);
    await expect(page.getByRole('link', { name: /^sign in$/i })).toHaveCount(0);
  });

  test('sends state and a PKCE challenge to the provider', async ({ page }) => {
    /*
     * Asserted on the wire rather than from the code. The mock refuses a request missing either, so
     * a regression would already fail the journey above — this names *which* parameter went missing,
     * which is the difference between a five-minute fix and an afternoon.
     */
    await page.goto('/login');

    const [request] = await Promise.all([
      page.waitForRequest((r) => r.url().includes('/authorize')),
      page.getByRole('button', { name: /continue to your identity provider/i }).click(),
    ]);

    const query = new URL(request.url()).searchParams;

    expect(query.get('response_type')).toBe('code');
    expect(query.get('code_challenge_method')).toBe('S256');
    expect(query.get('code_challenge') ?? '').not.toBe('');
    expect(query.get('state') ?? '').not.toBe('');
    expect(query.get('nonce') ?? '').not.toBe('');

    // The challenge is a hash, so the verifier must not also be on the wire.
    expect(request.url()).not.toContain('code_verifier');
  });

  test('refuses a callback carrying a state we never issued', async ({ page, baseURL }) => {
    /*
     * The CSRF defence on the callback, exercised as the attack rather than as a unit. Without it,
     * an attacker completes their own authorization and hands the victim the resulting URL, logging
     * the victim into the attacker's account.
     */
    const response = await page.goto(
      `${baseURL ?? ''}/auth/callback?code=made-up&state=never-issued`,
    );

    expect(page.url()).toContain('/login');
    expect(response?.status()).toBeLessThan(500);
    await expect(page.getByRole('button', { name: /sign out/i })).toHaveCount(0);
  });
});

test.describe('signing up to save work started as a guest', () => {
  test.beforeEach(({ baseURL }) => {
    test.skip(deployed(baseURL), NO_PROVIDER);
  });

  test('carries the guest’s project onto the new account', async ({ page }) => {
    /*
     * Gap-spec §5.4 and §88. This is the product's whole shape: guest-first, sign in later, keep
     * what you did. If the project does not come across, the guest journey has been a demo.
     */
    await page.goto('/start');
    await page.getByLabel(/describe your project/i).fill('A project begun before signing in.');
    await page.getByRole('button', { name: /continue/i }).click();
    await expect(page).toHaveURL(/\/intake\/[0-9a-f-]{36}/);

    const projectId = /\/intake\/([^/?]+)/.exec(page.url())?.[1] ?? '';
    expect(projectId).not.toBe('');

    await signIn(page, 'converts@example.test');

    // The project keeps the same link — §5.4 is explicit that it is the same project, not a copy.
    await page.goto(`/plan/${projectId}`);
    await expect(page.getByRole('region', { name: /where this project is/i })).toBeVisible();
  });
});

test.describe('signing out', () => {
  test.beforeEach(({ baseURL }) => {
    test.skip(deployed(baseURL), NO_PROVIDER);
  });

  test('ends the session rather than only clearing the cookie', async ({ page, context }) => {
    /*
     * §6.3 requires server-side revocation. Clearing the cookie alone leaves a valid session id in
     * whatever captured it — so a copy taken beforehand keeps working, which is exactly what
     * somebody signing out on a shared machine is trying to prevent.
     *
     * The test takes that copy first, signs out, then puts it back.
     */
    await signIn(page, 'leaves@example.test');

    const before = (await context.cookies()).find((c) => c.name === 'govintel_session');
    expect(before).toBeDefined();

    await page.getByRole('button', { name: /sign out/i }).click();
    await expect(page.getByRole('link', { name: /^sign in$/i })).toBeVisible();

    if (before !== undefined) await context.addCookies([before]);

    await page.goto('/portfolio');

    // The captured cookie is worthless: the session behind it was revoked, not merely forgotten.
    await expect(page.getByRole('button', { name: /sign out/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /^sign in$/i })).toBeVisible();
  });
});

test.describe('an account is its own tenant', () => {
  test.beforeEach(({ baseURL }) => {
    test.skip(deployed(baseURL), NO_PROVIDER);
  });

  test('a first sign-in creates an organisation to act in', async ({ page }) => {
    /*
     * Every table in the product is scoped by organisation, so a signed-in user with no organisation
     * reaches nothing — the application correctly shows an empty screen and the person cannot tell
     * why. Asserted through behaviour rather than through the database: they can create and open a
     * project, which is only possible if a tenant exists to own it.
     */
    await signIn(page, 'owner@example.test');

    await page.goto('/start');
    await page.getByLabel(/describe your project/i).fill('A project owned by an account.');
    await page.getByRole('button', { name: /continue/i }).click();

    await expect(page).toHaveURL(/\/intake\/[0-9a-f-]{36}/);
  });

  test('one account cannot open another account’s project', async ({ page, browser }) => {
    /*
     * Plan §32.10's permission-denied journey, and the authenticated half of the isolation the guest
     * tests already cover. 404 rather than 403 throughout: a 403 confirms the project exists.
     */
    await signIn(page, 'ownerA@example.test');

    await page.goto('/start');
    await page.getByLabel(/describe your project/i).fill('Commercially sensitive, account A.');
    await page.getByRole('button', { name: /continue/i }).click();
    await expect(page).toHaveURL(/\/intake\/[0-9a-f-]{36}/);

    const projectId = /\/intake\/([^/?]+)/.exec(page.url())?.[1] ?? '';

    const other = await browser.newContext();
    const otherPage = await other.newPage();

    await signIn(otherPage, 'ownerB@example.test');

    const response = await otherPage.goto(`/plan/${projectId}`);

    expect(response?.status()).toBe(404);
    expect(await otherPage.content()).not.toContain('Commercially sensitive');

    await other.close();
  });
});
