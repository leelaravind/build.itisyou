import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EVIDENCE_TYPES } from '@govintel/governance/evidence';
import { ALLOWED_MIME_TYPES } from '@govintel/governance/evidence';
import { PublicHeader } from '../../../../components/shell/PublicHeader.tsx';
import { MaterialIcon } from '../../../../components/ui/MaterialIcon.tsx';
import { evidenceStatus, recordApproval, recordEvidence } from '../evidence-actions.ts';

/**
 * Evidence and approvals.
 *
 * Contract: gap-spec §32 (evidence records), §33 (approvals), plan §24 locked screens 44 and 46.
 *
 * The surface that makes seventeen MANUAL gate criteria satisfiable. Until now every one of them —
 * sixteen blocking, across eight gates — could never pass, because they resolve against `EVIDENCE`
 * and `APPROVAL` nodes in the twin and nothing in the product created either.
 *
 * The page is built from `manualCriteria()` rather than a hand-written list, so a criterion added to
 * the catalogue appears here without anybody remembering to add it. A criterion nobody can satisfy
 * becomes visible rather than silent, which is how this gap survived nineteen phases.
 */

export const metadata = { title: 'Evidence and approvals' };

const ERRORS: Record<string, string> = {
  'not-found': 'That project could not be found.',
  archived: 'This project is archived, so nothing further can be recorded against it.',
  'unknown-purpose': 'That is not something any gate asks for.',
  'unknown-type': 'That is not a recognised kind of evidence.',
  'label-required':
    'Give the evidence a name, so somebody reading the gate later knows what it is.',
  'substance-required': 'Add a file, a link or a note. Evidence that points at nothing is a claim.',
  'file-type':
    'That kind of file is not accepted. The list is deliberately short and excludes anything a browser would run — SVG included, which is an image to you and a script to a browser.',
  'file-mismatch':
    'The file’s name and its type disagree. That is not a combination that happens by accident.',
  'file-too-large': 'That file is over the 25 MB limit.',
  'file-empty': 'That file is empty. It would sit in the list looking exactly like evidence.',
  'storage-unavailable':
    'File storage is not configured on this deployment, so nothing was saved. Record a link or a note instead.',
  'unsafe-uri': 'Links must be http or https.',
  'reason-required':
    'An approval needs a reason. A signature with no argument behind it is not one.',
  'rate-limited': 'Too many requests just now. Try again in a moment.',
  failed: 'That could not be recorded. Nothing was changed.',
};

