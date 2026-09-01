'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { logger } from '@govintel/shared/logging';
import { toAppError } from '@govintel/shared/errors';
import { aiImports, intakeAnswers, projects } from '@govintel/db/schema';
import type { IntakeField } from '@govintel/intake/schema';
import { validateImport } from '@govintel/interchange/validate';
import { currentVersions } from '@govintel/interchange/versions';
import { withDatabase } from '../../../../lib/server/database.ts';
import { readActiveGuestSessionId } from '../../../../lib/server/session.ts';
import { checkRateLimit } from '../../../../lib/server/rate-limit.ts';

/**
 * Store a pasted response and validate it.
 *
 * Contract: gap-spec §12.3 — the canonical project is not touched. The paste is stored verbatim in
 * `ai_imports`, validated, and the result recorded. Applying anything is a separate, explicit act on
 * a later screen.
 *
 * No `redirect()` inside a `try`: Next implements it by throwing, so a `catch` would swallow the
 * navigation. Same lesson as the intake action.
 */

type Outcome = { kind: 'ok'; importId: string } | { kind: 'redirect'; to: string };

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

export async function submitImport(formData: FormData): Promise<void> {
  const projectId = readString(formData, 'projectId');
  const raw = readString(formData, 'response').trim();

  if (projectId.length === 0) redirect('/start');
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
    const sessionId = await readActiveGuestSessionId();

    const [project] = await withDatabase((db) =>
      db.select().from(projects).where(eq(projects.id, projectId)),
    );

    if (project?.guestSessionId == null || project.guestSessionId !== sessionId) {
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

async function decide(
  projectId: string,
  importId: string,
  decision: 'ACCEPTED' | 'REJECTED',
): Promise<Outcome> {
  try {
    const sessionId = await readActiveGuestSessionId();

    const [project] = await withDatabase((db) =>
      db.select().from(projects).where(eq(projects.id, projectId)),
    );

    if (project?.guestSessionId == null || project.guestSessionId !== sessionId) {
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

    await withDatabase((db) =>
      db
        .update(aiImports)
        .set({ state: decision, updatedAt: new Date() })
        .where(and(eq(aiImports.id, importId), eq(aiImports.state, 'VALIDATED'))),
    );

    logger.info('ai import decided', { projectId, importId, decision });
    return { kind: 'ok', importId };
  } catch (error) {
    logger.error('failed to decide ai import', { err: toAppError(error), importId });
    return { kind: 'redirect', to: `/intake/${projectId}/import/${importId}?error=failed` };
  }
}
