/**
 * The portfolio: many projects, one view.
 *
 * This is the only query in the platform that deliberately spans projects, which makes it the easiest
 * place to leak. Every other surface is scoped to one project and fails closed; this one is scoped to
 * an organisation and has to decide, project by project, what the viewer may see — and an aggregate
 * that includes a project the viewer cannot open **is a disclosure**, even when the project
 * contributes only a number.
 *
 * That is the subtle part. "Seven projects are at risk" tells somebody there are seven projects, and
 * if they can only open four, the other three have been disclosed to them: their existence, their
 * count, and something about their state. A tenanted product leaks here far more often than through
 * a missing ownership check, because the leak looks like a feature.
 *
 * The second position is the same one this platform takes everywhere else, applied one level up:
 * **a portfolio does not average health across projects.** A portfolio of one healthy project and one
 * on fire is not "moderately healthy". It is a portfolio with a project on fire, and the roll-up
 * names it.
 *
 * Contract: gap-spec §7.1, §7.5 (tenant isolation); `MASTER_IMPLEMENTATION_PLAN.md` Phase 15.
 */

import { can, type AccessContext, type Permission } from '@govintel/db/rbac';
import type { OrganizationRole, ProjectRole } from '@govintel/db/schema';

/* -------------------------------------------------------------------------- */
/* Entries                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One project as it appears in a portfolio.
 *
 * Health and feasibility come through as the statuses the finance engine produced. They are not
 * recomputed here and they are never combined into a number — this module's job is to decide what a
 * viewer may see, not to reinterpret what another engine concluded.
 */
export interface PortfolioProject {
  readonly projectId: string;
  readonly organizationId: string;
  readonly name: string;
  readonly lifecycleState: string;
  readonly health: string;
  readonly feasibility: string;
  /** Why the health is what it is. Carried through so the portfolio explains rather than asserts. */
  readonly healthBecause: string;
  readonly archived: boolean;
  /** The viewer's role on this specific project, if any. */
  readonly projectRole?: ProjectRole;
  /**
   * Whether organisation-level read is enough to see this project.
   *
   * Added because without it the partial-view protection below was **inert**. The RBAC model grants
   * `project:read` to every organisation role, so every member of an organisation could see every
   * project in it, `partialView` was always false, and the code guarding against disclosing
   * invisible projects guarded against a situation that could not arise.
   *
   * A control that cannot fire is worse than no control: it reads as protection in review, and it is
   * the third time in this project something has been present and inert (SEC-001, KI-031).
   *
   * The concept it was missing is a genuine one. Organisations run client work, acquisitions and
   * disciplinary matters, and "everybody in the company can read this" is the wrong default for those
   * — so a restricted project requires an explicit project role, and organisation membership alone
   * does not open it.
   */
  readonly restricted?: boolean;
}

export interface Viewer {
  readonly userId: string;
  readonly organizationId: string;
  readonly organizationRole: OrganizationRole;
}

/* -------------------------------------------------------------------------- */
/* Visibility                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Whether this viewer may see this project at all.
 *
 * Wrong organisation is refused before anything else is considered, and that ordering matters: a
 * check that evaluated the role first would let a bug in role resolution produce cross-tenant
 * visibility, which is the failure this whole model exists to prevent.
 */
export function maySee(viewer: Viewer, project: PortfolioProject): boolean {
  if (project.organizationId !== viewer.organizationId) return false;

  // A restricted project needs an explicit role on that project. Organisation membership is not
  // enough, and an owner is not exempt — the point of restriction is that it is narrower than the
  // organisation, and an exemption for the most powerful role removes exactly the case it exists for.
  if (project.restricted === true && project.projectRole === undefined) return false;

  return can(contextFor(viewer, project), 'project:read');
}

function contextFor(viewer: Viewer, project: PortfolioProject): AccessContext {
  return {
    organizationRole: viewer.organizationRole,
    ...(project.projectRole === undefined ? {} : { projectRole: project.projectRole }),
  };
}

/**
 * Whether this viewer may see a particular kind of detail about a project.
 *
 * Visibility is not one decision. Somebody can legitimately see that a project exists and its health,
 * and not its budget — and a portfolio that treats "can see" as a single boolean either hides
 * projects it should show or shows figures it should not.
 */
export function maySeeDetail(
  viewer: Viewer,
  project: PortfolioProject,
  permission: Permission,
): boolean {
  if (!maySee(viewer, project)) return false;
  return can(contextFor(viewer, project), permission);
}

/* -------------------------------------------------------------------------- */
/* The roll-up                                                                */
/* -------------------------------------------------------------------------- */

export interface PortfolioEntry {
  readonly projectId: string;
  readonly name: string;
  readonly lifecycleState: string;
  readonly health: string;
  readonly healthBecause: string;
  readonly archived: boolean;
  /** Whether this viewer may see the project's money. Decided per project, not per portfolio. */
  readonly budgetVisible: boolean;
}

export interface Portfolio {
  /** Only the projects this viewer may see. Nothing about the others reaches this object. */
  readonly entries: readonly PortfolioEntry[];
  /**
   * Counts by health, over the visible projects only.
   *
   * Absolute numbers, never a proportion, and never an average of health across projects. A portfolio
   * of one healthy project and one on fire is not moderately healthy.
   */
  readonly counts: Readonly<Record<string, number>>;
  /** The project most worth looking at, or null when there is genuinely nothing. */
  readonly needsAttention: PortfolioEntry | null;
  readonly headline: string;
  /**
   * Whether the viewer's list is limited by their permissions rather than by the organisation being
   * empty.
   *
   * Reported as a *fact about the viewer's access*, never as a count of what they cannot see. "You
   * cannot see everything here" is honest; "3 projects are hidden from you" discloses that there are
   * three.
   */
  readonly partialView: boolean;
}

