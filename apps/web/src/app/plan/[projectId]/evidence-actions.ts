'use server';

import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { approvals, evidence, projects } from '@govintel/db/schema';
import { evidencePurposes, manualCriteria } from '@govintel/rules/gates';
import { EVIDENCE_TYPES, checkUpload, type UploadRefusal } from '@govintel/governance/evidence';
import { APPROVABLE_SUBJECTS } from '@govintel/governance/approval';
import { toAppError } from '@govintel/shared/errors';
import { logger } from '@govintel/shared/logging';
import { withDatabase } from '../../../lib/server/database.ts';
import { evaluateForProject, loadIntake } from '../../../lib/server/project-rules.ts';
import {
  evidenceBucket,
  hashBytes,
  storeArtefact,
  type StoredArtefact,
} from '../../../lib/server/evidence-storage.ts';
import { readActiveGuestSessionId } from '../../../lib/server/session.ts';
import { recordAudit } from '../../../lib/server/audit.ts';
import { checkRateLimit } from '../../../lib/server/rate-limit.ts';
import { loadProjectGraph } from '../../../lib/server/project-graph.ts';

/**
 * Recording evidence and approvals.
 *
 * Contract: gap-spec §32 (evidence records), §33 (approval system), §35 (upload controls),
 * plan §6 (approvals gate the lifecycle).
 *
 * ## What this unlocks
 *
 * Seventeen MANUAL gate criteria, sixteen of them blocking, across eight gates. Every one was
 * permanently unsatisfiable: they resolve against `EVIDENCE` and `APPROVAL` nodes in the twin graph,
 * and nothing in the product created either. Eight of eleven gates could never pass, which meant the
 * lifecycle could never advance past `PLANNING`, which meant the gates were decoration.
 *
 * ## Files are deliberately not here yet
 *
 * §35 requires randomised keys, no user-controlled paths, signed downloads and content-disposition
 * safety for uploads. That is a whole surface with its own failure modes, and the R2 bucket exists
 * but nothing reads or writes it (KI-061).
 *
 * A link or an attestation satisfies the same criteria and is honest about what it is: §32 grades
 * evidence by type, and `MANUAL_ATTESTATION` is the weakest grade rather than an absent one. The
 * projection reflects that — an attestation carries `MEDIUM` confidence, an artefact with a content
 * hash carries `HIGH`. Shipping the upload path badly would be worse than shipping the grading
 * honestly.
 */

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

type Outcome = { kind: 'ok' } | { kind: 'refused'; reason: string };

/** The project, if the caller owns it and it is open to change. */
async function ownedProject(projectId: string) {
  const sessionId = await readActiveGuestSessionId();

  const [project] = await withDatabase((db) =>
    db.select().from(projects).where(eq(projects.id, projectId)),
  );

  if (project?.guestSessionId == null || project.guestSessionId !== sessionId) return null;

  return { project, sessionId };
}

export async function recordEvidence(formData: FormData): Promise<void> {
  const projectId = readString(formData, 'projectId');
  if (projectId.length === 0) redirect('/start');

  if (!(await checkRateLimit('evidence-record'))) {
    redirect(`/plan/${projectId}/evidence?error=rate-limited`);
  }

  const outcome = await addEvidence(projectId, formData);

  revalidatePath(`/plan/${projectId}/evidence`);
  revalidatePath(`/plan/${projectId}`);
  revalidatePath(`/plan/${projectId}/rules`);

  if (outcome.kind === 'refused') {
    redirect(`/plan/${projectId}/evidence?error=${encodeURIComponent(outcome.reason)}`);
  }

  redirect(`/plan/${projectId}/evidence?recorded=1`);
}

