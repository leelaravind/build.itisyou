import { describe, expect, it } from 'vitest';
import type { OrganizationRole } from '@govintel/db/schema';
import {
  INVITATION_STATES,
  accept,
  assignProjectRole,
  changeRole,
  isLastOwner,
  mayGrant,
  mayHoldProjectRole,
  removeMember,
  type Invitation,
  type Member,
} from '../src/membership.ts';
import {
  buildPortfolio,
  maySee,
  maySeeDetail,
  overcommitted,
  resourceLoad,
  type PortfolioProject,
  type Viewer,
} from '../src/portfolio.ts';
import {
  IMPLEMENTED_CONNECTORS,
  INTEGRATIONS,
  INTEGRATION_STATES,
  checkIntegrations,
  offersConnect,
} from '../src/integrations.ts';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const AT = '2026-01-01';
const ORG = 'org1';
const OTHER_ORG = 'org2';

function member(userId: string, role: OrganizationRole, accepted = true): Member {
  return { userId, organizationId: ORG, role, joinedAt: AT, accepted };
}

function invitation(overrides: Partial<Invitation> = {}): Invitation {
  return {
    id: 'i1',
    organizationId: ORG,
    email: 'new@example.com',
    role: 'MEMBER',
    invitedBy: 'owner',
    invitedAt: AT,
    expiresOn: '2026-02-01',
    state: 'PENDING',
    ...overrides,
  };
}

function project(overrides: Partial<PortfolioProject> = {}): PortfolioProject {
  return {
    projectId: 'p1',
    organizationId: ORG,
    name: 'Clinic scheduling',
    lifecycleState: 'DELIVERY',
    health: 'HEALTHY',
    feasibility: 'FEASIBLE',
    healthBecause: 'Nothing outstanding.',
    archived: false,
    ...overrides,
  };
}

function viewer(role: OrganizationRole = 'ADMIN'): Viewer {
  return { userId: 'u1', organizationId: ORG, organizationRole: role };
}

/* -------------------------------------------------------------------------- */
/* Membership                                                                 */
/* -------------------------------------------------------------------------- */