/**
 * Ordering by how much attention a project needs.
 *
 * Deliberately not by name, date or size. A portfolio sorted alphabetically makes the reader do the
 * scanning, and the whole reason to have one is that nobody has time to open eleven projects.
 */
const HEALTH_ORDER: Readonly<Record<string, number>> = {
  CRITICAL: 0,
  AT_RISK: 1,
  WATCH: 2,
  UNKNOWN: 3,
  HEALTHY: 4,
};

export function buildPortfolio(viewer: Viewer, projects: readonly PortfolioProject[]): Portfolio {
  const visible = projects.filter((project) => maySee(viewer, project));

  const entries = visible
    .map((project): PortfolioEntry => ({
      projectId: project.projectId,
      name: project.name,
      lifecycleState: project.lifecycleState,
      health: project.health,
      healthBecause: project.healthBecause,
      archived: project.archived,
      budgetVisible: maySeeDetail(viewer, project, 'budget:read'),
    }))
    .sort(
      (a, b) =>
        // Archived last regardless of health: a critical project that ended is not the thing to look
        // at this morning, and leaving it at the top buries the live one underneath it.
        Number(a.archived) - Number(b.archived) ||
        (HEALTH_ORDER[a.health] ?? 3) - (HEALTH_ORDER[b.health] ?? 3) ||
        a.projectId.localeCompare(b.projectId),
    );

  const counts: Record<string, number> = {};
  for (const entry of entries) {
    counts[entry.health] = (counts[entry.health] ?? 0) + 1;
  }

  const live = entries.filter((entry) => !entry.archived);
  const worst = live.find((entry) => entry.health !== 'HEALTHY' && entry.health !== 'UNKNOWN');

  /*
   * A viewer sees fewer projects than exist in their organisation.
   *
   * Reported as a boolean, never as a count. Saying "3 projects are hidden from you" discloses that
   * there are three — which is precisely the information the permission was withholding.
   */
  const inOrganisation = projects.filter((p) => p.organizationId === viewer.organizationId);
  const partialView = visible.length < inOrganisation.length;

  return {
    entries,
    counts,
    needsAttention: worst ?? null,
    partialView,
    headline: headlineFor(entries, live, worst, partialView),
  };
}

function headlineFor(
  entries: readonly PortfolioEntry[],
  live: readonly PortfolioEntry[],
  worst: PortfolioEntry | undefined,
  partialView: boolean,
): string {
  if (entries.length === 0) {
    /*
     * The distinction §25's silence rule creates, one level up.
     *
     * "No projects" and "no projects you can see" look identical and mean opposite things — one is an
     * empty organisation, the other is a permissions question. A portfolio that renders them the same
     * sends somebody to create a project that already exists.
     */
    return partialView
      ? 'You cannot see any projects in this organisation. There are some; your access does not extend to them.'
      : 'No projects yet.';
  }

  const suffix = partialView
    ? ' This is not everything in the organisation — your access does not extend to all of it.'
    : '';

  if (worst === undefined) {
    return `${String(live.length)} live project${live.length === 1 ? '' : 's'}, none reporting a problem.${suffix}`;
  }

  // Names the project rather than counting problems. A count tells somebody how bad the morning is;
  // a name tells them where to start.
  return `${worst.name} needs attention: ${worst.healthBecause}${suffix}`;
}

/* -------------------------------------------------------------------------- */
/* Cross-project resources                                                    */
/* -------------------------------------------------------------------------- */

export interface ResourceLoad {
  readonly resourceId: string;
  readonly name: string;
  /** Project ids this person is assigned to, among the ones the viewer may see. */
  readonly projectIds: readonly string[];
  /** Their stated allocation to each, summed. */
  readonly totalAllocation: number;
}

/**
 * Who is committed to more than one project, and by how much.
 *
 * The one genuinely cross-project calculation worth making, because it is invisible from inside any
 * single project: each one sees a person at 60% and believes it has 60% of them, and nobody notices
 * the total until a delivery date slips for reasons that make no sense from where anybody is standing.
 *
 * Only projects the viewer may see contribute. That means the totals **understate** for a viewer with
 * partial access — and understating is the correct direction to be wrong in, because the alternative
 * is telling somebody about a commitment on a project they may not know exists.
 */
export function resourceLoad(
  viewer: Viewer,
  projects: readonly PortfolioProject[],
  assignments: readonly {
    readonly resourceId: string;
    readonly name: string;
    readonly projectId: string;
    readonly allocation: number;
  }[],
): readonly ResourceLoad[] {
  const visible = new Set(
    projects.filter((project) => maySee(viewer, project)).map((p) => p.projectId),
  );

  const byResource = new Map<string, { name: string; projectIds: string[]; total: number }>();

  for (const assignment of assignments) {
    if (!visible.has(assignment.projectId)) continue;

    const existing = byResource.get(assignment.resourceId) ?? {
      name: assignment.name,
      projectIds: [],
      total: 0,
    };

    existing.projectIds.push(assignment.projectId);
    existing.total += assignment.allocation;
    byResource.set(assignment.resourceId, existing);
  }

  return (
    [...byResource.entries()]
      .map(([resourceId, entry]) => ({
        resourceId,
        name: entry.name,
        projectIds: [...entry.projectIds].sort(),
        totalAllocation: entry.total,
      }))
      // Most committed first, then by id so the order is stable across runs on the same data.
      .sort(
        (a, b) => b.totalAllocation - a.totalAllocation || a.resourceId.localeCompare(b.resourceId),
      )
  );
}

/** People committed beyond their capacity across the projects this viewer can see. */
export function overcommitted(loads: readonly ResourceLoad[]): readonly ResourceLoad[] {
  return loads.filter((load) => load.totalAllocation > 1);
}
