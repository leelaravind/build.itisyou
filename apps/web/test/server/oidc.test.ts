import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey } from 'jose';
import {
  authorizationRequest,
  codeChallenge,
  completeCallback,
  verifyIdToken,
  type DiscoveredEndpoints,
  type OidcConfig,
} from '../../src/lib/server/oidc.ts';

/**
 * OIDC, against a real key pair and a stubbed issuer.
 *
 * No network and no provider account: a key pair is generated here, the JWKS endpoint is stubbed, and
 * tokens are signed for each case. That is what makes the *attack* cases testable — a token signed by
 * the wrong key, for the wrong audience, with a replayed nonce — which is the only part of this worth
 * testing, because the happy path is exercised by every successful login and the failures are
 * exercised by nobody until they are exploited.
 *
 * Every one of these corresponds to a known, published authentication bypass. They are silent: a
 * token that validates when it should not produces a working login for the wrong person.
 */

const CONFIG: OidcConfig = {
  issuer: 'https://issuer.example',
  clientId: 'client-abc',
  clientSecret: 'secret-xyz',
  redirectUri: 'https://build.itisyou.app/auth/callback',
};

const ENDPOINTS: DiscoveredEndpoints = {
  issuer: CONFIG.issuer,
  authorizationEndpoint: 'https://issuer.example/authorize',
  tokenEndpoint: 'https://issuer.example/token',
  jwksUri: 'https://issuer.example/jwks',
};

let signingKey: CryptoKey;
let otherKey: CryptoKey;
let jwks: { keys: unknown[] };

beforeAll(async () => {
  const real = await generateKeyPair('RS256', { extractable: true });
  const impostor = await generateKeyPair('RS256', { extractable: true });

  signingKey = real.privateKey;
  otherKey = impostor.privateKey;

  // Only the real public key is published. A token signed by `otherKey` is therefore signed by a key
  // the issuer does not vouch for — which is the whole point of publishing a key set.
  jwks = {
    keys: [{ ...(await exportJWK(real.publicKey)), kid: 'real', alg: 'RS256', use: 'sig' }],
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Serve the key set, and nothing else. Any other fetch is a mistake this test wants to see. */
function stubJwks(): void {
  vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
    // `RequestInfo` includes `Request`, which stringifies to "[object Object]" — so read the URL
    // rather than coercing the argument, or the match below silently never fires.
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === ENDPOINTS.jwksUri) {
      return Promise.resolve(new Response(JSON.stringify(jwks), { status: 200 }));
    }
    return Promise.reject(new Error(`unexpected fetch to ${url}`));
  });
}

interface TokenOptions {
  readonly issuer?: string;
  readonly audience?: string;
  readonly nonce?: string | undefined;
  readonly subject?: string | undefined;
  readonly expiresIn?: string;
  readonly key?: CryptoKey;
}

async function idToken(options: TokenOptions = {}): Promise<string> {
  let token = new SignJWT({
    ...(options.nonce === undefined ? {} : { nonce: options.nonce }),
    email: 'someone@example.com',
    name: 'Someone',
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'real' })
    .setIssuedAt()
    .setIssuer(options.issuer ?? CONFIG.issuer)
    .setAudience(options.audience ?? CONFIG.clientId)
    .setExpirationTime(options.expiresIn ?? '5m');

  if (options.subject !== undefined) token = token.setSubject(options.subject);

  return token.sign(options.key ?? signingKey);
}

