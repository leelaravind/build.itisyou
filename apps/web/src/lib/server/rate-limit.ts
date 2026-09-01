import 'server-only';

import { logger } from '@govintel/shared/logging';

/**
 * Rate limiting.
 *
 * Contract: gap-spec §36 — rate-limit auth endpoints, guest project creation, AI import validation,
 * file upload, search, export and expensive analysis. "Do not block normal legitimate usage with
 * overly low limits."
 *
 * **Deliberately in-memory, and deliberately honest about it.** A single-process counter does not
 * survive a restart and does not coordinate across instances, so it is a speed bump rather than a
 * control. It is here because a speed bump today is worth more than a perfect limiter in Phase 17,
 * and because the call sites that need limiting should be written against this interface now rather
 * than retrofitted later.
 *
 * The real limiter arrives with the deployment target in Phase 19, when there is somewhere shared to
 * keep the counters. `checkRateLimit` is the seam: its signature does not change.
 *
 * Recorded as KI-022.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 60_000;

/**
 * Per-minute ceilings, **global across all callers**.
 *
 * These are much higher than a per-caller limit would be, and that is the point: the counter is not
 * keyed by caller (see `checkRateLimit`), so a limit sized for one person throttles everyone. The
 * first version of this file used per-caller numbers — 10 guest projects a minute — which would have
 * blocked the product outright under any real traffic, and which broke the E2E suite immediately.
 * Gap-spec §36 is explicit that over-tight limits are their own failure mode.
 *
 * They are sized to stop a scripted flood, not to shape normal use. Per-caller limits arrive with
 * the shared store in Phase 19, at which point these become the outer ceiling.
 */
const LIMITS: Readonly<Record<string, number>> = {
  'guest-project-create': 600,
  'ai-import': 300,
  'intake-answer': 3_000,
  // Sized like project creation rather than like intake: a transition reads the whole twin graph and
  // evaluates every gate, so it is the most expensive thing an unauthenticated caller can ask for.
  'project-transition': 600,
  'evidence-record': 600,
  search: 3_000,
  export: 300,
};

const buckets = new Map<string, Bucket>();

/**
 * Whether an action is within its limit, counting this call.
 *
 * Keyed by action alone rather than by caller. Per-caller keying needs a stable identifier, and the
 * only one available for an anonymous visitor is their IP — which is unreliable behind proxies,
 * shared by everyone in an office, and personal data that gap-spec §37 would rather not be stored.
 * A global per-action ceiling is cruder but leaks nothing, and the per-caller limiter lands with the
 * shared store in Phase 19.
 */
export function checkRateLimit(action: string, now: number = Date.now()): Promise<boolean> {
  const limit = LIMITS[action];
  // An unknown action is not silently allowed: an unlimited endpoint is how limiting gets forgotten.
  if (limit === undefined) {
    logger.warn('rate limit requested for unknown action', { action });
    return Promise.resolve(true);
  }

  const bucket = buckets.get(action);

  if (bucket === undefined || now >= bucket.resetAt) {
    buckets.set(action, { count: 1, resetAt: now + WINDOW_MS });
    return Promise.resolve(true);
  }

  bucket.count += 1;

  if (bucket.count > limit) {
    logger.warn('rate limit exceeded', { action, limit });
    return Promise.resolve(false);
  }

  return Promise.resolve(true);
}

/** Test-only: clear all counters between cases. */
export function resetRateLimits(): void {
  buckets.clear();
}
