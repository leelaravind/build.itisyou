/**
 * Intake field catalogue.
 *
 * Contract: gap-spec §9.1 (required categories), §9.2 (every question supports the five answer
 * modes), §10.4 — "Missing-information requirements must come from rule packs, not hardcoded
 * scattered UI logic."
 *
 * This is that data. The wizard renders from it; the missing-information engine reads from it; the
 * external-AI prompt package is generated from it. No screen hardcodes a question, so adding one is
 * a data change rather than an edit in three places that will drift.
 *
 * `importance` is the load-bearing property. It decides what blocks plan generation, what merely
 * degrades quality, and what ends up in the external-AI research request — so each value below is a
 * product decision, annotated where it is not obvious.
 */

import type { ImportanceLevel, IntakeCategory } from './schema.ts';

export type FieldKind =
  'text' | 'longText' | 'number' | 'currency' | 'date' | 'select' | 'multiSelect' | 'boolean';

export interface FieldDefinition {
  readonly id: string;
  readonly category: IntakeCategory;
  /** The question as the user sees it. */
  readonly label: string;
  /** One line of why it is being asked. Shown inline — a question with no stated purpose feels like bureaucracy. */
  readonly rationale: string;
  readonly kind: FieldKind;
  readonly importance: ImportanceLevel;
  readonly options?: readonly string[];
  /**
   * Value applied by "use recommended default". Absent means the mode is unavailable for this
   * field — there is no sensible default for a project's own idea or deadline.
   */
  readonly recommendedDefault?: unknown;
  /** Complexity mode at which the question first appears (plan §2.4 progressive disclosure). */
  readonly minMode: 'beginner' | 'professional' | 'enterprise';
  readonly placeholder?: string;
}

