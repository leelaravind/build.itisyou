import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  APP_ROLE,
  TENANT_SETTING,
  applyTenantScope,
  createTestDatabase,
  type TestDatabase,
} from '../src/client.ts';
import { organizations, projects } from '../src/schema.ts';

/**
 * KI-049 — the tenant scope must not survive the transaction that set it.
 *
 * The existing isolation suite proves that a tenant sees only its own rows. It cannot prove the thing
 * that matters for a pooled deployment, because it runs against PGlite: one connection, serialised
 * behind a mutex, where a leaked session setting has nowhere to leak *to*.
 *
 * These tests attack the mechanism rather than the outcome. What went wrong was `set_config(..., false)`
 * and `SET ROLE` — both session-scoped — cleaned up in a `finally`. On one serialised connection that
 * is airtight. Behind Hyperdrive it is not: the connection returns to the pool still carrying an
 * organisation, and the `finally` narrows the window rather than closing it.
 *
 * So the discriminating question is not "does cleanup run" but **"is there anything to clean up".**
 * Every test below is written so that it passes only when the answer is no.
 *
 * The first two are deliberately tests *of Postgres*, not of this codebase. They establish that the
 * two forms genuinely differ, so the rest of the file is testing something real rather than a
 * convention — and if a future Postgres ever changed that, these would be the tests that noticed.
 */

/*
 * One instance for the file, with connection state reset between tests.
 *
 * Two earlier versions were wrong in opposite directions, and both are worth recording.
 *
 * The first created an instance in `beforeEach` and closed one in `afterAll` — eleven created, one
 * closed. Alone it passed; in the full parallel suite the leaked instances starved four *other*
 * database files until their setup hooks timed out.
 *
 * The second closed per test, which fixed the leak and kept the cost: creating a PGlite instance is
 * expensive (KI-017), and eleven of them still exhausted the shared worker pool.
 *
 * So: one instance, and reset the thing these tests actually care about. Connection state is cheap to
 * clear, and clearing it in `afterEach` is harness rather than subject — every test asserts its
 * residue *before* the reset runs, so the reset cannot hide what is being tested.
 */
let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterEach(async () => {
  // Unconditionally, with `false`, because that is what removes *session*-scoped residue — including
  // the residue the first test in this file creates on purpose.
  await database.db.execute(sql`SELECT set_config(${TENANT_SETTING}, '', false)`);
  await database.db.execute(sql`RESET ROLE`);
});

afterAll(async () => {
  await database.close();
});

/** Read the tenant setting as it stands on the connection right now. */
async function currentTenant(db: TestDatabase): Promise<string> {
  const result = await db.db.execute(sql`SELECT current_setting(${TENANT_SETTING}, true) AS value`);

  const rows = result as unknown as { rows: { value: string | null }[] };
  return rows.rows[0]?.value ?? '';
}

/** The role the connection is currently acting as. */
async function currentRole(db: TestDatabase): Promise<string> {
  const result = await db.db.execute(sql`SELECT current_user AS value`);
  const rows = result as unknown as { rows: { value: string }[] };
  return rows.rows[0]?.value ?? '';
}

