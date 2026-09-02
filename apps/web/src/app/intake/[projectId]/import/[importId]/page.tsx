import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { aiImports, projects } from '@govintel/db/schema';
import { findField } from '@govintel/intake/fields';
import { VALIDATION_STATUSES } from '@govintel/interchange/validate';
import type {
  ValidationIssue,
  ValidationResult,
  ValidationStatus,
} from '@govintel/interchange/validate';
import { previewImport } from '@govintel/interchange/staging';
import type { InterchangeResponse } from '@govintel/interchange/schema';
import { withDatabase } from '../../../../../lib/server/database.ts';
import { mayOpen } from '../../../../../lib/server/project-access.ts';
import { PublicHeader } from '../../../../../components/shell/PublicHeader.tsx';
import { MaterialIcon } from '../../../../../components/ui/MaterialIcon.tsx';
import { acceptImport, rejectImport } from '../actions.ts';
import type { IconName } from '../../../../../components/ui/icon-paths.ts';

/**
 * Validation result and preview — locked screens 9 and 10.
 *
 * Deliberately one page rather than two. Splitting "here is what is wrong with it" from "here is
 * what it would do" invites a user to skim the first and act on the second; the decision to accept
 * should be taken with both in view. Screens 9 and 10 remain distinct *sections* with their own
 * headings, which is what the design locks.
 *
 * The response is untrusted content of unknown origin. Every value rendered here is escaped by React
 * as text, nothing is passed to `dangerouslySetInnerHTML`, and no value from the payload is used to
 * build a URL, a class name or an id that has meaning to the browser.
 */

export const metadata = { title: 'Check the response' };

interface StatusCopy {
  readonly headline: string;
  readonly detail: string;
  readonly tone: 'good' | 'warn' | 'bad';
  readonly icon: IconName;
}

const STATUS_COPY: Record<ValidationStatus, StatusCopy> = {
  VALID: {
    headline: 'The response checks out',
    detail:
      'It is well formed, it cites what it can, and it does not contradict anything you said.',
    tone: 'good',
    icon: 'verified',
  },
  VALID_WITH_WARNINGS: {
    headline: 'Usable, with things worth reading first',
    detail:
      'Nothing disqualifying, but some of it is weaker than it looks. The notes below say how.',
    tone: 'warn',
    icon: 'info',
  },
  INCOMPLETE: {
    headline: 'It did not answer enough to be useful',
    detail:
      'The response is valid but too thin to build on. You can ask again, or answer more of the intake yourself.',
    tone: 'warn',
    icon: 'pending',
  },
  CONFLICTING: {
    headline: 'It contradicts what you told us',
    detail:
      'What you confirmed wins. Nothing here is applied. Resolve the conflicts below, or discard the response.',
    tone: 'bad',
    icon: 'compare_arrows',
  },
  UNSUPPORTED: {
    headline: 'This response is for a different version',
    detail:
      'It was written against a schema this platform does not accept. Copy the request again — it carries the current version.',
    tone: 'bad',
    icon: 'update',
  },
  INVALID: {
    headline: 'The response could not be read',
    detail: 'It is malformed or does not match the agreed shape. Nothing was applied.',
    tone: 'bad',
    icon: 'error',
  },
  UNSAFE: {
    headline: 'The response was rejected on safety grounds',
    detail:
      'It contains content that tries to act as an instruction rather than data. Nothing was applied and nothing will be.',
    tone: 'bad',
    icon: 'gpp_bad',
  },
};

const LAYER_COPY: Record<string, string> = {
  PAYLOAD_SIZE: 'Size',
  ENCODING: 'Encoding',
  JSON_SYNTAX: 'Structure',
  JSON_SCHEMA: 'Shape',
  SCHEMA_VERSION: 'Version',
  REFERENCE_INTEGRITY: 'References',
  FIELD_DOMAIN: 'Field values',
  SEMANTIC_INVARIANTS: 'Internal consistency',
  CONFLICT: 'Conflicts with your answers',
  PROVENANCE: 'Where it came from',
  CONFIDENCE: 'Stated confidence',
  POLICY_SECURITY: 'Safety',
  COMPLETENESS: 'Completeness',
  GENERATION_READINESS: 'Readiness',
};

function isValidationStatus(value: string): value is ValidationStatus {
  return (VALIDATION_STATUSES as readonly string[]).includes(value);
}

