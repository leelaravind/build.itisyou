/**
 * The rule DSL.
 *
 * Contract: gap-spec §13 lists the required rule fields and demands the engine be **data-driven**;
 * plan §7 calls the deterministic rules engine "one of the main intellectual-property layers".
 *
 * Data-driven is the whole design, and it is worth saying why rather than treating it as a style
 * preference. A rule written as code can do anything: read a clock, call a service, mutate the
 * project it is evaluating. A rule written as data can only *describe* a condition and *declare* what
 * follows, and the evaluator decides what that means. Three properties fall out of that, and none of
 * them are achievable with rules-as-functions:
 *
 * - **Determinism is structural.** §13.1 requires that the same project version, ruleset version and
 *   inputs produce the same result. A declarative condition has nowhere to hide a clock.
 * - **Explanations are free.** §13.3 requires every emitted action to answer "why is this required?"
 *   A rule that carries its own rationale, remediation and references answers that without anyone
 *   writing per-rule explanation code — which would rot immediately.
 * - **Rules can be reviewed by people who do not read TypeScript.** A security rule that only a
 *   developer can audit is a security rule nobody audits.
 *
 * The conditions below are a deliberately small language. It can express what project rules actually
 * need — field comparisons, set membership, presence, and boolean combination — and cannot express
 * arbitrary computation. That limit is the point: an expression language rich enough to be convenient
 * is rich enough to be non-deterministic, and this one has no escape hatch.
 */

import { z } from 'zod';

/* -------------------------------------------------------------------------- */
/* Identity and versioning                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Rule ids are structured, not arbitrary: `SEC-WEB-AUTH-001` (plan §7.1).
 *
 * The structure is load-bearing at review time. A finding that cites `SEC-…` is immediately
 * placeable by someone who has never seen the catalogue, and a whole family can be located by prefix
 * without a lookup table.
 */
export const ruleIdSchema = z
  .string()
  .regex(
    /^[A-Z][A-Z0-9]{1,7}(-[A-Z0-9]{1,14}){1,3}$/,
    'A rule id looks like SEC-WEB-AUTH-001: uppercase segments separated by hyphens.',
  );

export const RULE_CATEGORIES = [
  'INTAKE',
  'REQUIREMENTS',
  'ARCHITECTURE',
  'PLANNING',
  'RESOURCE',
  'BUDGET',
  'TESTING',
  'SECURITY',
  'ACCESSIBILITY',
  'DEPLOYMENT',
  'PRODUCTION_VERIFICATION',
  'OPERATIONS',
  'DOCUMENTATION',
  'GOVERNANCE',
] as const;

export type RuleCategory = (typeof RULE_CATEGORIES)[number];

/**
 * Severity, and what each level actually does.
 *
 * `MANDATORY` is not "very important" — it is a rule that blocks a gate. The distinction matters
 * because a catalogue where everything is critical is a catalogue nobody reads: if 270 rules all
 * block release, the first one anybody hits gets waived and the habit spreads.
 */
export const RULE_SEVERITIES = ['MANDATORY', 'RECOMMENDED', 'ADVISORY'] as const;
export type RuleSeverity = (typeof RULE_SEVERITIES)[number];

/**
 * Where a rule's authority comes from. Gap-spec §13.2 orders these, most authoritative first.
 *
 * This is the field that decides conflicts, and it exists because "which rule wins" must not depend
 * on catalogue ordering or on which pack happened to load first.
 */
export const RULE_SOURCES = [
  'LEGAL_SECURITY',
  'ORGANIZATION_POLICY',
  'PROJECT_CONSTRAINT',
  'PROJECT_TYPE_PACK',
  'METHODOLOGY_PACK',
  'RECOMMENDED_DEFAULT',
] as const;

export type RuleSource = (typeof RULE_SOURCES)[number];

