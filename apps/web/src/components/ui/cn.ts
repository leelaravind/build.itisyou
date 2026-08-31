/**
 * Class name joiner.
 *
 * Deliberately not `clsx` + `tailwind-merge`: at Phase 2 there is no conflicting-class problem to
 * solve, and adding two dependencies to concatenate strings would fail the plan's own test
 * (section 38: "never introduce major infrastructure without evidence it is needed"). Revisit if
 * variant-heavy components start fighting over the same utility.
 */
export function cn(...parts: readonly (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
