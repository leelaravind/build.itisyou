import { describe, expect, it } from 'vitest';
import { roleSafetyFaults, type ConnectionRole } from '../src/client.ts';

/**
 * `roleSafetyFaults` decides whether the application may serve requests as a given database role.
 *
 * It exists as a pure function because the live attempt to verify it proved nothing. Pointing the
 * staging Hyperdrive at the database owner and watching for a refusal returned `200` — and there was
 * no way to tell whether that meant the guard was broken, or the Worker had cached the check for the
 * isolate's lifetime, or Hyperdrive had not yet repointed its pooled connections. Three explanations,
 * one observation, no conclusion.
 *
 * A security control whose correctness can only be established by watching production behaviour is a
 * control nobody can be sure of. These tests can be.
 */

const SAFE: ConnectionRole = {
  role: 'govintel_app',
  superuser: false,
  bypassrls: false,
  owned: 0,
};

describe('roleSafetyFaults', () => {
  it('accepts the restricted application role', () => {
    // Exactly what production reports: created in SQL by the owner, granted DML and nothing more.
    expect(roleSafetyFaults(SAFE)).toEqual([]);
  });

  it('rejects a superuser', () => {
    // SEC-001. A superuser bypasses RLS unconditionally, so every policy becomes decoration.
    expect(roleSafetyFaults({ ...SAFE, role: 'postgres', superuser: true })).toEqual([
      'is a superuser',
    ]);
  });

  it('rejects a role that can bypass RLS without being a superuser', () => {
    /*
     * The load-bearing case, and the one that is easy to miss.
     *
     * Neon's `neondb_owner` reports `rolsuper = false` and `rolbypassrls = true`. A check that only
     * looked for superuser would have passed it, and tenant isolation would have silently not
     * existed — measured on the production branch, an unscoped read as that role returned the row.
     */
    expect(roleSafetyFaults({ ...SAFE, role: 'neondb_owner', bypassrls: true })).toEqual([
      'can bypass row-level security',
    ]);
  });

  it('rejects a role that owns the tables', () => {
    /*
     * `FORCE ROW LEVEL SECURITY` binds the owner, so this one looks safe and is not: an owner can
     * `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` at any moment. A role that can turn a control off
     * is not constrained by it.
     */
    expect(roleSafetyFaults({ ...SAFE, role: 'neondb_owner', owned: 16 })).toEqual([
      'owns 16 table(s) and can disable their RLS',
    ]);
  });

  it('reports every fault rather than stopping at the first', () => {
    /*
     * An operator fixing this is changing a connection string. Telling them one thing, then a second
     * after the next deploy, costs two deploys to learn what one message could have said.
     */
    const faults = roleSafetyFaults({
      role: 'postgres',
      superuser: true,
      bypassrls: true,
      owned: 16,
    });

    expect(faults).toHaveLength(3);
    expect(faults).toEqual([
      'is a superuser',
      'can bypass row-level security',
      'owns 16 table(s) and can disable their RLS',
    ]);
  });

  it('treats owning a single table as disqualifying', () => {
    // Boundary. One owned table is enough to disable RLS on the table that matters.
    expect(roleSafetyFaults({ ...SAFE, owned: 1 })).toEqual([
      'owns 1 table(s) and can disable their RLS',
    ]);
  });

  it('does not fault a role merely for its name', () => {
    /*
     * The decision is made from privileges, never from what the role is called. A deployment that
     * renamed the role — or a provider that supplies its own — must still be judged on what it can
     * actually do.
     */
    expect(roleSafetyFaults({ ...SAFE, role: 'neondb_owner' })).toEqual([]);
    expect(roleSafetyFaults({ ...SAFE, role: 'postgres' })).toEqual([]);
  });
});
