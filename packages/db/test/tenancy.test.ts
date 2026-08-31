/**
 * Tenant isolation tests.
 *
 * Contract: plan §32.8 requires at least 50 authorisation and tenant-isolation tests attempting
 * cross-organisation access through direct object IDs, lists, search, exports, evidence downloads,
 * jobs, notifications and audit endpoints — with the expected result being **no cross-tenant data
 * disclosure**. Gap-spec §7.5 says the same.
 *
 * These cover the guard layer. The database-level suite (row-level security, real queries against
 * PGlite) follows in the same phase; both are required, because either alone leaves a path open.
 */

import { describe, it, expect } from 'vitest';
import { AppError, isAppError } from '@govintel/shared/errors';
import {
  assertBelongsTo,
  assertGuestOwns,
  createTenantScope,
  filterToTenant,
} from '../src/tenancy.ts';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

const scopeA = createTenantScope(ORG_A, { userId: 'user-a' });
const scopeB = createTenantScope(ORG_B, { userId: 'user-b' });

const rowInA = { id: 'row-1', organizationId: ORG_A, name: 'Org A project' };
const rowInB = { id: 'row-2', organizationId: ORG_B, name: 'Org B project' };

function expectAppError(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error) {
    if (isAppError(error)) return error;
    throw new Error(`expected AppError, got ${String(error)}`, { cause: error });
  }
  throw new Error('expected a throw, but the call succeeded');
}

describe('scope construction', () => {
  it('builds a scope from a valid organisation id', () => {
    expect(createTenantScope(ORG_A).organizationId).toBe(ORG_A);
  });

  it('refuses an empty organisation id', () => {
    // An empty tenant id produces a predicate that matches nothing — or, if the predicate ever
    // became optional through a bug, everything.
    expect(() => createTenantScope('')).toThrow(AppError);
  });

  it('carries the user and correlation id for audit attribution', () => {
    const scope = createTenantScope(ORG_A, { userId: 'u1', correlationId: 'c1' });
    expect(scope.userId).toBe('u1');
    expect(scope.correlationId).toBe('c1');
  });

  it('omits absent optional fields rather than setting them undefined', () => {
    expect('userId' in createTenantScope(ORG_A)).toBe(false);
  });
});

describe('direct object access by ID', () => {
  it('returns a row that belongs to the caller', () => {
    expect(assertBelongsTo(rowInA, scopeA, 'project')).toBe(rowInA);
  });

  it('refuses a row belonging to another organisation', () => {
    // The canonical attack: caller guesses or scrapes an ID from another tenant.
    const error = expectAppError(() => assertBelongsTo(rowInB, scopeA, 'project'));
    expect(error.category).toBe('TENANT_ISOLATION');
    expect(error.code).toBe('CROSS_TENANT_ACCESS');
  });

  it('answers 404 rather than 403 for a cross-tenant hit', () => {
    // A 403 confirms the resource exists and belongs to someone else. Existence is tenant data.
    const error = expectAppError(() => assertBelongsTo(rowInB, scopeA, 'project'));
    expect(error.httpStatus).toBe(404);
  });

  it('gives a cross-tenant hit the identical message to a genuine miss', () => {
    // If the two differed, an attacker could enumerate which IDs exist in other tenants.
    const missing = expectAppError(() => assertBelongsTo(undefined, scopeA, 'project'));
    const crossTenant = expectAppError(() => assertBelongsTo(rowInB, scopeA, 'project'));

    expect(crossTenant.safeMessage).toBe(missing.safeMessage);
    expect(crossTenant.httpStatus).toBe(missing.httpStatus);
  });

  it('leaks nothing about the owning tenant on the wire', () => {
    const error = expectAppError(() => assertBelongsTo(rowInB, scopeA, 'project'));
    const wire = JSON.stringify(error.toWireFormat());

    expect(wire).not.toContain(ORG_B);
    expect(wire).not.toContain('Org B project');
    expect(wire).not.toContain('ownedBy');
  });

  it('flags a cross-tenant attempt as security significant', () => {
    // It must be alertable on its own, separately from ordinary permission misses.
    const error = expectAppError(() => assertBelongsTo(rowInB, scopeA, 'project'));
    expect(error.securitySignificant).toBe(true);
  });

  it('does not mark a cross-tenant attempt retryable', () => {
    const error = expectAppError(() => assertBelongsTo(rowInB, scopeA, 'project'));
    expect(error.retryable).toBe(false);
  });

  it.each([[undefined], [null]])(
    'treats %s as not found rather than throwing a type error',
    (row: null | undefined) => {
      const error = expectAppError(() => assertBelongsTo(row, scopeA, 'project'));
      expect(error.category).toBe('NOT_FOUND');
    },
  );

  it('is symmetric — B cannot reach A either', () => {
    expect(() => assertBelongsTo(rowInA, scopeB, 'project')).toThrow(AppError);
    expect(assertBelongsTo(rowInB, scopeB, 'project')).toBe(rowInB);
  });

  it.each([
    'project',
    'requirement',
    'evidence',
    'budget_item',
    'risk',
    'document',
    'approval',
    'audit_event',
    'notification',
    'job',
    'export',
    'change_request',
    'baseline',
    'integration',
  ])('blocks cross-tenant access to %s', (entityType) => {
    // Gap-spec §7.5 names each of these as an attack surface that must be covered.
    const error = expectAppError(() => assertBelongsTo(rowInB, scopeA, entityType));
    expect(error.category).toBe('TENANT_ISOLATION');
  });
});

