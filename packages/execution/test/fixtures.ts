/**
 * Golden fixtures for execution planning.
 *
 * Contract: plan §34 makes the Phase-8 gate "**solo + 12-person fixtures produce valid execution
 * plans**". Those two are the extremes the decomposer has to handle without special-casing:
 *
 * - The solo project must still be decomposed — gap-spec §18.3 — but without workstreams, epics or
 *   assignment ceremony. Sequencing, dependencies and focus; not team process.
 * - The twelve-person project must use the structure it genuinely needs, and no more.
 *
 * Both are built from the real generator and the real rule evaluator rather than from hand-written
 * graphs. A fixture assembled by hand tests the decomposer against a shape I imagined; these test it
 * against the shape the rest of the platform actually produces.
 */

import type { IntakeField } from '@govintel/intake/schema';
import { generateProject } from '@govintel/twin/generate';
import { RULES, RULESET_VERSION } from '@govintel/rules/catalogue';
import { evaluateRules } from '@govintel/rules/evaluate';
import type { HumanResource, AiCapability } from '../src/scheduling.ts';

export const FIXED_TIME = '2026-03-01T09:00:00.000Z';
export const FIXED_DATE = '2026-03-01';
export const SOLO_PROJECT_ID = '11111111-1111-4111-8111-111111111111';
export const TEAM_PROJECT_ID = '22222222-2222-4222-8222-222222222222';

function answer(
  fieldId: string,
  category: IntakeField['category'],
  value: unknown,
  state: IntakeField['state'] = 'CONFIRMED',
): IntakeField {
  return {
    fieldId,
    category,
    value,
    state,
    provenance: 'USER_CONFIRMED',
    confidence: 'HIGH',
    lastUpdatedAt: FIXED_TIME,
    ...(state === 'CONFIRMED' ? { confirmedBy: 'fixture-user' } : {}),
  };
}

/* -------------------------------------------------------------------------- */
/* Solo                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * One person building a small internal tool.
 *
 * Deliberately modest: no compliance regime, no payments, an internal audience. The decomposer should
 * produce a shallow hierarchy — phases and tasks — and the schedule should flag the single-person
 * dependency without drowning it in assignment warnings.
 */
export const SOLO_INTAKE: readonly IntakeField[] = [
  answer('idea.summary', 'IDEA', 'A tool for tracking which laptops are lent to which staff.'),
  answer('objectives.primary', 'OBJECTIVES', 'Stop losing track of equipment between offices.'),
  answer('users.primary', 'TARGET_USERS', 'Two people in the IT team.'),
  answer('project.type', 'PROJECT_TYPE', 'INTERNAL_BUSINESS_APP'),
  answer('team.size', 'TEAM', 1),
  answer('capacity.hoursPerWeek', 'WORKING_CAPACITY', 20),
  answer('data.types', 'DATA_TYPES', ['Account details']),
  answer('security.authentication', 'SECURITY', true),
  answer('deadline.fixed', 'DEADLINE', false),
  answer('accessibility.target', 'ACCESSIBILITY', 'WCAG 2.2 AA'),
];

export const SOLO_RESOURCES: readonly HumanResource[] = [
  {
    id: 'r-sam',
    name: 'Sam',
    role: 'Developer',
    skills: ['TypeScript', 'PostgreSQL'],
    workingHoursPerWeek: 37.5,
    // Half their week is other work. Recording it is the difference between a plan that is achievable
    // and one that assumes a person who does not exist.
    projectAllocation: 0.5,
  },
];

/** Gap-spec §18.2: a capability, not an employee. */
export const SOLO_CAPABILITIES: readonly AiCapability[] = [
  {
    id: 'cap-coding-agent',
    name: 'Coding agent',
    appliesTo: ['IMPLEMENTATION', 'TESTING'],
    effortMultiplier: { low: 0.6, high: 0.95 },
    requiresVerification: true,
  },
];

/* -------------------------------------------------------------------------- */
/* Twelve people                                                              */
/* -------------------------------------------------------------------------- */

/**
 * A twelve-person team building a SaaS product with compliance obligations.
 *
 * Chosen so that every optional hierarchy level has a genuine reason to exist, and so the schedule
 * checks have something to find: one person holds a skill nobody else does, which is invisible in a
 * capacity total.
 */
