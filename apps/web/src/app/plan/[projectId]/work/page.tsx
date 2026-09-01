import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { intakeAnswers } from '@govintel/db/schema';
import type { IntakeField } from '@govintel/intake/schema';
import { graphFromRows } from '@govintel/twin/repository';
import { RULES, RULESET_VERSION } from '@govintel/rules/catalogue';
import { evaluateRules } from '@govintel/rules/evaluate';
import { decompose, mergeIntoGraph } from '@govintel/execution/decompose';
import { buildBoard, buildToday, summariseProject } from '@govintel/execution/board';
import { summariseCapacity } from '@govintel/execution/scheduling';
import { withDatabase } from '../../../../lib/server/database.ts';
import { PublicHeader } from '../../../../components/shell/PublicHeader.tsx';
import { MaterialIcon } from '../../../../components/ui/MaterialIcon.tsx';
import { loadPlanRows } from '../actions.ts';

/**
 * The work: what to do next, what state everything is in, and what that adds up to.
 *
 * Ordered deliberately. **Today comes first** — a page that opens with a board is a page that asks
 * the reader to do the prioritising, and the whole point of having a dependency graph is that the
 * platform can do some of it.
 *
 * Every number here carries what it does not mean. "60% complete" counts *items*, not effort, and
 * tasks are not equal in size — that difference is where optimistic status reports come from, so the
 * caveat travels with the figure rather than sitting in small text.
 */

export const metadata = { title: 'The work' };

