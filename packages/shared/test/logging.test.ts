/**
 * Log redaction tests.
 *
 * Contract: IMPLEMENTATION_GAP_CLOSURE_SPEC.md section 54 - "Create automated tests proving sensitive
 * values are not logged." Patterns named there: passwords, Authorization headers, cookies, API keys,
 * private keys, tokens, raw restricted project fields.
 *
 * These are security regression tests. Each asserts on the *serialised output*, not on the redactor's
 * return value, because what matters is what reaches the log sink.
 */

import { describe, it, expect } from 'vitest';
import { Logger, redact, REDACTED, type LogRecord } from '../src/logging.ts';
import { runWithContext } from '../src/correlation.ts';

function capture(): { records: LogRecord[]; logger: Logger } {
  const records: LogRecord[] = [];
  const logger = new Logger({ minLevel: 'debug', sink: (r) => records.push(r) });
  return { records, logger };
}

/** Serialise the way a real sink would, so a leak anywhere in the object graph is caught. */
function serialised(record: LogRecord): string {
  return JSON.stringify(record);
}

describe('redaction by key name', () => {
  const secretValue = 'hunter2-the-actual-secret';

  it.each([
    'password',
    'userPassword',
    'password_hash',
    'passwordHash',
    'secret',
    'clientSecret',
    'token',
    'refreshToken',
    'accessToken',
    'apiKey',
    'api_key',
    'API_KEY',
    'authorization',
    'Authorization',
    'auth',
    'cookie',
    'Cookie',
    'setCookie',
    'credential',
    'credentials',
    'sessionId',
    'session_token',
    'privateKey',
    'private_key',
    'signature',
    'salt',
    'otp',
    'mfaCode',
    'pin',
    'ssn',
    'cvv',
    'cardNumber',
  ])('redacts the value under key %s', (key) => {
    const { records, logger } = capture();
    logger.info('event', { [key]: secretValue });

    expect(records[0]?.context?.[key]).toBe(REDACTED);
    expect(serialised(records[0]!)).not.toContain(secretValue);
  });

  it('redacts sensitive keys nested inside objects', () => {
    const { records, logger } = capture();
    logger.info('event', { user: { profile: { name: 'Ada', apiKey: secretValue } } });

    expect(serialised(records[0]!)).not.toContain(secretValue);
    expect(serialised(records[0]!)).toContain('Ada');
  });

  it('redacts sensitive keys inside arrays of objects', () => {
    const { records, logger } = capture();
    logger.info('event', { members: [{ id: 1, token: secretValue }] });

    expect(serialised(records[0]!)).not.toContain(secretValue);
  });

  it('preserves non-sensitive sibling values', () => {
    const { records, logger } = capture();
    logger.info('event', { projectId: 'proj_123', password: secretValue });

    expect(records[0]?.context?.projectId).toBe('proj_123');
    expect(records[0]?.context?.password).toBe(REDACTED);
  });
});

describe('redaction by value shape, regardless of key', () => {
  it.each([
    ['private key block', '-----BEGIN RSA PRIVATE KEY-----\nMIIEow...'],
    ['bearer token', 'Bearer abcdef0123456789ABCDEF.token-value'],
    [
      'JWT',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    ],
    ['OpenAI-style key', 'sk-abcdefghijklmnopqrstuvwxyz0123456789'],
    ['GitHub PAT', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'],
    ['AWS access key id', 'AKIAIOSFODNN7EXAMPLE'],
    ['Slack token', 'xoxb-123456789012-abcdefghijklmnop'],
    ['Postgres DSN with credentials', 'postgresql://admin:s3cr3tpw@db.internal:5432/app'],
  ])('redacts a %s even under an innocuous key', (_label, value) => {
    const { records, logger } = capture();
    logger.info('event', { note: value });

    expect(records[0]?.context?.note).toBe(REDACTED);
    expect(serialised(records[0]!)).not.toContain(value);
  });

  it('redacts a secret interpolated into the log message itself', () => {
    const { records, logger } = capture();
    logger.error('failed to connect: postgresql://admin:s3cr3tpw@db.internal:5432/app');

    expect(records[0]?.message).toBe(REDACTED);
    expect(serialised(records[0]!)).not.toContain('s3cr3tpw');
  });
});

describe('Error objects', () => {
  it('redacts a secret embedded in an error message', () => {
    const { records, logger } = capture();
    logger.error('operation failed', {
      err: new Error('connect failed for postgresql://admin:s3cr3tpw@db:5432/app'),
    });

    expect(serialised(records[0]!)).not.toContain('s3cr3tpw');
  });

  it('preserves the error name so failures stay diagnosable', () => {
    const { records, logger } = capture();
    logger.error('operation failed', { err: new TypeError('bad input') });

    expect(serialised(records[0]!)).toContain('TypeError');
  });

  it('walks the cause chain', () => {
    const { records, logger } = capture();
    const root = new Error('root: ghp_abcdefghijklmnopqrstuvwxyz0123456789');
    logger.error('wrapped', { err: new Error('outer', { cause: root }) });

    expect(serialised(records[0]!)).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
  });
});

describe('structural safety', () => {
  it('does not hang on a circular reference', () => {
    const cyclic: Record<string, unknown> = { name: 'node' };
    cyclic.self = cyclic;

    expect(() => redact(cyclic)).not.toThrow();
    expect(JSON.stringify(redact(cyclic))).toContain('[circular]');
  });

  it('stops at the depth limit rather than recursing without bound', () => {
    let deep: Record<string, unknown> = { value: 'leaf' };
    for (let i = 0; i < 20; i += 1) deep = { nested: deep };

    expect(JSON.stringify(redact(deep))).toContain('[depth-limit]');
  });

  it('caps long arrays so one log line cannot flood the sink', () => {
    const output = redact({ items: Array.from({ length: 200 }, (_, i) => i) }) as {
      items: unknown[];
    };

    expect(output.items.length).toBeLessThanOrEqual(51);
    expect(output.items.at(-1)).toContain('more items');
  });

  it('truncates very long strings', () => {
    const output = redact('x'.repeat(5000));

    expect(String(output)).toContain('[truncated');
    expect(String(output).length).toBeLessThan(5000);
  });

  it('handles null and undefined without throwing', () => {
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
  });
});

describe('record shape', () => {
  it('always carries a correlation id, even outside a request scope', () => {
    const { records, logger } = capture();
    logger.info('orphan event');

    expect(records[0]?.correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('inherits correlation id, tenant and user from the ambient context', () => {
    const { records, logger } = capture();
    runWithContext(
      {
        correlationId: '11111111-1111-4111-8111-111111111111',
        tenantId: 'org_1',
        userId: 'user_1',
      },
      () => {
        logger.info('scoped event');
      },
    );

    expect(records[0]?.correlationId).toBe('11111111-1111-4111-8111-111111111111');
    expect(records[0]?.tenantId).toBe('org_1');
    expect(records[0]?.userId).toBe('user_1');
  });

  it('suppresses records below the configured level', () => {
    const records: LogRecord[] = [];
    const logger = new Logger({ minLevel: 'warn', sink: (r) => records.push(r) });

    logger.debug('no');
    logger.info('no');
    logger.warn('yes');
    logger.error('yes');

    expect(records.map((r) => r.level)).toEqual(['warn', 'error']);
  });

  it('emits an ISO-8601 timestamp', () => {
    const { records, logger } = capture();
    logger.info('event');

    expect(records[0]?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
