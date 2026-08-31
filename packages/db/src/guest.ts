/**
 * Guest session lifecycle and account conversion.
 *
 * Contract: gap-spec §5 (guest capabilities, persistence, expiry, save conversion), §48
 * (idempotency), plan §2.3 (guest-first is a locked product principle).
 *
 * The conversion path is the delicate part. Gap-spec §5.4 requires that converting a guest project
 * to a saved account preserves the project id or a durable mapping, the intake, the imported AI
 * response, the preview, assumptions, warnings, version and timestamps — and that **"no duplicate
 * project must be created from repeated save requests"**, with concurrent double-submit explicitly
 * called out as a test case.
 *
 * Double-submit is not hypothetical here. It is the most likely moment for it in the whole product:
 * the user has just finished a long unsaved flow, clicks "Save", nothing appears to happen for a
 * second, and they click again. Losing that race means two projects, or worse, a half-converted one.
 */

import { and, eq, inArray, isNull, lt } from 'drizzle-orm';
import { AppError } from '@govintel/shared/errors';
import type { Database } from './client.ts';
import { guestSessions, projects, type GuestSession, type Project } from './schema.ts';

/** Default guest project lifetime. Overridden by `GUEST_PROJECT_TTL_HOURS` (gap-spec §5.3). */
export const DEFAULT_GUEST_TTL_HOURS = 72;

export interface CreateGuestSessionOptions {
  readonly ttlHours?: number;
  /** Injected so tests control time rather than sleeping. */
  readonly now?: Date;
}

export async function createGuestSession(
  db: Database,
  options: CreateGuestSessionOptions = {},
): Promise<GuestSession> {
  const ttlHours = options.ttlHours ?? DEFAULT_GUEST_TTL_HOURS;
  const now = options.now ?? new Date();
  const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);

  const [session] = await db
    .insert(guestSessions)
    .values({ createdAt: now, lastSeenAt: now, expiresAt })
    .returning();

  if (session === undefined) {
    throw new AppError({
      code: 'GUEST_SESSION_CREATE_FAILED',
      category: 'INTERNAL',
      safeMessage: 'Could not start a session. Please try again.',
    });
  }

  return session;
}

/**
 * Load a guest session, treating an expired one as absent.
 *
 * Expiry is checked here rather than left to a sweeper job. A background cleaner is eventually
 * consistent by nature, and "the row still exists because the sweeper has not run yet" is not a
 * reason to honour an expired session.
 */
export async function findActiveGuestSession(
  db: Database,
  sessionId: string,
  now: Date = new Date(),
): Promise<GuestSession | undefined> {
  const [session] = await db.select().from(guestSessions).where(eq(guestSessions.id, sessionId));

  if (session === undefined) return undefined;
  if (session.expiresAt <= now) return undefined;

  return session;
}

export interface ConversionResult {
  readonly session: GuestSession;
  readonly projects: readonly Project[];
  /** False when the session had already been converted — a replayed request, not a new conversion. */
  readonly converted: boolean;
}

/**
 * Convert a guest session's projects into an organisation, atomically and idempotently.
 *
 * Two mechanisms, because they defend different failure modes:
 *
 * 1. **`SELECT ... FOR UPDATE` on the session row.** Two concurrent conversions serialise on that
 *    lock, so the second waits for the first to commit rather than racing it. Without the lock both
 *    would read `convertedAt = null`, both would proceed, and both would create projects.
 * 2. **`convertedAt` as the idempotency marker.** Once the first transaction commits, the second
 *    observes the conversion and returns the existing result rather than repeating the work.
 *
 * The whole thing runs in one transaction: a partially-converted guest project — moved to an
 * organisation but with its intake left behind — would be worse than a failed conversion, because
 * the user would see a project that quietly lost data.
 */
export async function convertGuestSession(
  db: Database,
  input: {
    readonly guestSessionId: string;
    readonly userId: string;
    readonly organizationId: string;
    readonly now?: Date;
  },
): Promise<ConversionResult> {
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(guestSessions)
      .where(eq(guestSessions.id, input.guestSessionId))
      .for('update');

    if (session === undefined) {
      throw new AppError({
        code: 'GUEST_SESSION_NOT_FOUND',
        category: 'NOT_FOUND',
        safeMessage: 'That session has expired. Please start again.',
      });
    }

    // Already converted: return what exists. This is the replayed-request path, and it must be a
    // no-op rather than an error — the user double-clicked, they did nothing wrong.
    if (session.convertedAt !== null) {
      const existing = await tx
        .select()
        .from(projects)
        .where(eq(projects.organizationId, input.organizationId));

      return { session, projects: existing, converted: false };
    }

    if (session.expiresAt <= now) {
      throw new AppError({
        code: 'GUEST_SESSION_EXPIRED',
        category: 'NOT_FOUND',
        safeMessage: 'That session has expired. Please start again.',
      });
    }

    // Reassign in place. The project id is preserved, which gap-spec §5.4 requires — any link the
    // user already has to their preview keeps working after they sign up.
    const claimed = await tx
      .update(projects)
      .set({ organizationId: input.organizationId, guestSessionId: null, updatedAt: now })
      .where(eq(projects.guestSessionId, input.guestSessionId))
      .returning();

    const [updatedSession] = await tx
      .update(guestSessions)
      .set({ convertedToUserId: input.userId, convertedAt: now, lastSeenAt: now })
      .where(eq(guestSessions.id, input.guestSessionId))
      .returning();

    return {
      session: updatedSession ?? session,
      projects: claimed,
      converted: true,
    };
  });
}

/**
 * Delete expired, unconverted guest sessions and their projects.
 *
 * Gap-spec §5.3 requires automatic expiry; §38 requires a stated retention policy. Converted
 * sessions are kept: their `convertedToUserId` is the audit link explaining where a project came
 * from, and deleting it would sever the provenance of every project created through the guest flow.
 */
export async function purgeExpiredGuestSessions(
  db: Database,
  now: Date = new Date(),
): Promise<{ readonly sessionsDeleted: number; readonly projectsDeleted: number }> {
  return db.transaction(async (tx) => {
    const expired = await tx
      .select({ id: guestSessions.id })
      .from(guestSessions)
      .where(and(lt(guestSessions.expiresAt, now), isNull(guestSessions.convertedAt)));

    if (expired.length === 0) return { sessionsDeleted: 0, projectsDeleted: 0 };

    const ids = expired.map((row) => row.id);

    // `inArray` rather than a hand-written `= ANY(...)`: Drizzle binds a JS array as one parameter,
    // which Postgres reads as a malformed array literal.
    const deletedProjects = await tx
      .delete(projects)
      .where(inArray(projects.guestSessionId, ids))
      .returning({ id: projects.id });

    const deletedSessions = await tx
      .delete(guestSessions)
      .where(inArray(guestSessions.id, ids))
      .returning({ id: guestSessions.id });

    return {
      sessionsDeleted: deletedSessions.length,
      projectsDeleted: deletedProjects.length,
    };
  });
}

/** Refresh the activity timestamp. Does not extend expiry — a guest project is time-boxed. */
export async function touchGuestSession(
  db: Database,
  sessionId: string,
  now: Date = new Date(),
): Promise<void> {
  await db.update(guestSessions).set({ lastSeenAt: now }).where(eq(guestSessions.id, sessionId));
}
