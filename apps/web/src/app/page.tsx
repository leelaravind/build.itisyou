import Link from 'next/link';
import { MaterialIcon } from '../components/ui/MaterialIcon.tsx';
import { PublicHeader } from '../components/shell/PublicHeader.tsx';

/**
 * Public landing — locked screen 1.
 *
 * Built against `stitch_project_blueprint_system/landing_page_govintel_platform/`: status pill,
 * display headline with a primary-coloured second clause, supporting paragraph, a primary and a
 * secondary call to action, a trust row, and the "architecture_map.sys" panel on the right.
 *
 * **Two copy changes from the export, both deliberate.**
 *
 * 1. The export's trust row reads "Trusted by 10,000+ engineering teams". That is a fabricated
 *    claim — this product has no users. The contract forbids presenting invention as fact
 *    throughout (plan §11.2, §12.3, gap-spec §69's rule against unearned compliance claims), and a
 *    platform whose entire pitch is deterministic honesty cannot open with a made-up number. The
 *    row now states what is actually true about the engine.
 * 2. The export's status pill reads "V2.4.0 Deployment". The version comes from `APP_VERSION` at
 *    build time, so the pill either shows the real deployed version or does not claim one.
 *
 * Recorded as KI-021. Layout, hierarchy and visual language are unchanged.
 */

export const metadata = {
  title: 'Turn a software idea into an executable engineering system',
};

const PIPELINE_STAGES = [
  { id: 'vision', label: 'Vision Input', icon: 'lightbulb', progress: 100, active: false },
  { id: 'core', label: 'GovIntel Core', icon: 'memory', progress: 55, active: true },
  { id: 'deploy', label: 'Deployment', icon: 'rocket_launch', progress: 20, active: false },
] as const;

export default function LandingPage() {
  const version = process.env.APP_VERSION;

  return (
    <div className="min-h-screen bg-background">
      <PublicHeader />

      <main id="main">
        <section className="mx-auto grid max-w-[1440px] items-center gap-3xl px-md py-3xl lg:grid-cols-2 lg:px-xl">
          <div className="flex flex-col gap-lg">
            <p className="inline-flex w-fit items-center gap-sm rounded border border-outline-variant bg-surface-container-low px-md py-xs">
              <span aria-hidden className="inline-block size-2 rounded-full bg-tertiary" />
              <span className="font-mono text-data-mono-sm text-on-surface-variant">
                {version === undefined ? 'System online' : `System online · ${version}`}
              </span>
            </p>

            <h1 className="font-sans text-display-lg text-on-surface">
              Turn your software idea into an{' '}
              <span className="text-primary">executable engineering system.</span>
            </h1>

            <p className="max-w-form font-sans text-body-lg text-on-surface-variant">
              The intelligence layer between your vision and production. A deterministic engine
              maps, validates and orchestrates the work — rules, quality gates and traceability, not
              generic AI chat. No account required to start.
            </p>

            <div className="flex flex-wrap gap-md">
              <Link
                href="/start"
                className="inline-flex items-center gap-sm rounded bg-primary px-lg py-md font-sans text-body-sm font-medium text-on-primary transition-colors hover:bg-primary-fixed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                Start a project
                <MaterialIcon name="arrow_forward" size={18} />
              </Link>

              <Link
                href="/how-it-works"
                className="inline-flex items-center gap-sm rounded border border-outline-variant px-lg py-md font-sans text-body-sm font-medium text-on-surface transition-colors hover:bg-surface-container-high focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                Explore how it works
                <MaterialIcon name="visibility" size={18} />
              </Link>
            </div>

            {/*
              The export's "Trusted by 10,000+ engineering teams" is replaced by a claim that is
              actually true and actually checkable. See the file header.
            */}
            <p className="flex items-center gap-sm font-mono text-data-mono-sm text-on-surface-variant">
              <MaterialIcon name="function" size={16} aria-hidden />
              Same inputs, same ruleset, same plan — every time, with the reasoning shown.
            </p>
          </div>

          <div
            className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md"
            aria-label="Illustration of the planning pipeline"
            role="img"
          >
            <div className="mb-md flex items-center justify-between">
              <span aria-hidden className="flex gap-xs">
                <span className="inline-block size-3 rounded-full bg-error" />
                <span className="inline-block size-3 rounded-full bg-tertiary" />
                <span className="inline-block size-3 rounded-full bg-primary" />
              </span>
              <span className="font-mono text-data-mono-sm text-on-surface-variant">
                architecture_map.sys
              </span>
            </div>

            <div className="grid grid-cols-3 gap-sm">
              {PIPELINE_STAGES.map((stage) => (
                <div
                  key={stage.id}
                  className={`flex flex-col items-center gap-sm rounded border p-md ${
                    stage.active
                      ? 'border-primary bg-surface-container-low'
                      : 'border-outline-variant bg-surface-container-low'
                  }`}
                >
                  <MaterialIcon
                    name={stage.icon}
                    size={24}
                    className={stage.active ? 'text-primary' : 'text-on-surface-variant'}
                  />
                  <span
                    className={`text-center font-sans text-data-mono-sm ${
                      stage.active ? 'text-primary' : 'text-on-surface'
                    }`}
                  >
                    {stage.label}
                  </span>
                  {/* Decorative: the accessible summary below carries the same information. */}
                  <span
                    aria-hidden
                    className="h-1 w-full overflow-hidden rounded-full bg-surface-container-high"
                  >
                    <span
                      className={`block h-full ${stage.active ? 'bg-primary' : 'bg-tertiary'}`}
                      style={{ width: `${String(stage.progress)}%` }}
                    />
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-md rounded border border-outline-variant bg-surface-container-low p-md">
              <pre className="overflow-x-auto font-mono text-data-mono-sm leading-relaxed text-on-surface-variant">
                {'> Initialising semantic analysis... DONE\n'}
                {'> Mapping data model... DONE\n'}
                <span className="text-on-surface">{'> Generating deployment plan...'}</span>
              </pre>
            </div>

            <span className="sr-only">
              A three-stage pipeline: vision input, complete; the deterministic core, in progress;
              deployment, not started.
            </span>
          </div>
        </section>
      </main>
    </div>
  );
}
