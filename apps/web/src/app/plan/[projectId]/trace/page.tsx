import Link from 'next/link';
import { notFound } from 'next/navigation';
import { graphFromRows } from '@govintel/twin/repository';
import { CHAIN, type ChainTrace, type HopKey } from '@govintel/traceability/chain';
import { analyse, summarise, type Gap } from '@govintel/traceability/gaps';
import { PublicHeader } from '../../../../components/shell/PublicHeader.tsx';
import { MaterialIcon } from '../../../../components/ui/MaterialIcon.tsx';
import { loadPlanRows } from '../actions.ts';

/**
 * Requirement → Release traceability.
 *
 * The page has to resist three temptations.
 *
 * The first is the coverage percentage. "87% traceable" fits in a box and is worth nothing: nobody
 * can act on it, everybody can optimise it, and it moves for reasons no reader can see. So this page
 * carries counts and named gaps and no ratio anywhere.
 *
 * The second is subtler. §25 says healthy items stay quiet, and a page that goes quiet correctly is
 * indistinguishable from a page with nothing to check. A project with no requirements would render
 * as a clean bill of health, which is the worst possible reading of the worst possible state. So the
 * empty case is written out explicitly rather than falling through to silence.
 *
 * The third is the wall, and this page fell for it. Once the rules' 139 emitted requirements were
 * materialised, rendering every chain in full put 3,239 elements and 1.28 MB on one page — 553 list
 * items in "Every chain" alone, plus 117 non-blocking gap cards repeating three sentences between
 * them. Firefox's accessibility-tree walker took longer than the test timeout on it and the axe
 * check failed in CI, which is the same way the evidence page's 64 forms were found.
 *
 * So the page keeps what a reader has to act on — the counts, and every gap that blocks release —
 * and hands the rest to two places that can hold it honestly: one row per requirement here, and the
 * full chain on the requirement's own page. The point is not that the page got shorter. It is that
 * 117 cards saying "this requirement does not reach as far as evidence, and an earlier gap is doing
 * the blocking" are one fact repeated 117 times, and repeating it is what hid the 41 that matter.
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
  const consequent = report.gaps.filter(
    (g) => !g.blocking && (g.direction === 'FORWARD' || g.direction === 'NEITHER'),
  );
  const backward = report.gaps.filter((g) => g.direction === 'BACKWARD');

  // Exception-first, per §25: the chains with something wrong come before the ones that are fine.
  const traces = [...report.traces].sort((a, b) => Number(a.complete) - Number(b.complete));

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
            projectId={projectId}
            title="Blocking release"
            description="Only the earliest broken hop in each chain blocks. Reporting every downstream consequence as blocking would turn this into a wall that hides the other requirements."
            gaps={blocking}
            tone="danger"
          />
        ) : null}

        {consequent.length > 0 ? <ConsequenceSection gaps={consequent} /> : null}

        {backward.length > 0 ? (
          <GapSection
            id="backward"
            projectId={projectId}
            title="Things that exist for no recorded reason"
            description="The direction most traceability reports leave out. Work that traces back to no requirement is either scope nobody asked for or a requirement nobody wrote down, and neither is visible looking forwards."
            gaps={backward}
            tone="warning"
          />
        ) : null}

        {traces.length > 0 ? (
          <section className="flex flex-col gap-md" aria-labelledby="chains-heading">
            <div className="flex flex-col gap-xs">
              <h2 id="chains-heading" className="font-sans text-headline-sm text-on-surface">
                Every requirement
              </h2>
              <p className="font-sans text-body-sm text-on-surface-variant">
                Where each chain stands, and where it stops. A chain is complete only when every
                required hop is linked — a hop that is present but cannot support its claim, an
                unrun test or evidence with no artefact, counts as broken, because a chain that
                looks complete and is not is worse than an obvious gap. Open one to see every hop,
                what its status means and what the missing ones would have told you.
              </p>
            </div>

            <ul className="flex flex-col gap-xs">
              {traces.map((trace) => (
                <TraceRow key={trace.requirementId} projectId={projectId} trace={trace} />
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

/** The requirement a gap is about, when it is about one. Forward and neither-direction gaps always
 * carry it first; backward gaps are about a task or a test and carry no requirement at all, which is
 * the whole point of them. */
function requirementOf(gap: Gap): string | undefined {
  return gap.direction === 'BACKWARD' ? undefined : gap.evidence[0];
}

/*
 * The requirement's own page.
 *
 * Node ids are `project:kind:key`, and the colons become path separators rather than `%3A`. A single
 * encoded segment was tried first and produced a URL ending `%3Areq%3Aauthentication` whose page
 * could not find the requirement it named — the id arrives still encoded, and every layer between
 * here and the route has an opinion about who decodes it. Segments have no such argument.
 *
 * The project prefix is dropped because it is already in the path. The route puts it back.
 *
 * Not exported: Next rejects unknown exports from a page module, and this is only needed here.
 */
