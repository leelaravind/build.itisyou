#!/usr/bin/env node
/**
 * Post-deploy verification of a web environment (contract §16, §18).
 *
 *   node scripts/evidence/deploy-check.mjs <base-url> <expected-commit>
 *
 * Checks, and fails on any miss:
 *   - TLS: the base URL is https and the request succeeds (fetch refuses a bad certificate)
 *   - identity: /api/health reports status ok, NORMAL mode (the database answered) and the commit
 *   - security headers: HSTS, a nonce-based CSP without 'unsafe-inline' scripts, no framing, nosniff
 *   - a project route the caller does not own answers 404, never 403 or 200
 *
 * Writes artifacts/test-evidence/deployment/<host>-<commit>.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [base, expected] = process.argv.slice(2);
if (base === undefined || expected === undefined) {
  console.error('usage: deploy-check.mjs <base-url> <expected-commit>');
  process.exit(2);
}

const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
};

check('served over TLS', base.startsWith('https://'), base);

const health = await fetch(`${base}/api/health`);
const body = await health.json().catch(() => ({}));
check('health endpoint answers 200', health.status === 200, `status ${health.status}`);
check(
  'database reachable (NORMAL mode)',
  body.status === 'ok' && body.mode === 'NORMAL',
  JSON.stringify(body),
);
check(
  'serves the expected commit',
  body.commit === expected,
  `commit ${body.commit}, expected ${expected}`,
);

const landing = await fetch(`${base}/`);
const header = (name) => landing.headers.get(name) ?? '';
const csp = header('content-security-policy');
check(
  'HSTS present',
  /max-age=\d+/.test(header('strict-transport-security')),
  header('strict-transport-security'),
);
check(
  'CSP uses a nonce and no unsafe-inline scripts',
  /script-src[^;]*'nonce-/.test(csp) && !/script-src[^;]*'unsafe-inline'/.test(csp),
  csp.slice(0, 120),
);
check(
  'framing refused',
  /frame-ancestors 'none'/.test(csp) || header('x-frame-options').toUpperCase() === 'DENY',
  header('x-frame-options') || 'frame-ancestors in CSP',
);
check('nosniff', header('x-content-type-options') === 'nosniff', header('x-content-type-options'));

const foreign = await fetch(`${base}/plan/00000000-0000-4000-8000-000000000000`, {
  redirect: 'manual',
});
check('an unknown project is 404, never 403', foreign.status === 404, `status ${foreign.status}`);

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const host = new URL(base).host.replace(/[^a-z0-9.-]/gi, '_');
const out = join(root, 'artifacts', 'test-evidence', 'deployment', `${host}-${expected}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  `${JSON.stringify({ base, expected, checkedAt: new Date().toISOString(), checks }, null, 2)}\n`,
);
process.exit(checks.every((c) => c.ok) ? 0 : 1);
