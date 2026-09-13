/**
 * Signing in, as the role production connects as.
 *
 * Every step here runs with `SET ROLE govintel_app` for the whole connection, the way the Worker
 * reaches Postgres through Hyperdrive — so row-level security is enforced exactly as it is deployed.
 * The previous sign-in path passed every local journey as PGlite's superuser and would have failed
 * the first real sign-in: see `src/sign-in.ts`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { applyTenantScope, createTestDatabase, type TestDatabase } from '../src/client.ts';
import { convertGuestSession, createGuestSession } from '../src/guest.ts';
import { accountSlug, establishAccount } from '../src/sign-in.ts';
import { guestSessions, memberships, organizations, projects, users } from '../src/schema.ts';

let database: TestDatabase;

const CLAIMS = {
  issuer: 'https://idp.example',
  subject: 'subject-1',
  email: 'ada@example.com',
  displayName: 'Ada',
} as const;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.truncate();
});

async function asApplicationRole<T>(fn: () => Promise<T>): Promise<T> {
  await database.client.exec('SET ROLE govintel_app');
  try {
    return await fn();
  } finally {
    await database.client.exec('RESET ROLE');
  }
}

/** Read inside a tenant scope, as a request for that tenant would. */
async function inTenant<T>(organizationId: string, fn: Parameters<TestDatabase['asTenant']>[1]) {
  return (await database.asTenant(organizationId, fn)) as T;
}

/** A guest who did real work: a project, a twin node and an audit event, all in the guest's tenant. */
async function guestWithWork(now: Date) {
  const session = await createGuestSession(database.db, { now, ttlHours: 72 });
  const [project] = await database.db
    .insert(projects)
    .values({
      name: 'GP booking',
      organizationId: session.organizationId,
      guestSessionId: session.id,
    })
    .returning();
  if (project === undefined) throw new Error('no project');
  await database.db.execute(sql`
    INSERT INTO twin_nodes (id, organization_id, project_id, class, label, provenance, confidence)
    VALUES ('req-1', ${session.organizationId}, ${project.id}, 'REQUIREMENT', 'Book an appointment', 'DETERMINISTIC_CALCULATION', 'HIGH')
  `);
  await database.db.execute(sql`
    INSERT INTO audit_events (organization_id, project_id, action, entity_type, correlation_id)
    VALUES (${session.organizationId}, ${project.id}, 'EVIDENCE_RECORDED', 'evidence', gen_random_uuid())
  `);
  return { session, project };
}

describe('a first sign-in with no guest work', () => {
  it('creates the account, its organisation and an owner membership', async () => {
    const result = await asApplicationRole(() => establishAccount(database.db, CLAIMS, undefined));

    expect(result.created).toBe(true);
    expect(result.guest).toBe('NONE');
    const members = await inTenant<{ role: string }[]>(result.organizationId, (tx) =>
      tx.select({ role: memberships.role }).from(memberships),
    );
    expect(members.map((m) => m.role)).toEqual(['OWNER']);
    const [org] = await database.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, result.organizationId));
    expect(org?.slug).toBe(accountSlug(result.userId));
  });

  it('reuses the organisation on the next sign-in rather than creating another', async () => {
    const first = await asApplicationRole(() => establishAccount(database.db, CLAIMS, undefined));
    const second = await asApplicationRole(() => establishAccount(database.db, CLAIMS, undefined));

    expect(second.created).toBe(false);
    expect(second.organizationId).toBe(first.organizationId);
    const orgs = await database.db.select({ id: organizations.id }).from(organizations);
    expect(orgs).toHaveLength(1);
  });
});

