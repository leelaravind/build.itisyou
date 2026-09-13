#!/usr/bin/env node
/**
 * The final test report (contract §14), built from recorded evidence and nothing else.
 *
 *   node scripts/evidence/final-report.mjs
 *
 * Reads:
 *   artifacts/test-evidence/json/gates/*.json   gate records written by run-gate.mjs
 *   artifacts/test-evidence/unit/*.json          Vitest JSON reporter output
 *   artifacts/test-evidence/e2e/*.json           Playwright JSON reporter output
 *   artifacts/test-evidence/ci/*.json            CI runs, saved with `gh run view --json`
 *   artifacts/test-evidence/FAILURE_RECEIPTS.md  the receipts table
 *
 * Writes:
 *   artifacts/test-evidence/FINAL_TEST_REPORT.json
 *   artifacts/test-evidence/FINAL_TEST_REPORT.md
 *   artifacts/test-evidence/html/FINAL_TEST_REPORT.html
 *   artifacts/test-evidence/pdf/FINAL_TEST_REPORT.pdf
 *
 * The one rule: a required check with no record is NOT_CHECKED. Nothing here can turn an absence into
 * a pass, and a check that needs something only the owner holds is BLOCKED, not FAILED or PASSED.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const evidence = join(root, 'artifacts', 'test-evidence');

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const listJson = (dir) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => join(dir, f))
    : [];

const commit = execSync('git rev-parse --short HEAD', { cwd: root, encoding: 'utf8' }).trim();
const generatedAt = new Date().toISOString();

// Gate records -----------------------------------------------------------------------------------
const gates = listJson(join(evidence, 'json', 'gates'))
  .map(readJson)
  .sort((a, b) => a.startedAt.localeCompare(b.startedAt));

/** The most recent record whose id matches, or undefined. */
const latest = (pattern) => [...gates].reverse().find((g) => pattern.test(g.id));

