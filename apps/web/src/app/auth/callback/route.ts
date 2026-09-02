import { NextResponse, type NextRequest } from 'next/server';
import { logger } from '@govintel/shared/logging';
import { completeCallback, discover, oidcConfig } from '../../../lib/server/oidc.ts';
import { OIDC_STATE_COOKIE, completeSignIn } from '../../../lib/server/auth.ts';
import { unsign } from '../../../lib/server/signed-cookie.ts';
import { readActiveGuestSessionId } from '../../../lib/server/session.ts';
import { checkRateLimit } from '../../../lib/server/rate-limit.ts';

/**
 * The OIDC redirect target.
 *
 * Contract: gap-spec §6.1, §6.2, §36 (rate-limit auth endpoints), plan §20 (audit authentication).
 *
 * A route handler rather than a page because it produces a redirect and a cookie and never any
 * markup — and because a page would be rendered by the router with a body, which is not what a
 * callback is.
 *
 * Every failure lands on `/login` with a reason code rather than an error page. The reason is
 * deliberately coarse: an attacker probing the callback learns that it failed and not which check
 * caught them.
 */

export async function GET(request: NextRequest): Promise<NextResponse> {
  const config = oidcConfig();

  if (config === undefined) return redirectToLogin(request, 'unavailable');

  /*
   * Rate limited, because this endpoint does real work on unauthenticated input: a token exchange
   * against the provider and a JWKS fetch. §36 names auth endpoints explicitly.
   */
  if (!(await checkRateLimit('auth-callback'))) {
    return redirectToLogin(request, 'rate-limited');
  }

  const params = request.nextUrl.searchParams;

  /*
   * A provider-reported error arrives as a normal redirect with `error` set, not as a failed
   * request. Handled first: the remaining parameters are absent in that case, and treating it as a
   * missing code would report the wrong thing.
   */
  if (params.get('error') !== null) {
    logger.warn('oidc provider returned an error', { error: params.get('error') });
    return redirectToLogin(request, 'provider');
  }

  const store = request.cookies;
  const transaction = unsign(store.get(OIDC_STATE_COOKIE)?.value);
  const parsed = parseTransaction(transaction);

  let result;

  try {
    const endpoints = await discover(config);

    result = await completeCallback(config, endpoints, {
      code: params.get('code') ?? undefined,
      state: params.get('state') ?? undefined,
      expectedState: parsed?.state,
      expectedNonce: parsed?.nonce,
      codeVerifier: parsed?.codeVerifier,
    });
  } catch (error) {
    logger.error('oidc callback failed before validation', { err: String(error) });
    return redirectToLogin(request, 'failed');
  }

  if (!result.ok) {
    logger.warn('oidc callback refused', { refusal: result.refusal });
    return redirectToLogin(request, 'failed');
  }

  const guestSessionId = await readActiveGuestSessionId();
  const signIn = await completeSignIn(result.identity, guestSessionId);

  if (!signIn.ok) {
    return redirectToLogin(request, signIn.refusal === 'LOCKED' ? 'locked' : 'failed');
  }

  const response = NextResponse.redirect(new URL(signIn.redirectTo, request.nextUrl.origin));

  /*
   * The transaction cookie is spent. Clearing it makes the authorization code single-use from this
   * side too: a replayed callback finds no state and is refused, rather than being re-exchanged.
   */
  response.cookies.set(OIDC_STATE_COOKIE, '', { path: '/', maxAge: 0 });

  return response;
}

interface Transaction {
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
}

/**
 * The three secrets, as stored in one signed cookie.
 *
 * Signed rather than merely opaque: without a signature an attacker could set the cookie themselves
 * and supply a matching `state`, which would satisfy the CSRF check with a value they chose. The
 * signature is what makes "we issued this" a fact rather than an assumption.
 */
function parseTransaction(value: string | undefined): Transaction | undefined {
  if (value === undefined) return undefined;

  const [state, nonce, codeVerifier] = value.split(':');

  if (
    state === undefined ||
    nonce === undefined ||
    codeVerifier === undefined ||
    state === '' ||
    nonce === '' ||
    codeVerifier === ''
  ) {
    return undefined;
  }

  return { state, nonce, codeVerifier };
}

function redirectToLogin(request: NextRequest, reason: string): NextResponse {
  const url = new URL('/login', request.nextUrl.origin);
  url.searchParams.set('error', reason);

  const response = NextResponse.redirect(url);
  response.cookies.set(OIDC_STATE_COOKIE, '', { path: '/', maxAge: 0 });

  return response;
}
