import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { intakeAnswers } from '@govintel/db/schema';
import type { IntakeField } from '@govintel/intake/schema';
import { graphFromRows } from '@govintel/twin/repository';
import { RULES, RULESET_VERSION } from '@govintel/rules/catalogue';
import { evaluateRules } from '@govintel/rules/evaluate';
import { decompose, mergeIntoGraph } from '@govintel/execution/decompose';
import { analyseImpact, summariseImpact, type ImpactedNode } from '@govintel/change/impact';
import { STALENESS_MEANING, type Staleness } from '@govintel/change/propagation';
import { PublicHeader } from '../../../../components/shell/PublicHeader.tsx';
import { MaterialIcon } from '../../../../components/ui/MaterialIcon.tsx';
import { withDatabase } from '../../../../lib/server/database.ts';
import { loadPlanRows } from '../actions.ts';
import type { IconName } from '../../../../components/ui/icon-paths.ts';

/**
 * Change impact preview.
 *
 * The page answers one question — "if I change this, what else stops being true?" — and its whole
 * value is in being *checkable*. A number is not checkable. So every affected item shows the path
 * that reached it, hop by hop, with the rule's own reasoning at each step.
 *
 * The alternative, which is what most tools do, is to show a count. "47 items affected" cannot be
 * acted on and cannot be disputed, so the first time it is wrong the reader stops believing it, and
 * from then on the feature is worse than not having it.
 */

export const metadata = { title: 'Change impact' };

