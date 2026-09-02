'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { logger } from '@govintel/shared/logging';
import { authorizationRequest, discover, oidcConfig } from '../../lib/server/oidc.ts';
import { OIDC_STATE_COOKIE, oidcStateCookieOptions, signOut } from '../../lib/server/auth.ts';
import { sign } from '../../lib/server/signed-cookie.ts';
import { checkRateLimit } from '../../lib/server/rate-limit.ts';

/**
 * Starting and ending a session.
 *
 * Contract: gap-spec §6.2 (at least one production login method), §36 (rate-limit auth endpoints).
 */

/**
 * Begin sign-in: mint the three secrets, remember them, and redirect to the provider.
 *
 * A server action rather than a link, because the redirect target has to be built server-side — the
 * `state`, `nonce` and PKCE verifier are generated here and the verifier must never reach the
 * browser as anything but a signed cookie it cannot read the meaning of.
 */
export async function beginSignIn(): Promise<void> {
  const config = oidcConfig();

  if (config === undefined) redirect('/login?error=unavailable');

  if (!(await checkRateLimit('auth-begin'))) redirect('/login?error=rate-limited');

  let request;

  try {
    const endpoints = await discover(config);
    request = authorizationRequest(config, endpoints);
  } catch (error) {
    logger.error('could not begin sign-in', { err: String(error) });
    redirect('/login?error=unavailable');
  }

  const store = await cookies();

  /*
   * All three in one signed cookie.
   *
   * Signed because the CSRF check compares the returned `state` against this value: if an attacker
   * could set it, they could satisfy the check with a value they chose, and the comparison would
   * pass while proving nothing. The signature is what makes "we issued this" a fact.
   *
   * Colon-separated because all three are base64url, which contains no colon — so the split cannot
   * be ambiguous and needs no escaping.
   */
  store.set(
    OIDC_STATE_COOKIE,
    sign(`${request.state}:${request.nonce}:${request.codeVerifier}`),
    oidcStateCookieOptions(),
  );

  redirect(request.url);
}

/** End the session, server-side and in the browser. */
export async function endSession(): Promise<void> {
  await signOut();
  redirect('/?signed-out=1');
}
