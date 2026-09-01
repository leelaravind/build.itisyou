/**
 * Environment validation tests.
 * Contract: MASTER_IMPLEMENTATION_PLAN.md section 34 Phase 1 (env validation),
 * section 18 (no secrets in logs) - a validation error must never quote a value.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EnvValidationError, parseEnv, resetEnvCache } from '../src/env.ts';

beforeEach(resetEnvCache);

describe('defaults', () => {
  it('defaults to development with sensible values', () => {
    const env = parseEnv({});

    expect(env.APP_ENV).toBe('development');
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.EXTERNAL_AI_MODE).toBe('USER_CHOICE');
    expect(env.GUEST_PROJECT_TTL_HOURS).toBe(72);
  });

  it('does not require a database URL in development, because dev uses PGlite', () => {
    // ADR-0002: dev and test run embedded Postgres, so there is no URL to supply.
    expect(() => parseEnv({ APP_ENV: 'development' })).not.toThrow();
  });

  it('does not require a database URL in test', () => {
    expect(() => parseEnv({ APP_ENV: 'test' })).not.toThrow();
  });

  it('does not require a database URL for a production *build*', () => {
    // `next build` sets NODE_ENV=production for every optimised build, including one produced on a
    // laptop. Keying the requirement off NODE_ENV failed the build itself; APP_ENV is the stage.
    expect(() => parseEnv({ NODE_ENV: 'production' })).not.toThrow();
  });

  it('separates build mode from deployment stage', () => {
    const env = parseEnv({ NODE_ENV: 'production', APP_ENV: 'development' });
    expect(env.NODE_ENV).toBe('production');
    expect(env.APP_ENV).toBe('development');
  });
});

describe('deployed environments', () => {
  it.each(['preview', 'staging', 'production'] as const)(
    'requires DATABASE_URL and SESSION_SECRET in %s',
    (appEnv) => {
      expect(() => parseEnv({ APP_ENV: appEnv })).toThrow(EnvValidationError);
    },
  );

  it('names every missing variable so the operator fixes them in one pass', () => {
    try {
      parseEnv({ APP_ENV: 'production' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect((error as EnvValidationError).variables).toEqual(
        expect.arrayContaining(['DATABASE_URL', 'SESSION_SECRET']),
      );
    }
  });

  it('accepts a complete production configuration', () => {
    const env = parseEnv({
      APP_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pw@host:5432/db',
      SESSION_SECRET: 'a'.repeat(32),
    });

    expect(env.APP_ENV).toBe('production');
  });
});

/**
 * Some hosts do not pass a connection string as an environment variable at all.
 *
 * Cloudflare Hyperdrive is an *object* binding carrying a `connectionString` property, and an object
 * cannot be copied into `process.env` the way a var or a secret can. Requiring `DATABASE_URL` there
 * rejected a deployment whose database was correctly configured — the staging Worker answered 500 on
 * every request with the binding present and working.
 *
 * The fix is a declaration rather than an exemption, and these tests are what hold that line: a
 * deployment may say *where* the connection string comes from, but it may not decline to say.
 */
describe('a connection string supplied by a platform binding', () => {
  it.each(['preview', 'staging', 'production'] as const)(
    'accepts %s when the deployment declares the binding that carries it',
    (appEnv) => {
      const env = parseEnv({
        APP_ENV: appEnv,
        DATABASE_URL_BINDING: 'HYPERDRIVE',
        SESSION_SECRET: 'a'.repeat(32),
      });

      expect(env.DATABASE_URL).toBeUndefined();
      expect(env.DATABASE_URL_BINDING).toBe('HYPERDRIVE');
    },
  );

  it('still rejects a deployment that names neither source', () => {
    /*
     * The load-bearing test. If this ever passes, the declaration has become an exemption: an
     * operator would be able to skip the check by omitting both, which is precisely the
     * misconfiguration the check exists to catch.
     */
    try {
      parseEnv({ APP_ENV: 'production', SESSION_SECRET: 'a'.repeat(32) });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as EnvValidationError).variables).toContain('DATABASE_URL');
    }
  });

  it('does not let the declaration excuse anything else', () => {
    // SESSION_SECRET is unrelated to where the database lives and must stay required.
    try {
      parseEnv({ APP_ENV: 'production', DATABASE_URL_BINDING: 'HYPERDRIVE' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as EnvValidationError).variables).toEqual(['SESSION_SECRET']);
    }
  });

  it('rejects an empty binding name rather than treating it as a declaration', () => {
    // An empty string is what a mis-templated deployment variable looks like. It names no binding,
    // so it must not satisfy the requirement to name one.
    expect(() =>
      parseEnv({
        APP_ENV: 'production',
        DATABASE_URL_BINDING: '',
        SESSION_SECRET: 'a'.repeat(32),
      }),
    ).toThrow(EnvValidationError);
  });
});

