import 'server-only';

/**
 * The session cookie names, on their own.
 *
 * Extracted from `session.ts` so that `database.ts` can resolve the caller's tenant without
 * importing it. The alternative was a cycle — `database.ts` needing the cookie name, `session.ts`
 * needing a database handle — and an import cycle between the session layer and the database layer
 * is the kind that works until the day module evaluation order changes.
 *
 * `SESSION_COOKIE` is here for exactly the same reason, one layer up: `auth.ts` imports
 * `database.ts`, so `database.ts` cannot import the name back from `auth.ts`.
 */

export const GUEST_COOKIE = 'govintel_guest';

/** The signed-in session cookie. */
export const SESSION_COOKIE = 'govintel_session';

/**
 * Cookie attributes.
 *
 * `httpOnly` keeps the id out of reach of any script, which matters because the document editor is a
 * stored-XSS surface (gap-spec §34): if XSS ever lands, it must not be able to read session ids.
 * `sameSite: 'lax'` blocks cross-site POSTs while still allowing a normal top-level navigation back
 * into the app. `secure` is conditional so local HTTP development works; deployed environments are
 * HTTPS-only.
 */
export function guestCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: maxAgeSeconds,
  };
}
