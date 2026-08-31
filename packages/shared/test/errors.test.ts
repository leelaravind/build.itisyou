/**
 * Error taxonomy tests.
 * Contract: IMPLEMENTATION_GAP_CLOSURE_SPEC.md section 55 (stable codes, safe messages),
 * section 7.5 (cross-tenant probing must disclose nothing), section 65 (error data leakage).
 */

import { describe, it, expect } from 'vitest';
import {
  AppError,
  ERROR_CATEGORIES,
  isAppError,
  toAppError,
  type ErrorCategory,
} from '../src/errors.ts';

describe('category to HTTP status mapping', () => {
  it.each([
    ['VALIDATION', 400],
    ['AUTHENTICATION', 401],
    ['AUTHORIZATION', 403],
    ['NOT_FOUND', 404],
    ['CONFLICT', 409],
    ['UNSUPPORTED', 422],
    ['RATE_LIMIT', 429],
    ['INTERNAL', 500],
    ['JOB_FAILED', 500],
    ['DEPENDENCY', 502],
    ['SECURITY_POLICY', 403],
  ] as const)('maps %s to %i', (category, status) => {
    const error = new AppError({ code: 'X', category, safeMessage: 'msg' });
    expect(error.httpStatus).toBe(status);
  });

  it('maps TENANT_ISOLATION to 404, not 403', () => {
    // A 403 would confirm the resource exists and belongs to someone else. Existence is data,
    // and gap-spec section 7.5 requires cross-tenant probing to disclose nothing at all.
    const error = new AppError({
      code: 'CROSS_TENANT_READ',
      category: 'TENANT_ISOLATION',
      safeMessage: 'Not found.',
    });

    expect(error.httpStatus).toBe(404);
  });

  it('assigns a status to every declared category', () => {
    for (const category of ERROR_CATEGORIES) {
      const error = new AppError({ code: 'X', category, safeMessage: 'msg' });
      expect(error.httpStatus, `no status for ${category}`).toBeGreaterThanOrEqual(400);
    }
  });
});

describe('wire format never leaks internals', () => {
  it('omits details, cause and stack', () => {
    const error = new AppError({
      code: 'DB_QUERY_FAILED',
      category: 'INTERNAL',
      safeMessage: 'Something went wrong.',
      details: { sql: 'SELECT * FROM users', dbPassword: 'hunter2' },
      cause: new Error('connection string postgresql://u:p@h/db'),
    });

    const wire = JSON.stringify(error.toWireFormat());

    expect(wire).not.toContain('SELECT');
    expect(wire).not.toContain('hunter2');
    expect(wire).not.toContain('postgresql://');
    expect(wire).not.toContain('stack');
    expect(JSON.parse(wire)).toEqual({
      error: {
        code: 'DB_QUERY_FAILED',
        category: 'INTERNAL',
        message: 'Something went wrong.',
      },
    });
  });

  it('includes correlation id when present so a user can quote it to support', () => {
    const error = new AppError({
      code: 'X',
      category: 'INTERNAL',
      safeMessage: 'msg',
      correlationId: 'abc-123',
    });

    expect(error.toWireFormat().error.correlationId).toBe('abc-123');
  });

  it('includes retryAfterSeconds for rate limits', () => {
    const error = new AppError({
      code: 'TOO_MANY_REQUESTS',
      category: 'RATE_LIMIT',
      safeMessage: 'Slow down.',
      retryAfterSeconds: 30,
    });

    expect(error.toWireFormat().error.retryAfterSeconds).toBe(30);
  });

  it('uses the safe message as the Error message so String(err) cannot leak', () => {
    const error = new AppError({
      code: 'X',
      category: 'INTERNAL',
      safeMessage: 'Safe.',
      details: { secret: 'leaked' },
    });

    expect(String(error)).not.toContain('leaked');
    expect(String(error)).toContain('Safe.');
  });
});

describe('retryability', () => {
  it.each([
    'VALIDATION',
    'AUTHENTICATION',
    'AUTHORIZATION',
    'NOT_FOUND',
    'UNSUPPORTED',
    'CONFLICT',
    'SECURITY_POLICY',
    'TENANT_ISOLATION',
  ] as const)('marks %s as non-retryable', (category) => {
    expect(new AppError({ code: 'X', category, safeMessage: 'm' }).retryable).toBe(false);
  });

  it.each(['INTERNAL', 'DEPENDENCY', 'RATE_LIMIT', 'JOB_FAILED'] as const)(
    'marks %s as retryable',
    (category) => {
      expect(new AppError({ code: 'X', category, safeMessage: 'm' }).retryable).toBe(true);
    },
  );
});

describe('security significance', () => {
  it.each(['TENANT_ISOLATION', 'SECURITY_POLICY', 'AUTHENTICATION', 'AUTHORIZATION'] as const)(
    'flags %s as security significant',
    (category) => {
      expect(new AppError({ code: 'X', category, safeMessage: 'm' }).securitySignificant).toBe(
        true,
      );
    },
  );

  it('does not flag ordinary validation failures', () => {
    const error = new AppError({ code: 'X', category: 'VALIDATION', safeMessage: 'm' });
    expect(error.securitySignificant).toBe(false);
  });
});

describe('toAppError', () => {
  it('returns an existing AppError unchanged when it already has a correlation id', () => {
    const original = new AppError({
      code: 'X',
      category: 'VALIDATION',
      safeMessage: 'm',
      correlationId: 'keep-me',
    });

    expect(toAppError(original, 'other')).toBe(original);
  });

  it('attaches a correlation id to an AppError that lacks one', () => {
    const original = new AppError({ code: 'X', category: 'VALIDATION', safeMessage: 'm' });
    const result = toAppError(original, 'new-id');

    expect(result.correlationId).toBe('new-id');
    expect(result.code).toBe('X');
  });

  it('never promotes an unknown throw message into the safe message', () => {
    // An unknown throw could embed a credential. Its content must not reach the user.
    const result = toAppError(new Error('connect failed: postgresql://admin:pw@h/db'));

    expect(result.safeMessage).not.toContain('postgresql://');
    expect(result.category).toBe('INTERNAL');
    expect(result.code).toBe('UNEXPECTED_ERROR');
  });

  it.each([['a string'], [42], [null], [undefined], [{ odd: true }]])(
    'wraps non-Error throw %s',
    (thrown) => {
      const result = toAppError(thrown);
      expect(isAppError(result)).toBe(true);
      expect(result.category).toBe('INTERNAL');
    },
  );

  it('preserves the original as cause for redacted logging', () => {
    const original = new Error('diagnostic detail');
    expect(toAppError(original).cause).toBe(original);
  });
});

describe('isAppError', () => {
  it('distinguishes AppError from a plain Error', () => {
    expect(isAppError(new AppError({ code: 'X', category: 'INTERNAL', safeMessage: 'm' }))).toBe(
      true,
    );
    expect(isAppError(new Error('plain'))).toBe(false);
    expect(isAppError('not an error')).toBe(false);
    expect(isAppError(null)).toBe(false);
  });
});

describe('taxonomy completeness', () => {
  it('declares exactly the twelve categories the contract requires', () => {
    const required: ErrorCategory[] = [
      'VALIDATION',
      'AUTHENTICATION',
      'AUTHORIZATION',
      'CONFLICT',
      'NOT_FOUND',
      'RATE_LIMIT',
      'DEPENDENCY',
      'INTERNAL',
      'JOB_FAILED',
      'UNSUPPORTED',
      'SECURITY_POLICY',
      'TENANT_ISOLATION',
    ];

    expect([...ERROR_CATEGORIES].sort()).toEqual([...required].sort());
  });
});
