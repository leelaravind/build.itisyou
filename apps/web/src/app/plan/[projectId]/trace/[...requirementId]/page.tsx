import Link from 'next/link';
import { notFound } from 'next/navigation';
import { graphFromRows } from '@govintel/twin/repository';
import { CHAIN, traceRequirement, type Link as ChainLink } from '@govintel/traceability/chain';
import { analyse } from '@govintel/traceability/gaps';
import { PublicHeader } from '../../../../../components/shell/PublicHeader.tsx';
import { MaterialIcon } from '../../../../../components/ui/MaterialIcon.tsx';
import { loadPlanRows } from '../../actions.ts';

/**
 * One requirement, followed hop by hop.
 *
 * This page exists because the index could not hold it. Listing every chain there put 139 chains and
 * 553 list items on one page — 3,239 elements and 1.28 MB, measured — which is the same wall the
 * evidence page grew and was cut back from, and it failed the same way: Firefox's accessibility-tree
 * walker took longer than the 30s test timeout, so the axe check on the traceability page timed out
 * in CI.
 *
 * The fix is not to hide the chains behind a disclosure. That keeps every one of them in the
 * document and only makes them invisible, so the page stays exactly as large and exactly as hard to
 * navigate with a screen reader. They live on their own page instead, one requirement at a time,
 * which also makes room for the two things the index never had room for: what the *absence* of a hop
 * means for this requirement, and what each link's status is actually saying — the latter was in a
 * `title` tooltip, which is to say available to a mouse and to nothing else.
 */

export const metadata = { title: 'Requirement traceability' };

