import 'server-only';

import { eq } from 'drizzle-orm';
import { intakeAnswers } from '@govintel/db/schema';
import type { IntakeField } from '@govintel/intake/schema';
import type { TwinGraph } from '@govintel/twin/graph';
import { RULES, RULESET_VERSION } from '@govintel/rules/catalogue';
import { evaluateRules, type EvaluationResult } from '@govintel/rules/evaluate';
import type { EmittedGateCriterion } from '@govintel/rules/gates';
import { withDatabase } from './database.ts';

/**
 * Running the rule engine for one project.
 *
 * Contract: plan §12 (the engine is deterministic and explains itself), gap-spec §13.
 *
 * ## Why this is one function and not six
 *
 * Four pages and two server actions each needed the engine's verdict, and each built the evaluation
 * context by hand — the same eleven lines, copied. That is survivable while the context is only read
 * for display. It stops being survivable the moment the result *gates* something, because then a
 * caller that builds the context slightly differently reaches a different verdict for the same
 * project, and the product disagrees with itself about whether a gate is passed depending on which
 * page you are looking at.
 *
 * Wiring the rule-emitted gate criteria in was exactly that moment.
 */

/** What the engine needs that the caller has already loaded. */
export interface RuleInputs {
  readonly projectId: string;
  /** `'UNKNOWN'` is the column default and is passed through as absent — see below. */
  readonly projectType: string;
  readonly lifecycleState: string;
  readonly intake: readonly IntakeField[];
  readonly graph?: TwinGraph;
}

export interface ProjectRules {
  readonly evaluation: EvaluationResult;
  /**
   * The gate criteria this project's applied rules demand.
   *
   * Pass to `evaluateGates`, `manualCriteria` and `evidencePurposes`. Before this existed the
   * evaluator produced them and every caller threw them away, so no rule in a 287-rule catalogue
   * could affect a gate.
   */
  readonly emittedGates: readonly EmittedGateCriterion[];
}

/**
 * Evaluate the catalogue against a project.
 *
 * Pure and synchronous: everything it needs is passed in, so a page that has already loaded the
 * intake and the graph does not load them twice.
 */
export function evaluateForProject(input: RuleInputs): ProjectRules {
  const evaluation = evaluateRules(
    RULES,
    {
      projectId: input.projectId,
      /*
       * `'UNKNOWN'` is the column default, not a project type.
       *
       * Passing it through would make every type-scoped rule evaluate against a type that does not
       * exist and report NOT_APPLICABLE — so a project that never answered the question would
       * silently escape every type-specific security obligation. Passing it as absent instead makes
       * those rules INDETERMINATE, which is the truth.
       */
      ...(input.projectType === 'UNKNOWN' ? {} : { projectType: input.projectType }),
      lifecycleState: input.lifecycleState,
      /*
       * Hardcoded, and known to be. Methodology is not asked for anywhere in intake yet, so there is
       * nothing truthful to pass; `'AGILE'` at least matches what the methodology engine assumes.
       * Recorded in the register rather than hidden behind a comment on one of six copies.
       */
      methodology: 'AGILE',
      intake: input.intake,
      // The date is an input, never read from a clock inside the engine — that separation is what
      // makes the determinism claim testable.
      asOf: new Date().toISOString().slice(0, 10),
      ...(input.graph !== undefined && input.graph.size > 0 ? { graph: input.graph } : {}),
    },
    RULESET_VERSION,
  );

  return { evaluation, emittedGates: evaluation.emissions.gates };
}

/**
 * The intake answers, in the shape the engine takes.
 *
 * For the callers that need an evaluation but have not already loaded intake for their own reasons —
 * the lifecycle and evidence actions, which care only about the gates.
 */
export async function loadIntake(projectId: string): Promise<IntakeField[]> {
  const rows = await withDatabase((db) =>
    db.select().from(intakeAnswers).where(eq(intakeAnswers.projectId, projectId)),
  );

  return rows.map((row) => ({
    fieldId: row.fieldId,
    category: row.category as IntakeField['category'],
    value: row.value ?? null,
    state: row.state as IntakeField['state'],
    provenance: row.provenance as IntakeField['provenance'],
    confidence: row.confidence as IntakeField['confidence'],
    lastUpdatedAt: row.updatedAt.toISOString(),
  }));
}
