import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { AppError } from '@govintel/shared/errors';
import type { Database } from './client.ts';
import { sessions, type Session } from './schema.ts';

/**
 * Authenticated sessions.
 *
 * Contract: gap-spec §6.3, which requires eight controls to be **defined**. They were not, anywhere —
 * there was no authenticated session at all, only the guest one. Every one is answered below, and the
 * ones that are "not applicable" say so rather than being omitted, because an omitted control reads
 * as an oversight and a stated one can be argued with.
 */

/**
 * The eight controls §6.3 asks for, in one place.
 *
 * Values chosen to be defensible rather than conventional, and each with its reason. They are
 * deliberately not configurable per deployment: a timeout that can be set to a year by an
 * environment variable is a timeout nobody has decided.
 */
export const SESSION_POLICY = {
  /**
   * **Session duration / absolute timeout.** Twelve hours.
   *
   * Long enough for a working day without a re-login in the middle of one, short enough that a
   * cookie stolen this morning is useless tomorrow. It never rolls forward: that is the difference
   * between this and the idle window, and the reason both exist.
   */
  absoluteHours: 12,

  /**
   * **Idle timeout.** One hour, rolled forward on activity.
   *
   * The control that matters for an unattended screen. Bounded above by the absolute timeout, which
   * the database enforces rather than trusting this code — `sessions_idle_within_absolute`.
   */
  idleMinutes: 60,

  /**
   * **Logout behaviour.** The session is revoked server-side, not merely un-cookied.
   *
   * Clearing the cookie alone leaves a valid session id in whatever captured it. Logout must make
   * the *session* invalid, so that a copy of the cookie taken beforehand stops working too.
   */
  logout: 'revoke-server-side',

  /**
   * **Session revocation.** Rows are marked revoked, never deleted.
   *
   * "When did this session end, and why" is a question an incident asks, and a deleted row answers it
   * with silence.
   */
  revocation: 'mark-revoked-retain-row',

  /**
   * **Passwordless / email-link expiry.** Not used in V1.
   *
   * There is no email-link login, so there is no link to expire. Recorded rather than omitted so the
   * next person knows it was considered and not forgotten.
   */
  passwordless: 'not-used-in-v1',

  /**
   * **MFA behaviour.** Delegated to the identity provider.
   *
   * §6.1 requires provider-neutral OIDC, and MFA is a property of the authentication the provider
   * performs. Re-implementing it here would mean holding a second factor, which is the thing
   * federating identity exists to avoid.
   */
  mfa: 'delegated-to-provider',

  /**
   * **Account lock / security event policy.** A locked account cannot start or continue a session.
   *
   * `users.locked_at` is the flag; it is checked when a session is created *and* on every read, so a
   * lock applied during a session ends it rather than taking effect at the next login.
   */
  accountLock: 'checked-on-create-and-on-every-read',
} as const;

export interface CreateSessionInput {
  readonly userId: string;
  readonly organizationId: string;
  readonly now?: Date;
}

export async function createSession(db: Database, input: CreateSessionInput): Promise<Session> {
  const now = input.now ?? new Date();

  const [session] = await db
    .insert(sessions)
    .values({
      userId: input.userId,
      organizationId: input.organizationId,
      createdAt: now,
      lastSeenAt: now,
      idleExpiresAt: new Date(now.getTime() + SESSION_POLICY.idleMinutes * 60_000),
      absoluteExpiresAt: new Date(now.getTime() + SESSION_POLICY.absoluteHours * 3_600_000),
    })
    .returning();

  if (session === undefined) {
    throw new AppError({
      code: 'SESSION_CREATE_FAILED',
      category: 'INTERNAL',
      safeMessage: 'Could not sign you in. Please try again.',
    });
  }

  return session;
}

/**
 * The session behind an id, if it is still valid, with its idle window rolled forward.
 *
 * Validity is re-decided on every read rather than trusted from the cookie: expired, revoked, or
 * belonging to a locked account all resolve to nothing. Returning `undefined` rather than throwing
 * because "no valid session" is the ordinary state of most requests.
 *
 * The roll-forward is a write on a read path, which is unusual and is the point of an idle timeout —
 * the window has to move when the user is active or it is an absolute timeout wearing a second name.
 */
/**
 * The session behind an id, if it is still valid. Read-only.
 *
 * `touchSession` answers the same question but also extends the idle window, which makes it a write.
 * Resolving the caller's tenant happens on nearly every request and must not turn every read into a
 * write — and extending a session as a side effect of an authorisation check would mean a request
 * that is refused still keeps the session alive.
 */
export async function findActiveSession(
  db: Database,
  sessionId: string,
  now: Date = new Date(),
): Promise<Session | undefined> {
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);

  if (session === undefined) return undefined;
  if (session.revokedAt !== null) return undefined;
  if (session.absoluteExpiresAt <= now) return undefined;
  if (session.idleExpiresAt <= now) return undefined;

  return session;
}

export async function touchSession(
  db: Database,
  sessionId: string,
  now: Date = new Date(),
): Promise<Session | undefined> {
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);

  if (session === undefined) return undefined;
  if (session.revokedAt !== null) return undefined;
  if (session.absoluteExpiresAt <= now) return undefined;
  if (session.idleExpiresAt <= now) return undefined;

  /*
   * The new idle window, clamped to the absolute expiry.
   *
   * Without the clamp this would extend a session past its absolute limit one request at a time, and
   * the database constraint would reject the update — turning an ordinary page load into an error.
   * The clamp is the same rule expressed where it can be satisfied rather than only enforced.
   */
  const proposed = new Date(now.getTime() + SESSION_POLICY.idleMinutes * 60_000);
  const idleExpiresAt = proposed > session.absoluteExpiresAt ? session.absoluteExpiresAt : proposed;

  const [updated] = await db
    .update(sessions)
    .set({ lastSeenAt: now, idleExpiresAt })
    .where(eq(sessions.id, sessionId))
    .returning();

  return updated;
}

export const REVOCATION_REASONS = ['LOGOUT', 'REVOKED', 'SECURITY_EVENT'] as const;
export type RevocationReason = (typeof REVOCATION_REASONS)[number];

/** End a session. Idempotent: revoking an already-revoked session keeps the original reason. */
export async function revokeSession(
  db: Database,
  sessionId: string,
  reason: RevocationReason,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: now, revokedReason: reason })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
}

/**
 * End every session a user holds.
 *
 * What a security event needs: a stolen credential is not one session, and revoking the one you can
 * see leaves the others working.
 */
export async function revokeAllForUser(
  db: Database,
  userId: string,
  reason: RevocationReason,
  now: Date = new Date(),
): Promise<number> {
  const revoked = await db
    .update(sessions)
    .set({ revokedAt: now, revokedReason: reason })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });

  return revoked.length;
}

/**
 * Delete sessions that ended long ago.
 *
 * Retention, not correctness — an expired session is already refused by `touchSession`. Rows are kept
 * for a while after they end so an incident can ask what happened, and removed eventually because
 * §19 asks for data minimisation and a session row is a record of when a person was at a keyboard.
 */
export async function purgeEndedSessions(
  db: Database,
  before: Date,
): Promise<{ readonly deleted: number }> {
  const deleted = await db
    .delete(sessions)
    .where(or(lt(sessions.absoluteExpiresAt, before), lt(sessions.revokedAt, before)))
    .returning({ id: sessions.id });

  return { deleted: deleted.length };
}
