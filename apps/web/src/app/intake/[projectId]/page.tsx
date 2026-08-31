import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { intakeAnswers, projects } from '@govintel/db/schema';
import { analyseMissing, completionPercent, nextQuestion } from '@govintel/intake/missing';
import { FIELD_DEFINITIONS } from '@govintel/intake/fields';
import type { IntakeField } from '@govintel/intake/schema';
import { withDatabase } from '../../../lib/server/database.ts';
import { readGuestSessionId } from '../../../lib/server/session.ts';
import { PublicHeader } from '../../../components/shell/PublicHeader.tsx';
import { QuestionCard } from '../../../components/intake/QuestionCard.tsx';
import { IntakeProgress } from '../../../components/intake/IntakeProgress.tsx';

/**
 * Intake wizard — locked screen 3, with screens 4–6 folded in.
 *
 * The plan lists Resources & Constraints, What We Know and Missing Information as separate screens.
 * They are rendered here as sections of one continuous flow rather than as separate pages, because
 * the three are views of the same data at different moments, and making the user navigate between
 * them would hide the thing that matters most: what is still missing and what the plan is assuming.
 * The screen map records them as implemented here rather than as separate routes.
 *
 * Ownership is checked before anything is rendered. A guest project is reachable only by the session
 * that owns it, and a wrong or absent session gets a 404 — never a 403, which would confirm the
 * project exists.
 */

export const metadata = { title: 'Project intake' };

export default async function IntakePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const [project] = await withDatabase((db) =>
    db.select().from(projects).where(eq(projects.id, projectId)),
  );

  // 404 for missing, wrong-session and saved-project-viewed-as-guest alike. A guest probing ids
  // learns nothing about which exist.
  if (project === undefined) notFound();

  const sessionId = await readGuestSessionId();
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
    ...(row.note === null ? {} : { note: row.note }),
    lastUpdatedAt: row.updatedAt.toISOString(),
  }));

  const analysis = analyseMissing(answers);
  const percent = completionPercent(answers);
  const question = nextQuestion(answers);
  const answeredById = new Map(answers.map((a) => [a.fieldId, a]));

  return (
    <div className="min-h-screen bg-background">
      <PublicHeader />

      <main id="main" className="mx-auto flex max-w-3xl flex-col gap-lg px-md py-xl">
        <header className="flex flex-col gap-sm">
          <p className="font-sans text-label-caps tracking-wider text-on-surface-variant uppercase">
            Project intake
          </p>
          <h1 className="font-sans text-headline-lg text-on-surface">{project.name}</h1>
          {project.summary === null ? null : (
            <p className="font-sans text-body-md text-on-surface-variant">{project.summary}</p>
          )}
        </header>

        <IntakeProgress
          percent={percent}
          answered={analysis.answeredCount}
          total={analysis.totalCount}
          canGenerate={analysis.canGenerate}
          criticalOutstanding={analysis.critical.filter((i) => i.reason === 'UNANSWERED').length}
        />

        {question === undefined ? (
          <section
            className="rounded-lg border border-tertiary/40 bg-tertiary/10 p-lg"
            aria-labelledby="done-heading"
          >
            <h2 id="done-heading" className="font-sans text-headline-sm text-on-surface">
              Every question has been dealt with
            </h2>
            <p className="mt-sm font-sans text-body-sm text-on-surface-variant">
              Next: the platform writes a research request for everything you flagged as unknown.
            </p>
          </section>
        ) : (
          <QuestionCard
            projectId={projectId}
            definition={question}
            existing={answeredById.get(question.id)}
          />
        )}

        {/* "What we know" — locked screen 5, as a section rather than a page. */}
        {answers.length > 0 ? (
          <section className="flex flex-col gap-md" aria-labelledby="known-heading">
            <h2 id="known-heading" className="font-sans text-headline-sm text-on-surface">
              What we know so far
            </h2>

            <ul className="flex flex-col gap-sm">
              {answers.map((answer) => {
                const definition = FIELD_DEFINITIONS.find((d) => d.id === answer.fieldId);
                return (
                  <li
                    key={answer.fieldId}
                    className="flex flex-wrap items-baseline justify-between gap-sm rounded border border-outline-variant bg-surface-container-low px-md py-sm"
                  >
                    <span className="font-sans text-body-sm text-on-surface-variant">
                      {definition?.label ?? answer.fieldId}
                    </span>
                    <AnswerSummary field={answer} />
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {/* "Missing information" — locked screen 6, as a section. */}
        {analysis.critical.length + analysis.recommended.length > 0 ? (
          <section className="flex flex-col gap-md" aria-labelledby="missing-heading">
            <h2 id="missing-heading" className="font-sans text-headline-sm text-on-surface">
              Still missing
            </h2>

            <MissingList title="Critical" items={analysis.critical} tone="danger" />
            <MissingList title="Recommended" items={analysis.recommended} tone="warning" />
          </section>
        ) : null}
      </main>
    </div>
  );
}

function AnswerSummary({ field }: { readonly field: IntakeField }) {
  // The state is shown alongside the value, always. A value with no state reads as fact, and an
  // assumption presented as fact is the thing plan §11.2 forbids.
  const label =
    field.state === 'UNKNOWN'
      ? 'Not known'
      : field.state === 'EXTERNAL_RESEARCH_REQUIRED'
        ? 'To research'
        : field.state === 'ASSUMED'
          ? `${formatValue(field.value)} · assumed`
          : formatValue(field.value);

  const tone =
    field.state === 'CONFIRMED'
      ? 'text-tertiary'
      : field.state === 'ASSUMED'
        ? 'text-warning'
        : field.state === 'UNKNOWN' || field.state === 'EXTERNAL_RESEARCH_REQUIRED'
          ? 'text-on-surface-variant'
          : 'text-on-surface';

  return <span className={`font-mono text-data-mono-sm ${tone}`}>{label}</span>;
}

/**
 * Render a stored answer for display.
 *
 * Values come from a `jsonb` column, so their type is genuinely unknown at compile time. Each shape
 * is handled explicitly: `String()` on an object yields "[object Object]", which would show the user
 * something that looks like a bug rather than their answer.
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) return value.length === 0 ? '—' : value.join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';

  const text =
    typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'bigint'
        ? value.toString()
        : JSON.stringify(value);

  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

function MissingList({
  title,
  items,
  tone,
}: {
  readonly title: string;
  readonly items: readonly { fieldId: string; label: string; reason: string }[];
  readonly tone: 'danger' | 'warning';
}) {
  if (items.length === 0) return null;

  return (
    <div className="flex flex-col gap-xs">
      <p
        className={`font-sans text-label-caps tracking-wider uppercase ${
          tone === 'danger' ? 'text-danger' : 'text-warning'
        }`}
      >
        {title} ({items.length})
      </p>
      <ul className="flex flex-col gap-xs">
        {items.map((item) => (
          <li
            key={item.fieldId}
            className="flex flex-wrap items-baseline justify-between gap-sm font-sans text-body-sm text-on-surface-variant"
          >
            <span>{item.label}</span>
            <span className="font-mono text-data-mono-sm">{describeReason(item.reason)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The reason is shown because "missing" alone does not tell the user whether they need to act. */
function describeReason(reason: string): string {
  switch (reason) {
    case 'UNANSWERED':
      return 'not asked yet';
    case 'USER_DOES_NOT_KNOW':
      return 'you said unknown';
    case 'DEFERRED_TO_RESEARCH':
      return 'to research';
    case 'ASSUMED':
      return 'assumed';
    default:
      return reason.toLowerCase();
  }
}
