import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { projects } from '@govintel/db/schema';
import { EXTERNAL_AI_MODE } from '../../../../lib/server/config.ts';
import { withDatabase } from '../../../../lib/server/database.ts';
import { readActiveGuestSessionId } from '../../../../lib/server/session.ts';
import { PublicHeader } from '../../../../components/shell/PublicHeader.tsx';
import { MaterialIcon } from '../../../../components/ui/MaterialIcon.tsx';
import { submitImport } from './actions.ts';

/**
 * Import AI response — locked screen 8.
 *
 * A textarea and a button, which understates what happens next: the paste is stored verbatim, put
 * through fourteen validation layers, and shown back to the user before anything is created. None of
 * that happens on this page, and that separation is the design (gap-spec §12.3).
 *
 * The copy here sets the expectation that the response will be *checked*, not trusted. A user who
 * believes the platform simply ingests whatever they paste will not read the validation screen.
 */

export const metadata = { title: 'Paste the response' };

export default async function ImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { projectId } = await params;
  const { error } = await searchParams;

  const [project] = await withDatabase((db) =>
    db.select().from(projects).where(eq(projects.id, projectId)),
  );

  if (project === undefined) notFound();

  const sessionId = await readActiveGuestSessionId();
  if (project.guestSessionId === null || project.guestSessionId !== sessionId) notFound();

  /*
   * The external-AI workflow can be switched off, and this half was not honouring it.
   *
   * Plan §19 lets an organisation disable the workflow. The *outbound* half checked
   * (`evaluatePolicy` on the prompt page) and the inbound half did not — so a deployment with
   * `EXTERNAL_AI_MODE=DISABLED` still accepted a pasted AI response, validated it and stored it.
   * Half a control is not a control: the setting existed, the screen said it was off, and the data
   * arrived anyway.
   *
   * `notFound` rather than an explanation, matching the ownership check above: a surface that is
   * switched off should not describe itself.
   */
  if (EXTERNAL_AI_MODE === 'DISABLED') notFound();

  return (
    <div className="min-h-screen bg-background">
      <PublicHeader />

      <main id="main" className="mx-auto flex max-w-content flex-col gap-lg px-md py-xl">
        <header className="flex flex-col gap-sm">
          <p className="font-sans text-label-caps tracking-wider text-on-surface-variant uppercase">
            Step 3 of 3
          </p>
          <h1 className="font-sans text-headline-lg text-on-surface">Paste what you got back</h1>
          <p className="font-sans text-body-md text-on-surface-variant">
            Paste the whole reply. Extra text around the JSON is fine — the platform will find the
            object. Nothing is created until you have seen what it contains and said yes.
          </p>
        </header>

        <form action={submitImport} className="flex flex-col gap-md">
          <input type="hidden" name="projectId" value={projectId} />

          <label htmlFor="response" className="font-sans text-body-sm text-on-surface">
            The AI’s response
          </label>

          <textarea
            id="response"
            name="response"
            required
            rows={14}
            aria-describedby={error === undefined ? 'response-hint' : 'response-error'}
            placeholder='{ "schemaVersion": "1.0.0", ... }'
            className="w-full rounded border border-outline-variant bg-surface-container-low p-md font-mono text-data-mono-sm text-on-surface placeholder:text-on-surface-variant/60 focus:border-primary focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          />

          {error === undefined ? (
            <p id="response-hint" className="font-sans text-body-sm text-on-surface-variant">
              You will see exactly what it proposes, what it disagrees with you about, and what it
              could not verify — before any of it is applied.
            </p>
          ) : (
            <p
              id="response-error"
              role="alert"
              className="flex items-center gap-sm font-sans text-body-sm text-danger"
            >
              <MaterialIcon name="error" size={16} aria-hidden />
              {error === 'empty'
                ? 'Paste the response before continuing.'
                : error === 'rate-limited'
                  ? 'Too many attempts just now. Wait a moment and try again.'
                  : 'Something went wrong storing that. Please try again.'}
            </p>
          )}

          <button
            type="submit"
            className="inline-flex w-fit items-center gap-sm rounded bg-primary px-lg py-md font-sans text-body-sm font-medium text-on-primary transition-colors hover:bg-primary-fixed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Check the response
            <MaterialIcon name="rule" size={18} />
          </button>
        </form>

        <div className="flex flex-col gap-sm rounded-lg border border-outline-variant bg-surface-container-low p-lg">
          <p className="font-sans text-label-caps tracking-wider text-on-surface-variant uppercase">
            What gets checked
          </p>
          <ul className="flex flex-col gap-xs font-sans text-body-sm text-on-surface-variant">
            <li>That it is well formed and matches the agreed shape.</li>
            <li>That every claim says where it came from and how confident it is.</li>
            <li>That nothing it says contradicts what you already told us.</li>
            <li>That its references and dependencies actually resolve.</li>
            <li>That it contains nothing designed to be read as an instruction.</li>
          </ul>
        </div>

        <Link
          href={`/intake/${projectId}/prompt`}
          className="inline-flex w-fit items-center gap-sm font-sans text-body-sm text-on-surface-variant transition-colors hover:text-on-surface"
        >
          <MaterialIcon name="arrow_back" size={16} />
          Back to the request
        </Link>
      </main>
    </div>
  );
}
