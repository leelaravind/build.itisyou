/**
 * The rule evaluator.
 *
 * Contract: gap-spec §13.1 (same project version + ruleset version + inputs → same result), §13.2
 * (precedence and conflicts), §13.3 (every emitted action answers "why is this required?").
 *
 * Like the project generator, this is pure: no clock, no randomness, no database. That is what makes
 * §13.1 testable rather than aspirational — a determinism claim about code that can read the time is
 * not a claim about anything.
 *
 * The output distinguishes three outcomes per rule, and the third is the one that matters most:
 *
 * - **APPLIED** — conditions met, emissions produced.
 * - **NOT_APPLICABLE** — conditions genuinely not met. Nothing to say.
 * - **INDETERMINATE** — the rule needs an input the project has not answered.
 *
 * A engine with only the first two silently reports "does not apply" for every rule blocked by
 * missing information, which is how a project comes to look compliant because nobody filled in the
 * form. An unmet obligation and an unknown one are different states and the user needs to see both.
 */

import type { IntakeField } from '@govintel/intake/schema';
import type { TwinGraph } from '@govintel/twin/graph';
import type {
  CalculationEffect,
  EmittedGate,
  EmittedRequirement,
  EmittedRisk,
  EmittedTask,
  EmittedTest,
  Rule,
  RuleCondition,
} from './schema.ts';
import { conflictsOver, describeSeverity, resolveConflict, type Conflict } from './precedence.ts';

/* -------------------------------------------------------------------------- */
/* Input                                                                      */
/* -------------------------------------------------------------------------- */

export interface EvaluationContext {
  readonly projectId: string;
  readonly projectType?: string;
  readonly lifecycleState: string;
  readonly methodology: string;
  readonly intake: readonly IntakeField[];
  /** Optional: rules that ask about the graph are skipped as indeterminate without one. */
  readonly graph?: TwinGraph;
  /** The date rules are evaluated as of. Supplied, never read from a clock. */
  readonly asOf: string;
}

/* -------------------------------------------------------------------------- */
/* Output                                                                     */
/* -------------------------------------------------------------------------- */

export const RULE_OUTCOMES = ['APPLIED', 'NOT_APPLICABLE', 'INDETERMINATE'] as const;
export type RuleOutcome = (typeof RULE_OUTCOMES)[number];

/**
 * What happened to one rule, and why.
 *
 * `explanation` is always populated, including for rules that did not apply. "Why is this *not*
 * required?" is asked as often as the positive form — usually by someone who expected it to be — and
 * an engine that can only explain its positives is one people stop trusting the moment they disagree
 * with a negative.
 */
export interface RuleResult {
  readonly ruleId: string;
  readonly ruleVersion: string;
  readonly outcome: RuleOutcome;
  readonly severity: Rule['severity'];
  readonly category: Rule['category'];
  readonly title: string;
  readonly explanation: string;
  /** Intake fields the rule needed and did not get. Only for INDETERMINATE. */
  readonly missingInputs: readonly string[];
}

export interface Emissions {
  readonly requirements: readonly (EmittedRequirement & { readonly ruleId: string })[];
  readonly tasks: readonly (EmittedTask & { readonly ruleId: string })[];
  readonly tests: readonly (EmittedTest & { readonly ruleId: string })[];
  readonly gates: readonly (EmittedGate & { readonly ruleId: string })[];
  readonly risks: readonly (EmittedRisk & { readonly ruleId: string })[];
  readonly calculationEffects: readonly (CalculationEffect & { readonly ruleId: string })[];
}

export interface EvaluationResult {
  readonly rulesetVersion: string;
  readonly results: readonly RuleResult[];
  readonly emissions: Emissions;
  readonly conflicts: readonly Conflict[];
  /**
   * Emissions withheld because an unresolvable conflict covers them.
   *
   * Gap-spec §13.2: never resolve a critical conflict silently. Emitting one side anyway would be
   * resolving it — quietly, in favour of whichever rule happened to be evaluated first.
   */
  readonly withheld: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* Intake access                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Reading intake with the field state taken seriously.
 *
 * Identical reasoning to the project generator: an `UNKNOWN` field holds a value — the marker the
 * user chose — and treating that as an answer lets "I don't know" masquerade as a fact.
 */
class Intake {
  private readonly byId: ReadonlyMap<string, IntakeField>;

