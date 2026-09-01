import Link from 'next/link';
import { notFound } from 'next/navigation';
import { graphFromRows } from '@govintel/twin/repository';
import { checkInvariants } from '@govintel/twin/invariants';
import type { TwinNode } from '@govintel/twin/nodes';
import { PublicHeader } from '../../../components/shell/PublicHeader.tsx';
import { MaterialIcon } from '../../../components/ui/MaterialIcon.tsx';
import { generatePlan, loadPlanRows } from './actions.ts';

/**
 * The generated plan.
 *
 * The first surface that reads the Digital Twin, so it sets the pattern the rest of the product
 * follows: **every figure is shown with where it came from**. A phase the engine derived and a fact
 * the user confirmed look different on the page, because they carry different weight and a reader who
 * cannot tell them apart cannot judge the plan.
 *
 * Assumptions and unknowns are not a footnote either. Plan §10 and gap-spec §10: what the platform
 * had to assume is part of the plan, and a plan that hides it produces numbers indistinguishable from
 * well-founded ones.
 */

export const metadata = { title: 'The plan' };

const PROVENANCE_LABEL: Record<string, string> = {
  USER_CONFIRMED: 'You confirmed this',
  DETERMINISTIC_CALCULATION: 'Worked out by the engine',
  USER_PROVIDED: 'You told us',
  EXTERNAL_SOURCE: 'From a cited source',
  ASSUMPTION: 'Assumed',
  EXTERNAL_AI_INFERENCE: 'An AI inferred it',
  FUTURE_ML_PREDICTION: 'Predicted',
};