describe('validation errors never leak values', () => {
  it('does not quote a malformed DATABASE_URL in the message', () => {
    // The URL embeds a password. Echoing it would write the credential to startup logs -
    // exactly the leak gap-spec section 54 requires tests against.
    const secret = 'sup3rs3cr3tpassw0rd';

    try {
      parseEnv({
        APP_ENV: 'production',
        DATABASE_URL: '',
        SESSION_SECRET: `short-but-contains-${secret}`,
      });
      expect.unreachable('should have thrown');
    } catch (error) {
      const text = `${(error as Error).message} ${JSON.stringify((error as EnvValidationError).variables)}`;
      expect(text).not.toContain(secret);
    }
  });

  it('does not quote a rejected enum value', () => {
    try {
      parseEnv({ APP_ENV: 'sekrit-environment-name' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as Error).message).not.toContain('sekrit-environment-name');
    }
  });

  it('reports variable names, which is what an operator actually needs', () => {
    try {
      parseEnv({ APP_ENV: 'nope' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as Error).message).toContain('APP_ENV');
    }
  });
});

describe('field validation', () => {
  it('rejects a session secret shorter than 32 characters', () => {
    expect(() =>
      parseEnv({
        APP_ENV: 'production',
        DATABASE_URL: 'postgresql://h/db',
        SESSION_SECRET: 'too-short',
      }),
    ).toThrow(EnvValidationError);
  });

  it('rejects an unknown external-AI mode', () => {
    expect(() => parseEnv({ EXTERNAL_AI_MODE: 'SEND_EVERYTHING' })).toThrow(EnvValidationError);
  });

  it.each(['DISABLED', 'REDACTED_ONLY', 'APPROVED_PROVIDERS_ONLY', 'USER_CHOICE'])(
    'accepts external-AI mode %s',
    (mode) => {
      expect(parseEnv({ EXTERNAL_AI_MODE: mode }).EXTERNAL_AI_MODE).toBe(mode);
    },
  );

  it('allows an organisation to disable the external-AI workflow entirely', () => {
    // Plan section 19 requires DISABLED to be a supported policy mode.
    expect(parseEnv({ EXTERNAL_AI_MODE: 'DISABLED' }).EXTERNAL_AI_MODE).toBe('DISABLED');
  });

  it('coerces a numeric guest TTL from its string form', () => {
    expect(parseEnv({ GUEST_PROJECT_TTL_HOURS: '24' }).GUEST_PROJECT_TTL_HOURS).toBe(24);
  });

  it.each(['0', '-1', 'abc', '1.5'])('rejects invalid guest TTL %s', (value) => {
    expect(() => parseEnv({ GUEST_PROJECT_TTL_HOURS: value })).toThrow(EnvValidationError);
  });

  it.each(['debug', 'info', 'warn', 'error'])('accepts log level %s', (level) => {
    expect(parseEnv({ LOG_LEVEL: level }).LOG_LEVEL).toBe(level);
  });

  it('rejects an unknown log level', () => {
    expect(() => parseEnv({ LOG_LEVEL: 'verbose' })).toThrow(EnvValidationError);
  });
});
