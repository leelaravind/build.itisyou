import Link from 'next/link';
import { notFound } from 'next/navigation';
import { graphFromRows } from '@govintel/twin/repository';
import { CHAIN, type ChainTrace, type Link as ChainLink } from '@govintel/traceability/chain';
import { analyse, summarise } from '@govintel/traceability/gaps';
import { PublicHeader } from '../../../../components/shell/PublicHeader.tsx';
import { MaterialIcon } from '../../../../components/ui/MaterialIcon.tsx';
import { loadPlanRows } from '../actions.ts';

/**
 * Requirement → Release traceability.
 *
 * The page has to resist two temptations at once.
 *
 * The first is the coverage percentage. "87% traceable" fits in a box and is worth nothing: nobody
 * can act on it, everybody can optimise it, and it moves for reasons no reader can see. So this page
 * carries counts and named gaps and no ratio anywhere.
 *
 * The second is subtler. §25 says healthy items stay quiet, and a page that goes quiet correctly is
 * indistinguishable from a page with nothing to check. A project with no requirements would render
 * as a clean bill of health, which is the worst possible reading of the worst possible state. So the
 * empty case is written out explicitly rather than falling through to silence.
 */

export const metadata = { title: 'Traceability' };

export default async function TracePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const loaded = await loadPlanRows(projectId);
  if (loaded === null) notFound();

  const { project, nodes, edges } = loaded;
  const graph = graphFromRows(projectId, nodes, edges);

  const report = analyse(graph);
  const summary = summarise(report);

  const blocking = report.gaps.filter((g) => g.blocking);
  const forward = report.gaps.filter((g) => g.direction === 'FORWARD' && !g.blocking);
  const backward = report.gaps.filter((g) => g.direction === 'BACKWARD');
  const neither = report.gaps.filter((g) => g.direction === 'NEITHER');

  return (
    <div className="min-h-screen bg-background">
      <PublicHeader />

      <main id="main" className="mx-auto flex max-w-content flex-col gap-lg px-md py-xl">
        <header className="flex flex-col gap-sm">
          <p className="font-sans text-label-caps tracking-wider text-on-surface-variant uppercase">
            Traceability
          </p>
          <h1 className="font-sans text-headline-lg text-on-surface">{project.name}</h1>
          <p className="font-sans text-body-md text-on-surface-variant">
            Every requirement, followed through to the work that meets it, the test that checks it
            and the evidence that was kept. Counts, not a coverage figure — a percentage would be
            something to optimise rather than something to fix.
          </p>
        </header>

        <section
          className={`flex flex-col gap-sm rounded-lg border p-lg ${
            summary.quiet ? 'border-tertiary/40 bg-tertiary/10' : 'border-warning/40 bg-warning/10'
          }`}
          role="status"
        >
          <p className="flex items-center gap-sm font-sans text-headline-sm text-on-surface">
            <MaterialIcon name={summary.quiet ? 'check_circle' : 'warning'} size={20} />
            {summary.headline}
          </p>

          <dl className="mt-sm grid grid-cols-2 gap-md sm:grid-cols-4">
            <Count label="Requirements" value={report.counts.requirements} />
            <Count label="Fully traced" value={report.counts.complete} />
            <Count label="Blocking gaps" value={report.counts.blocked} />
            <Count label="Not assessable" value={report.counts.notAssessable} />
          </dl>

          {report.counts.notAssessable > 0 ? (
            <p className="font-sans text-body-sm text-on-surface-variant">
              &ldquo;Not assessable&rdquo; is neither traced nor gapped. Those requirements record
              no way of being verified, so nobody could write the test yet — reporting them as
              missing a test would send somebody to do work they cannot specify.
            </p>
          ) : null}
        </section>

        {blocking.length > 0 ? (
          <GapSection
            id="blocking"
            title="Blocking release"
            description="Only the earliest broken hop in each chain blocks. Reporting every downstream consequence as blocking would turn this into a wall that hides the other requirements."
            gaps={blocking}
            tone="danger"
          />
        ) : null}

        {forward.length > 0 ? (
          <GapSection
            id="forward"
            title="Requirements that do not reach far enough"
            description="Recorded, not blocking. Each of these has an earlier gap that is doing the blocking."
            gaps={forward}
            tone="warning"
          />
        ) : null}

        {backward.length > 0 ? (
          <GapSection
            id="backward"
            title="Things that exist for no recorded reason"
            description="The direction most traceability reports leave out. Work that traces back to no requirement is either scope nobody asked for or a requirement nobody wrote down, and neither is visible looking forwards."
            gaps={backward}
            tone="warning"
          />
        ) : null}

        {neither.length > 0 ? (
          <GapSection
            id="neither"
            title="Requirements that cannot be traced at all"
            description="These record no way of being verified, so there is nothing to trace them to. The fix is upstream of the chain."
            gaps={neither}
            tone="warning"
          />
        ) : null}

        {report.traces.length > 0 ? (
          <section className="flex flex-col gap-md" aria-labelledby="chains-heading">
            <div className="flex flex-col gap-xs">
              <h2 id="chains-heading" className="font-sans text-headline-sm text-on-surface">
                Every chain
              </h2>
              <p className="font-sans text-body-sm text-on-surface-variant">
                A chain is complete only when every required hop is linked. A hop that is present
                but cannot support its claim — an unrun test, evidence with no artefact — counts as
                broken, because a chain that looks complete and is not is worse than an obvious gap.
              </p>
            </div>

            <ul className="flex flex-col gap-sm">
              {report.traces.map((trace) => (
                <TraceRow key={trace.requirementId} trace={trace} />
              ))}
            </ul>
          </section>
        ) : null}

        <div className="flex flex-wrap gap-lg">
          <Link
            href={`/plan/${projectId}`}
            className="inline-flex items-center gap-sm font-sans text-body-sm text-on-surface-variant transition-colors hover:text-on-surface"
          >
            <MaterialIcon name="arrow_back" size={16} />
            Back to the plan
          </Link>
          <Link
            href={`/plan/${projectId}/work`}
            className="inline-flex items-center gap-sm font-sans text-body-sm text-on-surface-variant transition-colors hover:text-on-surface"
          >
            <MaterialIcon name="checklist" size={16} />
            The work
          </Link>
        </div>
      </main>
    </div>
  );
}

