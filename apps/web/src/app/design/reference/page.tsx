import { notFound } from 'next/navigation';
import { AppShell } from '../../../components/shell/AppShell.tsx';
import { PROJECT_NAV } from '../../../components/shell/navigation.ts';
import { Button } from '../../../components/ui/Button.tsx';
import { StatTile } from '../../../components/ui/StatTile.tsx';
import { GateStateChip, HealthChip } from '../../../components/ui/StatusChip.tsx';
import { EmptyState } from '../../../components/ui/EmptyState.tsx';
import { APP_ENV } from '../../../lib/server/config.ts';

/**
 * Design-system reference: the application shell and the status vocabulary, rendered with sample data.
 *
 * This used to live at `/p/[projectId]` and call itself Project Home. It rendered for any id at all,
 * read nothing, and showed a made-up project ("GST Compliance Platform", £120k–£165k, seven risks,
 * twelve people) with a sidebar of links to routes that do not exist. Project Home is now a real
 * page; this is what the old one actually was — a place where the shell, the chips and the tiles are
 * exercised by a rendered route so the accessibility suite can check them composed, not in isolation.
 *
 * It says what it is at the top, and it does not exist in production.
 */
export const metadata = { title: 'Design system reference', robots: { index: false } };

export default function DesignReferencePage() {
  if (APP_ENV === 'production') notFound();
  const projectId = 'sample';

  return (
    <AppShell
      sections={PROJECT_NAV}
      contextId={projectId}
      pathname="/design/reference"
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
              Design system reference — sample data, not a project
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
            description="This page renders the shell and the status vocabulary with sample values. A real project's home is at /p/ followed by its id."
          />
        </section>
      </div>
    </AppShell>
  );
}
