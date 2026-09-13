'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { logger } from '@govintel/shared/logging';
import { toAppError } from '@govintel/shared/errors';
import { intakeAnswers, projects } from '@govintel/db/schema';
import { answerField, type AnswerMode } from '@govintel/intake/schema';
import { findField } from '@govintel/intake/fields';
import { withDatabase } from '../../../lib/server/database.ts';
import { checkRateLimit } from '../../../lib/server/rate-limit.ts';
import { mayOpen } from '../../../lib/server/project-access.ts';

/**
 * Record an answer to one intake question.
 *
 * Contract: gap-spec §9.2 (five answer modes), §9.3 (state, provenance, confidence, timestamp),
 * §5.1 (a guest may complete intake), §36 (rate limiting).
 *
 * Everything the client sends is treated as untrusted. The field id is looked up in the catalogue
 * rather than accepted — an unknown id would otherwise write an orphan row that no screen renders
 * and no engine reads. The answer *mode* likewise comes from a fixed list; state, provenance and
 * confidence are derived server-side and never taken from the request, because a client that could
 * set `state: 'CONFIRMED'` could manufacture certainty the user never expressed.
 *
 * **No `redirect()` inside a `try`.** Next implements `redirect()` by throwing a `NEXT_REDIRECT`
 * control-flow error. A `catch` around it swallows the redirect and turns a successful navigation
 * into a generic failure — which is exactly the bug this action shipped with: every answer appeared
 * to save and none did. All redirects below therefore happen after the try block has completed.
 */

const VALID_MODES = new Set<AnswerMode>([
  'ANSWER',
  'I_DONT_KNOW',
  'UNSURE',
  'USE_RECOMMENDED_DEFAULT',
  'DEFER_TO_EXTERNAL_RESEARCH',
]);

type Outcome = { kind: 'ok' } | { kind: 'redirect'; to: string };

/**
 * Read a form field as a string.
 *
 * `FormData.get` returns `string | File | null`. A multipart request can put a `File` where a string
 * is expected, and `String(file)` would yield "[object File]" — which would then be treated as a
 * field id or a mode. Anything that is not a string is discarded.
 */
function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

export async function answerQuestion(formData: FormData): Promise<void> {
  const projectId = readString(formData, 'projectId');
  const fieldId = readString(formData, 'fieldId');
  const rawMode = readString(formData, 'mode');

  const outcome = await record({ projectId, fieldId, rawMode, formData });

  if (outcome.kind === 'redirect') redirect(outcome.to);

  revalidatePath(`/intake/${projectId}`);
  redirect(`/intake/${projectId}`);
}

/**
 * Do the work and *return* where to go next, rather than redirecting from inside.
 *
 * Separating the decision from the navigation is what keeps `redirect()` out of the `try`.
 */
async function record(input: {
  projectId: string;
  fieldId: string;
  rawMode: string;
  formData: FormData;
}): Promise<Outcome> {
  const definition = findField(input.fieldId);
  const mode = input.rawMode as AnswerMode;

  if (input.projectId.length === 0 || definition === undefined || !VALID_MODES.has(mode)) {
    // A malformed submission means the form was tampered with or a deploy is mid-flight — not a
    // user-facing state worth designing for. Send them somewhere coherent.
    logger.warn('rejected malformed intake submission', {
      fieldId: input.fieldId,
      mode: input.rawMode,
    });
    return { kind: 'redirect', to: '/start' };
  }

  if (!(await checkRateLimit('intake-answer'))) {
    return { kind: 'redirect', to: `/intake/${input.projectId}?error=rate-limited` };
  }

  try {
    const [project] = await withDatabase((db) =>
      db.select().from(projects).where(eq(projects.id, input.projectId)),
    );

    // Ownership before anything else. Same outcome as the page's 404: a caller probing project ids
    // must not be able to tell which exist.
    if (project === undefined || !(await mayOpen(project))) {
      logger.warn('rejected intake write for unowned project', { projectId: input.projectId });
      return { kind: 'redirect', to: '/start' };
    }

    const field = answerField({
      fieldId: definition.id,
      category: definition.category,
      mode,
      value: readValue(input.formData, definition.kind),
      ...(definition.recommendedDefault === undefined
        ? {}
        : { recommendedDefault: definition.recommendedDefault }),
    });

    // Upsert on (project, field): re-answering replaces the answer rather than appending a second
    // one. Two answers to one question would make "what did the user say?" ambiguous.
    const existing = await withDatabase((db) =>
      db
        .select({ id: intakeAnswers.id })
        .from(intakeAnswers)
        .where(
          and(
            eq(intakeAnswers.projectId, input.projectId),
            eq(intakeAnswers.fieldId, definition.id),
          ),
        ),
    );

    const row = {
      // The tenant key, which row-level security on intake_answers compares against. It used to be
      // left NULL, which is why the table could not carry a policy at all.
      organizationId: project.organizationId,
      projectId: input.projectId,
      fieldId: field.fieldId,
      category: field.category,
      value: field.value,
      state: field.state,
      provenance: field.provenance,
      confidence: field.confidence,
      updatedAt: new Date(),
    };

    const existingId = existing[0]?.id;
    await withDatabase(async (db) => {
      if (existingId === undefined) await db.insert(intakeAnswers).values(row);
      else await db.update(intakeAnswers).set(row).where(eq(intakeAnswers.id, existingId));
    });

    logger.info('intake answer recorded', {
      projectId: input.projectId,
      fieldId: definition.id,
      state: field.state,
      // The value is the user's own project data and is not logged (plan §26).
    });

    return { kind: 'ok' };
  } catch (error) {
    logger.error('failed to record intake answer', {
      err: toAppError(error),
      fieldId: input.fieldId,
    });
    return { kind: 'redirect', to: `/intake/${input.projectId}?error=failed` };
  }
}

/**
 * Extract the submitted value, shaped by the field kind.
 *
 * Returns `null` for anything empty, so a blank submission records "no value" rather than an empty
 * string — which would satisfy the "has a value" invariant while meaning nothing.
 */
function readValue(formData: FormData, kind: string): unknown {
  if (kind === 'multiSelect') {
    const values = formData
      .getAll('value')
      .map(String)
      .filter((v) => v.length > 0);
    return values.length === 0 ? null : values;
  }

  const raw = formData.get('value');
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;

  const text = raw.trim();

  if (kind === 'boolean') return text === 'true';

  if (kind === 'number' || kind === 'currency') {
    const parsed = Number(text);
    // A non-numeric value in a number field is discarded rather than stored as text: the estimation
    // engine would otherwise receive a string where it expects an amount.
    return Number.isFinite(parsed) ? parsed : null;
  }

  return text;
}
