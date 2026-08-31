/**
 * Environment validation.
 *
 * Contract: MASTER_IMPLEMENTATION_PLAN.md section 34 (Phase 1) requires env validation; section 18
 * requires "secret-manager references only" and no secrets in logs.
 *
 * Two properties matter here:
 *
 * 1. **Fail fast at startup.** A missing DATABASE_URL should stop the process immediately, not
 *    surface as a confusing runtime error on the first request that touches persistence.
 * 2. **Never echo a value.** Validation failures name the *variable*, never its content. An error
 *    message quoting a malformed DATABASE_URL would print the password to the logs - which is
 *    precisely the leak gap-spec section 54 requires tests against.
 */

import { z } from 'zod';

export const NODE_ENVS = ['development', 'test', 'preview', 'staging', 'production'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

/**
 * External-AI policy modes (plan section 19).
 * DISABLED must be honourable at the environment level so an organisation can switch the whole
 * external-AI workflow off without a code change.
 */
export const EXTERNAL_AI_MODES = [
  'DISABLED',
  'REDACTED_ONLY',
  'APPROVED_PROVIDERS_ONLY',
  'USER_CHOICE',
] as const;

const schema = z.object({
  NODE_ENV: z.enum(NODE_ENVS).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  /**
   * Postgres connection string.
   * Optional in development and test: those environments use PGlite, which needs no URL
   * (ADR-0002). Required everywhere else - enforced by the refinement below.
   */
  DATABASE_URL: z.string().min(1).optional(),

  /** Signing key for guest session cookies (gap-spec section 5.2). */
  SESSION_SECRET: z.string().min(32).optional(),

  EXTERNAL_AI_MODE: z.enum(EXTERNAL_AI_MODES).default('USER_CHOICE'),

  /** Guest project lifetime before automatic expiry (gap-spec section 5.3). */
  GUEST_PROJECT_TTL_HOURS: z.coerce.number().int().positive().default(72),

  /** Deployed commit SHA, surfaced by the production-verification check (plan section 28). */
  APP_VERSION: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

/** Environments where a real networked Postgres and a session secret are mandatory. */
const DEPLOYED: ReadonlySet<NodeEnv> = new Set<NodeEnv>(['preview', 'staging', 'production']);

export class EnvValidationError extends Error {
  readonly variables: readonly string[];

  constructor(variables: readonly string[]) {
    // Names only. Never values - see the file header.
    super(
      `Environment validation failed for: ${variables.join(', ')}. ` +
        `See .env.example for the expected shape.`,
    );
    this.name = 'EnvValidationError';
    this.variables = variables;
  }
}

export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = schema.safeParse(source);

  if (!result.success) {
    const names = [...new Set(result.error.issues.map((i) => i.path.join('.') || '<root>'))];
    throw new EnvValidationError(names);
  }

  const env = result.data;
  const missing: string[] = [];

  if (DEPLOYED.has(env.NODE_ENV)) {
    if (env.DATABASE_URL === undefined) missing.push('DATABASE_URL');
    if (env.SESSION_SECRET === undefined) missing.push('SESSION_SECRET');
  }

  if (missing.length > 0) throw new EnvValidationError(missing);

  return env;
}

let cached: Env | undefined;

/** Validated environment, parsed once. */
export function env(): Env {
  cached ??= parseEnv();
  return cached;
}

/** Test-only: clear the memoised environment between cases. */
export function resetEnvCache(): void {
  cached = undefined;
}