export const TEAM_INTAKE: readonly IntakeField[] = [
  answer('idea.summary', 'IDEA', 'A scheduling and records platform sold to dental practices.'),
  answer('objectives.primary', 'OBJECTIVES', 'Cut missed appointments by a quarter in year one.'),
  answer('users.primary', 'TARGET_USERS', 'Practice managers, reception staff and clinicians.'),
  answer('capabilities.key', 'KEY_CAPABILITIES', ['Booking', 'Reminders', 'Records', 'Reporting']),
  answer('project.type', 'PROJECT_TYPE', 'SAAS_WEB_APP'),
  answer('team.size', 'TEAM', 12),
  answer('capacity.hoursPerWeek', 'WORKING_CAPACITY', 37.5),
  answer('team.skills', 'SKILLS', ['TypeScript', 'PostgreSQL', 'React', 'Infrastructure']),
  answer('budget.total', 'BUDGET', 450000),
  answer('budget.currency', 'BUDGET', 'GBP'),
  answer('deadline.target', 'DEADLINE', '2027-03-31'),
  answer('deadline.fixed', 'DEADLINE', true),
  answer('data.types', 'DATA_TYPES', ['Account details', 'Personal data', 'Health data']),
  answer('security.authentication', 'SECURITY', true),
  answer('compliance.regimes', 'COMPLIANCE', ['UK GDPR', 'ISO 27001']),
  answer('accessibility.target', 'ACCESSIBILITY', 'WCAG 2.2 AA'),
  answer('availability.expectation', 'AVAILABILITY', 'High availability'),
  answer('performance.expectation', 'PERFORMANCE', 'Standard web responsiveness'),
  answer('integrations.thirdParties', 'THIRD_PARTIES', ['Payment provider', 'SMS gateway']),
  answer('maintenance.owner', 'MAINTENANCE', 'The same team, after launch.'),
];

export const TEAM_RESOURCES: readonly HumanResource[] = [
  ...Array.from({ length: 8 }, (_, i) => ({
    id: `r-dev-${String(i + 1)}`,
    name: `Developer ${String(i + 1)}`,
    role: 'Developer',
    skills: ['TypeScript', 'React'],
    workingHoursPerWeek: 37.5,
    projectAllocation: 1,
  })),
  {
    id: 'r-qa-1',
    name: 'Priya',
    role: 'Test engineer',
    skills: ['TypeScript', 'Testing'],
    workingHoursPerWeek: 37.5,
    projectAllocation: 1,
  },
  {
    id: 'r-qa-2',
    name: 'Tom',
    role: 'Test engineer',
    skills: ['Testing'],
    workingHoursPerWeek: 37.5,
    projectAllocation: 1,
  },
  {
    id: 'r-infra',
    name: 'Nadia',
    role: 'Infrastructure engineer',
    skills: ['Infrastructure', 'PostgreSQL'],
    workingHoursPerWeek: 37.5,
    projectAllocation: 1,
    // On-call is a real commitment against real hours, and it is routinely omitted from capacity.
    supportHoursPerWeek: 5,
  },
  {
    id: 'r-lead',
    name: 'Alex',
    role: 'Delivery lead',
    skills: ['Delivery', 'Security'],
    workingHoursPerWeek: 37.5,
    projectAllocation: 0.6,
    // The only person with Security. A capacity total cannot see this; the bottleneck check can.
    otherProjectHoursPerWeek: 10,
  },
];

/* -------------------------------------------------------------------------- */
/* Building the inputs                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Run the real generator and rule evaluator to produce decomposition input.
 *
 * Deliberately not a shortcut. The decomposer consumes what Phases 6 and 7 emit, so a fixture that
 * bypassed them would be testing it against an interface nothing produces.
 */
export function buildInputs(
  projectId: string,
  projectName: string,
  intake: readonly IntakeField[],
  projectType: string,
) {
  const generated = generateProject({
    projectId,
    projectName,
    intake,
    at: FIXED_TIME,
  });

  const evaluation = evaluateRules(
    RULES,
    {
      projectId,
      projectType,
      lifecycleState: 'PLANNING',
      methodology: 'AGILE',
      intake,
      graph: generated.graph,
      asOf: FIXED_DATE,
    },
    RULESET_VERSION,
  );

  return { graph: generated.graph, emissions: evaluation.emissions, evaluation };
}

export function soloInputs() {
  return buildInputs(SOLO_PROJECT_ID, 'Equipment tracker', SOLO_INTAKE, 'INTERNAL_BUSINESS_APP');
}

export function teamInputs() {
  return buildInputs(TEAM_PROJECT_ID, 'Practice platform', TEAM_INTAKE, 'SAAS_WEB_APP');
}
