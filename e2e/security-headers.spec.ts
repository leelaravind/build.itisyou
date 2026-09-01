import { test, expect } from '@playwright/test';

/**
 * Security header verification.
 *
 * Contract: MASTER_IMPLEMENTATION_PLAN.md section 18 (CSP, secure headers), gap-spec section 66
 * (mandatory pre-live gate), section 67 (re-verified after production deployment).
 *
 * These run against a real served response, not against the config file. Plan section 38 is explicit:
 * "never claim a security control without verifying it" - and a header declared in `next.config.ts`
 * is a claim until something observes it on the wire.
 *
 * The CSP assertions are also the structural defence against KI-007: every Stitch export loads
 * `cdn.tailwindcss.com` and Google Fonts at runtime. If that pattern ever leaks into the shipped
 * application, these tests fail.
 */

test.describe('security headers', () => {
  test('serves a Content-Security-Policy', async ({ request }) => {
    const response = await request.get('/');
    expect(response.headers()['content-security-policy']).toBeDefined();
  });

  test('CSP restricts scripts to same origin, with no unsafe-inline', async ({ request }) => {
    const csp = (await request.get('/')).headers()['content-security-policy'] ?? '';
    const scriptSrc = /script-src ([^;]*)/.exec(csp)?.[1] ?? '';

    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc).not.toContain('unsafe-inline');
    expect(scriptSrc).not.toContain('unsafe-eval');
  });

  test('CSP blocks the CDN the design exports depend on', async ({ request }) => {
    // KI-007: the exports load cdn.tailwindcss.com at runtime. Tailwind is compiled at build time,
    // so no CDN host may appear in the policy.
    const csp = (await request.get('/')).headers()['content-security-policy'] ?? '';

    expect(csp).not.toContain('cdn.tailwindcss.com');
    expect(csp).not.toContain('fonts.googleapis.com');
    expect(csp).not.toContain('fonts.gstatic.com');
  });

  test('CSP restricts fonts to self, so they must be self-hosted', async ({ request }) => {
    const csp = (await request.get('/')).headers()['content-security-policy'] ?? '';
    expect(csp).toMatch(/font-src [^;]*'self'/);
  });

  test('CSP forbids framing and object embedding', async ({ request }) => {
    const csp = (await request.get('/')).headers()['content-security-policy'] ?? '';

    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });

  test.describe('supporting headers', () => {
    test('sends X-Content-Type-Options: nosniff', async ({ request }) => {
      expect((await request.get('/')).headers()['x-content-type-options']).toBe('nosniff');
    });

    test('sends X-Frame-Options: DENY', async ({ request }) => {
      expect((await request.get('/')).headers()['x-frame-options']).toBe('DENY');
    });

    test('sends a strict Referrer-Policy', async ({ request }) => {
      expect((await request.get('/')).headers()['referrer-policy']).toBe(
        'strict-origin-when-cross-origin',
      );
    });

    test('sends HSTS with a long max-age and subdomains', async ({ request }) => {
      const hsts = (await request.get('/')).headers()['strict-transport-security'] ?? '';
      const maxAge = Number(/max-age=(\d+)/.exec(hsts)?.[1] ?? '0');

      expect(maxAge).toBeGreaterThanOrEqual(31_536_000);
      expect(hsts).toContain('includeSubDomains');
    });

    test('sends a Permissions-Policy denying sensitive capabilities', async ({ request }) => {
      const policy = (await request.get('/')).headers()['permissions-policy'] ?? '';

      expect(policy).toContain('camera=()');
      expect(policy).toContain('microphone=()');
      expect(policy).toContain('geolocation=()');
    });

    test('does not advertise the framework via X-Powered-By', async ({ request }) => {
      // Version disclosure hands an attacker a CVE shortlist for free.
      expect((await request.get('/')).headers()['x-powered-by']).toBeUndefined();
    });
  });
});

test.describe('landing page', () => {
  test('renders for an anonymous visitor with no login', async ({ page }) => {
    // Guest-first is a locked product principle (plan §2.3): the landing must work logged out.
    //
    // Asserts the headline leads with the value proposition rather than the product name. The
    // earlier placeholder page put "GovIntel Platform" in the h1; the real landing follows the
    // Stitch export, which opens with what the product does.
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      /executable engineering system/i,
    );
  });

  test('loads no third-party resources', async ({ page, baseURL }) => {
    // Privacy: plan section 19 requires data minimisation. Nothing should be fetched off-origin.
    //
    // "Off-origin" is measured against the origin under test rather than a hard-coded localhost.
    // The earlier version listed `127.0.0.1` and `localhost` as the permitted hostnames, which was
    // true of every environment it had ever run in and false of the first real deployment: against
    // staging it reported the site's own stylesheet and twenty of its own chunks as third-party
    // resources. A test that only passes on a laptop is not testing the deployment.
    const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
    const external: string[] = [];

    page.on('request', (request) => {
      if (new URL(request.url()).origin !== origin) external.push(request.url());
    });

    await page.goto('/', { waitUntil: 'networkidle' });
    expect(external).toEqual([]);
  });

  test('reports no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    await page.goto('/', { waitUntil: 'networkidle' });
    expect(errors).toEqual([]);
  });
});
