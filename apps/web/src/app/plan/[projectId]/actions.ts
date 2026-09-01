'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { logger } from '@govintel/shared/logging';
import { toAppError } from '@govintel/shared/errors';
import { intakeAnswers, projects, twinEdges, twinNodes } from '@govintel/db/schema';
import type { IntakeField } from '@govintel/intake/schema';
import { generateProject } from '@govintel/twin/generate';
import { rowsFromGraph } from '@govintel/twin/repository';
import { withDatabase } from '../../../lib/server/database.ts';
import { readGuestSessionId } from '../../../lib/server/session.ts';

/**
 * Generate the project plan.
 *
 * The generator itself is pure — no clock, no randomness, no database (see
 * `packages/twin/src/generate.ts`). This action is the thin layer that supplies the timestamp, reads
 * the intake, and writes the result.
 *
 * Regeneration **replaces** the generated graph rather than merging into it. Node ids are derived
 * from a stable path, so a second run over the same answers produces the same ids and the same
 * content; a merge would be indistinguishable from a replace for that case and much harder to reason
 * about for every other. When the graph starts carrying user edits — Phase 8 — this becomes a real
 * merge with the change log recording what moved, and that is deliberately not being faked now.
 */

type Outcome = { kind: 'ok' } | { kind: 'redirect'; to: string };

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

export async function generatePlan(formData: FormData): Promise<void> {
  const projectId = readString(formData, 'projectId');
  if (projectId.length === 0) redirect('/start');

  const outcome = await generate(projectId);
  if (outcome.kind === 'redirect') redirect(outcome.to);

  revalidatePath(`/plan/${projectId}`);
  redirect(`/plan/${projectId}`);
}

async function generate(projectId: string): Promise<Outcome> {
  try {
    const sessionId = await readGuestSessionId();

    const [project] = await withDatabase((db) =>
      db.select().from(projects).where(eq(projects.id, projectId)),
    );

    if (project?.guestSessionId == null || project.guestSessionId !== sessionId) {
      logger.warn('rejected plan generation for unowned project', { projectId });
      return { kind: 'redirect', to: '/start' };
    }

    if (project.archivedAt !== null) {
      // Gap-spec §8.3. Refused here as well as by the invariant pass, so the user gets a redirect
      // rather than an error page.
      return { kind: 'redirect', to: `/plan/${projectId}?error=archived` };
    }

    const rows = await withDatabase((db) =>
      db.select().from(intakeAnswers).where(eq(intakeAnswers.projectId, projectId)),
    );

    const intake: IntakeField[] = rows.map((row) => ({
      fieldId: row.fieldId,
      category: row.category as IntakeField['category'],
      value: row.value ?? null,
      state: row.state as IntakeField['state'],
      provenance: row.provenance as IntakeField['provenance'],
      confidence: row.confidence as IntakeField['confidence'],
      lastUpdatedAt: row.updatedAt.toISOString(),
    }));

    const result = generateProject({
      projectId,
      projectName: project.name,
      ...(project.summary === null ? {} : { projectSummary: project.summary }),
      intake,
      // The clock lives here, not in the generator. That separation is what makes the golden-fixture
      // test possible at all.
      at: new Date().toISOString(),
    });

    // Throws if the graph would violate an invariant, before anything is written. A cycle stored and
    // reported afterwards is a cycle some other request has already planned against.
    const writable = rowsFromGraph(result.graph, project.organizationId);

    await withDatabase(async (db) => {
      /*
       * Edges first, then nodes.
       *
       * Edges reference nodes, so deleting nodes first would either cascade the edges away or fail on
       * the foreign key depending on the order the database chose. Being explicit costs one statement
       * and removes the ambiguity.
       */
      await db.delete(twinEdges).where(eq(twinEdges.projectId, projectId));
      await db.delete(twinNodes).where(eq(twinNodes.projectId, projectId));

      if (writable.nodes.length > 0) await db.insert(twinNodes).values([...writable.nodes]);
      if (writable.edges.length > 0) await db.insert(twinEdges).values([...writable.edges]);
    });

    logger.info('generated project plan', {
      projectId,
      correlationId: randomUUID(),
      generatorVersion: result.generatorVersion,
      nodes: writable.nodes.length,
      edges: writable.edges.length,
      assumptions: result.assumptions.length,
      unknowns: result.unknowns.length,
    });

    return { kind: 'ok' };
  } catch (error) {
    logger.error('failed to generate project plan', { err: toAppError(error), projectId });
    return { kind: 'redirect', to: `/plan/${projectId}?error=failed` };
  }
}

/** Read the stored graph for a project the caller owns. Returns null when they do not. */
export async function loadPlanRows(projectId: string) {
  const sessionId = await readGuestSessionId();

  const [project] = await withDatabase((db) =>
    db.select().from(projects).where(eq(projects.id, projectId)),
  );

  if (project?.guestSessionId == null || project.guestSessionId !== sessionId) return null;

  const nodes = await withDatabase((db) =>
    db.select().from(twinNodes).where(eq(twinNodes.projectId, projectId)),
  );

  const edges = await withDatabase((db) =>
    db
      .select()
      .from(twinEdges)
      .where(and(eq(twinEdges.projectId, projectId))),
  );

  return { project, nodes, edges };
}
