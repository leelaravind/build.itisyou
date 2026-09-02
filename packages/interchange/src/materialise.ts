import type { ConfidenceLevel, ProvenanceClass } from '@govintel/shared/provenance';
import type { InterchangeClaim, InterchangeResponse } from './schema.ts';

/**
 * Turning an accepted external response into changes to the project.
 *
 * Contract: gap-spec §12 (the import loop), §11.2 (every claim carries provenance and confidence),
 * plan §17 (external AI is advisory and never authoritative), §9.3 (a field's provenance travels
 * with its value).
 *
 * ## Why this exists
 *
 * Accepting an import set `ai_imports.state = 'ACCEPTED'` and did nothing else. The user copied a
 * prompt out of the platform, ran it somewhere, pasted the answer back, watched it validate, pressed
 * accept — and the project was unchanged. Every open question was still open. The interchange loop
 * was open at the far end, which is the end that matters: the whole feature exists to get answers
 * *into* the plan.
 *
 * ## The two rules
 *
 * **An accepted response never overwrites what a person said.** A field the user answered, in either
 * direction, keeps their answer. The prompt already instructs the model not to contradict confirmed
 * facts and validation rejects responses that do, but neither is a control — the model is not the
 * thing being trusted here, and this is the layer that does not have to trust it.
 *
 * **What it does write is marked as coming from outside.** The value goes in as `PROVIDED` — settled
 * enough to plan against, not confirmed — carrying the response's own `provenance` and `confidence`.
 * `EXTERNAL_SOURCE` and `EXTERNAL_AI_INFERENCE` stay distinct all the way down, because "it found a
 * source" and "it reasoned it out" are different claims and the difference is the point of §11.
 *
 * Pure and synchronous. Deciding what to write is where the rules live and is worth testing on its
 * own; writing it is a transaction in the action.
 */

/** A field state that means a person has given their answer, whatever it was. */
const USER_ANSWERED = new Set(['CONFIRMED', 'PROVIDED']);

export interface ExistingField {
  readonly fieldId: string;
  readonly state: string;
}

export interface MaterialisedAnswer {
  readonly fieldId: string;
  readonly value: unknown;
  readonly provenance: ProvenanceClass;
  readonly confidence: ConfidenceLevel;
  /** The response's own one-or-two sentences, kept so the value can be questioned later. */
  readonly note: string | undefined;
}

export const SKIP_REASONS = ['USER_ANSWERED', 'UNKNOWN_FIELD'] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

export interface SkippedClaim {
  readonly fieldId: string;
  readonly reason: SkipReason;
}

export interface Materialisation {
  readonly answers: readonly MaterialisedAnswer[];
  readonly skipped: readonly SkippedClaim[];
  /** Set only when the project has no type yet — an existing one is the user's and is left alone. */
  readonly projectType: string | undefined;
  /**
   * What the response carried that this does not apply.
   *
   * Requirements, risks and phases are generated from intake by the deterministic engine, and
   * `generatePlan` rewrites every node it owns — so writing them as nodes would produce items that
   * vanish the next time somebody rebuilds the plan, which reads as data loss rather than as design.
   * Reported so the user is told, rather than silently dropped.
   */
  readonly notApplied: Readonly<Record<string, number>>;
}

/**
 * Decide what an accepted response changes.
 *
 * `knownFieldIds` is the intake catalogue: a claim against a field that does not exist is dropped
 * rather than inserted, because an answer to a question the platform never asks reaches no rule, no
 * gate and no screen — it would sit in the table looking like an answer.
 */
export function planMaterialisation(input: {
  readonly response: InterchangeResponse;
  readonly existing: readonly ExistingField[];
  readonly knownFieldIds: ReadonlySet<string>;
  readonly currentProjectType: string;
  readonly supportedProjectTypes: ReadonlySet<string>;
}): Materialisation {
  const byField = new Map(input.existing.map((field) => [field.fieldId, field]));

  const answers: MaterialisedAnswer[] = [];
  const skipped: SkippedClaim[] = [];

  for (const claim of input.response.claims ?? []) {
    if (!input.knownFieldIds.has(claim.fieldId)) {
      skipped.push({ fieldId: claim.fieldId, reason: 'UNKNOWN_FIELD' });
      continue;
    }

    const current = byField.get(claim.fieldId);

    if (current !== undefined && USER_ANSWERED.has(current.state)) {
      skipped.push({ fieldId: claim.fieldId, reason: 'USER_ANSWERED' });
      continue;
    }

    answers.push({
      fieldId: claim.fieldId,
      value: claim.value,
      provenance: provenanceOf(claim),
      confidence: claim.confidence,
      note: claim.rationale,
    });
  }

  /*
   * The project type is worth more than any single answer.
   *
   * It is `UNKNOWN` by default, and while it is, every type-scoped rule in the catalogue evaluates
   * as INDETERMINATE — so a project that never states its type escapes every type-specific
   * obligation. An accepted response naming a supported type is exactly the evidence needed, and
   * setting it turns dozens of rules on at once.
   *
   * Never overwritten: a type the user or an earlier import already set is not the AI's to change.
   */
  const proposed = input.response.projectType;

  const projectType =
    input.currentProjectType === 'UNKNOWN' &&
    proposed !== undefined &&
    input.supportedProjectTypes.has(proposed)
      ? proposed
      : undefined;

  return {
    answers,
    skipped,
    projectType,
    notApplied: {
      requirements: input.response.requirements?.length ?? 0,
      risks: input.response.risks?.length ?? 0,
      phases: input.response.phases?.length ?? 0,
    },
  };
}

/**
 * The provenance a claim's value is stored under.
 *
 * A one-to-one mapping, deliberately. Collapsing `EXTERNAL_SOURCE` into `EXTERNAL_AI_INFERENCE`
 * would be simpler and would throw away the distinction the prompt spends a paragraph asking for;
 * collapsing them the other way would let an inference be presented as a cited fact.
 */
function provenanceOf(claim: InterchangeClaim): ProvenanceClass {
  switch (claim.provenance) {
    case 'EXTERNAL_SOURCE':
      return 'EXTERNAL_SOURCE';
    case 'ASSUMPTION':
      return 'ASSUMPTION';
    case 'EXTERNAL_AI_INFERENCE':
      return 'EXTERNAL_AI_INFERENCE';
  }
}

/**
 * The field state a materialised answer takes.
 *
 * `PROVIDED` rather than `ASSUMED`: `ASSUMED` is reserved for values the *platform* invented to keep
 * going, and `checkField` enforces that it carries `ASSUMPTION` provenance — which would erase the
 * difference between a sourced claim and a guess. `CONFIRMED` is not available and should not be: a
 * person has not seen this value and affirmed it.
 *
 * A claim whose own provenance is `ASSUMPTION` is the one case that maps to `ASSUMED`, because there
 * the two agree.
 */
export function stateFor(provenance: ProvenanceClass): 'PROVIDED' | 'ASSUMED' {
  return provenance === 'ASSUMPTION' ? 'ASSUMED' : 'PROVIDED';
}
