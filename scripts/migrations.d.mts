/**
 * Types for `migrations.mjs`.
 *
 * The module itself is plain JavaScript because `migrate.mjs` runs under bare `node`, with no
 * type-stripping flag — a migration runner that needs a build step is one that cannot be run during
 * an incident. This declaration lets the test that checks those migrations be type-checked like
 * everything else.
 */

export interface Migration {
  /** Stable identifier, recorded in `schema_migrations`. */
  readonly id: string;
  /** The fingerprint this applies to. */
  readonly from: string;
  /** The fingerprint it produces. */
  readonly to: string;
  readonly why: string;
  /** How to undo it, decided before it ran (`MIGRATION_POLICY.md` §5). */
  readonly rollback: string;
  /** Additive DDL only (§1). */
  readonly sql: string;
}

export const MIGRATIONS: readonly Migration[];
export const SCHEMA_MIGRATIONS_DDL: string;

/** The chain from one shape to another, or `null` when nobody has written one. */
export function pathBetween(from: string, to: string): readonly Migration[] | null;
