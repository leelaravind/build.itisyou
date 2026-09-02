'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { logger } from '@govintel/shared/logging';
import { toAppError } from '@govintel/shared/errors';
import { aiImports, intakeAnswers, projects } from '@govintel/db/schema';
import type { IntakeField } from '@govintel/intake/schema';
import { validateImport } from '@govintel/interchange/validate';
import { interchangeResponseSchema } from '@govintel/interchange/schema';
import {
  planMaterialisation,
  stateFor,
  type Materialisation,
} from '@govintel/interchange/materialise';
import { FIELD_DEFINITIONS, findField } from '@govintel/intake/fields';
import { projectTypeEnum } from '@govintel/db/schema';
import { currentVersions } from '@govintel/interchange/versions';
import { EXTERNAL_AI_MODE } from '../../../../lib/server/config.ts';
import { withDatabase } from '../../../../lib/server/database.ts';
import { recordAudit } from '../../../../lib/server/audit.ts';
import { checkRateLimit } from '../../../../lib/server/rate-limit.ts';
import { mayOpen } from '../../../../lib/server/project-access.ts';

/**
 * Store a pasted response, validate it, and apply it once a person accepts it.
 *
 * Contract: gap-spec §12.3 — submitting does not touch the canonical project. The paste is stored
 * verbatim in `ai_imports`, validated, and the result recorded. **Accepting is the separate,
 * explicit act §12.3 requires**, and it is the point at which the project changes.
 *
 * That last part is new. Accepting used to set `state = 'ACCEPTED'` and write nothing else, so the
 * loop was open at the end that matters: the user ran the prompt somewhere, pasted the answer back,
 * watched it validate, pressed accept, and every open question was still open. `applyResponse` below
 * closes it — under rules that live in `@govintel/interchange/materialise` because deciding what an
 * external response may change is worth testing without a database.
 *
 * No `redirect()` inside a `try`: Next implements it by throwing, so a `catch` would swallow the
 * navigation. Same lesson as the intake action.
 */

type Outcome = { kind: 'ok'; importId: string } | { kind: 'redirect'; to: string };

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

/**
 * Whether the external-AI workflow is available at all (plan §19).
 *
 * Checked on every write path rather than once at the page, because a server action is reachable
 * without the page that renders it — which is the whole reason authorisation belongs in the action.
 * A guard that only runs in the UI protects the UI.
 */
function externalAiDisabled(): boolean {
  return EXTERNAL_AI_MODE === 'DISABLED';
}

export async function submitImport(formData: FormData): Promise<void> {
  const projectId = readString(formData, 'projectId');
  const raw = readString(formData, 'response').trim();

  if (projectId.length === 0) redirect('/start');
  if (externalAiDisabled()) redirect(`/intake/${projectId}?error=external-ai-disabled`);
  if (raw.length === 0) redirect(`/intake/${projectId}/import?error=empty`);

  // Gap-spec §36 names AI import validation as a rate-limited action: validation is the most
  // expensive thing an unauthenticated caller can trigger.
  if (!(await checkRateLimit('ai-import'))) {
    redirect(`/intake/${projectId}/import?error=rate-limited`);
  }

  const outcome = await store(projectId, raw);

  if (outcome.kind === 'redirect') redirect(outcome.to);

  revalidatePath(`/intake/${projectId}/import/${outcome.importId}`);
  redirect(`/intake/${projectId}/import/${outcome.importId}`);
}

