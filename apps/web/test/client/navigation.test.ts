/**
 * Navigation model tests.
 *
 * Covers the KI-011 reconciliation (three divergent export sidebars collapsed into two contexts),
 * plan section 2.4's locked primary navigation, and progressive disclosure across the
 * Beginner/Professional/Enterprise complexity modes.
 */

import { describe, it, expect } from 'vitest';
import {
  COMPLEXITY_MODES,
  ORG_NAV,
  PRIMARY_NAV,
  PROJECT_NAV,
  activeItemId,
  resolveHref,
  visibleItems,
  visibleSections,
  type NavItem,
} from '../../src/components/shell/navigation.ts';

const allItems = (sections: readonly { items: readonly NavItem[] }[]): NavItem[] =>
  sections.flatMap((s) => [...s.items]);

describe('primary navigation matches the locked specification', () => {
  it('is exactly Home, Plan, Execute, Control, Documents, Insights', () => {
    // Plan section 2.4 specifies this, and the team_resources render independently confirms it.
    expect(PRIMARY_NAV.map((i) => i.label)).toEqual([
      'Home',
      'Plan',
      'Execute',
      'Control',
      'Documents',
      'Insights',
    ]);
  });

  it('gives every primary item a route and an icon', () => {
    for (const item of PRIMARY_NAV) {
      expect(item.href.length).toBeGreaterThan(0);
      expect(item.icon.length).toBeGreaterThan(0);
    }
  });
});

describe('progressive disclosure across complexity modes', () => {
  it('shows a beginner strictly fewer items than an enterprise user', () => {
    // Plan section 2.4: progressive disclosure. A beginner must not meet the full governance
    // surface on day one.
    const beginner = visibleItems(allItems(PROJECT_NAV), 'beginner').length;
    const enterprise = visibleItems(allItems(PROJECT_NAV), 'enterprise').length;

    expect(beginner).toBeLessThan(enterprise);
  });

  it('never shows an item to a beginner that is hidden from professionals', () => {
    // Disclosure must be monotonic: each mode is a superset of the one below it. A non-monotonic
    // nav would mean an item vanishing as the user grows more expert.
    const beginner = new Set(visibleItems(allItems(PROJECT_NAV), 'beginner').map((i) => i.id));
    const professional = new Set(
      visibleItems(allItems(PROJECT_NAV), 'professional').map((i) => i.id),
    );

    for (const id of beginner)
      expect(professional.has(id), `${id} vanishes above beginner`).toBe(true);
  });

  it('never shows an item to a professional that is hidden from enterprise', () => {
    const professional = new Set(
      visibleItems(allItems(PROJECT_NAV), 'professional').map((i) => i.id),
    );
    const enterprise = new Set(visibleItems(allItems(PROJECT_NAV), 'enterprise').map((i) => i.id));

    for (const id of professional) {
      expect(enterprise.has(id), `${id} vanishes above professional`).toBe(true);
    }
  });

  it('keeps the core journey available to beginners', () => {
    // Guest-first (plan section 2.3) plus Today/Focus and Next Action (gap-spec section 24) are the
    // spine of the product. They must never be gated behind a complexity mode.
    const beginner = visibleItems(allItems(PROJECT_NAV), 'beginner').map((i) => i.id);

    expect(beginner).toContain('overview');
    expect(beginner).toContain('today');
    expect(beginner).toContain('risk');
    expect(beginner).toContain('settings');
  });

  it.each(COMPLEXITY_MODES)('leaves no empty section visible in %s mode', (mode) => {
    for (const section of visibleSections(PROJECT_NAV, mode)) {
      expect(section.items.length, `section "${section.id}" rendered empty`).toBeGreaterThan(0);
    }
  });

  it('reserves traceability for enterprise', () => {
    const professional = visibleItems(allItems(PROJECT_NAV), 'professional').map((i) => i.id);
    expect(professional).not.toContain('traceability');

    const enterprise = visibleItems(allItems(PROJECT_NAV), 'enterprise').map((i) => i.id);
    expect(enterprise).toContain('traceability');
  });
});

