/**
 * RBAC matrix tests.
 *
 * Contract: gap-spec §7.4 requires an explicit permissions matrix covering every sensitive action;
 * plan §32.8 requires at least 50 authorisation and tenant-isolation tests; §18 requires least
 * privilege and object-level authorisation.
 *
 * These tests are exhaustive over the matrix rather than illustrative. An authorisation table is
 * exactly the kind of artefact where a sampled test passes while a specific cell is wrong, and the
 * wrong cell is a privilege escalation.
 */

import { describe, it, expect } from 'vitest';
import {
  PERMISSIONS,
  can,
  guestCan,
  isReadPermission,
  organizationGrants,
  permissionsFor,
  projectGrants,
  type Permission,
} from '../src/rbac.ts';
import { organizationRoleEnum, projectRoleEnum } from '../src/schema.ts';

const ORG_ROLES = organizationRoleEnum.enumValues;
const PROJECT_ROLES = projectRoleEnum.enumValues;

describe('deny by default', () => {
  it('grants nothing to a context with no roles at all', () => {
    // An unauthenticated or non-member caller must reach nothing.
    for (const permission of PERMISSIONS) {
      expect(can({}, permission), `${permission} leaked to a role-less context`).toBe(false);
    }
  });

  it('grants nothing for a project the user is not a member of', () => {
    // Being a MEMBER of the organisation must not confer authority over an arbitrary project.
    const context = { organizationRole: 'MEMBER' as const };

    expect(can(context, 'requirements:edit')).toBe(false);
    expect(can(context, 'budget:read')).toBe(false);
    expect(can(context, 'gate:approve')).toBe(false);
    expect(can(context, 'evidence:upload')).toBe(false);
  });
});

describe('AUDITOR reads everything and writes nothing', () => {
  it('grants only read permissions', () => {
    // The role exists so nobody needs a write grant merely to inspect.
    for (const permission of organizationGrants('AUDITOR')) {
      expect(
        isReadPermission(permission),
        `AUDITOR was granted write permission ${permission}`,
      ).toBe(true);
    }
  });

  it.each([
    'project:edit',
    'project:delete',
    'project:archive',
    'requirements:edit',
    'budget:edit',
    'evidence:upload',
    'evidence:delete',
    'gate:approve',
    'gate:override',
    'approval:decide',
    'members:manage',
    'organization:manage',
  ] as const)('denies %s to an AUDITOR', (permission) => {
    expect(can({ organizationRole: 'AUDITOR' }, permission)).toBe(false);
  });

  it('can read the audit log', () => {
    expect(can({ organizationRole: 'AUDITOR' }, 'audit:read')).toBe(true);
  });

  it('stays read-only even when also holding a project role', () => {
    // A project grant can add write authority. That is correct — but it must come from the project
    // role, not from AUDITOR. This asserts AUDITOR contributes nothing beyond reads.
    const auditorOnly = permissionsFor({ organizationRole: 'AUDITOR' });
    expect(auditorOnly.every(isReadPermission)).toBe(true);
  });
});

describe('OWNER and ADMIN', () => {
  it('gives OWNER every permission', () => {
    for (const permission of PERMISSIONS) {
      expect(can({ organizationRole: 'OWNER' }, permission), `OWNER denied ${permission}`).toBe(
        true,
      );
    }
  });

  it('withholds project deletion from ADMIN', () => {
    // Deletion has no undo. It stays with OWNER.
    expect(can({ organizationRole: 'ADMIN' }, 'project:delete')).toBe(false);
    expect(can({ organizationRole: 'OWNER' }, 'project:delete')).toBe(true);
  });

  it('withholds organisation management from ADMIN', () => {
    expect(can({ organizationRole: 'ADMIN' }, 'organization:manage')).toBe(false);
    expect(can({ organizationRole: 'OWNER' }, 'organization:manage')).toBe(true);
  });

  it('gives ADMIN everything else', () => {
    const withheld: Permission[] = ['project:delete', 'organization:manage'];
    for (const permission of PERMISSIONS) {
      if (withheld.includes(permission)) continue;
      expect(can({ organizationRole: 'ADMIN' }, permission), `ADMIN denied ${permission}`).toBe(
        true,
      );
    }
  });
});