/* -------------------------------------------------------------------------- */
/* Conditions                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * What a condition may look at.
 *
 * A closed set, not a path expression. `intake.data.types` is a field the user answered;
 * `project.type` is a property of the project; `graph.has` asks whether the twin contains something.
 * Anything not addressable here cannot be conditioned on, which is a deliberate ceiling on what a
 * rule can couple itself to.
 */
export const CONDITION_SUBJECTS = [
  'INTAKE',
  'PROJECT',
  'GRAPH',
  'METHODOLOGY',
  'LIFECYCLE',
] as const;
export type ConditionSubject = (typeof CONDITION_SUBJECTS)[number];

export const CONDITION_OPERATORS = [
  'EQUALS',
  'NOT_EQUALS',
  'IN',
  'NOT_IN',
  'INCLUDES_ANY',
  'INCLUDES_ALL',
  'IS_ANSWERED',
  'IS_UNANSWERED',
  'IS_TRUE',
  'IS_FALSE',
  'GREATER_THAN',
  'LESS_THAN',
  'EXISTS',
  'NOT_EXISTS',
] as const;

export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

const conditionValueSchema = z.union([
  z.string().max(200),
  z.number(),
  z.boolean(),
  z.array(z.string().max(200)).max(50),
]);

/**
 * One test against the project.
 *
 * `IS_ANSWERED` is separate from `EXISTS` on purpose. An intake field can hold a value while its
 * state says the user does not know — the value is the marker they chose — so "has a row" and "the
 * user committed to an answer" are different questions, and conflating them is how a plan comes to
 * treat "I don't know" as a fact.
 */
export const conditionSchema = z
  .object({
    subject: z.enum(CONDITION_SUBJECTS),
    /** Field id, project property, or node class depending on the subject. */
    key: z.string().min(1).max(120),
    operator: z.enum(CONDITION_OPERATORS),
    value: conditionValueSchema.optional(),
  })
  .strict();

export type RuleCondition = z.infer<typeof conditionSchema>;

/**
 * How a rule's conditions combine.
 *
 * `ALL` and `ANY` only — no arbitrary nesting. A rule needing three levels of boolean structure is
 * two rules that have been squashed together, and squashed rules cannot be explained: the engine can
 * say "this fired", not "this fired because of the middle clause of the second disjunct".
 */
export const CONDITION_MODES = ['ALL', 'ANY'] as const;
export type ConditionMode = (typeof CONDITION_MODES)[number];

/* -------------------------------------------------------------------------- */
/* Emissions                                                                  */
/* -------------------------------------------------------------------------- */

const shortText = z.string().min(1).max(200);
const longText = z.string().min(1).max(2_000);

/**
 * A requirement a rule creates when it fires.
 *
 * `verification` is required, not optional. A requirement with no stated way to verify it cannot be
 * closed except by opinion — and the traceability matrix would then be full of requirements marked
 * satisfied because somebody said so, which is exactly the false assurance the graph's `VERIFIES`
 * rule exists to prevent.
 */
export const emittedRequirementSchema = z
  .object({
    key: z.string().min(1).max(60),
    title: shortText,
    description: longText,
    priority: z.enum(['MUST', 'SHOULD', 'COULD']),
    /** How this requirement is demonstrated to be met. */
    verification: longText,
  })
  .strict();

export const emittedTaskSchema = z
  .object({
    key: z.string().min(1).max(60),
    title: shortText,
    description: longText.optional(),
    /** Which phase this belongs to, by the phase key the generator uses. */
    phaseKey: z.string().min(1).max(40).optional(),
  })
  .strict();

export const emittedTestSchema = z
  .object({
    key: z.string().min(1).max(60),
    title: shortText,
    description: longText.optional(),
    /** What the test is evidence for, by emitted-requirement key. */
    verifies: z.string().min(1).max(60).optional(),
    kind: z.enum([
      'UNIT',
      'INTEGRATION',
      'E2E',
      'SECURITY',
      'ACCESSIBILITY',
      'PERFORMANCE',
      'MANUAL',
    ]),
  })
  .strict();

