import 'server-only';

import { parseEnv } from '@govintel/shared/env';

/**
 * Validated server configuration.
 *
 * Parsed once at module load so a misconfigured environment fails at startup rather than on the
 * first request that happens to need the missing value (plan §34, Phase 1).
 */
const env = parseEnv();

export const GUEST_TTL_HOURS = env.GUEST_PROJECT_TTL_HOURS;
export const EXTERNAL_AI_MODE = env.EXTERNAL_AI_MODE;
export const APP_ENV = env.APP_ENV;
export const APP_VERSION = env.APP_VERSION;

/** True in the environments where TLS, a real database and a session secret are guaranteed. */
export const IS_DEPLOYED =
  env.APP_ENV === 'preview' || env.APP_ENV === 'staging' || env.APP_ENV === 'production';
