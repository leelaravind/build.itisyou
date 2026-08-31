'use client';

import Link from 'next/link';
import { cn } from '../ui/cn.ts';
import { MaterialIcon } from '../ui/MaterialIcon.tsx';
import {
  PRIMARY_NAV,
  activeItemId,
  resolveHref,
  visibleItems,
  visibleSections,
  type ComplexityMode,
  type NavSection,
} from './navigation.ts';

/**
 * Application shell.
 *
 * Implements the layout confirmed by `team_resources/screen.png`: a global top bar carrying the
 * product mark and primary navigation, a contextual left sidebar, and the content region.
 *
 * The sidebar is passed in as data (`sections`) rather than hardcoded, which is what lets the
 * project and organisation contexts share one shell — the KI-011 reconciliation. See
 * `navigation.ts` for why the exports' three shells are two contexts.
 */

interface AppShellProps {
  readonly sections: readonly NavSection[];
  /** Project or organisation id substituted into route templates. */
  readonly contextId: string;
  readonly pathname: string;
  readonly mode?: ComplexityMode;
  /** Sidebar heading — project name, or organisation name. */
  readonly contextTitle: string;
  readonly contextSubtitle?: string;
  /** Primary call to action. Its label is contextual; the exports disagreed on it (KI-011). */
  readonly primaryAction?: React.ReactNode;
  readonly children: React.ReactNode;
}

export function AppShell({
  sections,
  contextId,
  pathname,
  mode = 'professional',
  contextTitle,
  contextSubtitle,
  primaryAction,
  children,
}: AppShellProps) {
  const active = activeItemId(sections, pathname, contextId);
  const visible = visibleSections(sections, mode);
  const primary = visibleItems(PRIMARY_NAV, mode);

  return (
    <div className="min-h-screen bg-background">
      {/* Keyboard users must be able to skip the nav. WCAG 2.4.1 - and with ~20 sidebar links,
          tabbing past them on every page is a genuine barrier, not a formality. */}
      <a
        href="#main"
        className="sr-only rounded bg-primary px-md py-sm text-on-primary focus:not-sr-only focus:absolute focus:top-sm focus:left-sm focus:z-[70]"
      >
        Skip to main content
      </a>

      <header
        className="sticky top-0 z-[20] flex h-14 items-center gap-sm border-b border-outline-variant bg-surface-container-low px-sm md:gap-lg md:px-md"
        // The status header is a landmark so screen-reader users can jump to it directly.
        aria-label="Global"
      >
        <Link
          href="/"
          className="truncate font-sans text-headline-sm text-primary transition-colors hover:text-primary-fixed"
        >
          GovIntel Platform
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-xs md:flex">
          {primary.map((item) => {
            const href = resolveHref(item.href, contextId);
            const isActive = pathname === href;
            return (
              <Link
                key={item.id}
                href={href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'rounded px-sm py-xs font-sans text-body-sm transition-colors',
                  isActive
                    ? 'bg-surface-container-high text-on-surface'
                    : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface',
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Four icon buttons overflow a 320px viewport (WCAG 1.4.10 Reflow). Search and
            notifications are the two a user needs at hand; settings and help are reachable from
            the sidebar. The full set returns with the mobile navigation in Phase 16. */}
        <div className="ml-auto flex shrink-0 items-center gap-xs">
          <ShellIconButton icon="search" label="Search" />
          <ShellIconButton icon="notifications" label="Notifications" />
          <ShellIconButton icon="settings" label="Settings" className="hidden sm:inline-flex" />
          <ShellIconButton icon="help" label="Help" className="hidden sm:inline-flex" />
        </div>
      </header>

      <div className="flex">
        <aside
          className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 flex-col gap-lg overflow-y-auto border-r border-outline-variant bg-surface-container-low p-md lg:flex"
          aria-label="Section"
        >
          <div>
            <p className="font-sans text-headline-sm text-on-surface">{contextTitle}</p>
            {contextSubtitle === undefined ? null : (
              <p className="mt-xs font-sans text-body-sm text-on-surface-variant">
                {contextSubtitle}
              </p>
            )}
          </div>

          {primaryAction === undefined ? null : <div>{primaryAction}</div>}

          <nav aria-label="Secondary" className="flex flex-col gap-lg">
            {visible.map((section) => (
              <div key={section.id} className="flex flex-col gap-xs">
                {section.label === undefined ? null : (
                  <p className="mb-xs px-sm font-sans text-label-caps tracking-wider text-on-surface-variant uppercase">
                    {section.label}
                  </p>
                )}

                {section.items.map((item) => {
                  const isActive = item.id === active;
                  return (
                    <Link
                      key={item.id}
                      href={resolveHref(item.href, contextId)}
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-sm rounded px-sm py-xs font-sans text-body-sm transition-colors',
                        isActive
                          ? 'bg-surface-container-high text-on-surface'
                          : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface',
                      )}
                    >
                      <MaterialIcon name={item.icon} size={18} />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
        </aside>

        <main id="main" className="min-w-0 flex-1 p-md lg:p-lg">
          {children}
        </main>
      </div>
    </div>
  );
}

function ShellIconButton({
  icon,
  label,
  className,
}: {
  readonly icon: string;
  readonly label: string;
  readonly className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        'inline-flex rounded p-xs text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
        className,
      )}
    >
      <MaterialIcon name={icon} size={20} />
    </button>
  );
}