  constructor(fields: readonly IntakeField[]) {
    this.byId = new Map(fields.map((f) => [f.fieldId, f]));
  }

  isAnswered(id: string): boolean {
    const field = this.byId.get(id);
    if (field === undefined) return false;
    if (field.value === null || field.value === undefined) return false;
    return field.state === 'CONFIRMED' || field.state === 'PROVIDED' || field.state === 'ASSUMED';
  }

  value(id: string): unknown {
    return this.isAnswered(id) ? this.byId.get(id)?.value : undefined;
  }

  list(id: string): readonly string[] {
    const value = this.value(id);
    if (!Array.isArray(value)) return [];
    return value.filter((v): v is string => typeof v === 'string');
  }
}

/* -------------------------------------------------------------------------- */
/* Condition evaluation                                                       */
/* -------------------------------------------------------------------------- */

type ConditionVerdict = 'TRUE' | 'FALSE' | 'UNKNOWN';

function evaluateCondition(
  condition: RuleCondition,
  context: EvaluationContext,
  intake: Intake,
): ConditionVerdict {
  switch (condition.subject) {
    case 'INTAKE':
      return evaluateIntakeCondition(condition, intake);
    case 'PROJECT':
      return evaluateScalar(projectValue(condition.key, context), condition);
    case 'METHODOLOGY':
      return evaluateScalar(context.methodology, condition);
    case 'LIFECYCLE':
      return evaluateScalar(context.lifecycleState, condition);
    case 'GRAPH':
      return evaluateGraphCondition(condition, context);
  }
}

function projectValue(key: string, context: EvaluationContext): unknown {
  if (key === 'type') return context.projectType;
  if (key === 'id') return context.projectId;
  return undefined;
}

function evaluateIntakeCondition(condition: RuleCondition, intake: Intake): ConditionVerdict {
  const answered = intake.isAnswered(condition.key);

  // These two ask about the *state* of the field, so an unanswered field is a definite answer rather
  // than an unknown one.
  if (condition.operator === 'IS_ANSWERED') return answered ? 'TRUE' : 'FALSE';
  if (condition.operator === 'IS_UNANSWERED') return answered ? 'FALSE' : 'TRUE';

  /*
   * Every other operator needs a value. Without one the honest verdict is UNKNOWN, not FALSE.
   *
   * Returning FALSE here is the single most consequential bug this engine could have: a security rule
   * conditioned on "the system holds payment data" would quietly not apply to every project that had
   * not answered the question, and the plan would show no payment obligations at all.
   */
  if (!answered) return 'UNKNOWN';

  const value = intake.value(condition.key);

  if (condition.operator === 'INCLUDES_ANY' || condition.operator === 'INCLUDES_ALL') {
    const held = intake.list(condition.key);
    const wanted = Array.isArray(condition.value) ? condition.value : [];
    const matches =
      condition.operator === 'INCLUDES_ANY'
        ? wanted.some((w) => held.includes(w))
        : wanted.every((w) => held.includes(w));
    return matches ? 'TRUE' : 'FALSE';
  }

  return evaluateScalar(value, condition);
}

function evaluateScalar(value: unknown, condition: RuleCondition): ConditionVerdict {
  const expected = condition.value;

  switch (condition.operator) {
    case 'EQUALS':
      return value === expected ? 'TRUE' : 'FALSE';
    case 'NOT_EQUALS':
      return value !== expected ? 'TRUE' : 'FALSE';
    case 'IN':
      return Array.isArray(expected) && typeof value === 'string' && expected.includes(value)
        ? 'TRUE'
        : 'FALSE';
    case 'NOT_IN':
      return Array.isArray(expected) && typeof value === 'string' && expected.includes(value)
        ? 'FALSE'
        : 'TRUE';
    case 'IS_TRUE':
      return value === true ? 'TRUE' : 'FALSE';
    case 'IS_FALSE':
      return value === false ? 'TRUE' : 'FALSE';
    case 'GREATER_THAN':
      if (typeof value !== 'number' || typeof expected !== 'number') return 'UNKNOWN';
      return value > expected ? 'TRUE' : 'FALSE';
    case 'LESS_THAN':
      if (typeof value !== 'number' || typeof expected !== 'number') return 'UNKNOWN';
      return value < expected ? 'TRUE' : 'FALSE';
    case 'EXISTS':
      return value !== undefined && value !== null ? 'TRUE' : 'FALSE';
    case 'NOT_EXISTS':
      return value === undefined || value === null ? 'TRUE' : 'FALSE';
    case 'IS_ANSWERED':
      return value !== undefined && value !== null ? 'TRUE' : 'FALSE';
    case 'IS_UNANSWERED':
      return value === undefined || value === null ? 'TRUE' : 'FALSE';
    case 'INCLUDES_ANY':
    case 'INCLUDES_ALL': {
      if (!Array.isArray(value)) return 'FALSE';
      const wanted = Array.isArray(expected) ? expected : [];
      const matches =
        condition.operator === 'INCLUDES_ANY'
          ? wanted.some((w) => value.includes(w))
          : wanted.every((w) => value.includes(w));
      return matches ? 'TRUE' : 'FALSE';
    }
  }
}

function evaluateGraphCondition(
  condition: RuleCondition,
  context: EvaluationContext,
): ConditionVerdict {
  const graph = context.graph;
  // No graph is not the same as an empty graph. A rule asking "does the project have an
  // architecture decision" before anything has been generated cannot be answered, and reporting
  // FALSE would raise findings against a project that has not begun.
  if (graph === undefined) return 'UNKNOWN';

  const count = graph.nodes.filter((n) => n.class === condition.key).length;

  switch (condition.operator) {
    case 'EXISTS':
      return count > 0 ? 'TRUE' : 'FALSE';
    case 'NOT_EXISTS':
      return count === 0 ? 'TRUE' : 'FALSE';
    case 'GREATER_THAN':
      return typeof condition.value === 'number' && count > condition.value ? 'TRUE' : 'FALSE';
    case 'LESS_THAN':
      return typeof condition.value === 'number' && count < condition.value ? 'TRUE' : 'FALSE';

    /*
     * Listed rather than caught by a `default`.
     *
     * A default clause would silently absorb any operator added to the schema later — the operator
     * would be accepted by the DSL and quietly ignored here, which makes a rule using it look
     * evaluated when it was not. Exhaustiveness turns that into a compile error.
     *
     * These operators are all about *values*, and a graph condition counts nodes of a class. There
     * is no sensible value to compare, so the honest answer is that the question cannot be decided.
     */
    case 'EQUALS':
    case 'NOT_EQUALS':
    case 'IN':
    case 'NOT_IN':
    case 'INCLUDES_ANY':
    case 'INCLUDES_ALL':
    case 'IS_ANSWERED':
    case 'IS_UNANSWERED':
    case 'IS_TRUE':
    case 'IS_FALSE':
      return 'UNKNOWN';
  }
}

/* -------------------------------------------------------------------------- */
/* Scope                                                                      */
/* -------------------------------------------------------------------------- */

function inScope(rule: Rule, context: EvaluationContext): { ok: boolean; because?: string } {
  if (rule.deprecatedFrom !== undefined && context.asOf >= rule.deprecatedFrom) {
    return { ok: false, because: `withdrawn on ${rule.deprecatedFrom}` };
  }

  if (context.asOf < rule.activeFrom) {
    return { ok: false, because: `not in force until ${rule.activeFrom}` };
  }

  if (rule.projectTypeScope.length > 0) {
    /*
     * An unknown project type does not put the rule out of scope — it makes it undecidable.
     *
     * Treating "we do not know the type" as "the type-scoped rules do not apply" would mean a project
     * that skipped one question silently escaped every project-type security obligation. Handled as
     * an unanswered required input below rather than here.
     */
    if (context.projectType === undefined) return { ok: true };
    if (!rule.projectTypeScope.includes(context.projectType)) {
      return { ok: false, because: `it applies only to ${rule.projectTypeScope.join(', ')}` };
    }
  }

  if (rule.lifecycleScope.length > 0 && !rule.lifecycleScope.includes(context.lifecycleState)) {
    return { ok: false, because: `it applies only during ${rule.lifecycleScope.join(', ')}` };
  }

  if (rule.methodologyScope.length > 0 && !rule.methodologyScope.includes(context.methodology)) {
    return {
      ok: false,
      because: `it applies only to ${rule.methodologyScope.join(', ')} delivery`,
    };
  }

  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Evaluation                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Evaluate a ruleset against a project.
 *
 * Rules are evaluated in catalogue order and their results returned in that order. The catalogue is a
 * frozen array, so the order is stable — which matters because the UI renders findings in the order
 * it receives them, and a list that reshuffles between two identical runs looks like the project
 * changed.
 */
export function evaluateRules(
  rules: readonly Rule[],
  context: EvaluationContext,
  rulesetVersion: string,
): EvaluationResult {
  const intake = new Intake(context.intake);

  const results: RuleResult[] = [];
  const applied: Rule[] = [];

  for (const rule of rules) {
    const scope = inScope(rule, context);

    if (!scope.ok) {
      results.push(
        report(
          rule,
          'NOT_APPLICABLE',
          `This does not apply because ${scope.because ?? 'it is out of scope'}.`,
        ),
      );
      continue;
    }

    const missing = rule.requiredInputs.filter((field) => !intake.isAnswered(field));

    // Project type is a required input for any rule that scopes on it, whether or not the rule says
    // so — otherwise a type-scoped rule silently passes on projects with no type.
    if (rule.projectTypeScope.length > 0 && context.projectType === undefined) {
      missing.push('project.type');
    }

    if (missing.length > 0) {
      results.push({
        ...report(
          rule,
          'INDETERMINATE',
          `Whether this applies cannot be decided yet: ${missing.join(', ')} ${missing.length === 1 ? 'has' : 'have'} not been answered. ${rule.rationale}`,
        ),
        missingInputs: [...new Set(missing)].sort(),
      });
      continue;
    }

    const verdict = evaluateConditions(rule, context, intake);

    if (verdict === 'UNKNOWN') {
      results.push(
        report(
          rule,
          'INDETERMINATE',
          `Whether this applies depends on information the project does not have yet. ${rule.rationale}`,
        ),
      );
      continue;
    }

    if (verdict === 'FALSE') {
      results.push(
        report(rule, 'NOT_APPLICABLE', `This does not apply to this project. ${rule.rationale}`),
      );
      continue;
    }

    results.push(
      report(
        rule,
        'APPLIED',
        `${rule.rationale} This ${describeSeverity(rule.severity)}. ${rule.remediation}`,
      ),
    );
    applied.push(rule);
  }

  const { conflicts, withheld } = findConflicts(applied);
  const emissions = collect(applied, withheld);

  return { rulesetVersion, results, emissions, conflicts, withheld };
}

function evaluateConditions(
  rule: Rule,
  context: EvaluationContext,
  intake: Intake,
): ConditionVerdict {
  // A rule with no conditions applies wherever it is in scope. That is how the unconditional
  // baseline obligations are expressed — every project gets them.
  if (rule.conditions.length === 0) return 'TRUE';

  const verdicts = rule.conditions.map((c) => evaluateCondition(c, context, intake));

  if (rule.conditionMode === 'ALL') {
    // One definite FALSE settles it; an UNKNOWN alongside only TRUEs does not.
    if (verdicts.includes('FALSE')) return 'FALSE';
    if (verdicts.includes('UNKNOWN')) return 'UNKNOWN';
    return 'TRUE';
  }

  if (verdicts.includes('TRUE')) return 'TRUE';
  if (verdicts.includes('UNKNOWN')) return 'UNKNOWN';
  return 'FALSE';
}

function report(rule: Rule, outcome: RuleOutcome, explanation: string): RuleResult {
  return {
    ruleId: rule.id,
    ruleVersion: rule.version,
    outcome,
    severity: rule.severity,
    category: rule.category,
    title: rule.title,
    explanation,
    missingInputs: [],
  };
}

/* -------------------------------------------------------------------------- */
/* Conflicts and emissions                                                    */
/* -------------------------------------------------------------------------- */

function findConflicts(applied: readonly Rule[]): {
  conflicts: Conflict[];
  withheld: string[];
} {
  const bySubject = new Map<string, Rule[]>();

  // Pairwise. The catalogue is a few hundred rules and only the ones that actually fired are
  // compared, so this is small — and an index keyed by emitted key would still need the pairwise
  // step to decide whether two rules genuinely disagree or merely coincide.
  for (let i = 0; i < applied.length; i += 1) {
    for (let j = i + 1; j < applied.length; j += 1) {
      const a = applied[i];
      const b = applied[j];
      if (a === undefined || b === undefined) continue;

      for (const subject of conflictsOver(a, b)) {
        const group = bySubject.get(subject) ?? [];
        if (!group.includes(a)) group.push(a);
        if (!group.includes(b)) group.push(b);
        bySubject.set(subject, group);
      }
    }
  }

  const conflicts: Conflict[] = [];
  const withheld: string[] = [];

  // Sorted, so the report does not depend on Map insertion order.
  for (const subject of [...bySubject.keys()].sort()) {
    const group = bySubject.get(subject) ?? [];
    const conflict = resolveConflict(subject, group);
    conflicts.push(conflict);
    if (conflict.kind === 'UNRESOLVABLE') withheld.push(subject);
  }

  return { conflicts, withheld };
}

function collect(applied: readonly Rule[], withheld: readonly string[]): Emissions {
  const blocked = new Set(withheld);

  const requirements: (EmittedRequirement & { ruleId: string })[] = [];
  const tasks: (EmittedTask & { ruleId: string })[] = [];
  const tests: (EmittedTest & { ruleId: string })[] = [];
  const gates: (EmittedGate & { ruleId: string })[] = [];
  const risks: (EmittedRisk & { ruleId: string })[] = [];
  const calculationEffects: (CalculationEffect & { ruleId: string })[] = [];

  const seenRequirements = new Set<string>();
  const seenTasks = new Set<string>();
  const seenTests = new Set<string>();
  const seenRisks = new Set<string>();
  const seenGates = new Set<string>();

  for (const rule of applied) {
    for (const requirement of rule.emittedRequirements) {
      if (blocked.has(`requirement:${requirement.key}`)) continue;
      // Several rules converging on the same requirement is normal and is not duplication to report.
      // The first rule to emit it is credited, and the catalogue order is stable.
      if (seenRequirements.has(requirement.key)) continue;
      seenRequirements.add(requirement.key);
      requirements.push({ ...requirement, ruleId: rule.id });
    }

    for (const task of rule.emittedTasks) {
      if (seenTasks.has(task.key)) continue;
      seenTasks.add(task.key);
      tasks.push({ ...task, ruleId: rule.id });
    }

    for (const test of rule.emittedTests) {
      if (seenTests.has(test.key)) continue;
      seenTests.add(test.key);
      tests.push({ ...test, ruleId: rule.id });
    }

    for (const gate of rule.emittedGates) {
      if (blocked.has(`gate:${gate.gateKey}`)) continue;
      const key = `${gate.gateKey}:${gate.criterion}`;
      if (seenGates.has(key)) continue;
      seenGates.add(key);
      gates.push({ ...gate, ruleId: rule.id });
    }

    for (const risk of rule.emittedRisks) {
      if (seenRisks.has(risk.key)) continue;
      seenRisks.add(risk.key);
      risks.push({ ...risk, ruleId: rule.id });
    }

    for (const effect of rule.calculationEffects) {
      // Calculation effects are *not* deduplicated: two rules each adding contingency for different
      // reasons both add contingency. Collapsing them would silently discard one of the reasons the
      // number is what it is.
      calculationEffects.push({ ...effect, ruleId: rule.id });
    }
  }

  return { requirements, tasks, tests, gates, risks, calculationEffects };
}

/* -------------------------------------------------------------------------- */
/* Summary                                                                    */
/* -------------------------------------------------------------------------- */

export interface EvaluationSummary {
  readonly applied: number;
  readonly notApplicable: number;
  readonly indeterminate: number;
  readonly mandatoryApplied: number;
  readonly unresolvableConflicts: number;
  /** Every intake field that blocked at least one rule, so the UI can ask for them. */
  readonly blockingInputs: readonly string[];
}

export function summarise(result: EvaluationResult): EvaluationSummary {
  const blocking = new Set<string>();
  for (const r of result.results) for (const input of r.missingInputs) blocking.add(input);

  return {
    applied: result.results.filter((r) => r.outcome === 'APPLIED').length,
    notApplicable: result.results.filter((r) => r.outcome === 'NOT_APPLICABLE').length,
    indeterminate: result.results.filter((r) => r.outcome === 'INDETERMINATE').length,
    mandatoryApplied: result.results.filter(
      (r) => r.outcome === 'APPLIED' && r.severity === 'MANDATORY',
    ).length,
    unresolvableConflicts: result.conflicts.filter((c) => c.kind === 'UNRESOLVABLE').length,
    blockingInputs: [...blocking].sort(),
  };
}
