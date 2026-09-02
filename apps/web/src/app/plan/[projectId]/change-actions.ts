'use server';

import { and, desc, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { changeRequests, projects, twinNodes } from '@govintel/db/schema';
import { graphFromRows } from '@govintel/twin/repository';
import { apply, plan, type ChangeRequest } from '@govintel/change/request';
import type { ChangedNode } from '@govintel/change/impact';
import { toAppError } from '@govintel/shared/errors';
import { logger } from '@govintel/shared/logging';
import { withDatabase } from '../../../lib/server/database.ts';
import { accessibleProject, type ProjectAccess } from '../../../lib/server/project-access.ts';
import { recordAudit } from '../../../lib/server/audit.ts';
import { checkRateLimit } from '../../../lib/server/rate-limit.ts';
import { loadPlanRows } from './actions.ts';

/**
 * Requesting, deciding and applying a change.
 *
 * Contract: gap-spec §27 (impact propagation), §28 (the ten-step change sequence), §85 ("manage
 * changes" is a V1 success criterion), plan §24 screen 35.
 *
 * ## What this connects
 *
 * `packages/change` has modelled every part of this since Phase 12 — the six-state machine, the
 * deny-by-default propagation, the §28 concurrency check, the segregation-of-duties rule — and had
 * no table and no route, so approve, reject and apply were unreachable from the product. The change
 * page was a preview with nothing behind it.
 *
 * Nothing here re-implements a decision the engine already makes. Every refusal below comes back
 * from `plan()` or `apply()` and is shown to the user in the engine's own words, because those words
 * explain *why* the rule exists and a message written here would explain only that it fired.
 */

type Outcome = { kind: 'ok'; requestId: string } | { kind: 'refused'; reason: string };

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

/** Who is acting, in the column the audit table expects. */
function actorOf(access: ProjectAccess): { actorUserId: string } | { actorGuestSessionId: string } {
  return access.userId === null
    ? { actorGuestSessionId: access.guestSessionId ?? '' }
    : { actorUserId: access.userId };
}

/* -------------------------------------------------------------------------- */
/* Requesting                                                                 */
/* -------------------------------------------------------------------------- */

export async function requestChange(formData: FormData): Promise<void> {
  const projectId = readString(formData, 'projectId');
  if (projectId.length === 0) redirect('/start');

  if (!(await checkRateLimit('project-transition'))) {
    redirect(`/plan/${projectId}/change?error=rate-limited`);
  }

  const outcome = await createRequest(projectId, formData);

  revalidatePath(`/plan/${projectId}/change`);

  if (outcome.kind === 'refused') {
    redirect(`/plan/${projectId}/change?error=${encodeURIComponent(outcome.reason)}`);
  }

  redirect(`/plan/${projectId}/change?requested=${outcome.requestId}`);
}

async function createRequest(projectId: string, formData: FormData): Promise<Outcome> {
  try {
    const access = await accessibleProject(projectId);
    if (access === null) return { kind: 'refused', reason: 'not-found' };

    const { project } = access;
    if (project.archivedAt !== null) return { kind: 'refused', reason: 'archived' };

    const title = readString(formData, 'title');
    const rationale = readString(formData, 'rationale');
    const nodeIds = formData.getAll('nodeId').filter((v): v is string => typeof v === 'string');
    const summary = readString(formData, 'summary');

    if (title.length === 0) return { kind: 'refused', reason: 'title-required' };

    const loaded = await loadPlanRows(projectId);
    if (loaded === null) return { kind: 'refused', reason: 'not-found' };

    const graph = graphFromRows(projectId, loaded.nodes, loaded.edges);

    /*
     * The kind is asked for, not assumed.
     *
     * `COSMETIC` exists precisely so renaming a requirement does not invalidate its test suite, and
     * defaulting everything to `MATERIAL` would make every impact report a wall of consequences that
     * nobody believes. Anything unrecognised is treated as material, because under-stating a change
     * is the dangerous direction.
     */
    const declaredKind = readString(formData, 'kind');
    const kind: ChangedNode['kind'] =
      declaredKind === 'COSMETIC' || declaredKind === 'WITHDRAWAL' || declaredKind === 'ADDITION'
        ? declaredKind
        : 'MATERIAL';

    const changes: ChangedNode[] = nodeIds.map((nodeId) => ({
      nodeId,
      kind,
      summary: summary === '' ? title : summary,
    }));

    /*
     * The impact is calculated now and stored, not calculated when somebody opens the page.
     *
     * §28 step 5 compares the version the impact was calculated against with the version at apply
     * time, and that comparison is meaningless if the report is recomputed on every read — it would
     * always agree with itself, and the check would silently pass for ever.
     */
    const draft: ChangeRequest = {
      id: crypto.randomUUID(),
      projectId,
      title,
      rationale,
      state: 'DRAFT',
      changes,
      baseVersion: project.version,
      requestedBy: access.actor,
    };

    const planned = plan(graph, draft, project.version);

    // The engine's own words. It explains why the rule exists; a message written here would say only
    // that something was refused.
    if (!planned.ok) return { kind: 'refused', reason: planned.refusal };

    await withDatabase(async (db) => {
      await db.insert(changeRequests).values({
        id: draft.id,
        organizationId: project.organizationId,
        projectId,
        title,
        rationale,
        state: 'PENDING_APPROVAL',
        changes: changes as unknown[],
        impact: planned.value as unknown as Record<string, unknown>,
        baseVersion: project.version,
        requestedBy: access.actor,
      });

      await recordAudit(db, {
        organizationId: project.organizationId,
        projectId,
        action: 'CHANGE_REQUESTED',
        entityType: 'CHANGE_REQUEST',
        entityId: draft.id,
        ...actorOf(access),
        summary: {
          title,
          baseVersion: project.version,
          changedNodes: changes.length,
          requiresApproval: planned.value.requiresApproval,
          impactedNodes: planned.value.markings.length,
        },
      });
    });

    logger.info('change requested', { projectId, requestId: draft.id });
    return { kind: 'ok', requestId: draft.id };
  } catch (error) {
    logger.error('failed to request a change', { err: toAppError(error), projectId });
    return { kind: 'refused', reason: 'failed' };
  }
}

/* -------------------------------------------------------------------------- */
/* Deciding                                                                   */
/* -------------------------------------------------------------------------- */

export async function decideChange(formData: FormData): Promise<void> {
  const projectId = readString(formData, 'projectId');
  const requestId = readString(formData, 'requestId');
  const decision = readString(formData, 'decision');

  if (projectId.length === 0 || requestId.length === 0) redirect('/start');

  const outcome = await decide(projectId, requestId, decision, readString(formData, 'reason'));

  revalidatePath(`/plan/${projectId}/change`);

  if (outcome.kind === 'refused') {
    redirect(`/plan/${projectId}/change?error=${encodeURIComponent(outcome.reason)}`);
  }

  redirect(`/plan/${projectId}/change?decided=${requestId}`);
}

async function decide(
  projectId: string,
  requestId: string,
  decision: string,
  reason: string,
): Promise<Outcome> {
  try {
    if (decision !== 'APPROVED' && decision !== 'REJECTED') {
      return { kind: 'refused', reason: 'unknown-decision' };
    }

    // A decision with no reason is a signature with no argument behind it.
    if (reason === '') return { kind: 'refused', reason: 'reason-required' };

    const access = await accessibleProject(projectId);
    if (access === null) return { kind: 'refused', reason: 'not-found' };

    const { project } = access;

    const [row] = await withDatabase((db) =>
      db
        .select()
        .from(changeRequests)
        .where(and(eq(changeRequests.id, requestId), eq(changeRequests.projectId, projectId)))
        .limit(1),
    );

    if (row === undefined) return { kind: 'refused', reason: 'not-found' };
    if (row.state !== 'PENDING_APPROVAL') return { kind: 'refused', reason: 'already-decided' };

    /*
     * Whether this change needs somebody's approval at all.
     *
     * Read from the stored impact report, which is where the engine decided it. A change that
     * invalidates something already decided needs a second person; one that invalidates nothing does
     * not, and demanding an approver for it would make the whole feature unreachable for anybody
     * working alone — which is the product's main mode.
     */
    const storedPlan = row.impact as { requiresApproval?: boolean } | null;
    const needsApprover = storedPlan?.requiresApproval === true;

    /*
     * Segregation of duties, refused here as well as by the database constraint.
     *
     * Self-approval records a decision with nobody independent behind it, which is worse than no
     * approval: the record looks complete. Refused in the application so the user gets a sentence
     * rather than a constraint violation.
     */
    if (decision === 'APPROVED' && needsApprover && row.requestedBy === access.actor) {
      return { kind: 'refused', reason: 'APPROVER_IS_REQUESTER' };
    }

    await withDatabase(async (db) => {
      await db
        .update(changeRequests)
        .set({
          state: decision,
          decisionReason: reason,
          /*
           * A name goes on it only when an approval was required.
           *
           * Recording the requester as the approver for a change that needed no approval would put a
           * signature on a decision nobody made — and it would trip the engine's own
           * self-approval check at apply time, refusing a change that was never in question.
           */
          ...(decision === 'APPROVED' && needsApprover ? { approvedBy: access.actor } : {}),
          updatedAt: new Date(),
        })
        // Guarded on the state we read, so two people deciding at once cannot both win.
        .where(and(eq(changeRequests.id, requestId), eq(changeRequests.state, 'PENDING_APPROVAL')));

      await recordAudit(db, {
        organizationId: project.organizationId,
        projectId,
        action: decision === 'APPROVED' ? 'CHANGE_APPROVED' : 'CHANGE_REJECTED',
        entityType: 'CHANGE_REQUEST',
        entityId: requestId,
        ...actorOf(access),
        summary: { title: row.title, decision, reason },
      });
    });

    logger.info('change decided', { projectId, requestId, decision });
    return { kind: 'ok', requestId };
  } catch (error) {
    logger.error('failed to decide a change', { err: toAppError(error), requestId });
    return { kind: 'refused', reason: 'failed' };
  }
}

/* -------------------------------------------------------------------------- */
/* Applying                                                                   */
/* -------------------------------------------------------------------------- */

export async function applyChange(formData: FormData): Promise<void> {
  const projectId = readString(formData, 'projectId');
  const requestId = readString(formData, 'requestId');

  if (projectId.length === 0 || requestId.length === 0) redirect('/start');

  const outcome = await applyRequest(projectId, requestId);

  revalidatePath(`/plan/${projectId}/change`);
  revalidatePath(`/plan/${projectId}`);

  if (outcome.kind === 'refused') {
    redirect(`/plan/${projectId}/change?error=${encodeURIComponent(outcome.reason)}`);
  }

  redirect(`/plan/${projectId}/change?applied=${requestId}`);
}

async function applyRequest(projectId: string, requestId: string): Promise<Outcome> {
  try {
    const access = await accessibleProject(projectId);
    if (access === null) return { kind: 'refused', reason: 'not-found' };

    const { project } = access;

    const [row] = await withDatabase((db) =>
      db
        .select()
        .from(changeRequests)
        .where(and(eq(changeRequests.id, requestId), eq(changeRequests.projectId, projectId)))
        .limit(1),
    );

    if (row === undefined) return { kind: 'refused', reason: 'not-found' };

    const request: ChangeRequest = {
      id: row.id,
      projectId,
      title: row.title,
      rationale: row.rationale,
      state: row.state as ChangeRequest['state'],
      changes: row.changes as ChangedNode[],
      baseVersion: row.baseVersion,
      requestedBy: row.requestedBy,
      ...(row.approvedBy === null ? {} : { approvedBy: row.approvedBy }),
      ...(row.decisionReason === null ? {} : { decisionReason: row.decisionReason }),
    };

    /*
     * The stored impact report, not a fresh one.
     *
     * This is the report the approver saw and approved. Recalculating it here would silently approve
     * something nobody read — and would make §28's concurrency check compare a version against
     * itself, so it could never fail.
     */
    const storedPlan = row.impact as unknown as Parameters<typeof apply>[1] | null;

    if (storedPlan === null) return { kind: 'refused', reason: 'no-impact-recorded' };

    const applied = apply(request, storedPlan, project.version);

    if (!applied.ok) {
      logger.warn('refused to apply a change', { requestId, refusal: applied.refusal });

      /*
       * A stale request is marked, not left looking applicable.
       *
       * §28: the project moved on, so this is not rejected — nobody decided against it — and it can
       * no longer be applied, because the impact was calculated against a project that no longer
       * exists. Leaving it PENDING would offer an apply button that can never succeed.
       */
      if (applied.refusal === 'STALE_BASE_VERSION') {
        await withDatabase((db) =>
          db
            .update(changeRequests)
            .set({ state: 'SUPERSEDED', updatedAt: new Date() })
            .where(eq(changeRequests.id, requestId)),
        );
      }

      return { kind: 'refused', reason: applied.refusal };
    }

    await withDatabase(async (db) => {
      /*
       * The staleness markings, the new version and the audit, in one transaction.
       *
       * Splitting them would allow a project whose nodes are marked stale by a change that is not
       * recorded as applied, which is unrecoverable from the outside: nothing would say why the
       * markings are there.
       */
      /*
       * Staleness goes in `attributes`, not in `state`.
       *
       * `state` is the node's own lifecycle (ACTIVE, SUPERSEDED); staleness is a statement about
       * whether what it says still holds after something it depends on changed. Writing one into
       * the other would make a stale-but-active node indistinguishable from a withdrawn one.
       */
      for (const marking of applied.value.plan.markings) {
        const [current] = await db
          .select({ attributes: twinNodes.attributes })
          .from(twinNodes)
          .where(and(eq(twinNodes.projectId, projectId), eq(twinNodes.id, marking.nodeId)))
          .limit(1);

        if (current === undefined) continue;

        await db
          .update(twinNodes)
          .set({
            attributes: { ...current.attributes, staleness: marking.staleness },
            updatedAt: new Date(),
          })
          .where(and(eq(twinNodes.projectId, projectId), eq(twinNodes.id, marking.nodeId)));
      }

      const bumped = await db
        .update(projects)
        .set({ version: applied.value.newVersion, updatedAt: new Date() })
        // Optimistic concurrency, the same guard the lifecycle transition uses.
        .where(and(eq(projects.id, projectId), eq(projects.version, project.version)))
        .returning({ id: projects.id });

      if (bumped.length === 0) throw new Error('project version moved during apply');

      await db
        .update(changeRequests)
        .set({ state: 'APPLIED', updatedAt: new Date() })
        .where(and(eq(changeRequests.id, requestId), eq(changeRequests.state, 'APPROVED')));

      for (const event of applied.value.auditEvents) {
        await recordAudit(db, {
          organizationId: project.organizationId,
          projectId,
          action: event.kind,
          entityType: 'CHANGE_REQUEST',
          entityId: event.subjectId,
          ...actorOf(access),
          summary: { detail: event.detail, requestId },
        });
      }
    });

    logger.info('change applied', {
      projectId,
      requestId,
      newVersion: applied.value.newVersion,
      marked: applied.value.plan.markings.length,
    });

    return { kind: 'ok', requestId };
  } catch (error) {
    logger.error('failed to apply a change', { err: toAppError(error), requestId });
    return { kind: 'refused', reason: 'failed' };
  }
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

/** Every change request on a project, newest first, for the change page. */
export async function changeRequestsFor(projectId: string) {
  const access = await accessibleProject(projectId);
  if (access === null) return null;

  const rows = await withDatabase((db) =>
    db
      .select()
      .from(changeRequests)
      .where(eq(changeRequests.projectId, projectId))
      .orderBy(desc(changeRequests.createdAt))
      .limit(50),
  );

  /*
   * `requiresApproval` is lifted out of the stored report so the page does not have to reach into a
   * jsonb blob to decide what controls to show.
   */
  const withApproval = rows.map((row) => ({
    ...row,
    requiresApproval:
      (row.impact as { requiresApproval?: boolean } | null)?.requiresApproval === true,
  }));

  return { rows: withApproval, actor: access.actor, projectVersion: access.project.version };
}
