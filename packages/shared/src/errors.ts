/**
 * Application error taxonomy.
 *
 * Contract: IMPLEMENTATION_GAP_CLOSURE_SPEC.md section 55 requires stable application error codes
 * grouped into fixed categories, and requires the UI to map codes to *safe* messages.
 *
 * Two rules drive the design here:
 *
 * 1. An error carries a **safe message** (shown to the user) separately from **details**
 *    (diagnostic, never rendered, never logged raw). Gap-spec section 65 lists "error data leakage"
 *    as a pre-live security check, so the split is structural rather than a convention.
 * 2. `TENANT_ISOLATION` is its own category, deliberately distinct from `AUTHORIZATION`. A tenant
 *    boundary breach is a security incident, not a permission miss, and must be alertable on its own.
 */

export const ERROR_CATEGORIES = [
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
] as const;

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

/**
 * HTTP status per category.
 *
 * TENANT_ISOLATION maps to 404, not 403. Returning 403 confirms the resource exists, which is itself
 * a cross-tenant disclosure - the caller learns that some other tenant owns that ID. Gap-spec section 7.5
 * requires that cross-tenant probing yields no data disclosure, and existence is data.
 */
const HTTP_STATUS: Record<ErrorCategory, number> = {
  VALIDATION: 400,
  AUTHENTICATION: 401,
  AUTHORIZATION: 403,
  CONFLICT: 409,
  NOT_FOUND: 404,
  RATE_LIMIT: 429,
  DEPENDENCY: 502,
  INTERNAL: 500,
  JOB_FAILED: 500,
  UNSUPPORTED: 422,
  SECURITY_POLICY: 403,
  TENANT_ISOLATION: 404,
};

/** Categories that must never be retried by a client without changing the request. */
const NON_RETRYABLE: ReadonlySet<ErrorCategory> = new Set<ErrorCategory>([
  'VALIDATION',
  'AUTHENTICATION',
  'AUTHORIZATION',
  'NOT_FOUND',
  'UNSUPPORTED',
  'SECURITY_POLICY',
  'TENANT_ISOLATION',
  'CONFLICT',
]);

/**
 * Categories that must raise a security signal when observed.
 * Gap-spec section 34 (threat model) and section 65 (pre-live attack suite).
 */
const SECURITY_SIGNIFICANT: ReadonlySet<ErrorCategory> = new Set<ErrorCategory>([
  'TENANT_ISOLATION',
  'SECURITY_POLICY',
  'AUTHENTICATION',
  'AUTHORIZATION',
]);

export interface AppErrorOptions {
  /** Stable, greppable code, e.g. `AI_IMPORT_SCHEMA_INVALID`. Never a free-text string. */
  readonly code: string;
  readonly category: ErrorCategory;
  /** Safe to show a user. Must not contain IDs, payloads, or internal state. */
  readonly safeMessage: string;
  /** Diagnostic context. Never rendered; redacted before logging. */
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: string;
  readonly cause?: unknown;
  /** For RATE_LIMIT, seconds until the caller may retry. */
  readonly retryAfterSeconds?: number;
}

export class AppError extends Error {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly safeMessage: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly correlationId: string | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(options: AppErrorOptions) {
    // `message` carries the safe message so an accidental `String(err)` cannot leak details.
    super(options.safeMessage, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = options.code;
    this.category = options.category;
    this.safeMessage = options.safeMessage;
    this.details = options.details ?? {};
    this.correlationId = options.correlationId;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }

  get httpStatus(): number {
    return HTTP_STATUS[this.category];
  }

  get retryable(): boolean {
    return !NON_RETRYABLE.has(this.category);
  }

  get securitySignificant(): boolean {
    return SECURITY_SIGNIFICANT.has(this.category);
  }

  /**
   * The only representation permitted to cross the network boundary.
   * Deliberately excludes `details`, `cause` and any stack.
   */
  toWireFormat(): {
    error: {
      code: string;
      category: ErrorCategory;
      message: string;
      correlationId?: string;
      retryAfterSeconds?: number;
    };
  } {
    return {
      error: {
        code: this.code,
        category: this.category,
        message: this.safeMessage,
        ...(this.correlationId === undefined ? {} : { correlationId: this.correlationId }),
        ...(this.retryAfterSeconds === undefined
          ? {}
          : { retryAfterSeconds: this.retryAfterSeconds }),
      },
    };
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/**
 * Convert any thrown value into an AppError without leaking its content.
 *
 * An unknown throw could be anything - a driver error containing a connection string, a third-party
 * error embedding a token. Its message is therefore never promoted to `safeMessage`; it is preserved
 * only as `cause` for redacted logging.
 */
export function toAppError(value: unknown, correlationId?: string): AppError {
  if (isAppError(value)) {
    if (correlationId === undefined || value.correlationId !== undefined) return value;
    return new AppError({
      code: value.code,
      category: value.category,
      safeMessage: value.safeMessage,
      details: value.details,
      correlationId,
      cause: value.cause,
      ...(value.retryAfterSeconds === undefined
        ? {}
        : { retryAfterSeconds: value.retryAfterSeconds }),
    });
  }

  return new AppError({
    code: 'UNEXPECTED_ERROR',
    category: 'INTERNAL',
    safeMessage: 'Something went wrong. The problem has been recorded.',
    ...(correlationId === undefined ? {} : { correlationId }),
    cause: value,
  });
}
