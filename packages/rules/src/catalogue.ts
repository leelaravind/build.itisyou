/**
 * The rule catalogue.
 *
 * Contract: gap-spec §14 sets minimum counts per category and adds the instruction that governs the
 * whole thing — **"The rules must be meaningful. Do not create artificial rules solely to meet a
 * number."**
 *
 * That instruction is unenforceable by counting, which is exactly why the counts here are a floor
 * rather than a target. What *is* enforceable is the structure that makes a padded rule hard to
 * write: `defineRule` refuses a rule that emits nothing, a mandatory legal rule with no citation, a
 * test that claims to verify something the rule does not emit, or a rule deprecated before it was
 * active. A rule that survives all of that has had to make a specific claim about a specific
 * consequence.
 *
 * The catalogue itself is frozen and ordered. Evaluation walks it in order and the UI renders results
 * in the order it receives them, so a stable array is what stops two identical runs producing two
 * differently-ordered lists.
 */

import type { Rule, RuleCategory, RuleSeverity } from './schema.ts';
import { RULE_CATEGORIES } from './schema.ts';
import { SECURITY_RULES } from './packs/security.ts';
import { TESTING_RULES } from './packs/testing.ts';
import { DISCOVERY_RULES } from './packs/discovery.ts';
import { ARCHITECTURE_RULES } from './packs/architecture.ts';
import { DELIVERY_RULES } from './packs/delivery.ts';
import { RELEASE_RULES } from './packs/release.ts';

/**
 * The version of the catalogue as a whole.
 *
 * Distinct from each rule's own version, and from the rule *format* version. Gap-spec §13.1 requires
 * that the same project version, ruleset version and inputs produce the same result — so a stored
 * evaluation records this, and can therefore still be explained after the catalogue moves on.
 */
export const RULESET_VERSION = '1.0.0';

/**
 * Every rule, in a fixed order.
 *
 * Pack order is deliberate rather than alphabetical: discovery rules fire earliest in a project's
 * life and read first in any report, and security rules read before delivery ones because they are
 * the ones a reader should not skim past.
 */
export const RULES: readonly Rule[] = Object.freeze([
  ...DISCOVERY_RULES,
  ...ARCHITECTURE_RULES,
  ...SECURITY_RULES,
  ...TESTING_RULES,
  ...RELEASE_RULES,
  ...DELIVERY_RULES,
]);

/* -------------------------------------------------------------------------- */
/* Minimum counts                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Gap-spec §14's table, as a floor.
 *
 * Asserted by a test rather than enforced at import time. A catalogue that failed to load because it
 * was one rule short of a target would be the counting mistake the instruction warns against — the
 * pressure it creates is precisely what produces filler.
 */
export const MINIMUM_RULES: Readonly<Record<RuleCategory, number>> = {
  INTAKE: 20,
  REQUIREMENTS: 20,
  ARCHITECTURE: 25,
  PLANNING: 20,
  RESOURCE: 15,
  BUDGET: 20,
  TESTING: 35,
  SECURITY: 35,
  ACCESSIBILITY: 10,
  DEPLOYMENT: 20,
  PRODUCTION_VERIFICATION: 15,
  OPERATIONS: 10,
  DOCUMENTATION: 10,
  GOVERNANCE: 15,
};

/* -------------------------------------------------------------------------- */
/* Access                                                                     */
/* -------------------------------------------------------------------------- */

export function rulesInCategory(category: RuleCategory): readonly Rule[] {
  return RULES.filter((r) => r.category === category);
}

export function rulesWithSeverity(severity: RuleSeverity): readonly Rule[] {
  return RULES.filter((r) => r.severity === severity);
}

export function findRule(id: string): Rule | undefined {
  return RULES.find((r) => r.id === id);
}

export function countByCategory(): Readonly<Record<RuleCategory, number>> {
  const counts = Object.fromEntries(RULE_CATEGORIES.map((c) => [c, 0])) as Record<
    RuleCategory,
    number
  >;

  for (const rule of RULES) counts[rule.category] += 1;
  return counts;
}

/* -------------------------------------------------------------------------- */
/* Integrity                                                                  */
/* -------------------------------------------------------------------------- */

export interface CatalogueProblem {
  readonly code: string;
  readonly message: string;
  readonly ruleIds: readonly string[];
}

/**
 * Problems that can only be seen across the whole catalogue.
 *
 * `defineRule` validates a rule in isolation; these are the defects that need every rule at once —
 * a duplicated id, two rules disagreeing about the same emitted key, a category below its floor.
 * Run by a test rather than at import, so a catalogue with a problem still loads and can be inspected.
 */
