import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

/**
 * OpenID Connect, provider-neutral.
 *
 * Contract: gap-spec §6.1 (*"Use provider-neutral OIDC architecture. Do not couple domain entities
 * directly to one identity provider."*), §6.2 (at minimum one production login method).
 *
 * ## What is here and what is not
 *
 * This module knows the *protocol* and nothing about any provider. It takes an issuer URL and a
 * client id, discovers the endpoints, and validates what comes back. Swapping Google for Entra for a
 * self-hosted Keycloak is three environment variables and no code.
 *
 * `packages/db/src/identity.ts` already keys users on `(issuer, subject)` for the same reason, and
 * takes claims that have *already been verified* — this is the module that verifies them.
 *
 * ## Why `jose` rather than hand-rolled verification
 *
 * Because JWT verification is the canonical example of a thing not to hand-roll. The failure modes
 * are famous and silent: accepting `alg: none`, confusing an RSA public key for an HMAC secret,
 * checking the signature but not the issuer, checking the issuer but not the audience. Each is a
 * complete authentication bypass and none of them looks wrong in review.
 *
 * ## The three random values, and what each stops
 *
 * They are easy to confuse and they defend different things:
 *
 * - **state** — CSRF on the callback. Without it, an attacker can complete *their* login in *your*
 *   browser, and you end up signed in as them, giving your work to their account.
 * - **nonce** — token replay. Binds the ID token to this specific authorization request, so a token
 *   captured elsewhere cannot be presented here.
 * - **PKCE verifier** — authorization-code interception. Without it, an attacker who obtains the
 *   code (a redirect log, a shared device, a malicious app registered on the scheme) can exchange it
 *   themselves. With it, the exchange also requires a secret that never left this server.
 */

export interface OidcConfig {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

/**
 * The configuration, or `undefined` when sign-in is not configured.
 *
 * Deliberately not an error. Guest-first is the product's central decision (plan §2.3), so a
 * deployment with no identity provider is a valid deployment — the whole application works without
 * one. The login route says so rather than crashing.
 */
export function oidcConfig(): OidcConfig | undefined {
  const issuer = process.env.OIDC_ISSUER;
  const clientId = process.env.OIDC_CLIENT_ID;
  const clientSecret = process.env.OIDC_CLIENT_SECRET;
  const redirectUri = process.env.OIDC_REDIRECT_URI;

  if (
    issuer === undefined ||
    clientId === undefined ||
    clientSecret === undefined ||
    redirectUri === undefined
  ) {
    return undefined;
  }

  return { issuer, clientId, clientSecret, redirectUri };
}

/* -------------------------------------------------------------------------- */
/* PKCE and the request parameters                                            */
/* -------------------------------------------------------------------------- */

/** A high-entropy URL-safe string. 32 bytes, because RFC 7636 asks for at least 32 characters. */
function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

export interface AuthorizationRequest {
  readonly url: string;
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
}

/** The S256 challenge for a verifier. Plain is never used: it protects against nothing. */
export function codeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export interface DiscoveredEndpoints {
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly jwksUri: string;
  readonly issuer: string;
}

/**
 * Read the provider's own description of itself.
 *
 * Discovery rather than four more environment variables, because the endpoints are the provider's to
 * choose and hard-coding them is how a working deployment breaks on the day the provider moves one.
 *
 * The returned `issuer` is checked against the configured one: a discovery document that claims a
 * different issuer than the URL it was fetched from is either a misconfiguration or somebody else's
 * provider, and tokens validated against it would be somebody else's tokens.
 */
export async function discover(config: OidcConfig): Promise<DiscoveredEndpoints> {
  const url = new URL('.well-known/openid-configuration', ensureTrailingSlash(config.issuer));
  const response = await fetch(url, { headers: { accept: 'application/json' } });

  if (!response.ok) {
    throw new Error(`OIDC discovery failed with ${String(response.status)}`);
  }

  const document = (await response.json()) as Record<string, unknown>;

  /*
   * Read as a string or not at all.
   *
   * `String(value)` on an untrusted document turns an object into `"[object Object]"` and a null
   * into `"null"` — both of which are non-empty, so the "missing endpoint" check below would pass
   * and the failure would surface later as a fetch to a nonsensical URL.
   */
  const read = (field: string): string => {
    const value = document[field];
    return typeof value === 'string' ? value : '';
  };

  const issuer = read('issuer');
  const authorizationEndpoint = read('authorization_endpoint');
  const tokenEndpoint = read('token_endpoint');
  const jwksUri = read('jwks_uri');

  if (issuer !== config.issuer) {
    throw new Error(
      `OIDC discovery returned issuer "${issuer}" for "${config.issuer}". Refusing to continue: ` +
        'tokens validated against a different issuer are a different provider’s tokens.',
    );
  }

  if (authorizationEndpoint === '' || tokenEndpoint === '' || jwksUri === '') {
    throw new Error('OIDC discovery document is missing a required endpoint.');
  }

  return { authorizationEndpoint, tokenEndpoint, jwksUri, issuer };
}

/** Build the authorization request, and the three secrets that must survive until the callback. */
export function authorizationRequest(
  config: OidcConfig,
  endpoints: DiscoveredEndpoints,
): AuthorizationRequest {
  const state = randomToken();
  const nonce = randomToken();
  const codeVerifier = randomToken();

  const url = new URL(endpoints.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  // `openid` is required; the other two are the optional profile §6.1 names and nothing more.
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge', codeChallenge(codeVerifier));
  url.searchParams.set('code_challenge_method', 'S256');

  return { url: url.toString(), state, nonce, codeVerifier };
}

/* -------------------------------------------------------------------------- */
/* The callback                                                               */
/* -------------------------------------------------------------------------- */

export const CALLBACK_REFUSALS = [
  'PROVIDER_ERROR',
  'STATE_MISMATCH',
  'MISSING_CODE',
  'EXCHANGE_FAILED',
  'TOKEN_INVALID',
  'NONCE_MISMATCH',
] as const;

export type CallbackRefusal = (typeof CALLBACK_REFUSALS)[number];

export interface VerifiedIdentity {
  readonly issuer: string;
  readonly subject: string;
  readonly email?: string;
  readonly displayName?: string;
  readonly avatarUrl?: string;
}

export type CallbackResult =
  | { readonly ok: true; readonly identity: VerifiedIdentity }
  | { readonly ok: false; readonly refusal: CallbackRefusal };

/**
 * Exchange the code and validate what comes back.
 *
 * Every check is a refusal rather than a thrown error, because each one is a thing an attacker can
 * cause and none of them is exceptional. A stack trace on a state mismatch would be an error page
 * for a routine forgery attempt.
 */
export async function completeCallback(
  config: OidcConfig,
  endpoints: DiscoveredEndpoints,
  params: {
    readonly code: string | undefined;
    readonly state: string | undefined;
    readonly expectedState: string | undefined;
    readonly expectedNonce: string | undefined;
    readonly codeVerifier: string | undefined;
  },
): Promise<CallbackResult> {
  /*
   * State first, before anything is exchanged.
   *
   * This is the CSRF check, and it has to happen before the code is spent: an attacker who can get
   * their code exchanged in your browser signs you in as them, and your next piece of work lands in
   * their account. Compared with `!==` on two opaque high-entropy strings — there is no partial
   * match to leak and nothing to time.
   */
  if (
    params.expectedState === undefined ||
    params.state === undefined ||
    params.state !== params.expectedState
  ) {
    return { ok: false, refusal: 'STATE_MISMATCH' };
  }

  if (params.code === undefined || params.code === '') {
    return { ok: false, refusal: 'MISSING_CODE' };
  }

  if (params.codeVerifier === undefined || params.expectedNonce === undefined) {
    // The cookie holding them expired or was never set. Indistinguishable from a replayed callback,
    // and treated the same way.
    return { ok: false, refusal: 'STATE_MISMATCH' };
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code_verifier: params.codeVerifier,
  });

  const response = await fetch(endpoints.tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
  });