export const emittedGateSchema = z
  .object({
    /** Which gate this criterion attaches to. */
    gateKey: z.string().min(1).max(40),
    criterion: longText,
    /** Whether failing this criterion blocks the gate or merely reports. */
    blocking: z.boolean(),
  })
  .strict();

export const emittedRiskSchema = z
  .object({
    key: z.string().min(1).max(60),
    title: shortText,
    description: longText,
    likelihood: z.enum(['LOW', 'MEDIUM', 'HIGH']),
    impact: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  })
  .strict();

/**
 * How a rule changes a calculation.
 *
 * Declarative rather than a function, for the same reason the conditions are. A rule that could
 * compute a budget adjustment in code could compute anything, and the calculation snapshot would have
 * no way to record *why* the number moved — which plan §12 requires.
 */
export const calculationEffectSchema = z
  .object({
    calculation: z.string().min(1).max(60),
    kind: z.enum(['ADD_DAYS', 'MULTIPLY_EFFORT', 'ADD_COST', 'ADD_CONTINGENCY_PERCENT']),
    /** Ranges, never single figures (plan §12.3, no fake precision). */
    low: z.number(),
    high: z.number(),
    basis: longText,
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* The rule                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * One rule.
 *
 * `.strict()` throughout: a rule carrying a field the engine does not understand was written against
 * a different version of this format, and silently ignoring it would mean a rule that appears to be
 * in force and is not.
 */
export const ruleSchema = z
  .object({
    id: ruleIdSchema,
    /** Bumped when the rule's meaning changes. A stored finding keeps the version that produced it. */
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    title: shortText,
    description: longText,

    category: z.enum(RULE_CATEGORIES),
    severity: z.enum(RULE_SEVERITIES),
    source: z.enum(RULE_SOURCES),

    /** Empty means every project type. Named types narrow it. */
    projectTypeScope: z.array(z.string().max(64)).max(20).default([]),
    /** Empty means every lifecycle state. */
    lifecycleScope: z.array(z.string().max(40)).max(20).default([]),
    /** Empty means every methodology. */
    methodologyScope: z.array(z.string().max(40)).max(10).default([]),

    conditionMode: z.enum(CONDITION_MODES).default('ALL'),
    conditions: z.array(conditionSchema).max(20).default([]),

    /**
     * Intake fields this rule needs before it can be evaluated at all.
     *
     * Distinct from conditions. A rule that requires `data.types` and finds it unanswered must report
     * "I cannot tell yet", not "does not apply" — the difference between an unmet obligation and an
     * unknown one is precisely what the missing-information engine exists to surface.
     */
    requiredInputs: z.array(z.string().max(120)).max(20).default([]),

    emittedRequirements: z.array(emittedRequirementSchema).max(20).default([]),
    emittedTasks: z.array(emittedTaskSchema).max(20).default([]),
    emittedTests: z.array(emittedTestSchema).max(20).default([]),
    emittedGates: z.array(emittedGateSchema).max(20).default([]),
    emittedRisks: z.array(emittedRiskSchema).max(20).default([]),
    calculationEffects: z.array(calculationEffectSchema).max(10).default([]),

    /** §13.3: why is this required? Shown with every finding. */
    rationale: longText,
    /** What to actually do about it. A finding with no remediation is a complaint. */
    remediation: longText,
    /** Standards, regulations or sources. Empty is honest; a fabricated citation is not. */
    references: z.array(shortText).max(10).default([]),

    activeFrom: z.iso.date(),
    deprecatedFrom: z.iso.date().optional(),
  })
  .strict()
  .superRefine((rule, ctx) => {
    /*
     * A rule that emits nothing and affects nothing is inert. It would pass every schema check, sit
     * in the catalogue, count towards the total, and do nothing — which is exactly the "artificial
     * rules solely to meet a number" that gap-spec §14 forbids.
     */
    const emits =
      rule.emittedRequirements.length +
      rule.emittedTasks.length +
      rule.emittedTests.length +
      rule.emittedGates.length +
      rule.emittedRisks.length +
      rule.calculationEffects.length;

    if (emits === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'A rule must emit something or affect a calculation, or it does nothing at all.',
        path: ['emittedRequirements'],
      });
    }

    if (rule.deprecatedFrom !== undefined && rule.deprecatedFrom < rule.activeFrom) {
      ctx.addIssue({
        code: 'custom',
        message: 'A rule cannot be deprecated before it becomes active.',
        path: ['deprecatedFrom'],
      });
    }

    /*
     * A mandatory rule blocks a gate, so it must say how to satisfy it and where the obligation comes
     * from. "Required by policy" with no reference is how a control becomes folklore that nobody can
     * challenge and nobody can retire.
     */
    if (rule.severity === 'MANDATORY' && rule.source === 'LEGAL_SECURITY') {
      if (rule.references.length === 0) {
        ctx.addIssue({
          code: 'custom',
          message:
            'A mandatory legal or security rule must cite what it comes from. An uncitable obligation cannot be challenged or retired.',
          path: ['references'],
        });
      }
    }

    /*
     * A test that claims to verify a requirement must name one this rule actually emits. A dangling
     * reference would produce a traceability matrix with a verification arrow pointing at nothing.
     */
    const requirementKeys = new Set(rule.emittedRequirements.map((r) => r.key));
    for (const [index, test] of rule.emittedTests.entries()) {
      if (test.verifies === undefined) continue;
      if (requirementKeys.has(test.verifies)) continue;

      ctx.addIssue({
        code: 'custom',
        message: `Test "${test.key}" says it verifies "${test.verifies}", which this rule does not emit.`,
        path: ['emittedTests', index, 'verifies'],
      });
    }

    /* Duplicate keys inside one rule would collide when the emissions are materialised. */
    for (const [field, keys] of [
      ['emittedRequirements', rule.emittedRequirements.map((r) => r.key)],
      ['emittedTasks', rule.emittedTasks.map((r) => r.key)],
      ['emittedTests', rule.emittedTests.map((r) => r.key)],
      ['emittedRisks', rule.emittedRisks.map((r) => r.key)],
    ] as const) {
      if (new Set(keys).size !== keys.length) {
        ctx.addIssue({
          code: 'custom',
          message: 'Two emissions in this rule share a key.',
          path: [field],
        });
      }
    }
  });

