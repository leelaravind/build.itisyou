/**
 * Correlation IDs.
 *
 * Contract: MASTER_IMPLEMENTATION_PLAN.md section 26 requires correlation IDs across logs, traces,
 * metrics and jobs; gap-spec section 46 requires every job to carry one; section 28 requires the
 * atomic change transaction to be correlation-linked so a single user action can be traced through
 * API -> domain -> outbox -> job -> audit.
 *
 * The ID is generated once at the edge and propagated. It is *not* regenerated per layer, because a
 * per-layer ID would defeat the purpose.
 */

import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

/** Header used to accept and emit correlation IDs at the HTTP boundary. */
export const CORRELATION_HEADER = 'x-correlation-id';

/**
 * A correlation ID is a UUIDv4. Inbound values are validated against this before being trusted:
 * the header is attacker-controlled, and an unvalidated value flows straight into log files.
 * Accepting arbitrary text would permit log injection (newlines, control characters, forged entries).
 */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function newCorrelationId(): string {
  return randomUUID();
}

export function isValidCorrelationId(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4.test(value);
}

/**
 * Accept a caller-supplied correlation ID only if it is a well-formed UUIDv4.
 * Anything else is discarded and replaced - never sanitised and reused, never echoed back.
 */
export function acceptInboundCorrelationId(headerValue: unknown): string {
  return isValidCorrelationId(headerValue) ? headerValue : newCorrelationId();
}

export interface RequestContext {
  readonly correlationId: string;
  /** Present once the request is attributed to a tenant. Absent for guest and pre-auth requests. */
  readonly tenantId?: string;
  readonly userId?: string;
  /** Guest session ID for anonymous flows (gap-spec section 5.2). */
  readonly guestSessionId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Run `fn` with `context` available to everything it awaits, without threading it through signatures. */
export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * The current correlation ID, or a fresh one if called outside a request scope.
 *
 * Never throws. A logging call that throws because context is missing would turn a diagnostic path
 * into a failure path, which is the opposite of what observability is for.
 */
export function currentCorrelationId(): string {
  return storage.getStore()?.correlationId ?? newCorrelationId();
}
