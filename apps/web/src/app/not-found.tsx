import Link from 'next/link';
import { PublicHeader } from '../components/shell/PublicHeader.tsx';
import { EmptyState } from '../components/ui/EmptyState.tsx';

/**
 * Not found — and deliberately also "not yours".
 *
 * Every project route answers a project it will not show you with the same 404 as one that does not
 * exist (plan §32.12): a 403 confirms the id is real, which is a disclosure in itself. So this page
 * cannot say which of the two happened, and says that it cannot rather than guessing.
 *
 * It replaces the framework's stock page, which rendered outside the design system with no way back
 * into the product.
 */
export const metadata = { title: 'Not found' };

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background">
      <PublicHeader />
      <main id="main" className="mx-auto flex max-w-content flex-col gap-lg px-md py-xl">
        <h1 className="font-sans text-headline-lg text-on-surface">Nothing to show here</h1>
        <EmptyState
          variant="no-matches"
          title="This page does not exist, or it is not one you can open"
          description="Projects you cannot open look exactly like projects that do not exist, on purpose: telling them apart would confirm to anyone guessing ids that a project is real."
          action={
            <div className="flex flex-wrap justify-center gap-sm">
              <Link
                href="/portfolio"
                className="inline-flex min-h-11 items-center rounded bg-primary px-md font-sans text-body-sm text-on-primary"
              >
                Your projects
              </Link>
              <Link
                href="/start"
                className="inline-flex min-h-11 items-center rounded border border-outline-variant px-md font-sans text-body-sm text-on-surface"
              >
                Start a project
              </Link>
            </div>
          }
        />
      </main>
    </div>
  );
}