describe('route resolution', () => {
  it('substitutes the active project id', () => {
    expect(resolveHref('/p/:id/roadmap', 'proj_42')).toBe('/p/proj_42/roadmap');
  });

  it('leaves templates without a placeholder untouched', () => {
    expect(resolveHref('/projects', 'proj_42')).toBe('/projects');
  });
});

describe('active item detection', () => {
  it('selects the longest matching route, not the first', () => {
    // `/p/:id` prefixes every project page, so a naive prefix match would highlight Overview
    // everywhere.
    expect(activeItemId(PROJECT_NAV, '/p/proj_1/roadmap', 'proj_1')).toBe('phases');
  });

  it('selects Overview on the project root', () => {
    expect(activeItemId(PROJECT_NAV, '/p/proj_1', 'proj_1')).toBe('overview');
  });

  it('stays selected on a nested child route', () => {
    expect(activeItemId(PROJECT_NAV, '/p/proj_1/requirements/REQ-001', 'proj_1')).toBe(
      'requirements',
    );
  });

  it('returns undefined for a route outside the shell', () => {
    expect(activeItemId(PROJECT_NAV, '/login', 'proj_1')).toBeUndefined();
  });

  it('does not match a route that merely shares a prefix string', () => {
    // `/p/proj_1/risks-archive` must not activate `/p/proj_1/risks`.
    expect(activeItemId(PROJECT_NAV, '/p/proj_1/risksarchive', 'proj_1')).toBe('overview');
  });
});

describe('KI-011 reconciliation', () => {
  it('resolves the three export shells into two contexts', () => {
    // Shells A and B differed only by Export/Archive and are one shell; shell C is organisation
    // context, which is genuinely separate.
    const projectIds = new Set(allItems(PROJECT_NAV).map((i) => i.id));
    const orgIds = new Set(allItems(ORG_NAV).map((i) => i.id));

    expect(projectIds.size).toBeGreaterThan(0);
    expect(orgIds.size).toBeGreaterThan(0);
  });

  it('keeps Export and Archive, which only shell B carried', () => {
    const ids = allItems(PROJECT_NAV).map((i) => i.id);
    expect(ids).toContain('export');
    expect(ids).toContain('archive');
  });

  it('keeps Architecture, which only the architecture screen carried', () => {
    // One of the four "deviant" screens the design audit flagged. It is a real destination, not
    // drift, so it becomes a contextual item rather than a separate shell.
    expect(allItems(PROJECT_NAV).map((i) => i.id)).toContain('architecture');
  });

  it('does not put project actions in the organisation shell', () => {
    // Merging shell C would surface project navigation to a user who has not picked a project.
    const orgIds = allItems(ORG_NAV).map((i) => i.id);
    expect(orgIds).not.toContain('today');
    expect(orgIds).not.toContain('quality');
  });

  it('gives every item a unique id within its shell', () => {
    for (const [name, nav] of [
      ['project', PROJECT_NAV],
      ['org', ORG_NAV],
    ] as const) {
      const ids = allItems(nav).map((i) => i.id);
      expect(new Set(ids).size, `${name} shell has duplicate ids`).toBe(ids.length);
    }
  });

  it('gives every item a non-empty label, icon and href', () => {
    for (const item of [...allItems(PROJECT_NAV), ...allItems(ORG_NAV), ...PRIMARY_NAV]) {
      expect(item.label.length, `${item.id} label`).toBeGreaterThan(0);
      expect(item.icon.length, `${item.id} icon`).toBeGreaterThan(0);
      expect(item.href.startsWith('/'), `${item.id} href`).toBe(true);
    }
  });

  it('declares at least one complexity mode for every item', () => {
    // An item with no modes would be permanently invisible — dead navigation.
    for (const item of [...allItems(PROJECT_NAV), ...allItems(ORG_NAV), ...PRIMARY_NAV]) {
      expect(item.modes.length, `${item.id} is never visible`).toBeGreaterThan(0);
    }
  });
});