export const FIELD_DEFINITIONS: readonly FieldDefinition[] = [
  /* ---------------------------------------------------------------- Idea */
  {
    id: 'idea.summary',
    category: 'IDEA',
    label: 'What are you building?',
    rationale: 'Everything else is derived from this, so it is the one question with no default.',
    kind: 'longText',
    importance: 'CRITICAL',
    minMode: 'beginner',
    placeholder: 'A compliance reporting platform for UK accountancy firms…',
  },
  {
    id: 'objectives.primary',
    category: 'OBJECTIVES',
    label: 'What does success look like?',
    rationale: 'Objectives become the traceability root — requirements are checked against them.',
    kind: 'longText',
    importance: 'RECOMMENDED',
    minMode: 'beginner',
  },
  {
    id: 'users.primary',
    category: 'TARGET_USERS',
    label: 'Who will use it?',
    rationale: 'Drives accessibility obligations, load assumptions and security posture.',
    kind: 'longText',
    importance: 'RECOMMENDED',
    minMode: 'beginner',
  },
  {
    id: 'capabilities.key',
    category: 'KEY_CAPABILITIES',
    label: 'What are the main things it must do?',
    rationale: 'The starting point for work breakdown.',
    kind: 'longText',
    importance: 'RECOMMENDED',
    minMode: 'beginner',
  },

  /* --------------------------------------------------------- Project type */
  {
    id: 'project.type',
    category: 'PROJECT_TYPE',
    label: 'What kind of software is it?',
    rationale:
      'Selects the rule pack. Security, testing and release obligations differ sharply between a public web app and an internal tool.',
    kind: 'select',
    importance: 'CRITICAL',
    minMode: 'beginner',
    options: [
      'PUBLIC_WEB_APP',
      'SAAS_WEB_APP',
      'INTERNAL_BUSINESS_APP',
      'API_BACKEND_PLATFORM',
      'MOBILE_APP',
      'AI_ENABLED_WEB_APP',
      'DEVELOPER_TOOLING',
      'ECOMMERCE',
    ],
  },

  /* ------------------------------------------------- Budget and deadline */
  {
    id: 'budget.total',
    category: 'BUDGET',
    label: 'What is the budget?',
    rationale:
      'Feasibility and resourcing depend on it. A range is fine; a guess labelled as one is fine too.',
    kind: 'currency',
    importance: 'RECOMMENDED',
    minMode: 'beginner',
  },
  {
    id: 'budget.currency',
    category: 'BUDGET',
    label: 'Which currency?',
    rationale:
      'A project has one base currency; mixing them silently is how cost reporting goes wrong.',
    kind: 'select',
    importance: 'RECOMMENDED',
    minMode: 'beginner',
    options: ['GBP', 'USD', 'EUR', 'AUD', 'CAD', 'INR'],
    recommendedDefault: 'GBP',
  },
  {
    id: 'deadline.target',
    category: 'DEADLINE',
    label: 'Is there a target date?',
    rationale:
      'Drives schedule feasibility. No default — inventing a deadline would be inventing pressure.',
    kind: 'date',
    importance: 'RECOMMENDED',
    minMode: 'beginner',
  },
  {
    id: 'deadline.fixed',
    category: 'DEADLINE',
    label: 'Is that date fixed?',
    rationale:
      'A fixed date changes what the engine may trade away. It also becomes a user-confirmed fact an AI import cannot silently move.',
    kind: 'boolean',
    importance: 'RECOMMENDED',
    minMode: 'professional',
    recommendedDefault: false,
  },

  /* ------------------------------------------------------ Team and skills */
  {
    id: 'team.size',
    category: 'TEAM',
    label: 'How many people will work on it?',
    rationale: 'Selects the execution profile — solo, agent-assisted solo, team or enterprise.',
    kind: 'number',
    importance: 'RECOMMENDED',
    minMode: 'beginner',
    recommendedDefault: 1,
  },
  {
    id: 'team.skills',
    category: 'SKILLS',
    label: 'What skills does the team have?',
    rationale:
      'Skill coverage gaps are a leading cause of schedule slip, and the engine can flag them early.',
    kind: 'multiSelect',
    importance: 'OPTIONAL',
    minMode: 'professional',
    options: [
      'Frontend',
      'Backend',
      'Mobile',
      'Data',
      'DevOps',
      'Security',
      'Design',
      'QA',
      'Product',
    ],
  },
  {
    id: 'capacity.hoursPerWeek',
    category: 'WORKING_CAPACITY',
    label: 'How many hours a week are available?',
    rationale:
      'Capacity, not headcount, determines the schedule. A five-person team at four hours each is not five people.',
    kind: 'number',
    importance: 'RECOMMENDED',
    minMode: 'professional',
    recommendedDefault: 40,
  },
  {
    id: 'team.aiAssisted',
    category: 'TEAM',
    label: 'Will coding agents be used?',
    rationale:
      'Changes suggested parallelism and effort assumptions. Modelled as a team capability, never as an extra person.',
    kind: 'boolean',
    importance: 'OPTIONAL',
    minMode: 'professional',
    recommendedDefault: false,
  },
  {
    id: 'team.methodology',
    category: 'TEAM',
    label: 'How will the work be run?',
    rationale:
      'Methodology changes how work is broken down and which practices apply (gap-spec §16). The mandatory gates apply whichever is chosen; what varies is how the work reaching them is organised.',
    kind: 'select',
    importance: 'OPTIONAL',
    minMode: 'professional',
    options: [
      'Agile (sprints)',
      'Kanban (continuous flow)',
      'Waterfall (sequential)',
      'Hybrid',
      'Solo',
    ],
    recommendedDefault: 'Agile (sprints)',
  },

  /* -------------------------------------------------- Technical context */
  {
    id: 'stack.existing',
    category: 'EXISTING_STACK',
    label: 'Is there an existing stack to work within?',
    rationale:
      'Constrains architecture options and rules out otherwise-reasonable recommendations.',
    kind: 'longText',
    importance: 'OPTIONAL',
    minMode: 'professional',
  },
  {
    id: 'code.existing',
    category: 'EXISTING_CODE',
    label: 'Is there existing code?',
    rationale:
      'A brownfield project needs migration and compatibility work a greenfield one does not.',
    kind: 'boolean',
    importance: 'OPTIONAL',
    minMode: 'professional',
    recommendedDefault: false,
  },
  {
    id: 'infrastructure.hosting',
    category: 'INFRASTRUCTURE',
    label: 'Where will it run?',
    rationale: 'Deployment and operational readiness obligations follow from this.',
    kind: 'text',
    importance: 'OPTIONAL',
    minMode: 'professional',
  },
  {
    id: 'integrations.thirdParties',
    category: 'THIRD_PARTIES',
    label: 'Which third-party services will it depend on?',
    rationale: 'Each becomes a dependency, a cost line and a failure mode.',
    kind: 'longText',
    importance: 'OPTIONAL',
    minMode: 'professional',
  },
  {
    id: 'domains.required',
    category: 'DOMAINS',
    label: 'Do you have a domain name, or need one?',
    rationale:
      'A small item that reliably surfaces late and blocks release. It also carries a recurring cost and an expiry date the operations checks watch.',
    kind: 'text',
    importance: 'OPTIONAL',
    minMode: 'professional',
    placeholder: 'example.com, or “not yet”',
  },
  {
    id: 'apis.external',
    category: 'APIS',
    label: 'Which external APIs will it call?',
    rationale:
      'Each external API is a rate limit, a credential to manage, an availability dependency and a cost line — and each needs its own integration tests.',
    kind: 'longText',
    importance: 'OPTIONAL',
    minMode: 'professional',
  },
  {
    id: 'performance.expectation',
    category: 'PERFORMANCE',
    label: 'Are there performance expectations?',
    rationale:
      'Performance targets are cheap to design for and expensive to retrofit. Left unstated they get discovered by users.',
    kind: 'select',
    importance: 'OPTIONAL',
    minMode: 'professional',
    options: [
      'Standard web responsiveness',
      'Large data volumes',
      'Real-time or near-real-time',
      'Heavy background processing',
      'Not yet decided',
    ],
    recommendedDefault: 'Standard web responsiveness',
  },

  /* ------------------------------------------ Data, privacy and security */
  {
    id: 'data.types',
    category: 'DATA_TYPES',
    label: 'What kinds of data will it hold?',
    rationale:
      'CRITICAL because the security and privacy rule packs key off it. Guessing here would mean guessing whether the project needs, for example, payment-card controls.',
    kind: 'multiSelect',
    importance: 'CRITICAL',
    minMode: 'beginner',
    options: [
      'None',
      'Account details',
      'Personal data',
      'Financial data',
      'Health data',
      'Payment card data',
      'Children’s data',
      'Government or regulated records',
      'Business confidential',
    ],
  },
  {
    id: 'security.authentication',
    category: 'SECURITY',
    label: 'Will users sign in?',
    rationale:
      'Authentication brings an entire test and verification pack with it. Assuming either way would be wrong: assuming no auth skips essential controls, assuming auth invents work.',
    kind: 'boolean',
    importance: 'CRITICAL',
    minMode: 'beginner',
  },
  {
    id: 'privacy.jurisdictions',
    category: 'PRIVACY',
    label: 'Which countries will users be in?',
    rationale: 'Determines which privacy regimes apply.',
    kind: 'multiSelect',
    importance: 'RECOMMENDED',
    minMode: 'professional',
    options: ['UK', 'EU', 'US', 'Canada', 'Australia', 'India', 'Other'],
  },
  {
    id: 'compliance.regimes',
    category: 'COMPLIANCE',
    label: 'Are there compliance obligations you already know about?',
    rationale:
      'The platform tracks evidence against them. It never asserts that a project *is* compliant — only what has been evidenced.',
    kind: 'multiSelect',
    importance: 'OPTIONAL',
    minMode: 'enterprise',
    options: [
      'UK GDPR',
      'EU GDPR',
      'PCI DSS',
      'SOC 2',
      'ISO 27001',
      'HIPAA',
      'WCAG 2.2',
      'None known',
    ],
  },

  /* -------------------------------------------------- Delivery expectations */
  {
    id: 'deployment.frequency',
    category: 'DEPLOYMENT',
    label: 'How often do you expect to release?',
    rationale: 'Shapes the release process and the depth of automation worth building.',
    kind: 'select',
    importance: 'OPTIONAL',
    minMode: 'professional',
    options: ['Continuously', 'Weekly', 'Monthly', 'Quarterly', 'One release'],
    recommendedDefault: 'Monthly',
  },
  {
    id: 'availability.expectation',
    category: 'AVAILABILITY',
    label: 'What availability is expected?',
    rationale: 'Drives operational readiness. High availability is a cost, not a free adjective.',
    kind: 'select',
    importance: 'OPTIONAL',
    minMode: 'professional',
    options: ['Best effort', 'Business hours', 'High availability', 'Not yet decided'],
    recommendedDefault: 'Best effort',
  },
  {
    id: 'accessibility.target',
    category: 'ACCESSIBILITY',
    label: 'Is there an accessibility standard to meet?',
    rationale:
      'Defaults to WCAG 2.2 AA. Accessibility retrofitted late costs several times what it costs designed in, so the default is the accessible one.',
    kind: 'select',
    importance: 'RECOMMENDED',
    minMode: 'professional',
    options: ['WCAG 2.2 AA', 'WCAG 2.2 AAA', 'WCAG 2.1 AA', 'No formal target'],
    recommendedDefault: 'WCAG 2.2 AA',
  },
  {
    id: 'maintenance.owner',
    category: 'MAINTENANCE',
    label: 'Who maintains it after launch?',
    rationale:
      'The completion and handover gates cannot pass without an answer, so it is asked early.',
    kind: 'text',
    importance: 'OPTIONAL',
    minMode: 'professional',
  },
];

/** Every category in gap-spec §9.1 must have at least one question. Asserted in tests. */
export function fieldsForCategory(category: IntakeCategory): readonly FieldDefinition[] {
  return FIELD_DEFINITIONS.filter((f) => f.category === category);
}

export function findField(fieldId: string): FieldDefinition | undefined {
  return FIELD_DEFINITIONS.find((f) => f.id === fieldId);
}

export function fieldsForMode(
  mode: 'beginner' | 'professional' | 'enterprise',
): readonly FieldDefinition[] {
  const rank = { beginner: 0, professional: 1, enterprise: 2 } as const;
  return FIELD_DEFINITIONS.filter((f) => rank[f.minMode] <= rank[mode]);
}

/** Fields with no recommended default — "use a sensible default" is not offered for these. */
export function fieldsWithoutDefault(): readonly FieldDefinition[] {
  return FIELD_DEFINITIONS.filter((f) => f.recommendedDefault === undefined);
}

export function criticalFields(): readonly FieldDefinition[] {
  return FIELD_DEFINITIONS.filter((f) => f.importance === 'CRITICAL');
}
