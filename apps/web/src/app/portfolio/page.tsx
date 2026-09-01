import Link from 'next/link';
import { INTEGRATIONS, STATE_MEANING, offersConnect } from '@govintel/organization/integrations';
import { PublicHeader } from '../../components/shell/PublicHeader.tsx';
import { MaterialIcon } from '../../components/ui/MaterialIcon.tsx';

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

export default function PortfolioPage() {
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

        <section
          className="flex flex-col gap-md rounded-lg border border-outline-variant bg-surface-container-low p-lg"
          role="status"
        >
          <h2 className="font-sans text-headline-sm text-on-surface">
            Nothing to roll up as a guest
          </h2>
          <p className="font-sans text-body-sm text-on-surface-variant">
            You have one project, and it is only visible to this browser session. A portfolio needs
            an organisation, and organisations need accounts.
          </p>
          <p className="font-sans text-body-sm text-on-surface-variant">
            This is not the same as an organisation with nothing in it — the two look identical on a
            screen and mean opposite things, so the page says which one you are looking at.
          </p>
        </section>

        <section className="flex flex-col gap-md" aria-labelledby="what-heading">
          <h2 id="what-heading" className="font-sans text-headline-sm text-on-surface">
            What a portfolio would show
          </h2>

          <ul className="flex flex-col gap-sm">
            {[
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
            ].map((item) => (
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
