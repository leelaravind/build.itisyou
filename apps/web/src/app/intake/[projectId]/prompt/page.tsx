import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { intakeAnswers, projects } from '@govintel/db/schema';
import { analyseMissing } from '@govintel/intake/missing';
import { findField } from '@govintel/intake/fields';
import type { IntakeField } from '@govintel/intake/schema';
import { buildPromptPackage } from '@govintel/interchange/prompt';
import { evaluatePolicy } from '@govintel/interchange/redaction';
import { withDatabase } from '../../../../lib/server/database.ts';
import { readActiveGuestSessionId } from '../../../../lib/server/session.ts';
import { EXTERNAL_AI_MODE } from '../../../../lib/server/config.ts';
import { PublicHeader } from '../../../../components/shell/PublicHeader.tsx';
import { MaterialIcon } from '../../../../components/ui/MaterialIcon.tsx';
import { CopyBlock } from '../../../../components/intake/CopyBlock.tsx';

/**
 * External AI prompt — locked screen 7.
 *
 * The copy-safety screen (gap-spec §11.3) is not a footnote here; it is most of the page. This is
 * the one place the platform helps a user take project data *out*, to a system it does not control
 * and cannot audit. Everything else in the product is about keeping tenant data inside a boundary.
 *
 * So the user is shown what is going, what was removed, and what was flagged — before the copy
 * button, not after it. Nothing can be un-pasted.
 */

export const metadata = { title: 'Research request' };

