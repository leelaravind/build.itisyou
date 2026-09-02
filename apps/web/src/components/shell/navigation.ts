import type { IconName } from '../ui/icon-paths.ts';
/**
 * Navigation model.
 *
 * Reconciles KI-011: the 50 exports contain three divergent sidebar shells, with inconsistent items,
 * inconsistent CTA labels, and scrambled item order on `project_health`.
 *
 * **The reconciliation.** Read closely, the three shells are not three designs — they are two
 * contexts and some drift:
 *
 *  - Shell A ("Project Command", 22 screens) and Shell B ("Delivery/Docs", 15 screens) differ only in
 *    that B appends Export and Archive. The `team_resources` render shows *both* sets present at
 *    once, which confirms they are one shell that lost items in some exports rather than two designs.
 *    They collapse into a single **project shell** with a primary section and a utility section.
 *  - Shell C ("Org/Governance", 8 screens) is a genuinely different context — organisation-level,
 *    not project-level. It stays separate, because merging it would put project actions in front of
 *    a user who has not chosen a project.
 *
 * So: two shells, not three. The four "deviant" screens the audit flagged (documents_hub and
 * evidence adding Documents; budget swapping Risk for Control; architecture swapping Resources for
 * Architecture) are contextual additions, modelled here as `contextual` items rather than as
 * separate shells.
 *
 * Primary navigation is `Home · Plan · Execute · Control · Documents · Insights`, which the render
 * confirms and which plan section 2.4 independently specifies. Design and contract agree.
 */

export interface NavItem {
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
  /** Route template; `:id` is replaced with the active project id. */
  readonly href: string;
  /**
   * Complexity modes in which this item is shown. Progressive disclosure (plan section 2.4):
   * a beginner should not face the full governance surface on day one.
   */
  readonly modes: readonly ComplexityMode[];
}

export const COMPLEXITY_MODES = ['beginner', 'professional', 'enterprise'] as const;
export type ComplexityMode = (typeof COMPLEXITY_MODES)[number];

const ALL: readonly ComplexityMode[] = COMPLEXITY_MODES;
const PRO_UP: readonly ComplexityMode[] = ['professional', 'enterprise'];
const ENTERPRISE: readonly ComplexityMode[] = ['enterprise'];

/** Top bar. Plan section 2.4: "Home · Plan · Execute · Control · Documents · Insights". */
export const PRIMARY_NAV: readonly NavItem[] = [
  { id: 'home', label: 'Home', icon: 'home', href: '/p/:id', modes: ALL },
  { id: 'plan', label: 'Plan', icon: 'map', href: '/p/:id/roadmap', modes: ALL },
  { id: 'execute', label: 'Execute', icon: 'play_circle', href: '/p/:id/board', modes: ALL },
  { id: 'control', label: 'Control', icon: 'verified_user', href: '/p/:id/gates', modes: PRO_UP },
  {
    id: 'documents',
    label: 'Documents',
    icon: 'description',
    href: '/p/:id/documents',
    modes: ALL,
  },
  { id: 'insights', label: 'Insights', icon: 'monitoring', href: '/p/:id/health', modes: PRO_UP },
];

export interface NavSection {
  readonly id: string;
  /** Rendered as a `label-caps` overline, per DESIGN.md. Omitted for the first section. */
  readonly label?: string;
  readonly items: readonly NavItem[];
}

/**
 * Project sidebar — the reconciliation of shells A and B.
 *
 * Order follows the `team_resources` render (Overview, Phases, Resources, Risk, Quality, Analytics,
 * then Export, Archive), which is the order the majority of exports agree on. `project_health`'s
 * scrambled order is treated as export drift, not intent.
 */