export default async function RequirementTracePage({
  params,
}: {
  params: Promise<{ projectId: string; requirementId: readonly string[] }>;
}) {
  const { projectId, requirementId } = await params;

  const loaded = await loadPlanRows(projectId);
  if (loaded === null) notFound();

  const { nodes, edges } = loaded;
  const graph = graphFromRows(projectId, nodes, edges);

  /*
   * The id is carried as path segments, not as one encoded segment.
   *
   * Node ids are `project:kind:key`, and a colon written into a single segment has to be
   * percent-encoded — which produced a URL ending `%3Areq%3Aauthentication` and a page that could
   * not find its own requirement. Splitting on the colon spends nothing and removes the question of
   * who decodes what, from here down to whatever proxy is in front of it.
   *
   * Both shapes are looked up because the href omits the project prefix that every id carries, and
   * an id that does not follow that convention should still resolve rather than 404 quietly.
   */
  const joined = requirementId.join(':');
  const requirement = graph.node(joined) ?? graph.node(`${projectId}:${joined}`);

  /*
   * A requirement id that names nothing in this project is a 404, not an empty chain.
   *
   * An empty chain reads as a requirement nobody has done anything about, which is a far worse thing
   * to say by accident than "no such page" — and it is the module's original defect wearing a
   * different hat.
   */
  if (requirement?.class !== 'REQUIREMENT') notFound();

  const trace = traceRequirement(graph, requirement.id);
  const report = analyse(graph);

  const gaps = report.gaps.filter((gap) => gap.evidence[0] === requirement.id);
  const findings = report.requirementFindings.filter((f) => f.requirementId === requirement.id);

  const description = typeof requirement.description === 'string' ? requirement.description : '';

  return (
    <div className="min-h-screen bg-background">
      <PublicHeader />

      <main id="main" className="mx-auto flex max-w-content flex-col gap-lg px-md py-xl">
        <header className="flex flex-col gap-sm">
          <p className="font-sans text-label-caps tracking-wider text-on-surface-variant uppercase">
            Traceability
          </p>
          <h1 className="font-sans text-headline-lg text-on-surface">{requirement.label}</h1>
          {description === '' ? null : (
            <p className="font-sans text-body-md text-on-surface-variant">{description}</p>
          )}
          <p className="font-mono text-data-mono-sm break-all text-on-surface-variant">
            {requirement.id}
          </p>
        </header>

        <section
          className={`flex flex-col gap-sm rounded-lg border p-lg ${
            trace.complete ? 'border-tertiary/40 bg-tertiary/10' : 'border-warning/40 bg-warning/10'
          }`}
          role="status"
        >
          <p className="flex items-center gap-sm font-sans text-headline-sm text-on-surface">
            <MaterialIcon name={trace.complete ? 'check_circle' : 'error'} size={20} />
            {trace.complete
              ? 'This requirement traces all the way through.'
              : `This chain breaks at ${hopLabelFor(trace.brokeAt)}.`}
          </p>
          <p className="font-sans text-body-sm text-on-surface-variant">
            A chain is complete only when every required hop is linked. A hop that is present but
            cannot support its claim — an unrun test, evidence with no artefact — counts as broken,
            because a chain that looks complete and is not is worse than an obvious gap.
          </p>
        </section>

        <section className="flex flex-col gap-md" aria-labelledby="chain-heading">
          <h2 id="chain-heading" className="font-sans text-headline-sm text-on-surface">
            The chain
          </h2>

          <ol className="flex flex-col gap-sm">
            {trace.links.map((link) => (
              <HopRow key={link.hop} link={link} />
            ))}
          </ol>
        </section>

        {gaps.length > 0 ? (
          <section className="flex flex-col gap-md" aria-labelledby="gaps-heading">
            <h2 id="gaps-heading" className="font-sans text-headline-sm text-on-surface">
              What is missing
            </h2>

            <ul className="flex flex-col gap-sm">
              {gaps.map((gap) => (
                <li
                  key={`${gap.kind}:${gap.evidence.join(',')}`}
                  className={`flex flex-col gap-xs rounded border p-md ${
                    gap.blocking
                      ? 'border-danger/40 bg-danger/10'
                      : 'border-outline-variant bg-surface-container-low'
                  }`}
                >
                  <p className="flex items-start gap-sm font-sans text-body-md text-on-surface">
                    <MaterialIcon
                      name={gap.blocking ? 'cancel' : 'warning'}
                      size={16}
                      className="mt-0.5 shrink-0"
                    />
                    {gap.summary}
                  </p>
                  <p className="font-sans text-body-sm text-on-surface-variant">{gap.why}</p>
                  <p className="font-mono text-data-mono-sm break-all text-on-surface-variant">
                    {gap.blocking ? 'blocking · ' : 'not blocking · '}
                    {gap.evidence.join(' · ')}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {findings.length > 0 ? (
          <section className="flex flex-col gap-md" aria-labelledby="findings-heading">
            <div className="flex flex-col gap-xs">
              <h2 id="findings-heading" className="font-sans text-headline-sm text-on-surface">
                About the requirement itself
              </h2>
              <p className="font-sans text-body-sm text-on-surface-variant">
                Upstream of the chain. These are things about how the requirement is written, and no
                amount of work, testing or evidence downstream will settle them.
              </p>
            </div>

            <ul className="flex flex-col gap-sm">
              {findings.map((finding) => (
                <li
                  key={finding.defect}
                  className="flex flex-col gap-xs rounded border border-outline-variant bg-surface-container-low p-md"
                >
                  <p className="flex items-start gap-sm font-sans text-body-md text-on-surface">
                    <MaterialIcon
                      name={finding.blocking ? 'cancel' : 'warning'}
                      size={16}
                      className="mt-0.5 shrink-0"
                    />
                    {finding.summary}
                  </p>
                  <p className="font-sans text-body-sm text-on-surface-variant">{finding.why}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="flex flex-wrap gap-lg">
          <Link
            href={`/plan/${projectId}/trace`}
            className="inline-flex items-center gap-sm font-sans text-body-sm text-on-surface-variant transition-colors hover:text-on-surface"
          >
            <MaterialIcon name="arrow_back" size={16} />
            Every requirement
          </Link>
          <Link
            href={`/plan/${projectId}`}
            className="inline-flex items-center gap-sm font-sans text-body-sm text-on-surface-variant transition-colors hover:text-on-surface"
          >
            <MaterialIcon name="checklist" size={16} />
            Back to the plan
          </Link>
        </div>
      </main>
    </div>
  );
}

function HopRow({ link }: { readonly link: ChainLink }) {
  const hop = CHAIN.find((h) => h.key === link.hop);

  return (
    <li className="flex flex-col gap-xs rounded border border-outline-variant bg-surface-container-low p-md">
      <p className="flex flex-wrap items-center gap-sm font-sans text-body-md text-on-surface">
        <span className="font-sans text-title-sm text-on-surface">{hop?.label ?? link.hop}</span>
        {/*
         * A real space, not only the flex gap.
         *
         * Two adjacent spans in JSX have no text node between them, so the row read "Workmissing" to
         * anything walking the text rather than the layout — which is every screen reader announcing
         * the line as one string, and which is how this was found. A whitespace-only sequence between
         * flex items is not rendered as an item, so the layout is unchanged.
         */}{' '}
        {/* The status word is always present. Colour alone would fail WCAG 2.2 §1.4.1. */}
        <span
          className={`rounded px-sm py-xs font-mono text-data-mono-sm ${statusClasses(link.status)}`}
        >
          {link.status.toLowerCase().replace(/_/g, ' ')}
        </span>
        {hop?.required === false ? (
          <>
            {' '}
            <span className="font-mono text-data-mono-sm text-on-surface-variant">
              not required
            </span>
          </>
        ) : null}
      </p>

      {/*
       * Was a `title` tooltip on the index, which is to say available to a mouse and to nothing else.
       *
       * For a missing hop this is the hop's `absenceMeans` — what its absence means for this
       * requirement, in the project's terms. Rendering that separately as well was tried and dropped:
       * it printed the same sentence twice, which reads as two findings that agree rather than as one.
       */}
      <p className="font-sans text-body-sm text-on-surface-variant">{link.detail}</p>

      {link.nodeIds.length > 0 ? (
        <p className="font-mono text-data-mono-sm break-all text-on-surface-variant">
          {link.nodeIds.join(' · ')}
        </p>
      ) : null}
    </li>
  );
}

function hopLabelFor(hop: string | undefined): string {
  if (hop === undefined) return 'an unknown hop';
  return CHAIN.find((h) => h.key === hop)?.label ?? hop;
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
