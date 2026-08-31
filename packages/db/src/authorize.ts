/**
 * Authorisation middleware.
 *
 * Contract: plan §18 (server-side authorisation, object-level authorisation, least privilege),
 * §83 (authorisation must remain deterministic), gap-spec §7.5 (tenant context required on every
 * tenant-owned query), §5.1 (guest capabilities).
 *
 * This is the single place a request becomes an authorised, tenant-scoped context. Everything
 * downstream receives a `RequestPrincipal` and never re-derives permissions from raw session data.
 *
 * The ordering below is not incidental — each step exists because skipping it is a known
 * vulnerability class:
 *
 * 1. **Authenticate** — who is this? (401 if unknown)
 * 2. **Establish tenant** — which organisation is this request for, and are they a member? (404)
 * 3. **Object-level check** — does the specific object belong to that tenant? (404)
 * 4. **Permission check** — may this role perform this action? (403)
 *
 * Steps 2 and 3 are separate on purpose. Checking permission without checking object ownership is
 * OWASP's Broken Object Level Authorisation: an ENGINEER on project A holds `requirements:edit`, and
 * a handler that checks only the permission will happily let them edit project B's requirements.
 * Gap-spec §65 requires an attack suite for exactly this.
 *
 * Tenant failures answer **404**, permission failures answer **403**. A 403 on a cross-tenant object
 * would confirm it exists, and existence is tenant data.
 */

import { AppError } from '@govintel/shared/errors';
import type { Database } from './client.ts';
import { organizationRoleFor, projectRoleFor } from './identity.ts';
import { can, guestCan, type Permission } from './rbac.ts';
import { createTenantScope, type TenantScope } from './tenancy.ts';
import type { OrganizationRole, ProjectRole } from './schema.ts';

/** An authenticated user acting within one organisation. */
export interface UserPrincipal {
  readonly kind: 'user';
  readonly userId: string;
  readonly organizationId: string;
  readonly organizationRole: OrganizationRole;
  /** Present only when the request targets a project the user is a member of. */
  readonly projectRole?: ProjectRole;
  readonly scope: TenantScope;
  readonly correlationId?: string;
}

/**
 * An anonymous visitor acting on their own unsaved project.
 *
 * Deliberately a separate shape rather than a user with a special role. A guest has no organisation,
 * so `TenantScope` does not apply to them at all — and a union type forces every call site to handle
 * that difference explicitly instead of discovering it through a null check.
 */
export interface GuestPrincipal {
  readonly kind: 'guest';
  readonly guestSessionId: string;
  readonly correlationId?: string;
}

export type RequestPrincipal = UserPrincipal | GuestPrincipal;

export function isGuest(principal: RequestPrincipal): principal is GuestPrincipal {
  return principal.kind === 'guest';
}

export function isUser(principal: RequestPrincipal): principal is UserPrincipal {
  return principal.kind === 'user';
}

/* -------------------------------------------------------------------------- */
/* Building a principal                                                       */
/* -------------------------------------------------------------------------- */

export interface BuildPrincipalInput {
  readonly userId: string;
  readonly organizationId: string;
  /** Supplied when the request targets a specific project, so the project role is resolved too. */
  readonly projectId?: string;
  readonly correlationId?: string;
}

/**
 * Resolve a request into an authorised principal.
 *
 * Membership is read from the database on every request rather than trusted from a session claim.
 * A role baked into a token stays valid until the token expires, which means a revoked admin keeps
 * admin rights for the remainder of their session — the gap between "access revoked" and "access
 * actually gone" is exactly when revocation matters most.
 *
 * Non-membership answers **404**, not 403: a 403 would confirm the organisation exists.
 */
export async function buildUserPrincipal(
  db: Database,
  input: BuildPrincipalInput,
): Promise<UserPrincipal> {
  const organizationRole = await organizationRoleFor(db, input.userId, input.organizationId);

  if (organizationRole === undefined) {
    throw new AppError({
      code: 'NOT_A_MEMBER',
      category: 'TENANT_ISOLATION',
      safeMessage: 'Not found.',
      details: { userId: input.userId, organizationId: input.organizationId },
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    });
  }

  const projectRole =
    input.projectId === undefined
      ? undefined
      : await projectRoleFor(db, input.userId, input.projectId, input.organizationId);

  return {
    kind: 'user',
    userId: input.userId,
    organizationId: input.organizationId,
    organizationRole,
    ...(projectRole === undefined ? {} : { projectRole }),
    scope: createTenantScope(input.organizationId, {
      userId: input.userId,
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    }),
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
  };
}

export function buildGuestPrincipal(
  guestSessionId: string,
  correlationId?: string,
): GuestPrincipal {
  if (guestSessionId.trim().length === 0) {
    throw new AppError({
      code: 'GUEST_SESSION_INVALID',
      category: 'AUTHENTICATION',
      safeMessage: 'Your session has expired. Please start again.',
    });
  }

  return {
    kind: 'guest',
    guestSessionId,
    ...(correlationId === undefined ? {} : { correlationId }),
  };
}

