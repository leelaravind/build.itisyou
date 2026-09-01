import 'server-only';

import { cache } from 'react';
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

/**
 * The raw cookie value, unverified. **Not an authorisation decision.**
 *
 * This is the id the browser sent, and nothing more: it is not checked against the database, so it
 * may name a session that has expired, been converted, or never existed. Comparing it to a row's
 * `guest_session_id` decides ownership from a value the client controls the lifetime of.
 *
 * That is what it was used for, at nine call sites, and the effect was that an **expired guest
 * session still granted full access to its projects** — the cookie outlived the session it named,
 * and gap-spec §5.3's "guest projects expire automatically" only ever applied to the sweeper, which
 * itself has no caller (see the register).
 *
 * Use `readActiveGuestSessionId` for anything that gates access. This remains only for the one
 * legitimate question — "did the caller send a cookie at all?" — which `ensureGuestSession` asks
 * before deciding whether to mint one.
 */
export async function readGuestSessionId(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(GUEST_COOKIE)?.value;
}

/**
 * The caller's session id, **verified against the database**, or undefined.
 *
 * Expiry is checked at read time, so a session past its lifetime resolves to nothing even though the
 * cookie is still in the browser and the sweeper has not run. This is the value ownership checks
 * must compare against.
 */
export async function readActiveGuestSessionId(): Promise<string | undefined> {
  return (await getActiveGuestSession())?.id;
}

/**
 * The caller's active guest session, verified against the database.
 *
 * Memoised per request with React's `cache`, because verifying is a database round trip and the
 * ownership checks that need it run on nearly every route — nine call sites, plus the scope
 * resolution in `database.ts`. Without this, correctness here would cost a query per check and the
 * pressure would be to skip the check.
 *
 * The cookie is never trusted on its own: a stale or forged id must resolve to nothing rather than
 * to a session. Expiry is checked at read time, so a session past its lifetime is treated as absent
 * even if the sweeper has not run.
 */
export const getActiveGuestSession = cache(async () => {
  const sessionId = await readGuestSessionId();
  if (sessionId === undefined) return undefined;

  /*
   * Unscoped on purpose. This is what *resolves* the caller's tenant, so it cannot run inside one —
   * and it does not need to: `guest_sessions` carries no RLS policy, because a session is not
   * tenant-owned data. It is the thing that says which tenant you are.
   */
  return withUnscoped((db) => findActiveGuestSession(db, sessionId));
});

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