export default async function ChangePage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ node?: string }>;
}) {
  const { projectId } = await params;
  const { node: selectedId } = await searchParams;

  const loaded = await loadPlanRows(projectId);
  if (loaded === null) notFound();

  const { project, nodes, edges } = loaded;
  const planGraph = graphFromRows(projectId, nodes, edges);

  /*
   * Impact is analysed against the *decomposed* graph, not the stored one.
   *
   * The stored graph holds requirements, phases and risks; the work, tests and evidence that hang off
   * them are produced by the decomposer at render time. Analysing the stored graph alone reported
   * "nothing depends on what you changed" for every requirement in a real project — a sentence that
   * is true of that graph and false of the project, which is the worst kind of wrong answer this
   * surface can give.
   */
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

  const graph =
    planGraph.size === 0
      ? planGraph
      : mergeIntoGraph(
          planGraph,
          decompose({
            projectId,
            graph: planGraph,
            emissions: evaluation.emissions,
            at: new Date().toISOString(),
          }),
        );

  /*
   * Candidates are limited to classes where a change is a decision somebody makes, rather than every
   * node in the graph. Offering two thousand things to change would make the useful ones unfindable,
   * and most nodes are derived — changing them directly is not a thing a person does.
   */
  const candidates = [
    ...graph.nodesOfClass('REQUIREMENT'),
    ...graph.nodesOfClass('ARCHITECTURE_COMPONENT'),
    ...graph.nodesOfClass('ARCHITECTURE_DECISION'),
  ];

  const selected = selectedId === undefined ? undefined : graph.node(selectedId);

  const report =
    selected === undefined
      ? undefined
      : analyseImpact(graph, [
          {
            nodeId: selected.id,
            kind: 'MATERIAL',
            summary: `A material change to ${selected.label}.`,
          },
        ]);

  const summary = report === undefined ? undefined : summariseImpact(report);

  return (
    <div className="min-h-screen bg-background">
      <PublicHeader />

      <main id="main" className="mx-auto flex max-w-content flex-col gap-lg px-md py-xl">
        <header className="flex flex-col gap-sm">
          <p className="font-sans text-label-caps tracking-wider text-on-surface-variant uppercase">
            Change impact
          </p>
          <h1 className="font-sans text-headline-lg text-on-surface">{project.name}</h1>
          <p className="font-sans text-body-md text-on-surface-variant">
            Pick something and see what stops being true. Every result shows the path that reached
            it, so you can disagree with the reasoning rather than only with the answer.
          </p>
        </header>

        {candidates.length === 0 ? (
          <section className="flex flex-col gap-md rounded-lg border border-outline-variant bg-surface-container-low p-lg">
            <h2 className="font-sans text-headline-sm text-on-surface">Nothing to change yet</h2>
            <p className="font-sans text-body-sm text-on-surface-variant">
              Impact is calculated from requirements and architecture. Neither has been recorded, so
              there is nothing that could have consequences.
            </p>
          </section>
        ) : (
          <section className="flex flex-col gap-md" aria-labelledby="pick-heading">
            <h2 id="pick-heading" className="font-sans text-headline-sm text-on-surface">
              What would you change?
            </h2>

            <ul className="flex flex-wrap gap-sm">
              {candidates.map((candidate) => (
                <li key={candidate.id}>
                  <Link
                    href={`/plan/${projectId}/change?node=${encodeURIComponent(candidate.id)}`}
                    aria-current={candidate.id === selectedId ? 'true' : undefined}
                    className={`inline-flex min-h-11 items-center gap-sm rounded border px-md font-sans text-body-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                      candidate.id === selectedId
                        ? 'border-primary bg-primary/10 text-on-surface'
                        : 'border-outline-variant text-on-surface-variant hover:bg-surface-container'
                    }`}
                  >
                    {candidate.label}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {report === undefined || summary === undefined ? null : (
          <>
            <section
              className="flex flex-col gap-sm rounded-lg border border-outline-variant bg-surface-container-low p-lg"
              role="status"
            >
              <p className="font-sans text-headline-sm text-on-surface">{summary.headline}</p>

              <dl className="mt-sm grid grid-cols-2 gap-md sm:grid-cols-4">
                {(['INVALIDATED', 'REVALIDATION_REQUIRED', 'STALE', 'CURRENT'] as const).map(
                  (state) => (
                    <div key={state} className="flex flex-col gap-xs">
                      <dt className="font-sans text-label-caps tracking-wider text-on-surface-variant uppercase">
                        {state.toLowerCase().replace(/_/g, ' ')}
                      </dt>
                      {/* An absolute count. A proportion of the project would be optimisable and
                          would tell a reader nothing they could act on. */}
                      <dd className="font-mono text-headline-sm text-on-surface">
                        {summary.counts[state]}
                      </dd>
                    </div>
                  ),
                )}
              </dl>

              {report.truncated ? (
                <p className="flex items-start gap-sm font-sans text-body-sm text-warning">
                  <MaterialIcon name="warning" size={16} className="mt-0.5 shrink-0" />
                  The analysis stopped at its depth limit. Something further out was not examined —
                  said explicitly, because a truncated analysis shown as complete is
                  indistinguishable from a complete one.
                </p>
              ) : null}
            </section>

            {report.impacted.length > 0 ? (
              <section className="flex flex-col gap-md" aria-labelledby="impact-heading">
                <h2 id="impact-heading" className="font-sans text-headline-sm text-on-surface">
                  What stops being true
                </h2>

                <ul className="flex flex-col gap-sm">
                  {report.impacted.map((item) => (
                    <ImpactRow key={item.nodeId} item={item} />
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}

        <div className="flex flex-wrap gap-lg">
          <Link
            href={`/plan/${projectId}`}
            className="inline-flex items-center gap-sm font-sans text-body-sm text-on-surface-variant transition-colors hover:text-on-surface"
          >
            <MaterialIcon name="arrow_back" size={16} />
            Back to the plan
          </Link>
          <Link
            href={`/plan/${projectId}/trace`}
            className="inline-flex items-center gap-sm font-sans text-body-sm text-on-surface-variant transition-colors hover:text-on-surface"
          >
            <MaterialIcon name="account_tree" size={16} />
            Traceability
          </Link>
        </div>
      </main>
    </div>
  );
}

function ImpactRow({ item }: { readonly item: ImpactedNode }) {
  return (
    <li className={`flex flex-col gap-sm rounded border p-md ${toneClasses(item.staleness)}`}>
      <p className="flex flex-wrap items-center gap-sm font-sans text-body-md text-on-surface">
        <MaterialIcon name={toneIcon(item.staleness)} size={16} />
        {item.label}
        {/* The state word, always. Colour alone would fail WCAG 2.2 §1.4.1, and the four states are
            the entire meaning of the row. */}
        <span className="font-mono text-data-mono-sm text-on-surface-variant">
          {item.staleness.toLowerCase().replace(/_/g, ' ')}
        </span>
        <span className="font-mono text-data-mono-sm text-on-surface-variant">
          {item.nodeClass.toLowerCase().replace(/_/g, ' ')}
        </span>
      </p>

      <p className="font-sans text-body-sm text-on-surface-variant">
        {STALENESS_MEANING[item.staleness]}
      </p>

      {/* The path. This is what makes the verdict checkable rather than something to be believed. */}
      <ol className="flex flex-col gap-xs border-l-2 border-outline-variant pl-md">
        {item.path.map((hop) => (
          <li key={`${hop.fromId}:${hop.edge}:${hop.toId}`} className="flex flex-col gap-xs">
            <p className="font-mono text-data-mono-sm text-on-surface">
              {hop.fromId} → {hop.edge.toLowerCase().replace(/_/g, ' ')} → {hop.toId}
            </p>
            <p className="font-sans text-body-sm text-on-surface-variant">{hop.because}</p>
          </li>
        ))}
      </ol>
    </li>
  );
}

function toneClasses(state: Staleness): string {
  if (state === 'INVALIDATED') return 'border-danger/40 bg-danger/10';
  if (state === 'REVALIDATION_REQUIRED') return 'border-warning/40 bg-warning/10';
  return 'border-outline-variant bg-surface-container-low';
}

function toneIcon(state: Staleness): IconName {
  if (state === 'INVALIDATED') return 'cancel';
  if (state === 'REVALIDATION_REQUIRED') return 'warning';
  return 'schedule';
}
