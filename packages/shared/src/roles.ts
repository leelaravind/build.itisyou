/**
 * Project roles — the one canonical list.
 *
 * Contract: gap-spec §7.3 names exactly six project roles for V1.
 *
 * ## Why this lives in `shared` rather than beside the database enum
 *
 * It used to exist only as a `pgEnum` in `packages/db/src/schema.ts`, which meant the domain layer
 * could not see it: `packages/governance` depends on `shared` and `twin`, and making it depend on the
 * database package to read a list of six strings would invert the layering — infrastructure below
 * domain — for no reason.
 *
 * So `approval.ts` typed its sign-off requirements as `readonly string[]` and named
 * `ENGINEERING_LEAD` and `PRODUCT_OWNER`. Neither role exists anywhere in this system. The result was
 * a sign-off requirement that could never be satisfied by any member of any project, sitting in a
 * module with full test coverage — because the tests asserted the requirement was *returned*, and
 * agreed with it about what the roles were called.
 *
 * A vocabulary two layers must agree on belongs where both can reach it, typed, so disagreement is a
 * compile error rather than a runtime impossibility nobody notices.
 */

export const PROJECT_ROLES = [
  'PROJECT_OWNER',
  'PROJECT_MANAGER',
  'ENGINEER',
  'REVIEWER',
  'APPROVER',
  'VIEWER',
] as const;

export type ProjectRole = (typeof PROJECT_ROLES)[number];

/** Whether a string is one of the six. Useful at the edges, where roles arrive as text. */
export function isProjectRole(value: string): value is ProjectRole {
  return (PROJECT_ROLES as readonly string[]).includes(value);
}
