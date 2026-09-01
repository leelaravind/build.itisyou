import Link from 'next/link';
import { PublicHeader } from '../../components/shell/PublicHeader.tsx';
import { MaterialIcon } from '../../components/ui/MaterialIcon.tsx';

export const metadata = { title: 'Sign in' };

/**
 * Sign in — locked screen 51 (DERIVED from `save_project`).
 *
 * The identity provider is deliberately unchosen: gap-spec §6.1 requires provider-neutral OIDC and
 * forbids coupling domain entities to a vendor. The resolution layer (`@govintel/db/identity`)
 * already works from verified claims alone and is fully tested. What is missing is the sign-in
 * *button*, which cannot be written until there is a provider to point it at.
 *
 * This page says so plainly rather than showing a form that does nothing. A dead login form is worse
 * than an honest placeholder: it invites someone to type a password into a field that discards it.
 *
 * Guest-first (plan §2.3) means nobody is blocked by this — the entire trial journey runs without an
 * account, which is exactly why the provider decision can wait without holding up the product.
 */
export default function LoginPage() {
  return (
    <div className="min-h-screen bg-background">
      <PublicHeader />

      <main id="main" className="mx-auto flex max-w-narrow flex-col gap-lg px-md py-3xl">
        <h1 className="font-sans text-headline-lg text-on-surface">Sign in</h1>

        <div
          role="status"
          className="flex flex-col gap-sm rounded-lg border border-outline-variant bg-surface-container-low p-lg"
        >
          <p className="flex items-center gap-sm font-sans text-body-md text-on-surface">
            <MaterialIcon name="construction" size={20} className="text-warning" />
            Accounts are not available yet.
          </p>
          <p className="font-sans text-body-sm text-on-surface-variant">
            You do not need one to use the platform. Start a project, answer what you know, generate
            the research request and see the result — all without signing in.
          </p>
        </div>

        <Link
          href="/start"
          className="inline-flex w-fit items-center gap-sm rounded bg-primary px-lg py-md font-sans text-body-sm font-medium text-on-primary transition-colors hover:bg-primary-fixed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          Start a project
          <MaterialIcon name="arrow_forward" size={18} />
        </Link>
      </main>
    </div>
  );
}
