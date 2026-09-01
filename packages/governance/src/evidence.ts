/**
 * The evidence model.
 *
 * §32 lists nine evidence types and twelve fields every record must store. The list is not
 * bureaucratic: each field is what makes evidence *evidence* rather than a file somebody kept.
 *
 * The one that carries the most weight is the hash. Evidence exists to be checked by somebody who
 * was not there — an auditor, a customer, the next team, the same team in two years. A record with no
 * hash cannot be distinguished from a record whose artefact was swapped, and at that point it is
 * testimony rather than evidence.
 *
 * The design position that matters most here: **evidence failing its integrity check is quarantined,
 * never deleted.** The fact that something was tampered with is itself the most important thing the
 * system knows, and deleting the record destroys it. A quarantined record still says what it claimed,
 * who uploaded it and when — which is exactly what an investigation needs.
 *
 * Contract: gap-spec §32, §35 (upload security), §38 (retention).
 */

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

/** §32's list, in the order it names them. */
export const EVIDENCE_TYPES = [
  'TEST_REPORT',
  'SCREENSHOT',
  'LOG_EXTRACT',
  'DEPLOYMENT_RECORD',
  'SCAN_REPORT',
  'APPROVAL_ARTIFACT',
  'DOCUMENT',
  'EXTERNAL_REPORT',
  'MANUAL_ATTESTATION',
] as const;

export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

/**
 * How much weight each type carries, and why.
 *
 * §32 names manual attestation "if unavoidable", and that qualifier is worth preserving in the model
 * rather than losing in prose. An attestation is somebody's word; it is sometimes the only thing
 * available, and it should never sit in a report looking identical to a scan output.
 */
export const EVIDENCE_STRENGTH: Readonly<Record<EvidenceType, string>> = {
  TEST_REPORT:
    'A machine ran something and recorded what happened. Reproducible if the inputs were kept.',
  SCREENSHOT:
    'Shows what one person saw at one moment. Cannot show what was happening underneath, and is the easiest kind to produce from a state that was not real.',
  LOG_EXTRACT:
    'What the system recorded about itself. Strong for sequence and timing, weak for anything the logger was not asked to record.',
  DEPLOYMENT_RECORD: 'What was deployed, where, and by whom.',
  SCAN_REPORT:
    'What a tool found when it looked. Evidence about what was checked, never about what exists.',
  APPROVAL_ARTIFACT: 'A named person recorded a decision.',
  DOCUMENT: 'A written statement. As strong as whoever wrote it and whoever reviewed it.',
  EXTERNAL_REPORT: 'Produced by somebody outside the project, which is its whole value.',
  MANUAL_ATTESTATION:
    'Somebody’s word that something is true. §32 permits this only where nothing else is available, and it should never sit in a report looking identical to a scan output.',
};

/**
 * §38 retention classes.
 *
 * Held on the evidence itself rather than derived from its type, because two test reports can have
 * entirely different retention obligations depending on what they were evidence *of* — and deriving
 * it would quietly delete the one that mattered.
 */
export const RETENTION_CLASSES = [
  'TRANSIENT',
  'PROJECT_LIFETIME',
  'REGULATORY',
  'INDEFINITE',
] as const;

export type RetentionClass = (typeof RETENTION_CLASSES)[number];

export const EVIDENCE_STATES = ['CURRENT', 'SUPERSEDED', 'QUARANTINED'] as const;

export type EvidenceState = (typeof EVIDENCE_STATES)[number];

/** §32's required fields, all of them. */
export interface Evidence {
  /** Immutable. Never reissued, so a reference to it always resolves to the same thing or to nothing. */
  readonly id: string;
  readonly projectId: string;
  readonly type: EvidenceType;
  readonly label: string;

  /** Content hash of the artefact. The field that makes this evidence rather than testimony. */
  readonly hash: string;
  readonly mimeType: string;
  readonly sizeBytes: number;

  readonly uploadedBy: string;
  readonly uploadedAt: string;

  /** Node ids this supports. Evidence attached to nothing supports nothing. */
  readonly relatedEntities: readonly string[];

