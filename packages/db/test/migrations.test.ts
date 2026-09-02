/**
 * Written migrations, checked against the schema they claim to produce.
 *
 * Contract: gap-spec §50, `docs/MIGRATION_POLICY.md`.
 *
 * ## The claim these tests exist to check
 *
 * A migration ends by writing the new fingerprint into `schema_meta`. That is an *assertion* that the
 * database now matches the DDL the fingerprint was taken from — and the migration says so by writing
 * SQL that duplicates a piece of that DDL by hand. Nothing connects the two, so a difference between
 * them produces a database whose recorded fingerprint is a lie, and the application would start
 * happily against a shape it does not have.
 *
 * So the check is structural rather than textual: apply the migration to a database that does not
 * have the table, and compare what comes out against the same table built from the DDL. Comparing
 * the two strings would pass on two identically-wrong copies.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { MIGRATIONS, SCHEMA_MIGRATIONS_DDL, pathBetween } from '../../../scripts/migrations.mjs';
import { SCHEMA_DDL, ROW_LEVEL_SECURITY_DDL, rowsOf } from '../src/client.ts';

interface Column {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

interface Constraint {
  conname: string;
  definition: string;
}

async function columnsOf(client: PGlite, table: string): Promise<Column[]> {
  return rowsOf<Column>(
    await client.query(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY column_name`,
      [table],
    ),
  );
}

async function constraintsOf(client: PGlite, table: string): Promise<Constraint[]> {
  return rowsOf<Constraint>(
    await client.query(
      `SELECT conname, pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conrelid = $1::regclass
       ORDER BY conname`,
      [table],
    ),
  );
}

async function policiesOf(client: PGlite, table: string): Promise<string[]> {
  const rows = rowsOf<{ policyname: string }>(
    await client.query(
      `SELECT policyname FROM pg_policies WHERE tablename = $1 ORDER BY policyname`,
      [table],
    ),
  );

  return rows.map((row) => row.policyname);
}

async function forcedRls(client: PGlite, table: string): Promise<boolean> {
  const rows = rowsOf<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
    await client.query(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = $1`,
      [table],
    ),
  );

  return rows[0] !== undefined && rows[0].relrowsecurity && rows[0].relforcerowsecurity;
}

/** A database built from the DDL, which is what the fingerprint is taken from. */
let fromDdl: PGlite;
/** The same, with the migrated table dropped and rebuilt by the migration. */
let fromMigration: PGlite;

const TABLE = 'change_requests';

beforeAll(async () => {
  fromDdl = new PGlite();
  await fromDdl.exec(SCHEMA_DDL);
  await fromDdl.exec(ROW_LEVEL_SECURITY_DDL);

  fromMigration = new PGlite();
  await fromMigration.exec(SCHEMA_DDL);
  await fromMigration.exec(ROW_LEVEL_SECURITY_DDL);

  /*
   * Reproduce the shape the migration was written against by removing what it adds, then let the
   * migration put it back. Building the *previous* DDL directly is not possible — it is a past
   * revision of a source file — and this asks the question that matters anyway: does the migration
   * produce what the DDL declares?
   */
  await fromMigration.exec(`DROP TABLE ${TABLE} CASCADE`);

  const migration = MIGRATIONS.find((entry) => entry.id === '001-change-requests');
  if (migration === undefined) throw new Error('001-change-requests is missing');

  await fromMigration.exec(SCHEMA_MIGRATIONS_DDL);
  await fromMigration.exec(migration.sql);
});

afterAll(async () => {
  await fromDdl.close();
  await fromMigration.close();
});

describe('the migration produces the schema it claims to', () => {
  it('creates the same columns, with the same types and defaults', async () => {
    expect(await columnsOf(fromMigration, TABLE)).toEqual(await columnsOf(fromDdl, TABLE));
  });

  it('creates the same constraints', async () => {
    /*
     * Constraints are where a hand-written copy drifts most quietly. A missing CHECK does not fail
     * anything until the row it was meant to refuse arrives — here, a self-approval.
     */
    expect(await constraintsOf(fromMigration, TABLE)).toEqual(await constraintsOf(fromDdl, TABLE));
  });

  it('enables and forces row-level security, as the DDL does', async () => {
    // A migrated table without RLS is a tenant boundary that exists on new installations and not on
    // upgraded ones, which is the worst version of this failure: it only affects real data.
    expect(await forcedRls(fromMigration, TABLE)).toBe(true);
    expect(await forcedRls(fromMigration, TABLE)).toBe(await forcedRls(fromDdl, TABLE));
  });

  it('creates the same policies', async () => {
    expect(await policiesOf(fromMigration, TABLE)).toEqual(await policiesOf(fromDdl, TABLE));
  });
});

describe('what the migration runner will and will not do', () => {
  it('finds a path between the shapes a migration was written for', () => {
    const migration = MIGRATIONS[0];
    expect(migration).toBeDefined();

    const path = pathBetween(migration?.from ?? '', migration?.to ?? '');
    expect(path?.map((step) => step.id)).toEqual([migration?.id]);
  });

  it('refuses a shape nobody has written a migration for', () => {
    /*
     * The property `migrate.mjs` is built on, and it must survive this file existing. An
     * unrecognised fingerprint is a database nobody has thought about, and guessing at it is what
     * costs the data.
     */
    expect(pathBetween('a-shape-nobody-wrote-a-migration-for', MIGRATIONS[0]?.to ?? '')).toBeNull();
  });

  it('returns an empty path when there is nothing to do', () => {
    expect(pathBetween('same', 'same')).toEqual([]);
  });

  it('declares a rollback for every migration, decided before it runs', () => {
    // `MIGRATION_POLICY.md` §5. Recorded in the file rather than in somebody's memory of the
    // deployment, and written into `schema_migrations` so it is readable from the database later.
    for (const migration of MIGRATIONS) {
      expect(migration.rollback.length, migration.id).toBeGreaterThan(20);
      expect(migration.why.length, migration.id).toBeGreaterThan(20);
    }
  });

  it('adds only, in keeping with §1', () => {
    /*
     * Additive-first is the policy's first rule and the reason a migration is safe against a running
     * previous release. A DROP or a destructive ALTER here would need the three-deployment sequence
     * §1 describes, and could not be one entry in this list.
     */
    for (const migration of MIGRATIONS) {
      expect(migration.sql, migration.id).not.toMatch(/\bDROP\b/i);
      expect(migration.sql, migration.id).not.toMatch(/\bALTER\s+TABLE\s+\w+\s+DROP\b/i);
    }
  });
});
