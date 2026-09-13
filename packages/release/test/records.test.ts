import { describe, expect, it } from 'vitest';
import { PRODUCTION_CHECKS } from '../src/deployment.ts';
import { plansFrom, productionChecksFrom, type EvidenceRecord } from '../src/records.ts';

/**
 * Recorded evidence into release inputs. The release page used to pass empty lists here, so no amount
 * of recorded evidence could move the Production Verification gate.
 */

function evidence(overrides: Partial<EvidenceRecord>): EvidenceRecord {
  return {
    id: 'e-1',
    purpose: 'production-availability',
    type: 'MANUAL_ATTESTATION',
    state: 'CURRENT',
    collectedBy: 'guest-1',
    collectedAt: new Date('2026-09-13T10:00:00Z'),
    ...overrides,
  };
}

describe('production checks from evidence', () => {
  it('reports every check, and every one NOT_CHECKED when nothing is recorded', () => {
    const checks = productionChecksFrom([], PRODUCTION_CHECKS);
    expect(checks).toHaveLength(PRODUCTION_CHECKS.length);
    expect(new Set(checks.map((c) => c.result))).toEqual(new Set(['NOT_CHECKED']));
  });

  it('passes a check only when current evidence for it exists, and cites that evidence', () => {
    const [availability] = productionChecksFrom([evidence({ id: 'avail-1' })], ['AVAILABILITY']);
    expect(availability).toMatchObject({
      check: 'AVAILABILITY',
      result: 'PASSED',
      checkedBy: 'guest-1',
      evidence: ['avail-1'],
    });
  });

  it('does not count superseded or quarantined evidence', () => {
    const checks = productionChecksFrom(
      [evidence({ state: 'SUPERSEDED' }), evidence({ id: 'e-2', state: 'QUARANTINED' })],
      ['AVAILABILITY'],
    );
    expect(checks[0]?.result).toBe('NOT_CHECKED');
  });

  it('does not let evidence for one check satisfy another', () => {
    const [tls] = productionChecksFrom([evidence({ purpose: 'production-availability' })], ['TLS']);
    expect(tls?.result).toBe('NOT_CHECKED');
  });

  it('leaves checks the product cannot record as NOT_CHECKED, whatever is recorded', () => {
    const everything = [
      'production-availability',
      'production-tls',
      'production-headers',
      'production-journeys',
      'production-logging',
      'monitoring',
      'backup-restore',
    ].map((purpose, i) => evidence({ id: `e-${String(i)}`, purpose }));

    const checks = productionChecksFrom(everything, PRODUCTION_CHECKS);
    const unrecordable = checks.filter((c) =>
      ['AUTHENTICATION', 'APIS', 'DEPLOYMENT_IDENTITY'].includes(c.check),
    );
    expect(unrecordable.map((c) => c.result)).toEqual([
      'NOT_CHECKED',
      'NOT_CHECKED',
      'NOT_CHECKED',
    ]);
    expect(checks.filter((c) => c.result === 'PASSED')).toHaveLength(7);
  });

  it('dates a check by its most recent evidence', () => {
    const [check] = productionChecksFrom(
      [
        evidence({ id: 'old', collectedAt: new Date('2026-09-01T00:00:00Z') }),
        evidence({ id: 'new', collectedAt: new Date('2026-09-12T00:00:00Z') }),
      ],
      ['AVAILABILITY'],
    );
    expect(check?.checkedAt).toBe('2026-09-12T00:00:00.000Z');
    expect(check?.evidence).toEqual(['old', 'new']);
  });
});

describe('plans from evidence', () => {
  it('records a plan as written, not rehearsed, from a document', () => {
    const plans = plansFrom([evidence({ purpose: 'rollback-plan', type: 'DOCUMENT' })]);
    expect(plans).toEqual([{ kind: 'ROLLBACK', documentId: 'e-1', rehearsed: false }]);
  });

  it('records a plan as rehearsed only from a test report or a deployment record', () => {
    const plans = plansFrom([
      evidence({ id: 'doc', purpose: 'rollback-plan', type: 'DOCUMENT' }),
      evidence({ id: 'run', purpose: 'rollback-plan', type: 'DEPLOYMENT_RECORD' }),
    ]);
    expect(plans.find((p) => p.kind === 'ROLLBACK')?.rehearsed).toBe(true);
  });

  it('never counts an attestation as a rehearsal', () => {
    const plans = plansFrom([evidence({ purpose: 'migration-plan', type: 'MANUAL_ATTESTATION' })]);
    expect(plans).toEqual([{ kind: 'MIGRATION', documentId: 'e-1', rehearsed: false }]);
  });

  it('omits a plan with no current evidence, so the gate reports it missing', () => {
    expect(plansFrom([evidence({ purpose: 'rollback-plan', state: 'SUPERSEDED' })])).toEqual([]);
  });
});
