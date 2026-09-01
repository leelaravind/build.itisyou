/**
 * Role-based access control.
 *
 * Contract: IMPLEMENTATION_GAP_CLOSURE_SPEC.md §7.4 requires an explicit permissions matrix covering
 * every sensitive action; plan §18 requires server-side authorisation, object-level authorisation
 * and least privilege; §83 lists authorisation among the things that must remain deterministic.
 *
 * Three properties this module is built to guarantee:
 *
 * 1. **Deny by default.** `can()` returns false for anything not explicitly granted. A permission
 *    added to the enum but forgotten in the matrix is therefore denied, not allowed — the safe
 *    direction for an oversight.
 * 2. **Effective permission is the union of organisation and project grants**, never the maximum of
 *    two independently-evaluated answers. An ADMIN who is only a VIEWER on a project still gets
 *    admin-level project access, because organisation admin *is* a grant over the tenant's projects.
 * 3. **AUDITOR can read everything and write nothing.** Auditors exist so nobody needs a write grant
 *    merely to inspect. Encoded as data, not as a special case in a handler.
 *
 * This file is pure data plus pure functions: no database, no request context. That makes the whole
 * matrix exhaustively testable without fixtures, which is what §7.4 effectively demands.
 */

import type { OrganizationRole, ProjectRole } from './schema.ts';

/**
 * Every sensitive action in the system. Gap-spec §7.4 lists the actions that must be covered;
 * this enumerates them plus the ones the domain adds.
 */
