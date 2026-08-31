/**
 * Missing-information engine.
 *
 * Contract: gap-spec §10 — classify missing information as Critical, Recommended or Optional, and
 * §10.4: "Missing-information requirements must come from rule packs, not hardcoded scattered UI
 * logic."
 *
 * This engine reads the field catalogue and the current intake and answers three questions:
 *
 * 1. What is still missing, and how badly is it needed?
 * 2. Can a plan be generated at all yet?
 * 3. What should the external-AI prompt package ask about?
 *
 * The distinction that matters most: **a field the user marked "I don't know" is not the same as one
 * they have not reached.** Both lack a value, but the first is a resolved decision that routes to
 * external research or an assumption, while the second is simply unfinished. Conflating them would
 * either nag the user about questions they have already dealt with, or silently treat unfinished
 * intake as complete.
 */

import { FIELD_DEFINITIONS, findField, type FieldDefinition } from './fields.ts';
import type { ImportanceLevel, IntakeField } from './schema.ts';

export interface MissingItem {
  readonly fieldId: string;
  readonly label: string;
  readonly rationale: string;
  readonly importance: ImportanceLevel;
  /** Why this counts as missing — drives what the UI offers next. */
  readonly reason: MissingReason;
}

export const MISSING_REASONS = [
  /** Never reached. */
  'UNANSWERED',
  /** The user explicitly said they do not know. */
  'USER_DOES_NOT_KNOW',
  /** The user asked for it to be researched externally. */
  'DEFERRED_TO_RESEARCH',
  /** Filled by an assumption, so it is present but unverified. */
  'ASSUMED',
  /** Two sources disagree. */
  'CONFLICTING',
] as const;

export type MissingReason = (typeof MISSING_REASONS)[number];

/** Field states that count as "we do not have a trustworthy answer". */
const STATE_TO_REASON: Readonly<Record<string, MissingReason | undefined>> = {
  UNANSWERED: 'UNANSWERED',
  UNKNOWN: 'USER_DOES_NOT_KNOW',
  EXTERNAL_RESEARCH_REQUIRED: 'DEFERRED_TO_RESEARCH',
  ASSUMED: 'ASSUMED',
  CONFLICTING: 'CONFLICTING',
  // CONFIRMED and PROVIDED are answers, and are absent from this map deliberately.
};

export interface MissingAnalysis {
  readonly critical: readonly MissingItem[];
  readonly recommended: readonly MissingItem[];
  readonly optional: readonly MissingItem[];
  /**
   * Whether the deterministic engine may generate a plan.
   *
   * False only while a CRITICAL field is genuinely unanswered. A critical field the user resolved —
   * by saying "I don't know" or deferring it to research — does **not** block: that is the user
   * making a decision, and blocking on it would make the product unusable for exactly the
   * inexperienced user it is meant to serve. It surfaces as a prominent assumption instead.
   */
  readonly canGenerate: boolean;
  /** Fields that should appear in the external-AI research request (gap-spec §11.1). */
  readonly researchRequests: readonly MissingItem[];
  /** Assumptions currently propping up the plan, for the "what we assumed" surface. */
  readonly assumptions: readonly MissingItem[];
  readonly answeredCount: number;
  readonly totalCount: number;
}

function toItem(definition: FieldDefinition, reason: MissingReason): MissingItem {
  return {
    fieldId: definition.id,
    label: definition.label,
    rationale: definition.rationale,
    importance: definition.importance,
    reason,
  };
}

/**
 * Analyse an intake against the field catalogue.
 *
 * Fields absent from `answers` are treated as UNANSWERED rather than ignored — otherwise an intake
 * that had simply never been started would report nothing missing.
 */
