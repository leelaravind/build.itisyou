import { cn } from './cn.ts';
import { ICON_PATHS, ICON_VIEW_BOX, type IconName } from './icon-paths.ts';

/**
 * A Material Symbols icon, drawn from geometry inlined at build time.
 *
 * Used on all 50 designed screens.
 *
 * ## Why this is not an icon font
 *
 * It was one, nominally. The component rendered the icon's *name* into a span carrying the class
 * `material-symbols-outlined` and relied on a ligature font to turn that word into a glyph. No
 * `@font-face` was ever written, no font file was ever committed and the class was never defined, so
 * the fallback that ran instead was the body font drawing the literal text: the header brand mark
 * read `settings_suggest`, and every button carried the word `arrow_forward` spilling out of a 20px
 * box. Three of the names — `settings_suggest`, `insights`, `auto_fix_high` — were Material *Icons*
 * names that Material Symbols does not contain, so they could not have rendered under any font.
 *
 * Nothing caught it. Icons are `aria-hidden`, so axe steps over them; the end-to-end suites address
 * the product by role and by text, and the text was still correct. The only symptom that ever
 * reached a test was six pixels of horizontal overflow on one phone-width page.
 *
 * Inlining removes the failure mode rather than this instance of it. There is no font to load, so
 * there is nothing to load late, partially, or not at all — and no flash of ligature text on a cold
 * cache, which a correctly served icon font still shows. It also keeps the CSP closed: fetching a
 * font from Google's CDN is forbidden (KI-007) and ruled out by plan §19's data minimisation.
 *
 * `name` is `IconName`, generated from the icons that actually exist, so an icon that is not there
 * fails the build instead of rendering as its own name.
 *
 * Icons are decorative by default. One that carries meaning on its own must be given a `label`,
 * which renders as screen-reader-only text beside it.
 */
interface MaterialIconProps {
  readonly name: IconName;
  readonly size?: number;
  readonly className?: string;
  /** Accessible name. Omit for decorative icons that sit next to visible text. */
  readonly label?: string;
}

export function MaterialIcon({ name, size = 20, className, label }: MaterialIconProps) {
  return (
    <>
      <svg
        viewBox={ICON_VIEW_BOX}
        width={size}
        height={size}
        fill="currentColor"
        /*
         * `shrink-0` because an icon is a fixed-size thing. As a flex item it would otherwise be
         * squashed by a long label beside it, which is how icons end up subtly different widths
         * down a list.
         */
        className={cn('shrink-0 select-none', className)}
        aria-hidden
        focusable="false"
        data-icon={name}
      >
        {ICON_PATHS[name].map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
      {label === undefined ? null : <span className="sr-only">{label}</span>}
    </>
  );
}
