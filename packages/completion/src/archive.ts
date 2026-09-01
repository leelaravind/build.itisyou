/**
 * Archiving.
 *
 * Archiving is the last thing that happens to a project, and it is the operation people are most
 * likely to confuse with deletion. The distinction this module enforces is that **an archived project
 * is still readable** — it is frozen, not gone. The whole reason for building governance records is
 * that somebody reads them later, and later is usually after the project has ended.
 *
 * Two refusals carry the weight.
 *
 * **Archiving cannot make regulatory evidence unreachable.** A retention obligation set by somebody
 * outside the project does not end because the project did, and an archive that quietly puts such
 * evidence out of reach satisfies the letter of retention while defeating it.
 *
 * **Archiving a project that has not closed is a separate act, and it says so.** There are legitimate
 * reasons — the work was cancelled, the client left — and none of them are "it finished". An archive
 * that renders a cancelled project identically to a completed one destroys the only distinction that
 * matters about it.
 *
 * Contract: `MASTER_IMPLEMENTATION_PLAN.md` Phase 14; gap-spec §38 (retention), §39 (export).
 */

import type { Evidence } from '@govintel/governance/evidence';

/* -------------------------------------------------------------------------- */
/* Reasons                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Why a project is being archived.
 *
 * `COMPLETED` and `CANCELLED` are different facts about a project and stay separate forever. A
 * portfolio that renders them identically has lost the only information anybody wants from it later:
 * which of these finished, and which stopped.
 */
export const ARCHIVE_REASONS = [
  'COMPLETED',
  'CANCELLED',
  'SUPERSEDED_BY_ANOTHER_PROJECT',
  'ON_HOLD_INDEFINITELY',
] as const;

export type ArchiveReason = (typeof ARCHIVE_REASONS)[number];

export const REASON_MEANING: Readonly<Record<ArchiveReason, string>> = {
  COMPLETED:
    'The project finished and passed its closure criteria, or closed on accepted exceptions.',
  CANCELLED:
    'The project stopped before finishing. Not a failure of the record — the record is the most useful thing left, because somebody will ask why.',
  SUPERSEDED_BY_ANOTHER_PROJECT:
    'The work continues elsewhere. The successor should be named, or this becomes a dead end for anybody following the trail.',
  ON_HOLD_INDEFINITELY:
    'Paused with no restart date. Deliberately distinct from cancelled: nobody has decided to stop, which means somebody may decide to resume.',
};

export interface ArchiveRequest {
  readonly projectId: string;
  readonly reason: ArchiveReason;
  /** Why, beyond the category. The sentence somebody reads first when they find this in two years. */
  readonly narrative: string;
  readonly archivedBy: string;
  readonly archivedAt: string;
  /** Required when superseded. */
  readonly successorProjectId?: string;
  /** Whether closure criteria were assessed and passed (or rested on accepted exceptions). */
  readonly closureAssessed: boolean;
}

export const ARCHIVE_REFUSALS = [
  'NO_NARRATIVE',
  'NO_ARCHIVER',
  'NO_SUCCESSOR',
  'REGULATORY_EVIDENCE_UNREACHABLE',
  'CLAIMS_COMPLETION_WITHOUT_CLOSURE',
] as const;

export type ArchiveRefusal = (typeof ARCHIVE_REFUSALS)[number];

export interface Refusal {
  readonly refusal: ArchiveRefusal;
  readonly reason: string;
}

export interface ArchiveRecord {
  readonly projectId: string;
  readonly reason: ArchiveReason;
  readonly narrative: string;
  readonly archivedBy: string;
  readonly archivedAt: string;
  readonly successorProjectId?: string;
  /**
   * Evidence that must remain reachable after archiving, by id.
   *
   * Named on the record rather than left implicit, so a later retention sweep operating on archived
   * projects has something to check against rather than a rule it has to remember.
   */
  readonly retainedEvidence: readonly string[];
  /** What an archived project still allows. Recorded so nobody has to infer it. */
  readonly readable: true;
  readonly editable: false;
}