export const PERMISSIONS = [
  // Project lifecycle
  'project:create',
  'project:read',
  'project:edit',
  'project:archive',
  'project:delete',
  'project:export',
  'project:transition_lifecycle',

  // Intake and AI interchange
  'intake:edit',
  'ai_import:create',
  'ai_import:approve',

  // Domain content
  'requirements:read',
  'requirements:edit',
  'architecture:read',
  'architecture:edit',
  'work:read',
  'work:edit',
  'risks:read',
  'risks:edit',

  // Money is its own read permission: commercial data is frequently restricted from engineers.
  'budget:read',
  'budget:edit',

  // Evidence and gates
  'evidence:read',
  'evidence:upload',
  'evidence:delete',

  /*
   * Documents.
   *
   * Added in Phase 17, because Phase 13 built a versioned document system with its own
   * approval and the matrix had no permission covering it — §7.4 requires the matrix to cover
   * every sensitive action, and a document that carries an approval is one. Search surfaced it:
   * there was no permission to check before returning a document in results.
   */
  'documents:read',
  'documents:edit',
  'gate:read',
  'gate:approve',
  'gate:override',
  'exception:request',
  'exception:approve',

  // Governance
  'baseline:create',
  'change_request:create',
  'change_request:approve',
  'approval:decide',
  'deployment:record',

  // Organisation administration
  'members:read',
  'members:manage',
  'integrations:manage',
  'audit:read',
  'organization:manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Read-only permissions. Used to build the AUDITOR grant and to assert the no-write invariant. */
const READ_PERMISSIONS: readonly Permission[] = [
  'project:read',
  'requirements:read',
  'architecture:read',
  'work:read',
  'risks:read',
  'budget:read',
  'evidence:read',
  'documents:read',
  'gate:read',
  'members:read',
  'audit:read',
];

/* -------------------------------------------------------------------------- */
/* Organisation-level grants                                                  */
/* -------------------------------------------------------------------------- */

const ORGANIZATION_GRANTS: Readonly<Record<OrganizationRole, readonly Permission[]>> = {
  /** Full control, including destructive and organisation-level actions. */
  OWNER: [...PERMISSIONS],

  /**
   * Everything except deleting projects and managing the organisation itself.
   * Deletion and ownership transfer stay with OWNER — they are the two actions with no undo.
   */
  ADMIN: PERMISSIONS.filter((p) => p !== 'project:delete' && p !== 'organization:manage'),

  /**
   * A member can create projects and read organisation-level context, but holds no authority over
   * projects they are not a member of. Their real permissions come from project membership.
   */
  MEMBER: ['project:create', 'project:read', 'members:read'],

  /** Read everything, change nothing — the whole point of the role. */
  AUDITOR: [...READ_PERMISSIONS],
};

/* -------------------------------------------------------------------------- */
/* Project-level grants                                                       */
/* -------------------------------------------------------------------------- */

const CONTRIBUTOR_READS: readonly Permission[] = [
  'project:read',
  'requirements:read',
  'architecture:read',
  'work:read',
  'risks:read',
  'evidence:read',
  'documents:read',
  'gate:read',
  'members:read',
];

const PROJECT_GRANTS: Readonly<Record<ProjectRole, readonly Permission[]>> = {
  PROJECT_OWNER: [
    ...CONTRIBUTOR_READS,
    'project:edit',
    'project:archive',
    'project:export',
    'project:transition_lifecycle',
    'intake:edit',
    'ai_import:create',
    'ai_import:approve',
    'requirements:edit',
    'architecture:edit',
    'documents:edit',
    'work:edit',
    'risks:edit',
    'budget:read',
    'budget:edit',
    'evidence:upload',
    'evidence:delete',
    'gate:approve',
    'exception:request',
    'exception:approve',
    'baseline:create',
    'change_request:create',
    'change_request:approve',
    'approval:decide',
    'deployment:record',
    'audit:read',
  ],

  PROJECT_MANAGER: [
    ...CONTRIBUTOR_READS,
    'project:edit',
    'project:export',
    'project:transition_lifecycle',
    'intake:edit',
    'ai_import:create',
    'ai_import:approve',
    'requirements:edit',
    'architecture:edit',
    'documents:edit',
    'work:edit',
    'risks:edit',
    'budget:read',
    'budget:edit',
    'evidence:upload',
    'exception:request',
    'baseline:create',
    'change_request:create',
    'deployment:record',
    'audit:read',
  ],

  /**
   * Builds the thing. Notably **cannot** approve a gate or decide an approval: gap-spec §33 keeps
   * approval separate from task completion, and self-approval defeats the control entirely.
   * Budget is not readable by default — commercial data is commonly restricted from engineers, and
   * an organisation that wants otherwise grants it at organisation level.
   */
  ENGINEER: [
    ...CONTRIBUTOR_READS,
    'requirements:edit',
    'architecture:edit',
    'documents:edit',
    'work:edit',
    'risks:edit',
    'evidence:upload',
    'exception:request',
    'change_request:create',
  ],

  /** Reviews work and raises change requests, but does not carry sign-off authority. */
  REVIEWER: [...CONTRIBUTOR_READS, 'risks:edit', 'change_request:create'],

  /**
   * Sign-off authority and nothing else. An approver can decide, but cannot edit the thing they are
   * approving — separation of duties. Combining both in one grant is how approval becomes theatre.
   */
  APPROVER: [
    ...CONTRIBUTOR_READS,
    'budget:read',
    'gate:approve',
    'exception:approve',
    'change_request:approve',
    'approval:decide',
    'audit:read',
  ],

  VIEWER: [...CONTRIBUTOR_READS],
};

/* -------------------------------------------------------------------------- */
/* Evaluation                                                                 */
/* -------------------------------------------------------------------------- */

export interface AccessContext {
  /** Role in the organisation that owns the resource. Absent if not a member of that organisation. */
  readonly organizationRole?: OrganizationRole;
  /** Role on the specific project. Absent if not a project member. */
  readonly projectRole?: ProjectRole;
}

/**
 * Whether `context` grants `permission`.
 *
 * Deny by default. The union of organisation and project grants is taken deliberately: an
 * organisation ADMIN has authority over the tenant's projects regardless of project membership, and
 * a project role adds authority within one project without conferring anything organisation-wide.
 */
export function can(context: AccessContext, permission: Permission): boolean {
  const fromOrganization =
    context.organizationRole === undefined
      ? false
      : ORGANIZATION_GRANTS[context.organizationRole].includes(permission);

  const fromProject =
    context.projectRole === undefined
      ? false
      : PROJECT_GRANTS[context.projectRole].includes(permission);

  return fromOrganization || fromProject;
}

/** Every permission the context grants. Used to shape role-aware UI (plan §2.4). */
export function permissionsFor(context: AccessContext): readonly Permission[] {
  return PERMISSIONS.filter((permission) => can(context, permission));
}

/** True when the permission only reads. */
export function isReadPermission(permission: Permission): boolean {
  return READ_PERMISSIONS.includes(permission);
}

export function organizationGrants(role: OrganizationRole): readonly Permission[] {
  return ORGANIZATION_GRANTS[role];
}

export function projectGrants(role: ProjectRole): readonly Permission[] {
  return PROJECT_GRANTS[role];
}

/**
 * Permissions a guest may exercise on their own unsaved project (gap-spec §5.1).
 *
 * Deliberately narrow, and deliberately *not* a role. A guest can complete the trial journey —
 * intake, prompt, import, validate, preview — and nothing else. No evidence upload (no malware
 * scanning surface before signup), no approvals, no export, no member management.
 */
const GUEST_PERMISSIONS: readonly Permission[] = [
  'project:create',
  'project:read',
  'project:edit',
  'intake:edit',
  'ai_import:create',
  'requirements:read',
  'architecture:read',
  'work:read',
  'risks:read',
  'budget:read',
];

/**
 * Whether a guest may perform `permission` on a project their own session owns.
 *
 * The caller must have already established that the guest session owns the project. This function
 * answers only "is this action available to guests at all" — ownership is a separate check, and
 * conflating the two is how object-level authorisation gets skipped.
 */
export function guestCan(permission: Permission): boolean {
  return GUEST_PERMISSIONS.includes(permission);
}