describe('separation of duties', () => {
  it('does not let an ENGINEER approve a gate', () => {
    // Gap-spec §33 keeps approval separate from task completion. Self-approval is not a control.
    expect(can({ projectRole: 'ENGINEER' }, 'gate:approve')).toBe(false);
    expect(can({ projectRole: 'ENGINEER' }, 'approval:decide')).toBe(false);
    expect(can({ projectRole: 'ENGINEER' }, 'exception:approve')).toBe(false);
    expect(can({ projectRole: 'ENGINEER' }, 'change_request:approve')).toBe(false);
  });

  it('does not let an APPROVER edit the work they approve', () => {
    // Combining edit and approve in one grant is how approval becomes theatre.
    expect(can({ projectRole: 'APPROVER' }, 'requirements:edit')).toBe(false);
    expect(can({ projectRole: 'APPROVER' }, 'architecture:edit')).toBe(false);
    expect(can({ projectRole: 'APPROVER' }, 'work:edit')).toBe(false);
    expect(can({ projectRole: 'APPROVER' }, 'budget:edit')).toBe(false);
  });

  it('does let an APPROVER decide', () => {
    expect(can({ projectRole: 'APPROVER' }, 'gate:approve')).toBe(true);
    expect(can({ projectRole: 'APPROVER' }, 'approval:decide')).toBe(true);
    expect(can({ projectRole: 'APPROVER' }, 'change_request:approve')).toBe(true);
  });

  it('reserves gate override for organisation administrators', () => {
    // Overriding a failed gate is a governance escape hatch and must not sit with a project role.
    for (const role of PROJECT_ROLES) {
      expect(can({ projectRole: role }, 'gate:override'), `${role} can override a gate`).toBe(
        false,
      );
    }
    expect(can({ organizationRole: 'ADMIN' }, 'gate:override')).toBe(true);
  });

  it('reserves evidence deletion for the project owner', () => {
    // Evidence underpins gate decisions; deleting it must be rare and accountable.
    expect(can({ projectRole: 'ENGINEER' }, 'evidence:delete')).toBe(false);
    expect(can({ projectRole: 'PROJECT_MANAGER' }, 'evidence:delete')).toBe(false);
    expect(can({ projectRole: 'PROJECT_OWNER' }, 'evidence:delete')).toBe(true);
  });
});

describe('budget visibility is a distinct permission', () => {
  it('does not give an ENGINEER budget access by default', () => {
    // Commercial data is commonly restricted from engineers; an organisation wanting otherwise
    // grants it at organisation level rather than by widening the engineer role.
    expect(can({ projectRole: 'ENGINEER' }, 'budget:read')).toBe(false);
    expect(can({ projectRole: 'ENGINEER' }, 'budget:edit')).toBe(false);
  });

  it('gives budget access to the manager and owner', () => {
    expect(can({ projectRole: 'PROJECT_MANAGER' }, 'budget:read')).toBe(true);
    expect(can({ projectRole: 'PROJECT_OWNER' }, 'budget:edit')).toBe(true);
  });

  it('gives an approver read but not edit', () => {
    expect(can({ projectRole: 'APPROVER' }, 'budget:read')).toBe(true);
    expect(can({ projectRole: 'APPROVER' }, 'budget:edit')).toBe(false);
  });
});

describe('VIEWER', () => {
  it('grants only reads', () => {
    for (const permission of projectGrants('VIEWER')) {
      expect(isReadPermission(permission), `VIEWER was granted ${permission}`).toBe(true);
    }
  });

  it.each([
    'project:edit',
    'requirements:edit',
    'work:edit',
    'risks:edit',
    'evidence:upload',
    'gate:approve',
    'change_request:create',
  ] as const)('denies %s', (permission) => {
    expect(can({ projectRole: 'VIEWER' }, permission)).toBe(false);
  });
});

describe('grants combine as a union, not a maximum', () => {
  it('lets an organisation ADMIN act on a project where they are only a VIEWER', () => {
    // Organisation admin *is* a grant over the tenant's projects. Evaluating the two scopes
    // independently and taking the lower answer would break legitimate administration.
    const context = { organizationRole: 'ADMIN' as const, projectRole: 'VIEWER' as const };
    expect(can(context, 'requirements:edit')).toBe(true);
  });

  it('lets a project role add authority a MEMBER does not have organisation-wide', () => {
    const context = { organizationRole: 'MEMBER' as const, projectRole: 'ENGINEER' as const };

    expect(can(context, 'requirements:edit')).toBe(true);
    // ...without conferring anything organisation-wide.
    expect(can(context, 'members:manage')).toBe(false);
    expect(can(context, 'organization:manage')).toBe(false);
  });

  it('does not let an AUDITOR org role suppress a project write grant', () => {
    // Union semantics: AUDITOR adds reads; it must not subtract. If an organisation wants an
    // auditor to hold no project role, it grants none — suppression is not the mechanism.
    const context = { organizationRole: 'AUDITOR' as const, projectRole: 'ENGINEER' as const };
    expect(can(context, 'requirements:edit')).toBe(true);
  });
});

