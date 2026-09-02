import { NextResponse, type NextRequest } from 'next/server';

/**
 * Per-request CSP nonce, and correlation ID propagation.
 *
 * Contract: MASTER_IMPLEMENTATION_PLAN.md section 18 (CSP), section 26 (correlation IDs),
 * gap-spec section 34 (stored XSS in documents is a named threat).
 *
 * Why a nonce rather than `'unsafe-inline'`:
 *
 * Next.js injects inline bootstrap scripts, which a strict `script-src 'self'` blocks - caught by
 * `e2e/security-headers.spec.ts`. The cheap fix is to add `'unsafe-inline'` to `script-src`, and it
 * would be the wrong one. This platform hosts user-authored rich-text documents (plan section 17),
 * which gap-spec section 34 names as a stored-XSS surface. `'unsafe-inline'` disables precisely the
 * protection that surface depends on. So each response gets a fresh nonce instead, and only scripts
 * carrying it execute.
 *
 * `'strict-dynamic'` lets a nonced script load its own chunks without every chunk URL needing to be
 * enumerated - which is how Next's runtime actually loads code.
 *
 * Cost, stated plainly: reading headers makes matched routes dynamically rendered. For a platform
 * that is overwhelmingly authenticated and tenant-scoped this is the correct default anyway; the
 * public landing page's caching strategy is revisited in Phase 4.
 */

const CORRELATION_HEADER = 'x-correlation-id';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function buildCsp(nonce: string, isDev: boolean, isSecure: boolean): string {
  return [
    "default-src 'self'",
    // `'strict-dynamic'` is deliberately omitted. It disables host-based allowlisting, which would
    // block Next's own same-origin chunks unless every one carried the nonce. `'self'` plus a nonce
    // is the stronger practical policy here: no `unsafe-inline`, no wildcard host, and inline
    // scripts still require the per-request nonce. Next's dev overlay needs eval; production must not.
    isDev
      ? `script-src 'self' 'nonce-${nonce}' 'unsafe-eval'`
      : `script-src 'self' 'nonce-${nonce}'`,
    // Style nonces are not viable while Next injects styles without one. Styles cannot execute
    // script, so this is a materially smaller exposure than an inline-script allowance.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    /*
     * `upgrade-insecure-requests` is emitted only over HTTPS.
     *
     * WebKit honours it strictly and upgrades `http://127.0.0.1` to `https://`, where no TLS
     * listener exists - which surfaced as "SSL connect error" in the webkit and mobile-safari E2E
     * runs while Chromium and Firefox passed, because they exempt loopback. Omitting it on plain
     * HTTP is also simply correct: there is nothing to upgrade.
     */
    ...(isSecure ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

/** Methods that can change state, and therefore need an origin check. */
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Whether a state-changing request came from this site.
 *
 * Contract: plan §18 ("CSRF protection where relevant"), gap-spec §65.
 *
 * ## Why this exists alongside SameSite and the CSP
 *
 * Three controls, none of which subsumes the others:
 *
 * - `SameSite=Lax` on the session cookie stops the cookie being *sent* cross-site — but it is a
 *   browser default that varies by version, and the guest cookie is deliberately `Lax` rather than
 *   `Strict` so that returning from an identity provider works at all.
 * - `form-action 'self'` in the CSP stops a form on *our* pages submitting elsewhere. It says
 *   nothing about a form on somebody else's page submitting here.
 * - This check is the one that answers "did this request come from us", explicitly, where it can be
 *   tested and where its failure is a 403 rather than a silent success.
 *
 * Next validates Server Action origins itself, and that is the fourth layer — but it applies only to
 * Server Actions, and it is configuration this application does not set. A control that exists
 * because a framework happens to default to it is not a control anybody has decided on.
 *
 * ## Why a missing Origin is refused
 *
 * Every browser sends `Origin` on a cross-origin POST, and modern browsers send it on same-origin
 * POSTs too. Treating absence as "probably fine" is how this check gets bypassed by anything that
 * can suppress the header — which is the population it is defending against.
 */
function isSameOrigin(request: NextRequest): boolean {
  if (!UNSAFE_METHODS.has(request.method)) return true;

  const origin = request.headers.get('origin');
  const host = request.headers.get('host');

  if (origin === null || host === null) return false;

  try {
    // Compared on host alone. The scheme is settled by HSTS and `upgrade-insecure-requests`, and
    // including it would reject every request in local HTTP development for no security gain.
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function middleware(request: NextRequest): NextResponse {
  /*
   * The origin check runs before anything else, including the nonce.
   *
   * A forged cross-site POST must not reach a route handler or a Server Action at all — refusing it
   * after the work is done is not refusing it.
   */
  if (!isSameOrigin(request)) {
    return new NextResponse('Cross-site request refused.', {
      status: 403,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const nonce = crypto.randomUUID().replaceAll('-', '');
  const isDev = process.env.NODE_ENV === 'development';

  /*
   * Loopback is the only host that never gets `upgrade-insecure-requests`: there is no TLS listener
   * there, so the directive can only break things. Every real host gets it, which is what forces
   * plain-HTTP requests up to HTTPS in deployed environments.
   */
  const host = request.headers.get('host') ?? '';
  const isLoopback = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);

  const csp = buildCsp(nonce, isDev, !isLoopback);

  // An inbound correlation ID is attacker-controlled and flows into log files. Anything that is not
  // a well-formed UUIDv4 is replaced outright rather than sanitised, so a value carrying newlines
  // or control characters cannot forge log entries.
  const inbound = request.headers.get(CORRELATION_HEADER);
  const correlationId = inbound !== null && UUID_V4.test(inbound) ? inbound : crypto.randomUUID();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set(CORRELATION_HEADER, correlationId);
  // Next reads the nonce back out of the request's CSP header when rendering its inline scripts.
  requestHeaders.set('content-security-policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('content-security-policy', csp);
  response.headers.set(CORRELATION_HEADER, correlationId);
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and the favicon - those carry no script and need no nonce.
    {
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
