import 'server-only';

/**
 * The guest session cookie, on its own.
 *
 * Extracted from `session.ts` so that `database.ts` can resolve the caller's tenant without
 * importing it. The alternative was a cycle — `database.ts` needing the cookie name, `session.ts`
 * needing a database handle — and an import cycle between the session layer and the database layer
 * is the kind that works until the day module evaluation order changes.
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
export function guestCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: maxAgeSeconds,
  };
}
