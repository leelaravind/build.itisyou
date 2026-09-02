import Link from 'next/link';
import { notFound } from 'next/navigation';
import { graphFromRows } from '@govintel/twin/repository';
import { analyse } from '@govintel/traceability/gaps';
import {
  CRITERION_MEANING,
  assessClosure,
  type CriterionOutcome,
} from '@govintel/completion/closure';
import { PublicHeader } from '../../../../components/shell/PublicHeader.tsx';
import { MaterialIcon } from '../../../../components/ui/MaterialIcon.tsx';
import { loadPlanRows } from '../actions.ts';
import type { IconName } from '../../../../components/ui/icon-paths.ts';

/**
 * Closure.
 *
 * "This project is complete" is the strongest claim the platform ever makes, and the page has to
 * resist making it easy to make falsely. Two rules follow.
 *
 * **A project resting on accepted exceptions must not look like one resting on none.** Both closed;
 * they did not close the same way, and the difference is the entire content of the record for whoever
 * inherits the project.
 *
 * **An undecidable criterion must not look like a failed one.** They need different work — one needs
 * a fix, the other needs somebody to answer a question nobody has asked — and an exception can cover
 * the first and must never cover the second.
 */

export const metadata = { title: 'Closure' };

export default async function ClosePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const loaded = await loadPlanRows(projectId);
  if (loaded === null) notFound();

  const { project, nodes, edges } = loaded;
  const graph = graphFromRows(projectId, nodes, edges);

  const traceability = analyse(graph);

  /*
   * Assessed with nothing supplied that a real closure would supply: no ownership, no debt register,
   * no retrospective, no accepted exceptions.
   *
   * That is the honest position for a project that has not been through handover, and showing it is
   * the point — the page tells somebody what closing would require long before they try.
   */
  const assessment = assessClosure({
    graph,
    closedBy: 'guest',
    exceptions: [],
    ownership: [],
    incidents: [],
    debt: [],
    blockingTraceabilityGaps: traceability.counts.blocked,
    untraceableRequirements: traceability.counts.notAssessable,
    failingTests: 0,
    openSecurityFindings: 0,
    staleDocuments: 0,
    unverifiableEvidence: 0,
    hasDeliveredWork: graph.nodesOfClass('TASK').length > 0,
  });

  const unknown = assessment.outcomes.filter((o) => o.result === 'UNKNOWN');

  return (
    <div className="min-h-screen bg-background">
      <PublicHeader />

      <main id="main" className="mx-auto flex max-w-content flex-col gap-lg px-md py-xl">
        <header className="flex flex-col gap-sm">
          <p className="font-sans text-label-caps tracking-wider text-on-surface-variant uppercase">
            Closure
          </p>
          <h1 className="font-sans text-headline-lg text-on-surface">{project.name}</h1>
          <p className="font-sans text-body-md text-on-surface-variant">
            A project closes when every criterion is met, or when somebody has accepted an exception
            in writing. Each criterion is a question about the day after everybody leaves.
          </p>
        </header>

        <section
          className={`flex flex-col gap-sm rounded-lg border p-lg ${
            assessment.mayClose
              ? 'border-tertiary/40 bg-tertiary/10'
              : 'border-warning/40 bg-warning/10'
          }`}
          role="status"
        >
          <p className="flex items-center gap-sm font-sans text-headline-sm text-on-surface">
            <MaterialIcon name={assessment.mayClose ? 'task_alt' : 'pending_actions'} size={20} />
            {assessment.headline}
          </p>

          {assessment.restingOn.length > 0 ? (
            <ul className="flex flex-col gap-xs">
              {assessment.restingOn.map((held) => (
                <li key={held.id} className="font-sans text-body-sm text-on-surface-variant">
                  {held.acceptedBy}: {held.reason} — {held.consequence}
                </li>
              ))}
            </ul>
          ) : null}

          {unknown.length > 0 ? (
            <p className="flex items-start gap-sm font-sans text-body-sm text-on-surface-variant">
              <MaterialIcon name="help" size={16} className="mt-0.5 shrink-0" />
              An exception accepts a shortfall somebody knows about. Where a criterion cannot be
              decided at all there is nothing to accept, so the underlying question has to be
              answered first.
            </p>
          ) : null}
        </section>

        <section className="flex flex-col gap-md" aria-labelledby="criteria-heading">
          <h2 id="criteria-heading" className="font-sans text-headline-sm text-on-surface">
            What closing requires
          </h2>

          <ul className="flex flex-col gap-sm">
            {assessment.outcomes.map((outcome) => (
              <CriterionRow key={outcome.criterion} outcome={outcome} />
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
            href={`/plan/${projectId}/release`}
            className="inline-flex items-center gap-sm font-sans text-body-sm text-on-surface-variant transition-colors hover:text-on-surface"
          >
            <MaterialIcon name="rocket_launch" size={16} />
            Release readiness
          </Link>
        </div>
      </main>
    </div>
  );
}

function CriterionRow({ outcome }: { readonly outcome: CriterionOutcome }) {
  return (
    <li className={`flex flex-col gap-xs rounded border p-md ${toneClasses(outcome.result)}`}>
      <p className="flex flex-wrap items-center gap-sm font-sans text-body-md text-on-surface">
        <MaterialIcon name={toneIcon(outcome.result)} size={16} />
        {outcome.criterion.toLowerCase().replace(/_/g, ' ')}
        {/* The result word, always. The four states mean genuinely different work, and colour alone
            would fail WCAG 2.2 §1.4.1 while also making them indistinguishable. */}
        <span className="font-mono text-data-mono-sm text-on-surface-variant">
          {outcome.result.toLowerCase().replace(/_/g, ' ')}
        </span>
      </p>

      <p className="font-sans text-body-sm text-on-surface-variant">{outcome.explanation}</p>

      {/* What the criterion is asking, in terms of the day after everybody leaves. A criterion name
          is a label; this is the reason somebody should care about it. */}
      <p className="font-sans text-body-sm text-on-surface-variant italic">
        {CRITERION_MEANING[outcome.criterion]}
      </p>
    </li>
  );
}

function toneClasses(result: string): string {
  if (result === 'MET') return 'border-tertiary/40 bg-tertiary/10';
  if (result === 'NOT_MET') return 'border-danger/40 bg-danger/10';
  // Excepted is neither met nor failed, and rendering it as met would erase the distinction the
  // whole closure record exists to preserve.
  if (result === 'EXCEPTED') return 'border-warning/40 bg-warning/10';
  return 'border-outline-variant bg-surface-container-low';
}

function toneIcon(result: string): IconName {
  if (result === 'MET') return 'check_circle';
  if (result === 'NOT_MET') return 'cancel';
  if (result === 'EXCEPTED') return 'gpp_maybe';
  return 'help';
}