export default async function EvidencePage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{
    error?: string;
    recorded?: string;
    approved?: string;
    record?: string;
  }>;
}) {
  const { projectId } = await params;
  const { error, recorded, approved, record: recording } = await searchParams;

  const status = await evidenceStatus(projectId);
  if (status === null) notFound();

  const { project, records, criteria } = status;

  const byGate = new Map<string, typeof criteria>();
  for (const criterion of criteria) {
    byGate.set(criterion.gate, [...(byGate.get(criterion.gate) ?? []), criterion]);
  }

  const satisfiedCount = criteria.filter((c) => c.satisfied).length;
  const blockingUnmet = criteria.filter((c) => c.blocking && !c.satisfied);

  return (
    <div className="min-h-screen bg-background">
      <PublicHeader />

      <main id="main" className="mx-auto flex max-w-content flex-col gap-lg px-md py-xl">
        <header className="flex flex-col gap-sm">
          <p className="font-sans text-label-caps tracking-wider text-on-surface-variant uppercase">
            Evidence and approvals
          </p>
          <h1 className="font-sans text-headline-lg text-on-surface">{project.name}</h1>
          <p className="font-sans text-body-md text-on-surface-variant">
            Some gate criteria cannot be checked automatically — whether a rollback plan exists,
            whether someone reviewed the security findings. They are satisfied by recording what was
            actually done, and by whom.
          </p>
        </header>

        {error === undefined ? null : (
          <p
            role="alert"
            className="flex items-center gap-sm rounded border border-danger/40 bg-danger/10 p-md font-sans text-body-sm text-on-surface"
          >
            <MaterialIcon name="error" size={18} className="text-danger" />
            {ERRORS[error] ?? ERRORS.failed}
          </p>
        )}

        {recorded === undefined && approved === undefined ? null : (
          <p
            role="status"
            className="flex items-center gap-sm rounded border border-success/40 bg-success/10 p-md font-sans text-body-sm text-on-surface"
          >
            <MaterialIcon name="check_circle" size={18} className="text-success" />
            {recorded === undefined ? 'Approval recorded.' : 'Evidence recorded.'}
          </p>
        )}

        <section className="flex flex-col gap-sm rounded-lg border border-outline-variant bg-surface-container-low p-lg">
          <h2 className="font-sans text-headline-sm text-on-surface">
            {satisfiedCount} of {criteria.length} recorded
          </h2>
          <p className="font-sans text-body-sm text-on-surface-variant">
            {blockingUnmet.length === 0
              ? 'Everything the gates ask a person to confirm has been recorded.'
              : `${String(blockingUnmet.length)} of these block a gate until recorded.`}
          </p>
        </section>

        {[...byGate.entries()].map(([gate, items]) => (
          <section key={gate} className="flex flex-col gap-md">
            <h2 className="font-sans text-headline-sm text-on-surface">
              {items[0]?.gateTitle ?? gate}
            </h2>

            <ul className="flex flex-col gap-md">
              {items.map((criterion) => (
                <li
                  key={criterion.key}
                  className="flex flex-col gap-sm rounded-lg border border-outline-variant bg-surface p-md"
                >
                  <div className="flex flex-wrap items-start justify-between gap-sm">
                    <div className="flex flex-col gap-xs">
                      <h3 className="font-sans text-body-lg text-on-surface">
                        {criterion.statement}
                      </h3>
                      <p className="font-sans text-body-sm text-on-surface-variant">
                        {criterion.rationale}
                      </p>
                    </div>

                    <span
                      className={`flex shrink-0 items-center gap-xs font-sans text-body-sm ${
                        criterion.satisfied ? 'text-success' : 'text-on-surface-variant'
                      }`}
                    >
                      <MaterialIcon
                        name={criterion.satisfied ? 'check_circle' : 'radio_button_unchecked'}
                        size={16}
                      />
                      {criterion.satisfied
                        ? 'Recorded'
                        : criterion.blocking
                          ? 'Blocking'
                          : 'Optional'}
                    </span>
                  </div>

                  {/*
                    One form at a time, opened by a link.
                    
                    Every criterion used to carry its own form. That was tolerable at seventeen and
                    became a wall at sixty-four: 64 forms, 504 controls and 731 KB of HTML on one
                    screen, which is not a page anybody reads — and Firefox's accessibility-tree
                    walker overflowed its stack on it, which is how the size was noticed.
                    
                    A link with a query parameter rather than a disclosure element: `<details>` keeps
                    every form in the document and only hides it, so the page stays the same size and
                    stays as hard to navigate with assistive technology. This renders one.
                  */}
                  {criterion.satisfied ? null : recording === criterion.key ? (
                    criterion.evidencePurpose === null ? (
                      <ApprovalForm projectId={projectId} />
                    ) : (
                      <EvidenceForm
                        projectId={projectId}
                        purpose={criterion.evidencePurpose}
                        storageAvailable={status.storageAvailable}
                      />
                    )
                  ) : (
                    <Link
                      href={`/plan/${projectId}/evidence?record=${encodeURIComponent(criterion.key)}#${criterion.key}`}
                      id={criterion.key}
                      className="inline-flex w-fit items-center gap-xs rounded border border-outline-variant px-md py-sm font-sans text-body-sm text-on-surface transition-colors hover:bg-surface-container-high focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                      <MaterialIcon name="add" size={16} />
                      {criterion.evidencePurpose === null
                        ? 'Record an approval'
                        : 'Record evidence'}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}

        {records.length === 0 ? null : (
          <section className="flex flex-col gap-md">
            <h2 className="font-sans text-headline-sm text-on-surface">What has been recorded</h2>
            <ul className="flex flex-col gap-sm">
              {records.map((record) => (
                <li
                  key={record.id}
                  className="flex flex-col gap-xs rounded border border-outline-variant bg-surface p-md"
                >
                  <div className="flex flex-wrap items-baseline gap-sm">
                    <span className="font-sans text-body-md text-on-surface">{record.label}</span>
                    <span className="rounded-full border border-outline-variant px-sm py-[2px] font-sans text-body-sm text-on-surface-variant">
                      {record.purpose}
                    </span>
                  </div>
                  {record.note === null ? null : (
                    <p className="font-sans text-body-sm text-on-surface-variant">{record.note}</p>
                  )}
                  {record.uri === null ? null : (
                    <a
                      href={record.uri}
                      rel="noreferrer noopener nofollow"
                      target="_blank"
                      className="font-sans text-body-sm text-primary underline"
                    >
                      {record.uri}
                    </a>
                  )}
                  {record.storageKey === null ? null : (
                    <div className="flex flex-wrap items-center gap-sm">
                      <a
                        href={`/plan/${projectId}/evidence/${record.id}/download`}
                        className="inline-flex items-center gap-xs font-sans text-body-sm text-primary underline"
                      >
                        <MaterialIcon name="download" size={16} />
                        Download the artefact
                      </a>
                      {/* The hash is shown, not hidden: it is what lets somebody check the file they
                          downloaded is the one this record describes. Truncated for reading; the
                          download carries the whole thing in a header. */}
                      {record.contentHash === null ? null : (
                        <span className="font-mono text-data-mono-sm text-on-surface-variant">
                          sha256 {record.contentHash.slice(0, 12)}…
                        </span>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <Link
          href={`/plan/${projectId}`}
          className="font-sans text-body-md text-primary underline underline-offset-4"
        >
          Back to the plan
        </Link>
      </main>
    </div>
  );
}

function EvidenceForm({
  projectId,
  purpose,
  storageAvailable,
}: {
  projectId: string;
  purpose: string;
  storageAvailable: boolean;
}) {
  return (
    <form
      action={recordEvidence}
      className="flex flex-col gap-sm border-t border-outline-variant pt-sm"
    >
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="purpose" value={purpose} />

      <div className="flex flex-col gap-xs">
        <label htmlFor={`label-${purpose}`} className="font-sans text-body-sm text-on-surface">
          What is it
        </label>
        <input
          id={`label-${purpose}`}
          name="label"
          required
          className="rounded border border-outline-variant bg-surface px-sm py-xs font-sans text-body-sm text-on-surface"
          placeholder="Rollback plan, reviewed 12 March"
        />
      </div>

      <div className="flex flex-col gap-xs">
        <label htmlFor={`type-${purpose}`} className="font-sans text-body-sm text-on-surface">
          Kind of evidence
        </label>
        <select
          id={`type-${purpose}`}
          name="type"
          defaultValue="MANUAL_ATTESTATION"
          className="rounded border border-outline-variant bg-surface px-sm py-xs font-sans text-body-sm text-on-surface"
        >
          {EVIDENCE_TYPES.map((type) => (
            <option key={type} value={type}>
              {type.toLowerCase().replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-xs">
        <label htmlFor={`uri-${purpose}`} className="font-sans text-body-sm text-on-surface">
          Link to it (optional)
        </label>
        <input
          id={`uri-${purpose}`}
          name="uri"
          type="url"
          className="rounded border border-outline-variant bg-surface px-sm py-xs font-sans text-body-sm text-on-surface"
          placeholder="https://…"
        />
      </div>

      {!storageAvailable ? null : (
        <div className="flex flex-col gap-xs">
          <label htmlFor={`file-${purpose}`} className="font-sans text-body-sm text-on-surface">
            Or attach the artefact (optional)
          </label>
          <input
            id={`file-${purpose}`}
            name="file"
            type="file"
            /*
             * `accept` is a convenience for the file picker and nothing more -- the allowlist that
             * matters is applied on the server against the real bytes, because this attribute is a
             * suggestion to a dialog the user can ignore.
             */
            accept={Object.keys(ALLOWED_MIME_TYPES).join(',')}
            className="rounded border border-outline-variant bg-surface px-sm py-xs font-sans text-body-sm text-on-surface file:mr-sm file:rounded file:border-0 file:bg-surface-container-high file:px-sm file:py-xs file:font-sans file:text-body-sm file:text-on-surface"
          />
          <p className="font-sans text-body-sm text-on-surface-variant">
            Up to 25 MB. Its hash is recorded, so the record can be told apart later from one whose
            artefact was swapped.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-xs">
        <label htmlFor={`note-${purpose}`} className="font-sans text-body-sm text-on-surface">
          Or state what was done
        </label>
        <textarea
          id={`note-${purpose}`}
          name="note"
          rows={2}
          className="rounded border border-outline-variant bg-surface px-sm py-xs font-sans text-body-sm text-on-surface"
          placeholder="An attestation counts, and is recorded as weaker evidence than an artefact."
        />
      </div>

      <button
        type="submit"
        className="inline-flex w-fit items-center gap-xs rounded bg-primary px-md py-sm font-sans text-body-md text-on-primary hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        Record it
      </button>
    </form>
  );
}

function ApprovalForm({ projectId }: { projectId: string }) {
  return (
    <form
      action={recordApproval}
      className="flex flex-col gap-sm border-t border-outline-variant pt-sm"
    >
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="subjectType" value="BASELINE" />

      <div className="flex flex-col gap-xs">
        <label htmlFor="approval-comment" className="font-sans text-body-sm text-on-surface">
          Why you are approving this
        </label>
        <textarea
          id="approval-comment"
          name="comment"
          rows={2}
          required
          className="rounded border border-outline-variant bg-surface px-sm py-xs font-sans text-body-sm text-on-surface"
          placeholder="Required. An approval with no reason is a signature with no argument behind it."
        />
      </div>

      <p className="font-sans text-body-sm text-on-surface-variant">
        This is recorded against the project as it stands now. If the plan changes afterwards, the
        approval becomes stale and stops counting — because it was given for a different plan.
      </p>

      <button
        type="submit"
        className="inline-flex w-fit items-center gap-xs rounded bg-primary px-md py-sm font-sans text-body-md text-on-primary hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        Approve
      </button>
    </form>
  );
}