describe('gap-spec §7.2: organisation membership', () => {
  it('changes a role', () => {
    const members = [member('owner', 'OWNER'), member('u2', 'MEMBER')];

    const result = changeRole(members, {
      actorId: 'owner',
      actorRole: 'OWNER',
      targetUserId: 'u2',
      newRole: 'ADMIN',
    });

    expect(result.ok ? result.value.find((m) => m.userId === 'u2')?.role : undefined).toBe('ADMIN');
  });

  it('refuses to remove the last owner, and explains why it is unrecoverable', () => {
    /*
     * The rule that stops an organisation locking itself out. Appointing an owner requires being one,
     * so an organisation with no owner cannot appoint one — it needs database access, which is
     * exactly the situation a tenanted system exists to avoid.
     */
    const members = [member('owner', 'OWNER'), member('u2', 'ADMIN')];

    const result = removeMember(members, 'OWNER', 'owner');

    expect(result.ok ? undefined : result.refusal).toBe('LAST_OWNER');
    expect(result.ok ? undefined : result.reason).toMatch(/cannot appoint one/i);
  });

  it('refuses to demote the last owner', () => {
    // The same problem reached by a different route, and the one people miss when they guard only
    // removal.
    const members = [member('owner', 'OWNER'), member('u2', 'ADMIN')];

    const result = changeRole(members, {
      actorId: 'u2',
      actorRole: 'ADMIN',
      targetUserId: 'owner',
      newRole: 'MEMBER',
    });

    expect(result.ok ? undefined : result.refusal).toBe('LAST_OWNER');
  });

  it('allows removing an owner when there is another', () => {
    // The counterpart. A rule that fires on every owner removal would make ownership permanent.
    const members = [member('owner', 'OWNER'), member('owner2', 'OWNER')];

    expect(removeMember(members, 'OWNER', 'owner').ok).toBe(true);
    expect(isLastOwner(members, 'owner')).toBe(false);
  });

  it('does not count an unaccepted owner towards the last-owner rule', () => {
    /*
     * An invited owner who has not accepted cannot administer anything. Counting them would let the
     * real last owner be removed on the strength of somebody who may never arrive.
     */
    const members = [member('owner', 'OWNER'), member('pending', 'OWNER', false)];

    expect(isLastOwner(members, 'owner')).toBe(true);
  });

  it('refuses self-demotion', () => {
    // The one change nobody can undo, and the second half of the last-owner problem.
    const members = [member('owner', 'OWNER'), member('owner2', 'OWNER')];

    const result = changeRole(members, {
      actorId: 'owner',
      actorRole: 'OWNER',
      targetUserId: 'owner',
      newRole: 'MEMBER',
    });

    expect(result.ok ? undefined : result.refusal).toBe('SELF_DEMOTION');
  });

  it('refuses to grant a role above the granter’s own', () => {
    /*
     * Without this, an admin makes somebody an owner and is then removed by them — escalation in two
     * hops, using only permitted operations, leaving an audit trail of entirely legitimate actions.
     */
    expect(mayGrant('ADMIN', 'OWNER')).toBe(false);
    expect(mayGrant('OWNER', 'OWNER')).toBe(true);
    expect(mayGrant('MEMBER', 'MEMBER')).toBe(false);

    const result = changeRole([member('owner', 'OWNER'), member('u2', 'MEMBER')], {
      actorId: 'admin',
      actorRole: 'ADMIN',
      targetUserId: 'u2',
      newRole: 'OWNER',
    });

    expect(result.ok ? undefined : result.refusal).toBe('CANNOT_GRANT_ABOVE_OWN_ROLE');
  });

  it('does not let an admin remove an owner', () => {
    // Otherwise the ordering of authority is decoration.
    const members = [member('owner', 'OWNER'), member('owner2', 'OWNER')];

    expect(removeMember(members, 'ADMIN', 'owner').ok).toBe(false);
  });

  it('does not let a member remove anybody', () => {
    expect(removeMember([member('u1', 'MEMBER')], 'MEMBER', 'u1').ok).toBe(false);
  });

  it('accepts a pending invitation', () => {
    const result = accept(invitation(), [member('owner', 'OWNER')], 'u9', AT);

    expect(result.ok ? result.value.find((m) => m.userId === 'u9')?.role : undefined).toBe(
      'MEMBER',
    );
  });

  it('keeps revoked and expired as different states', () => {
    /*
     * Revoked means somebody decided this person should not join; expired means nobody acted. Only
     * one of the two should be re-sent without a conversation first.
     */
    expect(INVITATION_STATES).toContain('REVOKED');
    expect(INVITATION_STATES).toContain('EXPIRED');

    const revoked = accept(invitation({ state: 'REVOKED' }), [], 'u9', AT);
    const expired = accept(invitation({ expiresOn: '2025-12-01' }), [], 'u9', AT);

    expect(revoked.ok ? undefined : revoked.reason).toMatch(/somebody decided/i);
    expect(expired.ok ? undefined : expired.reason).toMatch(/nobody revoked it/i);
  });

  it('refuses to accept an invitation twice', () => {
    // Accepting again would either duplicate the membership or silently change their role, and
    // neither is what anybody intended.
    const result = accept(invitation(), [member('u9', 'ADMIN')], 'u9', AT);

    expect(result.ok ? undefined : result.refusal).toBe('ALREADY_A_MEMBER');
  });

  it('refuses to give an auditor a project role', () => {
    /*
     * An auditor's value is that they are outside the work. A project role makes them a participant
     * in something they are meant to examine independently, and while the platform cannot enforce
     * independence it can decline to record the arrangement that destroys it.
     */
    expect(mayHoldProjectRole('AUDITOR')).toBe(false);
    expect(mayHoldProjectRole('MEMBER')).toBe(true);

    const result = assignProjectRole('AUDITOR', 'OWNER', {
      userId: 'a1',
      projectId: 'p1',
      role: 'ENGINEER',
    });

    expect(result.ok ? undefined : result.refusal).toBe('AUDITOR_CANNOT_HOLD_A_PROJECT_ROLE');
  });
});