export default async function ImportResultPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; importId: string }>;
  searchParams: Promise<{ decided?: string; error?: string }>;
}) {
  const { projectId, importId } = await params;
  const { decided, error } = await searchParams;

  const [project] = await withDatabase((db) =>
    db.select().from(projects).where(eq(projects.id, projectId)),
  );
  if (project === undefined) notFound();

  if (!(await mayOpen(project))) notFound();

  const [record] = await withDatabase((db) =>
    db
      .select()
      .from(aiImports)
      .where(and(eq(aiImports.id, importId), eq(aiImports.projectId, projectId))),
  );
  if (record === undefined) notFound();

  const validation = record.validation as unknown as ValidationResult | null;
  if (validation === null) notFound();

  // `?? undefined`, not a bare cast: an absent jsonb column reads back as `null`, and the optional
  // property this feeds expects `undefined`. The cast alone typechecked and then threw at runtime on
  // every response that failed before the schema layer — which is most of the hostile cases.
  const response = (record.response ?? undefined) as InterchangeResponse | undefined;

  const preview = previewImport({
    importId,
    projectId,
    state: record.state as 'VALIDATED',
    raw: record.raw,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    ...(response === undefined ? {} : { response }),
  });

  // The stored validation is JSON, so its status is only a string as far as the type system is
  // concerned. Narrow it rather than trusting the column: an unrecognised status must fall back to
  // the most restrictive copy, not to a blank page.
  const status = isValidationStatus(validation.status)
    ? STATUS_COPY[validation.status]
    : STATUS_COPY.INVALID;
  const errors = validation.issues.filter((i) => i.severity === 'ERROR');
  const warnings = validation.issues.filter((i) => i.severity === 'WARNING');
  const notes = validation.issues.filter((i) => i.severity === 'INFO');

  const decidedAlready = record.state === 'ACCEPTED' || record.state === 'REJECTED';

  return (
    <div className="min-h-screen bg-background">
      <PublicHeader />

      <main id="main" className="mx-auto flex max-w-content flex-col gap-lg px-md py-xl">
        {/* ---------- Screen 9: the verdict ---------- */}
        <section
          className={`flex flex-col gap-sm rounded-lg border p-lg ${
            status.tone === 'good'
              ? 'border-tertiary/40 bg-tertiary/10'
              : status.tone === 'warn'
                ? 'border-warning/40 bg-warning/10'
                : 'border-danger/40 bg-danger/10'
          }`}
          aria-labelledby="verdict-heading"
        >
          <p className="font-sans text-label-caps tracking-wider text-on-surface-variant uppercase">
            Validation result
          </p>
          <h1
            id="verdict-heading"
            className="flex items-center gap-sm font-sans text-headline-lg text-on-surface"
          >
            <MaterialIcon
              name={status.icon}
              size={24}
              className={
                status.tone === 'good'
                  ? 'text-tertiary'
                  : status.tone === 'warn'
                    ? 'text-warning'
                    : 'text-danger'
              }
            />
            {status.headline}
          </h1>
          <p className="font-sans text-body-md text-on-surface-variant">{status.detail}</p>
          <p className="font-mono text-data-mono-sm text-on-surface-variant">
            {validation.status} · schema {validation.versions.schema} · validator{' '}
            {validation.versions.validator}
          </p>
        </section>

        {decided !== undefined ? (
          <p
            role="status"
            className="flex items-center gap-sm rounded border border-outline-variant bg-surface-container-low p-md font-sans text-body-sm text-on-surface"
          >
            <MaterialIcon name={decided === 'accepted' ? 'check_circle' : 'block'} size={18} />
            {decided === 'accepted'
              ? 'Accepted. These findings are kept alongside your project and marked as coming from an AI.'
              : 'Discarded. Nothing from this response was kept.'}
          </p>
        ) : null}

        {error === 'not-valid' ? (
          <p
            role="alert"
            className="flex items-center gap-sm rounded border border-danger/40 bg-danger/10 p-md font-sans text-body-sm text-on-surface"
          >
            <MaterialIcon name="block" size={18} className="text-danger" />
            That response did not pass validation, so it cannot be accepted.
          </p>
        ) : null}

        <IssueList
          title="Why it was rejected"
          description="Each of these is enough on its own to stop the response being applied."
          issues={errors}
          tone="bad"
        />
        <IssueList
          title="Worth reading before you accept"
          description="Not disqualifying, but they change how much weight this deserves."
          issues={warnings}
          tone="warn"
        />
        <IssueList
          title="Notes"
          description="Observations recorded for the audit trail."
          issues={notes}
          tone="info"
        />

        {/* ---------- Screen 10: what it would actually do ---------- */}
        {response === undefined ? null : (
          <section
            className="flex flex-col gap-md rounded-lg border border-outline-variant bg-surface-container-low p-lg"
            aria-labelledby="preview-heading"
          >
            <h2 id="preview-heading" className="font-sans text-headline-sm text-on-surface">
              What this would add
            </h2>

            <dl className="grid grid-cols-2 gap-md sm:grid-cols-3">
              <Stat label="Answers to fields" value={preview.claimCount} />
              <Stat label="Requirements" value={preview.requirementCount} />
              <Stat label="Risks" value={preview.riskCount} />
              <Stat label="Phases" value={preview.phaseCount} />
              <Stat label="Assumptions" value={preview.assumptionCount} />
              <Stat label="Open questions" value={preview.openQuestionCount} />
            </dl>

            {/* The single most important number on the page. An import that is 90% uncited guesswork
                looks identical to a researched one until this is stated plainly. */}
            <div className="flex flex-col gap-xs rounded border border-outline-variant bg-surface-container p-md">
              <p className="font-sans text-body-sm text-on-surface">
                <strong className="font-medium">{preview.citedClaimCount}</strong> of{' '}
                <strong className="font-medium">{preview.claimCount}</strong>{' '}
                {preview.claimCount === 1 ? 'answer cites' : 'answers cite'} a source.
              </p>
              {preview.unverifiedClaimCount > 0 ? (
                <p className="flex items-start gap-sm font-sans text-body-sm text-warning">
                  <MaterialIcon name="help" size={16} />
                  The remaining {preview.unverifiedClaimCount} are the model’s own inference or
                  assumption. They are kept as such and never counted as things you confirmed.
                </p>
              ) : null}
            </div>

            {preview.fillsFields.length === 0 ? null : (
              <div className="flex flex-col gap-sm">
                <h3 className="font-sans text-body-md text-on-surface">Fields it answers</h3>
                <ul className="flex flex-wrap gap-xs">
                  {preview.fillsFields.map((fieldId) => (
                    <li
                      key={fieldId}
                      className="rounded border border-outline-variant bg-surface-container px-sm py-xs font-sans text-body-sm text-on-surface-variant"
                    >
                      {findField(fieldId)?.label ?? fieldId}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {response.summary === undefined ? null : (
              <div className="flex flex-col gap-xs">
                <h3 className="font-sans text-body-md text-on-surface">Its summary</h3>
                {/* Rendered as text, never as markup. */}
                <p className="font-sans text-body-sm whitespace-pre-wrap text-on-surface-variant">
                  {response.summary}
                </p>
              </div>
            )}
          </section>
        )}

        {/* ---------- The decision ---------- */}
        {decidedAlready ? (
          <p className="font-sans text-body-sm text-on-surface-variant">
            This response has already been {record.state.toLowerCase()}. Imports are kept as a
            record of what was proposed and what was decided.
          </p>
        ) : (
          <div className="flex flex-wrap gap-md">
            {validation.canMaterialize ? (
              <form action={acceptImport}>
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="importId" value={importId} />
                <button
                  type="submit"
                  className="inline-flex min-h-11 items-center gap-sm rounded bg-primary px-lg font-sans text-body-sm font-medium text-on-primary transition-colors hover:bg-primary-fixed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <MaterialIcon name="check" size={18} />
                  Accept these findings
                </button>
              </form>
            ) : null}

            <form action={rejectImport}>
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="importId" value={importId} />
              <button
                type="submit"
                className="inline-flex min-h-11 items-center gap-sm rounded border border-outline-variant px-lg font-sans text-body-sm text-on-surface transition-colors hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <MaterialIcon name="delete" size={18} />
                Discard it
              </button>
            </form>
          </div>
        )}

        <div className="flex flex-wrap gap-lg">
          <Link
            href={`/intake/${projectId}/import`}
            className="inline-flex items-center gap-sm font-sans text-body-sm text-on-surface-variant transition-colors hover:text-on-surface"
          >
            <MaterialIcon name="arrow_back" size={16} />
            Paste a different response
          </Link>
          <Link
            href={`/intake/${projectId}`}
            className="inline-flex items-center gap-sm font-sans text-body-sm text-on-surface-variant transition-colors hover:text-on-surface"
          >
            <MaterialIcon name="edit_note" size={16} />
            Back to intake
          </Link>
        </div>
      </main>
    </div>
  );
}

function IssueList({
  title,
  description,
  issues,
  tone,
}: {
  readonly title: string;
  readonly description: string;
  readonly issues: readonly ValidationIssue[];
  readonly tone: 'bad' | 'warn' | 'info';
}) {
  if (issues.length === 0) return null;

  return (
    <section className="flex flex-col gap-sm" aria-labelledby={`issues-${tone}`}>
      <h2 id={`issues-${tone}`} className="font-sans text-headline-sm text-on-surface">
        {title}
      </h2>
      <p className="font-sans text-body-sm text-on-surface-variant">{description}</p>
      <ul className="flex flex-col gap-sm">
        {issues.map((issue, index) => (
          <li
            key={`${issue.code}-${String(index)}`}
            className="flex items-start gap-sm rounded border border-outline-variant bg-surface-container-low p-md"
          >
            <MaterialIcon
              name={tone === 'bad' ? 'error' : tone === 'warn' ? 'warning' : 'info'}
              size={16}
              className={
                tone === 'bad' ? 'text-danger' : tone === 'warn' ? 'text-warning' : 'text-primary'
              }
            />
            <div className="min-w-0">
              <p className="font-sans text-body-sm text-on-surface">{issue.message}</p>
              <p className="mt-xs font-mono text-data-mono-sm text-on-surface-variant">
                {LAYER_COPY[issue.layer] ?? issue.layer}
                {issue.path === undefined ? '' : ` · ${issue.path}`}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Stat({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <div>
      <dt className="font-sans text-label-caps tracking-wider text-on-surface-variant uppercase">
        {label}
      </dt>
      <dd className="mt-xs font-mono text-headline-sm text-on-surface">{value}</dd>
    </div>
  );
}
