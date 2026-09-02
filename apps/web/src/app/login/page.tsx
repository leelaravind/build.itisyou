import Link from 'next/link';
import { PublicHeader } from '../../components/shell/PublicHeader.tsx';
import { MaterialIcon } from '../../components/ui/MaterialIcon.tsx';
import { oidcConfig } from '../../lib/server/oidc.ts';
import { currentUser } from '../../lib/server/auth.ts';
import { beginSignIn } from './actions.ts';

export const metadata = { title: 'Sign in' };

/**
 * Sign in — locked screen 51 (DERIVED from `save_project`).
 *
 * Contract: gap-spec §6.1 (provider-neutral OIDC), §6.2 (at least one production login method).
 *
 * The page has two honest shapes and picks between them from configuration, never from a guess:
 *
 * - **A provider is configured.** A sign-in button, which starts a real OIDC authorization request
 *   with PKCE, `state` and `nonce`.
 * - **No provider is configured.** It says so. Guest-first (plan §2.3) means nobody is blocked by
 *   that — the whole journey runs without an account — so an unconfigured deployment is a working
 *   deployment rather than a broken one.
 *
 * What it never shows is a form that discards what you type. A dead login form is worse than an
 * honest placeholder, because it invites somebody to enter a password.
 */

const ERRORS: Record<string, string> = {
  unavailable: 'Sign-in is not available on this deployment.',
  provider: 'Your identity provider reported a problem. Nothing was changed.',
  locked: 'That account is locked. Contact whoever administers it.',
  'rate-limited': 'Too many sign-in attempts just now. Try again in a moment.',
  failed: 'That sign-in could not be completed. Please try again.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const configured = oidcConfig() !== undefined;
  const user = await currentUser();

  return (
    <div className="min-h-screen bg-background">
      <PublicHeader />

      <main id="main" className="mx-auto flex max-w-narrow flex-col gap-lg px-md py-3xl">
        <h1 className="font-sans text-headline-lg text-on-surface">Sign in</h1>

        {error === undefined ? null : (
          <p
            role="alert"
            className="flex items-center gap-sm rounded border border-danger/40 bg-danger/10 p-md font-sans text-body-sm text-on-surface"
          >
            <MaterialIcon name="error" size={18} className="text-danger" />
            {ERRORS[error] ?? ERRORS.failed}
          </p>
        )}

        {user === undefined ? null : (
          <p
            role="status"
            className="flex items-center gap-sm rounded border border-success/40 bg-success/10 p-md font-sans text-body-sm text-on-surface"
          >
            <MaterialIcon name="check_circle" size={18} className="text-success" />
            You are already signed in{user.email === null ? '' : ` as ${user.email}`}.
          </p>
        )}

        {configured ? (
          <div className="flex flex-col gap-md rounded-lg border border-outline-variant bg-surface-container-low p-lg">
            <p className="font-sans text-body-md text-on-surface">
              Signing in keeps your projects after this browser session ends, and lets you work with
              other people on them.
            </p>
            <p className="font-sans text-body-sm text-on-surface-variant">
              Anything you have already started as a guest moves to your account. The project keeps
              the same link.
            </p>

            <form action={beginSignIn}>
              <button
                type="submit"
                className="inline-flex w-fit items-center gap-sm rounded bg-primary px-lg py-md font-sans text-body-sm font-medium text-on-primary transition-colors hover:bg-primary-fixed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                Continue to your identity provider
                <MaterialIcon name="arrow_forward" size={18} />
              </button>
            </form>
          </div>
        ) : (
          <div
            role="status"
            className="flex flex-col gap-sm rounded-lg border border-outline-variant bg-surface-container-low p-lg"
          >
            <p className="flex items-center gap-sm font-sans text-body-md text-on-surface">
              <MaterialIcon name="construction" size={20} className="text-warning" />
              Sign-in is not configured on this deployment.
            </p>
            <p className="font-sans text-body-sm text-on-surface-variant">
              You do not need an account to use the platform. Start a project, answer what you know,
              generate the research request and see the result — all without signing in.
            </p>
          </div>
        )}

        <Link
          href="/start"
          className="inline-flex w-fit items-center gap-sm rounded border border-outline-variant px-lg py-md font-sans text-body-sm text-on-surface transition-colors hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          Start a project without an account
          <MaterialIcon name="arrow_forward" size={18} />
        </Link>
      </main>
    </div>
  );
}
