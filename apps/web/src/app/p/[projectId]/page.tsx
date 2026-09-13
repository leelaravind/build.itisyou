import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, desc, eq } from 'drizzle-orm';
import { auditEvents, changeRequests } from '@govintel/db/schema';
import { graphFromRows } from '@govintel/twin/repository';
import { evaluateGates } from '@govintel/rules/gates';
import { PublicHeader } from '../../../components/shell/PublicHeader.tsx';
import { EmptyState } from '../../../components/ui/EmptyState.tsx';
import { MaterialIcon } from '../../../components/ui/MaterialIcon.tsx';
import { withDatabase } from '../../../lib/server/database.ts';
import { evaluateForProject, loadIntake } from '../../../lib/server/project-rules.ts';
import { loadPlanRows } from '../../plan/[projectId]/actions.ts';
import { availableTransitions } from '../../plan/[projectId]/lifecycle-actions.ts';

/**
 * Project Home — locked screen 12.
 *
 * Answers the five questions the completion contract (§7) puts to it, each from the project's own
 * state and nothing else:
 *
 * - **Where are we** — the lifecycle state and version the database holds.
 * - **What is next** — the transitions the lifecycle declares from here, with the engine's verdict.
 * - **What is blocked** — the gates that have not passed, from the same evaluation the transition
 *   itself runs, with evidence and approvals projected in.
 * - **What changed** — the project's audit trail, newest first.
 * - **What needs attention** — change requests waiting on a decision, and a plan that does not exist.
 *
 * Exception-first (plan §2.4): blocked and waiting items come before anything that is fine. No figure
 * on this page is invented; where the engine cannot say, the page says it cannot.
 *
 * This route used to render a fabricated project for any id, with no access check. It now 404s
 * for a project the caller cannot open, exactly like every other project surface.
 */
export const metadata = { title: 'Project home' };

const RECENT_CHANGES = 8;

const SECTIONS = [
  { href: 'plan', label: 'Plan and lifecycle', icon: 'account_tree' },
  { href: 'plan/work', label: 'Work and today', icon: 'checklist' },
  { href: 'plan/rules', label: 'What the rules require', icon: 'rule' },
  { href: 'plan/evidence', label: 'Evidence and approvals', icon: 'verified' },
  { href: 'plan/trace', label: 'Traceability', icon: 'polyline' },
  { href: 'plan/budget', label: 'Budget and capacity', icon: 'payments' },
  { href: 'plan/change', label: 'Changes', icon: 'compare_arrows' },
  { href: 'plan/baseline', label: 'Baseline', icon: 'flag' },
  { href: 'plan/release', label: 'Release readiness', icon: 'rocket_launch' },
  { href: 'plan/close', label: 'Closure', icon: 'task_alt' },
] as const;