export const PROJECT_NAV: readonly NavSection[] = [
  {
    id: 'primary',
    items: [
      { id: 'overview', label: 'Overview', icon: 'dashboard', href: '/p/:id', modes: ALL },
      { id: 'today', label: 'Today', icon: 'bolt', href: '/p/:id/today', modes: ALL },
      { id: 'phases', label: 'Phases', icon: 'layers', href: '/p/:id/roadmap', modes: ALL },
      { id: 'resources', label: 'Resources', icon: 'group', href: '/p/:id/team', modes: PRO_UP },
      { id: 'risk', label: 'Risk', icon: 'warning', href: '/p/:id/risks', modes: ALL },
      { id: 'quality', label: 'Quality', icon: 'verified', href: '/p/:id/gates', modes: PRO_UP },
      {
        id: 'analytics',
        label: 'Analytics',
        icon: 'analytics',
        href: '/p/:id/health',
        modes: PRO_UP,
      },
    ],
  },
  {
    id: 'engineering',
    label: 'Engineering',
    items: [
      {
        id: 'requirements',
        label: 'Requirements',
        icon: 'checklist',
        href: '/p/:id/requirements',
        modes: PRO_UP,
      },
      {
        id: 'architecture',
        label: 'Architecture',
        icon: 'account_tree',
        href: '/p/:id/architecture',
        modes: PRO_UP,
      },
      {
        id: 'traceability',
        label: 'Traceability',
        icon: 'polyline',
        href: '/p/:id/traceability',
        modes: ENTERPRISE,
      },
    ],
  },
  {
    id: 'utility',
    label: 'Project',
    items: [
      { id: 'export', label: 'Export', icon: 'download', href: '/p/:id/export', modes: PRO_UP },
      {
        id: 'archive',
        label: 'Archive',
        icon: 'inventory_2',
        href: '/p/:id/archive',
        modes: PRO_UP,
      },
      { id: 'settings', label: 'Settings', icon: 'settings', href: '/p/:id/settings', modes: ALL },
    ],
  },
];

/** Organisation sidebar — shell C, kept separate because it is a different context, not drift. */
export const ORG_NAV: readonly NavSection[] = [
  {
    id: 'primary',
    items: [
      {
        id: 'org-overview',
        label: 'Overview',
        icon: 'corporate_fare',
        href: '/org/:id',
        modes: ALL,
      },
      { id: 'projects', label: 'Projects', icon: 'folder', href: '/projects', modes: ALL },
      {
        id: 'org-resources',
        label: 'Resource Map',
        icon: 'group',
        href: '/org/:id/resources',
        modes: PRO_UP,
      },
      {
        id: 'members',
        label: 'Members & Roles',
        icon: 'manage_accounts',
        href: '/org/:id/members',
        modes: PRO_UP,
      },
    ],
  },
  {
    id: 'governance',
    label: 'Governance',
    items: [
      {
        id: 'integrations',
        label: 'Integrations',
        icon: 'extension',
        href: '/org/:id/integrations',
        modes: PRO_UP,
      },
    ],
  },
];

/** Substitute the active id into a route template. */
export function resolveHref(template: string, id: string): string {
  return template.replace(':id', id);
}

/** Items visible in a given complexity mode (plan section 2.4 progressive disclosure). */
export function visibleItems(items: readonly NavItem[], mode: ComplexityMode): readonly NavItem[] {
  return items.filter((item) => item.modes.includes(mode));
}

/** Sections with their items filtered, dropping any section left empty. */
export function visibleSections(
  sections: readonly NavSection[],
  mode: ComplexityMode,
): readonly NavSection[] {
  return sections
    .map((section) => ({ ...section, items: visibleItems(section.items, mode) }))
    .filter((section) => section.items.length > 0);
}

/**
 * The nav item matching a pathname.
 *
 * Longest match wins, so `/p/1/roadmap` selects Phases rather than Overview — a naive prefix match
 * would highlight Overview on every project page, since `/p/:id` prefixes them all.
 */
export function activeItemId(
  sections: readonly NavSection[],
  pathname: string,
  projectId: string,
): string | undefined {
  let best: { id: string; length: number } | undefined;

  for (const section of sections) {
    for (const item of section.items) {
      const href = resolveHref(item.href, projectId);
      if (pathname === href || pathname.startsWith(`${href}/`)) {
        if (best === undefined || href.length > best.length) {
          best = { id: item.id, length: href.length };
        }
      }
    }
  }

  return best?.id;
}
