import { expect, test } from '@playwright/test';

/**
 * Cross-site request forgery.
 *
 * Contract: plan §18 ("CSRF protection where relevant"), plan §32.12, gap-spec §65.
 *
 * There was no explicit control and no test — only `SameSite=Lax` on the cookie and `form-action`
 * in the CSP, neither of which answers "did this request come from us". The platform's own MANDATORY
 * rule catalogue demands the evidence, and there was none to give.
 *
 * These run at the request level rather than through a page, because the attack is a request the
 * browser makes on somebody else's behalf — there is no page of ours involved in it.
 */

test.describe('state-changing requests from another origin', () => {
  test('are refused', async ({ request, baseURL }) => {
    /*
     * The attack in one request: a POST to a server action, from a page on another site. Without
     * this check the action runs with the victim's cookies attached.
     */
    const response = await request.post(`${baseURL ?? ''}/start`, {
      headers: {
        origin: 'https://attacker.example',
        'content-type': 'application/x-www-form-urlencoded',
      },
      data: 'idea=posted+from+somewhere+else',
      maxRedirects: 0,
    });

    expect(response.status()).toBe(403);
  });

  test('are refused even when the origin only looks similar', async ({ request, baseURL }) => {
    // A prefix match would accept this. The comparison is on the whole host, not a substring.
    const host = new URL(baseURL ?? 'http://localhost:3000').host;

    const response = await request.post(`${baseURL ?? ''}/start`, {
      headers: {
        origin: `https://${host}.attacker.example`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      data: 'idea=lookalike',
      maxRedirects: 0,
    });

    expect(response.status()).toBe(403);
  });

  test('are refused when the origin header is absent', async ({ request, baseURL }) => {
    /*
     * Absence is refused rather than trusted. Every browser sends `Origin` on a cross-origin POST,
     * so treating a missing one as "probably a same-site request" hands the bypass to anything that
     * can suppress the header — which is exactly the population this defends against.
     */
    const response = await request.post(`${baseURL ?? ''}/start`, {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      data: 'idea=no+origin+header',
      maxRedirects: 0,
    });

    expect(response.status()).toBe(403);
  });

  test('are refused when the origin is not a URL at all', async ({ request, baseURL }) => {
    const response = await request.post(`${baseURL ?? ''}/start`, {
      headers: { origin: 'null', 'content-type': 'application/x-www-form-urlencoded' },
      data: 'idea=opaque+origin',
      maxRedirects: 0,
    });

    expect(response.status()).toBe(403);
  });
});

test.describe('the check does not break the product', () => {
  test('a same-origin POST is allowed through', async ({ request, baseURL }) => {
    /*
     * The other half of the assertion, and the one that matters for whether this shipped safely: a
     * CSRF control that refuses legitimate requests is an outage, and it is the failure mode of
     * every over-tight origin check.
     */
    const origin = new URL(baseURL ?? 'http://localhost:3000').origin;

    const response = await request.post(`${baseURL ?? ''}/start`, {
      headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
      data: 'idea=a+genuine+same+origin+submission',
      maxRedirects: 0,
    });

    expect(response.status()).not.toBe(403);
  });

  test('GET requests are not affected', async ({ request, baseURL }) => {
    // A read cannot change state, and refusing cross-origin reads would break every link into the
    // product from anywhere.
    const response = await request.get(`${baseURL ?? ''}/`, {
      headers: { origin: 'https://somewhere.example' },
    });

    expect(response.status()).toBe(200);
  });
});
