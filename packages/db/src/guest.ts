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

import { randomUUID } from 'node:crypto';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { AppError } from '@govintel/shared/errors';
import { applyTenantScope, type Database } from './client.ts';
import {
  auditEvents,
  guestSessions,
  organizations,
  projects,
  type GuestSession,
  type Project,
} from './schema.ts';

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

  /*
   * The session's own organisation, created first because the session references it.
   *
   * A guest is a tenant of one. Without this the guest's rows carry no `organization_id`, and row-
   * level security — which keys on exactly that — covers none of them. See `projects.organizationId`
   * in the schema for what that cost.
   *
   * The name and slug are deliberately unmistakable. Anything that reads like a real organisation
   * name invites somebody to treat one of these as a customer record; `guest-<uuid>` cannot be
   * mistaken for one, and the slug is unique without needing a lookup.
   */
  const [organization] = await db
    .insert(organizations)
    .values({ name: 'Guest session', slug: `guest-${randomUUID()}`, createdAt: now })
    .returning({ id: organizations.id });

  if (organization === undefined) {
    throw new AppError({
      code: 'GUEST_SESSION_CREATE_FAILED',
      category: 'INTERNAL',
      safeMessage: 'Could not start a session. Please try again.',
    });
  }

  const [session] = await db
    .insert(guestSessions)
    .values({ organizationId: organization.id, createdAt: now, lastSeenAt: now, expiresAt })
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
 *
 * ## The audit events go too, and that is the whole reason this function changed
 *
 * `audit_events.project_id` is ON DELETE RESTRICT, so a project that produced even one audit event
 * could not be deleted. A guest who records evidence, advances the lifecycle, imports an AI response
 * or raises a change request produces one — and this sweep deletes every expired session in a single
 * transaction, so one such project would have failed the whole batch. Every minute. Forever, since
 * the offending row never goes away on its own.
 *
 * The symptom would have been a log line (`guest session purge failed`) and guest data quietly
 * retained past its stated 72 hours, which is the failure §5.2 exists to prevent and the least
 * visible way to have it.
 *
 * Deleting them is also the right answer rather than merely the available one. §40 permits append,
 * query and retention, and forbids updating an event or deleting an individual one; a retention
 * sweep removing a whole expired tenant is exactly the case it allows. Keeping the events while
 * deleting the project would keep a record of what a guest did — with its safe before/after summary
 * — in a table nobody can delete, which is storing guest data permanently by another route.
 *
 * Scoped by organisation rather than by project, because a guest session owns an organisation of its
 * own (KI-063) and an event may be organisation-scoped with no project. Both are the same guest.
 */
export async function purgeExpiredGuestSessions(
  db: Database,
  now: Date = new Date(),
): Promise<{
  readonly sessionsDeleted: number;
  readonly projectsDeleted: number;
  readonly auditEventsDeleted: number;
  /** Sessions whose deletion failed. Each fails alone; the rest of the sweep still runs. */
  readonly sessionsFailed: number;
}> {
  const expired = await db
    .select({ id: guestSessions.id, organizationId: guestSessions.organizationId })
    .from(guestSessions)
    .where(and(lt(guestSessions.expiresAt, now), isNull(guestSessions.convertedAt)));

  let sessionsDeleted = 0;
  let projectsDeleted = 0;
  let auditEventsDeleted = 0;
  let sessionsFailed = 0;

  /*
   * One transaction per guest, each inside that guest's own tenant scope.
   *
   * ## Why scoped
   *
   * The Worker connects as the restricted role, and every table holding a guest's work — projects,
   * the twin, evidence, audit events — forces row-level security. The sweep used to run all of this
   * *unscoped*, and unscoped, those tables are empty: the deletes of `audit_events` and `projects`
   * matched nothing. Deleting the organisation then cascaded into projects (referential actions are
   * not subject to row security), met the audit events it could not see through `ON DELETE
   * RESTRICT`, and failed. The suite never saw it because PGlite runs its tests as a superuser, for
   * whom row-level security does not exist.
   *
   * `applyTenantScope` is the same call the request layer makes, so the sweep deletes exactly what
   * that guest could have read and nothing another tenant owns — the policy does the scoping, not a
   * `WHERE` clause somebody could widen.
   *
   * ## Why one transaction each
   *
   * A single transaction meant a single undeletable guest failed the sweep for everyone, on every
   * run, for as long as the row existed. Now it fails alone, is counted, and is retried next time.
   */
  for (const session of expired) {
    try {
      const counts = await db.transaction(async (tx) => {
        await applyTenantScope(tx, session.organizationId);

        /*
         * `SET LOCAL`, not `SET`: the permission ends with the transaction. A connection-scoped
         * setting would survive into whatever runs next on the same pooled connection.
         */
        await tx.execute(sql`SET LOCAL govintel.audit_retention = 'on'`);

        const deletedAudit = await tx
          .delete(auditEvents)
          .where(eq(auditEvents.organizationId, session.organizationId))
          .returning({ id: auditEvents.id });

        const deletedProjects = await tx
          .delete(projects)
          .where(eq(projects.guestSessionId, session.id))
          .returning({ id: projects.id });

        await tx.delete(guestSessions).where(eq(guestSessions.id, session.id));

        /*
         * The organisation last, once nothing points at it. Left behind it is an empty tenant that
         * outlives the data it existed to scope, still carrying the key of something deleted.
         */
        await tx.delete(organizations).where(eq(organizations.id, session.organizationId));

        return { audit: deletedAudit.length, projects: deletedProjects.length };
      });

      sessionsDeleted += 1;
      projectsDeleted += counts.projects;
      auditEventsDeleted += counts.audit;
    } catch {
      sessionsFailed += 1;
    }
  }

  return { sessionsDeleted, projectsDeleted, auditEventsDeleted, sessionsFailed };
}

/** Refresh the activity timestamp. Does not extend expiry — a guest project is time-boxed. */
export async function touchGuestSession(
  db: Database,
  sessionId: string,
  now: Date = new Date(),
): Promise<void> {
  await db.update(guestSessions).set({ lastSeenAt: now }).where(eq(guestSessions.id, sessionId));
}
