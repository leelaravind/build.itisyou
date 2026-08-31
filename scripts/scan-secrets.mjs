#!/usr/bin/env node
/**
 * Secret scanner.
 *
 * Contract: MASTER_IMPLEMENTATION_PLAN.md section 18 (secret scanning), section 4.4 (Phase-0 gate:
 * "no secrets in repository"), gap-spec section 66 (mandatory pre-live gate).
 *
 * Runs in CI on every push. Exits non-zero on any finding, which fails the build.
 *
 * Scope note: this checks the working tree, not git history. A secret that was committed and later
 * removed still lives in history and needs rotation plus history rewriting - which this cannot do
 * and must not pretend to.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = process.cwd();

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'coverage',
  'test-results',
  'playwright-report',
  '.pnpm-store',
  'stitch_project_blueprint_system',
]);

const SCAN_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.yaml',
  '.yml',
  '.env',
  '.sh',
  '.sql',
  '.toml',
  '.ini',
  '.conf',
]);

/**
 * High-confidence credential shapes. Deliberately narrow: a scanner that cries wolf gets ignored,
 * and an ignored scanner is worse than none. Keyword-only heuristics ("password") are excluded
 * because they match documentation, type definitions and test fixtures constantly.
 */
const PATTERNS = [
  { name: 'Private key block', re: /-----BEGIN(?:[A-Z ]+)?PRIVATE KEY-----/ },
  { name: 'AWS access key ID', re: /\bAKIA[0-9A-Z]{16}\b/ },
  {
    name: 'AWS secret access key',
    re: /\baws_secret_access_key\s*[=:]\s*['"]?[A-Za-z0-9/+=]{40}/i,
  },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
  { name: 'Stripe secret key', re: /\bsk_live_[A-Za-z0-9]{24,}\b/ },
  { name: 'OpenAI-style key', re: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { name: 'Anthropic key', re: /\bsk-ant-[A-Za-z0-9_-]{32,}\b/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  {
    name: 'JWT with payload',
    re: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
  },
  {
    name: 'DSN with inline credentials',
    re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:@/]+:[^\s:@/]+@/,
  },
  {
    name: 'Generic assigned secret',
    re: /\b(?:api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\s*[=:]\s*['"][A-Za-z0-9_\-+/]{24,}['"]/i,
  },
];

/**
 * Lines exempt from scanning. These are the legitimate reasons a credential *shape* appears in a
 * healthy repository: the scanner's own patterns, redaction test fixtures, and placeholders.
 */
const ALLOW_MARKERS = ['secret-scan-ignore', 'scripts/scan-secrets.mjs'];

function isExempt(line, filePath) {
  if (filePath.includes('scan-secrets')) return true;
  // Redaction tests must contain credential-shaped strings to prove they get redacted.
  if (/[\\/]test[\\/].*\.test\.tsx?$/.test(filePath)) return true;
  if (/\.example$|\.example\./.test(filePath)) return true;
  return ALLOW_MARKERS.some((marker) => line.includes(marker));
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) yield* walk(full);
    else if (stats.isFile()) yield full;
  }
}

const findings = [];
let scanned = 0;

for (const file of walk(ROOT)) {
  const ext = extname(file);
  const base = file.split(/[\\/]/).pop() ?? '';
  const scannable = SCAN_EXTENSIONS.has(ext) || base.startsWith('.env');
  if (!scannable) continue;

  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  scanned += 1;

  const rel = relative(ROOT, file);
  content.split(/\r?\n/).forEach((line, index) => {
    if (isExempt(line, rel)) return;
    for (const { name, re } of PATTERNS) {
      if (re.test(line)) {
        // Report location and pattern name only. Never echo the matched value - that would copy
        // the secret into CI logs, which are themselves retained and often world-readable.
        findings.push({ file: rel, line: index + 1, name });
      }
    }
  });
}

if (findings.length > 0) {
  console.error(`\nSecret scan FAILED - ${findings.length} finding(s):\n`);
  for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.name}`);
  console.error(
    '\nIf a finding is a false positive, add a `secret-scan-ignore` comment on that line.',
  );
  console.error(
    'If it is real: rotate the credential first, then remove it from the tree AND history.\n',
  );
  process.exit(1);
}

console.log(`Secret scan clean - ${scanned} files scanned, 0 findings.`);