export default async function WorkPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const loaded = await loadPlanRows(projectId);
  if (loaded === null) notFound();

  const { project, nodes, edges } = loaded;

  const answerRows = await withDatabase((db) =>
    db.select().from(intakeAnswers).where(eq(intakeAnswers.projectId, projectId)),
  );

  const intake: IntakeField[] = answerRows.map((row) => ({
    fieldId: row.fieldId,
    category: row.category as IntakeField['category'],
    value: row.value ?? null,
    state: row.state as IntakeField['state'],
    provenance: row.provenance as IntakeField['provenance'],
    confidence: row.confidence as IntakeField['confidence'],
    lastUpdatedAt: row.updatedAt.toISOString(),
  }));

  const planGraph = graphFromRows(projectId, nodes, edges);

  if (planGraph.size === 0) {
    return <NoPlanYet projectId={projectId} name={project.name} />;
  }

  const evaluation = evaluateRules(
    RULES,
    {
      projectId,
      ...(project.projectType === 'UNKNOWN' ? {} : { projectType: project.projectType }),
      lifecycleState: project.lifecycleState,
      methodology: 'AGILE',
      intake,
      graph: planGraph,
      asOf: new Date().toISOString().slice(0, 10),
    },
    RULESET_VERSION,
  );

  const teamSize = numberAnswer(intake, 'team.size');

  const decomposition = decompose({
    projectId,
    graph: planGraph,
    emissions: evaluation.emissions,
    ...(teamSize === undefined ? {} : { teamSize }),
    // The clock lives here, not in the decomposer. That separation is what makes the golden fixtures
    // possible at all.
    at: new Date().toISOString(),
  });

  const graph = mergeIntoGraph(planGraph, decomposition);

  const today = buildToday({ graph });
  const board = buildBoard(graph);
  const summary = summariseProject(graph);
  const capacity = summariseCapacity({ graph, resources: [] });

  return (
    <div className="min-h-screen bg-background">
      <PublicHeader />

      <main id="main" className="mx-auto flex max-w-content flex-col gap-lg px-md py-xl">
        <header className="flex flex-col gap-sm">
          <p className="font-sans text-label-caps tracking-wider text-on-surface-variant uppercase">
            The work
          </p>
          <h1 className="font-sans text-headline-lg text-on-surface">{project.name}</h1>
          <p className="font-mono text-data-mono-sm text-on-surface-variant">
            {decomposition.actualLevels.map((l) => l.toLowerCase()).join(' → ')}
          </p>
        </header>

        {/* Today first. A board asks the reader to prioritise; this does some of it. */}
        <section
          className="flex flex-col gap-md rounded-lg border border-outline-variant bg-surface-container-low p-lg"
          aria-labelledby="today-heading"
        >
          <div className="flex flex-col gap-xs">
            <h2 id="today-heading" className="font-sans text-headline-sm text-on-surface">
              What to do next
            </h2>
            <p className="font-sans text-body-sm text-on-surface-variant">
              Ranked, with the reason. Blocked work and work waiting on something unfinished is left
              out — a focus list that includes things you cannot start is a list nobody uses.
            </p>
          </div>

          {today.length === 0 ? (
            <p className="font-sans text-body-sm text-on-surface-variant">
              Nothing is startable right now. Everything is either finished or waiting on something
              else.
            </p>
          ) : (
            <ol className="flex flex-col gap-sm">
              {today.map((item, index) => (
                <li
                  key={item.id}
                  className="flex items-start gap-md rounded border border-outline-variant bg-surface-container p-md"
                >
                  <span className="font-mono text-headline-sm text-on-surface-variant">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="font-sans text-body-md text-on-surface">{item.label}</p>
                    <p className="mt-xs font-sans text-body-sm text-on-surface-variant">
                      {item.explanation}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section
          className="flex flex-col gap-md rounded-lg border border-outline-variant bg-surface-container-low p-lg"
          aria-labelledby="progress-heading"
        >
          <h2 id="progress-heading" className="font-sans text-headline-sm text-on-surface">
            Where the work stands
          </h2>

          <dl className="grid grid-cols-2 gap-md sm:grid-cols-4">
            <Stat label="Tasks" value={summary.totalTasks} />
            <Stat label="Finished" value={summary.byStatus.DONE} />
            <Stat label="Waiting on review" value={summary.waitingOnReview} tone="warning" />
            <Stat label="Blocked" value={summary.blocked} tone="warning" />
          </dl>

          <div className="flex flex-col gap-xs">
            <div className="flex items-baseline gap-sm">
              <span className="font-mono text-headline-lg text-on-surface">
                {summary.completionPercent}%
              </span>
              <span className="font-sans text-body-sm text-on-surface-variant">of tasks done</span>
            </div>

            {/* The caveats travel with the number rather than sitting in small text somewhere. */}
            <ul className="flex flex-col gap-xs">
              {summary.caveats.map((caveat) => (
                <li
                  key={caveat}
                  className="flex items-start gap-sm font-sans text-body-sm text-on-surface-variant"
                >
                  <MaterialIcon name="info" size={16} />
                  {caveat}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {capacity.problems.length > 0 ? (
          <section className="flex flex-col gap-sm" aria-labelledby="problems-heading">
            <h2 id="problems-heading" className="font-sans text-headline-sm text-on-surface">
              Why this plan may not be achievable
            </h2>
            <ul className="flex flex-col gap-sm">
              {capacity.problems.map((problem) => (
                <li
                  key={problem.code}
                  className={`flex items-start gap-sm rounded border p-md ${
                    problem.severity === 'ERROR'
                      ? 'border-danger/40 bg-danger/10'
                      : 'border-warning/40 bg-warning/10'
                  }`}
                >
                  <MaterialIcon
                    name={problem.severity === 'ERROR' ? 'error' : 'warning'}
                    size={16}
                    className={problem.severity === 'ERROR' ? 'text-danger' : 'text-warning'}
                  />
                  <p className="font-sans text-body-sm text-on-surface-variant">
                    {problem.message}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="flex flex-col gap-md" aria-labelledby="board-heading">
          <div className="flex flex-col gap-xs">
            <h2 id="board-heading" className="font-sans text-headline-sm text-on-surface">
              The board
            </h2>
            <p className="font-sans text-body-sm text-on-surface-variant">
              Review is its own column on purpose. Work that is finished and waiting for someone is
              the most common place for delivery to stall, and folding it into “in progress” hides
              it.
            </p>
          </div>

          <div className="grid gap-md sm:grid-cols-2 lg:grid-cols-3">
            {board.map((column) => (
              <section
                key={column.status}
                className="flex flex-col gap-sm rounded-lg border border-outline-variant bg-surface-container-low p-md"
                aria-labelledby={`column-${column.status}`}
              >
                <div className="flex flex-col gap-xs">
                  <h3
                    id={`column-${column.status}`}
                    className="flex items-baseline justify-between gap-sm font-sans text-body-md text-on-surface"
                  >
                    {column.label}
                    <span className="font-mono text-data-mono-sm text-on-surface-variant">
                      {column.cards.length}
                    </span>
                  </h3>
                  <p className="font-sans text-body-sm text-on-surface-variant">{column.meaning}</p>
                </div>

                {column.cards.length === 0 ? null : (
                  <ul className="flex flex-col gap-xs">
                    {column.cards.slice(0, 12).map((card) => (
                      <li
                        key={card.id}
                        className="rounded border border-outline-variant bg-surface-container p-sm"
                      >
                        <p className="font-sans text-body-sm text-on-surface">{card.label}</p>
                        {card.because === undefined ? null : (
                          // The rule this task exists for, so it can be argued with rather than
                          // simply done.
                          <p className="mt-xs font-mono text-data-mono-sm text-on-surface-variant">
                            {card.because}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {column.cards.length > 12 ? (
                  <p className="font-sans text-body-sm text-on-surface-variant">
                    and {column.cards.length - 12} more
                  </p>
                ) : null}
              </section>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-sm rounded-lg border border-outline-variant bg-surface-container-low p-lg">
          <h2 className="font-sans text-headline-sm text-on-surface">How this was structured</h2>
          <ul className="flex flex-col gap-xs">
            {decomposition.hierarchy.reasoning.map((line) => (
              <li key={line} className="font-sans text-body-sm text-on-surface-variant">
                {line}
              </li>
            ))}
          </ul>
        </section>

        <div className="flex flex-wrap gap-lg">
          <Link
            href={`/plan/${projectId}`}
            className="inline-flex items-center gap-sm font-sans text-body-sm text-on-surface-variant transition-colors hover:text-on-surface"
          >
            <MaterialIcon name="arrow_back" size={16} />
            Back to the plan
          </Link>
          <Link
            href={`/plan/${projectId}/rules`}
            className="inline-flex items-center gap-sm font-sans text-body-sm text-on-surface-variant transition-colors hover:text-on-surface"
          >
            <MaterialIcon name="rule" size={16} />
            What the rules require
          </Link>
        </div>
      </main>
    </div>
  );
}

function NoPlanYet({ projectId, name }: { readonly projectId: string; readonly name: string }) {
  return (
    <div className="min-h-screen bg-background">
      <PublicHeader />
      <main id="main" className="mx-auto flex max-w-content flex-col gap-lg px-md py-xl">
        <h1 className="font-sans text-headline-lg text-on-surface">{name}</h1>
        <section className="flex flex-col gap-md rounded-lg border border-outline-variant bg-surface-container-low p-lg">
          <h2 className="font-sans text-headline-sm text-on-surface">No plan to break down yet</h2>
          <p className="font-sans text-body-sm text-on-surface-variant">
            The work is derived from the plan and from the rules that apply. Build the plan first.
          </p>
          <Link
            href={`/plan/${projectId}`}
            className="mt-sm inline-flex min-h-11 w-fit items-center gap-sm rounded bg-primary px-lg font-sans text-body-sm font-medium text-on-primary transition-colors hover:bg-primary-fixed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Go to the plan
            <MaterialIcon name="arrow_forward" size={18} />
          </Link>
        </section>
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
  readonly value: number;
  readonly tone?: 'default' | 'warning';
}) {
  return (
    <div>
      <dt className="font-sans text-label-caps tracking-wider text-on-surface-variant uppercase">
        {label}
      </dt>
      <dd
        className={`mt-xs font-mono text-headline-sm ${
          tone === 'warning' && value > 0 ? 'text-warning' : 'text-on-surface'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

/** An answered numeric intake field, or undefined. Never reads a value from an unanswered field. */
function numberAnswer(intake: readonly IntakeField[], fieldId: string): number | undefined {
  const field = intake.find((f) => f.fieldId === fieldId);
  if (field === undefined) return undefined;
  if (field.state !== 'CONFIRMED' && field.state !== 'PROVIDED' && field.state !== 'ASSUMED') {
    return undefined;
  }
  return typeof field.value === 'number' ? field.value : undefined;
}
