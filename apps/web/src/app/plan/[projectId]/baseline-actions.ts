'use server';

import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { twinBaselines } from '@govintel/db/schema';
import { createBaseline } from '@govintel/governance/baseline';
import { graphFromRows } from '@govintel/twin/repository';
import { toAppError } from '@govintel/shared/errors';
import { logger } from '@govintel/shared/logging';
import { withDatabase } from '../../../lib/server/database.ts';
import { recordAudit } from '../../../lib/server/audit.ts';
import { checkRateLimit } from '../../../lib/server/rate-limit.ts';
import { accessibleProject } from '../../../lib/server/project-access.ts';
import { loadProjectRows } from '../../../lib/server/project-graph.ts';

/**
 * Record a baseline: a stored, checksummed snapshot of the plan as agreed (gap-spec §29, plan Phase 13).
 *
 * The baseline page used to take a "preview" baseline on every render and compare it with the graph
 * it had just been taken from — so it always said "verified" and "no drift", and no baseline was ever
 * kept. `twin_baselines` existed, immutable by trigger and behind row-level security, with no writer.
 *
 * What is baselined is the plan: the stored twin, without the evidence and approval records projected
 * into it. Evidence recorded afterwards is the project doing its work, not a departure from what was
 * agreed, and counting it as drift would make every baseline look violated the moment anyone used it.
 */

type Outcome = { kind: 'ok'; version: number } | { kind: 'refused'; reason: string };

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

export async function recordBaseline(formData: FormData): Promise<void> {
  const projectId = readString(formData, 'projectId');
  const reason = readString(formData, 'reason').trim();

  if (projectId.length === 0) redirect('/start');

  if (!(await checkRateLimit('project-transition'))) {
    redirect(`/plan/${projectId}/baseline?error=rate-limited`);
  }

  const outcome = await record(projectId, reason);

  revalidatePath(`/plan/${projectId}/baseline`);

  if (outcome.kind === 'refused') {
    redirect(`/plan/${projectId}/baseline?error=${encodeURIComponent(outcome.reason)}`);
  }

  redirect(`/plan/${projectId}/baseline?recorded=${String(outcome.version)}`);
}

async function record(projectId: string, reason: string): Promise<Outcome> {
  try {
    const access = await accessibleProject(projectId);
    if (access === null) return { kind: 'refused', reason: 'not-found' };

    const { project } = access;
    if (project.archivedAt !== null) return { kind: 'refused', reason: 'archived' };
    if (reason === '') return { kind: 'refused', reason: 'NO_REASON' };

    const rows = await loadProjectRows(projectId, project.organizationId);
    const planNodes = rows.nodes.filter(
      (node) => node.class !== 'EVIDENCE' && node.class !== 'APPROVAL',
    );
    const graph = graphFromRows(projectId, planNodes, rows.edges);

    const [latest] = await withDatabase((db) =>
      db
        .select({ version: twinBaselines.version })
        .from(twinBaselines)
        .where(eq(twinBaselines.projectId, projectId))
        .orderBy(desc(twinBaselines.version))
        .limit(1),
    );
    const version = (latest?.version ?? 0) + 1;

    const id = randomUUID();
    const takenAt = new Date().toISOString();
    const created = createBaseline(graph, {
      id,
      type: 'APPROVED_PLAN',
      label: `Baseline ${String(version)}`,
      version,
      createdBy: access.actor,
      reason,
      takenAt,
      correlationId: randomUUID(),
    });

    if (!created.ok) return { kind: 'refused', reason: created.refusal };
    const baseline = created.value;

    await withDatabase(async (db) => {
      await db.insert(twinBaselines).values({
        id,
        organizationId: project.organizationId,
        projectId,
        version,
        label: baseline.label,
        correlationId: baseline.correlationId,
        checksum: baseline.checksum,
        /*
         * Everything the checksum was computed over, stored as it was hashed — including the
         * `takenAt` string — so the baseline re-verifies byte for byte when it is read back.
         */
        snapshot: {
          type: baseline.type,
          createdBy: baseline.createdBy,
          reason: baseline.reason,
          takenAt: baseline.takenAt,
          nodes: baseline.nodes,
          edges: baseline.edges,
        },
        takenAt: new Date(takenAt),
      });

      // In the same transaction as the baseline it describes (plan §20: "baseline").
      await recordAudit(db, {
        organizationId: project.organizationId,
        projectId,
        action: 'BASELINE_RECORDED',
        entityType: 'BASELINE',
        entityId: id,
        ...(access.userId === null
          ? { actorGuestSessionId: access.guestSessionId ?? '' }
          : { actorUserId: access.userId }),
        reason,
        summary: {
          version,
          checksum: baseline.checksum,
          nodes: baseline.nodes.length,
          edges: baseline.edges.length,
        },
      });
    });

    logger.info('baseline recorded', { projectId, version });
    return { kind: 'ok', version };
  } catch (error) {
    logger.error('baseline could not be recorded', { err: toAppError(error), projectId });
    return { kind: 'refused', reason: 'failed' };
  }
}
