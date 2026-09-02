import { cn } from './cn.ts';
import { MaterialIcon } from './MaterialIcon.tsx';
import type { IconName } from './icon-paths.ts';

/**
 * Empty state.
 *
 * **Designed net-new (KI-008).** This component appears in *zero* of the 50 Stitch exports —
 * `execution_board/code.html` carries the literal comment `<!-- Empty State visually implied by
 * space -->`. Empty space is not an empty state: it leaves the user unable to tell "nothing here
 * yet" from "still loading" from "your filter excluded everything" from "you lack permission".
 *
 * Built from the established design system per gap-spec section 3.5 — existing tokens, existing
 * primitives, no new visual language.
 *
 * The `variant` distinction is the point. Plan section 24 lists empty, no-permission and error as
 * *separate* required states, and conflating them is a real usability failure: telling someone
 * "no results" when the truth is "you cannot see these" sends them hunting for data that is there.
 */

export type EmptyStateVariant =
  /** Nothing exists yet. The user can create the first one. */
  | 'empty'
  /** Things exist, but the current filter or search matched none of them. */
  | 'no-matches'
  /** Things exist, but this user is not permitted to see them. */
  | 'no-permission'
  /** Loading failed. Distinct from empty — retrying makes sense here. */
  | 'error';

const VARIANTS: Readonly<
  Record<EmptyStateVariant, { icon: IconName; tone: string; defaultTitle: string }>
> = {
  empty: {
    icon: 'inbox',
    tone: 'text-on-surface-variant',
    defaultTitle: 'Nothing here yet',
  },
  'no-matches': {
    icon: 'filter_alt_off',
    tone: 'text-on-surface-variant',
    defaultTitle: 'No matches',
  },
  'no-permission': {
    icon: 'lock',
    tone: 'text-unknown',
    defaultTitle: 'You do not have access to this',
  },
  error: {
    icon: 'error',
    tone: 'text-danger',
    defaultTitle: 'Could not load this',
  },
};

interface EmptyStateProps {
  readonly variant?: EmptyStateVariant;
  readonly title?: string;
  /** One sentence on what this means and what to do about it. */
  readonly description?: string;
  /** Primary action, e.g. "Create the first requirement" or "Clear filters". */
  readonly action?: React.ReactNode;
  readonly className?: string;
  readonly compact?: boolean;
}

export function EmptyState({
  variant = 'empty',
  title,
  description,
  action,
  className,
  compact = false,
}: EmptyStateProps) {
  const config = VARIANTS[variant];

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed border-outline-variant text-center',
        compact ? 'gap-sm p-lg' : 'gap-md p-3xl',
        className,
      )}
      // `status` rather than `alert`: this is informational, and an assertive live region would
      // interrupt a screen-reader user mid-sentence every time a filter changed.
      role="status"
    >
      <MaterialIcon name={config.icon} size={compact ? 24 : 32} className={config.tone} />

      <p className={cn('font-sans text-body-md text-on-surface', compact && 'text-body-sm')}>
        {title ?? config.defaultTitle}
      </p>

      {description === undefined ? null : (
        <p className="max-w-narrow font-sans text-body-sm text-on-surface-variant">{description}</p>
      )}

      {action === undefined ? null : <div className="mt-sm">{action}</div>}
    </div>
  );
}