async function store(projectId: string, raw: string): Promise<Outcome> {
  try {
    const [project] = await withDatabase((db) =>
      db.select().from(projects).where(eq(projects.id, projectId)),
    );

    if (project === undefined || !(await mayOpen(project))) {
      logger.warn('rejected import for unowned project', { projectId });
      return { kind: 'redirect', to: '/start' };
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

    const validation = validateImport(raw, { intake });
    const versions = currentVersions();

    const [record] = await withDatabase((db) =>
      db
        .insert(aiImports)
        .values({
          projectId,
          // Verbatim. `raw` is evidence of what was submitted; `response` is what the validator was
          // willing to make of it, and the two must not be conflated.
          raw,
          state: 'VALIDATED',
          response: validation.response as Record<string, unknown> | undefined,
          validation: validation as unknown as Record<string, unknown>,
          schemaVersion: versions.schema,
          validatorVersion: versions.validator,
          ...(validation.response?.promptId === undefined
            ? {}
            : { promptId: validation.response.promptId }),
        })
        .returning({ id: aiImports.id }),
    );

    if (record === undefined) throw new Error('import insert returned no row');

    logger.info('ai import validated', {
      projectId,
      importId: record.id,
      status: validation.status,
      issueCount: validation.issues.length,
      // The payload itself is never logged. It is untrusted content of unknown provenance, and the
      // whole point of the airlock is that it does not spread beyond the staging row.
    });

    return { kind: 'ok', importId: record.id };
  } catch (error) {
    logger.error('failed to store ai import', { err: toAppError(error), projectId });
    return { kind: 'redirect', to: `/intake/${projectId}/import?error=failed` };
  }
}

/**
 * Accept a validated import.
 *
 * Guarded three times over: the state machine refuses a transition from anything but VALIDATED, the
 * validation result must permit materialisation, and the database constraint refuses an ACCEPTED row
 * with no stored validation. Untrusted content reaching the project should not depend on any single
 * one of those being correct.
 *
 * Materialisation into the Digital Twin lands in Phase 6, when the canonical entities exist. Until
 * then acceptance records the decision and stops — which is the honest state of the system rather
 * than a stub pretending to apply something.
 */
export async function acceptImport(formData: FormData): Promise<void> {
  const projectId = readString(formData, 'projectId');
  const importId = readString(formData, 'importId');

  if (projectId.length === 0 || importId.length === 0) redirect('/start');

  const outcome = await decide(projectId, importId, 'ACCEPTED');
  if (outcome.kind === 'redirect') redirect(outcome.to);

  revalidatePath(`/intake/${projectId}/import/${importId}`);
  redirect(`/intake/${projectId}/import/${importId}?decided=accepted`);
}

export async function rejectImport(formData: FormData): Promise<void> {
  const projectId = readString(formData, 'projectId');
  const importId = readString(formData, 'importId');

  if (projectId.length === 0 || importId.length === 0) redirect('/start');

  const outcome = await decide(projectId, importId, 'REJECTED');
  if (outcome.kind === 'redirect') redirect(outcome.to);

  revalidatePath(`/intake/${projectId}/import/${importId}`);
  redirect(`/intake/${projectId}/import/${importId}?decided=rejected`);
}

/**
 * Apply an accepted response to the project.
 *
 * Runs inside the caller's transaction, alongside the state change it belongs to.
 *
 * Only claims and the project type are written. Requirements, risks and phases are counted and
 * reported rather than stored: `generatePlan` deletes and rewrites every twin node it owns, so
 * requirements written as nodes would disappear the next time somebody rebuilt the plan — which
 * reads as data loss rather than as design. That is the same reason evidence lives in its own table.
 */
async function applyResponse(
  db: Parameters<Parameters<typeof withDatabase>[0]>[0],
  input: {
    project: typeof projects.$inferSelect;
    importId: string;
    record: typeof aiImports.$inferSelect;
  },
): Promise<Materialisation | undefined> {
  const parsed = interchangeResponseSchema.safeParse(input.record.response);

  /*
   * Re-parsed rather than trusted. The row was validated when it arrived, but it has been sitting in
   * a database since, and the schema it was validated against may have moved. A stored payload is
   * input like any other.
   */
  if (!parsed.success) {
    logger.warn('accepted import could not be re-parsed; nothing applied', {
      importId: input.importId,
    });
    return undefined;
  }

  const existing = await db
    .select({ fieldId: intakeAnswers.fieldId, state: intakeAnswers.state })
    .from(intakeAnswers)
    .where(eq(intakeAnswers.projectId, input.project.id));

  const plan = planMaterialisation({
    response: parsed.data,
    existing,
    knownFieldIds: new Set(FIELD_DEFINITIONS.map((field) => field.id)),
    currentProjectType: input.project.projectType,
    supportedProjectTypes: new Set(projectTypeEnum.enumValues),
  });

  for (const answer of plan.answers) {
    const definition = findField(answer.fieldId);
    if (definition === undefined) continue;

    const row = {
      organizationId: input.project.organizationId,
      projectId: input.project.id,
      fieldId: answer.fieldId,
      category: definition.category,
      value: answer.value,
      state: stateFor(answer.provenance),
      provenance: answer.provenance,
      confidence: answer.confidence,
      note: answer.note ?? null,
      updatedAt: new Date(),
    };

    const [current] = await db
      .select({ id: intakeAnswers.id })
      .from(intakeAnswers)
      .where(
        and(
          eq(intakeAnswers.projectId, input.project.id),
          eq(intakeAnswers.fieldId, answer.fieldId),
        ),
      );

    if (current === undefined) await db.insert(intakeAnswers).values(row);
    else await db.update(intakeAnswers).set(row).where(eq(intakeAnswers.id, current.id));
  }

  if (plan.projectType !== undefined) {
    await db
      .update(projects)
      .set({
        projectType: plan.projectType as (typeof projectTypeEnum.enumValues)[number],
        updatedAt: new Date(),
      })
      // Guarded on the type still being UNKNOWN, so a concurrent answer wins rather than being
      // overwritten by a model.
      .where(and(eq(projects.id, input.project.id), eq(projects.projectType, 'UNKNOWN')));
  }

  await recordAudit(db, {
    organizationId: input.project.organizationId,
    projectId: input.project.id,
    action: 'AI_IMPORT_APPLIED',
    entityType: 'AI_IMPORT',
    entityId: input.importId,
    ...(input.project.guestSessionId === null
      ? {}
      : { actorGuestSessionId: input.project.guestSessionId }),
    summary: {
      /*
       * Which fields, not what they now say. The values are the user's project data; the audit log
       * outlives most of it and needs to record that an external response was applied and to what.
       */
      fieldsApplied: plan.answers.map((a) => a.fieldId),
      claimsSkipped: plan.skipped,
      projectTypeSet: plan.projectType ?? null,
      notApplied: plan.notApplied,
    },
  });

  return plan;
}

async function decide(
  projectId: string,
  importId: string,
  decision: 'ACCEPTED' | 'REJECTED',
): Promise<Outcome> {
  try {
    /*
     * Refused here as well as at submission. A decision on an import that should never have been
     * accepted is still a write, and the row can predate the policy being switched off.
     */
    if (externalAiDisabled())
      return { kind: 'redirect', to: `/intake/${projectId}?error=external-ai-disabled` };

    const [project] = await withDatabase((db) =>
      db.select().from(projects).where(eq(projects.id, projectId)),
    );

    if (project === undefined || !(await mayOpen(project))) {
      return { kind: 'redirect', to: '/start' };
    }

    const [record] = await withDatabase((db) =>
      db
        .select()
        .from(aiImports)
        .where(and(eq(aiImports.id, importId), eq(aiImports.projectId, projectId))),
    );

    if (record === undefined) return { kind: 'redirect', to: `/intake/${projectId}/import` };

    // Only a VALIDATED import can be decided. A replayed accept on an already-decided import is a
    // no-op rather than an error — the user double-clicked, which is not a mistake.
    if (record.state !== 'VALIDATED') {
      return { kind: 'ok', importId };
    }

    if (decision === 'ACCEPTED') {
      const validation = record.validation as { canMaterialize?: boolean } | null;
      if (validation?.canMaterialize !== true) {
        logger.warn('refused to accept an import that did not pass validation', { importId });
        return { kind: 'redirect', to: `/intake/${projectId}/import/${importId}?error=not-valid` };
      }
    }

    /*
     * The decision and its consequences are one transaction.
     *
     * Accepting used to write nothing but the status column: the user copied a prompt out of the
     * platform, ran it, pasted the answer back, watched it validate, pressed accept -- and every
     * open question was still open. The loop was open at the end that matters.
     *
     * Applying the answers in a separate write would allow the state to say ACCEPTED while nothing
     * was applied, which is the same failure with an audit trail claiming otherwise.
     */
    const applied = await withDatabase(async (db) => {
      const updated = await db
        .update(aiImports)
        .set({ state: decision, updatedAt: new Date() })
        .where(and(eq(aiImports.id, importId), eq(aiImports.state, 'VALIDATED')))
        .returning({ id: aiImports.id });

      // Somebody else decided it between the read and the write. Their decision stands.
      if (updated.length === 0 || decision !== 'ACCEPTED') return undefined;

      return applyResponse(db, { project, importId, record });
    });

    logger.info('ai import decided', {
      projectId,
      importId,
      decision,
      answersApplied: applied?.answers.length ?? 0,
      claimsSkipped: applied?.skipped.length ?? 0,
    });

    return { kind: 'ok', importId };
  } catch (error) {
    logger.error('failed to decide ai import', { err: toAppError(error), importId });
    return { kind: 'redirect', to: `/intake/${projectId}/import/${importId}?error=failed` };
  }
}
