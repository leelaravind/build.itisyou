import { cn } from './cn.ts';

/**
 * Material Symbols icon.
 *
 * Used on all 50 designed screens. The font is self-hosted rather than loaded from Google's CDN -
 * the exports fetch it at runtime, which the CSP forbids (KI-007) and which plan section 19's data
 * minimisation rules out.
 *
 * Icons are decorative by default (`aria-hidden`). An icon that carries meaning on its own must be
 * given a `label`, which renders as screen-reader-only text alongside it.
 */
interface MaterialIconProps {
  readonly name: string;
  readonly size?: number;
  readonly className?: string;
  /** Accessible name. Omit for decorative icons that sit next to visible text. */
  readonly label?: string;
  readonly 'aria-hidden'?: boolean;
  /** Render the filled variant. */
  readonly filled?: boolean;
}

export function MaterialIcon({
  name,
  size = 20,
  className,
  label,
  filled = false,
}: MaterialIconProps) {
  return (
    <>
      <span
        className={cn('material-symbols-outlined leading-none select-none', className)}
        style={{
          fontSize: `${String(size)}px`,
          width: `${String(size)}px`,
          height: `${String(size)}px`,
          ...(filled ? { fontVariationSettings: "'FILL' 1" } : {}),
        }}
        aria-hidden
        data-icon={name}
      >
        {name}
      </span>
      {label === undefined ? null : <span className="sr-only">{label}</span>}
    </>
  );
}