export function checkCatalogue(): readonly CatalogueProblem[] {
  const problems: CatalogueProblem[] = [];

  /* Duplicate ids would make `findRule` return whichever came first, silently. */
  const byId = new Map<string, Rule[]>();
  for (const rule of RULES) {
    const group = byId.get(rule.id) ?? [];
    group.push(rule);
    byId.set(rule.id, group);
  }

  for (const [id, group] of byId) {
    if (group.length > 1) {
      problems.push({
        code: 'DUPLICATE_RULE_ID',
        message: `${String(group.length)} rules share the id ${id}.`,
        ruleIds: [id],
      });
    }
  }

  /* A category below its floor is a gap in coverage, not a style issue. */
  const counts = countByCategory();
  for (const category of RULE_CATEGORIES) {
    const minimum = MINIMUM_RULES[category];
    const actual = counts[category];
    if (actual < minimum) {
      problems.push({
        code: 'CATEGORY_BELOW_MINIMUM',
        message: `${category} has ${String(actual)} rules; gap-spec §14 asks for at least ${String(minimum)}.`,
        ruleIds: [],
      });
    }
  }

  /*
   * Two rules emitting the same requirement key with different priorities.
   *
   * Not necessarily wrong — the conflict machinery exists precisely to handle it — but worth
   * surfacing at build time, because most instances are a copy-paste rather than a deliberate
   * disagreement between authorities.
   */
  const requirementPriorities = new Map<string, Map<string, string[]>>();
  for (const rule of RULES) {
    for (const requirement of rule.emittedRequirements) {
      const byPriority = requirementPriorities.get(requirement.key) ?? new Map<string, string[]>();
      const ids = byPriority.get(requirement.priority) ?? [];
      ids.push(rule.id);
      byPriority.set(requirement.priority, ids);
      requirementPriorities.set(requirement.key, byPriority);
    }
  }

  for (const [key, byPriority] of requirementPriorities) {
    if (byPriority.size <= 1) continue;
    problems.push({
      code: 'REQUIREMENT_PRIORITY_DISAGREEMENT',
      message: `Requirement "${key}" is emitted with ${String(byPriority.size)} different priorities.`,
      ruleIds: [...byPriority.values()].flat().sort(),
    });
  }

  /* A gate key no gate defines means the criterion attaches to nothing and is never evaluated. */
  const knownGateKeys = new Set([
    'DISCOVERY',
    'REQUIREMENTS',
    'ARCHITECTURE',
    'PLANNING',
    'DEVELOPMENT',
    'TESTING',
    'SECURITY',
    'RELEASE_READINESS',
    'PRODUCTION_VERIFICATION',
    'OPERATIONAL_READINESS',
    'COMPLETION',
  ]);

  for (const rule of RULES) {
    for (const gate of rule.emittedGates) {
      if (knownGateKeys.has(gate.gateKey)) continue;
      problems.push({
        code: 'UNKNOWN_GATE_KEY',
        message: `${rule.id} attaches a criterion to "${gate.gateKey}", which is not a gate.`,
        ruleIds: [rule.id],
      });
    }
  }

  /*
   * A rule scoped to a project type that does not exist can never fire.
   *
   * It would sit in the catalogue looking like coverage while being unreachable — the exact shape of
   * the padding gap-spec §14 warns against, arrived at by accident rather than intent.
   */
  const knownTypes = new Set([
    'PUBLIC_WEB_APP',
    'SAAS_WEB_APP',
    'INTERNAL_BUSINESS_APP',
    'API_BACKEND_PLATFORM',
    'MOBILE_APP',
    'AI_ENABLED_WEB_APP',
    'DEVELOPER_TOOLING',
    'ECOMMERCE',
    'PARTIALLY_SUPPORTED',
    'UNKNOWN',
  ]);

  for (const rule of RULES) {
    for (const type of rule.projectTypeScope) {
      if (knownTypes.has(type)) continue;
      problems.push({
        code: 'UNKNOWN_PROJECT_TYPE',
        message: `${rule.id} is scoped to project type "${type}", which does not exist.`,
        ruleIds: [rule.id],
      });
    }
  }

  return problems;
}

/* -------------------------------------------------------------------------- */
/* Summary                                                                    */
/* -------------------------------------------------------------------------- */

export interface CatalogueSummary {
  readonly total: number;
  readonly byCategory: Readonly<Record<RuleCategory, number>>;
  readonly bySeverity: Readonly<Record<RuleSeverity, number>>;
  readonly emittedRequirements: number;
  readonly emittedTests: number;
  readonly emittedGateCriteria: number;
  readonly withReferences: number;
}

export function summariseCatalogue(): CatalogueSummary {
  const bySeverity: Record<RuleSeverity, number> = { MANDATORY: 0, RECOMMENDED: 0, ADVISORY: 0 };
  let requirements = 0;
  let tests = 0;
  let gateCriteria = 0;
  let withReferences = 0;

  for (const rule of RULES) {
    bySeverity[rule.severity] += 1;
    requirements += rule.emittedRequirements.length;
    tests += rule.emittedTests.length;
    gateCriteria += rule.emittedGates.length;
    if (rule.references.length > 0) withReferences += 1;
  }

  return {
    total: RULES.length,
    byCategory: countByCategory(),
    bySeverity,
    emittedRequirements: requirements,
    emittedTests: tests,
    emittedGateCriteria: gateCriteria,
    withReferences,
  };
}