function requirementHref(projectId: string, requirementId: string): string {
  const withoutProject = requirementId.startsWith(`${projectId}:`)
    ? requirementId.slice(projectId.length + 1)
    : requirementId;

  const segments = withoutProject.split(':').map((segment) => encodeURIComponent(segment));

  return `/plan/${projectId}/trace/${segments.join('/')}`;
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
  projectId,
  title,
  description,
  gaps,
  tone,
}: {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly description: string;
  readonly tone: 'danger' | 'warning';
  readonly gaps: readonly Gap[];
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
        {gaps.map((gap) => {
          const requirementId = requirementOf(gap);

          return (
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
              {requirementId === undefined ? (
                <p className="font-mono text-data-mono-sm break-all text-on-surface-variant">
                  {gap.evidence.join(' · ')}
                </p>
              ) : (
                <Link
                  href={requirementHref(projectId, requirementId)}
                  className="font-mono text-data-mono-sm break-all text-on-surface-variant underline transition-colors hover:text-on-surface"
                >
                  {gap.evidence.join(' · ')}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Gaps that are already accounted for by an earlier one.
 *
 * Grouped by kind rather than listed. Every one of these is a *consequence*: a requirement with no
 * work will also have no test and no evidence, and the model already says so — only the earliest
 * broken hop blocks. Listed individually they were 117 cards carrying three distinct sentences
 * between them, which is not a report, and which pushed the 41 blocking gaps off the top of the page.
 *
 * The count and the reason stay. Which requirements they are stays too, one line each, in "Every
 * requirement" below — where it can be read next to everything else about the same requirement
 * instead of three sections away from it.
 */
function ConsequenceSection({ gaps }: { readonly gaps: readonly Gap[] }) {
  const byKind = new Map<
    string,
    { readonly why: string; count: number; requirements: Set<string> }
  >();

  for (const gap of gaps) {
    const existing = byKind.get(gap.kind) ?? { why: gap.why, count: 0, requirements: new Set() };
    existing.count += 1;
    const requirementId = requirementOf(gap);
    if (requirementId !== undefined) existing.requirements.add(requirementId);
    byKind.set(gap.kind, existing);
  }

  return (
    <section className="flex flex-col gap-md" aria-labelledby="consequent-heading">
      <div className="flex flex-col gap-xs">
        <h2 id="consequent-heading" className="font-sans text-headline-sm text-on-surface">
          Recorded, not blocking
        </h2>
        <p className="font-sans text-body-sm text-on-surface-variant">
          Each of these has an earlier gap that is doing the blocking, so they are counted rather
          than listed one by one — a requirement with no work will also have no test and no
          evidence, and saying so three times says nothing three times. Every one of them is named
          below, and its own page says which hop it stopped at.
        </p>
      </div>

      <ul className="flex flex-col gap-sm">
        {[...byKind.entries()].map(([kind, group]) => (
          <li
            key={kind}
            className="flex flex-col gap-xs rounded border border-outline-variant bg-surface-container-low p-md"
          >
            <p className="flex items-start gap-sm font-sans text-body-md text-on-surface">
              <MaterialIcon name="warning" size={16} className="mt-0.5 shrink-0" />
              {consequenceSummary(kind, group.requirements.size, group.count)}
            </p>
            <p className="font-sans text-body-sm text-on-surface-variant">{group.why}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

const CONSEQUENCE_PHRASES: Readonly<Record<string, string>> = {
  REQUIREMENT_WITHOUT_WORK: 'have no work planned against them',
  REQUIREMENT_WITHOUT_TEST: 'have no test behind them',
  REQUIREMENT_WITHOUT_EVIDENCE: 'have no evidence kept for them',
  REQUIREMENT_NOT_TRACEABLE: 'record no way of being verified',
};

function consequenceSummary(kind: string, requirements: number, count: number): string {
  const subject =
    requirements > 0
      ? `${String(requirements)} requirement${requirements === 1 ? '' : 's'}`
      : `${String(count)} finding${count === 1 ? '' : 's'}`;

  const phrase = CONSEQUENCE_PHRASES[kind];

  // A kind with no phrase written for it says the kind, rather than saying nothing. Silence here
  // would drop a whole category of finding off the page the first time one is added.
  return phrase === undefined ? `${subject}: ${kind}` : `${subject} ${phrase}.`;
}

function TraceRow({
  projectId,
  trace,
}: {
  readonly projectId: string;
  readonly trace: ChainTrace;
}) {
  return (
    <li className="flex flex-wrap items-baseline gap-sm">
      <Link
        href={requirementHref(projectId, trace.requirementId)}
        className="font-sans text-body-md text-on-surface underline transition-colors hover:text-primary"
      >
        {trace.requirementLabel}
      </Link>{' '}
      {/* The status word carries it. Colour alone would fail WCAG 2.2 §1.4.1, and a row that is only
          a colour is unreadable rather than merely degraded. The space is a real text node: adjacent
          JSX elements have none, and the row would otherwise read "Authenticate userscomplete" to
          anything walking the text rather than the layout. */}
      <span className="font-mono text-data-mono-sm text-on-surface-variant">
        {trace.complete ? 'complete' : `breaks at ${hopLabel(trace.brokeAt)}`}
      </span>
    </li>
  );
}

function hopLabel(hop: HopKey | undefined): string {
  if (hop === undefined) return 'an unknown hop';
  return CHAIN.find((h) => h.key === hop)?.label ?? hop;
}
