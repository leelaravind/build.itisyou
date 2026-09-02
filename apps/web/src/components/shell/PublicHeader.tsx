import Link from 'next/link';
import { MaterialIcon } from '../ui/MaterialIcon.tsx';
import { currentUser } from '../../lib/server/auth.ts';
import { endSession } from '../../app/login/actions.ts';

/**
 * Public header, for logged-out surfaces.
 *
 * Distinct from `AppShell`'s header on purpose. The export shows the same six primary nav items on
 * the landing page, but every one of them targets a project route — and a visitor with no project
 * cannot go to Plan, Execute or Control. Rendering them would be six links to nowhere.
 *
 * So the public header keeps the product mark, the visual weight of the export's bar, and the one
 * action a visitor can actually take. Guest-first (plan §2.3) means the landing page's job is to get
 * someone into the intake flow, not to display navigation they cannot use.
 */
export async function PublicHeader() {
  const user = await currentUser();
  return (
    <header
      className="flex h-16 items-center gap-sm border-b border-outline-variant px-sm sm:gap-md sm:px-md lg:px-xl"
      aria-label="Global"
    >
      <Link
        href="/"
        className="flex min-h-11 shrink-0 items-center gap-sm font-sans text-headline-sm text-primary transition-colors hover:text-primary-fixed"
      >
        <MaterialIcon name="settings_suggest" size={26} />
        {/* The wordmark is hidden below `sm` so the header fits a 320px viewport without the nav
            overflowing (WCAG 1.4.10 Reflow). The icon keeps the link identifiable, and the
            accessible name is preserved for assistive technology. */}
        <span className="hidden sm:inline">build.itisyou</span>
        <span className="sr-only sm:hidden">build.itisyou</span>
      </Link>

      {/*
        Every link is at least 44px tall.
        WCAG 2.2 Success Criterion 2.5.8 requires a 24×24 minimum touch target; 44px is the platform
        convention and comfortably clears it. The first version used bare 12px text links, which axe
        flagged on mobile — a real defect, not a false positive: a 16px-tall link is genuinely hard
        to hit on a phone.
      */}
      <nav aria-label="Primary" className="ml-auto flex items-center gap-xs sm:gap-md">
        <Link
          href="/how-it-works"
          className="hidden min-h-11 items-center rounded px-sm font-sans text-label-caps tracking-wider text-on-surface-variant uppercase transition-colors hover:bg-surface-container hover:text-on-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:inline-flex"
        >
          How it works
        </Link>

        <Link
          href="/portfolio"
          className="hidden min-h-11 items-center rounded px-sm font-sans text-label-caps tracking-wider text-on-surface-variant uppercase transition-colors hover:bg-surface-container hover:text-on-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:inline-flex"
        >
          Portfolio
        </Link>

        {user === undefined ? (
          <Link
            href="/login"
            className="inline-flex min-h-11 items-center rounded px-sm font-sans text-label-caps tracking-wider text-on-surface-variant uppercase transition-colors hover:bg-surface-container hover:text-on-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Sign in
          </Link>
        ) : (
          /*
           * A form rather than a link, because signing out is a state change.
           *
           * A GET link would let any page anywhere sign a user out by embedding an image — and it
           * would let a browser or a link prefetcher do it by accident, which is the version that
           * happens without an attacker.
           */
          <form action={endSession}>
            <button
              type="submit"
              className="inline-flex min-h-11 items-center rounded px-sm font-sans text-label-caps tracking-wider text-on-surface-variant uppercase transition-colors hover:bg-surface-container hover:text-on-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              Sign out
            </button>
          </form>
        )}

        <Link
          href="/start"
          className="inline-flex min-h-11 shrink-0 items-center rounded bg-primary px-md font-sans text-body-sm font-medium text-on-primary transition-colors hover:bg-primary-fixed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          Start
        </Link>
      </nav>
    </header>
  );
}
