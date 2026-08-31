import 'server-only';

import { cookies } from 'next/headers';
import { createGuestSession, findActiveGuestSession } from '@govintel/db/guest';
import { withDatabase } from './database.ts';

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

export const GUEST_COOKIE = 'govintel_guest';

/**
 * Cookie attributes.
 *
 * `httpOnly` keeps the id out of reach of any script, which matters because the document editor is a
 * stored-XSS surface (gap-spec §34): if XSS ever lands, it must not be able to read session ids.
 * `sameSite: 'lax'` blocks cross-site POSTs while still allowing a normal top-level navigation back
 * into the app. `secure` is conditional so local HTTP development works; deployed environments are
 * HTTPS-only.
 */
function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

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

  return withDatabase((db) => findActiveGuestSession(db, sessionId));
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

  const session = await withDatabase((db) => createGuestSession(db, { ttlHours }));

  const store = await cookies();
  store.set(GUEST_COOKIE, session.id, cookieOptions(ttlHours * 60 * 60));

  return session;
}

/** Clear the guest cookie — after conversion to an account, or on explicit abandonment. */
export async function clearGuestSession(): Promise<void> {
  const store = await cookies();
  store.set(GUEST_COOKIE, '', { ...cookieOptions(0), maxAge: 0 });
}
