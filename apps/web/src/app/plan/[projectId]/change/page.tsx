import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { intakeAnswers } from '@govintel/db/schema';
import type { IntakeField } from '@govintel/intake/schema';
import { graphFromRows } from '@govintel/twin/repository';
import { decompose, mergeIntoGraph } from '@govintel/execution/decompose';
import { analyseImpact, summariseImpact, type ImpactedNode } from '@govintel/change/impact';
import { STALENESS_MEANING, type Staleness } from '@govintel/change/propagation';
import { evaluateForProject } from '../../../../lib/server/project-rules.ts';
import { PublicHeader } from '../../../../components/shell/PublicHeader.tsx';
import { MaterialIcon } from '../../../../components/ui/MaterialIcon.tsx';
import { withDatabase } from '../../../../lib/server/database.ts';
import { loadPlanRows } from '../actions.ts';
import { applyChange, changeRequestsFor, decideChange, requestChange } from '../change-actions.ts';
import type { IconName } from '../../../../components/ui/icon-paths.ts';
import {
  ActionOutcome,
  CHANGE_REFUSALS,
  messageFor,
} from '../../../../components/ui/ActionOutcome.tsx';

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
  searchParams: Promise<{
    node?: string;
    error?: string;
    requested?: string;
    decided?: string;
    applied?: string;
  }>;
}) {
  const { projectId } = await params;
  const { node: selectedId, error, requested, decided, applied } = await searchParams;

  const outcome =
    error !== undefined
      ? {
          tone: 'refused' as const,
          message: messageFor(
            CHANGE_REFUSALS,
            error,
            'That could not be done. Nothing was changed.',
          ),
        }
      : applied !== undefined
        ? {
            tone: 'success' as const,
            message: 'The change was applied and the project moved to a new version.',
          }
        : decided !== undefined
          ? { tone: 'success' as const, message: 'The decision was recorded.' }
          : requested !== undefined
            ? {
                tone: 'success' as const,
                message:
                  'The change request was raised, with its impact recorded against this version.',
              }
            : undefined;

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

  const { evaluation } = evaluateForProject({
    projectId,
    projectType: project.projectType,
    lifecycleState: project.lifecycleState,
    intake,
    graph: planGraph,
  });

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

  const requests = await changeRequestsFor(projectId);

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

        {outcome === undefined ? null : (
          <ActionOutcome tone={outcome.tone} message={outcome.message} />
        )}

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

        {selected === undefined || summary === undefined ? null : (
          <section
            aria-labelledby="request-heading"
            className="flex flex-col gap-md rounded-lg border border-outline-variant bg-surface-container-low p-lg"
          >
            <h2 id="request-heading" className="font-sans text-headline-sm text-on-surface">
              Request this change
            </h2>
            <p className="font-sans text-body-sm text-on-surface-variant">
              The impact above is recorded with the request, against version {project.version} of
              this project. If the project moves on before the change is applied, the request is
              superseded rather than applied — an approval is an approval of the report somebody
              actually read.
            </p>

            <form action={requestChange} className="flex flex-col gap-sm">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="nodeId" value={selected.id} />

              <div className="flex flex-col gap-xs">
                <label htmlFor="change-title" className="font-sans text-body-sm text-on-surface">
                  What is changing?
                </label>
                <input
                  id="change-title"
                  name="title"
                  required
                  className="rounded border border-outline-variant bg-surface px-sm py-xs font-sans text-body-sm text-on-surface"
                />
              </div>

              <div className="flex flex-col gap-xs">
                <label htmlFor="change-kind" className="font-sans text-body-sm text-on-surface">
                  What kind of change?
                </label>
                <select
                  id="change-kind"
                  name="kind"
                  defaultValue="MATERIAL"
                  className="rounded border border-outline-variant bg-surface px-sm py-xs font-sans text-body-sm text-on-surface"
                >
                  <option value="MATERIAL">Material — what it requires, does or costs</option>
                  <option value="COSMETIC">Cosmetic — wording only, nothing depends on it</option>
                  <option value="WITHDRAWAL">Withdrawal — it is being removed</option>
                </select>
                {/* Cosmetic exists so renaming a requirement does not invalidate its test suite. */}
                <p className="font-sans text-body-sm text-on-surface-variant">
                  Cosmetic changes propagate to nothing. Choosing it for a change that is not
                  cosmetic is how an impact report comes back reassuringly empty.
                </p>
              </div>

              <div className="flex flex-col gap-xs">
                <label
                  htmlFor="change-rationale"
                  className="font-sans text-body-sm text-on-surface"
                >
                  Why?
                </label>
                <textarea
                  id="change-rationale"
                  name="rationale"
                  rows={2}
                  required
                  className="rounded border border-outline-variant bg-surface px-sm py-xs font-sans text-body-sm text-on-surface"
                  placeholder="A change request with no reason cannot be argued about."
                />
              </div>

              <button
                type="submit"
                className="inline-flex w-fit items-center gap-xs rounded bg-primary px-md py-sm font-sans text-body-md text-on-primary hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                Record this request
              </button>
            </form>
          </section>
        )}

        {requests === null || requests.rows.length === 0 ? null : (
          <section aria-labelledby="requests-heading" className="flex flex-col gap-md">
            <h2 id="requests-heading" className="font-sans text-headline-sm text-on-surface">
              Change requests
            </h2>

            <ul className="flex flex-col gap-md">
              {requests.rows.map((row) => (
                <ChangeRequestRow
                  key={row.id}
                  projectId={projectId}
                  row={row}
                  actor={requests.actor}
                  projectVersion={requests.projectVersion}
                />
              ))}
            </ul>
          </section>
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

/**
 * One change request, with whatever it is currently possible to do to it.
 *
 * The controls are decided by the request's own state and by who is looking, not by a flag: a
 * request pending approval offers a decision, an approved one offers apply, and a decided one offers
 * nothing. Showing a disabled button for something that cannot happen is how people learn to ignore
 * the state.
 */
function ChangeRequestRow({
  projectId,
  row,
  actor,
  projectVersion,
}: {
  readonly projectId: string;
  readonly row: {
    id: string;
    title: string;
    rationale: string;
    state: string;
    baseVersion: number;
    requestedBy: string;
    decisionReason: string | null;
    /** Whether the engine decided this needs somebody else's approval. */
    requiresApproval: boolean;
  };
  readonly actor: string;
  readonly projectVersion: number;
}) {
  const isRequester = row.requestedBy === actor;
  const stale = row.baseVersion !== projectVersion;

  return (
    <li className="flex flex-col gap-sm rounded-lg border border-outline-variant bg-surface p-md">
      <div className="flex flex-wrap items-baseline justify-between gap-sm">
        <h3 className="font-sans text-title-sm text-on-surface">{row.title}</h3>
        <span className="font-mono text-data-mono-sm text-on-surface-variant">
          {row.state.toLowerCase().replace(/_/g, ' ')} · against version {row.baseVersion}
        </span>
      </div>

      <p className="font-sans text-body-sm text-on-surface-variant">{row.rationale}</p>

      {row.decisionReason === null ? null : (
        <p className="font-sans text-body-sm text-on-surface">Decision: {row.decisionReason}</p>
      )}

      {/*
        Said before it is tried, not after.

        The project has moved on, so this request describes consequences that were calculated against
        a project that no longer exists. Applying it is refused, and offering the button anyway would
        teach somebody that the refusal is arbitrary.
      */}
      {stale && row.state !== 'APPLIED' && row.state !== 'SUPERSEDED' ? (
        <p className="flex items-center gap-xs font-sans text-body-sm text-warning">
          <MaterialIcon name="warning" size={16} />
          The project is now at version {projectVersion}. This impact was calculated against version{' '}
          {row.baseVersion}, so it can no longer be applied.
        </p>
      ) : null}

      {row.state === 'PENDING_APPROVAL' ? (
        isRequester && row.requiresApproval ? (
          <p className="flex items-center gap-xs font-sans text-body-sm text-on-surface-variant">
            <MaterialIcon name="lock" size={16} />
            You asked for this, so you cannot approve it. Self-approval records a decision with
            nobody independent behind it, which is worse than no approval because the record looks
            complete.
          </p>
        ) : (
          <form action={decideChange} className="flex flex-col gap-sm">
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="requestId" value={row.id} />

            <label htmlFor={`reason-${row.id}`} className="font-sans text-body-sm text-on-surface">
              Why are you deciding this way?
            </label>
            <textarea
              id={`reason-${row.id}`}
              name="reason"
              rows={2}
              required
              className="rounded border border-outline-variant bg-surface px-sm py-xs font-sans text-body-sm text-on-surface"
            />

            <div className="flex flex-wrap gap-sm">
              <button
                type="submit"
                name="decision"
                value="APPROVED"
                className="inline-flex items-center gap-xs rounded bg-primary px-md py-sm font-sans text-body-sm text-on-primary hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                Approve
              </button>
              <button
                type="submit"
                name="decision"
                value="REJECTED"
                className="inline-flex items-center gap-xs rounded border border-outline-variant px-md py-sm font-sans text-body-sm text-on-surface hover:bg-surface-container-high focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                Reject
              </button>
            </div>
          </form>
        )
      ) : null}

      {row.state === 'APPROVED' && !stale ? (
        <form action={applyChange}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="requestId" value={row.id} />
          <button
            type="submit"
            className="inline-flex w-fit items-center gap-xs rounded bg-primary px-md py-sm font-sans text-body-sm text-on-primary hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Apply it
            <MaterialIcon name="arrow_forward" size={16} />
          </button>
        </form>
      ) : null}
    </li>
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