function humanise(value: string): string {
  const text = value.toLowerCase().replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export default async function ProjectHomePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  const loaded = await loadPlanRows(projectId);
  if (loaded === null) notFound();

  const { project, nodes, edges } = loaded;
  const graph = graphFromRows(projectId, nodes, edges);
  const planned = graph.size > 0;

  const [lifecycle, intake, recent, pending] = await Promise.all([
    availableTransitions(projectId),
    loadIntake(projectId),
    withDatabase((db) =>
      db
        .select({
          id: auditEvents.id,
          action: auditEvents.action,
          occurredAt: auditEvents.occurredAt,
        })
        .from(auditEvents)
        .where(eq(auditEvents.projectId, projectId))
        .orderBy(desc(auditEvents.occurredAt))
        .limit(RECENT_CHANGES),
    ),
    withDatabase((db) =>
      db
        .select({ id: changeRequests.id })
        .from(changeRequests)
        .where(
          and(
            eq(changeRequests.projectId, projectId),
            eq(changeRequests.state, 'PENDING_APPROVAL'),
          ),
        ),
    ),
  ]);

  const { emittedGates } = evaluateForProject({
    projectId,
    projectType: project.projectType,
    lifecycleState: project.lifecycleState,
    intake,
    graph,
  });

  const gates = planned ? evaluateGates(graph, emittedGates) : [];
  const blocked = gates.filter((gate) => gate.result !== 'PASSED');
  const options = lifecycle?.options ?? [];
  const next = options.find((option) => option.verdict.allowed) ?? options[0];

  return (
    <div className="min-h-screen bg-background">
      <PublicHeader />

      <main id="main" className="mx-auto flex max-w-content flex-col gap-lg px-md py-xl">
        <header className="flex flex-col gap-xs">
          <p className="font-sans text-label-caps tracking-wider text-on-surface-variant uppercase">
            Project home
          </p>
          <h1 className="font-sans text-headline-lg text-on-surface">{project.name}</h1>
        </header>

        <section
          aria-labelledby="where-heading"
          className="flex flex-col gap-sm rounded-lg border border-outline-variant bg-surface-container-low p-lg"
        >
          <h2 id="where-heading" className="font-sans text-headline-sm text-on-surface">
            Where the project is
          </h2>
          <p className="font-sans text-body-md text-on-surface">
            {humanise(project.lifecycleState)}
            <span className="font-mono text-data-mono-sm text-on-surface-variant">
              {' '}
              · version {project.version} · updated {project.updatedAt.toISOString().slice(0, 10)}
            </span>
          </p>
        </section>

        <section aria-labelledby="attention-heading" className="flex flex-col gap-sm">
          <h2 id="attention-heading" className="font-sans text-headline-sm text-on-surface">
            Needs attention
          </h2>
          {!planned || pending.length > 0 || blocked.length > 0 ? (
            <ul className="flex flex-col gap-sm">
              {planned ? null : (
                <li className="flex items-start gap-sm rounded border border-outline-variant bg-surface-container-low p-md">
                  <MaterialIcon name="warning" size={20} className="mt-0.5 shrink-0 text-warning" />
                  <p className="font-sans text-body-sm text-on-surface">
                    There is no plan yet, so no gate can be assessed.{' '}
                    <Link href={`/plan/${projectId}`} className="text-primary underline">
                      Build the plan
                    </Link>
                  </p>
                </li>
              )}
              {pending.length === 0 ? null : (
                <li className="flex items-start gap-sm rounded border border-outline-variant bg-surface-container-low p-md">
                  <MaterialIcon name="pending" size={20} className="mt-0.5 shrink-0" />
                  <p className="font-sans text-body-sm text-on-surface">
                    {pending.length === 1
                      ? 'One change request is waiting for a decision.'
                      : `${String(pending.length)} change requests are waiting for a decision.`}{' '}
                    <Link href={`/plan/${projectId}/change`} className="text-primary underline">
                      Review changes
                    </Link>
                  </p>
                </li>
              )}
              {blocked.length === 0 ? null : (
                <li className="flex items-start gap-sm rounded border border-outline-variant bg-surface-container-low p-md">
                  <MaterialIcon name="block" size={20} className="mt-0.5 shrink-0 text-danger" />
                  <p className="font-sans text-body-sm text-on-surface">
                    {blocked.length === 1
                      ? 'One quality gate has not passed.'
                      : `${String(blocked.length)} quality gates have not passed.`}{' '}
                    <Link href={`/plan/${projectId}/evidence`} className="text-primary underline">
                      See what they need
                    </Link>
                  </p>
                </li>
              )}
            </ul>
          ) : (
            <EmptyState
              compact
              title="Nothing is waiting on you"
              description="Every gate that applies has passed and no change is waiting for a decision."
            />
          )}
        </section>

        <section aria-labelledby="next-heading" className="flex flex-col gap-sm">
          <h2 id="next-heading" className="font-sans text-headline-sm text-on-surface">
            What is next
          </h2>
          {next === undefined ? (
            <EmptyState
              compact
              title="This is the end of the lifecycle"
              description="No further lifecycle step is declared from here."
            />
          ) : (
            <div className="flex flex-col gap-xs rounded border border-outline-variant bg-surface-container-low p-md">
              <p className="font-sans text-body-md text-on-surface">
                Move to {humanise(next.to)}
                <span className="font-mono text-data-mono-sm text-on-surface-variant">
                  {' '}
                  · {next.verdict.allowed ? 'ready' : 'not yet'}
                </span>
              </p>
              <p className="font-sans text-body-sm text-on-surface-variant">
                {next.verdict.allowed ? next.why : next.verdict.explanation}
              </p>
              <Link
                href={`/plan/${projectId}`}
                className="font-sans text-body-sm text-primary underline"
              >
                Open the lifecycle
              </Link>
            </div>
          )}
        </section>

        <section aria-labelledby="blocked-heading" className="flex flex-col gap-sm">
          <h2 id="blocked-heading" className="font-sans text-headline-sm text-on-surface">
            What is blocking it
          </h2>
          {!planned ? (
            <p className="font-sans text-body-sm text-on-surface-variant">
              Not assessed: the gates are evaluated against the plan, and there is none yet.
            </p>
          ) : blocked.length === 0 ? (
            <EmptyState compact title="Every gate has passed" />
          ) : (
            <ul className="flex flex-col gap-sm">
              {blocked.map((gate) => (
                <li
                  key={gate.key}
                  className="flex flex-col gap-xs rounded border border-outline-variant bg-surface-container-low p-md"
                >
                  <p className="font-sans text-body-md text-on-surface">
                    {gate.title}
                    <span className="font-mono text-data-mono-sm text-on-surface-variant">
                      {' '}
                      · {gate.result === 'FAILED' ? 'not passed' : 'cannot tell yet'}
                    </span>
                  </p>
                  <p className="font-sans text-body-sm text-on-surface-variant">
                    {gate.explanation}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="changed-heading" className="flex flex-col gap-sm">
          <h2 id="changed-heading" className="font-sans text-headline-sm text-on-surface">
            What changed recently
          </h2>
          {recent.length === 0 ? (
            <EmptyState
              compact
              title="No recorded changes yet"
              description="Lifecycle moves, evidence, approvals, imports and change requests appear here as they happen."
            />
          ) : (
            <ol className="flex flex-col gap-xs">
              {recent.map((event) => (
                <li
                  key={event.id}
                  className="flex flex-wrap justify-between gap-sm border-b border-outline-variant py-xs"
                >
                  <span className="font-sans text-body-sm text-on-surface">
                    {humanise(event.action)}
                  </span>
                  <span className="font-mono text-data-mono-sm text-on-surface-variant">
                    {event.occurredAt.toISOString().replace('T', ' ').slice(0, 16)} UTC
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <nav aria-label="Project sections" className="flex flex-col gap-sm">
          <h2 className="font-sans text-headline-sm text-on-surface">Everything in this project</h2>
          <ul className="grid grid-cols-1 gap-sm sm:grid-cols-2">
            {SECTIONS.map((section) => (
              <li key={section.href}>
                <Link
                  href={`/${section.href.replace(/^plan/, `plan/${projectId}`)}`}
                  className="flex min-h-11 items-center gap-sm rounded border border-outline-variant bg-surface-container-low px-md py-sm font-sans text-body-sm text-on-surface hover:bg-surface-container"
                >
                  <MaterialIcon name={section.icon} size={18} className="shrink-0" />
                  {section.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </main>
    </div>
  );
}