function Count({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <div className="flex flex-col gap-xs">
      <dt className="font-sans text-label-caps tracking-wider text-on-surface-variant uppercase">
        {label}
      </dt>
      {/* An absolute number. There is deliberately no ratio anywhere on this page. */}
      <dd className="font-mono text-headline-sm text-on-surface">{value}</dd>
    </div>
  );
}

function GapSection({
  id,
  title,
  description,
  gaps,
  tone,
}: {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly tone: 'danger' | 'warning';
  readonly gaps: readonly {
    readonly kind: string;
    readonly summary: string;
    readonly why: string;
    readonly evidence: readonly string[];
  }[];
}) {
  return (
    <section className="flex flex-col gap-md" aria-labelledby={`${id}-heading`}>
      <div className="flex flex-col gap-xs">
        <h2 id={`${id}-heading`} className="font-sans text-headline-sm text-on-surface">
          {title}
        </h2>
        <p className="font-sans text-body-sm text-on-surface-variant">{description}</p>
      </div>

      <ul className="flex flex-col gap-sm">
        {gaps.map((gap) => (
          <li
            key={`${gap.kind}:${gap.evidence.join(',')}`}
            className={`flex flex-col gap-xs rounded border p-md ${
              tone === 'danger'
                ? 'border-danger/40 bg-danger/10'
                : 'border-outline-variant bg-surface-container-low'
            }`}
          >
            <p className="flex items-start gap-sm font-sans text-body-md text-on-surface">
              <MaterialIcon
                name={tone === 'danger' ? 'cancel' : 'warning'}
                size={16}
                className="mt-0.5 shrink-0"
              />
              {gap.summary}
            </p>
            <p className="font-sans text-body-sm text-on-surface-variant">{gap.why}</p>
            {/* Evidence ids, so a reader can go and look. A finding with nothing to check is an assertion. */}
            <p className="font-mono text-data-mono-sm break-all text-on-surface-variant">
              {gap.evidence.join(' · ')}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TraceRow({ trace }: { readonly trace: ChainTrace }) {
  return (
    <li className="flex flex-col gap-sm rounded border border-outline-variant bg-surface-container-low p-md">
      <p className="flex items-center gap-sm font-sans text-body-md text-on-surface">
        <MaterialIcon name={trace.complete ? 'check_circle' : 'error'} size={16} />
        {trace.requirementLabel}
        <span className="font-mono text-data-mono-sm text-on-surface-variant">
          {trace.complete ? 'complete' : `breaks at ${trace.brokeAt ?? 'unknown'}`}
        </span>
      </p>

      <ol className="flex flex-wrap gap-xs">
        {trace.links.map((link) => (
          <li key={link.hop} className="flex items-center gap-xs">
            <span
              className={`rounded px-sm py-xs font-mono text-data-mono-sm ${statusClasses(link.status)}`}
              title={link.detail}
            >
              {/* The status word is always present. Colour alone would fail WCAG 2.2 §1.4.1. */}
              {hopLabel(link)} {link.status.toLowerCase().replace(/_/g, ' ')}
            </span>
            {link.hop === CHAIN[CHAIN.length - 1]?.key ? null : (
              <MaterialIcon
                name="chevron_right"
                size={14}
                className="text-on-surface-variant"
                aria-hidden
              />
            )}
          </li>
        ))}
      </ol>
    </li>
  );
}

function hopLabel(link: ChainLink): string {
  return CHAIN.find((hop) => hop.key === link.hop)?.label ?? link.hop;
}

function statusClasses(status: string): string {
  switch (status) {
    case 'LINKED':
      return 'bg-tertiary/20 text-on-surface';
    case 'STALE':
      return 'bg-danger/20 text-on-surface';
    case 'UNVERIFIED':
      return 'bg-warning/20 text-on-surface';
    case 'MISSING':
      return 'bg-danger/10 text-on-surface';
    default:
      return 'bg-surface-container text-on-surface-variant';
  }
}