  if (!response.ok) return { ok: false, refusal: 'EXCHANGE_FAILED' };

  const tokens = (await response.json()) as { id_token?: unknown };
  const idToken = tokens.id_token;

  if (typeof idToken !== 'string') return { ok: false, refusal: 'EXCHANGE_FAILED' };

  return verifyIdToken(config, endpoints, idToken, params.expectedNonce);
}

/** Cached per issuer. Fetching the key set on every sign-in would be a request per login. */
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function keySetFor(jwksUri: string): ReturnType<typeof createRemoteJWKSet> {
  const existing = keySets.get(jwksUri);
  if (existing !== undefined) return existing;

  const created = createRemoteJWKSet(new URL(jwksUri));
  keySets.set(jwksUri, created);
  return created;
}

/**
 * Verify an ID token's signature and its claims.
 *
 * `jwtVerify` checks the signature, `issuer` and `audience` together — separating them is how a
 * token signed by a real provider for a different application comes to be accepted here.
 */
export async function verifyIdToken(
  config: OidcConfig,
  endpoints: DiscoveredEndpoints,
  idToken: string,
  expectedNonce: string,
): Promise<CallbackResult> {
  let payload: JWTPayload;

  try {
    ({ payload } = await jwtVerify(idToken, keySetFor(endpoints.jwksUri), {
      issuer: config.issuer,
      audience: config.clientId,
      // Expiry is checked by default; this bounds how far a clock may be out in the other direction.
      clockTolerance: 60,
    }));
  } catch {
    // Deliberately opaque. Which check failed is information about the boundary.
    return { ok: false, refusal: 'TOKEN_INVALID' };
  }

  /*
   * The nonce is not checked by `jwtVerify` — it is an OIDC claim rather than a JWT one, so it is
   * ours to check. Skipping it leaves the token replayable: one captured from another session for
   * the same client would otherwise validate perfectly here.
   */
  if (typeof payload.nonce !== 'string' || payload.nonce !== expectedNonce) {
    return { ok: false, refusal: 'NONCE_MISMATCH' };
  }

  const subject = payload.sub;

  if (typeof subject !== 'string' || subject === '') {
    return { ok: false, refusal: 'TOKEN_INVALID' };
  }

  return {
    ok: true,
    identity: {
      issuer: config.issuer,
      subject,
      ...(typeof payload.email === 'string' ? { email: payload.email } : {}),
      ...(typeof payload.name === 'string' ? { displayName: payload.name } : {}),
      ...(typeof payload.picture === 'string' ? { avatarUrl: payload.picture } : {}),
    },
  };
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}
