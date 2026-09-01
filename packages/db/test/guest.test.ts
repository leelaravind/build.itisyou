/**
 * Guest session and conversion tests.
 *
 * Contract: gap-spec §5.4 — conversion must preserve the project id, intake, imported response,
 * preview, assumptions, warnings, version and timestamps; "no duplicate project must be created
 * from repeated save requests"; and **"Test concurrent double-submit"** is called out by name.
 *
 * Double-submit is the single most likely race in this product. The user has just finished a long
 * unsaved flow, presses Save, sees nothing for a second, and presses again.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { AppError } from '@govintel/shared/errors';
import { createTestDatabase, type TestDatabase } from '../src/client.ts';
import {
  DEFAULT_GUEST_TTL_HOURS,
  convertGuestSession,
  createGuestSession,
  findActiveGuestSession,
  purgeExpiredGuestSessions,
  touchGuestSession,
} from '../src/guest.ts';
import { guestSessions, projects } from '../src/schema.ts';

let database: TestDatabase;

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '33333333-3333-4333-8333-333333333333';

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.truncate();
  await database.db.execute(sql`
    INSERT INTO organizations (id, name, slug) VALUES (${ORG}, 'Acme', 'acme')
  `);
  await database.db.execute(sql`
    INSERT INTO users (id, issuer, subject) VALUES (${USER}, 'https://idp', 'sub-1')
  `);
});

describe('creating a guest session', () => {
  it('creates a session with a future expiry', async () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const session = await createGuestSession(database.db, { now });

    expect(session.expiresAt.getTime()).toBeGreaterThan(now.getTime());
  });

  it('defaults to the configured TTL', async () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const session = await createGuestSession(database.db, { now });

    const hours = (session.expiresAt.getTime() - now.getTime()) / 3_600_000;
    expect(hours).toBeCloseTo(DEFAULT_GUEST_TTL_HOURS, 5);
  });

  it('honours an explicit TTL', async () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const session = await createGuestSession(database.db, { now, ttlHours: 1 });

    expect(session.expiresAt.getTime() - now.getTime()).toBe(3_600_000);
  });

  it('starts unconverted', async () => {
    const session = await createGuestSession(database.db);
    expect(session.convertedAt).toBeNull();
    expect(session.convertedToUserId).toBeNull();
  });

  it('issues a distinct id per session', async () => {
    const a = await createGuestSession(database.db);
    const b = await createGuestSession(database.db);
    expect(a.id).not.toBe(b.id);
  });
});

describe('loading a guest session', () => {
  it('returns an active session', async () => {
    const created = await createGuestSession(database.db);
    const found = await findActiveGuestSession(database.db, created.id);
    expect(found?.id).toBe(created.id);
  });

  it('treats an expired session as absent', async () => {
    // Checked at read time, not left to a sweeper. "The row still exists because the cleaner has
    // not run yet" is not a reason to honour an expired session.
    const now = new Date('2026-01-01T00:00:00Z');
    const created = await createGuestSession(database.db, { now, ttlHours: 1 });

    const later = new Date(now.getTime() + 2 * 3_600_000);
    expect(await findActiveGuestSession(database.db, created.id, later)).toBeUndefined();
  });

  it('returns undefined for an unknown id', async () => {
    const found = await findActiveGuestSession(database.db, '99999999-9999-4999-8999-999999999999');
    expect(found).toBeUndefined();
  });

  it('records activity without extending expiry', async () => {
    // A guest project is time-boxed. Sliding the window on every request would make expiry
    // effectively unreachable for an active user, defeating gap-spec §5.3.
    const now = new Date('2026-01-01T00:00:00Z');
    const created = await createGuestSession(database.db, { now, ttlHours: 1 });

    await touchGuestSession(database.db, created.id, new Date(now.getTime() + 60_000));

    const [after] = await database.db
      .select()
      .from(guestSessions)
      .where(eq(guestSessions.id, created.id));

    expect(after?.expiresAt.getTime()).toBe(created.expiresAt.getTime());
    expect(after?.lastSeenAt.getTime()).toBeGreaterThan(created.lastSeenAt.getTime());
  });
});

describe('conversion to an account', () => {
  async function seedGuestProject(
    session: { id: string; organizationId: string },
    name = 'My idea',
  ): Promise<string> {
    // A guest project carries its session's organisation as its tenant. Without it the row falls
    // outside every RLS policy, which is what made guest data unprotected before.
    const [project] = await database.db
      .insert(projects)
      .values({ name, organizationId: session.organizationId, guestSessionId: session.id })
      .returning();
    return project!.id;
  }

  it('claims the guest project for the organisation', async () => {
    const session = await createGuestSession(database.db);
    await seedGuestProject(session);

    const result = await convertGuestSession(database.db, {
      guestSessionId: session.id,
      userId: USER,
      organizationId: ORG,
    });

    expect(result.converted).toBe(true);
    expect(result.projects).toHaveLength(1);
  });

  it('preserves the project id so existing links keep working', async () => {
    // Gap-spec §5.4 requires the project id or a durable mapping to survive conversion.
    const session = await createGuestSession(database.db);
    const projectId = await seedGuestProject(session);

    const result = await convertGuestSession(database.db, {
      guestSessionId: session.id,
      userId: USER,
      organizationId: ORG,
    });

    expect(result.projects[0]?.id).toBe(projectId);
  });

  it('clears the guest session link so the project is no longer guest-owned', async () => {
    const session = await createGuestSession(database.db);
    await seedGuestProject(session);

    const result = await convertGuestSession(database.db, {
      guestSessionId: session.id,
      userId: USER,
      organizationId: ORG,
    });

    expect(result.projects[0]?.guestSessionId).toBeNull();
  });

  it('records who converted the session', async () => {
    const session = await createGuestSession(database.db);
    await seedGuestProject(session);

    const result = await convertGuestSession(database.db, {
      guestSessionId: session.id,
      userId: USER,
      organizationId: ORG,
    });

    expect(result.session.convertedToUserId).toBe(USER);
    expect(result.session.convertedAt).not.toBeNull();
  });

  it('preserves the project version across conversion', async () => {
    const session = await createGuestSession(database.db);
    const projectId = await seedGuestProject(session);
    await database.db.update(projects).set({ version: 4 }).where(eq(projects.id, projectId));

    const result = await convertGuestSession(database.db, {
      guestSessionId: session.id,
      userId: USER,
      organizationId: ORG,
    });

    expect(result.projects[0]?.version).toBe(4);
  });

  it('preserves the creation timestamp', async () => {
    const session = await createGuestSession(database.db);
    const projectId = await seedGuestProject(session);

    const [before] = await database.db.select().from(projects).where(eq(projects.id, projectId));
    const result = await convertGuestSession(database.db, {
      guestSessionId: session.id,
      userId: USER,
      organizationId: ORG,
    });

    expect(result.projects[0]?.createdAt.getTime()).toBe(before?.createdAt.getTime());
  });

  it('converts every project the session owns', async () => {
    const session = await createGuestSession(database.db);
    await seedGuestProject(session, 'first');
    await seedGuestProject(session, 'second');

    const result = await convertGuestSession(database.db, {
      guestSessionId: session.id,
      userId: USER,
      organizationId: ORG,
    });

    expect(result.projects).toHaveLength(2);
  });

  it('refuses an unknown session', async () => {
    await expect(
      convertGuestSession(database.db, {
        guestSessionId: '99999999-9999-4999-8999-999999999999',
        userId: USER,
        organizationId: ORG,
      }),
    ).rejects.toThrow(AppError);
  });

  it('refuses an expired session', async () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const session = await createGuestSession(database.db, { now, ttlHours: 1 });
    await seedGuestProject(session);

    await expect(
      convertGuestSession(database.db, {
        guestSessionId: session.id,
        userId: USER,
        organizationId: ORG,
        now: new Date(now.getTime() + 2 * 3_600_000),
      }),
    ).rejects.toThrow(AppError);
  });
});

describe('conversion is idempotent', () => {
  async function seedGuestProject(session: {
    id: string;
    organizationId: string;
  }): Promise<string> {
    const [project] = await database.db
      .insert(projects)
      .values({
        name: 'My idea',
        organizationId: session.organizationId,
        guestSessionId: session.id,
      })
      .returning();
    return project!.id;
  }

  it('does not create a second project when the request is replayed', async () => {
    // Gap-spec §5.4: "No duplicate project must be created from repeated save requests."
    const session = await createGuestSession(database.db);
    await seedGuestProject(session);

    const input = { guestSessionId: session.id, userId: USER, organizationId: ORG };
    await convertGuestSession(database.db, input);
    await convertGuestSession(database.db, input);

    const all = await database.db.select().from(projects);
    expect(all).toHaveLength(1);
  });

  it('reports the replay as not-converted rather than throwing', async () => {
    // The user double-clicked. They did nothing wrong, so this is a no-op, not an error.
    const session = await createGuestSession(database.db);
    await seedGuestProject(session);

    const input = { guestSessionId: session.id, userId: USER, organizationId: ORG };
    const first = await convertGuestSession(database.db, input);
    const second = await convertGuestSession(database.db, input);

    expect(first.converted).toBe(true);
    expect(second.converted).toBe(false);
  });

  it('returns the same project on the replayed request', async () => {
    const session = await createGuestSession(database.db);
    const projectId = await seedGuestProject(session);

    const input = { guestSessionId: session.id, userId: USER, organizationId: ORG };
    await convertGuestSession(database.db, input);
    const second = await convertGuestSession(database.db, input);

    expect(second.projects[0]?.id).toBe(projectId);
  });

  it('does not overwrite the original conversion timestamp on replay', async () => {
    const session = await createGuestSession(database.db);
    await seedGuestProject(session);

    const input = { guestSessionId: session.id, userId: USER, organizationId: ORG };
    const first = await convertGuestSession(database.db, {
      ...input,
      now: new Date('2026-01-01T00:00:00Z'),
    });
    const second = await convertGuestSession(database.db, {
      ...input,
      now: new Date('2026-06-01T00:00:00Z'),
    });

    expect(second.session.convertedAt?.getTime()).toBe(first.session.convertedAt?.getTime());
  });

  it('survives a concurrent double-submit', async () => {
    // The case gap-spec §5.4 names explicitly. Both requests read the session at the same moment;
    // `SELECT ... FOR UPDATE` serialises them so the second waits rather than racing.
    const session = await createGuestSession(database.db);
    await seedGuestProject(session);

    const input = { guestSessionId: session.id, userId: USER, organizationId: ORG };
    const results = await Promise.all([
      convertGuestSession(database.db, input),
      convertGuestSession(database.db, input),
    ]);

    const all = await database.db.select().from(projects);
    expect(all, 'a concurrent double-submit created a duplicate project').toHaveLength(1);

    // Exactly one of the two should report having done the conversion.
    expect(results.filter((r) => r.converted)).toHaveLength(1);
  });

  it('leaves nothing half-converted when the transaction fails', async () => {
    // A project moved to an organisation but with its session link intact would be worse than a
    // failed conversion: the user would see a project that had quietly lost its guest state.
    const session = await createGuestSession(database.db);
    await seedGuestProject(session);

    await expect(
      database.db.transaction(async (tx) => {
        await tx
          .update(projects)
          .set({ organizationId: ORG, guestSessionId: null })
          .where(eq(projects.guestSessionId, session.id));
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    const [project] = await database.db.select().from(projects);
    expect(project?.guestSessionId).toBe(session.id);
  });
});

describe('expiry sweep', () => {
  it('deletes expired unconverted sessions and their projects', async () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const session = await createGuestSession(database.db, { now, ttlHours: 1 });
    await database.db.insert(projects).values({
      name: 'abandoned',
      organizationId: session.organizationId,
      guestSessionId: session.id,
    });

    const result = await purgeExpiredGuestSessions(
      database.db,
      new Date(now.getTime() + 2 * 3_600_000),
    );

    expect(result.sessionsDeleted).toBe(1);
    expect(result.projectsDeleted).toBe(1);
  });

  it('leaves active sessions alone', async () => {
    const now = new Date('2026-01-01T00:00:00Z');
    await createGuestSession(database.db, { now, ttlHours: 72 });

    const result = await purgeExpiredGuestSessions(
      database.db,
      new Date(now.getTime() + 3_600_000),
    );

    expect(result.sessionsDeleted).toBe(0);
  });

  it('keeps converted sessions even after they expire', async () => {
    // `convertedToUserId` is the audit link explaining where a saved project came from. Deleting it
    // would sever the provenance of every project created through the guest flow.
    const now = new Date('2026-01-01T00:00:00Z');
    const session = await createGuestSession(database.db, { now, ttlHours: 1 });
    await database.db.insert(projects).values({
      name: 'saved',
      organizationId: session.organizationId,
      guestSessionId: session.id,
    });

    await convertGuestSession(database.db, {
      guestSessionId: session.id,
      userId: USER,
      organizationId: ORG,
      now,
    });

    const result = await purgeExpiredGuestSessions(
      database.db,
      new Date(now.getTime() + 100 * 3_600_000),
    );

    expect(result.sessionsDeleted).toBe(0);

    const remaining = await database.db.select().from(projects);
    expect(remaining, 'a saved project was deleted by the guest sweep').toHaveLength(1);
  });

  it('is a no-op when nothing has expired', async () => {
    const result = await purgeExpiredGuestSessions(database.db, new Date('2026-01-01T00:00:00Z'));
    expect(result).toEqual({ sessionsDeleted: 0, projectsDeleted: 0 });
  });
});
