import 'server-only';

import { eq } from 'drizzle-orm';
import { projects } from '@govintel/db/schema';
import { withDatabase } from './database.ts';
import { readActiveGuestSessionId } from './session.ts';
import { currentUser } from './auth.ts';

/**
 * Who may open a project.
 *
 * Contract: gap-spec §5.4 and §88 (guest-to-account conversion keeps the same project and the same
 * link), §7 (tenant isolation), plan §32.12 (an unknown id and a forbidden one are indistinguishable).
 *
 * ## The defect this exists to fix
 *
 * Twelve places asked the same question in the same way, and all twelve asked it wrong:
 *
 * ```ts
 * if (project?.guestSessionId == null || project.guestSessionId !== sessionId) return null;
 * ```
 *
 * A project that has been claimed by an account has `guest_session_id` set to NULL — that is what
 * claiming it means. So every one of those checks refused it, and **signing in made your work
 * disappear**: `convertGuestSession` moved the project onto the account correctly, and the next page
 * load returned 404. The conversion's own comment claimed "any link the user already has to their
 * preview keeps working after they sign up", which was exactly backwards.
 *
 * Nothing caught it because there was no end-to-end sign-in journey — the unit tests for
 * `convertGuestSession` proved the rows moved, and moving the rows was never the part in doubt.
 *
 * ## The rule
 *
 * A caller may open a project if **either** is true:
 *
 * - it still belongs to their guest session, or
 * - they are signed in and it belongs to their organisation.
 *
 * Not "or they are signed in": the organisation must match. Guest sessions own an organisation of
 * their own (KI-063), so an organisation is a real tenant boundary in both cases and this is one
 * check rather than two that happen to agree.
 */

export interface ProjectAccess {
  readonly project: typeof projects.$inferSelect;
  /** The guest session that owns it, if it is still a guest project. */
  readonly guestSessionId: string | null;
  readonly userId: string | null;
  readonly organizationId: string;
  /**
   * Who to attribute a change to.
   *
   * The signed-in user when there is one, otherwise the guest session. Audit rows and evidence
   * records both need an actor, and "whoever is acting" is a different question from "who owns
   * this".
   */
  readonly actor: string;
}

/**
 * Whether this caller may open a project they have already loaded.
 *
 * The same rule as `accessibleProject`, for the several places that fetch the row themselves because
 * they need other things in the same query. Sharing the *decision* matters more than sharing the
 * query: the twelve copies of this check did not drift from one another, they were all wrong
 * together, and one place to be wrong is one place to fix.
 */
export async function mayOpen(project: {
  readonly guestSessionId: string | null;
  readonly organizationId: string;
}): Promise<boolean> {
  const [guestSessionId, user] = await Promise.all([readActiveGuestSessionId(), currentUser()]);

  // `guestSessionId` may be undefined and `project.guestSessionId` null; comparing them directly
  // would make a project with no guest session match a caller with no guest session.
  if (guestSessionId !== undefined && project.guestSessionId === guestSessionId) return true;

  return user?.organizationId === project.organizationId;
}

/**
 * The project, if this caller may open it. `null` otherwise — never a distinguishable refusal.
 *
 * `null` covers "no such project" and "not yours" alike, because a 403 confirms the project exists
 * and that is a disclosure in itself (plan §32.12).
 */
export async function accessibleProject(projectId: string): Promise<ProjectAccess | null> {
  /*
   * A malformed id is a miss, not a crash. `projectId` comes from the URL, and Postgres raises on an
   * invalid uuid literal rather than returning no rows — which would turn a typo into a 500 and,
   * worse, make a malformed id distinguishable from a well-formed one that is not yours.
   */
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)) {
    return null;
  }

  const [guestSessionId, user] = await Promise.all([readActiveGuestSessionId(), currentUser()]);

  const [project] = await withDatabase((db) =>
    db.select().from(projects).where(eq(projects.id, projectId)).limit(1),
  );

  if (project === undefined) return null;

  const asGuest = guestSessionId !== undefined && project.guestSessionId === guestSessionId;

  const asMember = user?.organizationId === project.organizationId;

  if (!asGuest && !asMember) return null;

  return {
    project,
    guestSessionId: project.guestSessionId,
    userId: user?.userId ?? null,
    organizationId: project.organizationId,
    actor: user?.userId ?? guestSessionId ?? 'unknown',
  };
}