describe('PKCE', () => {
  it('produces the S256 challenge for a verifier', () => {
    // RFC 7636 test vector.
    expect(codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('gives every request its own verifier, state and nonce', () => {
    /*
     * Reusing any of the three across requests defeats it. A shared state is no CSRF protection at
     * all; a shared nonce makes every token replayable against every session.
     */
    const a = authorizationRequest(CONFIG, ENDPOINTS);
    const b = authorizationRequest(CONFIG, ENDPOINTS);

    expect(a.state).not.toBe(b.state);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
  });

  it('sends the challenge and never the verifier', () => {
    // The verifier is the secret that stays on the server. Putting it in the URL would make PKCE a
    // ceremony rather than a control.
    const request = authorizationRequest(CONFIG, ENDPOINTS);
    const url = new URL(request.url);

    expect(url.searchParams.get('code_challenge')).toBe(codeChallenge(request.codeVerifier));
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(request.url).not.toContain(request.codeVerifier);
  });

  it('asks for the code flow and only the profile scopes §6.1 names', () => {
    const url = new URL(authorizationRequest(CONFIG, ENDPOINTS).url);

    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('redirect_uri')).toBe(CONFIG.redirectUri);
  });
});

describe('the state check', () => {
  const base = {
    code: 'auth-code',
    expectedNonce: 'nonce-1',
    codeVerifier: 'verifier-1',
  };

  it('refuses a callback whose state does not match', async () => {
    /*
     * The CSRF check. Without it an attacker completes *their* login in *your* browser and you end up
     * signed in as them — so your next piece of work lands in their account. It is checked before the
     * code is exchanged, because by then the damage is done.
     */
    const result = await completeCallback(CONFIG, ENDPOINTS, {
      ...base,
      state: 'from-the-attacker',
      expectedState: 'the-one-we-issued',
    });

    expect(result).toEqual({ ok: false, refusal: 'STATE_MISMATCH' });
  });

  it('refuses a callback with no state at all', async () => {
    const result = await completeCallback(CONFIG, ENDPOINTS, {
      ...base,
      state: undefined,
      expectedState: 'the-one-we-issued',
    });

    expect(result).toEqual({ ok: false, refusal: 'STATE_MISMATCH' });
  });

  it('refuses when we issued no state, rather than accepting anything', async () => {
    // The dangerous direction: if a missing *expected* state meant "no check", an attacker would
    // simply arrange for the cookie to be absent.
    const result = await completeCallback(CONFIG, ENDPOINTS, {
      ...base,
      state: 'anything',
      expectedState: undefined,
    });

    expect(result).toEqual({ ok: false, refusal: 'STATE_MISMATCH' });
  });

  it('refuses a callback with no code', async () => {
    const result = await completeCallback(CONFIG, ENDPOINTS, {
      ...base,
      code: undefined,
      state: 'matching',
      expectedState: 'matching',
    });

    expect(result).toEqual({ ok: false, refusal: 'MISSING_CODE' });
  });

  it('does not exchange the code when the state is wrong', async () => {
    // Asserted by making any fetch a failure: reaching the token endpoint at all would mean the code
    // was spent before the CSRF check ran.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('the token endpoint must not be reached'))),
    );

    const result = await completeCallback(CONFIG, ENDPOINTS, {
      ...base,
      state: 'wrong',
      expectedState: 'right',
    });

    expect(result).toEqual({ ok: false, refusal: 'STATE_MISMATCH' });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});

describe('ID token validation', () => {
  it('accepts a correctly signed token and returns the identity', async () => {
    stubJwks();

    const token = await idToken({ nonce: 'nonce-1', subject: 'subject-42' });
    const result = await verifyIdToken(CONFIG, ENDPOINTS, token, 'nonce-1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.identity).toEqual({
        issuer: CONFIG.issuer,
        subject: 'subject-42',
        email: 'someone@example.com',
        displayName: 'Someone',
      });
    }
  });

  it('refuses a token signed by a key the issuer does not publish', async () => {
    // The signature check itself. A token minted by anybody else must not authenticate anybody.
    stubJwks();

    const token = await idToken({ nonce: 'n', subject: 's', key: otherKey });

    expect(await verifyIdToken(CONFIG, ENDPOINTS, token, 'n')).toEqual({
      ok: false,
      refusal: 'TOKEN_INVALID',
    });
  });

  it('refuses a token from a different issuer', async () => {
    stubJwks();

    const token = await idToken({ nonce: 'n', subject: 's', issuer: 'https://evil.example' });

    expect(await verifyIdToken(CONFIG, ENDPOINTS, token, 'n')).toEqual({
      ok: false,
      refusal: 'TOKEN_INVALID',
    });
  });

  it('refuses a token issued for a different application', async () => {
    /*
     * The audience check, and the one most often skipped. A real token, signed by the real provider,
     * for a different client — obtained by anybody who runs another app on the same issuer. Without
     * this check it authenticates here.
     */
    stubJwks();

    const token = await idToken({ nonce: 'n', subject: 's', audience: 'some-other-client' });

    expect(await verifyIdToken(CONFIG, ENDPOINTS, token, 'n')).toEqual({
      ok: false,
      refusal: 'TOKEN_INVALID',
    });
  });

  it('refuses an expired token', async () => {
    stubJwks();

    const token = await idToken({ nonce: 'n', subject: 's', expiresIn: '-10m' });

    expect(await verifyIdToken(CONFIG, ENDPOINTS, token, 'n')).toEqual({
      ok: false,
      refusal: 'TOKEN_INVALID',
    });
  });

  it('refuses a token whose nonce does not match the request', async () => {
    /*
     * Replay. `jwtVerify` does not check the nonce — it is an OIDC claim, not a JWT one — so it is
     * ours to check, and a token captured from another session for this same client would otherwise
     * validate perfectly.
     */
    stubJwks();

    const token = await idToken({ nonce: 'from-another-session', subject: 's' });

    expect(await verifyIdToken(CONFIG, ENDPOINTS, token, 'ours')).toEqual({
      ok: false,
      refusal: 'NONCE_MISMATCH',
    });
  });

  it('refuses a token carrying no nonce at all', async () => {
    // Absence is not a match. A provider that omits it, or an attacker who strips it, must not pass.
    stubJwks();

    const token = await idToken({ subject: 's' });

    expect(await verifyIdToken(CONFIG, ENDPOINTS, token, 'ours')).toEqual({
      ok: false,
      refusal: 'NONCE_MISMATCH',
    });
  });

  it('refuses a token with no subject', async () => {
    // The subject is half the identity key (§6.1). Without it there is nobody to be.
    stubJwks();

    const token = await idToken({ nonce: 'n' });

    expect(await verifyIdToken(CONFIG, ENDPOINTS, token, 'n')).toEqual({
      ok: false,
      refusal: 'TOKEN_INVALID',
    });
  });

  it('refuses a token that is not a token', async () => {
    stubJwks();

    for (const value of ['', 'not.a.jwt', 'eyJhbGciOiJub25lIn0..']) {
      expect(await verifyIdToken(CONFIG, ENDPOINTS, value, 'n')).toEqual({
        ok: false,
        refusal: 'TOKEN_INVALID',
      });
    }
  });

  it('says only that the token was invalid, never which check failed', async () => {
    /*
     * Which check failed is information about the boundary: an attacker who learns that the
     * signature passed but the audience did not knows they have a usable signing path and only need
     * a different client id.
     */
    stubJwks();

    const wrongKey = await verifyIdToken(
      CONFIG,
      ENDPOINTS,
      await idToken({ nonce: 'n', subject: 's', key: otherKey }),
      'n',
    );
    const wrongAudience = await verifyIdToken(
      CONFIG,
      ENDPOINTS,
      await idToken({ nonce: 'n', subject: 's', audience: 'other' }),
      'n',
    );

    expect(wrongKey).toEqual(wrongAudience);
  });
});