describe('the two forms genuinely differ', () => {
  it('a session-scoped setting survives the transaction that set it', async () => {
    /*
     * The bug, demonstrated. This is what the old implementation did, and the assertion below is the
     * fact that made it unsafe: the value is still on the connection after the transaction ended.
     *
     * On a pooled connection that value is now waiting for whoever gets handed this connection next.
     */
    await database.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config(${TENANT_SETTING}, 'org-from-a-past-life', false)`);
    });

    // Deliberately left dirty. The `afterEach` reset is what clears it, which is the harness doing
    // what the *implementation* used to have to do.
    expect(await currentTenant(database)).toBe('org-from-a-past-life');
  });

  it('a transaction-scoped setting does not', async () => {
    // The fix, demonstrated. Same statement, `is_local = true`, and the value is gone the instant
    // the transaction ends — with nothing having reset it.
    await database.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config(${TENANT_SETTING}, 'org-a', true)`);

      // Present inside, which is what makes the disappearance afterwards meaningful rather than the
      // setting simply never having been applied.
      const inside = await tx.execute(
        sql`SELECT current_setting(${TENANT_SETTING}, true) AS value`,
      );
      const rows = inside as unknown as { rows: { value: string | null }[] };

      expect(rows.rows[0]?.value).toBe('org-a');
    });

    expect(await currentTenant(database)).toBe('');
  });

  it('a transaction-scoped role does not survive either', async () => {
    // The role is half of the scope and the half that makes RLS apply at all (SEC-001). A leaked
    // setting with the owner role restored is harmless; a leaked *role* with no setting denies
    // everything; a leaked pair is the disclosure.
    const before = await currentRole(database);

    await database.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE ${sql.raw(APP_ROLE)}`);
    });

    expect(await currentRole(database)).toBe(before);
  });
});

describe('KI-049: the tenant scope leaves no residue', () => {
  it('applies the scope inside the transaction', async () => {
    /*
     * Proves the transaction is real. `SET LOCAL` outside a transaction block warns and does
     * nothing, so if `applyTenantScope` were ever called without one, this assertion — not the
     * residue assertions — is what would fail.
     */
    await database.db.transaction(async (tx) => {
      await applyTenantScope(tx, 'org-a');

      const inside = await tx.execute(
        sql`SELECT current_setting(${TENANT_SETTING}, true) AS value`,
      );
      const rows = inside as unknown as { rows: { value: string | null }[] };

      expect(rows.rows[0]?.value).toBe('org-a');
    });
  });

  it('leaves nothing behind, with no cleanup step to run', async () => {
    /*
     * The test the whole file exists for.
     *
     * Note what is *absent*: no `finally`, no reset, no `RESET ROLE`. The scope is applied and the
     * transaction ends. If this passes, there is nothing for a pooled connection to carry.
     *
     * Under the old session-scoped implementation this fails on both assertions.
     */
    const roleBefore = await currentRole(database);

    await database.db.transaction(async (tx) => {
      await applyTenantScope(tx, 'org-a');
    });

    expect(await currentTenant(database)).toBe('');
    expect(await currentRole(database)).toBe(roleBefore);
  });

  it('leaves nothing behind when the transaction aborts', async () => {
    // A rollback discards `SET LOCAL` exactly as a commit does. This is the path where a `finally`
    // is most likely to be skipped in production — an exception during connection loss.
    const roleBefore = await currentRole(database);

    await expect(
      database.db.transaction(async (tx) => {
        await applyTenantScope(tx, 'org-a');
        throw new Error('deliberate');
      }),
    ).rejects.toThrow('deliberate');

    expect(await currentTenant(database)).toBe('');
    expect(await currentRole(database)).toBe(roleBefore);
  });

  it('is safe when the same connection is reused immediately', async () => {
    /*
     * The pooled-connection scenario, as closely as a single-connection database can express it.
     *
     * A pool hands the connection used by tenant A straight to the next caller. Here the same
     * connection is used for a scope and then for an unscoped read, with nothing in between — and
     * the unscoped read must see the connection as it was before anybody claimed it.
     */
    await database.asTenant('org-a', () => Promise.resolve(undefined));

    expect(await currentTenant(database)).toBe('');
    expect(await currentRole(database)).not.toBe(APP_ROLE);
  });

  it('does not let one scope observe another scope’s tenant', async () => {
    // Two scopes in succession on one connection. The second must start clean rather than inheriting.
    let seenBySecond = 'unset';

    await database.asTenant('org-a', () => Promise.resolve(undefined));

    await database.db.transaction(async (tx) => {
      const before = await tx.execute(
        sql`SELECT current_setting(${TENANT_SETTING}, true) AS value`,
      );
      const rows = before as unknown as { rows: { value: string | null }[] };
      seenBySecond = rows.rows[0]?.value ?? '';
    });

    expect(seenBySecond).toBe('');
  });
});

describe('KI-049: row visibility follows the scope, not the connection', () => {
  beforeEach(async () => {
    // Shared instance, so start from empty rather than accumulating rows across tests.
    await database.truncate();

    // Seeded as the owner, outside any tenant scope, so the rows exist regardless of RLS.
    await database.db.insert(organizations).values([
      { id: '11111111-1111-4111-8111-111111111111', name: 'Org A', slug: 'org-a' },
      { id: '22222222-2222-4222-8222-222222222222', name: 'Org B', slug: 'org-b' },
    ]);

    await database.db.insert(projects).values([
      {
        id: '33333333-3333-4333-8333-333333333333',
        organizationId: '11111111-1111-4111-8111-111111111111',
        name: 'A project belonging to A',
      },
      {
        id: '44444444-4444-4444-8444-444444444444',
        organizationId: '22222222-2222-4222-8222-222222222222',
        name: 'A project belonging to B',
      },
    ]);
  });

  it('shows a tenant only its own rows', async () => {
    // The property the existing suite already covers, restated here so the tests below are not
    // passing simply because the fixture is empty.
    const rows = await database.asTenant('11111111-1111-4111-8111-111111111111', async (tx) =>
      tx.select().from(projects),
    );

    expect(rows.map((row) => row.name)).toEqual(['A project belonging to A']);
  });

  it('shows nothing at all once the scope has ended', async () => {
    /*
     * The disclosure test.
     *
     * After a scope for A, a query issued on the same connection *under the application role* must
     * see nothing — because the tenant setting is gone, and the RLS policy compares against an empty
     * string that matches no organisation.
     *
     * Under the old implementation with its cleanup removed, this returns A's rows to a caller who
     * never claimed to be A. That is the whole of KI-049 in one assertion.
     */
    await database.asTenant('11111111-1111-4111-8111-111111111111', async (tx) =>
      tx.select().from(projects),
    );

    const leaked = await database.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE ${sql.raw(APP_ROLE)}`);
      return tx.select().from(projects);
    });

    expect(leaked).toEqual([]);
  });

  it('does not carry one tenant’s visibility into the next scope', async () => {
    // Sequential scopes for different tenants, which is what consecutive requests on a pooled
    // connection look like.
    const first = await database.asTenant('11111111-1111-4111-8111-111111111111', async (tx) =>
      tx.select().from(projects),
    );

    const second = await database.asTenant('22222222-2222-4222-8222-222222222222', async (tx) =>
      tx.select().from(projects),
    );

    expect(first.map((row) => row.name)).toEqual(['A project belonging to A']);
    expect(second.map((row) => row.name)).toEqual(['A project belonging to B']);
  });
});
