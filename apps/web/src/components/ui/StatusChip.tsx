import { cn } from './cn.ts';
import {
  GATE_STATE_DESCRIPTORS,
  HEALTH_DESCRIPTORS,
  SEVERITY_DESCRIPTORS,
  TONE_CLASSES,
  VALIDATION_DESCRIPTORS,
  type GateState,
  type HealthState,
  type Severity,
  type StatusDescriptor,
  type ValidationState,
} from './status.ts';
import { MaterialIcon } from './MaterialIcon.tsx';

/**
 * Status chip - the single way status is rendered anywhere in the product.
 *
 * Appears on ~40 of the 50 designed screens. Deliberately has no `color` or `icon` prop: the caller
 * names a *status*, and the icon, label and tone come from the descriptor table. That is what makes
 * the non-colour encoding required by plan section 25 structural rather than a convention someone can
 * forget on one screen out of forty.
 */

interface BaseProps {
  readonly className?: string;
  /** Compact form for dense tables (Enterprise density). */
  readonly compact?: boolean;
}

function Chip({
  descriptor,
  className,
  compact,
}: BaseProps & { readonly descriptor: StatusDescriptor }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-xs rounded-sm border font-mono uppercase',
        compact ? 'px-xs py-0 text-data-mono-sm' : 'px-sm py-xs text-data-mono-sm',
        TONE_CLASSES[descriptor.tone],
        className,
      )}
    >
      {/* aria-hidden: the icon duplicates the visible label, so announcing it would be noise.
          It exists as the non-colour visual channel, not as an extra label. */}
      <MaterialIcon name={descriptor.icon} size={compact ? 12 : 14} aria-hidden />
      <span>{descriptor.label}</span>
      {/* The description is available to assistive tech where the terse label is ambiguous. */}
      <span className="sr-only"> — {descriptor.description}</span>
    </span>
  );
}

export function GateStateChip({ state, ...rest }: BaseProps & { readonly state: GateState }) {
  return <Chip descriptor={GATE_STATE_DESCRIPTORS[state]} {...rest} />;
}

export function HealthChip({ state, ...rest }: BaseProps & { readonly state: HealthState }) {
  return <Chip descriptor={HEALTH_DESCRIPTORS[state]} {...rest} />;
}

export function SeverityChip({ severity, ...rest }: BaseProps & { readonly severity: Severity }) {
  return <Chip descriptor={SEVERITY_DESCRIPTORS[severity]} {...rest} />;
}

export function ValidationChip({
  state,
  ...rest
}: BaseProps & { readonly state: ValidationState }) {
  return <Chip descriptor={VALIDATION_DESCRIPTORS[state]} {...rest} />;
}
