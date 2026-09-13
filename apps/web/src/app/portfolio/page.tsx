import Link from 'next/link';
import { desc } from 'drizzle-orm';
import { projects } from '@govintel/db/schema';
import { INTEGRATIONS, STATE_MEANING, offersConnect } from '@govintel/organization/integrations';
import { PublicHeader } from '../../components/shell/PublicHeader.tsx';
import { MaterialIcon } from '../../components/ui/MaterialIcon.tsx';
import { EmptyState } from '../../components/ui/EmptyState.tsx';
import { withDatabase } from '../../lib/server/database.ts';
import { currentUser } from '../../lib/server/auth.ts';

/** Enough to find a project by; the portfolio is a way in, not a report. */
const PROJECT_LIMIT = 100;

/**
 * The portfolio, and the integrations boundary.
 *
 * Guests have one project, so the portfolio has nothing to roll up for them. Rather than hide the
 * page or show an empty table, it says what a portfolio would do and why it is empty here — which is
 * the same honesty rule every other surface follows: an empty view and a view of nothing must not
 * render alike.
 *
 * The integrations section is the part that ships with real content, and its whole job is to obey
 * §44's "do not fake functionality". Every integration is `PLANNED`, none offers a connect action,
 * and each says what it still would not do once built.
 */

export const metadata = { title: 'Portfolio' };

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{ guest?: string }>;
}) {
  const [{ guest }, user] = await Promise.all([searchParams, currentUser()]);

  /*
   * The caller's projects, and only theirs: `withDatabase` scopes to the caller's tenant — the
   * account's organisation when signed in, the guest session's own organisation otherwise — so
   * row-level security is what limits this list, not a WHERE clause.
   *
   * This page is where a sign-in lands. It used to list nothing and tell every visitor, signed in or
   * not, that there was "nothing to roll up as a guest" — so the first thing an account holder saw
   * after signing in was a page that could not show them their own work.
   */
  const rows = await withDatabase((db) =>
    db
      .select({
        id: projects.id,
        name: projects.name,
        lifecycleState: projects.lifecycleState,
        updatedAt: projects.updatedAt,
      })
      .from(projects)
      .orderBy(desc(projects.updatedAt))
      .limit(PROJECT_LIMIT),
  );

  return (
    <div className="min-h-screen bg-background">
      <PublicHeader />

      <main id="main" className="mx-auto flex max-w-content flex-col gap-lg px-md py-xl">
        <header className="flex flex-col gap-sm">
          <p className="font-sans text-label-caps tracking-wider text-on-surface-variant uppercase">
            Portfolio
          </p>
          <h1 className="font-sans text-headline-lg text-on-surface">Across your projects</h1>
          <p className="font-sans text-body-md text-on-surface-variant">
            A portfolio names the project that needs attention rather than averaging health across
            them. One healthy project and one on fire is not a moderately healthy portfolio.
          </p>
        </header>

        {guest === 'kept' ? (
          <section
            role="status"
            className="flex flex-col gap-xs rounded-lg border border-outline-variant bg-surface-container-low p-lg"
          >
            <h2 className="font-sans text-headline-sm text-on-surface">
              Your guest project was not moved into this account
            </h2>
            <p className="font-sans text-body-sm text-on-surface-variant">
              You already had an account, and work started as a guest is not merged into an existing
              one yet. Nothing was deleted: it is still reachable in this browser as a guest until
              the guest session expires. Sign out to go back to it.
            </p>
          </section>
        ) : null}

        <section className="flex flex-col gap-md" aria-labelledby="projects-heading">
          <div className="flex flex-col gap-xs">
            <h2 id="projects-heading" className="font-sans text-headline-sm text-on-surface">
              {user === undefined ? 'Your guest project' : 'Your projects'}
            </h2>
            <p className="font-sans text-body-sm text-on-surface-variant">
              {user === undefined
                ? 'Only this browser can see it, and only until the guest session expires. Signing in keeps it.'
                : 'Every project in your organisation that you can open, most recently changed first.'}
            </p>
          </div>

          {rows.length === 0 ? (
            <EmptyState
              title={user === undefined ? 'No project yet' : 'No projects in this organisation yet'}
              description={
                user === undefined
                  ? 'Start one and it will appear here for as long as this guest session lasts.'
                  : 'An organisation with nothing in it — not a view that failed to load.'
              }
              action={
                <Link
                  href="/start"
                  className="inline-flex min-h-11 items-center rounded bg-primary px-md font-sans text-body-sm text-on-primary"
                >
                  Start a project
                </Link>
              }
            />
          ) : (
            <ul className="flex flex-col gap-sm">
              {rows.map((row) => (
                <li key={row.id}>
                  <Link
                    href={`/plan/${row.id}`}
                    className="flex min-h-11 flex-wrap items-center justify-between gap-sm rounded border border-outline-variant bg-surface-container-low p-md hover:bg-surface-container"
                  >
                    <span className="font-sans text-body-md text-on-surface">{row.name}</span>
                    <span className="font-mono text-data-mono-sm text-on-surface-variant">
                      {row.lifecycleState.toLowerCase().replace(/_/g, ' ')} · updated{' '}
                      {row.updatedAt.toISOString().slice(0, 10)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-md" aria-labelledby="what-heading">
          <h2 id="what-heading" className="font-sans text-headline-sm text-on-surface">
            What a portfolio would show
          </h2>

          <ul className="flex flex-col gap-sm">
            {(
              [
                {
                  icon: 'priority_high',
                  title: 'The project that needs attention, named',
                  body: 'Ordered by how much attention each needs rather than alphabetically, because nobody has time to open eleven projects. Archived ones go last regardless of how badly they ended.',
                },
                {
                  icon: 'group',
                  title: 'Who is committed to more than one project',
                  body: 'The one calculation that is invisible from inside a single project: each one sees a person at 60% and believes it has 60% of them.',
                },
                {
                  icon: 'lock',
                  title: 'Only the projects you can open',
                  body: 'A total that includes a project you cannot open tells you it exists. The page says your view is partial without saying how much is missing, because a count is the thing the permission was withholding.',
                },
                // `as const` so the icon names keep their literal types and are checked against the
                // icons that exist, rather than widening to `string` and skipping the check.
              ] as const
            ).map((item) => (
              <li
                key={item.title}
                className="flex items-start gap-md rounded border border-outline-variant bg-surface-container-low p-md"
              >
                <MaterialIcon name={item.icon} size={20} className="mt-0.5 shrink-0" />
                <div className="flex flex-col gap-xs">
                  <p className="font-sans text-body-md text-on-surface">{item.title}</p>
                  <p className="font-sans text-body-sm text-on-surface-variant">{item.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-md" aria-labelledby="integrations-heading">
          <div className="flex flex-col gap-xs">
            <h2 id="integrations-heading" className="font-sans text-headline-sm text-on-surface">
              Integrations
            </h2>
            <p className="font-sans text-body-sm text-on-surface-variant">
              None of these is built. They are listed so you know what is coming and can stop
              looking for it — and none of them offers a button that would do nothing.
            </p>
          </div>

          <ul className="flex flex-col gap-sm">
            {INTEGRATIONS.map((integration) => (
              <li
                key={integration.key}
                className="flex flex-col gap-xs rounded border border-outline-variant bg-surface-container-low p-md"
              >
                <p className="flex flex-wrap items-center gap-sm font-sans text-body-md text-on-surface">
                  <MaterialIcon name="extension" size={16} />
                  {integration.name}
                  {/* The state word, always. A badge that relied on colour would leave a reader
                      unable to tell planned from connected — which is the whole point of §44. */}
                  <span className="font-mono text-data-mono-sm text-on-surface-variant">
                    {integration.state.toLowerCase().replace(/_/g, ' ')}
                  </span>
                </p>

                <p className="font-sans text-body-sm text-on-surface-variant">
                  {STATE_MEANING[integration.state]}
                </p>

                <p className="font-sans text-body-sm text-on-surface-variant">
                  {integration.whatItWouldDo}
                </p>

                {/* What it still would not do. Every integration is oversold by omission, and this
                    is the cheapest correction. */}
                <p className="flex items-start gap-sm font-sans text-body-sm text-on-surface-variant">
                  <MaterialIcon name="info" size={16} className="mt-0.5 shrink-0" />
                  {integration.whatItStillCannotDo}
                </p>

                {offersConnect(integration.state) ? (
                  <button
                    type="button"
                    className="mt-sm inline-flex min-h-11 w-fit items-center gap-sm rounded border border-outline-variant px-lg font-sans text-body-sm text-on-surface"
                  >
                    Connect
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        <Link
          href="/"
          className="inline-flex w-fit items-center gap-sm font-sans text-body-sm text-on-surface-variant transition-colors hover:text-on-surface"
        >
          <MaterialIcon name="arrow_back" size={16} />
          Back
        </Link>
      </main>
    </div>
  );
}
