/**
 * Database-level tenant isolation and integrity.
 *
 * Contract: plan §3.2 (row-level security as defence-in-depth), §20 and gap-spec §40 (audit
 * immutability), §27 (foreign keys, unique and check constraints, version columns), §32.8 (cross-
 * tenant access must disclose nothing).
 *
 * These run against **real Postgres** — PGlite is the actual engine compiled to WebAssembly, not an
 * emulator (ADR-0002). That is what makes them meaningful: RLS policies, triggers, check constraints
 * and enum types all behave here as they will in production. On SQLite none of this would be
 * testable at all, which is why it was rejected.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { APP_ROLE, createTestDatabase, TENANT_SETTING, type TestDatabase } from '../src/client.ts';

let database: TestDatabase;

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

/*
 * One instance per file, truncated between tests.
 *
 * A fresh instance per test is the most obviously-isolated arrangement, and it is what this suite
 * did first — but constructing PGlite and applying the schema measured ~1.5s each, which put 33
 * tests at 50 seconds. Extrapolated to the 600-test target that is roughly 15 minutes of CI spent
 * on process startup.
 *
 * TRUNCATE gives the same isolation guarantee for a few milliseconds: every table is emptied
 * between tests, so no row can survive into the next one.
 */
beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.truncate();

  await database.db.execute(sql`
    INSERT INTO organizations (id, name, slug) VALUES
      (${ORG_A}, 'Org A', 'org-a'),
      (${ORG_B}, 'Org B', 'org-b')
  `);
});