/* -------------------------------------------------------------------------- */
/* Checking                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Whether this project can be archived, and what would be wrong with it.
 *
 * `evidence` is passed in rather than fetched, so the retention rule is testable without a database —
 * and the retention rule is the one worth being certain about, because breaking it is invisible until
 * somebody asks for the evidence and it is not there.
 */
export function checkArchive(
  request: ArchiveRequest,
  evidence: readonly Evidence[],
): readonly Refusal[] {
  const refusals: Refusal[] = [];

  if (request.narrative.trim() === '') {
    refusals.push({
      refusal: 'NO_NARRATIVE',
      reason:
        'The category says what kind of ending this was; the narrative says what happened. Somebody finding this project in two years reads the narrative first, and a category alone tells them nothing they can act on.',
    });
  }

  if (request.archivedBy.trim() === '') {
    refusals.push({
      refusal: 'NO_ARCHIVER',
      reason:
        'An archive nobody performed cannot be asked about, and archiving is the last chance to ask.',
    });
  }

  if (
    request.reason === 'SUPERSEDED_BY_ANOTHER_PROJECT' &&
    request.successorProjectId === undefined
  ) {
    refusals.push({
      refusal: 'NO_SUCCESSOR',
      reason:
        'Superseded by nothing named is a dead end for anybody following the trail. They learn the work moved and not where.',
    });
  }

  if (request.reason === 'COMPLETED' && !request.closureAssessed) {
    /*
     * The refusal that stops archiving becoming a way around the closure gate.
     *
     * Archiving a project is always allowed — work gets cancelled, clients leave. Archiving it as
     * *completed* is a claim about the project, and it is the same claim the closure gate exists to
     * check. Letting it through here would make the entire gate optional.
     */
    refusals.push({
      refusal: 'CLAIMS_COMPLETION_WITHOUT_CLOSURE',
      reason:
        'Archiving as completed claims the project finished, which is exactly what the closure criteria decide. Archive it as cancelled or on hold if it did not close — those are honest, and this would make the closure gate optional.',
    });
  }

  const regulatory = evidence.filter(
    (item) => item.retention === 'REGULATORY' || item.retention === 'INDEFINITE',
  );

  const unreachable = regulatory.filter((item) => item.state === 'QUARANTINED');

  if (unreachable.length > 0) {
    /*
     * Quarantined regulatory evidence.
     *
     * A retention obligation set by somebody outside the project does not end because the project
     * did. Archiving with such evidence in an unusable state satisfies the letter of retention while
     * defeating it, and the breach is invisible until somebody asks for the evidence.
     */
    refusals.push({
      refusal: 'REGULATORY_EVIDENCE_UNREACHABLE',
      reason: `${String(unreachable.length)} evidence record(s) under a regulatory or indefinite retention obligation are quarantined. That obligation does not end because the project did, and archiving now would satisfy the letter of retention while defeating it — invisibly, until somebody asks for the evidence.`,
    });
  }

  return refusals;
}

/**
 * Produce the archive record.
 *
 * Returns `undefined` when the request would be refused, so a caller cannot archive by ignoring the
 * check — the only way to obtain a record is to pass.
 */
export function archive(
  request: ArchiveRequest,
  evidence: readonly Evidence[],
): ArchiveRecord | undefined {
  if (checkArchive(request, evidence).length > 0) return undefined;

  return {
    projectId: request.projectId,
    reason: request.reason,
    narrative: request.narrative,
    archivedBy: request.archivedBy,
    archivedAt: request.archivedAt,
    ...(request.successorProjectId === undefined
      ? {}
      : { successorProjectId: request.successorProjectId }),
    retainedEvidence: evidence
      .filter((item) => item.retention === 'REGULATORY' || item.retention === 'INDEFINITE')
      .map((item) => item.id)
      .sort(),
    readable: true,
    editable: false,
  };
}

/**
 * What an archived project still permits.
 *
 * Exported as a function rather than left to each caller's judgement, because "archived" is exactly
 * the kind of state where two parts of a system quietly disagree about what it means — one treating
 * it as read-only and another as deleted.
 */
export function permittedOnArchived(operation: string): boolean {
  const READ_ONLY = ['read', 'export', 'verify', 'audit-query'];
  return READ_ONLY.includes(operation);
}
