#!/usr/bin/env node
/**
 * Machine-readable repository inventory (final completion contract §3.1).
 *
 *   node scripts/evidence/inventory.mjs   → artifacts/final-completion/repository-inventory.json
 *
 * Generated from the tree rather than written by hand, so it can be re-run and diffed. It records
 * what exists and what calls what; the judgements about what is complete live in
 * docs/final-completion/, which cite this file.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const rel = (p) => relative(root, p).split(sep).join('/');

const SKIP = new Set(['node_modules', 'dist', '.next', '.open-next', '.wrangler', 'coverage']);

function walk(dir, predicate, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, predicate, out);
    else if (predicate(full)) out.push(full);
  }
  return out;
}

const lines = (file) => readFileSync(file, 'utf8').split('\n').length;
const text = (file) => readFileSync(file, 'utf8');

// Routes ---------------------------------------------------------------------------------------
const appDir = join(root, 'apps/web/src/app');
const ROUTE_FILES = /\/(page|route|layout|loading|error|global-error|not-found)\.tsx?$/;
const routes = walk(appDir, (f) => ROUTE_FILES.test(f.split(sep).join('/'))).map((file) => {
  const path = rel(file);
  const segment = path.replace('apps/web/src/app', '').replace(/\/[^/]+$/, '') || '/';
  const kind = path.match(ROUTE_FILES)?.[1];
  const source = text(file);
  return {
    route: segment,
    kind,
    file: path,
    lines: lines(file),
    readsDatabase: /withDatabase|withTenant|loadPlanRows|loadProjectGraph|accessibleProject/.test(
      source,
    ),
  };
});

// Server actions ---------------------------------------------------------------------------------
const serverActions = walk(appDir, (f) => /actions\.ts$/.test(f)).map((file) => {
  const source = text(file);
  return {
    file: rel(file),
    exports: [...source.matchAll(/export async function (\w+)/g)].map((m) => m[1]),
    writesAudit: /recordAudit\(/.test(source),
    checksVersion: /eq\(projects\.version/.test(source),
  };
});

// Packages and production callers ----------------------------------------------------------------
const productionSources = [
  ...walk(join(root, 'apps/web/src'), (f) => /\.(ts|tsx)$/.test(f)),
  ...walk(join(root, 'apps/worker/src'), (f) => /\.ts$/.test(f)),
].map((f) => ({ file: rel(f), source: text(f) }));

const packages = readdirSync(join(root, 'packages')).map((name) => {
  const dir = join(root, 'packages', name);
  const pkg = JSON.parse(text(join(dir, 'package.json')));
  const modules = Object.entries(pkg.exports ?? {}).map(([subpath, target]) => {
    const specifier = `${pkg.name}${subpath === '.' ? '' : subpath.slice(1)}`;
    const callers = productionSources
      .filter((s) => s.source.includes(`'${specifier}'`))
      .map((s) => s.file);
    const file = join(dir, String(target));
    // A subpath export can name a file that has not been built; count it as empty rather than fail.
    const size = (() => {
      try {
        return lines(file);
      } catch {
        return 0;
      }
    })();
    return { specifier, file: rel(file), lines: size, productionCallers: callers };
  });
  const tests = walk(join(dir, 'test'), (f) => /\.test\.ts$/.test(f)).length;
  return { name: pkg.name, dir: `packages/${name}`, modules, testFiles: tests };
});

// Tests -------------------------------------------------------------------------------------------
const unitTests = walk(root, (f) => /\.test\.tsx?$/.test(f) && !f.includes(`${sep}e2e${sep}`)).map(
  rel,
);
const e2eSpecs = readdirSync(join(root, 'e2e'))
  .filter((f) => f.endsWith('.spec.ts'))
  .map((f) => ({
    file: `e2e/${f}`,
    tests: (text(join(root, 'e2e', f)).match(/\btest\(/g) ?? []).length,
  }));

// Database -----------------------------------------------------------------------------------------
const client = text(join(root, 'packages/db/src/client.ts'));
const tables = [...client.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)/g)].map((m) => m[1]);
const rlsTables = [...client.matchAll(/ALTER TABLE (\w+) FORCE ROW LEVEL SECURITY/g)].map(
  (m) => m[1],
);
const migrations = [...text(join(root, 'scripts/migrations.mjs')).matchAll(/id: '([^']+)'/g)].map(
  (m) => m[1],
);

// Cloudflare ---------------------------------------------------------------------------------------
const wrangler = (file) => {
  const source = text(join(root, file));
  return {
    file,
    environments: [...source.matchAll(/^\[env\.(\w+)\]/gm)].map((m) => m[1]),
    crons: [...source.matchAll(/crons\s*=\s*\[(.*)\]/g)].map((m) => m[1]),
    hyperdrive: [...source.matchAll(/^id = "([0-9a-f]{32})"/gm)].map((m) => m[1]),
    r2: [...source.matchAll(/bucket_name = "([^"]+)"/g)].map((m) => m[1]),
    queues: [...source.matchAll(/queue = "([^"]+)"/g)].map((m) => m[1]),
    routes: [...source.matchAll(/pattern = "([^"]+)"/g)].map((m) => m[1]),
  };
};

// Markers ----------------------------------------------------------------------------------------
const markers = productionSources
  .flatMap(({ file, source }) =>
    source
      .split('\n')
      .flatMap((line, i) =>
        /\b(TODO|FIXME|HACK|XXX)\b/.test(line) && !/'TODO'/.test(line)
          ? [{ file, line: i + 1, text: line.trim().slice(0, 160) }]
          : [],
      ),
  )
  .slice(0, 200);

// Navigation targets that have no route ------------------------------------------------------------
const nav = text(join(root, 'apps/web/src/components/shell/navigation.ts'));
const hrefs = [...nav.matchAll(/href:\s*(?:`|')([^`']+)(?:`|')/g)].map((m) => m[1]);
const routePatterns = routes
  .filter((r) => r.kind === 'page')
  .map(
    (r) =>
      new RegExp(`^${r.route.replace(/\[\.\.\.[^\]]+\]/g, '.+').replace(/\[[^\]]+\]/g, '[^/]+')}$`),
  );
const deadNavigation = hrefs
  .map((href) => href.replace(/\$\{[^}]+\}/g, 'x'))
  .filter((href) => !routePatterns.some((pattern) => pattern.test(href)));

const commit = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();

const inventory = {
  generatedAt: new Date().toISOString(),
  commit,
  routes,
  serverActions,
  packages,
  tests: {
    unitAndIntegrationFiles: unitTests.length,
    unitAndIntegration: unitTests,
    e2eSpecs,
    e2eTestDeclarations: e2eSpecs.reduce((sum, s) => sum + s.tests, 0),
  },
  database: {
    tables,
    rlsForced: rlsTables,
    withoutRls: tables.filter((t) => !rlsTables.includes(t)),
    migrations,
  },
  cloudflare: [wrangler('apps/web/wrangler.toml'), wrangler('apps/worker/wrangler.toml')],
  ci: readdirSync(join(root, '.github/workflows')).map((f) => `.github/workflows/${f}`),
  markers,
  deadNavigation,
  modulesWithoutProductionCallers: packages
    .flatMap((p) => p.modules)
    .filter((m) => m.productionCallers.length === 0)
    .map((m) => m.specifier),
};

const out = join(root, 'artifacts/final-completion/repository-inventory.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(inventory, null, 2)}\n`);
console.log(
  `inventory: ${routes.length} route files, ${serverActions.length} action files, ` +
    `${packages.length} packages, ${unitTests.length} unit/integration test files, ` +
    `${e2eSpecs.length} e2e specs, ${tables.length} tables (${rlsTables.length} RLS-forced), ` +
    `${inventory.modulesWithoutProductionCallers.length} modules without production callers, ` +
    `${deadNavigation.length} dead navigation targets`,
);