export default async function PlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { projectId } = await params;
  const { error } = await searchParams;

  const loaded = await loadPlanRows(projectId);
  if (loaded === null) notFound();

  const { project, nodes, edges } = loaded;

  const graph = graphFromRows(
    projectId,
    nodes.map((n) => ({ ...n, attributes: n.attributes })),
    edges,
  );

  const generated = graph.size > 0;
  const report = generated ? checkInvariants(graph) : null;

  const phases = graph.nodesOfClass('PHASE');
  const requirements = graph.nodesOfClass('REQUIREMENT');
  const risks = graph.nodesOfClass('RISK');
  const assumptions = graph.nodesOfClass('ASSUMPTION');
  const unknowns = graph.nodesOfClass('UNKNOWN');

  return (
    <div className="min-h-screen bg-background">
      <PublicHeader />

      <main id="main" className="mx-auto flex max-w-content flex-col gap-lg px-md py-xl">
        <header className="flex flex-col gap-sm">
          <p className="font-sans text-label-caps tracking-wider text-on-surface-variant uppercase">
            The plan
          </p>
          <h1 className="font-sans text-headline-lg text-on-surface">{project.name}</h1>
          {project.summary === null ? null : (
            <p className="font-sans text-body-md text-on-surface-variant">{project.summary}</p>
          )}
        </header>

        {error === undefined ? null : (
          <p
            role="alert"
            className="flex items-center gap-sm rounded border border-danger/40 bg-danger/10 p-md font-sans text-body-sm text-on-surface"
          >
            <MaterialIcon name="error" size={18} className="text-danger" />
            {error === 'archived'
              ? 'This project is archived, so its plan cannot be regenerated.'
              : 'The plan could not be generated. Nothing was changed.'}
          </p>
        )}

        {generated ? null : (
          <section className="flex flex-col gap-md rounded-lg border border-outline-variant bg-surface-container-low p-lg">
            <h2 className="font-sans text-headline-sm text-on-surface">No plan yet</h2>
            <p className="font-sans text-body-sm text-on-surface-variant">
              The engine builds the plan from what you have told us. It uses no AI and invents
              nothing: the same answers produce the same plan every time, and anything it had to
              assume is listed rather than hidden.
            </p>
            <GenerateButton projectId={projectId} label="Build the plan" />
          </section>
        )}

        {generated ? (
          <>
            <section
              className="flex flex-col gap-md rounded-lg border border-outline-variant bg-surface-container-low p-lg"
              aria-labelledby="summary-heading"
            >
              <h2 id="summary-heading" className="font-sans text-headline-sm text-on-surface">
                What the engine produced
              </h2>

              <dl className="grid grid-cols-2 gap-md sm:grid-cols-4">
                <Stat label="Phases" value={phases.length} />
                <Stat label="Requirements" value={requirements.length} />
                <Stat label="Risks" value={risks.length} />
                <Stat label="Open questions" value={unknowns.length} />
              </dl>

              <p className="font-mono text-data-mono-sm text-on-surface-variant">
                {graph.size} items · {graph.edgeCount} relationships
              </p>
            </section>

            {report !== null && report.violations.length > 0 ? (
              <section className="flex flex-col gap-sm" aria-labelledby="issues-heading">
                <h2 id="issues-heading" className="font-sans text-headline-sm text-on-surface">
                  Worth knowing about this plan
                </h2>
                <ul className="flex flex-col gap-sm">
                  {report.violations.map((violation, index) => (
                    <li
                      key={`${violation.code}-${String(index)}`}
                      className="flex items-start gap-sm rounded border border-outline-variant bg-surface-container-low p-md"
                    >
                      <MaterialIcon
                        name={violation.severity === 'ERROR' ? 'error' : 'info'}
                        size={16}
                        className={
                          violation.severity === 'ERROR' ? 'text-danger' : 'text-on-surface-variant'
                        }
                      />
                      <p className="font-sans text-body-sm text-on-surface-variant">
                        {violation.message}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <NodeSection
              id="phases"
              title="Phases"
              description="Sequential until dependencies are established. Each one has a gate that must pass before it counts as finished."
              nodes={phases}
            />

            <NodeSection
              id="requirements"
              title="Requirements"
              description="Each one traces back to something you answered. Nothing here was invented."
              nodes={requirements}
            />

            <NodeSection
              id="risks"
              title="Risks"
              description="Derived from the shape of the project, not from a generic checklist."
              nodes={risks}
            />

            {/* Plan §10: what the platform assumed is part of the plan, not a footnote. */}
            <NodeSection
              id="assumptions"
              title="What we assumed"
              description="Nobody has confirmed these. If any of them is wrong, the plan changes."
              nodes={assumptions}
              tone="warning"
            />

            <NodeSection
              id="unknowns"
              title="What we still do not know"
              description="Stated rather than guessed. Answering these makes the plan more specific."
              nodes={unknowns}
              tone="warning"
            />

            <section className="flex flex-col gap-sm rounded-lg border border-outline-variant bg-surface-container-low p-lg">
              <h2 className="font-sans text-headline-sm text-on-surface">Answered more since?</h2>
              <p className="font-sans text-body-sm text-on-surface-variant">
                Rebuilding uses whatever you have told us now. The same answers always produce the
                same plan, so nothing shifts unless something you said did.
              </p>
              <GenerateButton projectId={projectId} label="Rebuild the plan" />
            </section>
          </>
        ) : null}

        {generated ? (
          <section className="flex flex-col gap-sm rounded-lg border border-outline-variant bg-surface-container-low p-lg">
            <h2 className="font-sans text-headline-sm text-on-surface">What the rules require</h2>
            <p className="font-sans text-body-sm text-on-surface-variant">
              The engine checks this project against a catalogue of rules and quality gates. Each
              finding names the rule behind it, so you can disagree with it.
            </p>
            <Link
              href={`/plan/${projectId}/rules`}
              className="mt-sm inline-flex min-h-11 w-fit items-center gap-sm rounded border border-outline-variant px-lg font-sans text-body-sm text-on-surface transition-colors hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              See the findings
              <MaterialIcon name="rule" size={18} />
            </Link>
            <Link
              href={`/plan/${projectId}/work`}
              className="mt-sm inline-flex min-h-11 w-fit items-center gap-sm rounded border border-outline-variant px-lg font-sans text-body-sm text-on-surface transition-colors hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              See the work
              <MaterialIcon name="checklist" size={18} />
            </Link>
            <Link
              href={`/plan/${projectId}/budget`}
              className="mt-sm inline-flex min-h-11 w-fit items-center gap-sm rounded border border-outline-variant px-lg font-sans text-body-sm text-on-surface transition-colors hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              See the money
              <MaterialIcon name="payments" size={18} />
            </Link>
            <Link
              href={`/plan/${projectId}/trace`}
              className="mt-sm inline-flex min-h-11 w-fit items-center gap-sm rounded border border-outline-variant px-lg font-sans text-body-sm text-on-surface transition-colors hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              See the traceability
              <MaterialIcon name="account_tree" size={18} />
            </Link>
            <Link
              href={`/plan/${projectId}/release`}
              className="mt-sm inline-flex min-h-11 w-fit items-center gap-sm rounded border border-outline-variant px-lg font-sans text-body-sm text-on-surface transition-colors hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              See release readiness
              <MaterialIcon name="rocket_launch" size={18} />
            </Link>
            <Link
              href={`/plan/${projectId}/change`}
              className="mt-sm inline-flex min-h-11 w-fit items-center gap-sm rounded border border-outline-variant px-lg font-sans text-body-sm text-on-surface transition-colors hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              See what a change would break
              <MaterialIcon name="alt_route" size={18} />
            </Link>
            <Link
              href={`/plan/${projectId}/baseline`}
              className="mt-sm inline-flex min-h-11 w-fit items-center gap-sm rounded border border-outline-variant px-lg font-sans text-body-sm text-on-surface transition-colors hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              See the baseline
              <MaterialIcon name="verified" size={18} />
            </Link>
            <Link
              href={`/plan/${projectId}/close`}
              className="mt-sm inline-flex min-h-11 w-fit items-center gap-sm rounded border border-outline-variant px-lg font-sans text-body-sm text-on-surface transition-colors hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              See what closing requires
              <MaterialIcon name="task_alt" size={18} />
            </Link>
          </section>
        ) : null}

        <Link
          href={`/intake/${projectId}`}
          className="inline-flex w-fit items-center gap-sm font-sans text-body-sm text-on-surface-variant transition-colors hover:text-on-surface"
        >
          <MaterialIcon name="arrow_back" size={16} />
          Back to intake
        </Link>
      </main>
    </div>
  );
}

function GenerateButton({
  projectId,
  label,
}: {
  readonly projectId: string;
  readonly label: string;
}) {
  return (
    <form action={generatePlan}>
      <input type="hidden" name="projectId" value={projectId} />
      <button
        type="submit"
        className="mt-sm inline-flex min-h-11 w-fit items-center gap-sm rounded bg-primary px-lg font-sans text-body-sm font-medium text-on-primary transition-colors hover:bg-primary-fixed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <MaterialIcon name="account_tree" size={18} />
        {label}
      </button>
    </form>
  );
}

function NodeSection({
  id,
  title,
  description,
  nodes,
  tone = 'default',
}: {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly nodes: readonly TwinNode[];
  readonly tone?: 'default' | 'warning';
}) {
  if (nodes.length === 0) return null;

  return (
    <section className="flex flex-col gap-md" aria-labelledby={`${id}-heading`}>
      <div className="flex flex-col gap-xs">
        <h2 id={`${id}-heading`} className="font-sans text-headline-sm text-on-surface">
          {title}
        </h2>
        <p className="font-sans text-body-sm text-on-surface-variant">{description}</p>
      </div>

      <ul className="flex flex-col gap-sm">
        {nodes.map((node) => (
          <li
            key={node.id}
            className={`flex flex-col gap-xs rounded border p-md ${
              tone === 'warning'
                ? 'border-warning/40 bg-warning/10'
                : 'border-outline-variant bg-surface-container-low'
            }`}
          >
            <p className="font-sans text-body-md text-on-surface">{node.label}</p>
            {node.description === undefined ? null : (
              <p className="font-sans text-body-sm text-on-surface-variant">{node.description}</p>
            )}
            {/* Provenance beside the content, never in a tooltip. A reader who cannot tell an
                engine conclusion from a confirmed fact cannot judge the plan. */}
            <p className="font-mono text-data-mono-sm text-on-surface-variant">
              {PROVENANCE_LABEL[node.provenance.provenance] ?? node.provenance.provenance} ·{' '}
              {node.provenance.confidence.toLowerCase()} confidence
              {node.provenance.sourceRef === undefined ? '' : ` · ${node.provenance.sourceRef}`}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Stat({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <div>
      <dt className="font-sans text-label-caps tracking-wider text-on-surface-variant uppercase">
        {label}
      </dt>
      <dd className="mt-xs font-mono text-headline-sm text-on-surface">{value}</dd>
    </div>
  );
}
