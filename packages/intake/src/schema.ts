/**
 * Intake schema.
 *
 * Contract: `IMPLEMENTATION_GAP_CLOSURE_SPEC.md` §9 — every intake question must support a confirmed
 * answer, "I don't know", "unsure", "use recommended default", or "defer to external research"; and
 * every field must carry a value, a state, provenance, confidence, a last-updated timestamp and who
 * confirmed it.
 *
 * The idea this file exists to protect: **"I don't know" is an answer, not a blank.**
 *
 * A conventional form models an unanswered question as `null` and cannot tell the difference between
 * "the user has not reached this yet", "the user looked at it and genuinely does not know", "the user
 * asked us to assume something sensible", and "the user wants an external AI to research it". Those
 * four demand completely different downstream behaviour — the second and fourth are what drive the
 * external-AI prompt package, and the third is what licenses the engine to assume. Collapsing them
 * into `null` destroys the information the whole product is built on.
 */

import { z } from 'zod';
import { CONFIDENCE_LEVELS, PROVENANCE_CLASSES } from '@govintel/shared/provenance';

/**
 * The state of a single intake field (gap-spec §9.3).
 *
 * `CONFIRMED` vs `PROVIDED` is a real distinction, not ceremony: a value the user typed in passing
 * carries less weight than one they were shown and explicitly affirmed, and the AI-import conflict
 * rules in gap-spec §12.2 treat them differently.
 */
export const FIELD_STATES = [
  /** The user was shown this value and explicitly affirmed it. */
  'CONFIRMED',
  /** The user supplied it, but has not explicitly confirmed it. */
  'PROVIDED',
  /** The system assumed it so planning could proceed. Always visible and challengeable. */
  'ASSUMED',
  /** The user said, in effect, "I don't know". Distinct from unanswered. */
  'UNKNOWN',
  /** The user asked for this to be researched externally. Feeds the AI prompt package. */
  'EXTERNAL_RESEARCH_REQUIRED',
  /** Two sources disagree and a human must settle it. */
  'CONFLICTING',
  /** Not yet reached. The only state that means "no information exists". */
  'UNANSWERED',
] as const;

export type FieldState = (typeof FIELD_STATES)[number];

/** How the user chose to answer (gap-spec §9.2). Maps onto a field state. */
export const ANSWER_MODES = [
  'ANSWER',
  'I_DONT_KNOW',
  'UNSURE',
  'USE_RECOMMENDED_DEFAULT',
  'DEFER_TO_EXTERNAL_RESEARCH',
] as const;

export type AnswerMode = (typeof ANSWER_MODES)[number];

/**
 * Answer mode → resulting field state.
 *
 * `UNSURE` maps to `PROVIDED` rather than `UNKNOWN` on purpose: the user did give a value, they are
 * simply not certain of it. Treating it as unknown would discard a usable answer; treating it as
 * confirmed would overstate it. It becomes a low-confidence provided value instead.
 */
export const ANSWER_MODE_TO_STATE: Readonly<Record<AnswerMode, FieldState>> = {
  ANSWER: 'PROVIDED',
  I_DONT_KNOW: 'UNKNOWN',
  UNSURE: 'PROVIDED',
  USE_RECOMMENDED_DEFAULT: 'ASSUMED',
  DEFER_TO_EXTERNAL_RESEARCH: 'EXTERNAL_RESEARCH_REQUIRED',
};

/** Intake categories, verbatim from gap-spec §9.1. */
export const INTAKE_CATEGORIES = [
  'IDEA',
  'PROJECT_TYPE',
  'OBJECTIVES',
  'TARGET_USERS',
  'KEY_CAPABILITIES',
  'BUDGET',
  'DEADLINE',
  'TEAM',
  'SKILLS',
  'WORKING_CAPACITY',
  'EXISTING_STACK',
  'EXISTING_CODE',
  'INFRASTRUCTURE',
  'DOMAINS',
  'APIS',
  'THIRD_PARTIES',
  'DATA_TYPES',
  'PRIVACY',
  'SECURITY',
  'COMPLIANCE',
  'DEPLOYMENT',
  'AVAILABILITY',
  'PERFORMANCE',
  'ACCESSIBILITY',
  'MAINTENANCE',
] as const;