describe('schema integrity', () => {
  it('creates every table the tenancy model needs', async () => {
    const result = await database.db.execute<{ table_name: string }>(sql`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
    `);
    const tables = result.rows.map((r) => r.table_name);

    for (const table of [
      'users',
      'organizations',
      'memberships',
      'projects',
      'project_members',
      'guest_sessions',
      'audit_events',
      'outbox_events',
    ]) {
      expect(tables, `missing table ${table}`).toContain(table);
    }
  });

  it('rejects a project with no owner at all', async () => {
    // Neither an organisation nor a guest session: the row would be invisible to every scoped query
    // and therefore unreachable and unauditable. The single-owner constraint forbids it.
    await expect(
      database.db.execute(sql`INSERT INTO projects (name) VALUES ('orphan')`),
    ).rejects.toThrow();
  });

  /*
   * These two replace a pair that asserted the opposite, and the reversal is the point.
   *
   * The old invariant was `projects_single_owner`: exactly one of `organization_id` and
   * `guest_session_id`, never both. It read as careful and it was the guest isolation hole. RLS
   * policies compare `organization_id::text` against the tenant setting, and that comparison is
   * never true for NULL — so requiring guest projects to have a NULL tenant guaranteed every guest
   * row fell outside every policy, in both directions. On staging that was 3,870 of 3,872 projects
   * and all 108,480 twin rows, protected by nothing but the application remembering to filter.
   *
   * The new invariant is: a project always has a tenant, and `guest_session_id` says whether that
   * tenant is a guest's own. Both columns set is now the normal state of an unclaimed project.
   */
  it('rejects a project with no organisation', async () => {
    // The state the old constraint *required* for every guest project, now unrepresentable. A row
    // with no tenant key matches no RLS policy, which means no policy protects it.
    await expect(
      database.db.execute(sql`
        INSERT INTO projects (guest_session_id, name)
        VALUES (gen_random_uuid(), 'tenantless')
      `),
    ).rejects.toThrow();
  });

  it('accepts an unclaimed guest project carrying both its tenant and its session', async () => {
    // Both set: the organisation is the guest session's own, and the session reference is what marks
    // the project unclaimed. The old constraint rejected exactly this.
    await expect(
      database.db.execute(sql`
        INSERT INTO projects (organization_id, guest_session_id, name)
        VALUES (${ORG_A}, gen_random_uuid(), 'unclaimed guest project')
      `),
    ).resolves.toBeDefined();
  });

  it('keeps a guest project inside its own tenant scope', async () => {
    /*
     * The property the whole change exists for, asserted end to end.
     *
     * A guest project belongs to organisation A. Read under B's scope it must not appear — which
     * before this change was impossible to test, because a guest project had no tenant to compare
     * against and every scoped read returned nothing regardless.
     */
    await database.db.execute(sql`
      INSERT INTO projects (organization_id, guest_session_id, name)
      VALUES (${ORG_A}, gen_random_uuid(), 'guest project of A')
    `);

    const asOwner = await database.asTenant(ORG_A, async (tx) =>
      tx.execute<{ name: string }>(sql`SELECT name FROM projects`),
    );
    const asOther = await database.asTenant(ORG_B, async (tx) =>
      tx.execute<{ name: string }>(sql`SELECT name FROM projects`),
    );

    expect(asOwner.rows.map((row) => row.name)).toContain('guest project of A');
    expect(asOther.rows.map((row) => row.name)).not.toContain('guest project of A');
  });

  it('refuses an intake answer whose value contradicts its state', async () => {
    // The worst intake bug: a field shown as "unknown" with a stale value underneath still feeding
    // the planning engine.
    const project = await database.db.execute<{ id: string }>(sql`
      INSERT INTO projects (organization_id, name) VALUES (${ORG_A}, 'p') RETURNING id
    `);
    const projectId = project.rows[0]!.id;

    await expect(
      database.db.execute(sql`
        INSERT INTO intake_answers (project_id, field_id, category, value, state, provenance, confidence)
        VALUES (${projectId}, 'budget.total', 'BUDGET', '42'::jsonb, 'UNKNOWN', 'USER_PROVIDED', 'LOW')
      `),
    ).rejects.toThrow();
  });

  it('refuses an intake answer that claims a value but supplies none', async () => {
    const project = await database.db.execute<{ id: string }>(sql`
      INSERT INTO projects (organization_id, name) VALUES (${ORG_A}, 'p2') RETURNING id
    `);
    const projectId = project.rows[0]!.id;

    await expect(
      database.db.execute(sql`
        INSERT INTO intake_answers (project_id, field_id, category, value, state, provenance, confidence)
        VALUES (${projectId}, 'budget.total', 'BUDGET', NULL, 'PROVIDED', 'USER_PROVIDED', 'MEDIUM')
      `),
    ).rejects.toThrow();
  });

  it('refuses two answers for the same question on one project', async () => {
    const project = await database.db.execute<{ id: string }>(sql`
      INSERT INTO projects (organization_id, name) VALUES (${ORG_A}, 'p3') RETURNING id
    `);
    const projectId = project.rows[0]!.id;

    await database.db.execute(sql`
      INSERT INTO intake_answers (project_id, field_id, category, value, state, provenance, confidence)
      VALUES (${projectId}, 'idea.summary', 'IDEA', '"a"'::jsonb, 'PROVIDED', 'USER_PROVIDED', 'MEDIUM')
    `);

    await expect(
      database.db.execute(sql`
        INSERT INTO intake_answers (project_id, field_id, category, value, state, provenance, confidence)
        VALUES (${projectId}, 'idea.summary', 'IDEA', '"b"'::jsonb, 'PROVIDED', 'USER_PROVIDED', 'MEDIUM')
      `),
    ).rejects.toThrow();
  });

  it('refuses to mark an import accepted with no validation result', async () => {
    /*
     * The third lock on the airlock.
     *
     * `acceptStagedImport` and `materializeStagedImport` both refuse this already. The constraint
     * exists because the guarantee — untrusted AI output never reaches the project unvalidated —
     * should not rest solely on application code being correct.
     */
    const project = await database.db.execute<{ id: string }>(sql`
      INSERT INTO projects (organization_id, name) VALUES (${ORG_A}, 'imp') RETURNING id
    `);
    const projectId = project.rows[0]!.id;

    await expect(
      database.db.execute(sql`
        INSERT INTO ai_imports (project_id, state, raw) VALUES (${projectId}, 'ACCEPTED', '{}')
      `),
    ).rejects.toThrow();
  });

  it('refuses to mark an import materialised with no validation result', async () => {
    const project = await database.db.execute<{ id: string }>(sql`
      INSERT INTO projects (organization_id, name) VALUES (${ORG_A}, 'imp2') RETURNING id
    `);
    const projectId = project.rows[0]!.id;

    await expect(
      database.db.execute(sql`
        INSERT INTO ai_imports (project_id, state, raw) VALUES (${projectId}, 'MATERIALIZED', '{}')
      `),
    ).rejects.toThrow();
  });

  it('allows an unvalidated import to sit in RAW', async () => {
    // RAW is exactly where an unvalidated import belongs.
    const project = await database.db.execute<{ id: string }>(sql`
      INSERT INTO projects (organization_id, name) VALUES (${ORG_A}, 'imp3') RETURNING id
    `);
    const projectId = project.rows[0]!.id;

    await expect(
      database.db.execute(sql`
        INSERT INTO ai_imports (project_id, state, raw) VALUES (${projectId}, 'RAW', 'pasted text')
      `),
    ).resolves.toBeDefined();
  });

  it('rejects an unknown import state', async () => {
    const project = await database.db.execute<{ id: string }>(sql`
      INSERT INTO projects (organization_id, name) VALUES (${ORG_A}, 'imp4') RETURNING id
    `);
    const projectId = project.rows[0]!.id;

    await expect(
      database.db.execute(sql`
        INSERT INTO ai_imports (project_id, state, raw) VALUES (${projectId}, 'APPLIED', '{}')
      `),
    ).rejects.toThrow();
  });

  it('rejects a project referencing a non-existent organisation', async () => {
    await expect(
      database.db.execute(sql`
        INSERT INTO projects (organization_id, name)
        VALUES ('99999999-9999-4999-8999-999999999999', 'ghost')
      `),
    ).rejects.toThrow();
  });

  it('enforces the currency check constraint', async () => {
    await expect(
      database.db.execute(sql`
        INSERT INTO projects (organization_id, name, base_currency)
        VALUES (${ORG_A}, 'bad currency', 'POUNDS')
      `),
    ).rejects.toThrow();
  });

  it('enforces a positive version', async () => {
    await expect(
      database.db.execute(sql`
        INSERT INTO projects (organization_id, name, version) VALUES (${ORG_A}, 'bad', 0)
      `),
    ).rejects.toThrow();
  });

  it('rejects an unsupported external-AI mode', async () => {
    // Plan §19 fixes the policy modes; an unknown value would fail open at the policy check.
    await expect(
      database.db.execute(sql`
        INSERT INTO organizations (name, slug, external_ai_mode)
        VALUES ('bad', 'bad-mode', 'SEND_EVERYTHING')
      `),
    ).rejects.toThrow();
  });

  it('rejects a guest session that expires before it was created', async () => {
    await expect(
      database.db.execute(sql`
        INSERT INTO guest_sessions (created_at, expires_at)
        VALUES (now(), now() - interval '1 hour')
      `),
    ).rejects.toThrow();
  });

  it('rejects two memberships for the same user in one organisation', async () => {
    // Two rows with different roles would make the effective permission ambiguous, and ambiguity
    // resolves in the attacker's favour.
    await database.db.execute(sql`
      INSERT INTO users (id, issuer, subject)
      VALUES ('33333333-3333-4333-8333-333333333333', 'https://idp', 'sub-1')
    `);
    await database.db.execute(sql`
      INSERT INTO memberships (organization_id, user_id, role)
      VALUES (${ORG_A}, '33333333-3333-4333-8333-333333333333', 'MEMBER')
    `);

    await expect(
      database.db.execute(sql`
        INSERT INTO memberships (organization_id, user_id, role)
        VALUES (${ORG_A}, '33333333-3333-4333-8333-333333333333', 'OWNER')
      `),
    ).rejects.toThrow();
  });

  it('keys identity on issuer and subject, not email', async () => {
    // Gap-spec §6.1. Email is mutable, reassignable, and two issuers can assert the same address.
    await database.db.execute(sql`
      INSERT INTO users (issuer, subject, email) VALUES ('https://idp-a', 'sub', 'same@example.com')
    `);

    // Same email under a different issuer is a different person, and must be allowed.
    await expect(
      database.db.execute(sql`
        INSERT INTO users (issuer, subject, email)
        VALUES ('https://idp-b', 'sub', 'same@example.com')
      `),
    ).resolves.toBeDefined();

    // The same (issuer, subject) pair is the same person, and must not duplicate.
    await expect(
      database.db.execute(sql`
        INSERT INTO users (issuer, subject) VALUES ('https://idp-a', 'sub')
      `),
    ).rejects.toThrow();
  });
});

