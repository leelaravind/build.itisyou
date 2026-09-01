import Link from 'next/link';
import { notFound } from 'next/navigation';
import { graphFromRows } from '@govintel/twin/repository';
import { testsFromGraph } from '@govintel/release/testing';
import { evaluateReadiness, type GateOutcome } from '@govintel/release/readiness';
import { PublicHeader } from '../../../../components/shell/PublicHeader.tsx';
import { MaterialIcon } from '../../../../components/ui/MaterialIcon.tsx';
import { loadPlanRows } from '../actions.ts';

/**
 * Release readiness.
 *
 * This is the page somebody screenshots into a change-approval ticket, which makes it the page where
 * an over-confident rendering does the most damage. Two rules follow from that.
 *
 * **An unevaluated gate must not look like a passing one.** Six green ticks where four of the gates
 * were never reached would be read as approval. So indeterminate gates are rendered distinctly, and
 * the page says which of the two an empty result is.
 *
 * **A gate resting on exceptions must not look like one resting on none.** Both passed; they did not
 * pass the same way, and the difference is exactly what a reviewer is there to see.
 */

export const metadata = { title: 'Release readiness' };

export default async function ReleasePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const loaded = await loadPlanRows(projectId);
  if (loaded === null) notFound();

  const { project, nodes, edges } = loaded;
  const graph = graphFromRows(projectId, nodes, edges);

  /*
   * Everything a real release would supply is absent for a project that has not deployed: no plans,
   * no approvals, no production checks, no ownership.
   *
   * That is the honest state, and rendering it is the point — this page shows what a project would
   * need before it could ship, which is far more useful early than a page that refuses to appear
   * until the answers exist.
   */
  const report = evaluateReadiness({
    graph,
    tests: testsFromGraph(graph),
    requiredCategories: ['UNIT', 'END_TO_END', 'SECURITY', 'ACCESSIBILITY'],
    findings: [],
    plans: [],
    requiredPlans: ['DEPLOYMENT', 'ROLLBACK', 'MIGRATION', 'MONITORING', 'BACKUP', 'CONFIGURATION'],
    productionChecks: [],
    approvals: [],
    target: 'PRODUCTION',
    alreadyDeployedTo: [],
    ownership: [],
    incidents: [],
    debt: [],
    exceptions: [],
    asOf: new Date().toISOString().slice(0, 10),
  });

  return (
    <div className="min-h-screen bg-background">
      <PublicHeader />

      <main id="main" className="mx-auto flex max-w-content flex-col gap-lg px-md py-xl">
        <header className="flex flex-col gap-sm">
          <p className="font-sans text-label-caps tracking-wider text-on-surface-variant uppercase">
            Release readiness
          </p>
          <h1 className="font-sans text-headline-lg text-on-surface">{project.name}</h1>
          <p className="font-sans text-body-md text-on-surface-variant">
            Six gates, in order. A gate whose predecessor has not passed is not evaluated at all —
            reported as undecided rather than failed, so nobody is sent to fix a problem that
            belongs further up.
          </p>
        </header>

        <section
          className={`flex flex-col gap-sm rounded-lg border p-lg ${
            report.releasable
              ? 'border-tertiary/40 bg-tertiary/10'
              : 'border-warning/40 bg-warning/10'
          }`}
          role="status"
        >
          <p className="flex items-center gap-sm font-sans text-headline-sm text-on-surface">
            <MaterialIcon name={report.releasable ? 'check_circle' : 'block'} size={20} />
            {report.releasable
              ? 'Every gate passes.'
              : `Stopped at the ${(report.stoppedAt ?? 'first').toLowerCase().replace(/_/g, ' ')} gate.`}
          </p>

          {report.nextAction === null ? null : (
            <>
              <p className="font-sans text-body-md text-on-surface">{report.nextAction.summary}</p>
              <p className="font-sans text-body-sm text-on-surface-variant">
                {report.nextAction.why}
              </p>
            </>
          )}
        </section>

        <section className="flex flex-col gap-md" aria-labelledby="gates-heading">
          <h2 id="gates-heading" className="font-sans text-headline-sm text-on-surface">
            The gates
          </h2>

          <ol className="flex flex-col gap-sm">
            {report.gates.map((gate) => (
              <GateRow key={gate.gate} gate={gate} />
            ))}
          </ol>
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

function GateRow({ gate }: { readonly gate: GateOutcome }) {
  const name = gate.gate.toLowerCase().replace(/_/g, ' ');

  return (
    <li className={`flex flex-col gap-sm rounded border p-md ${toneClasses(gate.result)}`}>
      <p className="flex items-center gap-sm font-sans text-body-md text-on-surface">
        <MaterialIcon name={toneIcon(gate.result)} size={16} />
        <span className="capitalize">{name}</span>
        {/* The result word, always. Colour alone would fail WCAG 2.2 §1.4.1, and here the three
            states are the entire content of the row. */}
        <span className="font-mono text-data-mono-sm text-on-surface-variant">
          {gate.result.toLowerCase()}
        </span>
      </p>

      <p className="font-sans text-body-sm text-on-surface-variant">{gate.explanation}</p>

      {gate.blockers.length > 0 ? (
        <ul className="flex flex-col gap-xs">
          {gate.blockers.map((blocker) => (
            <li key={blocker.summary} className="flex flex-col gap-xs">
              <p className="flex items-start gap-sm font-sans text-body-sm text-on-surface">
                <MaterialIcon name="arrow_right" size={16} className="mt-0.5 shrink-0" />
                {blocker.summary}
              </p>
              {/* The argument, not only the verdict. Every other finding surface in the platform
                  carries one, and this is the page most likely to be pasted into an approval
                  ticket — the one place a reason nobody can dispute does the most damage. */}
              <p className="pl-lg font-sans text-body-sm text-on-surface-variant">{blocker.why}</p>
            </li>
          ))}
        </ul>
      ) : null}

      {gate.observations.length > 0 ? (
        <details className="rounded border border-outline-variant bg-surface-container p-sm">
          <summary className="cursor-pointer font-sans text-body-sm text-on-surface-variant">
            {/* Recorded and not blocking. A passing gate still says what it is carrying, because
                "nothing blocking" and "nothing at all" are different reports. */}
            {gate.observations.length} recorded, not blocking
          </summary>
          <ul className="mt-sm flex flex-col gap-xs">
            {gate.observations.map((observation) => (
              <li
                key={observation.summary}
                className="font-sans text-body-sm text-on-surface-variant"
              >
                {observation.summary}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {gate.restingOn.length > 0 ? (
        <p className="flex items-start gap-sm font-sans text-body-sm text-warning">
          <MaterialIcon name="gpp_maybe" size={16} className="mt-0.5 shrink-0" />
          Resting on {gate.restingOn.length} live exception
          {gate.restingOn.length === 1 ? '' : 's'}: {gate.restingOn.join(', ')}
        </p>
      ) : null}
    </li>
  );
}

function toneClasses(result: string): string {
  if (result === 'PASSED') return 'border-tertiary/40 bg-tertiary/10';
  if (result === 'FAILED') return 'border-danger/40 bg-danger/10';
  // Indeterminate is neither. Rendering it as a failure would blame a gate that was never evaluated.
  return 'border-outline-variant bg-surface-container-low';
}

function toneIcon(result: string): string {
  if (result === 'PASSED') return 'check_circle';
  if (result === 'FAILED') return 'cancel';
  return 'help';
}
