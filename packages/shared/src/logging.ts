/**
 * Structured logging with mandatory redaction.
 *
 * Contract:
 *  - MASTER_IMPLEMENTATION_PLAN.md section 26: structured logs, correlation IDs, and an explicit
 *    do-not-log list (source code, uploaded documents, secrets, tokens, raw external-AI payloads).
 *  - IMPLEMENTATION_GAP_CLOSURE_SPEC.md section 54: "Create automated tests proving sensitive values
 *    are not logged."
 *
 * Design stance: redaction is applied by the logger itself, not by call sites. A convention that
 * every caller must remember is a convention that will eventually be forgotten - and the failure is
 * silent, permanent (logs get shipped and retained), and only discovered during a breach review.
 * Redacting centrally means a careless `log.info('ctx', { user })` is safe by construction.
 */

import { currentCorrelationId, getContext } from './correlation.ts';

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const REDACTED = '[REDACTED]';

/**
 * Key names whose values are always redacted, matched case-insensitively as substrings.
 * Substring matching is deliberate: it catches `userPassword`, `db_password`, `passwordHash`
 * and `X-Api-Key` without needing an exhaustive list.
 */
const SENSITIVE_KEY_PATTERN =
  /(pass|secret|token|apikey|api_key|authorization|auth|cookie|credential|session|private_?key|signature|salt|otp|mfa|pin|ssn|cvv|card_?number)/i;

/**
 * Value shapes that are secret regardless of the key they appear under - the case where someone
 * logs a bare string that happens to be a credential.
 */
const SENSITIVE_VALUE_PATTERNS: readonly RegExp[] = [
  /-----BEGIN[A-Z ]*PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/i,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/, // JWT
  /\bsk-[A-Za-z0-9]{16,}/, // OpenAI-style
  /\bgh[pousr]_[A-Za-z0-9]{20,}/, // GitHub
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key ID
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/, // Slack
  /\bpostgres(?:ql)?:\/\/[^\s@]+:[^\s@]+@/i, // DSN with inline credentials
];

const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 50;
const MAX_STRING_LENGTH = 2_000;

function redactString(value: string): string {
  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    if (pattern.test(value)) return REDACTED;
  }
  return value.length > MAX_STRING_LENGTH
    ? `${value.slice(0, MAX_STRING_LENGTH)}...[truncated ${value.length - MAX_STRING_LENGTH} chars]`
    : value;
}

/**
 * Deep-redact an arbitrary value.
 *
 * Handles cycles (a domain object graph is not a tree), depth (an unbounded structure would hang
 * the logger), and Error objects (whose `message` routinely embeds the very payload that caused
 * the failure).
 */
export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return `[${typeof value}]`;

  if (depth >= MAX_DEPTH) return '[depth-limit]';

  if (value instanceof Date) return value.toISOString();

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      ...(value.cause === undefined ? {} : { cause: redact(value.cause, depth + 1, seen) }),
    };
  }

  if (typeof value === 'object') {
    if (seen.has(value)) return '[circular]';
    seen.add(value);

    if (Array.isArray(value)) {
      const items = value.slice(0, MAX_ARRAY_ITEMS).map((v) => redact(v, depth + 1, seen));
      return value.length > MAX_ARRAY_ITEMS
        ? [...items, `[${value.length - MAX_ARRAY_ITEMS} more items]`]
        : items;
    }

    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redact(item, depth + 1, seen);
    }
    return out;
  }

  return '[unknown]';
}

export interface LogRecord {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly message: string;
  readonly correlationId: string;
  readonly tenantId?: string;
  readonly userId?: string;
  readonly context?: Record<string, unknown>;
}

export type LogSink = (record: LogRecord) => void;

const jsonSink: LogSink = (record) => {
  const line = JSON.stringify(record);
  if (record.level === 'error' || record.level === 'warn') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
};

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LoggerOptions {
  readonly minLevel?: LogLevel;
  readonly sink?: LogSink;
}

export class Logger {
  private readonly minLevel: LogLevel;
  private readonly sink: LogSink;

  constructor(options: LoggerOptions = {}) {
    this.minLevel = options.minLevel ?? 'info';
    this.sink = options.sink ?? jsonSink;
  }

  private write(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;

    const ctx = getContext();
    const record: LogRecord = {
      timestamp: new Date().toISOString(),
      level,
      // The message itself is redacted too - callers interpolate values into messages.
      message: redactString(message),
      correlationId: ctx?.correlationId ?? currentCorrelationId(),
      ...(ctx?.tenantId === undefined ? {} : { tenantId: ctx.tenantId }),
      ...(ctx?.userId === undefined ? {} : { userId: ctx.userId }),
      ...(context === undefined ? {} : { context: redact(context) as Record<string, unknown> }),
    };
    this.sink(record);
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.write('debug', message, context);
  }
  info(message: string, context?: Record<string, unknown>): void {
    this.write('info', message, context);
  }
  warn(message: string, context?: Record<string, unknown>): void {
    this.write('warn', message, context);
  }
  error(message: string, context?: Record<string, unknown>): void {
    this.write('error', message, context);
  }
}

export const logger = new Logger({
  minLevel: process.env.LOG_LEVEL === 'debug' ? 'debug' : 'info',
});
