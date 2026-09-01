import { describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { getTableName, isTable } from 'drizzle-orm';
import * as schema from '../src/schema.ts';
import {
  APPLICATION_ROLE_DDL,
  APP_ROLE,
  SCHEMA_DDL,
  SCHEMA_FINGERPRINT,
  SCHEMA_META_DDL,
  readSchemaFingerprint,
  rebuildSchema,
} from '../src/client.ts';

/**
 * Schema drift detection.
 *
 * These exist because of a real failure, not a hypothetical one. The development bootstrap decided
 * "the schema is current" by checking whether the `projects` table existed. That is true from the
 * first boot onwards, so every table added later was silently absent from any data directory created
 * before it. `ai_imports` was the first to hit it, and the symptom — an insert failing against a
 * relation that does not exist — appeared three layers away from the cause.
 *
 * The tests below assert the *general* property rather than that one table: a database built from an
 * older structure must be detectable as such. A test that only asserted `ai_imports` exists would
 * pass while the next table added reintroduced the identical bug.
 */

/*
 * Each case here builds one or more real Postgres instances from scratch — PGlite boot plus the
 * full DDL measures three to six seconds on this machine, and more when the rest of the suite is
 * competing for CPU. That is the cost of testing schema construction against a real engine rather
 * than a mock, and it is the right cost to pay.
 *
 * Budgeted for this file alone. Raising the global timeout instead would hide genuine slowness in
 * the eight hundred tests that should still finish in milliseconds.
 */
vi.setConfig({ testTimeout: 30_000 });

/** A database built the way the old bootstrap built one: schema applied, nothing recorded. */
async function legacyDatabase(): Promise<PGlite> {
  const client = new PGlite();
  await client.exec(SCHEMA_DDL);
  return client;
}

describe('schema fingerprint', () => {
  it('is stable across reads of the same build', () => {
    // If it were not, every boot would look like drift and rebuild the developer's database.
    expect(SCHEMA_FINGERPRINT).toBe(SCHEMA_FINGERPRINT);
    expect(SCHEMA_FINGERPRINT).toMatch(/^[0-9a-f]{32}$/);
  });

  it('reports null for a database that has never been fingerprinted', async () => {
    const client = await legacyDatabase();
    await expect(readSchemaFingerprint(client)).resolves.toBeNull();
    await client.close();
  });

  it('reports null for a completely empty database', async () => {
    const client = new PGlite();
    await expect(readSchemaFingerprint(client)).resolves.toBeNull();
    await client.close();
  });

  it('reports the fingerprint a database was actually built from', async () => {
    const client = new PGlite();
    await rebuildSchema(client);
    await expect(readSchemaFingerprint(client)).resolves.toBe(SCHEMA_FINGERPRINT);
    await client.close();
  });

  it('treats a database built from a different structure as drifted', async () => {
    // The control the whole mechanism rests on. Recorded fingerprint differs from the current one,
    // so the bootstrap's `found !== SCHEMA_FINGERPRINT` comparison fires.
    const client = new PGlite();
    await client.exec(SCHEMA_DDL);
    await client.exec(SCHEMA_META_DDL);
    await client.query('INSERT INTO schema_meta (fingerprint) VALUES ($1)', ['an-older-build']);

    const found = await readSchemaFingerprint(client);

    expect(found).not.toBe(SCHEMA_FINGERPRINT);
    await client.close();
  });
});

describe('rebuilding a drifted database', () => {
  it('produces every table the Drizzle schema defines', async () => {
    /*
     * Compared against the *code*, not against another rebuild.
     *
     * The first version of this test built a second database and diffed the two, which is a
     * tautology: both come from the same DDL string, so it would have passed just as happily with
     * `ai_imports` missing from both. The defect being guarded against is precisely that the DDL and
     * the Drizzle schema disagree — a table declared in `schema.ts` and never added to `SCHEMA_DDL`
     * typechecks, passes review, and fails at runtime.
     *
     * Enumerated from the schema module, so a table added later is covered without anyone
     * remembering to update this list.
     */
    const declared = Object.values(schema)
      .filter((v) => isTable(v))
      .map((t) => getTableName(t))
      .sort();

    expect(declared.length).toBeGreaterThan(0);

    const client = await legacyDatabase();
    await rebuildSchema(client);

    const actual = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`,
    );
    const built = new Set(actual.rows.map((r) => r.table_name));

    expect(declared.filter((name) => !built.has(name))).toEqual([]);
    await client.close();
  });

  it('creates the table whose absence exposed the defect', async () => {
    // The specific regression. Named explicitly so a future change that drops `ai_imports` from the
    // DDL fails here rather than in a browser three phases later.
    const client = await legacyDatabase();
    await rebuildSchema(client);

    const found = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'ai_imports'`,
    );

    expect(found.rows[0]?.count).toBe(1);
    await client.close();
  });

  it('records the current fingerprint so the next boot does not rebuild again', async () => {
    // A rebuild that failed to record itself would rebuild on every request, quietly wiping the
    // database each time — worse than the bug it replaced.
    const client = await legacyDatabase();
    await rebuildSchema(client);

    await expect(readSchemaFingerprint(client)).resolves.toBe(SCHEMA_FINGERPRINT);
    await client.close();
  });

  it('can be run twice without failing on the pre-existing role', async () => {
    // Roles are cluster-scoped and survive `DROP SCHEMA public CASCADE`, so the second rebuild meets
    // a role that already exists. A bare `CREATE ROLE` throws there, and because the grants follow it
    // in the same script, the application would be left unable to read its own tables.
    const client = new PGlite();
    await rebuildSchema(client);
    await expect(rebuildSchema(client)).resolves.toBeUndefined();

    const roles = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM pg_roles WHERE rolname = '${APP_ROLE}'`,
    );
    expect(roles.rows[0]?.count).toBe(1);
    await client.close();
  });

  it('leaves the application role able to read the rebuilt tables', async () => {
    // The grants must be re-issued after a rebuild: `GRANT ... ON ALL TABLES` binds to the tables
    // that existed when it ran, so tables created by the rebuild are not covered by the original.
    const client = new PGlite();
    await rebuildSchema(client);
    await rebuildSchema(client);

    await client.exec(`SET ROLE ${APP_ROLE}`);
    await expect(client.query('SELECT count(*) FROM ai_imports')).resolves.toBeDefined();
    await client.exec('RESET ROLE');
    await client.close();
  });

  it('destroys the data that was there', async () => {
    // Stated as a test rather than only as a comment, because it is the reason this path is refused
    // in deployed environments. If a change ever made a rebuild non-destructive, that would be a
    // behaviour change worth noticing here.
    const client = new PGlite();
    await rebuildSchema(client);
    await client.query(`INSERT INTO organizations (name, slug) VALUES ('Acme', 'acme')`);

    await rebuildSchema(client);

    const rows = await client.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM organizations',
    );
    expect(rows.rows[0]?.count).toBe(0);
    await client.close();
  });
});

describe('the application role DDL', () => {
  it('is safe to apply to a database that already has the role', async () => {
    const client = new PGlite();
    await client.exec(SCHEMA_DDL);
    await client.exec(APPLICATION_ROLE_DDL);
    await expect(client.exec(APPLICATION_ROLE_DDL)).resolves.toBeDefined();
    await client.close();
  });

  it('still creates a role that cannot bypass row-level security', async () => {
    // SEC-001. The idempotent rewrite must not have quietly dropped NOSUPERUSER — a superuser
    // bypasses every policy unconditionally, which would leave RLS defined and never enforced.
    const client = new PGlite();
    await client.exec(SCHEMA_DDL);
    await client.exec(APPLICATION_ROLE_DDL);

    const role = await client.query<{ rolsuper: boolean; rolcreatedb: boolean }>(
      `SELECT rolsuper, rolcreatedb FROM pg_roles WHERE rolname = '${APP_ROLE}'`,
    );

    expect(role.rows[0]?.rolsuper).toBe(false);
    expect(role.rows[0]?.rolcreatedb).toBe(false);
    await client.close();
  });
});