  /** Where it came from, when that is not obvious. A CI run id, a ticket, an auditor's reference. */
  readonly sourceMetadata?: Readonly<Record<string, string>>;

  readonly retention: RetentionClass;
  readonly state: EvidenceState;

  /** Set only on `QUARANTINED`. Why it was quarantined, kept forever. */
  readonly quarantineReason?: string;
}

/* -------------------------------------------------------------------------- */
/* Upload constraints                                                         */
/* -------------------------------------------------------------------------- */

/**
 * §35's MIME allowlist.
 *
 * Deny-by-default. Everything here renders as inert content or is downloaded; nothing in the list can
 * execute in a browser, which is the property the allowlist exists to guarantee rather than a
 * consequence of it.
 *
 * SVG is deliberately **absent**. It is an image to a user and a script host to a browser, and it is
 * the single most common way an image upload becomes stored cross-site scripting.
 */
export const ALLOWED_MIME_TYPES: Readonly<Record<string, readonly string[]>> = {
  'application/pdf': ['.pdf'],
  'application/json': ['.json'],
  'application/xml': ['.xml'],
  'text/plain': ['.txt', '.log'],
  'text/csv': ['.csv'],
  'text/markdown': ['.md'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
  'application/zip': ['.zip'],
};

/** §35. Twenty-five megabytes: large enough for a scan report, small enough to bound abuse. */
export const MAX_EVIDENCE_BYTES = 25 * 1024 * 1024;

export const UPLOAD_REFUSALS = [
  'MIME_NOT_ALLOWED',
  'EXTENSION_MISMATCH',
  'TOO_LARGE',
  'EMPTY',
  'NO_HASH',
  'NO_UPLOADER',
  'ATTACHED_TO_NOTHING',
] as const;

export type UploadRefusal = (typeof UPLOAD_REFUSALS)[number];

export interface UploadCandidate {
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly hash: string;
  readonly uploadedBy: string;
  readonly relatedEntities: readonly string[];
}

export interface Refusal {
  readonly refusal: UploadRefusal;
  readonly reason: string;
}

/**
 * §35's checks, in the order that fails fastest and most cheaply.
 *
 * The extension/MIME consistency check is the one worth explaining: a file claiming
 * `image/png` while named `.html` is not a mistake anybody makes by accident, and accepting the
 * declared MIME alone means the browser gets to decide what the file is at download time.
 */
export function checkUpload(candidate: UploadCandidate): readonly Refusal[] {
  const refusals: Refusal[] = [];

  const allowed = ALLOWED_MIME_TYPES[candidate.mimeType];

  if (allowed === undefined) {
    refusals.push({
      refusal: 'MIME_NOT_ALLOWED',
      reason: `${candidate.mimeType} is not in the allowlist. The list is deny-by-default: nothing on it can execute in a browser, which is a property to guarantee rather than to hope for. SVG is absent for exactly that reason — it is an image to a user and a script host to a browser.`,
    });
  } else {
    const extension = candidate.filename.slice(candidate.filename.lastIndexOf('.')).toLowerCase();

    if (!allowed.includes(extension)) {
      refusals.push({
        refusal: 'EXTENSION_MISMATCH',
        reason: `The file declares ${candidate.mimeType} and is named ${extension}. That combination is not a mistake anybody makes by accident, and trusting the declared type alone lets the browser decide what the file is at download time.`,
      });
    }
  }

  if (candidate.sizeBytes > MAX_EVIDENCE_BYTES) {
    refusals.push({
      refusal: 'TOO_LARGE',
      reason: `${String(candidate.sizeBytes)} bytes exceeds the ${String(MAX_EVIDENCE_BYTES)}-byte limit.`,
    });
  }

  if (candidate.sizeBytes <= 0) {
    refusals.push({
      refusal: 'EMPTY',
      reason:
        'An empty file hashes consistently and proves nothing. It would sit in the evidence list looking exactly like evidence.',
    });
  }

  if (candidate.hash.trim() === '') {
    refusals.push({
      refusal: 'NO_HASH',
      reason:
        'Without a hash this record cannot be distinguished from one whose artefact was swapped, which makes it testimony rather than evidence.',
    });
  }

  if (candidate.uploadedBy.trim() === '') {
    refusals.push({
      refusal: 'NO_UPLOADER',
      reason: 'Evidence nobody produced cannot be asked about.',
    });
  }

  if (candidate.relatedEntities.length === 0) {
    refusals.push({
      refusal: 'ATTACHED_TO_NOTHING',
      reason:
        'Evidence supports a specific claim. Held loose it is a file, and at the point somebody needs it there is no way to know what it was meant to show.',
    });
  }

  return refusals;
}

/* -------------------------------------------------------------------------- */
/* Integrity                                                                  */
/* -------------------------------------------------------------------------- */

export interface EvidenceIntegrity {
  readonly intact: boolean;
  readonly explanation: string;
}

/**
 * Check stored evidence against the artefact as it stands now.
 *
 * The caller supplies the recomputed hash, because this package does not read files — keeping I/O
 * out means the rule about what to do with a mismatch is testable without a filesystem, and that rule
 * is the part worth getting right.
 */
export function verifyEvidence(evidence: Evidence, actualHash: string): EvidenceIntegrity {
  if (evidence.state === 'QUARANTINED') {
    return {
      intact: false,
      explanation:
        evidence.quarantineReason ??
        'Already quarantined. It is retained because the fact that something was wrong is itself worth keeping.',
    };
  }

  if (evidence.hash === actualHash) {
    return {
      intact: true,
      explanation: 'The artefact still hashes to what was recorded when it was uploaded.',
    };
  }

  return {
    intact: false,
    explanation: `The artefact no longer hashes to what was recorded on ${evidence.uploadedAt}. It has been replaced or altered since ${evidence.uploadedBy} uploaded it, and it cannot support any claim until that is explained.`,
  };
}

/**
 * Quarantine rather than delete.
 *
 * The central decision in this module. The fact that evidence was tampered with is the most important
 * thing the system knows about it, and deleting the record destroys exactly that. A quarantined
 * record still says what it claimed, who uploaded it and when — which is what an investigation needs
 * and what a deletion would remove.
 *
 * It also means the *absence* of a piece of evidence stays meaningful. If tampered evidence were
 * deleted, a missing record could mean "never existed" or "was removed", and nobody could tell.
 */
export function quarantine(evidence: Evidence, reason: string): Evidence {
  return {
    ...evidence,
    state: 'QUARANTINED',
    quarantineReason: reason,
  };
}

/**
 * Whether this evidence can currently support a claim.
 *
 * Superseded evidence cannot: something newer replaced it, and using the old one would report a
 * result that has been overtaken. It is retained, because what was true before is part of the record.
 */
export function canSupportAClaim(evidence: Evidence): boolean {
  return evidence.state === 'CURRENT';
}

/* -------------------------------------------------------------------------- */
/* Retention                                                                  */
/* -------------------------------------------------------------------------- */

export const RETENTION_MEANING: Readonly<Record<RetentionClass, string>> = {
  TRANSIENT: 'Useful now, not worth keeping. Deleted on the ordinary schedule.',
  PROJECT_LIFETIME: 'Kept as long as the project exists, and removed with it.',
  REGULATORY:
    'Kept for a period somebody outside the project decides. Cannot be deleted to save space, and cannot be deleted because the project ended.',
  INDEFINITE: 'Kept until somebody makes an explicit decision to remove it.',
};

/**
 * Whether evidence may be deleted under a retention sweep.
 *
 * `REGULATORY` and `INDEFINITE` are refused outright, and quarantined evidence is refused regardless
 * of class — a retention sweep that tidies away the record of tampering is the most convenient
 * possible bug, and it would look like housekeeping working correctly.
 */
export function mayDelete(evidence: Evidence): boolean {
  if (evidence.state === 'QUARANTINED') return false;
  return evidence.retention === 'TRANSIENT' || evidence.retention === 'PROJECT_LIFETIME';
}
