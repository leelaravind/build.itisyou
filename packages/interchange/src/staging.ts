/**
 * Import staging.
 *
 * Contract: gap-spec §12.3 — "Do not mutate canonical project on validation. Use staging import:
 * RAW → PARSED → VALIDATED → REVIEWED/ACCEPTED → MATERIALIZED." Plan §11.1: "Never silently convert
 * an invalid response into a project." Gap-spec §48 requires materialisation to be idempotent.
 *
 * The state machine exists because validation and application are different acts separated by a
 * human decision. A pipeline that validated and applied in one step would mean the user's first
 * sight of what an AI proposed is a project that has already changed — and "undo the import" is a
 * far harder problem than "do not apply it yet".
 *
 * So a staged import is inert. It holds the raw text, the validation result, and eventually a
 * decision. Nothing it contains reaches the Project Digital Twin until someone accepts it, and the
 * transition that does so is guarded, single-use and recorded.
 */

import { AppError } from '@govintel/shared/errors';
import type { InterchangeResponse } from './schema.ts';
import type { ValidationResult } from './validate.ts';
import { validateImport, type ValidationContext } from './validate.ts';

export const IMPORT_STATES = [
  /** The pasted text, stored verbatim. Nothing has been interpreted. */
  'RAW',
  /** Parsed and schema-checked. Structurally sound; nothing about it is trusted yet. */
  'PARSED',
  /** All fourteen layers have run. The result may still be a rejection. */
  'VALIDATED',
  /** A human has seen the result and accepted it. The only state that may materialise. */
  'ACCEPTED',
  /** A human has seen the result and declined it. Terminal, and kept as evidence. */
  'REJECTED',
  /** Applied to the project. Terminal. */
  'MATERIALIZED',
] as const;

export type ImportState = (typeof IMPORT_STATES)[number];

/**
 * Permitted transitions.
 *
 * Deliberately explicit rather than derived. `RAW → MATERIALIZED` is not in this table, and that
 * absence is the control: no sequence of legitimate-looking calls can reach the project without
 * passing through validation and a human decision.
 */
const TRANSITIONS: Readonly<Record<ImportState, readonly ImportState[]>> = {
  RAW: ['PARSED', 'REJECTED'],
  PARSED: ['VALIDATED', 'REJECTED'],
  VALIDATED: ['ACCEPTED', 'REJECTED'],
  ACCEPTED: ['MATERIALIZED', 'REJECTED'],
  // Terminal.
  MATERIALIZED: [],
  REJECTED: [],
};

