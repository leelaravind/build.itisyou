'use client';

import './globals.css';

/**
 * The last boundary: a failure in the root layout itself.
 *
 * It replaces the layout, so it brings its own `<html>` and `<body>` and depends on nothing else in
 * the product — not the header, not the design-system components — because any of them might be what
 * failed. Plain, and enough to get somebody back to a working page.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="bg-background">
        <main
          id="main"
          className="mx-auto flex min-h-screen max-w-content flex-col gap-md px-md py-xl"
        >
          <h1 className="font-sans text-headline-lg text-on-surface">
            build.itisyou is unavailable
          </h1>
          <p role="alert" className="font-sans text-body-md text-on-surface-variant">
            The application failed to start this page. Nothing has been changed by it.
          </p>
          <div className="flex flex-wrap gap-sm">
            <button
              type="button"
              onClick={reset}
              className="inline-flex min-h-11 items-center rounded bg-primary px-md font-sans text-body-sm text-on-primary"
            >
              Try again
            </button>
            {/* A plain anchor, not the router's link: the router may be what failed. */}
            <a
              href="/"
              className="inline-flex min-h-11 items-center rounded border border-outline-variant px-md font-sans text-body-sm text-on-surface"
            >
              Home
            </a>
          </div>
          {error.digest === undefined ? null : (
            <p className="font-mono text-data-mono-sm text-on-surface-variant">
              Reference: {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
