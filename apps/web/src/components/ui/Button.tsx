import { cn } from './cn.ts';
import { MaterialIcon } from './MaterialIcon.tsx';

/**
 * Button.
 *
 * Per DESIGN.md: "Primary buttons use primary_color_hex with white or near-white text. Ghost buttons
 * use border-subtle and no background until hover."
 *
 * Radius is `rounded` (0.25rem) — the remap of the exports' `rounded-lg`, per
 * docs/DESIGN_HANDOFF_SPEC.md D2.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

const VARIANTS: Readonly<Record<ButtonVariant, string>> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-fixed active:bg-primary-container',
  secondary:
    'bg-surface-container-high text-on-surface border border-outline-variant hover:bg-surface-container-highest',
  // `border-subtle` in the exports resolved to nothing (KI-001); it maps to outline-variant.
  ghost:
    'border border-outline-variant text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
  danger: 'bg-danger text-on-error hover:bg-error-container hover:text-on-error-container',
};

const SIZES: Readonly<Record<ButtonSize, string>> = {
  sm: 'px-sm py-xs text-body-sm gap-xs',
  md: 'px-md py-sm text-body-sm gap-sm',
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /** Material Symbols name rendered before the label. */
  readonly icon?: string;
  readonly loading?: boolean;
  /**
   * Required when the button has no visible text. An icon-only button with no accessible name is
   * the single most common serious accessibility defect in dashboard UIs.
   */
  readonly label?: string;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  loading = false,
  label,
  children,
  className,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  const isDisabled = disabled === true || loading;

  return (
    <button
      // Defaults to "button". An unspecified <button> inside a form defaults to "submit", which
      // silently submits the form — a classic source of accidental mutations.
      type={type === 'submit' ? 'submit' : type === 'reset' ? 'reset' : 'button'}
      disabled={isDisabled}
      // `aria-busy` tells assistive tech the control is working; the disabled state alone does not.
      aria-busy={loading}
      {...(children === undefined && label !== undefined ? { 'aria-label': label } : {})}
      className={cn(
        'inline-flex items-center justify-center rounded font-sans font-medium transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <MaterialIcon name="progress_activity" size={16} className="animate-spin" />
      ) : icon === undefined ? null : (
        <MaterialIcon name={icon} size={16} />
      )}
      {children}
    </button>
  );
}