async function addEvidence(projectId: string, formData: FormData): Promise<Outcome> {
  try {
    const owned = await ownedProject(projectId);
    if (owned === null) return { kind: 'refused', reason: 'not-found' };

    const { project, sessionId } = owned;

    if (project.archivedAt !== null) return { kind: 'refused', reason: 'archived' };

    const purpose = readString(formData, 'purpose');
    const type = readString(formData, 'type');
    const label = readString(formData, 'label');
    const note = readString(formData, 'note');
    const uri = readString(formData, 'uri');

    /*
     * The purpose must be one the catalogue actually asks for.
     *
     * Free text here would let somebody record evidence for `code_review` and wonder why the gate
     * stayed red — a mismatch that is invisible, because both the record and the gate look correct
     * on their own.
     */
    const { emittedGates } = evaluateForProject({
      projectId,
      projectType: project.projectType,
      lifecycleState: project.lifecycleState,
      intake: await loadIntake(projectId),
    });

    if (!evidencePurposes(emittedGates).includes(purpose)) {
      return { kind: 'refused', reason: 'unknown-purpose' };
    }

    if (!(EVIDENCE_TYPES as readonly string[]).includes(type)) {
      return { kind: 'refused', reason: 'unknown-type' };
    }

    if (label.length === 0) return { kind: 'refused', reason: 'label-required' };

    const file = formData.get('file');
    const hasFile = file instanceof File && file.size > 0;

    /*
     * A file counts as substance. Mirrors the database constraint, checked here so the user gets a
     * message rather than a 500.
     */
    if (note.length === 0 && uri.length === 0 && !hasFile) {
      return { kind: 'refused', reason: 'substance-required' };
    }

    if (uri.length > 0 && !isSafeUri(uri)) return { kind: 'refused', reason: 'unsafe-uri' };

    let artefact: StoredArtefact | undefined;

    if (hasFile) {
      const bytes = await file.arrayBuffer();

      /*
       * §35's checks run against the real bytes, before anything is written.
       *
       * `checkUpload` has existed since Phase 10 with no caller. Its `hash` argument is computed
       * here rather than supplied by the browser, because a hash the client sends is a claim about
       * the file and a hash taken from the bytes is a fact about it -- and telling those apart later
       * is the whole reason for recording one.
       */
      const refusals = checkUpload({
        filename: file.name,
        mimeType: file.type,
        sizeBytes: bytes.byteLength,
        hash: await hashBytes(bytes),
        uploadedBy: sessionId,
        relatedEntities: [projectId],
      });

      if (refusals.length > 0) {
        logger.warn('evidence upload refused', {
          projectId,
          refusals: refusals.map((r) => r.refusal),
        });
        return { kind: 'refused', reason: refusalReason(refusals[0]?.refusal) };
      }

      artefact = await storeArtefact({
        organizationId: project.organizationId,
        projectId,
        bytes,
        mimeType: file.type,
        uploadedBy: sessionId,
      });

      /*
       * No bucket means no upload, and no upload must not look like a successful one. A record
       * carrying a storage key for an object that was never written is indistinguishable from
       * evidence right up to the moment somebody needs the file.
       */
      if (artefact === undefined) return { kind: 'refused', reason: 'storage-unavailable' };
    }

    await withDatabase(async (db) => {
      const [row] = await db
        .insert(evidence)
        .values({
          organizationId: project.organizationId,
          projectId,
          purpose,
          type,
          label,
          note: note.length === 0 ? null : note,
          uri: uri.length === 0 ? null : uri,
          ...(artefact === undefined
            ? {}
            : {
                storageKey: artefact.storageKey,
                contentHash: artefact.contentHash,
                mimeType: artefact.mimeType,
                sizeBytes: artefact.sizeBytes,
              }),
          collectedBy: sessionId,
        })
        .returning({ id: evidence.id });

      await recordAudit(db, {
        organizationId: project.organizationId,
        projectId,
        action: 'EVIDENCE_RECORDED',
        entityType: 'EVIDENCE',
        ...(row === undefined ? {} : { entityId: row.id }),
        actorGuestSessionId: sessionId,
        summary: {
          purpose,
          type,
          label,
          // The note is the user's own words and may describe the system in detail. The audit log is
          // retained far longer than most data; what it needs is that evidence was recorded and for
          // what, not its contents.
          hasNote: note.length > 0,
          hasUri: uri.length > 0,
          // The hash, not the file: it identifies the artefact without reproducing any of it, and it
          // is what an auditor would compare against later.
          ...(artefact === undefined
            ? { hasFile: false }
            : { hasFile: true, contentHash: artefact.contentHash, sizeBytes: artefact.sizeBytes }),
        },
      });
    });

    logger.info('evidence recorded', { projectId, purpose, type });
    return { kind: 'ok' };
  } catch (error) {
    logger.error('failed to record evidence', { err: toAppError(error), projectId });
    return { kind: 'refused', reason: 'failed' };
  }
}

/**
 * A §35 refusal, as a slug the evidence page has a sentence for.
 *
 * The domain module's `reason` text is written for a developer reading a test failure -- several
 * sentences explaining why the rule exists. What the user needs is one sentence about their file, so
 * the two are kept separate rather than one being bent into the other's job.
 */
function refusalReason(refusal: UploadRefusal | undefined): string {
  switch (refusal) {
    case 'MIME_NOT_ALLOWED':
      return 'file-type';
    case 'EXTENSION_MISMATCH':
      return 'file-mismatch';
    case 'TOO_LARGE':
      return 'file-too-large';
    case 'EMPTY':
      return 'file-empty';
    /*
     * The remaining three cannot happen from this form -- the hash and the uploader are supplied
     * here, and the evidence is always attached to a project. Named rather than folded into a
     * default so that a new refusal in the domain module is a compile error here, which is where
     * somebody would otherwise have to remember to look.
     */
    case 'NO_HASH':
    case 'NO_UPLOADER':
    case 'ATTACHED_TO_NOTHING':
    case undefined:
      return 'failed';
  }
}