/* -------------------------------------------------------------------------- */
/* Permission checks                                                          */
/* -------------------------------------------------------------------------- */

/** Whether the principal holds the permission. Pure; performs no object-level check. */
export function principalCan(principal: RequestPrincipal, permission: Permission): boolean {
  if (isGuest(principal)) return guestCan(permission);

  return can(
    {
      organizationRole: principal.organizationRole,
      ...(principal.projectRole === undefined ? {} : { projectRole: principal.projectRole }),
    },
    permission,
  );
}

/**
 * Require a permission, throwing `AUTHORIZATION` (403) if absent.
 *
 * Only ever called *after* tenant and object ownership are established. Calling it first would leak
 * existence: a 403 tells the caller the object is real.
 */
export function requirePermission(principal: RequestPrincipal, permission: Permission): void {
  if (principalCan(principal, permission)) return;

  throw new AppError({
    code: 'PERMISSION_DENIED',
    category: 'AUTHORIZATION',
    safeMessage: 'You do not have permission to do that.',
    details: {
      permission,
      ...(isGuest(principal)
        ? { principal: 'guest' }
        : {
            userId: principal.userId,
            organizationRole: principal.organizationRole,
            projectRole: principal.projectRole,
          }),
    },
    ...(principal.correlationId === undefined ? {} : { correlationId: principal.correlationId }),
  });
}

/**
 * Require that a principal is an authenticated user, not a guest.
 *
 * For actions with no meaningful guest equivalent — anything touching an organisation, another
 * user, or durable state. Answers 401 rather than 403: the fix is to sign in, and telling the user
 * that is more useful than a flat refusal.
 */
export function requireUser(principal: RequestPrincipal): UserPrincipal {
  if (isUser(principal)) return principal;

  throw new AppError({
    code: 'AUTHENTICATION_REQUIRED',
    category: 'AUTHENTICATION',
    safeMessage: 'Please sign in to continue.',
    ...(principal.correlationId === undefined ? {} : { correlationId: principal.correlationId }),
  });
}

/**
 * The combined check every handler touching a tenant-owned object should use.
 *
 * Enforces the ordering: the object's tenant is checked before the permission, so a caller probing
 * another tenant's ids receives 404 regardless of what permissions they hold. Performing these in
 * the other order is Broken Object Level Authorisation, which is why they are bound together here
 * rather than left as two calls a handler might get wrong.
 */
export function authorizeObject<T extends { organizationId: string }>(
  principal: RequestPrincipal,
  object: T | undefined | null,
  permission: Permission,
  entityType: string,
): T {
  const user = requireUser(principal);

  if (object === null || object === undefined) {
    throw new AppError({
      code: 'ENTITY_NOT_FOUND',
      category: 'NOT_FOUND',
      safeMessage: 'Not found.',
      details: { entityType },
      ...(user.correlationId === undefined ? {} : { correlationId: user.correlationId }),
    });
  }

  if (object.organizationId !== user.organizationId) {
    throw new AppError({
      code: 'CROSS_TENANT_ACCESS',
      category: 'TENANT_ISOLATION',
      // Identical to the not-found response above, deliberately.
      safeMessage: 'Not found.',
      details: {
        entityType,
        requestedBy: user.organizationId,
        ownedBy: object.organizationId,
        userId: user.userId,
      },
      ...(user.correlationId === undefined ? {} : { correlationId: user.correlationId }),
    });
  }

  requirePermission(user, permission);

  return object;
}

/**
 * Authorise a guest acting on their own project.
 *
 * Session ownership is checked before the permission, for the same reason as `authorizeObject`:
 * a guest probing project ids must not be able to tell which exist.
 */
export function authorizeGuestObject<T extends { guestSessionId: string | null }>(
  principal: RequestPrincipal,
  object: T | undefined | null,
  permission: Permission,
  entityType: string,
): T {
  if (!isGuest(principal)) {
    throw new AppError({
      code: 'GUEST_PRINCIPAL_REQUIRED',
      category: 'AUTHORIZATION',
      safeMessage: 'You do not have permission to do that.',
      details: { entityType },
    });
  }

  if (object?.guestSessionId !== principal.guestSessionId) {
    const missing = object === null || object === undefined;
    throw new AppError({
      code: missing ? 'ENTITY_NOT_FOUND' : 'CROSS_SESSION_ACCESS',
      category: missing ? 'NOT_FOUND' : 'TENANT_ISOLATION',
      safeMessage: 'Not found.',
      details: { entityType },
      ...(principal.correlationId === undefined ? {} : { correlationId: principal.correlationId }),
    });
  }

  requirePermission(principal, permission);

  return object;
}
