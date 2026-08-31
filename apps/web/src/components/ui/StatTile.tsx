import { cn } from './cn.ts';
import { MaterialIcon } from './MaterialIcon.tsx';
import { TONE_CLASSES, type StatusTone } from './status.ts';

/**
 * Stat tile — the KPI row that opens roughly a dozen of the designed screens.
 *
 * The `provenance` prop is not decoration. Plan section 12.3 forbids fake precision, and section 11.2
 * requires that the UI "never present assumption/inference as confirmed fact". A stat tile is exactly
 * where that rule gets broken in practice: a big confident number reads as measured truth even when
 * it is a deterministic estimate over assumed inputs.
 *
 * So a tile can carry a qualifier, and `range` exists so an uncertain figure can be shown as a range
 * rather than a spuriously precise single value.
 */

export type StatProvenance = 'measured' | 'calculated' | 'estimated' | 'assumed' | 'unknown';

const PROVENANCE_LABELS: Readonly<Record<StatProvenance, string | undefined>> = {
  // Measured values need no qualifier: they are observed fact.
  measured: undefined,
  calculated: 'Calculated',
  estimated: 'Estimated',
  assumed: 'Assumed',
  unknown: 'Unknown',
};

interface StatTileProps {
  readonly label: string;
  /** The headline figure. Omit when `range` is supplied. */
  readonly value?: string;
  /** Low/high bounds, for figures where a single number would be false precision. */
  readonly range?: { readonly low: string; readonly high: string };
  readonly unit?: string;
  readonly provenance?: StatProvenance;
  /** Change against baseline or previous period. */
  readonly delta?: {
    readonly value: string;
    readonly direction: 'up' | 'down';
    readonly tone: StatusTone;
  };
  readonly icon?: string;
  readonly className?: string;
}

export function StatTile({
  label,
  value,
  range,
  unit,
  provenance = 'measured',
  delta,
  icon,
  className,
}: StatTileProps) {
  const qualifier = PROVENANCE_LABELS[provenance];

  return (
    <div
      className={cn(
        'flex flex-col gap-xs rounded-lg border border-outline-variant bg-surface-container-low p-md',
        className,
      )}
    >
      <div className="flex items-center gap-xs">
        {icon === undefined ? null : (
          <MaterialIcon name={icon} size={16} className="text-on-surface-variant" />
        )}
        <p className="font-sans text-label-caps tracking-wider text-on-surface-variant uppercase">
          {label}
        </p>
      </div>

      <div className="flex items-baseline gap-xs">
        {range === undefined ? (
          <span className="font-mono text-headline-md text-on-surface">{value ?? '—'}</span>
        ) : (
          // A range, not a midpoint. Showing "£142,500" for a £120k–£165k estimate invents
          // precision the evidence does not support (plan section 12.3).
          <span className="font-mono text-headline-md text-on-surface">
            {range.low}
            <span className="mx-xs text-on-surface-variant">–</span>
            {range.high}
          </span>
        )}

        {unit === undefined ? null : (
          <span className="font-mono text-data-mono-sm text-on-surface-variant">{unit}</span>
        )}
      </div>

      <div className="flex items-center gap-sm">
        {qualifier === undefined ? null : (
          <span
            className={cn(
              'inline-flex items-center rounded-sm border px-xs font-mono text-data-mono-sm uppercase',
              TONE_CLASSES[provenance === 'unknown' ? 'unknown' : 'neutral'],
            )}
          >
            {qualifier}
          </span>
        )}

        {delta === undefined ? null : (
          <span
            className={cn(
              'inline-flex items-center gap-xs font-mono text-data-mono-sm',
              delta.tone === 'success' && 'text-success',
              delta.tone === 'danger' && 'text-danger',
              delta.tone === 'warning' && 'text-warning',
              delta.tone === 'neutral' && 'text-on-surface-variant',
            )}
          >
            {/* The arrow is the non-colour channel: an increase must be readable without
                distinguishing green from red (plan section 25). */}
            <MaterialIcon
              name={delta.direction === 'up' ? 'arrow_upward' : 'arrow_downward'}
              size={12}
            />
            {delta.value}
            <span className="sr-only">{delta.direction === 'up' ? ' increase' : ' decrease'}</span>
          </span>
        )}
      </div>
    </div>
  );
}
