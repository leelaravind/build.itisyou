/**
 * Release inputs from what the product has actually recorded.
 *
 * The release page evaluated readiness and production verification over literal empty lists — no
 * plans, no production checks, no approvals — so the gates could describe what a release needed but
 * never register that any of it had happened, however much evidence the project held. The evidence
 * *was* recordable: the gate catalogue asks for `production-availability`, `rollback-plan` and the
 * rest as MANUAL criteria, and the evidence page records them. Nothing carried them across.
 *
 * This is that carriage, and it is deliberately literal:
 *
 * - A production check is PASSED only when current evidence for it exists, and it cites that
 *   evidence. There is no FAILED from evidence, because recording evidence is attesting a pass; a
 *   check with nothing recorded stays NOT_CHECKED, which the engine refuses to treat as a pass.
 * - Checks with no catalogue purpose (AUTHENTICATION, APIS, DEPLOYMENT_IDENTITY) cannot be recorded
 *   through the product yet, so they are always NOT_CHECKED — named, not omitted.
 * - A plan is *written* when its evidence exists and *rehearsed* only when that evidence shows it was
 *   exercised: a test report or a deployment record, never a document or an attestation.
 */

import type {
  PlanKind,
  ProductionCheck,
  ProductionCheckRecord,
  ReleasePlan,
} from './deployment.ts';

/** The recorded evidence this reads: the `evidence` table's columns, structurally. */
export interface EvidenceRecord {
  readonly id: string;
  readonly purpose: string;
  readonly type: string;
  readonly state: string;
  readonly collectedBy: string;
  readonly collectedAt: Date;
}

/** Which gate-catalogue purpose attests which production check. */
export const CHECK_PURPOSES: Readonly<Partial<Record<ProductionCheck, string>>> = {
  AVAILABILITY: 'production-availability',
  TLS: 'production-tls',
  SECURITY_HEADERS: 'production-headers',
  CRITICAL_JOURNEYS: 'production-journeys',
  LOGGING: 'production-logging',
  MONITORING: 'monitoring',
  BACKUP_RESTORE: 'backup-restore',
};

/** Which purpose is the written form of which plan. */
export const PLAN_PURPOSES: Readonly<Partial<Record<PlanKind, string>>> = {
  ROLLBACK: 'rollback-plan',
  MIGRATION: 'migration-plan',
  MONITORING: 'monitoring',
  BACKUP: 'backup-restore',
};

/** Evidence types that show a plan was run, not only written. */
const EXERCISED: ReadonlySet<string> = new Set(['TEST_REPORT', 'DEPLOYMENT_RECORD']);

export function productionChecksFrom(
  evidence: readonly EvidenceRecord[],
  checks: readonly ProductionCheck[],
): ProductionCheckRecord[] {
  const current = evidence.filter((row) => row.state === 'CURRENT');

  return checks.map((check) => {
    const purpose = CHECK_PURPOSES[check];
    const rows = purpose === undefined ? [] : current.filter((row) => row.purpose === purpose);
    const latest = [...rows].sort((a, b) => b.collectedAt.getTime() - a.collectedAt.getTime())[0];

    if (latest === undefined) return { check, result: 'NOT_CHECKED', evidence: [] };

    return {
      check,
      result: 'PASSED',
      checkedBy: latest.collectedBy,
      checkedAt: latest.collectedAt.toISOString(),
      evidence: rows.map((row) => row.id),
    };
  });
}

export function plansFrom(evidence: readonly EvidenceRecord[]): ReleasePlan[] {
  const current = evidence.filter((row) => row.state === 'CURRENT');
  const plans: ReleasePlan[] = [];

  for (const [kind, purpose] of Object.entries(PLAN_PURPOSES) as [PlanKind, string][]) {
    const rows = current.filter((row) => row.purpose === purpose);
    const first = rows[0];
    if (first === undefined) continue;
    plans.push({
      kind,
      documentId: first.id,
      rehearsed: rows.some((row) => EXERCISED.has(row.type)),
    });
  }

  return plans;
}
