'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { logger } from '@govintel/shared/logging';
import { toAppError } from '@govintel/shared/errors';
import { intakeAnswers, projects, twinEdges, twinNodes } from '@govintel/db/schema';
import type { IntakeField } from '@govintel/intake/schema';
import { generateProject } from '@govintel/twin/generate';
import { rowsFromGraph } from '@govintel/twin/repository';
import { withDatabase } from '../../../lib/server/database.ts';
import { accessibleProject } from '../../../lib/server/project-access.ts';
import { loadProjectRows } from '../../../lib/server/project-graph.ts';
import { evaluateForProject } from '../../../lib/server/project-rules.ts';
import { decompose, mergeIntoGraph } from '@govintel/execution/decompose';
import { mayOpen } from '../../../lib/server/project-access.ts';

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
    const [project] = await withDatabase((db) =>
      db.select().from(projects).where(eq(projects.id, projectId)),
    );

    if (project === undefined || !(await mayOpen(project))) {
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

    const generatedAt = new Date().toISOString();

    const result = generateProject({
      projectId,
      projectName: project.name,
      ...(project.summary === null ? {} : { projectSummary: project.summary }),
      intake,
      // The clock lives here, not in the generator. That separation is what makes the golden-fixture
      // test possible at all. Read once and shared with the decomposition, so the two halves of one
      // plan do not disagree about when it was made.
      at: generatedAt,
    });

    /*
     * The decomposition is part of the plan, and is stored with it.
     *
     * It was computed on the work page and thrown away on every render, so the *stored* graph had no
     * WORK nodes at all — and the traceability chain the contract requires (Requirement →
     * Architecture → Work → Implementation → Test → Evidence → Release) broke at the third hop for
     * every real project. "Fully traced: 0" was not a finding about the project; it was a finding
     * about what had been written down. The Phase-10 gate that verifies the chain passed because it
     * ran against hand-built fixtures containing the work items the product never persisted.
     *
     * The same function, on the same inputs, produces the same result the work page produces — it is
     * deterministic, which is why storing it changes what is *recorded* rather than what is true.
     */
    const { evaluation } = evaluateForProject({
      projectId,
      projectType: project.projectType,
      lifecycleState: project.lifecycleState,
      intake,
      graph: result.graph,
    });

    const teamSize = numberAnswer(intake, 'team.size');

    const decomposition = decompose({
      projectId,
      graph: result.graph,
      emissions: evaluation.emissions,
      ...(teamSize === undefined ? {} : { teamSize }),
      at: generatedAt,
    });

    // Throws if the graph would violate an invariant, before anything is written. A cycle stored and
    // reported afterwards is a cycle some other request has already planned against.
    const writable = rowsFromGraph(
      mergeIntoGraph(result.graph, decomposition),
      project.organizationId,
    );

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
      workItems: decomposition.nodes.length,
      assumptions: result.assumptions.length,
      unknowns: result.unknowns.length,
    });

    return { kind: 'ok' };
  } catch (error) {
    logger.error('failed to generate project plan', { err: toAppError(error), projectId });
    return { kind: 'redirect', to: `/plan/${projectId}?error=failed` };
  }
}

/** A numeric intake answer, or `undefined`. Mirrors the work page, which asks the same question. */
function numberAnswer(intake: readonly IntakeField[], fieldId: string): number | undefined {
  const value = intake.find((field) => field.fieldId === fieldId)?.value;
  return typeof value === 'number' ? value : undefined;
}

/**
 * Read the graph rows for a project the caller may open — the stored twin plus the evidence and
 * approval projection. Returns null when they may not.
 */
export async function loadPlanRows(projectId: string) {
  const access = await accessibleProject(projectId);

  if (access === null) return null;

  const { project } = access;
  const rows = await loadProjectRows(projectId, project.organizationId);

  return { project, ...rows };
}
