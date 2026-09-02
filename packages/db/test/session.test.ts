import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../src/client.ts';
import { organizations, sessions, users } from '../src/schema.ts';
import {
  SESSION_POLICY,
  createSession,
  purgeEndedSessions,
  revokeAllForUser,
  revokeSession,
  touchSession,
} from '../src/session.ts';

/**
 * Authenticated sessions (gap-spec §6.3).
 *
 * The interesting behaviour is entirely in how the two timeouts interact. An idle window that rolls
 * forward without being bounded is an absolute timeout that never fires, and the failure is silent —
 * sessions simply never end, which looks like nothing at all until somebody asks how long a stolen
 * cookie stays useful.
 */

let database: TestDatabase;

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const START = new Date('2026-01-01T09:00:00.000Z');

const at = (minutes: number) => new Date(START.getTime() + minutes * 60_000);

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.truncate();
  await database.db
    .insert(organizations)
    .values({ id: ORG, name: 'Org', slug: `org-${Date.now().toString()}` });
  await database.db
    .insert(users)
    .values({ id: USER, issuer: 'https://issuer.example', subject: 'subject-1' });
});

describe('creating a session', () => {
  it('sets both windows from the policy', async () => {
    const session = await createSession(database.db, {
      userId: USER,
      organizationId: ORG,
      now: START,
    });

    expect(session.idleExpiresAt.getTime()).toBe(
      START.getTime() + SESSION_POLICY.idleMinutes * 60_000,
    );
    expect(session.absoluteExpiresAt.getTime()).toBe(
      START.getTime() + SESSION_POLICY.absoluteHours * 3_600_000,
    );
    expect(session.revokedAt).toBeNull();
  });

  it('records which organisation the session is acting in', async () => {
    // A user may belong to several (§7.1) and the tenant scope needs exactly one. Deriving it per
    // request would let two requests in the same page load disagree.
    const session = await createSession(database.db, { userId: USER, organizationId: ORG });

    expect(session.organizationId).toBe(ORG);
  });
});

describe('the idle window', () => {
  it('rolls forward on activity', async () => {
    const session = await createSession(database.db, {
      userId: USER,
      organizationId: ORG,
      now: START,
    });

    const touched = await touchSession(database.db, session.id, at(30));

    expect(touched?.idleExpiresAt.getTime()).toBe(
      at(30).getTime() + SESSION_POLICY.idleMinutes * 60_000,
    );
  });

  it('refuses a session left idle past the window', async () => {
    const session = await createSession(database.db, {
      userId: USER,
      organizationId: ORG,
      now: START,
    });

    expect(
      await touchSession(database.db, session.id, at(SESSION_POLICY.idleMinutes + 1)),
    ).toBeUndefined();
  });

  it('never rolls past the absolute expiry', async () => {
    /*
     * The load-bearing test. Rolling the idle window forward unbounded turns the absolute timeout
     * into a value nothing enforces — a session used once an hour would live forever. The database
     * constraint would also reject it, which would surface as a 500 on an ordinary page load rather
     * than as an expiry.
     */
    const session = await createSession(database.db, {
      userId: USER,
      organizationId: ORG,
      now: START,
    });

    /*
     * Kept alive to reach the end, because that is the only way to get there.
     *
     * Jumping straight to minute 715 tests nothing: the idle window closed at minute 60 and the
     * session is already gone. The clamp only matters for a session that has been *used* right up to
     * its absolute limit, which is exactly the session an unbounded roll-forward would keep alive
     * forever.
     */
    const nearTheEnd = SESSION_POLICY.absoluteHours * 60 - 5;
    for (let minute = 30; minute < nearTheEnd; minute += 30) {
      await touchSession(database.db, session.id, at(minute));
    }

    const touched = await touchSession(database.db, session.id, at(nearTheEnd));

    expect(touched).toBeDefined();
    // 715 + 60 would be 775, past the absolute expiry at 720. Clamped, not extended.
    expect(touched?.idleExpiresAt.getTime()).toBe(session.absoluteExpiresAt.getTime());
  });

  it('refuses a session past its absolute expiry however active it has been', async () => {
    const session = await createSession(database.db, {
      userId: USER,
      organizationId: ORG,
      now: START,
    });

    // Touched every half hour right up to the limit, then one minute past it.
    for (let minute = 30; minute < SESSION_POLICY.absoluteHours * 60; minute += 30) {
      await touchSession(database.db, session.id, at(minute));
    }

    expect(
      await touchSession(database.db, session.id, at(SESSION_POLICY.absoluteHours * 60 + 1)),
    ).toBeUndefined();
  });
});

