#!/usr/bin/env node
/**
 * Runs one gate command and records what happened, so that the final test report is built from
 * runs rather than from recollection.
 *
 *   node scripts/evidence/run-gate.mjs --id lint --category static -- pnpm lint
 *
 * Writes:
 *   artifacts/test-evidence/logs/<id>.log          full combined output
 *   artifacts/test-evidence/json/gates/<id>.json   command, commit, exit code, duration
 *
 * The exit code of this script is the exit code of the command, so it can stand in for the command
 * anywhere a gate is chained. A gate that was not run has no record — and the report generator
 * reports a missing record as NOT_CHECKED, never as PASSED.
 */
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, createWriteStream } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const evidence = join(root, 'artifacts', 'test-evidence');

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
if (sep === -1 || sep === argv.length - 1) {
  console.error('usage: run-gate.mjs --id <id> [--category <c>] [--env <label>] -- <command...>');
  process.exit(2);
}
const opts = {};
for (let i = 0; i < sep; i += 2) opts[argv[i].replace(/^--/, '')] = argv[i + 1];
const command = argv.slice(sep + 1).join(' ');
const id = opts.id;
if (!id || !/^[a-z0-9][a-z0-9._-]*$/.test(id)) {
  console.error('--id is required and must be a lowercase slug');
  process.exit(2);
}

function git(args) {
  try {
    return execSync(`git ${args}`, { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

const logPath = join(evidence, 'logs', `${id}.log`);
const recordPath = join(evidence, 'json', 'gates', `${id}.json`);
mkdirSync(dirname(logPath), { recursive: true });
mkdirSync(dirname(recordPath), { recursive: true });

const commit = git('rev-parse HEAD');
const dirty = (git('status --porcelain') ?? '').length > 0;
const startedAt = new Date();
const log = createWriteStream(logPath);
log.write(
  `# ${command}\n# commit ${commit}${dirty ? ' (dirty)' : ''}\n# started ${startedAt.toISOString()}\n\n`,
);

const child = spawn(command, { cwd: root, shell: true, env: process.env });
child.stdout.on('data', (d) => {
  process.stdout.write(d);
  log.write(d);
});
child.stderr.on('data', (d) => {
  process.stderr.write(d);
  log.write(d);
});
child.on('close', (code, signal) => {
  const finishedAt = new Date();
  const exitCode = code ?? (signal ? 128 : 1);
  const record = {
    id,
    category: opts.category ?? 'uncategorised',
    environment: opts.env ?? 'local',
    command,
    commit,
    dirty,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    exitCode,
    signal: signal ?? null,
    result: exitCode === 0 ? 'PASSED' : 'FAILED',
    platform: `${process.platform} ${process.arch} node ${process.version}`,
    log: `artifacts/test-evidence/logs/${id}.log`,
  };
  log.end(`\n# exit ${exitCode} after ${record.durationMs} ms\n`);
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  process.exit(exitCode);
});
