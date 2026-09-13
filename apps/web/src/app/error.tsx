'use client';

import Link from 'next/link';
import { EmptyState } from '../components/ui/EmptyState.tsx';

/**
 * The error boundary for every route.
 *
 * Gap-spec §55: the interface maps a failure to a safe message, never to the error itself. The
 * framework hands a client boundary the thrown value, and in production it has already been reduced
 * to a generic message and a `digest` — the id the server logged it under. That digest is the only
 * part shown: it lets someone quote the failure to support without the page leaking what failed.
 *
 * No shared header here. It reads the session on the server, which a client boundary cannot, and a
 * page that has already failed once should not depend on the thing that may have failed.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-content flex-col gap-lg px-md py-xl">
      <h1 className="font-sans text-headline-lg text-on-surface">Something went wrong</h1>
      <EmptyState
        variant="error"
        title="This page could not be loaded"
        description="A change is only kept once the page says it was saved, so nothing half-done has been stored. Trying again usually works; if it keeps happening, quote the reference below."
        action={
          <div className="flex flex-col items-center gap-sm">
            <div className="flex flex-wrap justify-center gap-sm">
              <button
                type="button"
                onClick={reset}
                className="inline-flex min-h-11 items-center rounded bg-primary px-md font-sans text-body-sm text-on-primary"
              >
                Try again
              </button>
              <Link
                href="/portfolio"
                className="inline-flex min-h-11 items-center rounded border border-outline-variant px-md font-sans text-body-sm text-on-surface"
              >
                Your projects
              </Link>
            </div>
            {error.digest === undefined ? null : (
              <p className="font-mono text-data-mono-sm text-on-surface-variant">
                Reference: {error.digest}
              </p>
            )}
          </div>
        }
      />
    </main>
  );
}
