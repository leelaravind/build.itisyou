import 'server-only';

/**
 * Where the deployed database connection string comes from.
 *
 * ## Why this is its own module
 *
 * `database.ts` deliberately names no provider — it takes a connection string and nothing else, so
 * that moving hosts is configuration rather than a rewrite. That property is worth keeping, and it is
 * exactly what made the first staging deployment wrong: the module read `process.env.DATABASE_URL`,
 * and on Cloudflare there is nothing to read.
 *
 * Hyperdrive is an **object binding**, not an environment variable. Vars and secrets are copied into
 * `process.env` by the adapter; a binding carrying a `connectionString` property cannot be, because
 * it is not a string. So the deployed web Worker would have thrown *"DATABASE_URL is not set"* on its
 * first request — with the binding sitting right there, correctly configured.
 *
 * The provider-specific knowledge lives here, in one file, rather than leaking into `database.ts`.
 * That is the same trade the architecture document describes: Cloudflare is allowed to be named
 * once, at the edge of the system, and nowhere behind it.
 */

/** The shape of the Hyperdrive binding this application uses. */
interface HyperdriveBinding {
  readonly connectionString: string;
}

/**
 * Resolve the connection string for a deployed environment.
 *
 * Order matters, and the binding wins.
 *
 * On Cloudflare the binding is the authoritative value: it is created and rotated by the platform,
 * and a `DATABASE_URL` secret set alongside it is a second copy that can disagree. The copy that is
 * easier to edit is the one that ends up pointing at the wrong database, and nothing would report
 * that — the application would simply serve another environment's data, correctly and quietly.
 *
 * `DATABASE_URL` remains the fallback so this is not a Cloudflare-only application: a plain Node
 * host, a container, or `next start` against a staging database all still work with no binding
 * present.
 */
export async function resolveConnectionString(): Promise<string> {
  const fromBinding = await hyperdriveConnectionString();

  if (fromBinding !== undefined) return fromBinding;

  const fromEnvironment = process.env.DATABASE_URL;

  if (fromEnvironment !== undefined && fromEnvironment.trim() !== '') return fromEnvironment;

  throw new Error(
    'No database connection string. A deployed environment needs either a Hyperdrive binding ' +
      'named HYPERDRIVE or DATABASE_URL in the environment — see ' +
      'docs/CLOUDFLARE_DEPLOYMENT_ARCHITECTURE.md.',
  );
}

/**
 * The Hyperdrive connection string, or `undefined` when not running on Cloudflare.
 *
 * The import is dynamic because `@opennextjs/cloudflare` resolves the Workers runtime context, and
 * importing it statically would pull that into every environment — including `next dev` and the test
 * runner, which have no such context. A dynamic import inside a `try` keeps the dependency where it
 * belongs: present when deployed to Cloudflare, absent everywhere else.
 *
 * Absence is `undefined`, not an error. "Not running on Cloudflare" is an ordinary situation with a
 * correct answer, and the caller has a fallback for it.
 */
async function hyperdriveConnectionString(): Promise<string | undefined> {
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');

    /*
     * `async: true` because this runs during initialisation rather than inside a request.
     *
     * The synchronous form only works once a request context exists. The database handle is created
     * on first use, which may be during the very first request — before that context is established
     * — and the synchronous form would throw there rather than return a value.
     */
    const context = await getCloudflareContext({ async: true });
    const { HYPERDRIVE: binding } = context.env as unknown as Record<string, unknown>;

    if (binding === undefined || binding === null) return undefined;

    const { connectionString } = binding as Partial<HyperdriveBinding>;

    if (typeof connectionString !== 'string' || connectionString.trim() === '') {
      /*
       * A binding that exists but carries nothing usable is a configuration error, not an absence,
       * and falling through to `DATABASE_URL` would hide it behind whatever that happens to hold.
       */
      throw new Error(
        'The HYPERDRIVE binding is present but has no connectionString. Check the hyperdrive id ' +
          'in wrangler.toml matches a configuration in this account.',
      );
    }

    return connectionString;
  } catch (error) {
    // Rethrow our own diagnosis; swallow only "this is not Cloudflare".
    if (error instanceof Error && error.message.includes('HYPERDRIVE binding')) throw error;

    return undefined;
  }
}