export type IntakeCategory = (typeof INTAKE_CATEGORIES)[number];

/** How badly the engine needs an answer (gap-spec §10). */
export const IMPORTANCE_LEVELS = [
  /** Without it, no safe or reliable plan can be produced. */
  'CRITICAL',
  /** Can proceed on assumptions, but plan quality degrades. */
  'RECOMMENDED',
  /** Useful, not required for V1 generation. */
  'OPTIONAL',
] as const;

export type ImportanceLevel = (typeof IMPORTANCE_LEVELS)[number];

/* -------------------------------------------------------------------------- */
/* Field value                                                                */
/* -------------------------------------------------------------------------- */

const fieldStateSchema = z.enum(FIELD_STATES);
const provenanceSchema = z.enum(PROVENANCE_CLASSES);
const confidenceSchema = z.enum(CONFIDENCE_LEVELS);

/**
 * One answered (or deliberately unanswered) intake field.
 *
 * Every element of gap-spec §9.3 is required rather than optional. An optional provenance would be
 * omitted at exactly the call sites that matter — a value arriving from an AI import — and then the
 * UI could not tell the user where a number came from.
 */
export const intakeFieldSchema = z.object({
  fieldId: z.string().min(1),
  category: z.enum(INTAKE_CATEGORIES),

  /**
   * `null` when the state carries the meaning by itself — UNKNOWN, UNANSWERED or
   * EXTERNAL_RESEARCH_REQUIRED. Never used to mean "not answered" on its own.
   */
  value: z.unknown().nullable(),

  state: fieldStateSchema,
  provenance: provenanceSchema,
  confidence: confidenceSchema,

  /** Free-text note the user attached, e.g. why they are unsure. */
  note: z.string().max(2000).optional(),

  lastUpdatedAt: z.iso.datetime(),
  /** Present only when `state` is CONFIRMED. Enforced by the refinement below. */
  confirmedBy: z.string().optional(),
});

export type IntakeField = z.infer<typeof intakeFieldSchema>;

/**
 * States in which a value must be present, and states in which it must be absent.
 *
 * Checked rather than trusted: a field marked UNKNOWN that still carries a value would be shown to
 * the user as "we don't know" while the engine planned against the stale number underneath.
 */
const REQUIRES_VALUE: ReadonlySet<FieldState> = new Set<FieldState>([
  'CONFIRMED',
  'PROVIDED',
  'ASSUMED',
  'CONFLICTING',
]);

const FORBIDS_VALUE: ReadonlySet<FieldState> = new Set<FieldState>([
  'UNKNOWN',
  'UNANSWERED',
  'EXTERNAL_RESEARCH_REQUIRED',
]);

export function fieldStateRequiresValue(state: FieldState): boolean {
  return REQUIRES_VALUE.has(state);
}

export function fieldStateForbidsValue(state: FieldState): boolean {
  return FORBIDS_VALUE.has(state);
}

/** Validation errors for a single field. Empty means valid. */
export function validateFieldInvariants(field: IntakeField): readonly string[] {
  const problems: string[] = [];

  if (fieldStateRequiresValue(field.state) && (field.value === null || field.value === undefined)) {
    problems.push(`state ${field.state} requires a value`);
  }

  if (fieldStateForbidsValue(field.state) && field.value !== null && field.value !== undefined) {
    // The dangerous direction: a stale value hiding behind an "unknown" label.
    problems.push(`state ${field.state} must not carry a value`);
  }

  if (field.state === 'CONFIRMED' && field.confirmedBy === undefined) {
    problems.push('CONFIRMED requires confirmedBy');
  }

  if (field.state !== 'CONFIRMED' && field.confirmedBy !== undefined) {
    problems.push('confirmedBy is only meaningful when state is CONFIRMED');
  }

  if (field.state === 'ASSUMED' && field.provenance !== 'ASSUMPTION') {
    // An assumption recorded with any other provenance would be presentable as fact.
    problems.push('ASSUMED requires provenance ASSUMPTION');
  }

  if (field.state === 'CONFIRMED' && field.provenance !== 'USER_CONFIRMED') {
    problems.push('CONFIRMED requires provenance USER_CONFIRMED');
  }

  return problems;
}

