import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '@govintel/shared/env';
import { IS_DEPLOYED } from './config.ts';

/**
 * Signing and verifying cookie values.
 *
 * Contract: gap-spec §5.2 (guest session cookie), §6.3 (session controls).
 *
 * ## Why this exists
 *
 * `SESSION_SECRET` is mandatory in every deployed environment — `parseEnv` refuses to start without
 * it — and it signed nothing. Its own comment in `packages/shared/src/env.ts` read *"Signing key for
 * guest session cookies"*, which was an assertion about a mechanism that did not exist.
 *
 * ## What signing actually buys
 *
 * Not secrecy: the value is still readable, and it is a random identifier that reveals nothing.
 * Not unguessability: a v4 UUID already has 122 bits of entropy, and no attacker is guessing one.
 *
 * What it buys is that a **tampered or fabricated cookie is rejected without a database lookup**. A
 * forged identifier previously cost one query per attempt, which is a free amplification primitive:
 * a few thousand requests a second with random ids turn into a few thousand queries a second, and
 * the connection pool is the thing that runs out first. Verification is a hash, and it happens before
 * anything expensive.
 *
 * It also makes the *shape* of a session cookie explicit, which is what an authenticated session
 * needs next — one mechanism rather than two.
 *
 * ## Why HMAC-SHA256 and not a JWT
 *
 * There is nothing to carry. The cookie holds an opaque id and every fact about the session lives
 * server-side, deliberately (§5.2). A JWT would add a parser, an algorithm field an attacker can
 * influence, and claims that can drift from the database — to transport a value that is already one
 * string.
 */

/** `value.signature`, base64url. A dot because it appears in no base64url alphabet. */
const SEPARATOR = '.';

/**
 * A fixed key used **only** where there is no deployment and therefore no attacker.
 *
 * Not a secret and not pretending to be one — that is the point of the name. It exists so that
 * `next dev` and the test suite have stable signatures without every developer having to set a
 * variable, and so that restarting the dev server does not silently invalidate the session cookie of
 * whoever is using it.
 *
 * It is unreachable in any deployed environment: `parseEnv` refuses to start `preview`, `staging` or
 * `production` without a real `SESSION_SECRET`, and the guard below refuses a second time rather
 * than trusting that.
 */
const DEVELOPMENT_KEY = 'development-only-signing-key-not-a-secret';

function key(): string {
  const secret = env().SESSION_SECRET;

  if (secret !== undefined && secret.length > 0) return secret;

  if (IS_DEPLOYED) {
    /*
     * Belt and braces. `parseEnv` already rejects a deployed environment with no `SESSION_SECRET`, so
     * reaching here means that check was bypassed or changed — and the failure mode of continuing
     * would be every session cookie in production signed with a key printed in the source.
     */
    throw new Error(
      'SESSION_SECRET is missing in a deployed environment. Refusing to sign cookies with the ' +
        'development key.',
    );
  }

  return DEVELOPMENT_KEY;
}

function signature(value: string): Buffer {
  return createHmac('sha256', key()).update(value).digest();
}

/** `value` with a signature appended. */
export function sign(value: string): string {
  return `${value}${SEPARATOR}${signature(value).toString('base64url')}`;
}

/**
 * The original value, or `undefined` if the cookie was not signed by us.
 *
 * Returns `undefined` for every failure — missing separator, malformed base64, wrong signature — and
 * deliberately does not say which. A caller cannot act differently on "malformed" than on "forged",
 * and telling them apart is information an attacker uses to find the boundary.
 */
export function unsign(signed: string | undefined): string | undefined {
  if (signed === undefined) return undefined;

  const index = signed.lastIndexOf(SEPARATOR);
  if (index <= 0) return undefined;

  const value = signed.slice(0, index);
  const provided = Buffer.from(signed.slice(index + 1), 'base64url');
  const expected = signature(value);

  /*
   * Length is checked first because `timingSafeEqual` throws on a mismatch rather than returning
   * false — and the length of a signature is not a secret, so comparing it early leaks nothing.
   */
  if (provided.length !== expected.length) return undefined;

  // Constant-time. A byte-by-byte comparison that returns early leaks how much of a forged signature
  // was correct, which is enough to construct one a byte at a time.
  return timingSafeEqual(provided, expected) ? value : undefined;
}