export function canTransition(from: ImportState, to: ImportState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(state: ImportState): boolean {
  return TRANSITIONS[state].length === 0;
}

export interface StagedImport {
  readonly importId: string;
  readonly projectId: string;
  readonly state: ImportState;
  /** The pasted text, verbatim. Retained as evidence of what was actually submitted. */
  readonly raw: string;
  readonly response?: InterchangeResponse;
  readonly validation?: ValidationResult;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly decidedBy?: string;
  readonly decisionReason?: string;
  /**
   * Deduplicates repeated submissions of the same import (gap-spec §48). A double-clicked
   * "Accept" must apply once, not twice.
   */
  readonly idempotencyKey?: string;
}

function transitionError(from: ImportState, to: ImportState): AppError {
  return new AppError({
    code: 'IMPORT_INVALID_TRANSITION',
    category: 'CONFLICT',
    safeMessage: 'That action is not available for this import.',
    details: { from, to },
  });
}

/** Create a staged import from pasted text. Nothing is interpreted here. */
export function createStagedImport(input: {
  readonly importId: string;
  readonly projectId: string;
  readonly raw: string;
  readonly now?: Date;
  readonly idempotencyKey?: string;
}): StagedImport {
  const timestamp = (input.now ?? new Date()).toISOString();

  return {
    importId: input.importId,
    projectId: input.projectId,
    state: 'RAW',
    raw: input.raw,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
  };
}

/**
 * Run validation and move to VALIDATED.
 *
 * Returns a new object rather than mutating: a staged import is a record of what happened, and
 * rewriting it in place would lose the prior state that made the next transition legal.
 *
 * Note the state reaches VALIDATED regardless of the *outcome*. "Validated" means the checks ran,
 * not that they passed — conflating the two would leave a rejected import stuck in PARSED with no
 * way to record why.
 */
export function validateStagedImport(
  staged: StagedImport,
  context: ValidationContext,
  now: Date = new Date(),
): StagedImport {
  if (staged.state !== 'RAW' && staged.state !== 'PARSED') {
    throw transitionError(staged.state, 'VALIDATED');
  }

  const validation = validateImport(staged.raw, context);

  return {
    ...staged,
    state: 'VALIDATED',
    validation,
    ...(validation.response === undefined ? {} : { response: validation.response }),
    updatedAt: now.toISOString(),
  };
}

/**
 * Accept a validated import.
 *
 * Refuses anything the validator would not let through, so acceptance cannot be used to bypass
 * validation. The check is here as well as at materialisation because defence in depth means
 * assuming the later check might be skipped by a future caller.
 */
export function acceptStagedImport(
  staged: StagedImport,
  decidedBy: string,
  now: Date = new Date(),
): StagedImport {
  if (!canTransition(staged.state, 'ACCEPTED')) {
    throw transitionError(staged.state, 'ACCEPTED');
  }

  if (staged.validation?.canMaterialize !== true) {
    throw new AppError({
      code: 'IMPORT_NOT_ACCEPTABLE',
      category: 'VALIDATION',
      safeMessage: 'This response did not pass validation, so it cannot be accepted.',
      details: { status: staged.validation?.status ?? 'UNVALIDATED' },
    });
  }

  return { ...staged, state: 'ACCEPTED', decidedBy, updatedAt: now.toISOString() };
}

/** Reject an import. Available from any non-terminal state, and kept as evidence. */
export function rejectStagedImport(
  staged: StagedImport,
  decidedBy: string,
  reason?: string,
  now: Date = new Date(),
): StagedImport {
  if (!canTransition(staged.state, 'REJECTED')) {
    throw transitionError(staged.state, 'REJECTED');
  }

  return {
    ...staged,
    state: 'REJECTED',
    decidedBy,
    ...(reason === undefined ? {} : { decisionReason: reason }),
    updatedAt: now.toISOString(),
  };
}

/**
 * Mark an accepted import as applied.
 *
 * The caller performs the actual write inside a transaction and calls this as part of it. The
 * transition is single-use: `MATERIALIZED` is terminal and has no outgoing edges, so a replayed
 * request throws rather than applying a second time.
 */
export function materializeStagedImport(
  staged: StagedImport,
  now: Date = new Date(),
): StagedImport {
  if (!canTransition(staged.state, 'MATERIALIZED')) {
    throw transitionError(staged.state, 'MATERIALIZED');
  }

  if (staged.validation?.canMaterialize !== true) {
    // Belt and braces with `acceptStagedImport`. The airlock is worth two locks.
    throw new AppError({
      code: 'IMPORT_NOT_MATERIALIZABLE',
      category: 'VALIDATION',
      safeMessage: 'This response has not passed validation and cannot be applied.',
      details: { status: staged.validation?.status ?? 'UNVALIDATED' },
    });
  }

  return { ...staged, state: 'MATERIALIZED', updatedAt: now.toISOString() };
}

/**
 * What would be created, without creating it.
 *
 * The preview screen renders this. It is derived from the staged import alone and touches nothing,
 * so a user can look at the full consequence of an import before deciding — which is the entire
 * point of separating validation from application.
 */
export interface ImportPreview {
  readonly claimCount: number;
  readonly requirementCount: number;
  readonly riskCount: number;
  readonly phaseCount: number;
  readonly assumptionCount: number;
  readonly openQuestionCount: number;
  /** Claims that would fill a field the user left unanswered — the useful part of an import. */
  readonly fillsFields: readonly string[];
  /** Claims carrying only inference or assumption, which the UI must qualify. */
  readonly unverifiedClaimCount: number;
  readonly citedClaimCount: number;
}

export function previewImport(staged: StagedImport): ImportPreview {
  const response = staged.response;

  if (response === undefined) {
    return {
      claimCount: 0,
      requirementCount: 0,
      riskCount: 0,
      phaseCount: 0,
      assumptionCount: 0,
      openQuestionCount: 0,
      fillsFields: [],
      unverifiedClaimCount: 0,
      citedClaimCount: 0,
    };
  }

  const claims = response.claims ?? [];

  return {
    claimCount: claims.length,
    requirementCount: response.requirements?.length ?? 0,
    riskCount: response.risks?.length ?? 0,
    phaseCount: response.phases?.length ?? 0,
    assumptionCount: response.assumptions?.length ?? 0,
    openQuestionCount: response.openQuestions?.length ?? 0,
    fillsFields: claims.map((c) => c.fieldId),
    unverifiedClaimCount: claims.filter((c) => c.provenance !== 'EXTERNAL_SOURCE').length,
    citedClaimCount: claims.filter((c) => c.provenance === 'EXTERNAL_SOURCE').length,
  };
}