export default async function PromptPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const [project] = await withDatabase((db) =>
    db.select().from(projects).where(eq(projects.id, projectId)),
  );

  if (project === undefined) notFound();

  const sessionId = await readActiveGuestSessionId();
  if (project.guestSessionId === null || project.guestSessionId !== sessionId) notFound();

  const rows = await withDatabase((db) =>
    db.select().from(intakeAnswers).where(eq(intakeAnswers.projectId, projectId)),
  );

  const answers: IntakeField[] = rows.map((row) => ({
    fieldId: row.fieldId,
    category: row.category as IntakeField['category'],
    value: row.value ?? null,
    state: row.state as IntakeField['state'],
    provenance: row.provenance as IntakeField['provenance'],
    confidence: row.confidence as IntakeField['confidence'],
    lastUpdatedAt: row.updatedAt.toISOString(),
  }));

  const analysis = analyseMissing(answers);

  const confirmedFacts = answers
    .filter((a) => a.state === 'CONFIRMED' || a.state === 'PROVIDED')
    .map((a) => ({
      fieldId: a.fieldId,
      label: findField(a.fieldId)?.label ?? a.fieldId,
      value: formatForPrompt(a.value),
      confirmed: a.state === 'CONFIRMED',
    }));

  const assumptions = answers
    .filter((a) => a.state === 'ASSUMED')
    .map((a) => ({
      fieldId: a.fieldId,
      label: findField(a.fieldId)?.label ?? a.fieldId,
      value: formatForPrompt(a.value),
    }));

  const pkg = buildPromptPackage(
    {
      projectName: project.name,
      projectSummary: project.summary ?? '',
      confirmedFacts,
      researchRequests: analysis.researchRequests,
      assumptions,
    },
    // Deterministic: the same project produces the same prompt id, so a response can be tied back
    // without storing a separate record before the user has decided to use it.
    `p-${projectId.slice(0, 8)}`,
  );

  const policy = evaluatePolicy(EXTERNAL_AI_MODE, pkg.dataLeaving);

  return (
    <div className="min-h-screen bg-background">
      <PublicHeader />

      <main id="main" className="mx-auto flex max-w-content flex-col gap-lg px-md py-xl">
        <header className="flex flex-col gap-sm">
          <p className="font-sans text-label-caps tracking-wider text-on-surface-variant uppercase">
            Step 2 of 3
          </p>
          <h1 className="font-sans text-headline-lg text-on-surface">Take this to any AI</h1>
          <p className="font-sans text-body-md text-on-surface-variant">
            Copy the request below into whichever assistant you already use. There is nothing to buy
            here and no account to connect — the platform never sends anything itself.
          </p>
        </header>

        {policy.allowed ? null : (
          <div
            role="alert"
            className="flex items-start gap-sm rounded-lg border border-danger/40 bg-danger/10 p-lg"
          >
            <MaterialIcon name="block" size={20} className="text-danger" />
            <div>
              <p className="font-sans text-body-md text-on-surface">This step is not available.</p>
              <p className="mt-xs font-sans text-body-sm text-on-surface-variant">
                {policy.reason}
              </p>
            </div>
          </div>
        )}

        {/* The copy-safety screen, gap-spec §11.3. Before the button, always. */}
        <section
          className="flex flex-col gap-md rounded-lg border border-outline-variant bg-surface-container-low p-lg"
          aria-labelledby="leaving-heading"
        >
          <h2
            id="leaving-heading"
            className="flex items-center gap-sm font-sans text-headline-sm text-on-surface"
          >
            <MaterialIcon name="logout" size={20} className="text-primary" />
            What leaves the platform
          </h2>

          <p className="font-sans text-body-sm text-on-surface-variant">
            Everything in the request below goes wherever you paste it. That service may keep it,
            log it, or train on it — this platform has no say once it leaves. Read it before you
            copy.
          </p>

          <dl className="grid grid-cols-2 gap-md sm:grid-cols-3">
            <Stat label="Fields included" value={String(pkg.dataLeaving.includedFields.length)} />
            <Stat
              label="Removed automatically"
              value={String(pkg.dataLeaving.redactedCount)}
              tone={pkg.dataLeaving.redactedCount > 0 ? 'tertiary' : 'default'}
            />
            <Stat
              label="Flagged for you"
              value={String(pkg.dataLeaving.flaggedCount)}
              tone={pkg.dataLeaving.flaggedCount > 0 ? 'warning' : 'default'}
            />
          </dl>

          {pkg.dataLeaving.detected.length === 0 ? (
            <p className="flex items-center gap-sm font-sans text-body-sm text-tertiary">
              <MaterialIcon name="check_circle" size={16} />
              Nothing sensitive was detected in what you have entered.
            </p>
          ) : (
            <ul className="flex flex-col gap-sm">
              {pkg.dataLeaving.detected.map((item, index) => (
                <li
                  key={`${item.fieldId}-${item.kind}-${String(index)}`}
                  className="flex items-start gap-sm rounded border border-outline-variant bg-surface-container p-md"
                >
                  <MaterialIcon
                    name={item.redacted ? 'shield' : 'warning'}
                    size={16}
                    className={item.redacted ? 'text-tertiary' : 'text-warning'}
                  />
                  <div className="min-w-0">
                    <p className="font-sans text-body-sm text-on-surface">
                      {item.kind}
                      <span className="ml-sm font-mono text-data-mono-sm text-on-surface-variant">
                        {findField(item.fieldId)?.label ?? item.fieldId}
                      </span>
                    </p>
                    <p className="mt-xs font-sans text-body-sm text-on-surface-variant">
                      {item.explanation}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {policy.allowed ? (
          <>
            <section className="flex flex-col gap-md" aria-labelledby="request-heading">
              <div className="flex flex-wrap items-baseline justify-between gap-sm">
                <h2 id="request-heading" className="font-sans text-headline-sm text-on-surface">
                  The request
                </h2>
                <p className="font-mono text-data-mono-sm text-on-surface-variant">
                  {pkg.questionCount} open {pkg.questionCount === 1 ? 'question' : 'questions'} ·
                  schema {pkg.versions.schema}
                </p>
              </div>

              <CopyBlock text={pkg.text} />
            </section>

            <section className="flex flex-col gap-sm rounded-lg border border-outline-variant bg-surface-container-low p-lg">
              <p className="font-sans text-label-caps tracking-wider text-on-surface-variant uppercase">
                When you have the reply
              </p>
              <p className="font-sans text-body-sm text-on-surface-variant">
                Paste it back. It is checked against everything you already told us before anything
                is created — a response that contradicts you does not win by arriving second.
              </p>
              <Link
                href={`/intake/${projectId}/import`}
                className="mt-sm inline-flex w-fit items-center gap-sm rounded bg-primary px-lg py-md font-sans text-body-sm font-medium text-on-primary transition-colors hover:bg-primary-fixed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                Paste the response
                <MaterialIcon name="arrow_forward" size={18} />
              </Link>
            </section>
          </>
        ) : null}

        <Link
          href={`/intake/${projectId}`}
          className="inline-flex w-fit items-center gap-sm font-sans text-body-sm text-on-surface-variant transition-colors hover:text-on-surface"
        >
          <MaterialIcon name="arrow_back" size={16} />
          Back to intake
        </Link>
      </main>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = 'default',
}: {
  readonly label: string;
  readonly value: string;
  readonly tone?: 'default' | 'warning' | 'tertiary';
}) {
  return (
    <div>
      <dt className="font-sans text-label-caps tracking-wider text-on-surface-variant uppercase">
        {label}
      </dt>
      <dd
        className={`mt-xs font-mono text-headline-sm ${
          tone === 'warning'
            ? 'text-warning'
            : tone === 'tertiary'
              ? 'text-tertiary'
              : 'text-on-surface'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

/** Render a stored answer for inclusion in the prompt. */
function formatForPrompt(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return value.toString();
  return JSON.stringify(value);
}
