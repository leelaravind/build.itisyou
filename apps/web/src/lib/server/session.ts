import 'server-only';

import { cookies } from 'next/headers';
import { createGuestSession, findActiveGuestSession } from '@govintel/db/guest';
import { withUnscoped } from './database.ts';
import { GUEST_COOKIE, guestCookieOptions } from './guest-cookie.ts';

export { GUEST_COOKIE };

/**
 * Guest session cookie handling.
 *
 * Contract: gap-spec §5.2 — "random guest session ID, HttpOnly secure cookie, server-side temporary
 * project state, expiry, no user-identifying account required".
 *
 * The cookie holds an opaque id and nothing else. Everything about the session — its expiry, its
 * projects, whether it has been converted — lives server-side, because a cookie is client-controlled
 * and any state kept there is state an attacker can edit.
 */

/** The active guest session id from the cookie, or undefined. Does not create one. */
export async function readGuestSessionId(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(GUEST_COOKIE)?.value;
}

/**
 * The caller's active guest session, verified against the database.
 *
 * The cookie is never trusted on its own: a stale or forged id must resolve to nothing rather than
 * to a session. Expiry is checked at read time, so a session past its lifetime is treated as absent
 * even if the sweeper has not run.
 */
export async function getActiveGuestSession() {
  const sessionId = await readGuestSessionId();
  if (sessionId === undefined) return undefined;

  /*
   * Unscoped on purpose. This is what *resolves* the caller's tenant, so it cannot run inside one —
   * and it does not need to: `guest_sessions` carries no RLS policy, because a session is not
   * tenant-owned data. It is the thing that says which tenant you are.
   */
  return withUnscoped((db) => findActiveGuestSession(db, sessionId));
}

/**
 * Return the caller's session, creating one if they have none.
 *
 * Called when a visitor begins the intake flow — the moment guest-first (plan §2.3) actually needs
 * server-side state. Deliberately not called on the landing page: issuing a session cookie to
 * everyone who merely visits would be tracking, and gap-spec §19 requires data minimisation.
 */
export async function ensureGuestSession(ttlHours: number) {
  const existing = await getActiveGuestSession();
  if (existing !== undefined) return existing;

  // Also unscoped, and for the same reason: this creates the organisation the scope will point at.
  const session = await withUnscoped((db) => createGuestSession(db, { ttlHours }));

  const store = await cookies();
  store.set(GUEST_COOKIE, session.id, guestCookieOptions(ttlHours * 60 * 60));

  return session;
}

/** Clear the guest cookie — after conversion to an account, or on explicit abandonment. */
export async function clearGuestSession(): Promise<void> {
  const store = await cookies();
  store.set(GUEST_COOKIE, '', { ...guestCookieOptions(0), maxAge: 0 });
}