export const intakeSchema = z.object({
  intakeId: z.string().min(1),
  projectId: z.string().min(1),
  /** Bumped on each material edit, so a stale client write conflicts (gap-spec §49). */
  version: z.number().int().positive(),
  fields: z.array(intakeFieldSchema),
  startedAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type Intake = z.infer<typeof intakeSchema>;

/* -------------------------------------------------------------------------- */
/* Construction helpers                                                       */
/* -------------------------------------------------------------------------- */

export interface AnswerInput {
  readonly fieldId: string;
  readonly category: IntakeCategory;
  readonly mode: AnswerMode;
  readonly value?: unknown;
  readonly note?: string;
  readonly userId?: string;
  /** Value applied when the mode is USE_RECOMMENDED_DEFAULT. */
  readonly recommendedDefault?: unknown;
  readonly now?: Date;
}

/**
 * Build a field from a user's answer.
 *
 * The mode → state → provenance mapping lives here rather than at call sites, so a screen cannot
 * record "I don't know" while quietly keeping the previous value, or mark something CONFIRMED
 * without an affirming user.
 */
export function answerField(input: AnswerInput): IntakeField {
  const now = (input.now ?? new Date()).toISOString();
  const state = ANSWER_MODE_TO_STATE[input.mode];

  const value = (() => {
    if (input.mode === 'USE_RECOMMENDED_DEFAULT') return input.recommendedDefault ?? null;
    if (fieldStateForbidsValue(state)) return null;
    return input.value ?? null;
  })();

  const provenance = (() => {
    switch (input.mode) {
      case 'USE_RECOMMENDED_DEFAULT':
        // The system chose this value, not the user. Recorded as an assumption so it can never be
        // presented as fact (plan §11.2).
        return 'ASSUMPTION' as const;
      case 'I_DONT_KNOW':
      case 'DEFER_TO_EXTERNAL_RESEARCH':
      case 'ANSWER':
      case 'UNSURE':
        return 'USER_PROVIDED' as const;
    }
  })();

  const confidence = (() => {
    switch (input.mode) {
      case 'ANSWER':
        // MEDIUM, not HIGH: the user typed it but has not been shown it back and affirmed it.
        // HIGH is reserved for an explicit confirmation (`confirmField`).
        return 'MEDIUM' as const;
      case 'UNSURE':
      case 'USE_RECOMMENDED_DEFAULT':
      case 'I_DONT_KNOW':
      case 'DEFER_TO_EXTERNAL_RESEARCH':
        return 'LOW' as const;
    }
  })();

  return {
    fieldId: input.fieldId,
    category: input.category,
    value,
    state,
    provenance,
    confidence,
    ...(input.note === undefined ? {} : { note: input.note }),
    lastUpdatedAt: now,
  };
}

/**
 * Promote a field to CONFIRMED.
 *
 * Separate from `answerField` because confirmation is a distinct user act: they were shown the value
 * and affirmed it. Only a field that already carries a value can be confirmed — confirming an
 * unknown is meaningless, and allowing it would let the UI manufacture certainty.
 */
export function confirmField(
  field: IntakeField,
  userId: string,
  now: Date = new Date(),
): IntakeField {
  if (field.value === null || field.value === undefined) {
    throw new Error(`cannot confirm ${field.fieldId}: it has no value`);
  }

  return {
    ...field,
    state: 'CONFIRMED',
    provenance: 'USER_CONFIRMED',
    confidence: 'HIGH',
    confirmedBy: userId,
    lastUpdatedAt: now.toISOString(),
  };
}
