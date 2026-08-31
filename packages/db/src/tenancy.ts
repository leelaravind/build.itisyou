/**
 * Tenant isolation.
 *
 * Contract: MASTER_IMPLEMENTATION_PLAN.md §3.2 (tenant filtering enforced in the application layer
 * as well as by row-level security), §18 (strict tenant isolation, object-level authorisation),
 * gap-spec §7.5 (every tenant-owned query must require tenant context).
 *
 * Cross-tenant disclosure is the highest-severity failure this system can produce, so the defence
 * is layered and each layer is designed to fail closed:
 *
 * 1. **Tenant context is a required argument, not an ambient hope.** `scoped()` cannot be called
 *    without an organisation id — a forgotten filter is a type error, not a silent leak.
 * 2. **Fetched rows are re-checked.** `assertBelongsTo` verifies the row that came back really does
 *    belong to the caller's tenant. Redundant when the query was written correctly, which is exactly
 *    the point: it catches the case where it was not.
 * 3. **Row-level security backs both.** Defined in the migration, so a query that bypasses this
 *    module entirely still returns nothing.
 *
 * A breach is reported as `TENANT_ISOLATION`, which maps to **404, not 403**. A 403 would confirm
 * the resource exists and belongs to someone else — and existence is itself tenant data.
 */

import { and, eq, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { AppError } from '@govintel/shared/errors';

/**
 * Proof that a caller is acting within one organisation.
 *
 * Constructed only by the authorisation layer after membership has been established. Passing it
 * explicitly is what makes "which tenant is this query for?" impossible to leave unanswered.
 */
export interface TenantScope {
  readonly organizationId: string;
  /** Absent for guest sessions and system jobs. */
  readonly userId?: string;
  readonly correlationId?: string;
}

/** Anything owned by a tenant. Every such table carries this column. */
interface TenantOwned {
  readonly organizationId: string;
}

/**
 * A Drizzle table whose columns include the tenant key.
 *
 * Typed as `PgColumn` rather than something cleverer: the goal is only to make `scoped()` refuse a
 * table that has no `organizationId`, and a more elaborate constraint fought the inference without
 * adding safety.
 */
interface TenantScopedTable {
  readonly organizationId: PgColumn;
}

export function createTenantScope(
  organizationId: string,
  options: { userId?: string; correlationId?: string } = {},
): TenantScope {
  if (organizationId.length === 0) {
    // An empty tenant id would produce `where organization_id = ''`, which silently matches nothing
    // — or, if a bug ever made the predicate optional, everything. Refuse it at construction.
    throw new AppError({
      code: 'TENANT_SCOPE_INVALID',
      category: 'INTERNAL',
      safeMessage: 'Something went wrong.',
      details: { reason: 'empty organizationId' },
    });
  }

  return {
    organizationId,
    ...(options.userId === undefined ? {} : { userId: options.userId }),
    ...(options.correlationId === undefined ? {} : { correlationId: options.correlationId }),
  };
}

/**
 * Combine the tenant predicate with any additional conditions.
 *
 * Always call this rather than writing `eq(table.organizationId, ...)` by hand — the point is that
 * the tenant predicate is added by a mechanism rather than remembered by a person.
 */
export function scoped(
  table: TenantScopedTable,
  scope: TenantScope,
  ...conditions: (SQL | undefined)[]
): SQL {
  const tenantPredicate = eq(table.organizationId, scope.organizationId);
  const extra = conditions.filter((c): c is SQL => c !== undefined);
  if (extra.length === 0) return tenantPredicate;

  const combined = and(tenantPredicate, ...extra);
  // `and()` is only undefined when given no arguments, which cannot happen here - but returning the
  // bare tenant predicate is the safe fallback either way.
  return combined ?? tenantPredicate;
}

/**
 * Verify a fetched row belongs to the caller's tenant.
 *
 * Deliberately redundant with the query predicate. Defence in depth is only depth if the second
 * layer assumes the first may have failed — a raw query, a hand-written join, a future refactor
 * that drops a `where` clause.
 *
 * Throws `TENANT_ISOLATION`, which surfaces as 404 so probing reveals nothing.
 */
export function assertBelongsTo<T extends TenantOwned>(
  row: T | undefined | null,
  scope: TenantScope,
  entityType: string,
): T {
  if (row === null || row === undefined) {
    throw new AppError({
      code: 'ENTITY_NOT_FOUND',
      category: 'NOT_FOUND',
      safeMessage: 'Not found.',
      details: { entityType },
      ...(scope.correlationId === undefined ? {} : { correlationId: scope.correlationId }),
    });
  }

  if (row.organizationId !== scope.organizationId) {
    throw new AppError({
      code: 'CROSS_TENANT_ACCESS',
      category: 'TENANT_ISOLATION',
      // Identical wording to a genuine miss. A different message would let an attacker distinguish
      // "does not exist" from "exists, owned by someone else" — which is the disclosure itself.
      safeMessage: 'Not found.',
      details: {
        entityType,
        requestedBy: scope.organizationId,
        // The owning tenant is diagnostic only. It is redacted before logging and never sent on the
        // wire (AppError.toWireFormat omits details entirely).
        ownedBy: row.organizationId,
        userId: scope.userId,
      },
      ...(scope.correlationId === undefined ? {} : { correlationId: scope.correlationId }),
    });
  }

  return row;
}

/**
 * Filter a result set to the caller's tenant, and report if anything had to be removed.
 *
 * A non-empty `removed` means a query returned rows from another tenant — a genuine isolation
 * failure that must be alerted on even though nothing leaked to the user. Silent filtering would
 * hide the bug and let it persist until a code path without this guard hit the same query.
 */
export function filterToTenant<T extends TenantOwned>(
  rows: readonly T[],
  scope: TenantScope,
): { readonly kept: readonly T[]; readonly removed: readonly T[] } {
  const kept: T[] = [];
  const removed: T[] = [];

  for (const row of rows) {
    if (row.organizationId === scope.organizationId) kept.push(row);
    else removed.push(row);
  }

  return { kept, removed };
}

/**
 * Ownership of a guest project.
 *
 * Guest projects have no organisation, so tenant scoping does not apply — ownership is the session
 * id instead. Kept separate rather than folded into `assertBelongsTo` so the two cannot be confused:
 * a guest project must never be reachable via an organisation scope, and vice versa.
 */
export function assertGuestOwns<T extends GuestOwned>(
  row: T | undefined | null,
  guestSessionId: string,
  entityType: string,
): T {
  const missing = row === null || row === undefined;

  if (missing || row.guestSessionId !== guestSessionId) {
    // Same 404 shape as above: a guest probing ids learns nothing about what exists.
    throw new AppError({
      code: missing ? 'ENTITY_NOT_FOUND' : 'CROSS_SESSION_ACCESS',
      category: missing ? 'NOT_FOUND' : 'TENANT_ISOLATION',
      safeMessage: 'Not found.',
      details: { entityType },
    });
  }

  return row;
}

/** Anything owned by an anonymous guest session rather than a tenant. */
interface GuestOwned {
  readonly guestSessionId: string | null;
}

export type { TenantScopedTable, TenantOwned, GuestOwned };
