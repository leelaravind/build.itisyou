'use server';

import { and, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { projects, twinEdges, twinNodes } from '@govintel/db/schema';
import { graphFromRows } from '@govintel/twin/repository';
import { evaluateGates } from '@govintel/rules/gates';
import { evaluateForProject, loadIntake } from '../../../lib/server/project-rules.ts';
import {
  evaluateTransition,
  transitionsFrom,
  type GateReadiness,
  type LifecycleState,
} from '@govintel/governance/lifecycle';
import type { Approval } from '@govintel/governance/approval';
import { toAppError } from '@govintel/shared/errors';
import { logger } from '@govintel/shared/logging';
import { withDatabase } from '../../../lib/server/database.ts';
import { recordAudit } from '../../../lib/server/audit.ts';
import { checkRateLimit } from '../../../lib/server/rate-limit.ts';
import { accessibleProject, mayOpen } from '../../../lib/server/project-access.ts';

/**
 * Moving a project through its lifecycle.
 *
 * Contract: plan §6 (*"No arbitrary state changes. Transitions must be centrally validated."*),
 * gap-spec §49 (optimistic concurrency), plan §20 (immutable audit).
 *
 * ## What this closes
 *
 * Four gaps that turn out to be one piece of work, because a transition is the thing that needs all
 * four:
 *
 * - **No lifecycle transition existed anywhere.** `projects.lifecycle_state` has defaulted to `IDEA`
 *   since Phase 3 and nothing ever wrote it. Every project was permanently an idea.
 * - **`projects.version` was never incremented**, though its comment claimed it was "incremented on
 *   every material mutation". That made §49's optimistic concurrency inert *and* §33's approval
 *   staleness inert, because both compare against a number that never moved.
 * - **No audit event was ever written.** The table, its RLS policy and its indexes all existed.
 * - **Optimistic concurrency was unenforced**, so two concurrent transitions would both succeed and
 *   the second would silently overwrite the first.
 *
 * ## The shape
 *
 * Decide outside the transaction, write inside one. The decision needs the twin graph and the gate
 * evaluation, which are reads; the write needs to be atomic with its audit row and guarded against a
 * concurrent writer. Holding a transaction open across the gate evaluation would serialise every
 * transition behind the slowest one for no benefit — the `WHERE version = ?` is what makes the
 * decision safe to have been made a moment ago.
 */

/** A form value that is genuinely a string. `FormData.get` also returns `File`. */
function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

export async function transitionProject(formData: FormData): Promise<void> {
  const projectId = readString(formData, 'projectId');
  const to = readString(formData, 'to') as LifecycleState;

  if (projectId.length === 0) redirect('/start');

  /*
   * Rate limited like every other write an unauthenticated caller can perform (gap-spec §36).
   * A transition is cheap to request and expensive to evaluate — it reads the whole graph.
   */
  if (!(await checkRateLimit('project-transition'))) {
    redirect(`/plan/${projectId}?error=rate-limited`);
  }

  const outcome = await attempt(projectId, to);

  revalidatePath(`/plan/${projectId}`);

  if (outcome.kind === 'refused') {
    redirect(`/plan/${projectId}?refused=${encodeURIComponent(outcome.refusal)}`);
  }

  redirect(`/plan/${projectId}`);
}

type Outcome = { kind: 'ok' } | { kind: 'refused'; refusal: string };

async function attempt(projectId: string, to: LifecycleState): Promise<Outcome> {
  try {
    // Ownership before anything else, and the same silent refusal the other actions use: a caller
    // probing project ids must not be able to tell which exist.
    const access = await accessibleProject(projectId);

    if (access === null) {
      logger.warn('rejected transition for unowned project', { projectId });
      return { kind: 'refused', refusal: 'NOT_FOUND' };
    }

    const { project } = access;

    if (project.archivedAt !== null && to !== 'COMPLETED') {
      // Gap-spec §71: an archive is read-only by default. Restoring it is the one thing it accepts.
      return { kind: 'refused', refusal: 'ARCHIVED' };
    }

    const [nodes, edges] = await Promise.all([
      withDatabase((db) => db.select().from(twinNodes).where(eq(twinNodes.projectId, projectId))),
      withDatabase((db) => db.select().from(twinEdges).where(eq(twinEdges.projectId, projectId))),
    ]);

    const graph = graphFromRows(projectId, nodes, edges);

    /*
     * An empty graph produces no gate outcomes at all, which is different from producing failing
     * ones — and the transition machine treats a gate it cannot find as not passed, which is the
     * correct reading. A project with no plan has not satisfied the planning gate; it has not been
     * assessed against it.
     */
    /*
     * The gates include what this project's rules demand, not only the catalogue's own criteria.
     *
     * Evaluating the catalogue alone here would let a transition through that the rules forbid --
     * and this is the one place in the product where a gate result actually stops something, so it
     * is the place where discarding them mattered most.
     */
    const { emittedGates } = evaluateForProject({
      projectId,
      projectType: project.projectType,
      lifecycleState: project.lifecycleState,
      intake: await loadIntake(projectId),
      graph,
    });

    const gates: readonly GateReadiness[] =
      graph.size > 0
        ? evaluateGates(graph, emittedGates).map((outcome) => ({
            key: outcome.key,
            result: outcome.result,
          }))
        : [];

    /*
     * Approvals are empty because there is nowhere to store one yet.
     *
     * That is not a shortcut — it is the honest current state, and it has the correct consequence:
     * the two transitions that require an approval (`PLANNED → APPROVED` and `RELEASE_READY → LIVE`)
     * refuse with `APPROVAL_MISSING` rather than passing unchecked. When the approvals table lands,
     * this is the line that changes and nothing else here does.
     */
    const approvals: readonly Approval[] = [];

    const verdict = evaluateTransition(project.lifecycleState, to, {
      gates,
      approvals,
      subjectVersion: project.version,
    });

    if (!verdict.allowed) {
      logger.info('lifecycle transition refused', {
        projectId,
        from: project.lifecycleState,
        to,
        refusal: verdict.refusal,
        blocking: verdict.blocking,
      });
      return { kind: 'refused', refusal: verdict.refusal };
    }

    const applied = await withDatabase(async (db) => {
      /*
       * The version guard is the concurrency control (§49).
       *
       * Two callers who both read version 3 and both decide the move is allowed will both issue this
       * update; exactly one matches. The loser gets zero rows and is told to look again, rather than
       * silently overwriting a transition it never saw.
       */
      const rows = await db
        .update(projects)
        .set({
          lifecycleState: to,
          version: project.version + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(projects.id, projectId), eq(projects.version, project.version)))
        .returning({ id: projects.id, version: projects.version });

      if (rows.length === 0) return false;

      /*
       * The audit row is written in the same transaction as the change it describes.
       *
       * Not after it, not in a `finally`. A separate write can fail while the change succeeds, and an
       * unaudited change is indistinguishable afterwards from one that never happened.
       */
      await recordAudit(db, {
        organizationId: project.organizationId,
        projectId,
        action: 'PROJECT_LIFECYCLE_TRANSITIONED',
        entityType: 'PROJECT',
        entityId: projectId,
        /*
         * Separate columns with separate foreign keys. A signed-in user's id in the guest column
         * would fail the constraint, and if it did not it would attribute an account's action to a
         * session that never took it.
         */
        ...(access.userId === null
          ? { actorGuestSessionId: access.guestSessionId ?? '' }
          : { actorUserId: access.userId }),
        summary: {
          from: project.lifecycleState,
          to,
          fromVersion: project.version,
          toVersion: project.version + 1,
          // What the transition required, so the record says why it was permitted rather than only
          // that it happened.
          requiredGates: verdict.transition.gates,
          requiredApproval: verdict.transition.approval ?? null,
        },
      });

      return true;
    });

    if (!applied) {
      logger.info('lifecycle transition lost a concurrent race', { projectId, to });
      return { kind: 'refused', refusal: 'CONCURRENT_UPDATE' };
    }

    logger.info('lifecycle transition applied', {
      projectId,
      from: project.lifecycleState,
      to,
      version: project.version + 1,
    });

    return { kind: 'ok' };
  } catch (error) {
    logger.error('lifecycle transition failed', { err: toAppError(error), projectId });
    return { kind: 'refused', refusal: 'FAILED' };
  }
}

/**
 * What the project could do next, and whether it can.
 *
 * Read-only, for the page. Returns every declared next step with its verdict rather than only the
 * permitted ones — a screen that hides blocked transitions cannot explain why the project is stuck,
 * and "why can I not advance" is the question this product exists to answer.
 */
export async function availableTransitions(projectId: string) {
  const [project] = await withDatabase((db) =>
    db.select().from(projects).where(eq(projects.id, projectId)),
  );

  if (project === undefined || !(await mayOpen(project))) return null;

  const [nodes, edges] = await Promise.all([
    withDatabase((db) => db.select().from(twinNodes).where(eq(twinNodes.projectId, projectId))),
    withDatabase((db) => db.select().from(twinEdges).where(eq(twinEdges.projectId, projectId))),
  ]);

  const graph = graphFromRows(projectId, nodes, edges);

  const { emittedGates } = evaluateForProject({
    projectId,
    projectType: project.projectType,
    lifecycleState: project.lifecycleState,
    intake: await loadIntake(projectId),
    graph,
  });

  const gates: readonly GateReadiness[] =
    graph.size > 0
      ? evaluateGates(graph, emittedGates).map((outcome) => ({
          key: outcome.key,
          result: outcome.result,
        }))
      : [];

  return {
    current: project.lifecycleState,
    options: transitionsFrom(project.lifecycleState).map((transition) => ({
      to: transition.to,
      why: transition.why,
      verdict: evaluateTransition(project.lifecycleState, transition.to, {
        gates,
        approvals: [],
        subjectVersion: project.version,
      }),
    })),
  };
}
