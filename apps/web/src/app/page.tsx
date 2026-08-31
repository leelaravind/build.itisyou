/**
 * Public landing - locked screen 1.
 *
 * Phase 1 placeholder. The full landing is built in Phase 4 against
 * `stitch_project_blueprint_system/landing_page_govintel_platform/`, once the design system and
 * app shell exist (Phase 2). It is deliberately minimal rather than a rough approximation of the
 * export: an approximate landing would have to be thrown away, and would muddy the visual-regression
 * baseline in the meantime.
 *
 * What it does prove today is that the token layer resolves and the build pipeline is real.
 */
export default function LandingPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-lg px-md py-3xl">
      <p className="font-sans text-label-caps uppercase text-primary">Foundation</p>

      <h1 className="font-sans text-display-lg text-on-surface">GovIntel Platform</h1>

      <p className="max-w-xl font-sans text-body-lg text-on-surface-variant">
        Software project intelligence, planning, execution and governance. The engine is
        deterministic: same inputs, same ruleset, same answer — and it can always tell you why.
      </p>

      <div className="rounded-lg border border-subtle bg-surface-container-low p-lg">
        <p className="font-sans text-label-caps uppercase text-on-surface-variant">Build status</p>
        <p className="mt-sm font-mono text-data-mono text-tertiary">
          Phase 1 — foundation pipeline
        </p>
        <p className="mt-xs font-mono text-data-mono-sm text-on-surface-variant">
          Screens are implemented from Phase 2 onward, against the Stitch exports.
        </p>
      </div>
    </main>
  );
}
