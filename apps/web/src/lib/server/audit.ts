import 'server-only';

import { randomUUID } from 'node:crypto';
import { auditEvents } from '@govintel/db/schema';
import type { AuditCategory } from '@govintel/governance/audit';
import { logger } from '@govintel/shared/logging';
import type { DatabaseHandle } from './database.ts';

/**
 * Writing to the immutable audit log.
 *
 * Contract: plan §20 (immutable audit), gap-spec §40 (audit immutability).
 *
 * ## Why this is new
 *
 * The table has existed since Phase 3, with row-level security, tenant-scoped indexes and a redaction
 * model in `packages/governance/src/audit.ts` that is fully tested. Nothing ever wrote a row. After
 * 3,872 projects on staging, `audit_events` held **zero**.
 *
 * That is worse than having no audit log, because the schema, the indexes and the RLS policy all
 * assert that there is one. A reviewer reading the migration would conclude the system is audited.
 *
 * ## The one rule
 *
 * **An audit event is written in the same transaction as the change it describes.** Not after it, not
 * in a `finally`, not from a queue. A separate write can fail while the change succeeds, and an
 * unaudited change is indistinguishable afterwards from one that never happened — which is precisely
 * the property an audit log exists to deny.
 *
 * So this takes the transaction handle rather than opening its own, and every caller passes the one
 * it is already inside. There is deliberately no convenience overload that opens a connection.
 */

export interface AuditRecord {
  readonly organizationId: string;
  readonly projectId?: string;
  /** Stable verb, past tense: `PROJECT_TRANSITIONED`, `APPROVAL_GRANTED`. Never a sentence. */
  readonly action: string;
  readonly entityType: string;
  readonly entityId?: string;
  readonly category?: AuditCategory;
  /**
   * A safe before/after summary.
   *
   * Redacted by the caller before it arrives. The audit log is retained far longer than most data, so
   * a secret written here is a long-lived exposure — and the redaction model in
   * `packages/governance/src/audit.ts` cannot help once the row is written, because redacting an
   * audit row is itself an audited event rather than an erasure.
   */
  readonly summary?: Record<string, unknown>;
  readonly reason?: string;
  /** The guest session that acted, when there is no user. */
  readonly actorGuestSessionId?: string;
  readonly actorUserId?: string;
  /** Ties this event to the request that caused it. Generated when absent. */
  readonly correlationId?: string;
}

/**
 * Append one event. Must be called inside the transaction carrying the change.
 *
 * Returns the correlation id so a caller writing several events for one action can tie them
 * together — a transition that also invalidates approvals is one story, not three.
 */
export async function recordAudit(db: DatabaseHandle, record: AuditRecord): Promise<string> {
  const correlationId = record.correlationId ?? randomUUID();

  await db.insert(auditEvents).values({
    organizationId: record.organizationId,
    projectId: record.projectId ?? null,
    actorUserId: record.actorUserId ?? null,
    actorGuestSessionId: record.actorGuestSessionId ?? null,
    action: record.action,
    entityType: record.entityType,
    entityId: record.entityId ?? null,
    correlationId,
    summary: record.summary ?? null,
    reason: record.reason ?? null,
  });

  /*
   * Logged as well as stored, and deliberately without the summary.
   *
   * The log line is for operations — "did anything happen" — and the row is the record. Repeating the
   * summary into the log would put the same content in a second place with different retention and
   * weaker access control, which is how a carefully redacted audit trail leaks through its own
   * telemetry.
   */
  logger.info('audit event recorded', {
    action: record.action,
    entityType: record.entityType,
    projectId: record.projectId,
    correlationId,
  });

  return correlationId;
}
