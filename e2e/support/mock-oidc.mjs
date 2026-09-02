#!/usr/bin/env node
/**
 * A minimal OIDC provider, for the end-to-end suite only.
 *
 * Contract: plan §32.10 names login, signup-to-save, logout/session-expiry, organization users and
 * permission-denied as required Playwright journeys; gap-spec §67 requires post-live verification of
 * signup and login.
 *
 * ## Why this exists as a separate process
 *
 * The authentication stack was written and unit-tested — the authorization request, PKCE, state,
 * nonce, ID-token validation against a JWKS, the session store, guest conversion, logout — and none
 * of it had ever run end to end, because doing so needs an issuer and the only real one requires an
 * account somebody has to create by hand.
 *
 * The obvious shortcut is a development-mode bypass inside the application: a flag that mints a
 * session without a provider. That is an authentication bypass living in the product, one
 * misconfiguration away from being reachable in a deployed environment, and it would test the bypass
 * rather than the flow. `docs/DEPLOYMENT_RUNBOOK.md` used to describe a mock provider that was never
 * built; this is the version that does not put one inside the application.
 *
 * So this is an ordinary HTTP server that speaks OIDC, started by Playwright alongside the app. The
 * application under test is configured with `OIDC_ISSUER` pointing at it and has no idea it is not
 * talking to a real provider — which is the entire point, and is what makes the test meaningful.
 *
 * It signs with RS256 over a key pair generated at startup, so nothing is committed and every run
 * gets a fresh key. `node:crypto` only: adding `jose` at the workspace root purely for a test
 * fixture would be a dependency in the lockfile for something the product never loads.
 */

import { createServer } from 'node:http';
import { createSign, generateKeyPairSync, createHash, randomUUID } from 'node:crypto';

const PORT = Number(process.env.MOCK_OIDC_PORT ?? 4600);
const ISSUER = `http://localhost:${String(PORT)}`;

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KEY_ID = 'mock-oidc-key';
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: KEY_ID, use: 'sig', alg: 'RS256' };

/** Authorization codes awaiting exchange. One use each, as a real provider does. */
const codes = new Map();

const base64url = (input) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function signJwt(claims) {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: KEY_ID }));
  const payload = base64url(JSON.stringify(claims));
  const signer = createSign('RSA-SHA256');

  signer.update(`${header}.${payload}`);

  const signature = signer
    .sign(privateKey, 'base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return `${header}.${payload}.${signature}`;
}

/** S256, as the application's authorization request declares. */
function challengeOf(verifier) {
  return createHash('sha256').update(verifier).digest('base64url');
}

function send(response, status, body, headers = {}) {
  response.writeHead(status, { 'content-type': 'application/json', ...headers });
  response.end(typeof body === 'string' ? body : JSON.stringify(body));
}

/**
 * The sign-in page.
 *
 * A real provider shows one, and the journey is more honest for going through it: the test clicks a
 * button on a page served by another origin, which is what a redirect-based login actually is. The
 * email field is what lets a test sign in as two different people.
 */
function loginPage(query) {
  const hidden = ['redirect_uri', 'state', 'nonce', 'code_challenge', 'client_id']
    .map((key) => `<input type="hidden" name="${key}" value="${escapeHtml(query.get(key) ?? '')}">`)
    .join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Mock identity provider</title></head>
<body>
  <h1>Mock identity provider</h1>
  <form method="post" action="/authorize">
    ${hidden}
    <label for="email">Email</label>
    <input id="email" name="email" type="email" value="someone@example.test" required>
    <button type="submit">Sign in</button>
  </form>
</body></html>`;
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', ISSUER);

  if (url.pathname === '/.well-known/openid-configuration') {
    return send(response, 200, {
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      jwks_uri: `${ISSUER}/jwks`,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['openid', 'email', 'profile'],
    });
  }

  if (url.pathname === '/jwks') {
    return send(response, 200, { keys: [jwk] });
  }

  if (url.pathname === '/authorize' && request.method === 'GET') {
    /*
     * The parameters are checked rather than ignored. A mock that accepts an authorization request
     * with no `state` or no PKCE challenge would let the application stop sending them without any
     * test noticing — and those two parameters are the whole defence against CSRF on the callback
     * and against code interception.
     */
    for (const required of ['client_id', 'redirect_uri', 'state', 'code_challenge']) {
      if (!url.searchParams.has(required)) {
        return send(response, 400, { error: 'invalid_request', missing: required });
      }
    }

    if (url.searchParams.get('code_challenge_method') !== 'S256') {
      return send(response, 400, { error: 'invalid_request', reason: 'code_challenge_method' });
    }

    return send(response, 200, loginPage(url.searchParams), { 'content-type': 'text/html' });
  }

  if (url.pathname === '/authorize' && request.method === 'POST') {
    let body = '';

    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      const form = new URLSearchParams(body);
      const code = randomUUID();

      codes.set(code, {
        nonce: form.get('nonce') ?? '',
        challenge: form.get('code_challenge') ?? '',
        clientId: form.get('client_id') ?? '',
        email: form.get('email') ?? 'someone@example.test',
      });

      const redirect = new URL(form.get('redirect_uri') ?? '');
      redirect.searchParams.set('code', code);
      redirect.searchParams.set('state', form.get('state') ?? '');

      response.writeHead(302, { location: redirect.toString() });
      response.end();
    });

    return undefined;
  }

  if (url.pathname === '/token' && request.method === 'POST') {
    let body = '';

    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      const form = new URLSearchParams(body);
      const code = form.get('code') ?? '';
      const record = codes.get(code);

      if (record === undefined) {
        return send(response, 400, { error: 'invalid_grant' });
      }

      // One use. A code that can be replayed is a code that can be stolen and reused.
      codes.delete(code);

      const verifier = form.get('code_verifier') ?? '';

      if (challengeOf(verifier) !== record.challenge) {
        return send(response, 400, { error: 'invalid_grant', reason: 'pkce' });
      }

      const now = Math.floor(Date.now() / 1000);
      const subject = `mock|${record.email}`;

      return send(response, 200, {
        access_token: randomUUID(),
        token_type: 'Bearer',
        expires_in: 3600,
        id_token: signJwt({
          iss: ISSUER,
          sub: subject,
          aud: record.clientId,
          exp: now + 3600,
          iat: now,
          nonce: record.nonce,
          email: record.email,
          email_verified: true,
          name: record.email.split('@')[0],
        }),
      });
    });

    return undefined;
  }

  if (url.pathname === '/health') return send(response, 200, { status: 'ok' });

  return send(response, 404, { error: 'not_found' });
});

server.listen(PORT, () => {
  process.stdout.write(`mock OIDC issuer listening on ${ISSUER}\n`);
});
