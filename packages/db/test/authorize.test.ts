/**
 * Identity resolution and authorisation middleware tests.
 *
 * Contract: gap-spec §6.1 (provider-neutral OIDC keyed on issuer+subject), §7.5 (tenant context
 * required), §65 (authorisation attack suite: BOLA, privilege escalation, IDOR), plan §18, §32.8.
 *
 * The BOLA cases are the point of this file. A handler that checks "does this role hold
 * `requirements:edit`?" without checking "does this requirement belong to the caller's tenant?" is
 * the single most common serious API vulnerability, and it passes every permission test you can
 * write.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { AppError, isAppError } from '@govintel/shared/errors';
import { createTestDatabase, type TestDatabase } from '../src/client.ts';
import {
  organizationRoleFor,
  organizationsForUser,
  projectRoleFor,
  resolveIdentity,
} from '../src/identity.ts';
import {
  authorizeGuestObject,
  authorizeObject,
  buildGuestPrincipal,
  buildUserPrincipal,
  isGuest,
  principalCan,
  requirePermission,
  requireUser,
} from '../src/authorize.ts';

let database: TestDatabase;

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const USER_A = '33333333-3333-4333-8333-333333333333';
const USER_B = '44444444-4444-4444-8444-444444444444';
const PROJECT_A = '55555555-5555-4555-8555-555555555555';
const PROJECT_B = '66666666-6666-4666-8666-666666666666';

function expectAppError(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error) {
    if (isAppError(error)) return error;
    throw new Error(`expected AppError, got ${String(error)}`, { cause: error });
  }
  throw new Error('expected a throw, but the call succeeded');
}

async function expectAsyncAppError(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (isAppError(error)) return error;
    throw new Error(`expected AppError, got ${String(error)}`, { cause: error });
  }
  throw new Error('expected a rejection, but the promise resolved');
}

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.truncate();

  await database.db.execute(sql`
    INSERT INTO organizations (id, name, slug) VALUES
      (${ORG_A}, 'Org A', 'org-a'), (${ORG_B}, 'Org B', 'org-b')
  `);
  await database.db.execute(sql`
    INSERT INTO users (id, issuer, subject) VALUES
      (${USER_A}, 'https://idp.example.com', 'sub-a'),
      (${USER_B}, 'https://idp.example.com', 'sub-b')
  `);
  await database.db.execute(sql`
    INSERT INTO memberships (organization_id, user_id, role) VALUES
      (${ORG_A}, ${USER_A}, 'MEMBER'),
      (${ORG_B}, ${USER_B}, 'OWNER')
  `);
  await database.db.execute(sql`
    INSERT INTO projects (id, organization_id, name) VALUES
      (${PROJECT_A}, ${ORG_A}, 'Project A'),
      (${PROJECT_B}, ${ORG_B}, 'Project B')
  `);
  await database.db.execute(sql`
    INSERT INTO project_members (organization_id, project_id, user_id, role) VALUES
      (${ORG_A}, ${PROJECT_A}, ${USER_A}, 'ENGINEER')
  `);
});

describe('identity is keyed on issuer and subject', () => {
  it('creates a user on first sign-in', async () => {
    const result = await resolveIdentity(database.db, {
      issuer: 'https://idp.example.com',
      subject: 'brand-new',
    });

    expect(result.created).toBe(true);
    expect(result.user.subject).toBe('brand-new');
  });

  it('matches the same person on a second sign-in', async () => {
    const claims = { issuer: 'https://idp.example.com', subject: 'repeat' };
    const first = await resolveIdentity(database.db, claims);
    const second = await resolveIdentity(database.db, claims);

    expect(second.created).toBe(false);
    expect(second.user.id).toBe(first.user.id);
  });

  it('treats the same subject from a different issuer as a different person', async () => {
    // Two providers can legitimately issue the same `sub`. Keying on subject alone would merge
    // two unrelated people into one account.
    const a = await resolveIdentity(database.db, { issuer: 'https://idp-a.test', subject: 'x' });
    const b = await resolveIdentity(database.db, { issuer: 'https://idp-b.test', subject: 'x' });

    expect(a.user.id).not.toBe(b.user.id);
  });

  it('does not key on email', async () => {
    // Email is mutable and reassignable. Keying on it is a known account-takeover route.
    const a = await resolveIdentity(database.db, {
      issuer: 'https://idp-a.test',
      subject: 'one',
      email: 'shared@example.com',
    });
    const b = await resolveIdentity(database.db, {
      issuer: 'https://idp-b.test',
      subject: 'two',
      email: 'shared@example.com',
    });

    expect(a.user.id).not.toBe(b.user.id);
  });

  it('refreshes display metadata from the provider on each sign-in', async () => {
    const claims = { issuer: 'https://idp.example.com', subject: 'profile' };
    await resolveIdentity(database.db, { ...claims, displayName: 'Old Name' });
    const updated = await resolveIdentity(database.db, { ...claims, displayName: 'New Name' });

    expect(updated.user.displayName).toBe('New Name');
  });

  it('leaves stored metadata alone when a claim is absent', async () => {
    const claims = { issuer: 'https://idp.example.com', subject: 'partial' };
    await resolveIdentity(database.db, { ...claims, displayName: 'Kept' });
    const again = await resolveIdentity(database.db, claims);

    expect(again.user.displayName).toBe('Kept');
  });

  it.each([
    ['empty issuer', { issuer: '', subject: 's' }],
    ['whitespace issuer', { issuer: '   ', subject: 's' }],
    ['empty subject', { issuer: 'https://idp.test', subject: '' }],
    ['non-URL issuer', { issuer: 'not-a-url', subject: 's' }],
    ['non-http scheme', { issuer: 'ftp://idp.test', subject: 's' }],
  ])('rejects %s', async (_label, claims) => {
    const error = await expectAsyncAppError(resolveIdentity(database.db, claims));
    expect(error.category).toBe('AUTHENTICATION');
  });

  it('does not echo claim values in the rejection', async () => {
    // Claims are attacker-influenced and end up in logs.
    const error = await expectAsyncAppError(
      resolveIdentity(database.db, { issuer: 'javascript:alert(1)', subject: 's' }),
    );
    expect(JSON.stringify(error.details)).not.toContain('javascript:');
  });

  it('refuses a locked account', async () => {
    await resolveIdentity(database.db, { issuer: 'https://idp.test', subject: 'locked' });
    await database.db.execute(sql`UPDATE users SET locked_at = now() WHERE subject = 'locked'`);

    const error = await expectAsyncAppError(
      resolveIdentity(database.db, { issuer: 'https://idp.test', subject: 'locked' }),
    );
    expect(error.code).toBe('ACCOUNT_LOCKED');
  });

  it('does not confirm the lockout to the caller', async () => {
    // Telling an attacker their lockout worked is free information, and confirming the account
    // exists at all is an enumeration oracle.
    await resolveIdentity(database.db, { issuer: 'https://idp.test', subject: 'locked2' });
    await database.db.execute(sql`UPDATE users SET locked_at = now() WHERE subject = 'locked2'`);

    const error = await expectAsyncAppError(
      resolveIdentity(database.db, { issuer: 'https://idp.test', subject: 'locked2' }),
    );
    expect(error.safeMessage).not.toMatch(/lock/i);
  });
});

describe('membership lookup', () => {
  it('lists the organisations a user belongs to', async () => {
    const orgs = await organizationsForUser(database.db, USER_A);
    expect(orgs.map((o) => o.organizationId)).toEqual([ORG_A]);
  });

  it('does not list organisations the user is not a member of', async () => {
    const orgs = await organizationsForUser(database.db, USER_A);
    expect(orgs.map((o) => o.organizationId)).not.toContain(ORG_B);
  });

  it('returns the role in an organisation', async () => {
    expect(await organizationRoleFor(database.db, USER_A, ORG_A)).toBe('MEMBER');
  });

  it('returns undefined for a non-member', async () => {
    // Undefined is what makes a non-member indistinguishable from a member with no permissions,
    // and it is what feeds deny-by-default.
    expect(await organizationRoleFor(database.db, USER_A, ORG_B)).toBeUndefined();
  });

  it('returns the project role for a member', async () => {
    expect(await projectRoleFor(database.db, USER_A, PROJECT_A, ORG_A)).toBe('ENGINEER');
  });

  it('will not return a project role using a mismatched tenant', async () => {
    // The tenant predicate is included even though the project id is unique. Without it, supplying
    // another tenant's project id would return a role over it.
    expect(await projectRoleFor(database.db, USER_A, PROJECT_A, ORG_B)).toBeUndefined();
  });
});

describe('building a principal', () => {
  it('builds a user principal for a member', async () => {
    const principal = await buildUserPrincipal(database.db, {
      userId: USER_A,
      organizationId: ORG_A,
    });

    expect(principal.kind).toBe('user');
    expect(principal.organizationRole).toBe('MEMBER');
    expect(principal.scope.organizationId).toBe(ORG_A);
  });

  it('includes the project role when a project is targeted', async () => {
    const principal = await buildUserPrincipal(database.db, {
      userId: USER_A,
      organizationId: ORG_A,
      projectId: PROJECT_A,
    });

    expect(principal.projectRole).toBe('ENGINEER');
  });

  it('omits the project role when the user is not a project member', async () => {
    await database.db.execute(sql`
      INSERT INTO projects (organization_id, name) VALUES (${ORG_A}, 'Unjoined')
    `);
    const principal = await buildUserPrincipal(database.db, {
      userId: USER_A,
      organizationId: ORG_A,
      projectId: PROJECT_B,
    });

    expect(principal.projectRole).toBeUndefined();
  });

  it('refuses to build a principal for a non-member', async () => {
    const error = await expectAsyncAppError(
      buildUserPrincipal(database.db, { userId: USER_A, organizationId: ORG_B }),
    );

    expect(error.category).toBe('TENANT_ISOLATION');
  });

  it('answers 404 for a non-member, not 403', async () => {
    // A 403 would confirm the organisation exists.
    const error = await expectAsyncAppError(
      buildUserPrincipal(database.db, { userId: USER_A, organizationId: ORG_B }),
    );

    expect(error.httpStatus).toBe(404);
  });

  it('reads membership from the database rather than trusting a claim', async () => {
    // A role baked into a token stays valid until it expires, so a revoked admin keeps admin rights
    // for the rest of their session — precisely when revocation matters most.
    const before = await buildUserPrincipal(database.db, {
      userId: USER_A,
      organizationId: ORG_A,
    });
    expect(before.organizationRole).toBe('MEMBER');

    await database.db.execute(sql`
      UPDATE memberships SET role = 'AUDITOR' WHERE user_id = ${USER_A}
    `);

    const after = await buildUserPrincipal(database.db, {
      userId: USER_A,
      organizationId: ORG_A,
    });
    expect(after.organizationRole).toBe('AUDITOR');
  });

  it('builds a guest principal', () => {
    const principal = buildGuestPrincipal('sess-1');
    expect(isGuest(principal)).toBe(true);
  });

  it('refuses an empty guest session id', () => {
    expect(() => buildGuestPrincipal('   ')).toThrow(AppError);
  });
});

describe('permission checks', () => {
  it('grants a permission the role holds', async () => {
    const principal = await buildUserPrincipal(database.db, {
      userId: USER_A,
      organizationId: ORG_A,
      projectId: PROJECT_A,
    });

    expect(principalCan(principal, 'requirements:edit')).toBe(true);
  });

  it('denies a permission the role lacks', async () => {
    const principal = await buildUserPrincipal(database.db, {
      userId: USER_A,
      organizationId: ORG_A,
      projectId: PROJECT_A,
    });

    // ENGINEER cannot approve — separation of duties.
    expect(principalCan(principal, 'gate:approve')).toBe(false);
  });

  it('answers 403 for a permission failure', async () => {
    const principal = await buildUserPrincipal(database.db, {
      userId: USER_A,
      organizationId: ORG_A,
      projectId: PROJECT_A,
    });

    const error = expectAppError(() => {
      requirePermission(principal, 'gate:approve');
    });
    expect(error.httpStatus).toBe(403);
  });

  it('applies the guest permission set to a guest principal', () => {
    const guest = buildGuestPrincipal('sess-1');

    expect(principalCan(guest, 'intake:edit')).toBe(true);
    expect(principalCan(guest, 'evidence:upload')).toBe(false);
  });

  it('requires an account for user-only actions', () => {
    const error = expectAppError(() => requireUser(buildGuestPrincipal('sess-1')));

    // 401, not 403: the fix is to sign in, and saying so is more useful than a flat refusal.
    expect(error.httpStatus).toBe(401);
  });
});

describe('broken object level authorisation (BOLA)', () => {
  const objectInA = { id: 'req-1', organizationId: ORG_A, title: 'A requirement' };
  const objectInB = { id: 'req-2', organizationId: ORG_B, title: 'B requirement' };

  it('allows an authorised action on an object in the caller tenant', async () => {
    const principal = await buildUserPrincipal(database.db, {
      userId: USER_A,
      organizationId: ORG_A,
      projectId: PROJECT_A,
    });

    expect(authorizeObject(principal, objectInA, 'requirements:edit', 'requirement')).toBe(
      objectInA,
    );
  });

  it('refuses the same action on an object in another tenant', async () => {
    // The canonical BOLA case: the caller genuinely holds `requirements:edit`. A handler that
    // checked only the permission would allow this.
    const principal = await buildUserPrincipal(database.db, {
      userId: USER_A,
      organizationId: ORG_A,
      projectId: PROJECT_A,
    });

    const error = expectAppError(() =>
      authorizeObject(principal, objectInB, 'requirements:edit', 'requirement'),
    );

    expect(error.category).toBe('TENANT_ISOLATION');
    expect(error.httpStatus).toBe(404);
  });

  it('checks tenancy before permission, so a probe cannot distinguish the two failures', async () => {
    // If permission were checked first, a caller lacking the permission would get 403 on an object
    // that exists in another tenant and 403 on one that does not — but a caller *holding* it would
    // get 404 vs 403, which reveals existence.
    const principal = await buildUserPrincipal(database.db, {
      userId: USER_A,
      organizationId: ORG_A,
      projectId: PROJECT_A,
    });

    const crossTenant = expectAppError(() =>
      authorizeObject(principal, objectInB, 'requirements:edit', 'requirement'),
    );
    const missing = expectAppError(() =>
      authorizeObject(principal, undefined, 'requirements:edit', 'requirement'),
    );

    expect(crossTenant.httpStatus).toBe(missing.httpStatus);
    expect(crossTenant.safeMessage).toBe(missing.safeMessage);
  });

  it('refuses a cross-tenant object even for an organisation owner', async () => {
    // Privilege escalation check: the highest role in one tenant confers nothing in another.
    const principal = await buildUserPrincipal(database.db, {
      userId: USER_B,
      organizationId: ORG_B,
    });

    const error = expectAppError(() =>
      authorizeObject(principal, objectInA, 'requirements:edit', 'requirement'),
    );
    expect(error.category).toBe('TENANT_ISOLATION');
  });

  it('does not leak the owning tenant on the wire', async () => {
    const principal = await buildUserPrincipal(database.db, {
      userId: USER_A,
      organizationId: ORG_A,
      projectId: PROJECT_A,
    });

    const error = expectAppError(() =>
      authorizeObject(principal, objectInB, 'requirements:edit', 'requirement'),
    );

    const wire = JSON.stringify(error.toWireFormat());
    expect(wire).not.toContain(ORG_B);
    expect(wire).not.toContain('B requirement');
  });

  it('still enforces the permission on an in-tenant object', async () => {
    // Tenancy passing must not short-circuit the permission check.
    const principal = await buildUserPrincipal(database.db, {
      userId: USER_A,
      organizationId: ORG_A,
      projectId: PROJECT_A,
    });

    const error = expectAppError(() =>
      authorizeObject(principal, objectInA, 'gate:approve', 'gate'),
    );
    expect(error.category).toBe('AUTHORIZATION');
  });

  it('refuses a guest principal on a tenant-owned object', () => {
    const error = expectAppError(() =>
      authorizeObject(buildGuestPrincipal('sess-1'), objectInA, 'project:read', 'project'),
    );
    expect(error.category).toBe('AUTHENTICATION');
  });
});

describe('guest object authorisation', () => {
  const guestProject = { id: 'gp-1', guestSessionId: 'sess-1' };

  it('allows a guest to act on their own project', () => {
    const principal = buildGuestPrincipal('sess-1');
    expect(authorizeGuestObject(principal, guestProject, 'intake:edit', 'project')).toBe(
      guestProject,
    );
  });

  it('refuses a guest acting on another session project', () => {
    const principal = buildGuestPrincipal('sess-2');
    const error = expectAppError(() =>
      authorizeGuestObject(principal, guestProject, 'intake:edit', 'project'),
    );

    expect(error.category).toBe('TENANT_ISOLATION');
    expect(error.httpStatus).toBe(404);
  });

  it('enforces the guest permission set on their own project', () => {
    const principal = buildGuestPrincipal('sess-1');
    const error = expectAppError(() =>
      authorizeGuestObject(principal, guestProject, 'evidence:upload', 'project'),
    );

    expect(error.category).toBe('AUTHORIZATION');
  });

  it('refuses a user principal on the guest path', async () => {
    // The two ownership models must not substitute for each other.
    const principal = await buildUserPrincipal(database.db, {
      userId: USER_A,
      organizationId: ORG_A,
    });

    const error = expectAppError(() =>
      authorizeGuestObject(principal, guestProject, 'intake:edit', 'project'),
    );
    expect(error.category).toBe('AUTHORIZATION');
  });

  it('gives the same answer for wrong-session and missing', () => {
    const principal = buildGuestPrincipal('sess-2');
    const wrong = expectAppError(() =>
      authorizeGuestObject(principal, guestProject, 'intake:edit', 'project'),
    );
    const missing = expectAppError(() =>
      authorizeGuestObject(principal, undefined, 'intake:edit', 'project'),
    );

    expect(wrong.safeMessage).toBe(missing.safeMessage);
    expect(wrong.httpStatus).toBe(missing.httpStatus);
  });
});
