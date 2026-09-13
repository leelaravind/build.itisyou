import { describe, expect, it } from 'vitest';
import { approvalFromRecord, type ApprovalRecord } from '../src/approval.ts';
import { evaluateTransition } from '../src/lifecycle.ts';

/**
 * A stored approval, read back, must move the lifecycle.
 *
 * The transition action passed a literal `[]` for approvals long after the approvals table existed,
 * so `PLANNED → APPROVED` was refused for every project however many approvals it had. These tests
 * pin the seam that replaced it: a row as the database returns it, through `approvalFromRecord`,
 * into the same `evaluateTransition` the action calls.
 */

const STORED: ApprovalRecord = {
  id: 'a-1',
  projectId: 'p-1',
  subjectType: 'BASELINE',
  subjectId: 'p-1',
  subjectVersion: 4,
  requestedBy: 'guest-session-1',
  requestedAt: new Date('2026-09-13T09:00:00Z'),
  approverRole: 'PROJECT_OWNER',
  state: 'APPROVED',
  approverUser: 'guest-session-1',
  decidedAt: new Date('2026-09-13T09:05:00Z'),
  comment: 'Scope and budget agreed with the practice manager.',
};

function approveBaseline(record: ApprovalRecord, subjectVersion: number) {
  const approval = approvalFromRecord(record);
  return evaluateTransition('PLANNED', 'APPROVED', {
    gates: [],
    approvals: approval === undefined ? [] : [approval],
    subjectVersion,
  });
}

describe('approvalFromRecord', () => {
  it('carries every field the lifecycle reads', () => {
    expect(approvalFromRecord(STORED)).toMatchObject({
      id: 'a-1',
      subjectType: 'BASELINE',
      subjectVersion: 4,
      state: 'APPROVED',
      decidedAt: '2026-09-13T09:05:00.000Z',
      comment: 'Scope and budget agreed with the practice manager.',
    });
  });

  it('omits the decision fields of an undecided approval rather than inventing them', () => {
    const pending = approvalFromRecord({
      ...STORED,
      state: 'REQUESTED',
      approverUser: null,
      decidedAt: null,
      comment: null,
    });
    expect(pending).toBeDefined();
    expect(pending).not.toHaveProperty('decidedAt');
    expect(pending).not.toHaveProperty('approverUser');
    expect(pending).not.toHaveProperty('comment');
  });

  it('refuses a subject this build does not know', () => {
    expect(approvalFromRecord({ ...STORED, subjectType: 'VIBES' })).toBeUndefined();
  });

  it('refuses a state this build does not know', () => {
    expect(approvalFromRecord({ ...STORED, state: 'MAYBE' })).toBeUndefined();
  });
});

describe('a stored approval moving the lifecycle', () => {
  it('lets PLANNED advance to APPROVED when the baseline was approved at this version', () => {
    const verdict = approveBaseline(STORED, 4);
    expect(verdict.allowed).toBe(true);
  });

  it('refuses when the project changed after the approval', () => {
    const verdict = approveBaseline(STORED, 5);
    expect(verdict).toMatchObject({ allowed: false, refusal: 'APPROVAL_STALE' });
  });

  it('refuses when the only approval was rejected', () => {
    const verdict = approveBaseline({ ...STORED, state: 'REJECTED' }, 4);
    expect(verdict).toMatchObject({ allowed: false, refusal: 'APPROVAL_MISSING' });
  });

  it('refuses when the only approval was merely requested', () => {
    const verdict = approveBaseline({ ...STORED, state: 'REQUESTED', decidedAt: null }, 4);
    expect(verdict).toMatchObject({ allowed: false, refusal: 'APPROVAL_MISSING' });
  });

  it('refuses when the approval is for a different subject', () => {
    const verdict = approveBaseline({ ...STORED, subjectType: 'CHANGE_REQUEST' }, 4);
    expect(verdict).toMatchObject({ allowed: false, refusal: 'APPROVAL_MISSING' });
  });

  it('refuses when the stored row cannot be interpreted, rather than trusting it', () => {
    const verdict = approveBaseline({ ...STORED, subjectType: 'BASELINE ' }, 4);
    expect(verdict).toMatchObject({ allowed: false, refusal: 'APPROVAL_MISSING' });
  });
});
