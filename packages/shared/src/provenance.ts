/**
 * Provenance classification.
 *
 * Contract: MASTER_IMPLEMENTATION_PLAN.md section 11.2 - every important imported claim must carry a
 * provenance class, and "the UI must never present assumption/inference as confirmed fact."
 * Gap-spec section 83 lists provenance classification mechanics among the things that must remain
 * deterministic (never LLM-decided at runtime).
 *
 * This is one of the load-bearing product ideas, not bookkeeping. The platform's honesty claim rests
 * on it: a number sourced from an external AI's guess and a number the user confirmed must never be
 * displayed as though they carry the same weight.
 */

export const PROVENANCE_CLASSES = [
  /** The user explicitly confirmed this. Highest trust. */
  'USER_CONFIRMED',
  /** The user supplied it but did not explicitly confirm it (e.g. a free-text intake field). */
  'USER_PROVIDED',
  /** Cited from an identifiable external source. */
  'EXTERNAL_SOURCE',
  /** An external AI inferred it. Never presentable as fact. */
  'EXTERNAL_AI_INFERENCE',
  /** The system assumed it to proceed. Must be visible and challengeable. */
  'ASSUMPTION',
  /** Computed by the deterministic engine from other values. Reproducible. */
  'DETERMINISTIC_CALCULATION',
  /** Reserved. No ML in V1 (plan section 3.2); the class exists so the schema does not change later. */
  'FUTURE_ML_PREDICTION',
] as const;

export type ProvenanceClass = (typeof PROVENANCE_CLASSES)[number];

export const CONFIDENCE_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

/**
 * Classes the UI may present as established fact.
 *
 * Deliberately narrow. `EXTERNAL_SOURCE` is excluded: a cited source is evidence a human should
 * weigh, not a fact the system asserts on the user's behalf.
 */
const PRESENTABLE_AS_FACT: ReadonlySet<ProvenanceClass> = new Set<ProvenanceClass>([
  'USER_CONFIRMED',
  'DETERMINISTIC_CALCULATION',
]);

/** Classes that require a visible qualifier in the UI (badge, tooltip, or explicit label). */
const REQUIRES_QUALIFIER: ReadonlySet<ProvenanceClass> = new Set<ProvenanceClass>([
  'EXTERNAL_AI_INFERENCE',
  'ASSUMPTION',
  'FUTURE_ML_PREDICTION',
  'EXTERNAL_SOURCE',
  'USER_PROVIDED',
]);

/**
 * Trust ordering, used for conflict resolution during AI import (gap-spec section 12.2).
 * A lower-trust claim must never silently overwrite a higher-trust one.
 */
const TRUST_RANK: Record<ProvenanceClass, number> = {
  USER_CONFIRMED: 100,
  DETERMINISTIC_CALCULATION: 90,
  USER_PROVIDED: 70,
  EXTERNAL_SOURCE: 50,
  ASSUMPTION: 30,
  EXTERNAL_AI_INFERENCE: 20,
  FUTURE_ML_PREDICTION: 10,
};

export function canPresentAsFact(provenance: ProvenanceClass): boolean {
  return PRESENTABLE_AS_FACT.has(provenance);
}

export function requiresQualifier(provenance: ProvenanceClass): boolean {
  return REQUIRES_QUALIFIER.has(provenance);
}

export function trustRank(provenance: ProvenanceClass): number {
  return TRUST_RANK[provenance];
}

/**
 * True when `incoming` may overwrite `existing` without explicit user resolution.
 *
 * Equal trust returns `false`: two USER_CONFIRMED values that disagree is a genuine conflict the
 * user must settle, not something to resolve by arrival order. Gap-spec section 12.2 requires exactly
 * this - an AI claim must not silently replace a user-confirmed budget.
 */
export function canOverwrite(existing: ProvenanceClass, incoming: ProvenanceClass): boolean {
  return TRUST_RANK[incoming] > TRUST_RANK[existing];
}

/** A value carrying its provenance. The pairing is the point: neither travels without the other. */
export interface Provenanced<T> {
  readonly value: T;
  readonly provenance: ProvenanceClass;
  readonly confidence: ConfidenceLevel;
  /** Where it came from: a source URL, rule ID, calculation ID, or intake field ID. */
  readonly source?: string;
  readonly recordedAt: string;
  /** User ID that confirmed it, when provenance is USER_CONFIRMED. */
  readonly confirmedBy?: string;
}

export function isProvenanceClass(value: unknown): value is ProvenanceClass {
  return typeof value === 'string' && (PROVENANCE_CLASSES as readonly string[]).includes(value);
}