describe('list and search results', () => {
  it('keeps only the caller tenant rows', () => {
    const { kept } = filterToTenant([rowInA, rowInB], scopeA);
    expect(kept).toEqual([rowInA]);
  });

  it('reports rows that had to be removed rather than filtering silently', () => {
    // A non-empty `removed` means a query returned another tenant's rows — a real isolation bug.
    // Silent filtering would hide it until some other path hit the same query without this guard.
    const { removed } = filterToTenant([rowInA, rowInB], scopeA);
    expect(removed).toEqual([rowInB]);
  });

  it('removes nothing when the query was correctly scoped', () => {
    const { removed } = filterToTenant([rowInA], scopeA);
    expect(removed).toEqual([]);
  });

  it('handles an empty result set', () => {
    const { kept, removed } = filterToTenant([], scopeA);
    expect(kept).toEqual([]);
    expect(removed).toEqual([]);
  });

  it('removes everything when the whole page belongs to another tenant', () => {
    const { kept, removed } = filterToTenant([rowInB, rowInB], scopeA);
    expect(kept).toEqual([]);
    expect(removed).toHaveLength(2);
  });

  it('does not let a mixed page leak a single foreign row', () => {
    // Pagination bugs classically leak one row at a boundary.
    const page = [rowInA, rowInB, rowInA, rowInB, rowInA];
    const { kept } = filterToTenant(page, scopeA);
    expect(kept.every((r) => r.organizationId === ORG_A)).toBe(true);
    expect(kept).toHaveLength(3);
  });
});

describe('guest session ownership', () => {
  const SESSION_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const SESSION_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const guestProject = { id: 'gp-1', guestSessionId: SESSION_A };

  it('returns a project owned by the session', () => {
    expect(assertGuestOwns(guestProject, SESSION_A, 'project')).toBe(guestProject);
  });

  it('refuses a project owned by another guest session', () => {
    const error = expectAppError(() => assertGuestOwns(guestProject, SESSION_B, 'project'));
    expect(error.category).toBe('TENANT_ISOLATION');
    expect(error.code).toBe('CROSS_SESSION_ACCESS');
  });

  it('answers 404 so a guest cannot enumerate project ids', () => {
    const error = expectAppError(() => assertGuestOwns(guestProject, SESSION_B, 'project'));
    expect(error.httpStatus).toBe(404);
  });

  it('refuses a project with no guest session at all', () => {
    // A saved project must not be reachable through a guest session id.
    const saved = { id: 'p-1', guestSessionId: null };
    expect(() => assertGuestOwns(saved, SESSION_A, 'project')).toThrow(AppError);
  });

  it('treats a missing row as not found', () => {
    const error = expectAppError(() => assertGuestOwns(undefined, SESSION_A, 'project'));
    expect(error.category).toBe('NOT_FOUND');
  });

  it('gives the same answer for wrong-session and non-existent', () => {
    const wrongSession = expectAppError(() => assertGuestOwns(guestProject, SESSION_B, 'project'));
    const missing = expectAppError(() => assertGuestOwns(undefined, SESSION_A, 'project'));
    expect(wrongSession.safeMessage).toBe(missing.safeMessage);
  });

  it('leaks no session identifier on the wire', () => {
    const error = expectAppError(() => assertGuestOwns(guestProject, SESSION_B, 'project'));
    expect(JSON.stringify(error.toWireFormat())).not.toContain(SESSION_A);
  });
});

describe('the two ownership models never substitute for each other', () => {
  it('does not let an organisation scope reach a guest project', () => {
    // A guest project has no organisationId, so a tenant-scoped lookup must not find it.
    const guestProject = { id: 'gp', organizationId: '', guestSessionId: 'sess' };
    expect(() => assertBelongsTo(guestProject, scopeA, 'project')).toThrow(AppError);
  });

  it('does not let a guest session reach an organisation project', () => {
    const owned = { id: 'p', organizationId: ORG_A, guestSessionId: null };
    expect(() => assertGuestOwns(owned, 'any-session', 'project')).toThrow(AppError);
  });
});
