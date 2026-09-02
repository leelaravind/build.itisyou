'use server';

import { redirect } from 'next/navigation';
import { logger } from '@govintel/shared/logging';
import { toAppError } from '@govintel/shared/errors';
import { projects } from '@govintel/db/schema';
import { withDatabase } from '../../lib/server/database.ts';
import { ensureGuestSession } from '../../lib/server/session.ts';
import { currentUser } from '../../lib/server/auth.ts';
import { checkRateLimit } from '../../lib/server/rate-limit.ts';
import { GUEST_TTL_HOURS } from '../../lib/server/config.ts';

/**
 * Create a guest project from the idea the visitor typed.
 *
 * Contract: gap-spec §5.1 (a guest may start a project), §36 (rate-limit guest project creation),
 * plan §2.3 (guest-first).
 *
 * The order matters. Rate limiting comes before session creation, so a flood cannot create sessions
 * faster than it is stopped; session creation comes before the project, so the project always has an
 * owner. Nothing here trusts client input beyond the idea text, which is stored as data and never
 * interpreted.
 *
 * **No `redirect()` inside a `try`.** Next implements `redirect()` by throwing a `NEXT_REDIRECT`
 * control-flow error, so a `catch` around it swallows the navigation and reports a generic failure
 * instead. The work returns a destination; the navigation happens afterwards.
 */
export async function startProject(formData: FormData): Promise<void> {
  // `FormData.get` returns `string | File | null`; anything that is not a string is discarded
  // rather than stringified, which would yield "[object File]".
  const raw = formData.get('idea');
  const idea = typeof raw === 'string' ? raw.trim() : '';

  if (idea.length === 0) {
    redirect('/start?error=empty');
  }

  // Guard before doing any work. Gap-spec §36 names guest project creation explicitly, because it
  // is the one write an unauthenticated caller can perform.
  if (!(await checkRateLimit('guest-project-create'))) {
    redirect('/start?error=rate-limited');
  }

  const destination = await create(idea);
  redirect(destination);
}

/** Create the session and project, returning where to go next. Never redirects from inside. */
async function create(idea: string): Promise<string> {
  try {
    /*
     * A signed-in user's project belongs to their account, not to a guest session.
     *
     * Starting one used to create a guest session unconditionally and file the project under *that*
     * organisation — so a signed-in user's new project landed in a tenant they were not scoped to.
     * Since the request is scoped to their account, the insert was refused by row-level security
     * and starting a project simply failed. It is the mirror of the same assumption that made
     * signing in empty the product: guest-first was written as guest-only.
     *
     * `guestSessionId` is left null, which is what "claimed" means everywhere else.
     */
    const user = await currentUser();

    const owner =
      user === undefined
        ? await (async () => {
            const session = await ensureGuestSession(GUEST_TTL_HOURS);
            /*
             * The project carries the guest session's own organisation as its tenant.
             *
             * It used to carry only `guestSessionId`, leaving `organization_id` NULL — which put the
             * row outside every row-level security policy, since they all compare against
             * `app.current_organization_id` and that is never equal to NULL. Guest projects were
             * therefore unprotected by RLS entirely, and this insert failed outright the moment the
             * application stopped connecting as a role that could bypass it.
             *
             * `guestSessionId` is still set, and still means "unclaimed". The two columns answer
             * different questions: which tenant owns this, and whether that tenant is a guest's.
             */
            return { organizationId: session.organizationId, guestSessionId: session.id };
          })()
        : { organizationId: user.organizationId, guestSessionId: null };

    const [project] = await withDatabase((db) =>
      db
        .insert(projects)
        .values({
          organizationId: owner.organizationId,
          guestSessionId: owner.guestSessionId,
          name: deriveName(idea),
          summary: idea.slice(0, 2000),
        })
        .returning({ id: projects.id }),
    );

    if (project === undefined) throw new Error('project insert returned no row');

    logger.info('project created', {
      projectId: project.id,
      signedIn: user !== undefined,
    });
    return `/intake/${project.id}`;
  } catch (error) {
    // The idea text is the user's own content and must not reach the log verbatim — it is exactly
    // the "sensitive user-entered project details" plan §26 says not to log unnecessarily.
    logger.error('failed to start guest project', { err: toAppError(error) });
    return '/start?error=failed';
  }
}

/**
 * A working project name from the idea text.
 *
 * Deliberately dumb — first clause, truncated. The alternative is asking the visitor to name the
 * project before they have described it, which is a question people stall on. It is renameable, and
 * the wizard offers a better suggestion once there is enough context.
 */
function deriveName(idea: string): string {
  const firstClause = idea.split(/[.\n]/)[0] ?? idea;
  const trimmed = firstClause.trim();
  if (trimmed.length === 0) return 'Untitled project';
  return trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed;
}