/* -------------------------------------------------------------------------- */
/* Portfolio                                                                  */
/* -------------------------------------------------------------------------- */

describe('the portfolio is the easiest place to leak', () => {
  it('shows a project in the viewer’s organisation', () => {
    // Without this, every negative test below passes against a portfolio that shows nothing.
    expect(buildPortfolio(viewer(), [project()]).entries).toHaveLength(1);
  });

  it('never includes a project from another organisation', () => {
    expect(maySee(viewer(), project({ organizationId: OTHER_ORG }))).toBe(false);

    expect(
      buildPortfolio(viewer(), [project({ projectId: 'p9', organizationId: OTHER_ORG })]).entries,
    ).toEqual([]);
  });

  it('checks the organisation before the role', () => {
    /*
     * Ordering matters: a check that evaluated the role first would let a bug in role resolution
     * produce cross-tenant visibility, which is the failure the whole model exists to prevent.
     */
    const foreignOwner: Viewer = { userId: 'u1', organizationId: ORG, organizationRole: 'OWNER' };

    expect(maySee(foreignOwner, project({ organizationId: OTHER_ORG }))).toBe(false);
  });

  it('does not count invisible projects in the totals', () => {
    /*
     * The subtle leak, and the one that looks like a feature. "Seven projects are at risk" tells
     * somebody there are seven; if they can open four, the existence, count and state of the other
     * three have been disclosed to them.
     */
    const portfolio = buildPortfolio(viewer(), [
      project({ projectId: 'p1' }),
      project({ projectId: 'p2', organizationId: OTHER_ORG, health: 'CRITICAL' }),
    ]);

    expect(portfolio.entries).toHaveLength(1);
    expect(portfolio.counts.CRITICAL).toBeUndefined();
    expect(portfolio.headline).not.toContain('2');
  });

  it('requires an explicit project role for a restricted project', () => {
    /*
     * The rule that makes the partial-view protection reachable at all.
     *
     * Organisation roles grant `project:read` org-wide, so before this existed every member could see
     * every project, `partialView` was permanently false, and the code below guarded a situation that
     * could not arise. A control that cannot fire reads as protection in review and is not one.
     *
     * An owner is deliberately not exempt: restriction is narrower than the organisation, and
     * exempting the most powerful role removes the case it exists for.
     */
    const owner: Viewer = { userId: 'u1', organizationId: ORG, organizationRole: 'OWNER' };

    expect(maySee(owner, project({ restricted: true }))).toBe(false);
    expect(maySee(owner, project({ restricted: true, projectRole: 'VIEWER' }))).toBe(true);
  });

  it('says the view is partial without saying how much is missing', () => {
    /*
     * "3 projects are hidden from you" discloses that there are three — precisely the information the
     * permission was withholding. The honest form is a fact about the viewer's access.
     */
    const restrictedViewer: Viewer = {
      userId: 'u1',
      organizationId: ORG,
      organizationRole: 'MEMBER',
    };

    const portfolio = buildPortfolio(restrictedViewer, [
      project({ projectId: 'p1' }),
      project({ projectId: 'p2', restricted: true }),
      project({ projectId: 'p3', restricted: true }),
    ]);

    // Asserted unconditionally. Wrapping this in `if (portfolio.partialView)` was how the first
    // version passed while testing nothing at all.
    expect(portfolio.partialView).toBe(true);
    expect(portfolio.entries).toHaveLength(1);
    expect(portfolio.headline).toMatch(/your access does not extend/i);
    expect(portfolio.headline).not.toMatch(/\b\d+ projects? (are )?hidden/i);
  });

  it('distinguishes an empty organisation from one you cannot see into', () => {
    /*
     * They render identically and mean opposite things: one is an empty organisation, the other is a
     * permissions question. Rendering them alike sends somebody to create a project that exists.
     */
    const empty = buildPortfolio(viewer(), []);
    const blind = buildPortfolio(
      { userId: 'u1', organizationId: ORG, organizationRole: 'MEMBER' },
      [project({ projectId: 'p1', restricted: true })],
    );

    expect(empty.headline).toMatch(/no projects yet/i);

    // Unconditional for the same reason as above: a conditional here would pass on a portfolio that
    // showed everything, which is the case it exists to rule out.
    expect(blind.entries).toEqual([]);
    expect(blind.headline).toMatch(/there are some/i);
  });

  it('decides budget visibility per project rather than per portfolio', () => {
    /*
     * Visibility is not one boolean. Somebody can legitimately see that a project exists and its
     * health, and not its money — and treating it as one decision either hides projects it should
     * show or shows figures it should not.
     */
    const auditor: Viewer = { userId: 'a1', organizationId: ORG, organizationRole: 'AUDITOR' };
    const entries = buildPortfolio(auditor, [project()]).entries;

    expect(entries).toHaveLength(1);
    expect(typeof entries[0]?.budgetVisible).toBe('boolean');
    expect(maySeeDetail(auditor, project({ organizationId: OTHER_ORG }), 'budget:read')).toBe(
      false,
    );
  });

  it('never averages health across projects', () => {
    /*
     * A portfolio of one healthy project and one on fire is not moderately healthy. It is a portfolio
     * with a project on fire, and the roll-up names it.
     */
    const portfolio = buildPortfolio(viewer(), [
      project({ projectId: 'p1', health: 'HEALTHY' }),
      project({
        projectId: 'p2',
        health: 'CRITICAL',
        name: 'Payments migration',
        healthBecause: 'The security gate is failing.',
      }),
    ]);

    expect(portfolio.headline).toContain('Payments migration');
    expect(portfolio.headline).toContain('security gate');
    expect(portfolio.headline).not.toMatch(/\d{1,3}%/);
  });

  it('orders by attention needed, not alphabetically', () => {
    // The whole reason to have a portfolio is that nobody has time to open eleven projects.
    const portfolio = buildPortfolio(viewer(), [
      project({ projectId: 'a', name: 'Alpha', health: 'HEALTHY' }),
      project({ projectId: 'b', name: 'Beta', health: 'CRITICAL' }),
      project({ projectId: 'c', name: 'Gamma', health: 'AT_RISK' }),
    ]);

    expect(portfolio.entries.map((e) => e.projectId)).toEqual(['b', 'c', 'a']);
  });

  it('puts archived projects last regardless of health', () => {
    // A critical project that ended is not the thing to look at this morning, and leaving it at the
    // top buries the live one underneath it.
    const portfolio = buildPortfolio(viewer(), [
      project({ projectId: 'dead', health: 'CRITICAL', archived: true }),
      project({ projectId: 'live', health: 'WATCH' }),
    ]);

    expect(portfolio.entries.map((e) => e.projectId)).toEqual(['live', 'dead']);
    expect(portfolio.needsAttention?.projectId).toBe('live');
  });

  it('returns null for attention rather than a cheerful placeholder', () => {
    expect(buildPortfolio(viewer(), [project()]).needsAttention).toBeNull();
  });

  it('sums a person’s commitment across projects', () => {
    /*
     * The one genuinely cross-project calculation, and it is invisible from inside any single
     * project: each sees a person at 60% and believes it has 60% of them.
     */
    const projects = [project({ projectId: 'p1' }), project({ projectId: 'p2' })];

    const loads = resourceLoad(viewer(), projects, [
      { resourceId: 'r1', name: 'A. Patel', projectId: 'p1', allocation: 0.6 },
      { resourceId: 'r1', name: 'A. Patel', projectId: 'p2', allocation: 0.6 },
    ]);

    expect(loads[0]?.totalAllocation).toBeCloseTo(1.2);
    expect(overcommitted(loads).map((l) => l.resourceId)).toEqual(['r1']);
  });

  it('understates commitment rather than disclosing an invisible project', () => {
    /*
     * Understating is the correct direction to be wrong in here. The alternative is telling somebody
     * about a commitment on a project they may not know exists.
     */
    const projects = [
      project({ projectId: 'p1' }),
      project({ projectId: 'p2', organizationId: OTHER_ORG }),
    ];

    const loads = resourceLoad(viewer(), projects, [
      { resourceId: 'r1', name: 'A. Patel', projectId: 'p1', allocation: 0.6 },
      { resourceId: 'r1', name: 'A. Patel', projectId: 'p2', allocation: 0.6 },
    ]);

    expect(loads[0]?.totalAllocation).toBeCloseTo(0.6);
    expect(loads[0]?.projectIds).toEqual(['p1']);
  });

  it('is deterministic', () => {
    const projects = [
      project({ projectId: 'b', health: 'CRITICAL' }),
      project({ projectId: 'a', health: 'CRITICAL' }),
    ];

    expect(JSON.stringify(buildPortfolio(viewer(), projects))).toBe(
      JSON.stringify(buildPortfolio(viewer(), projects)),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Integrations                                                               */
/* -------------------------------------------------------------------------- */

describe('gap-spec §44: do not fake functionality', () => {
  it('offers §44’s four states', () => {
    expect(INTEGRATION_STATES).toEqual(['AVAILABLE', 'CONNECTED', 'NOT_CONNECTED', 'PLANNED']);
  });

  it('offers no connect action on a planned integration', () => {
    /*
     * The specific way an integrations screen fakes functionality: not by claiming a feature works,
     * but by offering an action that does nothing, which the user discovers by pressing it.
     */
    expect(offersConnect('PLANNED')).toBe(false);
    expect(offersConnect('NOT_CONNECTED')).toBe(true);
    expect(offersConnect('AVAILABLE')).toBe(true);
  });

  it('declares every V1 integration as planned, because none is built', () => {
    // The truthful state. The alternatives are an empty screen, which tells a user nothing about
    // whether integration is coming, or plausible-looking connectors, which tell them something false.
    expect(INTEGRATIONS.every((i) => i.state === 'PLANNED')).toBe(true);
    expect(IMPLEMENTED_CONNECTORS.size).toBe(0);
  });

  it('says what each integration still would not do', () => {
    /*
     * Every integration is oversold by omission — people assume a connected source control means the
     * platform knows what the code does. The cheapest correction is to say what it does not.
     */
    for (const integration of INTEGRATIONS) {
      expect(integration.whatItStillCannotDo.length, integration.key).toBeGreaterThan(40);
    }
  });

  it('finds nothing wrong with the catalogue as it stands', () => {
    expect(checkIntegrations(INTEGRATIONS, IMPLEMENTED_CONNECTORS)).toEqual([]);
  });

  it('catches an integration claiming to be built when it is not', () => {
    /*
     * The check that makes §44 enforceable rather than aspirational: declaring any state other than
     * PLANNED without the connector behind it fails the build.
     */
    const dishonest = INTEGRATIONS.map((i) =>
      i.key === 'source-control' ? { ...i, state: 'AVAILABLE' as const } : i,
    );

    const findings = checkIntegrations(dishonest, IMPLEMENTED_CONNECTORS);

    expect(findings.map((f) => f.defect)).toContain('CONNECTED_WITHOUT_A_CONNECTOR');
  });

  it('catches an integration with no stated limitation', () => {
    const vague = INTEGRATIONS.map((i) =>
      i.key === 'calendar' ? { ...i, whatItStillCannotDo: '' } : i,
    );

    expect(checkIntegrations(vague, IMPLEMENTED_CONNECTORS).map((f) => f.defect)).toContain(
      'NO_LIMITATION_STATED',
    );
  });

  it('follows §44’s recommended order rather than listing alphabetically', () => {
    // The screen should read as a sequence — what is coming first — rather than as a menu.
    expect(INTEGRATIONS.map((i) => i.key).slice(0, 4)).toEqual([
      'source-control',
      'ci-cd',
      'calendar',
      'monitoring',
    ]);
  });
});