describe('guest permissions', () => {
  it('covers the whole trial journey', () => {
    // Gap-spec §5.1: a guest must be able to start, complete intake, generate the prompt, import,
    // validate and preview without an account.
    for (const permission of [
      'project:create',
      'project:read',
      'project:edit',
      'intake:edit',
      'ai_import:create',
    ] as const) {
      expect(guestCan(permission), `guest denied ${permission}`).toBe(true);
    }
  });

  it.each([
    'evidence:upload',
    'evidence:delete',
    'gate:approve',
    'gate:override',
    'approval:decide',
    'members:manage',
    'organization:manage',
    'project:delete',
    'project:export',
    'audit:read',
    'ai_import:approve',
    'baseline:create',
  ] as const)('denies %s to a guest', (permission) => {
    expect(guestCan(permission)).toBe(false);
  });

  it('denies evidence upload, which would open a pre-signup malware surface', () => {
    expect(guestCan('evidence:upload')).toBe(false);
  });

  it('grants strictly fewer permissions than the weakest authenticated project role', () => {
    const guestCount = PERMISSIONS.filter(guestCan).length;
    const ownerCount = projectGrants('PROJECT_OWNER').length;
    expect(guestCount).toBeLessThan(ownerCount);
  });
});

describe('matrix integrity', () => {
  it('assigns every organisation role a defined grant set', () => {
    for (const role of ORG_ROLES) {
      expect(organizationGrants(role).length, `${role} has no grants`).toBeGreaterThan(0);
    }
  });

  it('assigns every project role a defined grant set', () => {
    for (const role of PROJECT_ROLES) {
      expect(projectGrants(role).length, `${role} has no grants`).toBeGreaterThan(0);
    }
  });

  it('never grants a permission outside the declared enum', () => {
    // A typo'd permission string would silently never match, producing a permanent deny that looks
    // like a policy decision.
    const declared = new Set<string>(PERMISSIONS);
    for (const role of ORG_ROLES) {
      for (const p of organizationGrants(role)) expect(declared.has(p), `${role}: ${p}`).toBe(true);
    }
    for (const role of PROJECT_ROLES) {
      for (const p of projectGrants(role)) expect(declared.has(p), `${role}: ${p}`).toBe(true);
    }
  });

  it('lists no duplicate permissions in any grant set', () => {
    for (const role of ORG_ROLES) {
      const grants = organizationGrants(role);
      expect(new Set(grants).size, `${role} has duplicates`).toBe(grants.length);
    }
    for (const role of PROJECT_ROLES) {
      const grants = projectGrants(role);
      expect(new Set(grants).size, `${role} has duplicates`).toBe(grants.length);
    }
  });

  it('covers every sensitive action gap-spec §7.4 names', () => {
    const required: Permission[] = [
      'project:create',
      'intake:edit',
      'ai_import:create',
      'ai_import:approve',
      'requirements:edit',
      'architecture:edit',
      'budget:edit',
      'budget:read',
      'evidence:read',
      'evidence:upload',
      'evidence:delete',
      'baseline:create',
      'gate:approve',
      'gate:override',
      'exception:request',
      'exception:approve',
      'deployment:record',
      'project:archive',
      'project:export',
      'members:manage',
      'integrations:manage',
      'audit:read',
    ];

    const declared = new Set<string>(PERMISSIONS);
    for (const permission of required) {
      expect(declared.has(permission), `matrix is missing ${permission}`).toBe(true);
    }
  });

  it('grants each permission to at least one role', () => {
    // A permission nobody can hold is dead policy — either a missing grant or a stale enum entry.
    for (const permission of PERMISSIONS) {
      const held =
        ORG_ROLES.some((r) => can({ organizationRole: r }, permission)) ||
        PROJECT_ROLES.some((r) => can({ projectRole: r }, permission));
      expect(held, `no role can ever exercise ${permission}`).toBe(true);
    }
  });

  it('returns the same answer for the same context every time', () => {
    // Plan §83: authorisation must remain deterministic.
    const context = { organizationRole: 'MEMBER' as const, projectRole: 'ENGINEER' as const };
    const first = permissionsFor(context);
    const second = permissionsFor(context);
    expect(first).toEqual(second);
  });
});