describe('audit immutability', () => {
  beforeEach(async () => {
    await database.db.execute(sql`
      INSERT INTO audit_events (organization_id, action, entity_type, correlation_id)
      VALUES (${ORG_A}, 'PROJECT_CREATED', 'project', gen_random_uuid())
    `);
  });

  it('allows appending', async () => {
    const result = await database.db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM audit_events`,
    );
    expect(result.rows[0]?.count).toBe('1');
  });

  /**
   * Drizzle wraps driver errors as "Failed query: ...", so the trigger's own message sits on the
   * cause chain rather than the top-level message. Asserting on the chain keeps the test specific:
   * a bare `.rejects.toThrow()` would also pass if the statement failed for an unrelated reason.
   */
  async function expectRejectedBecause(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
    let caught: unknown;
    try {
      await promise;
    } catch (error) {
      caught = error;
    }

    expect(caught, 'expected the statement to be rejected').toBeDefined();

    const parts: string[] = [];
    for (let error: unknown = caught, depth = 0; error !== undefined && depth < 5; depth += 1) {
      if (error instanceof Error) {
        parts.push(error.message);
        error = error.cause;
        continue;
      }

      // A non-Error throw. `String()` on a plain object yields "[object Object]", which would make
      // the assertion pass or fail for reasons unrelated to the actual message, so serialise it.
      parts.push(JSON.stringify(error) ?? 'unserialisable');
      break;
    }

    expect(parts.join(' ')).toMatch(pattern);
  }

  it('refuses to update an audit event', async () => {
    // Enforced by trigger. "We never call UPDATE" is a promise; this is a control.
    await expectRejectedBecause(
      database.db.execute(sql`UPDATE audit_events SET action = 'TAMPERED'`),
      /append-only/,
    );
  });

  it('refuses to delete an audit event', async () => {
    await expectRejectedBecause(database.db.execute(sql`DELETE FROM audit_events`), /append-only/);
  });

  /*
   * §40 permits append, query and **retention**, and forbids updating an event or deleting an
   * individual one. The trigger used to refuse all four, which is not the same thing — and it made
   * §5.3's guest expiry impossible, because `audit_events.project_id` is ON DELETE RESTRICT and the
   * sweep deletes every expired session in one transaction. One audited guest project would have
   * stopped the purge for all of them, permanently.
   *
   * These three cases are the boundary of the exception: it covers deletion, only inside a
   * transaction that asked for it, and only for as long as that transaction lasts.
   */
  it('permits a retention sweep that has said so to delete', async () => {
    await database.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL govintel.audit_retention = 'on'`);
      await tx.execute(sql`DELETE FROM audit_events`);
    });

    const result = await database.db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM audit_events`,
    );
    expect(result.rows[0]?.count).toBe('0');
  });

  it('still refuses an update, retention flag or not', async () => {
    // There is no reading of §40 under which rewriting an event is retention. The flag must not
    // become a general "let me edit the audit log" switch, which is what it would be if the trigger
    // checked the setting before checking the operation.
    await expectRejectedBecause(
      database.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL govintel.audit_retention = 'on'`);
        await tx.execute(sql`UPDATE audit_events SET action = 'TAMPERED'`);
      }),
      /append-only/,
    );
  });

  it('does not let the permission outlive the transaction that took it', async () => {
    /*
     * `SET LOCAL` is what makes this true, and the reason it is worth a test: a connection-scoped
     * `SET` would leave the next request on a pooled connection able to delete audit events, having
     * never asked and with nothing in its code to suggest it could.
     */
    await database.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL govintel.audit_retention = 'on'`);
      await tx.execute(sql`
        INSERT INTO audit_events (organization_id, action, entity_type, correlation_id)
        VALUES (${ORG_A}, 'SECOND', 'project', gen_random_uuid())
      `);
    });

    await expectRejectedBecause(database.db.execute(sql`DELETE FROM audit_events`), /append-only/);
  });

  it('leaves the record intact after a rejected tamper attempt', async () => {
    await expect(
      database.db.execute(sql`UPDATE audit_events SET action = 'TAMPERED'`),
    ).rejects.toThrow();

    const result = await database.db.execute<{ action: string }>(
      sql`SELECT action FROM audit_events`,
    );
    expect(result.rows[0]?.action).toBe('PROJECT_CREATED');
  });

  it('refuses to delete an organisation that has audit history', async () => {
    // ON DELETE RESTRICT. Cascading the delete would erase the audit trail as a side effect of an
    // ordinary administrative action.
    await expect(
      database.db.execute(sql`DELETE FROM organizations WHERE id = ${ORG_A}`),
    ).rejects.toThrow();
  });
});

describe('row-level security', () => {
  beforeEach(async () => {
    await database.db.execute(sql`
      INSERT INTO projects (organization_id, name) VALUES
        (${ORG_A}, 'A-one'), (${ORG_A}, 'A-two'), (${ORG_B}, 'B-one')
    `);
  });

  it('returns only the current tenant rows on an unfiltered select', async () => {
    // The point of the control: even a query with no `where` clause at all sees one tenant.
    await database.asTenant(ORG_A, async (db) => {
      const result = await db.execute<{ name: string }>(sql`SELECT name FROM projects`);
      expect(result.rows.map((r) => r.name).sort()).toEqual(['A-one', 'A-two']);
    });
  });

  it('hides the other tenant entirely', async () => {
    await database.asTenant(ORG_B, async (db) => {
      const result = await db.execute<{ name: string }>(sql`SELECT name FROM projects`);
      expect(result.rows.map((r) => r.name)).toEqual(['B-one']);
    });
  });

  it('returns nothing when a row is fetched by another tenant id', async () => {
    // Direct-object-reference attack, at the database layer.
    await database.asTenant(ORG_A, async (db) => {
      const result = await db.execute(
        sql`SELECT id FROM projects WHERE organization_id = ${ORG_B}`,
      );
      expect(result.rows).toHaveLength(0);
    });
  });

  it('returns nothing when no tenant is set', async () => {
    // A code path that forgot to establish tenant context must fail closed, not open.
    //
    // Run as the application role with no tenant setting — which is exactly the shape of the bug:
    // an ordinary application connection whose request handler never set the tenant. Running this
    // as the default superuser would prove nothing, because a superuser bypasses RLS entirely.
    await database.db.execute(sql`SET ROLE ${sql.raw(APP_ROLE)}`);
    try {
      const result = await database.db.execute(sql`SELECT id FROM projects`);
      expect(result.rows).toHaveLength(0);
    } finally {
      await database.db.execute(sql`RESET ROLE`);
    }
  });

  it('is not enforced for a superuser, which is why the app must not connect as one', () => {
    // Recording the constraint as a test so it cannot be forgotten during deployment: PostgreSQL
    // exempts superusers from RLS unconditionally, and `FORCE ROW LEVEL SECURITY` only covers the
    // table owner. The deployed application must connect as a non-superuser, non-owner role.
    expect(APP_ROLE).toBe('govintel_app');
  });

  it('refuses to insert a row into another tenant', async () => {
    // WITH CHECK. Without it, a caller could write into a tenant they cannot read.
    await database.asTenant(ORG_A, async (db) => {
      await expect(
        db.execute(sql`INSERT INTO projects (organization_id, name) VALUES (${ORG_B}, 'smuggled')`),
      ).rejects.toThrow();
    });
  });

  it('refuses to reassign a row to another tenant', async () => {
    await database.asTenant(ORG_A, async (db) => {
      await expect(
        db.execute(sql`UPDATE projects SET organization_id = ${ORG_B} WHERE name = 'A-one'`),
      ).rejects.toThrow();
    });
  });

  it('cannot delete another tenant rows', async () => {
    await database.asTenant(ORG_A, async (db) => {
      await db.execute(sql`DELETE FROM projects`);
    });

    await database.asTenant(ORG_B, async (db) => {
      const result = await db.execute(sql`SELECT id FROM projects`);
      expect(result.rows).toHaveLength(1);
    });
  });

  it('does not let an aggregate leak another tenant count', async () => {
    // Aggregates are a classic side channel: a count that includes hidden rows discloses their
    // existence without returning them.
    await database.asTenant(ORG_A, async (db) => {
      const result = await db.execute<{ count: string }>(
        sql`SELECT count(*)::text AS count FROM projects`,
      );
      expect(result.rows[0]?.count).toBe('2');
    });
  });

  it('does not let a join reach across tenants', async () => {
    await database.asTenant(ORG_A, async (db) => {
      const result = await db.execute(sql`
        SELECT p.id FROM projects p
        JOIN organizations o ON o.id = p.organization_id
        WHERE o.slug = 'org-b'
      `);
      expect(result.rows).toHaveLength(0);
    });
  });

  it('protects memberships, project members, audit and outbox too', async () => {
    // Gap-spec §7.5 names each of these as an attack surface.
    for (const table of ['memberships', 'project_members', 'audit_events', 'outbox_events']) {
      const result = await database.db.execute<{
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(sql`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ${table}`);
      expect(result.rows[0]?.relrowsecurity, `${table} has RLS disabled`).toBe(true);
      // FORCE matters: without it the table owner bypasses its own policies, and in most
      // deployments the migration user and the application user are the same account.
      expect(result.rows[0]?.relforcerowsecurity, `${table} does not FORCE RLS`).toBe(true);
    }
  });

  it('clears the tenant setting after the scope ends', async () => {
    await database.asTenant(ORG_A, async () => {
      // no-op
    });

    const result = await database.db.execute<{ value: string }>(
      sql`SELECT current_setting(${TENANT_SETTING}, true) AS value`,
    );
    expect(result.rows[0]?.value === '' || result.rows[0]?.value === null).toBe(true);
  });
});

describe('optimistic concurrency', () => {
  it('starts every project at version 1', async () => {
    await database.db.execute(
      sql`INSERT INTO projects (organization_id, name) VALUES (${ORG_A}, 'p')`,
    );

    const result = await database.db.execute<{ version: number }>(
      sql`SELECT version FROM projects WHERE name = 'p'`,
    );
    expect(result.rows[0]?.version).toBe(1);
  });

  it('rejects a stale write when the version has moved on', async () => {
    // Gap-spec §49: a stale client write must conflict, not silently last-write-wins.
    await database.db.execute(
      sql`INSERT INTO projects (organization_id, name) VALUES (${ORG_A}, 'p')`,
    );
    await database.db.execute(sql`UPDATE projects SET version = 2 WHERE name = 'p'`);

    const stale = await database.db.execute(
      sql`UPDATE projects SET name = 'renamed' WHERE name = 'p' AND version = 1 RETURNING id`,
    );
    expect(stale.rows).toHaveLength(0);
  });

  it('accepts a write carrying the current version', async () => {
    await database.db.execute(
      sql`INSERT INTO projects (organization_id, name) VALUES (${ORG_A}, 'p')`,
    );

    const fresh = await database.db.execute(
      sql`UPDATE projects SET name = 'renamed', version = version + 1
          WHERE name = 'p' AND version = 1 RETURNING id`,
    );
    expect(fresh.rows).toHaveLength(1);
  });
});

describe('transactional outbox', () => {
  it('deduplicates on idempotency key', async () => {
    // Gap-spec §48: a repeated request must not produce a second side effect.
    await database.db.execute(sql`
      INSERT INTO outbox_events (organization_id, event_type, payload, correlation_id, idempotency_key)
      VALUES (${ORG_A}, 'PROJECT_CREATED', '{}'::jsonb, gen_random_uuid(), 'key-1')
    `);

    await expect(
      database.db.execute(sql`
        INSERT INTO outbox_events (organization_id, event_type, payload, correlation_id, idempotency_key)
        VALUES (${ORG_A}, 'PROJECT_CREATED', '{}'::jsonb, gen_random_uuid(), 'key-1')
      `),
    ).rejects.toThrow();
  });

  it('rolls the outbox entry back with its domain change', async () => {
    // The reason ADR-0002 chose pg-boss over Redis: enqueue and domain write share one transaction,
    // so there is no window where a change is committed but its side effect is not queued.
    await expect(
      database.db.transaction(async (tx) => {
        await tx.execute(
          sql`INSERT INTO projects (organization_id, name) VALUES (${ORG_A}, 'txn')`,
        );
        await tx.execute(sql`
          INSERT INTO outbox_events (organization_id, event_type, payload, correlation_id)
          VALUES (${ORG_A}, 'PROJECT_CREATED', '{}'::jsonb, gen_random_uuid())
        `);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    const projects = await database.db.execute(sql`SELECT id FROM projects WHERE name = 'txn'`);
    const outbox = await database.db.execute(sql`SELECT id FROM outbox_events`);

    expect(projects.rows).toHaveLength(0);
    expect(outbox.rows).toHaveLength(0);
  });

  it('commits the outbox entry with its domain change', async () => {
    await database.db.transaction(async (tx) => {
      await tx.execute(sql`INSERT INTO projects (organization_id, name) VALUES (${ORG_A}, 'txn')`);
      await tx.execute(sql`
        INSERT INTO outbox_events (organization_id, event_type, payload, correlation_id)
        VALUES (${ORG_A}, 'PROJECT_CREATED', '{}'::jsonb, gen_random_uuid())
      `);
    });

    const outbox = await database.db.execute(sql`SELECT id FROM outbox_events`);
    expect(outbox.rows).toHaveLength(1);
  });

  it('allows many rows with no idempotency key', async () => {
    // A unique index over a nullable column must not collapse all the nulls into one.
    for (let i = 0; i < 3; i += 1) {
      await database.db.execute(sql`
        INSERT INTO outbox_events (organization_id, event_type, payload, correlation_id)
        VALUES (${ORG_A}, 'NOTE', '{}'::jsonb, gen_random_uuid())
      `);
    }

    const result = await database.db.execute(sql`SELECT id FROM outbox_events`);
    expect(result.rows).toHaveLength(3);
  });
});
