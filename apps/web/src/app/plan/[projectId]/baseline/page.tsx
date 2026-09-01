import Link from 'next/link';
import { notFound } from 'next/navigation';
import { graphFromRows } from '@govintel/twin/repository';
import {
  BASELINE_MEANING,
  BASELINE_TYPES,
  REQUIRES_APPROVAL,
  createBaseline,
  variance,
  verifyIntegrity,
} from '@govintel/governance/baseline';
import { PublicHeader } from '../../../../components/shell/PublicHeader.tsx';
import { MaterialIcon } from '../../../../components/ui/MaterialIcon.tsx';
import { loadPlanRows } from '../actions.ts';

/**
 * Baselines and variance.
 *
 * A baseline is somebody saying "this is what we agreed", and the page has to make two things
 * visible that a governance record normally hides.
 *
 * **Whether it can still be trusted.** The integrity check is shown, not buried. A baseline nobody
 * has verified is a claim about the past with nothing behind it, and the whole reason for storing a
 * checksum is that the answer becomes a computation rather than an assumption.
 *
 * **What has moved since.** As named items, never as a drift percentage. "38% divergence" is
 * unactionable and optimisable; "these four requirements changed and this one was removed" is the
 * conversation somebody needs to have.
 */

export const metadata = { title: 'Baseline' };

export default async function BaselinePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const loaded = await loadPlanRows(projectId);
  if (loaded === null) notFound();

  const { project, nodes, edges } = loaded;
  const graph = graphFromRows(projectId, nodes, edges);

  /*
   * A demonstration baseline taken against the project as it stands.
   *
   * Persisting baselines needs the storage layer this phase does not build; what the page can show
   * honestly is what a baseline of this project *would* capture, and that it verifies. Anything
   * beyond that would be claiming a governance record the project does not have.
   */
  const taken =
    graph.size === 0
      ? undefined
      : createBaseline(graph, {
          id: `${projectId}:preview`,
          type: 'APPROVED_PLAN',
          label: 'Preview of the plan as it stands',
          version: 1,
          createdBy: 'preview',
          reason: 'Shows what a baseline of this project would capture and that it verifies.',
          takenAt: new Date().toISOString(),
          correlationId: projectId,
        });

  const baseline = taken?.ok === true ? taken.value : undefined;
  const integrity = baseline === undefined ? undefined : verifyIntegrity(baseline);
  const drift = baseline === undefined ? undefined : variance(baseline, graph);

  return (
    <div className="min-h-screen bg-background">
      <PublicHeader />

      <main id="main" className="mx-auto flex max-w-content flex-col gap-lg px-md py-xl">
        <header className="flex flex-col gap-sm">
          <p className="font-sans text-label-caps tracking-wider text-on-surface-variant uppercase">
            Baseline
          </p>
          <h1 className="font-sans text-headline-lg text-on-surface">{project.name}</h1>
          <p className="font-sans text-body-md text-on-surface-variant">
            A baseline is somebody saying this is what we agreed, on this date, for this reason. It
            is never edited — a later one supersedes it and points back, so the history is a chain
            rather than a series of overwrites.
          </p>
        </header>

        {baseline === undefined || integrity === undefined || drift === undefined ? (
          <section className="flex flex-col gap-md rounded-lg border border-outline-variant bg-surface-container-low p-lg">
            <h2 className="font-sans text-headline-sm text-on-surface">Nothing to baseline yet</h2>
            <p className="font-sans text-body-sm text-on-surface-variant">
              There is no plan to capture. An empty baseline hashes cleanly and verifies forever
              while recording nothing, which makes it worse than no baseline — it looks like one.
            </p>
          </section>
        ) : (
          <>
            <section
              className={`flex flex-col gap-sm rounded-lg border p-lg ${
                integrity.intact
                  ? 'border-tertiary/40 bg-tertiary/10'
                  : 'border-danger/40 bg-danger/10'
              }`}
              role="status"
            >
              <p className="flex items-center gap-sm font-sans text-headline-sm text-on-surface">
                <MaterialIcon name={integrity.intact ? 'verified' : 'gpp_bad'} size={20} />
                {/* The verdict in words. Colour alone would fail WCAG 2.2 §1.4.1, and this is the
                    single most consequential sentence on the page. */}
                {integrity.intact ? 'Verified' : 'Integrity check failed'}
              </p>

              <p className="font-sans text-body-sm text-on-surface-variant">
                {integrity.explanation}
              </p>

              <dl className="mt-sm flex flex-col gap-xs">
                <div className="flex flex-wrap gap-sm">
                  <dt className="font-sans text-body-sm text-on-surface-variant">Checksum</dt>
                  <dd className="font-mono text-data-mono-sm break-all text-on-surface">
                    {baseline.checksum}
                  </dd>
                </div>
                <div className="flex flex-wrap gap-sm">
                  <dt className="font-sans text-body-sm text-on-surface-variant">Captures</dt>
                  <dd className="font-mono text-data-mono-sm text-on-surface">
                    {baseline.nodes.length} nodes, {baseline.edges.length} edges
                  </dd>
                </div>
              </dl>
            </section>

            <section className="flex flex-col gap-md" aria-labelledby="variance-heading">
              <div className="flex flex-col gap-xs">
                <h2 id="variance-heading" className="font-sans text-headline-sm text-on-surface">
                  What has moved
                </h2>
                <p className="font-sans text-body-sm text-on-surface-variant">{drift.summary}</p>
              </div>

              {/* Named items, never a percentage. Removal is listed separately because it is the
                  one people miss: something that stopped existing does not appear in a diff of the
                  things that are still there. */}
              <div className="grid gap-sm sm:grid-cols-3">
                <DriftColumn label="Changed" ids={drift.changed} />
                <DriftColumn label="Added" ids={drift.added} />
                <DriftColumn label="Removed" ids={drift.removed} />
              </div>
            </section>
          </>
        )}

        <section className="flex flex-col gap-md" aria-labelledby="types-heading">
          <h2 id="types-heading" className="font-sans text-headline-sm text-on-surface">
            The two kinds of baseline
          </h2>

          <ul className="flex flex-col gap-sm">
            {BASELINE_TYPES.map((type) => (
              <li
                key={type}
                className="flex flex-col gap-xs rounded border border-outline-variant bg-surface-container-low p-md"
              >
                <p className="font-sans text-body-md text-on-surface">
                  {type.toLowerCase().replace(/_/g, ' ')}
                </p>
                <p className="font-sans text-body-sm text-on-surface-variant">
                  {BASELINE_MEANING[type]}
                </p>
                {REQUIRES_APPROVAL[type] ? (
                  <p className="flex items-start gap-sm font-sans text-body-sm text-warning">
                    <MaterialIcon name="how_to_reg" size={16} className="mt-0.5 shrink-0" />
                    Requires an approval before it can be taken. It records what was shipped, and
                    shipping is a decision somebody is accountable for.
                  </p>
                ) : null}
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

function DriftColumn({ label, ids }: { readonly label: string; readonly ids: readonly string[] }) {
  return (
    <div className="flex flex-col gap-xs rounded border border-outline-variant bg-surface-container-low p-md">
      <p className="font-sans text-label-caps tracking-wider text-on-surface-variant uppercase">
        {label}
      </p>
      {/* An absolute count beside the names. There is no ratio anywhere on this page. */}
      <p className="font-mono text-headline-sm text-on-surface">{ids.length}</p>

      {ids.length === 0 ? null : (
        <ul className="flex flex-col gap-xs">
          {ids.map((id) => (
            <li key={id} className="font-mono text-data-mono-sm break-all text-on-surface-variant">
              {id}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
