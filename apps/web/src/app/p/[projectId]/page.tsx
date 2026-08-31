import { AppShell } from '../../../components/shell/AppShell.tsx';
import { PROJECT_NAV } from '../../../components/shell/navigation.ts';
import { Button } from '../../../components/ui/Button.tsx';
import { StatTile } from '../../../components/ui/StatTile.tsx';
import { GateStateChip, HealthChip } from '../../../components/ui/StatusChip.tsx';
import { EmptyState } from '../../../components/ui/EmptyState.tsx';

/**
 * Project Home - locked screen 12.
 *
 * Phase 2 skeleton. It exists now so the app shell, the token layer and the status vocabulary are
 * exercised by a real route rather than only by unit tests - which is what lets the axe
 * accessibility suite run against the actual rendered shell for the Phase-2 gate.
 *
 * The Next Action engine (gap-spec section 24), the exception-first surface (section 25) and real
 * project data arrive in Phase 8. Everything below renders from literals, and says so.
 */
export default async function ProjectHomePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  return (
    <AppShell
      sections={PROJECT_NAV}
      contextId={projectId}
      pathname={`/p/${projectId}`}
      contextTitle="GST Compliance Platform"
      contextSubtitle="Enterprise web application"
      primaryAction={
        <Button variant="primary" icon="add" className="w-full">
          New task
        </Button>
      }
    >
      <div className="flex flex-col gap-lg">
        <div className="flex items-center justify-between gap-md">
          <div>
            <p className="font-sans text-label-caps tracking-wider text-on-surface-variant uppercase">
              Project home
            </p>
            <h1 className="mt-xs font-sans text-headline-lg text-on-surface">Overview</h1>
          </div>
          <HealthChip state="WATCH" />
        </div>

        <div className="grid grid-cols-1 gap-md sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Budget" range={{ low: '£120k', high: '£165k' }} provenance="estimated" />
          <StatTile label="Open risks" value="7" provenance="measured" icon="warning" />
          <StatTile label="Team" value="12" unit="people" provenance="measured" icon="group" />
          <StatTile label="Milestones" value="—" provenance="unknown" icon="flag" />
        </div>

        <section className="flex flex-col gap-md" aria-labelledby="gates-heading">
          <h2 id="gates-heading" className="font-sans text-headline-sm text-on-surface">
            Quality gates
          </h2>
          <div className="flex flex-wrap gap-sm">
            <GateStateChip state="PASS" />
            <GateStateChip state="READY" />
            <GateStateChip state="BLOCKED" />
            <GateStateChip state="EXCEPTION" />
            <GateStateChip state="NOT_READY" />
            <GateStateChip state="FAIL" />
          </div>
        </section>

        <section className="flex flex-col gap-md" aria-labelledby="next-heading">
          <h2 id="next-heading" className="font-sans text-headline-sm text-on-surface">
            Next action
          </h2>
          <EmptyState
            title="No project loaded"
            description="The Next Action engine is implemented in Phase 8. This route currently renders the shell and the design system only."
          />
        </section>
      </div>
    </AppShell>
  );
}
