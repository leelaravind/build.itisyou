import 'server-only';

import { logger } from '@govintel/shared/logging';

/**
 * Storing an evidence artefact.
 *
 * Contract: plan §3.2 (object storage with signed access and recorded hashes), gap-spec §35 (twelve
 * upload controls), §32 (a content hash is what makes a record evidence rather than testimony).
 *
 * ## What this closes
 *
 * The `EVIDENCE` bucket has been provisioned and bound since Phase 19 with no code on either side of
 * it (KI-061). Evidence existed as records — a label, a note, sometimes a link — which is enough to
 * satisfy a gate criterion but is not what §35 describes. A note saying "the rollback was rehearsed"
 * is an attestation; the timed log of the rehearsal is evidence, and until now there was nowhere to
 * put one.
 *
 * ## The two rules that shape the key
 *
 * **The key is generated here and never derived from the filename.** A user-controlled path is a
 * traversal waiting for somebody to try it, and a predictable one is an enumeration. The random
 * component is a UUID from the platform's CSPRNG.
 *
 * **The key is prefixed with the tenant.** Not as the authorisation check — that is done in the
 * database before this module is reached, because a key prefix is a naming convention and naming
 * conventions do not refuse anybody. It is there so that an object found loose in the bucket can be
 * attributed, and so a whole tenant's artefacts can be deleted on erasure without a database scan.
 */

/** The binding name declared in `wrangler.toml`. */
const BUCKET_BINDING = 'EVIDENCE';

/**
 * The subset of R2 this module uses.
 *
 * Declared here rather than imported from the Workers types so nothing outside a deployed
 * environment has to resolve them — the same reason `connection-string.ts` describes Hyperdrive with
 * one interface instead of pulling the platform's types into the test runner.
 */
interface StoredObject {
  readonly body: ReadableStream;
  readonly size: number;
  readonly httpMetadata?: { readonly contentType?: string };
}

interface EvidenceBucket {
  put: (
    key: string,
    value: ArrayBuffer,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    },
  ) => Promise<unknown>;
  get: (key: string) => Promise<StoredObject | null>;
  delete: (key: string) => Promise<void>;
}

/**
 * The bucket, or `undefined` when not running on Cloudflare.
 *
 * Absence is an ordinary situation with a correct answer, exactly as it is for Hyperdrive: `next
 * dev` and the test runner have no Workers context. The caller turns it into a refusal the user can
 * read rather than a stack trace, and — importantly — never into a silent success. An upload that
 * appears to work and stores nothing produces a record pointing at an object that does not exist,
 * which is worse than refusing.
 */
export async function evidenceBucket(): Promise<EvidenceBucket | undefined> {
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const context = await getCloudflareContext({ async: true });
    const binding = (context.env as unknown as Record<string, unknown>)[BUCKET_BINDING];

    if (binding === undefined || binding === null) return undefined;

    return binding as EvidenceBucket;
  } catch {
    return undefined;
  }
}

export interface StoredArtefact {
  readonly storageKey: string;
  readonly contentHash: string;
  readonly sizeBytes: number;
  readonly mimeType: string;
}

/** SHA-256, lowercase hex. §32's field, and the one `verifyEvidence` checks against later. */
export async function hashBytes(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);

  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Put the artefact in the bucket.
 *
 * The hash is computed here, over the bytes actually written, rather than taken from the caller. A
 * hash supplied alongside the file is a claim about the file; a hash computed from it is a fact
 * about it, and the entire point of recording one is to be able to tell the difference later.
 */
export async function storeArtefact(input: {
  readonly organizationId: string;
  readonly projectId: string;
  readonly bytes: ArrayBuffer;
  readonly mimeType: string;
  readonly uploadedBy: string;
}): Promise<StoredArtefact | undefined> {
  const bucket = await evidenceBucket();

  if (bucket === undefined) return undefined;

  const storageKey = `${input.organizationId}/${input.projectId}/${crypto.randomUUID()}`;
  const contentHash = await hashBytes(input.bytes);

  await bucket.put(storageKey, input.bytes, {
    httpMetadata: { contentType: input.mimeType },
    /*
     * Metadata for an object found without its row: which project it belonged to and who put it
     * there. Deliberately no filename — it is not needed to serve the object, and storing it keeps
     * user-controlled text in a second place for no gain.
     */
    customMetadata: {
      projectId: input.projectId,
      organizationId: input.organizationId,
      uploadedBy: input.uploadedBy,
      contentHash,
    },
  });

  logger.info('evidence artefact stored', {
    projectId: input.projectId,
    sizeBytes: input.bytes.byteLength,
    mimeType: input.mimeType,
  });

  return {
    storageKey,
    contentHash,
    sizeBytes: input.bytes.byteLength,
    mimeType: input.mimeType,
  };
}

/** Read an artefact back. The caller must already have established that this tenant may have it. */
export async function readArtefact(storageKey: string): Promise<StoredObject | undefined> {
  const bucket = await evidenceBucket();

  if (bucket === undefined) return undefined;

  return (await bucket.get(storageKey)) ?? undefined;
}

/**
 * A filename safe to put in a `Content-Disposition` header.
 *
 * §35 names content-disposition safety specifically, and the attack is not subtle: a filename
 * containing a quote or a newline ends the header value and starts something else. Rather than
 * escaping user text into a header, the name is *constructed* — from the evidence label, reduced to
 * characters that cannot mean anything to a header parser, with the extension taken from the
 * allowlisted MIME type rather than from what the file was called.
 */
export function safeDownloadName(label: string, extension: string): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  return `${base === '' ? 'evidence' : base}${extension}`;
}