describe('revocation', () => {
  it('refuses a revoked session even inside both windows', async () => {
    const session = await createSession(database.db, {
      userId: USER,
      organizationId: ORG,
      now: START,
    });

    await revokeSession(database.db, session.id, 'LOGOUT', at(5));

    expect(await touchSession(database.db, session.id, at(10))).toBeUndefined();
  });

  it('keeps the row, so when and why it ended has an answer', async () => {
    const session = await createSession(database.db, { userId: USER, organizationId: ORG });
    await revokeSession(database.db, session.id, 'SECURITY_EVENT');

    const [row] = await database.db.select().from(sessions);

    expect(row?.revokedReason).toBe('SECURITY_EVENT');
    expect(row?.revokedAt).not.toBeNull();
  });

  it('does not overwrite the original reason when revoked twice', async () => {
    // A logout followed by a bulk security revocation must not rewrite history to say the user
    // logged out because of a security event.
    const session = await createSession(database.db, { userId: USER, organizationId: ORG });
    await revokeSession(database.db, session.id, 'LOGOUT', at(1));
    await revokeSession(database.db, session.id, 'SECURITY_EVENT', at(2));

    const [row] = await database.db.select().from(sessions);

    expect(row?.revokedReason).toBe('LOGOUT');
  });

  it('ends every session a user holds', async () => {
    /*
     * What a security event needs. A stolen credential is not one session, and revoking only the one
     * you can see leaves the others working — which is the difference between responding to an
     * incident and appearing to.
     */
    const a = await createSession(database.db, { userId: USER, organizationId: ORG });
    const b = await createSession(database.db, { userId: USER, organizationId: ORG });

    expect(await revokeAllForUser(database.db, USER, 'SECURITY_EVENT')).toBe(2);
    expect(await touchSession(database.db, a.id)).toBeUndefined();
    expect(await touchSession(database.db, b.id)).toBeUndefined();
  });

  it('counts only the sessions it actually revoked', async () => {
    const a = await createSession(database.db, { userId: USER, organizationId: ORG });
    await createSession(database.db, { userId: USER, organizationId: ORG });
    await revokeSession(database.db, a.id, 'LOGOUT');

    expect(await revokeAllForUser(database.db, USER, 'SECURITY_EVENT')).toBe(1);
  });
});

describe('unknown sessions', () => {
  it('resolve to nothing rather than throwing', async () => {
    // A forged or stale cookie is the ordinary case, not an exception. Throwing here would turn
    // every expired tab into a 500.
    expect(await touchSession(database.db, '33333333-3333-4333-8333-333333333333')).toBeUndefined();
  });
});

describe('purging ended sessions', () => {
  it('removes sessions that expired before the cutoff and keeps live ones', async () => {
    const live = await createSession(database.db, {
      userId: USER,
      organizationId: ORG,
      now: START,
    });
    const old = await createSession(database.db, {
      userId: USER,
      organizationId: ORG,
      now: new Date('2025-01-01T00:00:00.000Z'),
    });

    const { deleted } = await purgeEndedSessions(database.db, new Date('2025-06-01T00:00:00.000Z'));

    expect(deleted).toBe(1);

    const remaining = await database.db.select().from(sessions);
    expect(remaining.map((row) => row.id)).toEqual([live.id]);
    expect(remaining.map((row) => row.id)).not.toContain(old.id);
  });
});