export type Rule = z.infer<typeof ruleSchema>;
export type EmittedRequirement = z.infer<typeof emittedRequirementSchema>;
export type EmittedTask = z.infer<typeof emittedTaskSchema>;
export type EmittedTest = z.infer<typeof emittedTestSchema>;
export type EmittedGate = z.infer<typeof emittedGateSchema>;
export type EmittedRisk = z.infer<typeof emittedRiskSchema>;
export type CalculationEffect = z.infer<typeof calculationEffectSchema>;

/**
 * The input form, before defaults are applied.
 *
 * Rule packs are written as object literals, and requiring every optional array at every call site
 * would triple the size of the catalogue for no gain. `defineRule` fills them in.
 */
export type RuleInput = z.input<typeof ruleSchema>;

/**
 * Parse a rule, failing loudly.
 *
 * Rule packs are module-level constants, so this runs at import time and a malformed rule is a
 * startup failure rather than a runtime surprise during evaluation. That is the right trade: a
 * catalogue that half-loads is worse than one that refuses.
 */
export function defineRule(input: RuleInput): Rule {
  const result = ruleSchema.safeParse(input);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Rule ${input.id} is not valid — ${problems}`);
  }

  return result.data;
}

/** The version of the rule format itself, distinct from any rule's own version. */
export const RULE_FORMAT_VERSION = '1.0.0';