export function analyseMissing(
  answers: readonly IntakeField[],
  options: { readonly fields?: readonly FieldDefinition[] } = {},
): MissingAnalysis {
  const catalogue = options.fields ?? FIELD_DEFINITIONS;
  const byId = new Map(answers.map((a) => [a.fieldId, a]));

  const critical: MissingItem[] = [];
  const recommended: MissingItem[] = [];
  const optional: MissingItem[] = [];
  const researchRequests: MissingItem[] = [];
  const assumptions: MissingItem[] = [];

  let answered = 0;
  let blockingCritical = 0;

  for (const definition of catalogue) {
    const answer = byId.get(definition.id);
    const state = answer?.state ?? 'UNANSWERED';
    const reason = STATE_TO_REASON[state];

    if (reason === undefined) {
      answered += 1;
      continue;
    }

    const item = toItem(definition, reason);

    switch (definition.importance) {
      case 'CRITICAL':
        critical.push(item);
        // Only a genuinely unanswered critical field blocks. A user who said "I don't know" has
        // made a decision, and the engine's job is then to proceed with a visible assumption.
        if (reason === 'UNANSWERED') blockingCritical += 1;
        break;
      case 'RECOMMENDED':
        recommended.push(item);
        break;
      case 'OPTIONAL':
        optional.push(item);
        break;
    }

    // Anything the user could not answer is worth asking an external AI about — including
    // optional fields, since research is cheap once the user is already going to paste a prompt.
    if (reason === 'USER_DOES_NOT_KNOW' || reason === 'DEFERRED_TO_RESEARCH') {
      researchRequests.push(item);
    }

    if (reason === 'ASSUMED') assumptions.push(item);
  }

  return {
    critical,
    recommended,
    optional,
    canGenerate: blockingCritical === 0,
    researchRequests,
    assumptions,
    answeredCount: answered,
    totalCount: catalogue.length,
  };
}

/**
 * The next question to put in front of the user.
 *
 * Critical first, then recommended, then optional — and within a tier, catalogue order, which is
 * authored so that the questions that shape later ones come first. Asking about compliance regimes
 * before knowing what kind of software it is would be asking the user to guess.
 */
export function nextQuestion(
  answers: readonly IntakeField[],
  options: { readonly fields?: readonly FieldDefinition[] } = {},
): FieldDefinition | undefined {
  const catalogue = options.fields ?? FIELD_DEFINITIONS;
  const byId = new Map(answers.map((a) => [a.fieldId, a]));

  const unanswered = catalogue.filter(
    (d) => (byId.get(d.id)?.state ?? 'UNANSWERED') === 'UNANSWERED',
  );
  if (unanswered.length === 0) return undefined;

  const rank: Record<ImportanceLevel, number> = { CRITICAL: 0, RECOMMENDED: 1, OPTIONAL: 2 };
  let best = unanswered[0];
  for (const candidate of unanswered) {
    if (best === undefined || rank[candidate.importance] < rank[best.importance]) best = candidate;
  }

  return best;
}

/**
 * Completion as a percentage of *weighted* progress.
 *
 * Weighted rather than a raw count: answering the project type moves the needle more than filling in
 * a maintenance owner, and a progress bar that says 40% when every critical question is outstanding
 * is actively misleading.
 */
export function completionPercent(
  answers: readonly IntakeField[],
  options: { readonly fields?: readonly FieldDefinition[] } = {},
): number {
  const catalogue = options.fields ?? FIELD_DEFINITIONS;
  if (catalogue.length === 0) return 100;

  const weight: Record<ImportanceLevel, number> = { CRITICAL: 3, RECOMMENDED: 2, OPTIONAL: 1 };
  const byId = new Map(answers.map((a) => [a.fieldId, a]));

  let total = 0;
  let earned = 0;

  for (const definition of catalogue) {
    const w = weight[definition.importance];
    total += w;

    const state = byId.get(definition.id)?.state ?? 'UNANSWERED';
    // A resolved unknown counts as progress: the user dealt with the question. Scoring it as zero
    // would mean the bar never fills for someone honestly flagging what they do not know.
    if (state !== 'UNANSWERED') earned += w;
  }

  return Math.round((earned / total) * 100);
}

/** Whether a field offers the "use a recommended default" answer mode. */
export function hasRecommendedDefault(fieldId: string): boolean {
  return findField(fieldId)?.recommendedDefault !== undefined;
}