// Vitest -----------------------------------------------------------------------------------------
function vitestSummary(file) {
  const run = readJson(file);
  const byArea = new Map();
  for (const suite of run.testResults ?? []) {
    const rel = suite.name.replace(/\\/g, '/').replace(/^.*?\/(packages|apps)\//, '$1/');
    const area = rel.split('/').slice(0, 2).join('/');
    const entry = byArea.get(area) ?? { total: 0, passed: 0, failed: 0 };
    for (const t of suite.assertionResults ?? []) {
      entry.total += 1;
      if (t.status === 'passed') entry.passed += 1;
      else if (t.status === 'failed') entry.failed += 1;
    }
    byArea.set(area, entry);
  }
  return {
    file: file.slice(root.length + 1).replace(/\\/g, '/'),
    total: run.numTotalTests,
    passed: run.numPassedTests,
    failed: run.numFailedTests,
    skipped: (run.numPendingTests ?? 0) + (run.numTodoTests ?? 0),
    success: run.success,
    byArea: Object.fromEntries([...byArea].sort()),
  };
}

// Playwright -------------------------------------------------------------------------------------
function playwrightSummary(file) {
  const run = readJson(file);
  const matrix = {};
  const bySpec = {};
  /** file › title [project] → final outcome, so a re-run can be matched to the run it re-ran. */
  const outcomes = {};
  const walk = (suite, spec) => {
    const specFile = suite.file ?? spec;
    for (const s of suite.specs ?? []) {
      for (const t of s.tests ?? []) {
        const project = t.projectName;
        const outcome = t.status; // expected | unexpected | flaky | skipped
        matrix[project] ??= { expected: 0, unexpected: 0, flaky: 0, skipped: 0 };
        matrix[project][outcome] = (matrix[project][outcome] ?? 0) + 1;
        const key = specFile ?? 'unknown';
        bySpec[key] ??= { expected: 0, unexpected: 0, flaky: 0, skipped: 0 };
        bySpec[key][outcome] = (bySpec[key][outcome] ?? 0) + 1;
        outcomes[`${key.replace(/\\/g, '/')} › ${s.title} [${project}]`] = outcome;
      }
    }
    for (const child of suite.suites ?? []) walk(child, specFile);
  };
  for (const suite of run.suites ?? []) walk(suite, suite.file);
  const stats = run.stats ?? {};
  return {
    file: file.slice(root.length + 1).replace(/\\/g, '/'),
    startTime: stats.startTime,
    durationMs: Math.round(stats.duration ?? 0),
    expected: stats.expected ?? 0,
    unexpected: stats.unexpected ?? 0,
    flaky: stats.flaky ?? 0,
    skipped: stats.skipped ?? 0,
    matrix,
    bySpec,
    outcomes,
    total:
      (stats.expected ?? 0) + (stats.unexpected ?? 0) + (stats.flaky ?? 0) + (stats.skipped ?? 0),
  };
}

const unitRuns = listJson(join(evidence, 'unit')).map(vitestSummary);
const e2eRuns = listJson(join(evidence, 'e2e')).map(playwrightSummary);
const ciRuns = listJson(join(evidence, 'ci')).map(readJson);

// Receipts ---------------------------------------------------------------------------------------
const receiptsFile = join(evidence, 'FAILURE_RECEIPTS.md');
const receipts = existsSync(receiptsFile)
  ? readFileSync(receiptsFile, 'utf8')
      .split('\n')
      .filter((line) => /^\| FR-\d+ \|/.test(line))
      .map((line) => {
        const [id, foundBy, area, status] = line
          .split('|')
          .slice(1, -1)
          .map((cell) => cell.trim());
        return { id, foundBy, area, status };
      })
  : [];

// Required checks ----------------------------------------------------------------------------------
const fromGate = (pattern, label) => {
  const gate = latest(pattern);
  if (gate === undefined) return { status: 'NOT_CHECKED', detail: `No ${label} record` };
  return {
    status: gate.result,
    detail: `${gate.command} — exit ${gate.exitCode} at ${gate.commit?.slice(0, 7)}, ${Math.round(
      gate.durationMs / 1000,
    )} s`,
    record: `json/gates/${gate.id}.json`,
  };
};

const latestBy = (runs, predicate) =>
  [...runs]
    .filter(predicate)
    .sort((a, b) => String(a.startTime ?? '').localeCompare(String(b.startTime ?? '')))
    .at(-1);

const lastUnit = unitRuns.at(-1);
/*
 * The staging verdict is the latest *full* run — the one with the most tests — not whichever staging
 * file is newest, which may be a re-run of a handful. Failures in it count against it unless every one
 * of them passed in a later staging run, and the detail says which, so a re-run can never quietly
 * replace a failing full run.
 */
const stagingRuns = e2eRuns.filter((r) => r.file.includes('staging'));
const maxStagingTotal = Math.max(0, ...stagingRuns.map((r) => r.total));
const stagingE2e = latestBy(stagingRuns, (r) => r.total >= maxStagingTotal * 0.9);
function stagingStatus(run) {
  if (run === undefined)
    return { status: 'NOT_CHECKED', detail: 'No full staging Playwright record' };
  const failed = Object.entries(run.outcomes)
    .filter(([, outcome]) => outcome === 'unexpected')
    .map(([key]) => key);
  const later = stagingRuns.filter((r) => String(r.startTime) > String(run.startTime));
  const unresolved = failed.filter(
    (key) => !later.some((r) => r.outcomes[key] === 'expected' || r.outcomes[key] === 'flaky'),
  );
  const base = `${run.expected} passed, ${run.unexpected} failed, ${run.flaky} flaky, ${run.skipped} skipped (${run.file})`;
  if (failed.length === 0) return { status: 'PASSED', detail: base };
  if (unresolved.length === 0) {
    return {
      status: 'PASSED',
      detail: `${base}; all ${failed.length} failures passed on a later staging re-run (${later.map((r) => r.file).join(', ')}) — causes in FAILURE_RECEIPTS`,
    };
  }
  return {
    status: 'FAILED',
    detail: `${base}; ${unresolved.length} failure(s) not re-run clean: ${unresolved.slice(0, 5).join('; ')}`,
  };
}
const localE2e = latestBy(e2eRuns, (r) => r.file.includes('local'));
const lastCi = [...ciRuns]
  .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
  .at(-1);

const e2eStatus = (run, label) =>
  run === undefined
    ? { status: 'NOT_CHECKED', detail: `No ${label} Playwright record` }
    : {
        status: run.unexpected === 0 ? 'PASSED' : 'FAILED',
        detail: `${run.expected} passed, ${run.unexpected} failed, ${run.flaky} flaky, ${run.skipped} skipped (${run.file})`,
      };

const specStatus = (spec) => {
  const run = latestBy(e2eRuns, (r) => Object.keys(r.bySpec).some((k) => k.includes(spec)));
  if (run === undefined)
    return { status: 'NOT_CHECKED', detail: `${spec} not in any recorded run` };
  const counts = Object.entries(run.bySpec)
    .filter(([k]) => k.includes(spec))
    .reduce(
      (acc, [, v]) => ({
        expected: acc.expected + (v.expected ?? 0),
        unexpected: acc.unexpected + (v.unexpected ?? 0),
        skipped: acc.skipped + (v.skipped ?? 0),
      }),
      { expected: 0, unexpected: 0, skipped: 0 },
    );
  return {
    status:
      counts.unexpected === 0 && counts.expected > 0
        ? 'PASSED'
        : counts.expected === 0
          ? 'NOT_CHECKED'
          : 'FAILED',
    detail: `${counts.expected} passed, ${counts.unexpected} failed, ${counts.skipped} skipped in ${run.file}`,
  };
};

const checks = [
  { area: 'Static', name: 'Formatting', ...fromGate(/format/, 'format') },
  { area: 'Static', name: 'Lint', ...fromGate(/lint/, 'lint') },
  { area: 'Static', name: 'Typecheck', ...fromGate(/typecheck/, 'typecheck') },
  {
    area: 'Static',
    name: 'Generated documentation drift',
    ...fromGate(/docs-check/, 'docs:check'),
  },
  {
    area: 'Unit and integration',
    name: 'Vitest (domain, rules, lifecycle, interchange, twin, database, worker, components)',
    ...(lastUnit === undefined
      ? { status: 'NOT_CHECKED', detail: 'No Vitest JSON' }
      : {
          status: lastUnit.failed === 0 && lastUnit.success ? 'PASSED' : 'FAILED',
          detail: `${lastUnit.passed}/${lastUnit.total} passed (${lastUnit.file})`,
        }),
  },
  { area: 'Security', name: 'Secret scan', ...fromGate(/secrets/, 'secret scan') },
  {
    area: 'Security',
    name: 'Dependency vulnerability scan',
    ...fromGate(/audit-deps/, 'dependency audit'),
  },
  {
    area: 'Security',
    name: 'Tenant isolation under a real pool, as the restricted role (staging Neon)',
    ...fromGate(/staging-isolation/, 'pooled isolation'),
  },
  {
    area: 'Security',
    name: 'Cross-tenant attack suite (isolation.spec, 404-not-403)',
    ...specStatus('isolation.spec'),
  },
  { area: 'Security', name: 'Security headers and CSP', ...specStatus('security-headers.spec') },
  { area: 'Security', name: 'CSRF origin checks', ...specStatus('csrf.spec') },
  {
    area: 'Accessibility',
    name: 'axe WCAG 2.2 AA, landmarks, keyboard, reflow',
    ...specStatus('accessibility.spec'),
  },
  {
    area: 'E2E',
    name: 'Local critical journeys (PGlite, Chromium)',
    ...e2eStatus(localE2e, 'local'),
  },
  {
    area: 'E2E',
    name: 'Staging release suite (Cloudflare + Neon)',
    ...stagingStatus(stagingE2e),
  },
  {
    area: 'CI',
    name: 'GitHub Actions at the latest recorded run',
    ...(lastCi === undefined
      ? { status: 'NOT_CHECKED', detail: 'No CI run saved' }
      : {
          status:
            lastCi.conclusion === 'success'
              ? 'PASSED'
              : lastCi.conclusion === '' || lastCi.conclusion == null
                ? 'NOT_CHECKED'
                : 'FAILED',
          detail: `run ${lastCi.databaseId} at ${String(lastCi.headSha).slice(0, 7)}: ${lastCi.conclusion || lastCi.status}`,
        }),
  },
  {
    area: 'Database',
    name: 'Schema applied to staging by the migration tool',
    ...fromGate(/staging-migrate/, 'staging migrate'),
  },
  {
    area: 'Deployment',
    name: 'Staging web Worker deployed',
    ...fromGate(/staging-deploy-web/, 'staging deploy'),
  },
  {
    area: 'Deployment',
    name: 'Staging cron Worker deployed with the budgeted schedule',
    ...fromGate(/staging-deploy-worker/, 'worker deploy'),
  },
  {
    area: 'Deployment',
    name: 'Staging health, version and database reachability',
    ...fromGate(/staging-health/, 'staging health'),
  },
  {
    area: 'Rollback',
    name: 'Staging rollback drill (roll back, verify, roll forward)',
    ...fromGate(/rollback/, 'rollback drill'),
  },
  {
    area: 'Performance',
    name: 'Latency smoke against staging',
    ...fromGate(/perf/, 'performance smoke'),
  },
  {
    area: 'Recovery',
    name: 'Point-in-time database restore drill (restored copy verified as the restricted role)',
    ...fromGate(/recovery-restore/, 'restore drill'),
  },
  {
    area: 'Security',
    name: 'Static application security testing (SAST, Semgrep public rulesets)',
    ...fromGate(/sast/, 'SAST'),
  },
  {
    area: 'Identity',
    name: 'Sign-in against a real identity provider',
    status: 'BLOCKED',
    detail:
      'No OIDC client exists for any environment (OWNER_ACTIONS.md item 1). Verified against a local mock issuer only',
  },
  {
    area: 'Production',
    name: 'Production deployment and post-deploy verification',
    status: 'BLOCKED',
    detail:
      'Not deployed: release gates are not all green (identity provider, open P1s in COMPLETION_REGISTER.md)',
  },
  {
    area: 'Mobile',
    name: 'Distinct mobile screens 59–64',
    status: 'DEFERRED',
    detail:
      'Pages reflow to 320 px and pass the reflow checks; distinct screens are not built (register W-MOB-1)',
  },
];

const tally = checks.reduce((acc, c) => ({ ...acc, [c.status]: (acc[c.status] ?? 0) + 1 }), {});

const totals = {
  unit: lastUnit
    ? { passed: lastUnit.passed, failed: lastUnit.failed, total: lastUnit.total }
    : null,
  e2e: e2eRuns.reduce(
    (acc, r) => ({
      passed: acc.passed + r.expected,
      failed: acc.failed + r.unexpected,
      flaky: acc.flaky + r.flaky,
      skipped: acc.skipped + r.skipped,
    }),
    { passed: 0, failed: 0, flaky: 0, skipped: 0 },
  ),
};

const verdict =
  (tally.FAILED ?? 0) > 0
    ? 'NOT READY — at least one required check failed'
    : (tally.BLOCKED ?? 0) > 0 || (tally.NOT_CHECKED ?? 0) > 0
      ? 'NOT RELEASE-READY — no recorded failure, but required checks are blocked or not checked'
      : 'RELEASE-READY';

const report = {
  product: 'build.itisyou',
  commit,
  generatedAt,
  verdict,
  tally,
  totals,
  checks,
  unitRuns,
  e2eRuns,
  ciRuns: ciRuns.map((r) => ({
    id: r.databaseId,
    sha: r.headSha,
    conclusion: r.conclusion,
    status: r.status,
    createdAt: r.createdAt,
    jobs: (r.jobs ?? []).map((j) => ({ name: j.name, conclusion: j.conclusion })),
  })),
  gates,
  receipts,
};

// Markdown -----------------------------------------------------------------------------------------
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|');
const md = [];
md.push(`# Final test report — build.itisyou`, '');
md.push(
  `Generated ${generatedAt} at \`${commit}\` by \`scripts/evidence/final-report.mjs\` from recorded evidence only.`,
  '',
);
md.push(`## Verdict`, '', `**${verdict}**`, '');
md.push(`| PASSED | FAILED | NOT_CHECKED | BLOCKED | DEFERRED |`, `|---|---|---|---|---|`);
md.push(
  `| ${tally.PASSED ?? 0} | ${tally.FAILED ?? 0} | ${tally.NOT_CHECKED ?? 0} | ${tally.BLOCKED ?? 0} | ${tally.DEFERRED ?? 0} |`,
  '',
);
md.push(`## Required checks`, '', `| Area | Check | Status | Evidence |`, `|---|---|---|---|`);
for (const c of checks)
  md.push(`| ${c.area} | ${esc(c.name)} | **${c.status}** | ${esc(c.detail)} |`);
md.push('', `## Test totals`, '');
if (lastUnit) {
  md.push(
    `Unit and integration (Vitest, latest run): **${lastUnit.passed} passed, ${lastUnit.failed} failed** of ${lastUnit.total}.`,
    '',
  );
  md.push(`| Area | Passed | Failed |`, `|---|---|---|`);
  for (const [area, v] of Object.entries(lastUnit.byArea))
    md.push(`| ${area} | ${v.passed} | ${v.failed} |`);
  md.push('');
}
md.push(`## End-to-end runs and browser matrix`, '');
for (const r of e2eRuns) {
  md.push(
    `### ${r.file}`,
    '',
    `${r.expected} passed · ${r.unexpected} failed · ${r.flaky} flaky · ${r.skipped} skipped · ${Math.round(r.durationMs / 1000)} s`,
    '',
  );
  md.push(`| Project | Passed | Failed | Flaky | Skipped |`, `|---|---|---|---|---|`);
  for (const [p, v] of Object.entries(r.matrix))
    md.push(
      `| ${p} | ${v.expected ?? 0} | ${v.unexpected ?? 0} | ${v.flaky ?? 0} | ${v.skipped ?? 0} |`,
    );
  md.push('');
}
md.push(`## CI`, '');
if (ciRuns.length === 0) md.push('No CI run recorded.', '');
for (const r of report.ciRuns) {
  md.push(`- Run ${r.id} at \`${String(r.sha).slice(0, 7)}\` — **${r.conclusion || r.status}**`);
  for (const j of r.jobs) md.push(`  - ${j.name}: ${j.conclusion || 'in progress'}`);
}
md.push(
  '',
  `## Gate records`,
  '',
  `| Record | Environment | Result | Commit | Duration |`,
  `|---|---|---|---|---|`,
);
for (const g of gates)
  md.push(
    `| ${g.id} | ${g.environment} | ${g.result} | ${String(g.commit).slice(0, 7)}${g.dirty ? ' (dirty)' : ''} | ${Math.round(g.durationMs / 1000)} s |`,
  );
md.push(
  '',
  `## Failures found, and what happened to them`,
  '',
  `Full receipts: \`artifacts/test-evidence/FAILURE_RECEIPTS.md\`.`,
  '',
  `| ID | Found by | Area | Status |`,
  `|---|---|---|---|`,
);
for (const r of receipts)
  md.push(`| ${r.id} | ${esc(r.foundBy)} | ${esc(r.area)} | ${esc(r.status)} |`);
md.push(
  '',
  `## Not connected, deliberately`,
  '',
  `- Identity provider (OIDC client): BLOCKED on the owner — see \`docs/final-completion/OWNER_ACTIONS.md\`.`,
  `- Notifications, search, command palette, integrations: DEFERRED (register).`,
  '',
);

mkdirSync(join(evidence, 'html'), { recursive: true });
mkdirSync(join(evidence, 'pdf'), { recursive: true });
writeFileSync(join(evidence, 'FINAL_TEST_REPORT.json'), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(join(evidence, 'FINAL_TEST_REPORT.md'), `${md.join('\n')}\n`);

// HTML and PDF -------------------------------------------------------------------------------------
const COLOR = {
  PASSED: '#1b7a3a',
  FAILED: '#b3261e',
  NOT_CHECKED: '#6b6b6b',
  BLOCKED: '#8a5a00',
  DEFERRED: '#4a4a8a',
};
const h = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
const badge = (s) =>
  `<span class="badge" style="border-color:${COLOR[s]};color:${COLOR[s]}">${s}</span>`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Final test report — build.itisyou</title>
<style>
body{font:12px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1d1d1f;margin:28px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px}h3{font-size:13px;margin:14px 0 6px}
table{border-collapse:collapse;width:100%;margin:6px 0 10px;page-break-inside:auto}th,td{border:1px solid #d9d9d9;padding:4px 6px;text-align:left;vertical-align:top}th{background:#f4f4f6}
.badge{display:inline-block;border:1.5px solid;border-radius:3px;padding:0 5px;font-weight:600;font-size:10.5px;letter-spacing:.02em}
.verdict{font-size:14px;font-weight:700;padding:8px 10px;border:2px solid #8a5a00;border-radius:4px;margin:8px 0}
.muted{color:#555}code{font-family:ui-monospace,Consolas,monospace;font-size:11px}tr{page-break-inside:avoid}
</style></head><body>
<h1>Final test report — build.itisyou</h1>
<p class="muted">Generated ${h(generatedAt)} at <code>${h(commit)}</code> from recorded evidence only (<code>scripts/evidence/final-report.mjs</code>). A check with no record is NOT_CHECKED; nothing is inferred.</p>
<div class="verdict">${h(verdict)}</div>
<table><tr>${['PASSED', 'FAILED', 'NOT_CHECKED', 'BLOCKED', 'DEFERRED'].map((s) => `<th>${badge(s)}</th>`).join('')}</tr>
<tr>${['PASSED', 'FAILED', 'NOT_CHECKED', 'BLOCKED', 'DEFERRED'].map((s) => `<td style="font-size:16px;font-weight:700">${tally[s] ?? 0}</td>`).join('')}</tr></table>
<h2>Required checks</h2>
<table><tr><th>Area</th><th>Check</th><th>Status</th><th>Evidence</th></tr>
${checks.map((c) => `<tr><td>${h(c.area)}</td><td>${h(c.name)}</td><td>${badge(c.status)}</td><td>${h(c.detail)}</td></tr>`).join('')}</table>
<h2>Test totals</h2>
${
  lastUnit
    ? `<p>Unit and integration (Vitest): <b>${lastUnit.passed} passed, ${lastUnit.failed} failed</b> of ${lastUnit.total}.</p>
<table><tr><th>Area</th><th>Passed</th><th>Failed</th></tr>${Object.entries(lastUnit.byArea)
        .map(([a, v]) => `<tr><td>${h(a)}</td><td>${v.passed}</td><td>${v.failed}</td></tr>`)
        .join('')}</table>`
    : '<p>No unit run recorded.</p>'
}
<h2>End-to-end runs and browser matrix</h2>
${e2eRuns
  .map(
    (
      r,
    ) => `<h3>${h(r.file)}</h3><p>${r.expected} passed · ${r.unexpected} failed · ${r.flaky} flaky · ${r.skipped} skipped · ${Math.round(r.durationMs / 1000)} s</p>
<table><tr><th>Project</th><th>Passed</th><th>Failed</th><th>Flaky</th><th>Skipped</th></tr>${Object.entries(
      r.matrix,
    )
      .map(
        ([p, v]) =>
          `<tr><td>${h(p)}</td><td>${v.expected ?? 0}</td><td>${v.unexpected ?? 0}</td><td>${v.flaky ?? 0}</td><td>${v.skipped ?? 0}</td></tr>`,
      )
      .join('')}</table>`,
  )
  .join('')}
<h2>CI</h2>
${report.ciRuns.length === 0 ? '<p>No CI run recorded.</p>' : report.ciRuns.map((r) => `<p><b>Run ${h(r.id)}</b> at <code>${h(String(r.sha).slice(0, 7))}</code>: ${h(r.conclusion || r.status)}</p><ul>${r.jobs.map((j) => `<li>${h(j.name)}: ${h(j.conclusion || 'in progress')}</li>`).join('')}</ul>`).join('')}
<h2>Failures found, and what happened to them</h2>
<table><tr><th>ID</th><th>Found by</th><th>Area</th><th>Status</th></tr>${receipts.map((r) => `<tr><td>${h(r.id)}</td><td>${h(r.foundBy)}</td><td>${h(r.area)}</td><td>${h(r.status)}</td></tr>`).join('')}</table>
<h2>Gate records</h2>
<table><tr><th>Record</th><th>Environment</th><th>Result</th><th>Commit</th><th>Duration</th></tr>${gates.map((g) => `<tr><td>${h(g.id)}</td><td>${h(g.environment)}</td><td>${badge(g.result)}</td><td><code>${h(String(g.commit).slice(0, 7))}</code>${g.dirty ? ' (dirty)' : ''}</td><td>${Math.round(g.durationMs / 1000)} s</td></tr>`).join('')}</table>
<h2>Not connected, deliberately</h2>
<ul><li>Identity provider (OIDC client): BLOCKED on the owner — see docs/final-completion/OWNER_ACTIONS.md.</li><li>Notifications, search, command palette, integrations: DEFERRED (register).</li></ul>
</body></html>`;
const htmlPath = join(evidence, 'html', 'FINAL_TEST_REPORT.html');
writeFileSync(htmlPath, html);

const { chromium } = await import('@playwright/test');
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`file://${htmlPath.replace(/\\/g, '/')}`);
await page.pdf({
  path: join(evidence, 'pdf', 'FINAL_TEST_REPORT.pdf'),
  format: 'A4',
  printBackground: true,
  margin: { top: '14mm', bottom: '14mm', left: '10mm', right: '10mm' },
  displayHeaderFooter: true,
  headerTemplate: '<span></span>',
  footerTemplate: `<div style="font-size:8px;width:100%;text-align:center;color:#777">build.itisyou · ${commit} · page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
});
await browser.close();

console.log(`report: ${verdict} — ${JSON.stringify(tally)}`);