describe('a first sign-in carrying guest work', () => {
  it('adopts the guest organisation, keeping every row the guest made visible', async () => {
    const now = new Date();
    const { session, project } = await guestWithWork(now);

    const result = await asApplicationRole(() =>
      establishAccount(database.db, CLAIMS, session.id, now),
    );

    expect(result.guest).toBe('ADOPTED');
    expect(result.projectsClaimed).toBe(1);
    expect(result.organizationId).toBe(session.organizationId);

    const seen = await inTenant<{ projects: number; nodes: number; events: number }>(
      result.organizationId,
      async (tx) => {
        const count = async (table: string) =>
          Number(
            (
              await tx.execute<{ n: string }>(
                sql`SELECT count(*)::text AS n FROM ${sql.raw(table)} WHERE project_id = ${project.id}`,
              )
            ).rows[0]?.n,
          );
        return {
          projects: Number(
            (
              await tx.execute<{ n: string }>(
                sql`SELECT count(*)::text AS n FROM projects WHERE id = ${project.id}`,
              )
            ).rows[0]?.n,
          ),
          nodes: await count('twin_nodes'),
          events: await count('audit_events'),
        };
      },
    );
    expect(seen).toEqual({ projects: 1, nodes: 1, events: 1 });
  });

  it('leaves the project no longer guest-owned, with the same id', async () => {
    const now = new Date();
    const { session, project } = await guestWithWork(now);

    await asApplicationRole(() => establishAccount(database.db, CLAIMS, session.id, now));

    const [after] = await database.db.select().from(projects).where(eq(projects.id, project.id));
    expect(after?.guestSessionId).toBeNull();
    expect(after?.organizationId).toBe(session.organizationId);
  });

  it('records the conversion on the guest session', async () => {
    const now = new Date();
    const { session } = await guestWithWork(now);

    const result = await asApplicationRole(() =>
      establishAccount(database.db, CLAIMS, session.id, now),
    );

    const [after] = await database.db
      .select()
      .from(guestSessions)
      .where(eq(guestSessions.id, session.id));
    expect(after?.convertedToUserId).toBe(result.userId);
    expect(after?.convertedAt).not.toBeNull();
  });

  it('renames the guest organisation to the account', async () => {
    const now = new Date();
    const { session } = await guestWithWork(now);

    const result = await asApplicationRole(() =>
      establishAccount(database.db, CLAIMS, session.id, now),
    );

    const [org] = await database.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, session.organizationId));
    expect(org?.name).toBe('Ada');
    expect(org?.slug).toBe(accountSlug(result.userId));
  });

  it('treats a replayed callback as already converted, not as a new account', async () => {
    const now = new Date();
    const { session } = await guestWithWork(now);

    const first = await asApplicationRole(() =>
      establishAccount(database.db, CLAIMS, session.id, now),
    );
    const replay = await asApplicationRole(() =>
      establishAccount(database.db, CLAIMS, session.id, now),
    );

    expect(replay.guest).toBe('ALREADY_CONVERTED');
    expect(replay.organizationId).toBe(first.organizationId);
    const orgs = await database.db.select({ id: organizations.id }).from(organizations);
    expect(orgs).toHaveLength(1);
  });
});

describe('guest sessions that cannot be adopted', () => {
  it('ignores an expired guest session and still signs the user in', async () => {
    const created = new Date('2026-01-01T00:00:00Z');
    const { session } = await guestWithWork(created);

    const result = await asApplicationRole(() =>
      establishAccount(database.db, CLAIMS, session.id, new Date('2026-02-01T00:00:00Z')),
    );

    expect(result.guest).toBe('EXPIRED');
    expect(result.organizationId).not.toBe(session.organizationId);
  });

  it('leaves a returning user’s guest work with the guest session, untouched', async () => {
    const home = await asApplicationRole(() => establishAccount(database.db, CLAIMS, undefined));
    const now = new Date();
    const { session, project } = await guestWithWork(now);

    const result = await asApplicationRole(() =>
      establishAccount(database.db, CLAIMS, session.id, now),
    );

    expect(result.guest).toBe('KEPT_SEPARATE');
    expect(result.organizationId).toBe(home.organizationId);
    const [after] = await database.db.select().from(projects).where(eq(projects.id, project.id));
    expect(after?.guestSessionId).toBe(session.id);
    const [stillGuest] = await database.db
      .select()
      .from(guestSessions)
      .where(eq(guestSessions.id, session.id));
    expect(stillGuest?.convertedAt).toBeNull();
  });

  it('ignores an unknown guest session id', async () => {
    const result = await asApplicationRole(() =>
      establishAccount(database.db, CLAIMS, crypto.randomUUID()),
    );
    expect(result.guest).toBe('NONE');
  });
});

describe('why the old path could not work', () => {
  it('an unscoped conversion claims nothing under the restricted role', async () => {
    // The mechanism the previous sign-in used, run the way production runs it: row-level security
    // hides the guest's project from an unscoped transaction, so there is nothing to claim.
    const now = new Date();
    const { session } = await guestWithWork(now);
    const [user] = await database.db
      .insert(users)
      .values({ issuer: 'https://idp.example', subject: 'someone' })
      .returning();
    const [org] = await database.db
      .insert(organizations)
      .values({ name: 'Home', slug: 'home' })
      .returning();

    const result = await asApplicationRole(() =>
      convertGuestSession(database.db, {
        guestSessionId: session.id,
        userId: user?.id ?? '',
        organizationId: org?.id ?? '',
        now,
      }),
    );

    expect(result.projects).toHaveLength(0);
  });

  it('an unscoped membership insert is refused by the policy', async () => {
    const [user] = await database.db
      .insert(users)
      .values({ issuer: 'https://idp.example', subject: 'someone' })
      .returning();
    const [org] = await database.db
      .insert(organizations)
      .values({ name: 'Home', slug: 'home' })
      .returning();

    await expect(
      asApplicationRole(() =>
        database.db
          .insert(memberships)
          .values({ organizationId: org?.id ?? '', userId: user?.id ?? '', role: 'OWNER' }),
      ),
    ).rejects.toThrow();

    // And scoped, the same insert is allowed: the policy is doing its job, not blocking everything.
    await asApplicationRole(() =>
      database.db.transaction(async (tx) => {
        await applyTenantScope(tx, org?.id ?? '');
        await tx
          .insert(memberships)
          .values({ organizationId: org?.id ?? '', userId: user?.id ?? '', role: 'OWNER' });
      }),
    );
  });
});
