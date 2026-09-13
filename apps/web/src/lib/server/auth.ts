import 'server-only';

import { cache } from 'react';
import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { users } from '@govintel/db/schema';
import { establishAccount } from '@govintel/db/sign-in';
import { createSession, revokeSession, touchSession } from '@govintel/db/session';
import { logger } from '@govintel/shared/logging';
import { withTenant, withUnscoped, type DatabaseHandle } from './database.ts';
import { sign, unsign } from './signed-cookie.ts';
import { SESSION_COOKIE, guestCookieOptions } from './guest-cookie.ts';
import { recordAudit } from './audit.ts';
import type { CallbackRefusal, VerifiedIdentity } from './oidc.ts';

/**
 * Signing in, staying signed in, and signing out.
 *
 * Contract: gap-spec §6.1 (provider-neutral identity), §6.3 (session controls), §5.4 (guest to
 * account conversion), plan §20 (authentication is an audited event).
 *
 * This is the layer that joins four things that already existed separately and had never met:
 * `oidc.ts` verifies a token, `identity.ts` turns verified claims into a user, `session.ts` holds the
 * session, and `guest.ts` moves a guest's work onto their new account.
 */

export { SESSION_COOKIE } from './guest-cookie.ts';

/** Where the three OIDC secrets live between the redirect out and the callback back. */
export const OIDC_STATE_COOKIE = 'govintel_oidc';

/**
 * The transaction cookie for one sign-in attempt.
 *
 * Ten minutes: long enough for somebody to complete a provider's login including an MFA prompt,
 * short enough that an abandoned attempt does not leave a usable state value lying in a browser for
 * a day. `sameSite: 'lax'` because the provider redirects back with a top-level GET, which `strict`
 * would strip the cookie from — turning every real login into a state mismatch.
 */
export function oidcStateCookieOptions() {
  return { ...guestCookieOptions(600), sameSite: 'lax' as const };
}

/** The signed-in session cookie. Lives as long as the session's absolute window. */
export function sessionCookieOptions(seconds: number) {
  return guestCookieOptions(seconds);
}

export interface SignedInUser {
  readonly userId: string;
  readonly organizationId: string;
  readonly sessionId: string;
  readonly email: string | null;
  readonly displayName: string | null;
}

/**
 * The caller's signed-in user, or `undefined`.
 *
 * Memoised per request, like the guest session, because it is a database round trip that several
 * layers ask for independently.
 *
 * Every read re-decides validity: expired, revoked, or a locked account all resolve to nothing. That
 * is what makes revocation take effect immediately rather than at the next sign-in — the difference
 * between a session you can end and one you can only stop renewing.
 */
export const currentUser = cache(async (): Promise<SignedInUser | undefined> => {
  const store = await cookies();
  const sessionId = unsign(store.get(SESSION_COOKIE)?.value);

  if (sessionId === undefined) return undefined;

  return withUnscoped(async (db) => {
    const session = await touchSession(db, sessionId);
    if (session === undefined) return undefined;

    const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);

    if (user === undefined) return undefined;

    /*
     * A locked account ends its sessions rather than waiting for them to expire.
     *
     * `resolveIdentity` refuses a locked account at sign-in, which stops new sessions; without this
     * an account locked during a session stays usable for up to twelve hours, which is most of the
     * window in which locking it mattered.
     */
    if (user.lockedAt !== null) return undefined;

    return {
      userId: user.id,
      organizationId: session.organizationId,
      sessionId: session.id,
      email: user.email,
      displayName: user.displayName,
    };
  });
});

export type SignInResult =
  | { readonly ok: true; readonly redirectTo: string }
  | { readonly ok: false; readonly refusal: CallbackRefusal | 'LOCKED' | 'FAILED' };

/**
 * Turn a verified identity into a signed-in session, carrying the guest's work across.
 *
 * The account half — identity, organisation, the guest's work — is `establishAccount`, which does
 * each step inside the tenant scope row-level security requires. It used to be done here through the
 * unscoped handle, which works as the superuser the local journeys run as and fails as the role
 * production connects as: the first real sign-in would have thrown on its membership insert. See
 * `packages/db/src/sign-in.ts`.
 *
 * The session is created last, so a failure anywhere leaves the caller a guest rather than signed in
 * to an account whose work did not arrive.
 */
export async function completeSignIn(
  identity: VerifiedIdentity,
  guestSessionId: string | undefined,
): Promise<SignInResult> {
  try {
    const account = await withUnscoped((db) => establishAccount(db, identity, guestSessionId));

    // `sessions` is not tenant data: it is the record that says which tenant a caller is.
    const session = await withUnscoped((db) =>
      createSession(db, { userId: account.userId, organizationId: account.organizationId }),
    );

    // The audit trail is tenant data, so it is written inside the tenant it belongs to.
    await withTenant(account.organizationId, (tx) =>
      recordAudit(tx as unknown as DatabaseHandle, {
        organizationId: account.organizationId,
        action: account.created ? 'USER_REGISTERED' : 'USER_SIGNED_IN',
        entityType: 'USER',
        entityId: account.userId,
        actorUserId: account.userId,
        summary: {
          issuer: identity.issuer,
          // The subject is the identity key, not a secret, and without it an audit entry cannot be
          // matched to a provider's own logs during an incident.
          subject: identity.subject,
          projectsClaimed: account.projectsClaimed,
          guest: account.guest,
          firstSignIn: account.created,
        },
      }),
    );

    const store = await cookies();
    const seconds = Math.floor((session.absoluteExpiresAt.getTime() - Date.now()) / 1000);

    store.set(SESSION_COOKIE, sign(session.id), sessionCookieOptions(seconds));

    logger.info('signed in', { projectsClaimed: account.projectsClaimed, guest: account.guest });

    /*
     * A returning user's guest work is not merged into their account yet (see sign-in.ts). Say so on
     * the page they land on, rather than letting it drop out of view without a word.
     */
    return {
      ok: true,
      redirectTo: account.guest === 'KEPT_SEPARATE' ? '/portfolio?guest=kept' : '/portfolio',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';

    // `resolveIdentity` throws for a locked account. That is a policy outcome, not a fault, and the
    // user is told their account is unavailable rather than shown a generic failure.
    if (message.includes('locked')) return { ok: false, refusal: 'LOCKED' };

    logger.error('sign-in failed', { err: String(error) });
    return { ok: false, refusal: 'FAILED' };
  }
}

/**
 * Sign out.
 *
 * Revokes server-side *and* clears the cookie, in that order. Clearing alone would leave a valid
 * session id in whatever captured the cookie — so a copy taken beforehand would keep working, which
 * is precisely what somebody clicking "sign out" on a shared machine is trying to prevent.
 */
export async function signOut(): Promise<void> {
  const store = await cookies();
  const sessionId = unsign(store.get(SESSION_COOKIE)?.value);

  if (sessionId !== undefined) {
    await withUnscoped(async (db) => {
      const session = await touchSession(db, sessionId);
      await revokeSession(db, sessionId, 'LOGOUT');

      if (session !== undefined) {
        await recordAudit(db, {
          organizationId: session.organizationId,
          action: 'USER_SIGNED_OUT',
          entityType: 'SESSION',
          entityId: sessionId,
          actorUserId: session.userId,
        });
      }
    });
  }

  store.set(SESSION_COOKIE, '', { ...sessionCookieOptions(0), maxAge: 0 });
}
