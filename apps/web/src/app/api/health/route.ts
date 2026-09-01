import { NextResponse } from 'next/server';
import { modeFor, type Subsystem } from '@govintel/resilience/degraded';
import { withDatabase } from '../../../lib/server/database.ts';

/**
 * Health and version identity.
 *
 * Two things §15.9 asks a production verification to establish — "monitoring" and "deployment
 * identity" — and both are useless unless the answer comes from the running process rather than from
 * whoever deployed it. A version reported by the deployment pipeline tells you what the pipeline
 * believed it shipped; a version reported by the process tells you what is actually serving.
 *
 * Three decisions worth stating.
 *
 * **It checks, rather than reporting a cached opinion.** A health endpoint that returns a stored
 * status answers "was this healthy at some point", which is the question nobody is asking. This runs
 * a real query, so a database that has gone away produces an unhealthy response rather than a stale
 * healthy one.
 *
 * **It discloses nothing.** No stack traces, no connection strings, no schema details, no counts. A
 * health endpoint is the most-scraped URL a service has and it is usually unauthenticated, so
 * everything it returns is public. What a monitor needs is a status and a version; anything more is
 * reconnaissance somebody else can use.
 *
 * **Unhealthy is a 503, not a 200 with a field.** Load balancers and uptime monitors read the status
 * code. A service reporting `{"healthy": false}` with a 200 stays in rotation while telling anybody
 * who parses the body that it should not be.
 */

export const dynamic = 'force-dynamic';

/**
 * The build this process is running.
 *
 * Read from the environment at request time rather than captured at module load, so a process that
 * somehow outlives its deployment reports what it is rather than what it was started as.
 */
function versionIdentity(): {
  readonly version: string;
  readonly commit: string;
  readonly environment: string;
} {
  return {
    version: process.env.APP_VERSION ?? 'unknown',
    // Set by CI at build time. "unknown" is honest and useful: it says this build did not come
    // through the pipeline, which is exactly what somebody debugging a surprising deployment needs.
    commit: process.env.APP_COMMIT ?? 'unknown',
    environment: process.env.APP_ENV ?? 'development',
  };
}

export async function GET(): Promise<NextResponse> {
  const identity = versionIdentity();
  const down: Subsystem[] = [];

  try {
    // A real query rather than a connection check. A pool can hold a connection to a database that
    // has stopped answering, and the difference only shows up when somebody tries to use it.
    await withDatabase(async (db) => db.execute('select 1'));
  } catch {
    /*
     * Deliberately no error detail in the response.
     *
     * The message would name the host, the database, or the failing constraint, and this endpoint is
     * public and scraped constantly. The detail belongs in the logs, where it is already redacted.
     */
    down.push('DATABASE');
  }

  const mode = modeFor({ down });
  const healthy = mode === 'NORMAL' || mode === 'DEGRADED';

  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'unavailable',
      mode,
      ...identity,
    },
    {
      // 503 rather than a 200 carrying a false field. Load balancers read the status code, and a
      // service that says it is unhealthy in a body nobody parses stays in rotation.
      status: healthy ? 200 : 503,
      headers: {
        // Never cached. A cached health response is a report about a moment that has passed, which
        // is the one thing a health check must never be.
        'cache-control': 'no-store, max-age=0',
      },
    },
  );
}
