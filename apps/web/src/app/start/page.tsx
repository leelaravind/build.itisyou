import { redirect } from 'next/navigation';
import { PublicHeader } from '../../components/shell/PublicHeader.tsx';
import { MaterialIcon } from '../../components/ui/MaterialIcon.tsx';
import { startProject } from './actions.ts';

/**
 * Start a new project — locked screen 2.
 *
 * The first screen where guest-first (plan §2.3) becomes real: a visitor types an idea and gets a
 * working project, with no account and no interruption.
 *
 * The form asks one question. The export shows a fuller form, and the intake wizard does collect all
 * of it — but asking for a project type, a budget and a team size before the visitor has typed a
 * single word is how a trial flow loses people. Everything beyond the idea has either a recommended
 * default, an "I don't know", or a place later in the wizard, so none of it needs to be here.
 *
 * A guest session is created by the action, not by viewing this page: issuing a cookie to everyone
 * who merely looks at the page would be tracking, which gap-spec §19 rules out.
 */

export const metadata = { title: 'Start a project' };

export default function StartProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  return (
    <div className="min-h-screen bg-background">
      <PublicHeader />

      <main id="main" className="mx-auto flex max-w-prose flex-col gap-lg px-md py-3xl">
        <div>
          <p className="font-sans text-label-caps tracking-wider text-primary uppercase">
            Step 1 of 3
          </p>
          <h1 className="mt-sm font-sans text-headline-lg text-on-surface">
            What are you building?
          </h1>
          <p className="mt-sm font-sans text-body-md text-on-surface-variant">
            A sentence is enough to begin. You will be asked for the rest as you go, and you can
            answer <span className="text-on-surface">“I don’t know”</span> to anything — the engine
            treats that as an answer, not a gap.
          </p>
        </div>

        <StartForm searchParams={searchParams} />

        <div className="flex flex-col gap-sm rounded-lg border border-outline-variant bg-surface-container-low p-lg">
          <p className="font-sans text-label-caps tracking-wider text-on-surface-variant uppercase">
            What happens next
          </p>
          <ol className="flex flex-col gap-sm font-sans text-body-sm text-on-surface-variant">
            <li className="flex gap-sm">
              <span className="font-mono text-data-mono-sm text-primary">01</span>
              You answer what you know and flag what you don’t.
            </li>
            <li className="flex gap-sm">
              <span className="font-mono text-data-mono-sm text-primary">02</span>
              The platform writes a research request you can paste into any AI you already use.
            </li>
            <li className="flex gap-sm">
              <span className="font-mono text-data-mono-sm text-primary">03</span>
              You paste the reply back. It is validated before anything is created — nothing is
              taken on trust.
            </li>
          </ol>
          <p className="mt-sm flex items-center gap-sm font-mono text-data-mono-sm text-on-surface-variant">
            <MaterialIcon name="lock" size={14} aria-hidden />
            No account needed until you want to save.
          </p>
        </div>
      </main>
    </div>
  );
}

async function StartForm({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;

  return (
    <form action={startProject} className="flex flex-col gap-md">
      <label htmlFor="idea" className="font-sans text-body-sm text-on-surface">
        Describe your project
      </label>

      <textarea
        id="idea"
        name="idea"
        required
        rows={5}
        maxLength={2000}
        aria-describedby={error === undefined ? 'idea-hint' : 'idea-error'}
        placeholder="A compliance reporting platform for UK accountancy firms, replacing a spreadsheet process…"
        className="w-full rounded border border-outline-variant bg-surface-container-low p-md font-sans text-body-md text-on-surface placeholder:text-on-surface-variant/60 focus:border-primary focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      />

      {error === undefined ? (
        <p id="idea-hint" className="font-sans text-body-sm text-on-surface-variant">
          Plain language is fine. You are not writing a specification — that is what this builds.
        </p>
      ) : (
        // `role="alert"` so the failure is announced. A validation message that only appears
        // visually leaves a screen-reader user with a form that silently did nothing.
        <p
          id="idea-error"
          role="alert"
          className="flex items-center gap-sm font-sans text-body-sm text-danger"
        >
          <MaterialIcon name="error" size={16} aria-hidden />
          {error === 'empty'
            ? 'Please describe your project before continuing.'
            : 'Something went wrong starting your project. Please try again.'}
        </p>
      )}

      <button
        type="submit"
        className="inline-flex w-fit items-center gap-sm rounded bg-primary px-lg py-md font-sans text-body-sm font-medium text-on-primary transition-colors hover:bg-primary-fixed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        Continue
        <MaterialIcon name="arrow_forward" size={18} />
      </button>
    </form>
  );
}

export { redirect };
