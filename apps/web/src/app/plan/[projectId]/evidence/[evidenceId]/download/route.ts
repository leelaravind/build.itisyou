import { and, eq } from 'drizzle-orm';
import { evidence } from '@govintel/db/schema';
import { ALLOWED_MIME_TYPES } from '@govintel/governance/evidence';
import { logger } from '@govintel/shared/logging';
import { withDatabase } from '../../../../../../lib/server/database.ts';
import { readArtefact, safeDownloadName } from '../../../../../../lib/server/evidence-storage.ts';
import { loadPlanRows } from '../../../actions.ts';

/**
 * Download one evidence artefact.
 *
 * Contract: plan §3.2 (signed access to stored evidence), gap-spec §35 (signed download URLs,
 * content-disposition safety), §32 (the recorded hash is what makes it evidence).
 *
 * ## Why this is a route and not a signed URL
 *
 * §35 asks for signed download URLs. R2 accessed through a Worker binding does not mint presigned
 * URLs — that is an S3-API concept, and reaching for it would mean giving the bucket a second,
 * credentialed access path purely to satisfy the letter of a requirement.
 *
 * Serving through the Worker is the stronger reading of the same requirement. A presigned URL is a
 * bearer token in a query string: it is copied into chat messages, logged by proxies, and remains
 * valid for whoever holds it until it expires. This route re-checks ownership on **every** request
 * against the caller's own session, so a link pasted somewhere else is worth nothing to the person
 * who finds it. The bucket itself stays private with no public route at all.
 *
 * The deviation is deliberate and recorded here rather than in a checklist that says "signed URLs:
 * yes".
 */

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; evidenceId: string }> },
): Promise<Response> {
  const { projectId, evidenceId } = await params;

  /*
   * Ownership first, and through the same loader the pages use.
   *
   * `loadPlanRows` returns null for a project this caller does not own, which is what makes an
   * unknown id and a forbidden one indistinguishable from outside. A 403 here would confirm the
   * artefact exists.
   */
  const owned = await loadPlanRows(projectId);
  if (owned === null) return notFound();

  const [record] = await withDatabase((db) =>
    db
      .select()
      .from(evidence)
      // Scoped by project as well as id: an id alone would serve another project's artefact to
      // anybody who owned any project at all.
      .where(and(eq(evidence.id, evidenceId), eq(evidence.projectId, projectId)))
      .limit(1),
  );

  if (record?.storageKey == null) return notFound();

  const object = await readArtefact(record.storageKey);

  if (object === undefined) {
    /*
     * The row exists and the object does not. Worth logging loudly: it means either the bucket is
     * unreachable or an artefact has been lost, and a record pointing at nothing is precisely the
     * state evidence must never quietly be in.
     */
    logger.error('evidence artefact missing from storage', { projectId, evidenceId });
    return notFound();
  }

  const mimeType = record.mimeType ?? 'application/octet-stream';
  const extension = ALLOWED_MIME_TYPES[mimeType]?.[0] ?? '';

  return new Response(object.body, {
    headers: {
      /*
       * The stored type, which was checked against the allowlist before anything was written, so
       * this cannot be a type the browser will execute.
       */
      'content-type': mimeType,
      /*
       * `attachment`, always. Even an allowlisted type is safer downloaded than rendered, and the
       * filename is constructed from the label rather than escaped from user input — a quote or a
       * newline in a filename ends the header value and begins something else.
       */
      'content-disposition': `attachment; filename="${safeDownloadName(record.label, extension)}"`,
      'x-content-type-options': 'nosniff',
      /*
       * The recorded hash travels with the file so whoever downloads it can check they have the
       * artefact the record describes, without asking anybody.
       */
      ...(record.contentHash === null ? {} : { 'x-evidence-sha256': record.contentHash }),
      // Private and per-caller: this response depends entirely on who asked.
      'cache-control': 'private, no-store',
    },
  });
}

function notFound(): Response {
  return new Response('Not found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