export async function recordApproval(formData: FormData): Promise<void> {
  const projectId = readString(formData, 'projectId');
  if (projectId.length === 0) redirect('/start');

  if (!(await checkRateLimit('evidence-record'))) {
    redirect(`/plan/${projectId}/evidence?error=rate-limited`);
  }

  const outcome = await addApproval(projectId, formData);

  revalidatePath(`/plan/${projectId}/evidence`);
  revalidatePath(`/plan/${projectId}`);

  if (outcome.kind === 'refused') {
    redirect(`/plan/${projectId}/evidence?error=${encodeURIComponent(outcome.reason)}`);
  }

  redirect(`/plan/${projectId}/evidence?approved=1`);
}

async function addApproval(projectId: string, formData: FormData): Promise<Outcome> {
  try {
    const owned = await ownedProject(projectId);
    if (owned === null) return { kind: 'refused', reason: 'not-found' };

    const { project, sessionId } = owned;

    if (project.archivedAt !== null) return { kind: 'refused', reason: 'archived' };

    const subjectType = readString(formData, 'subjectType');
    const comment = readString(formData, 'comment');

    if (!(APPROVABLE_SUBJECTS as readonly string[]).includes(subjectType)) {
      return { kind: 'refused', reason: 'unknown-subject' };
    }

    /*
     * A reason is required on any decision, including approval (§33, `decide`).
     *
     * An approval with no stated reason is a signature with no argument behind it, and it is the
     * approvals nobody had to justify that turn out later to have been nobody's actual judgement.
     */
    if (comment.length === 0) return { kind: 'refused', reason: 'reason-required' };

    await withDatabase(async (db) => {
      const now = new Date();

      const [row] = await db
        .insert(approvals)
        .values({
          organizationId: project.organizationId,
          projectId,
          subjectType,
          subjectId: projectId,
          /*
           * Bound to the project's current version. This is what makes the approval mean something
           * later: a change bumps `projects.version`, the approval becomes stale, and the lifecycle
           * machine refuses to advance on it (§33, §49).
           */
          subjectVersion: project.version,
          requestedBy: sessionId,
          approverRole: 'PROJECT_OWNER',
          state: 'APPROVED',
          approverUser: sessionId,
          decidedAt: now,
          comment,
        })
        .returning({ id: approvals.id });

      await recordAudit(db, {
        organizationId: project.organizationId,
        projectId,
        action: 'APPROVAL_GRANTED',
        entityType: 'APPROVAL',
        ...(row === undefined ? {} : { entityId: row.id }),
        actorGuestSessionId: sessionId,
        reason: comment,
        summary: {
          subjectType,
          subjectVersion: project.version,
          approverRole: 'PROJECT_OWNER',
        },
      });
    });

    logger.info('approval recorded', { projectId, subjectType, subjectVersion: project.version });
    return { kind: 'ok' };
  } catch (error) {
    logger.error('failed to record approval', { err: toAppError(error), projectId });
    return { kind: 'refused', reason: 'failed' };
  }
}

/**
 * Whether a URI is safe to store and later render as a link.
 *
 * `http` and `https` only. `javascript:` is the obvious attack and `data:` the less obvious one — a
 * `data:text/html` link renders attacker-controlled markup from this origin the moment somebody
 * clicks it. An allowlist is the only version of this check that is not a race with the next scheme
 * somebody invents.
 */
function isSafeUri(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Every MANUAL criterion with whether this project satisfies it, for the evidence page. */
export async function evidenceStatus(projectId: string) {
  const owned = await ownedProject(projectId);
  if (owned === null) return null;

  const { project } = owned;
  const {
    graph,
    evidence: records,
    approvals: decisions,
  } = await loadProjectGraph(projectId, project.organizationId);

  /*
   * Including what the rules demand, so the evidence page offers the criteria that are actually
   * blocking this project's gates rather than only the catalogue's fixed seventeen.
   */
  const { emittedGates } = evaluateForProject({
    projectId,
    projectType: project.projectType,
    lifecycleState: project.lifecycleState,
    intake: await loadIntake(projectId),
    graph,
  });

  const satisfied = new Set(
    graph
      .nodesOfClass('EVIDENCE')
      .filter((node) => node.state === 'ACTIVE')
      .map((node) => String(node.attributes.purpose)),
  );

  const hasApproval = graph.nodesOfClass('APPROVAL').some((node) => node.state === 'ACTIVE');

  return {
    project,
    records,
    approvals: decisions,
    /*
     * Whether this deployment can actually store a file.
     *
     * The page uses it to decide whether to offer an upload at all. Offering one that always refuses
     * is worse than not offering it: the user reads the refusal as being about their file.
     */
    storageAvailable: (await evidenceBucket()) !== undefined,
    criteria: manualCriteria(emittedGates).map((criterion) => ({
      ...criterion,
      satisfied:
        criterion.evidencePurpose === null ? hasApproval : satisfied.has(criterion.evidencePurpose),
    })),
  };
}
