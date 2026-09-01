/**
 * Intake, discovery and requirements rules.
 *
 * Contract: gap-spec §14 asks for at least 20 intake/discovery and 20 requirements rules.
 *
 * These are the rules that fire earliest, when the least is known — which makes them the ones most
 * likely to be written as vague encouragement. Every rule here instead names a specific decision that
 * becomes expensive to reverse later, and says when it becomes expensive.
 */

import { defineRule, type Rule } from '../schema.ts';

const ACTIVE = '2026-01-01';

export const DISCOVERY_RULES: readonly Rule[] = [
  defineRule({
    id: 'DIS-OBJ-001',
    version: '1.0.0',
    title: 'A project needs a stated objective before it needs a plan',
    description: 'What the project is for, in terms someone outside the team would recognise.',
    category: 'INTAKE',
    severity: 'MANDATORY',
    source: 'PROJECT_TYPE_PACK',
    conditions: [{ subject: 'INTAKE', key: 'objectives.primary', operator: 'IS_UNANSWERED' }],
    emittedRisks: [
      {
        key: 'no-objective',
        title: 'Nothing in the plan can be argued for',
        description:
          'Every requirement is justified by tracing to an objective. Without one, scope decisions are settled by whoever feels strongest.',
        likelihood: 'HIGH',
        impact: 'HIGH',
      },
    ],
    emittedGates: [
      { gateKey: 'DISCOVERY', criterion: 'The project has a stated objective.', blocking: true },
    ],
    rationale:
      'Scope arguments are unresolvable without a shared statement of what the project is for, so they get resolved by seniority instead.',
    remediation: 'Write one sentence describing what will be different when this succeeds.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DIS-OBJ-002',
    version: '1.0.0',
    title: 'An objective should be observable',
    description: 'Stated so that someone could later tell whether it happened.',
    category: 'INTAKE',
    severity: 'RECOMMENDED',
    source: 'RECOMMENDED_DEFAULT',
    conditions: [{ subject: 'INTAKE', key: 'objectives.primary', operator: 'IS_ANSWERED' }],
    requiredInputs: ['objectives.primary'],
    emittedTasks: [
      {
        key: 'make-objective-observable',
        title: 'Restate the objective so success is observable',
        phaseKey: 'discovery',
      },
    ],
    rationale:
      'An objective nobody can check is one the project can be declared to have met regardless of what happened.',
    remediation: 'Name what will be measured, and roughly what value would count as success.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DIS-TYPE-001',
    version: '1.0.0',
    title: 'Project type selects the rule packs, so it is not optional',
    description: 'Without it, the security, testing and release obligations cannot be chosen.',
    category: 'INTAKE',
    severity: 'MANDATORY',
    source: 'PROJECT_TYPE_PACK',
    conditions: [{ subject: 'INTAKE', key: 'project.type', operator: 'IS_UNANSWERED' }],
    emittedRisks: [
      {
        key: 'unknown-type-generic-plan',
        title: 'A generic plan omits the obligations that matter most',
        description:
          'Type-specific security and release requirements are exactly the ones a generic structure leaves out, and their absence is invisible.',
        likelihood: 'HIGH',
        impact: 'HIGH',
      },
    ],
    emittedGates: [
      {
        gateKey: 'DISCOVERY',
        criterion: 'The kind of project is known or explicitly assumed.',
        blocking: true,
      },
    ],
    rationale:
      'A plan for an unknown project type silently omits every obligation that depends on knowing it — and the omission looks the same as those obligations not applying.',
    remediation: 'Choose the closest type, or record explicitly that it is being assumed.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DIS-USER-001',
    version: '1.0.0',
    title: 'Who this is for changes almost every decision',
    description: 'The primary users determine accessibility, device support, language and tone.',
    category: 'INTAKE',
    severity: 'RECOMMENDED',
    source: 'PROJECT_TYPE_PACK',
    conditions: [{ subject: 'INTAKE', key: 'users.primary', operator: 'IS_UNANSWERED' }],
    emittedRisks: [
      {
        key: 'unknown-users',
        title: 'Design decisions default to the team’s own habits',
        description:
          'A team building for people unlike themselves, without saying so, builds for themselves.',
        likelihood: 'MEDIUM',
        impact: 'MEDIUM',
      },
    ],
    rationale:
      'Device mix, accessibility need and expected literacy with software all follow from who the users are, and all are expensive to change afterwards.',
    remediation:
      'Describe the primary users in a sentence, including how they will reach the system.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DIS-DATA-001',
    version: '1.0.0',
    title: 'What data is held decides the entire compliance surface',
    description: 'Personal, health, financial and card data each bring separate obligations.',
    category: 'INTAKE',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    conditions: [{ subject: 'INTAKE', key: 'data.types', operator: 'IS_UNANSWERED' }],
    emittedRisks: [
      {
        key: 'unknown-data-types',
        title: 'Compliance obligations cannot be determined',
        description:
          'Until the data categories are known, the platform cannot tell whether privacy, payment or health obligations apply — so it shows none.',
        likelihood: 'HIGH',
        impact: 'HIGH',
      },
    ],
    emittedGates: [
      { gateKey: 'DISCOVERY', criterion: 'The categories of data held are known.', blocking: true },
    ],
    rationale:
      'Guessing here means guessing whether the project needs payment-card controls, which is not a guess anyone should make.',
    remediation:
      'List the categories of data the system will hold, including anything held incidentally in logs.',
    references: ['UK GDPR Article 30 Records of processing activities'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DIS-SCOPE-001',
    version: '1.0.0',
    title: 'A fixed deadline needs an agreed scope',
    description: 'When the date cannot move, scope is the only variable left.',
    category: 'INTAKE',
    severity: 'MANDATORY',
    source: 'PROJECT_CONSTRAINT',
    conditionMode: 'ALL',
    conditions: [
      { subject: 'INTAKE', key: 'deadline.fixed', operator: 'IS_TRUE' },
      { subject: 'INTAKE', key: 'capabilities.key', operator: 'IS_UNANSWERED' },
    ],
    requiredInputs: ['deadline.fixed'],
    emittedRisks: [
      {
        key: 'fixed-date-open-scope',
        title: 'The deadline is fixed and the scope is not',
        description:
          'Deciding what ships before work starts costs a conversation. Deciding it in the final week costs the release.',
        likelihood: 'HIGH',
        impact: 'HIGH',
      },
    ],
    emittedTasks: [
      {
        key: 'agree-minimum-scope',
        title: 'Agree what must ship by the deadline',
        phaseKey: 'discovery',
      },
    ],
    rationale:
      'A fixed date with open scope resolves itself at the last moment, under pressure, by whoever is loudest — which is the worst available process for the decision.',
    remediation: 'Agree the smallest set of capabilities that must be present on the date.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DIS-BUDGET-001',
    version: '1.0.0',
    title: 'Without a budget the plan has no ceiling to check against',
    description: 'Estimates become numbers with nothing to compare them to.',
    category: 'INTAKE',
    severity: 'RECOMMENDED',
    source: 'PROJECT_CONSTRAINT',
    conditions: [{ subject: 'INTAKE', key: 'budget.total', operator: 'IS_UNANSWERED' }],
    emittedRisks: [
      {
        key: 'no-budget-ceiling',
        title: 'The plan cannot say when it has become unaffordable',
        description: 'Cost overruns are only visible against an agreed figure.',
        likelihood: 'MEDIUM',
        impact: 'HIGH',
      },
    ],
    rationale:
      'A range with no ceiling cannot trigger a conversation, so the first signal is the invoice.',
    remediation: 'Record a budget, even a rough one. A range is more useful than nothing.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DIS-TEAM-001',
    version: '1.0.0',
    title: 'A team of one has no redundancy',
    description: 'Illness, a new job or a bad fortnight moves the entire timeline.',
    category: 'INTAKE',
    severity: 'RECOMMENDED',
    source: 'PROJECT_TYPE_PACK',
    conditions: [{ subject: 'INTAKE', key: 'team.size', operator: 'LESS_THAN', value: 2 }],
    requiredInputs: ['team.size'],
    emittedRisks: [
      {
        key: 'single-point-of-delivery',
        title: 'The project depends on one person being available throughout',
        description:
          'Worth planning around explicitly rather than hoping about — usually by writing things down earlier than would otherwise be necessary.',
        likelihood: 'MEDIUM',
        impact: 'HIGH',
      },
    ],
    emittedTasks: [
      {
        key: 'solo-continuity',
        title: 'Write down what someone else would need to continue',
        phaseKey: 'discovery',
      },
    ],
    rationale:
      'Solo projects are viable; the failure is treating them as though the single person cannot become unavailable.',
    remediation: 'Document decisions and access early, so someone else could pick it up.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DIS-SKILL-001',
    version: '1.0.0',
    title: 'Unstated skill gaps come out of the schedule anyway',
    description: 'Learning time is real time, and unrecorded learning time is unplanned overrun.',
    category: 'INTAKE',
    severity: 'RECOMMENDED',
    source: 'PROJECT_TYPE_PACK',
    conditions: [{ subject: 'INTAKE', key: 'team.skills', operator: 'IS_UNANSWERED' }],
    emittedRisks: [
      {
        key: 'unknown-skills',
        title: 'The work may need skills the team has not confirmed',
        description: 'Discovered mid-build, when the schedule has no room for it.',
        likelihood: 'MEDIUM',
        impact: 'MEDIUM',
      },
    ],
    rationale:
      'Nobody plans for learning time, and it happens regardless. Naming it moves the cost from the end of the project to the beginning.',
    remediation:
      'List the skills the team has, and note which parts of the work need something else.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DIS-EXIST-001',
    version: '1.0.0',
    title: 'Existing code and infrastructure constrain what is possible',
    description: 'Building into an existing system is a different project from building fresh.',
    category: 'INTAKE',
    severity: 'RECOMMENDED',
    source: 'PROJECT_TYPE_PACK',
    conditions: [{ subject: 'INTAKE', key: 'code.existing', operator: 'IS_ANSWERED' }],
    requiredInputs: ['code.existing'],
    emittedTasks: [
      {
        key: 'assess-existing',
        title: 'Assess the existing system before planning against it',
        phaseKey: 'discovery',
      },
    ],
    emittedRisks: [
      {
        key: 'existing-system-unknowns',
        title: 'The existing system will contain surprises',
        description:
          'Undocumented behaviour that something depends on is discovered by breaking it.',
        likelihood: 'HIGH',
        impact: 'MEDIUM',
      },
    ],
    rationale:
      'Estimates against an unexamined existing system are estimates against an imagined one, and the difference is always in the direction of more work.',
    remediation: 'Spend time reading the existing system before committing to estimates.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DIS-THIRD-001',
    version: '1.0.0',
    title: 'Third parties are dependencies with their own timelines',
    description: 'Every integration adds a party whose availability you do not control.',
    category: 'INTAKE',
    severity: 'RECOMMENDED',
    source: 'PROJECT_TYPE_PACK',
    conditions: [{ subject: 'INTAKE', key: 'integrations.thirdParties', operator: 'IS_ANSWERED' }],
    requiredInputs: ['integrations.thirdParties'],
    emittedRisks: [
      {
        key: 'third-party-dependency',
        title: 'Integrations depend on parties outside the project',
        description:
          'Access, approval and sandbox availability all take time that is invisible until it is on the critical path.',
        likelihood: 'MEDIUM',
        impact: 'MEDIUM',
      },
    ],
    emittedTasks: [
      {
        key: 'secure-integration-access',
        title: 'Get integration access before it is needed',
        phaseKey: 'discovery',
      },
    ],
    rationale:
      'Sandbox credentials and commercial approval routinely take longer than the integration itself, and neither is visible in an estimate of the code.',
    remediation:
      'Request access early and treat each integration as a dependency with a lead time.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DIS-UNKNOWN-001',
    version: '1.0.0',
    title: 'An unknown must be recorded to be planned around',
    description: '"I don’t know" is an answer, and a more useful one than a guess.',
    category: 'INTAKE',
    severity: 'MANDATORY',
    source: 'PROJECT_TYPE_PACK',
    emittedGates: [
      {
        gateKey: 'DISCOVERY',
        criterion: 'Major unknowns are recorded rather than glossed over.',
        blocking: false,
      },
    ],
    rationale:
      'An unknown that is absent from the record is indistinguishable from one nobody thought to ask about, and the plan treats both as settled.',
    remediation: 'Record what is unknown, and what would change if it turned out badly.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DIS-ASSUME-001',
    version: '1.0.0',
    title: 'An assumption must say what breaks if it is wrong',
    description: 'An assumption with no stated consequence cannot be prioritised for checking.',
    category: 'INTAKE',
    severity: 'RECOMMENDED',
    source: 'RECOMMENDED_DEFAULT',
    emittedTasks: [
      {
        key: 'annotate-assumptions',
        title: 'Record what each assumption costs if wrong',
        phaseKey: 'discovery',
      },
    ],
    rationale:
      'Assumptions are unavoidable. What separates a manageable one from a dangerous one is knowing what it would cost to be wrong, and that is only knowable if someone wrote it down.',
    remediation: 'For each assumption, note what would have to change if it were false.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DIS-COMPLIANCE-001',
    version: '1.0.0',
    title: 'Named compliance regimes change the plan structurally',
    description: 'They add evidence requirements, not merely controls.',
    category: 'INTAKE',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    conditions: [{ subject: 'INTAKE', key: 'compliance.regimes', operator: 'IS_ANSWERED' }],
    requiredInputs: ['compliance.regimes'],
    emittedRequirements: [
      {
        key: 'compliance-evidence',
        title: 'Each obligation has evidence attached to it',
        description:
          'The platform records what has been evidenced. It never asserts that a project is compliant.',
        priority: 'MUST',
        verification: 'A mapping from each obligation to the evidence for it.',
      },
    ],
    emittedTasks: [
      {
        key: 'map-compliance-controls',
        title: 'Map each obligation to a control and its evidence',
        phaseKey: 'design',
      },
    ],
    rationale:
      'Compliance work is mostly evidence collection, and evidence gathered retrospectively is both harder to obtain and less convincing.',
    remediation: 'Map obligations to controls early, and collect evidence as you go.',
    references: ['ISO/IEC 27001:2022 Annex A control mapping'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DIS-AVAIL-001',
    version: '1.0.0',
    title: 'High availability is a cost, not an adjective',
    description: 'It changes the architecture, the team and the operational commitment.',
    category: 'INTAKE',
    severity: 'RECOMMENDED',
    source: 'PROJECT_CONSTRAINT',
    conditions: [
      {
        subject: 'INTAKE',
        key: 'availability.expectation',
        operator: 'EQUALS',
        value: 'High availability',
      },
    ],
    requiredInputs: ['availability.expectation'],
    emittedRequirements: [
      {
        key: 'ha-architecture',
        title: 'The architecture supports the stated availability',
        description: 'Redundancy, failover, and someone available to respond.',
        priority: 'SHOULD',
        verification: 'An architecture decision recording how the target is met.',
      },
    ],
    calculationEffects: [
      {
        calculation: 'budget.total',
        kind: 'ADD_CONTINGENCY_PERCENT',
        low: 15,
        high: 40,
        basis:
          'High availability requires redundant infrastructure and an on-call commitment, both of which are ongoing rather than one-off.',
      },
    ],
    rationale:
      'Availability targets are frequently chosen aspirationally and then not funded, which produces the cost of the ambition without the benefit.',
    remediation: 'Confirm the target is genuinely needed, and budget for redundancy and on-call.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DIS-A11Y-001',
    version: '1.0.0',
    title: 'Accessibility is decided at the start or paid for at the end',
    description: 'Designed in, it is close to free. Retrofitted, it is a redesign.',
    category: 'INTAKE',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    conditions: [{ subject: 'INTAKE', key: 'accessibility.target', operator: 'IS_UNANSWERED' }],
    emittedRequirements: [
      {
        key: 'accessibility-default',
        title: 'WCAG 2.2 AA unless something else is chosen',
        description:
          'The default is the accessible one, because the alternative is expensive to reverse.',
        priority: 'MUST',
        verification: 'Automated and manual accessibility checks against the standard.',
      },
    ],
    rationale:
      'Colour contrast, focus order and semantic structure are cheap during design and require rework afterwards. Leaving the target unstated defaults to the expensive path.',
    remediation:
      'Confirm the accessibility standard now. The default of WCAG 2.2 AA is usually right.',
    references: ['WCAG 2.2', 'Equality Act 2010'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DIS-MAINT-001',
    version: '1.0.0',
    title: 'Who maintains it afterwards changes what should be built',
    description:
      'A system handed to someone else needs different documentation and different choices.',
    category: 'INTAKE',
    severity: 'RECOMMENDED',
    source: 'PROJECT_TYPE_PACK',
    conditions: [{ subject: 'INTAKE', key: 'maintenance.owner', operator: 'IS_UNANSWERED' }],
    emittedRisks: [
      {
        key: 'no-maintainer',
        title: 'Nobody has been named as responsible after launch',
        description:
          'Systems with no named maintainer decay silently: certificates lapse, dependencies age, and nobody is watching.',
        likelihood: 'MEDIUM',
        impact: 'HIGH',
      },
    ],
    rationale:
      'Most of a system’s life is after the project ends. Building without knowing who inherits it produces choices that suit the builders rather than the maintainers.',
    remediation:
      'Name who will maintain it, and let that shape technology choices and documentation.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DIS-RESEARCH-001',
    version: '1.0.0',
    title: 'Deferred research must be recorded as deferred',
    description: 'Deferring is a decision; forgetting is not, and they look identical afterwards.',
    category: 'INTAKE',
    severity: 'RECOMMENDED',
    source: 'RECOMMENDED_DEFAULT',
    emittedGates: [
      {
        gateKey: 'DISCOVERY',
        criterion: 'Research is done or explicitly deferred.',
        blocking: false,
      },
    ],
    rationale:
      'A deferred question can be scheduled. A forgotten one surfaces as a surprise, usually at the point where it blocks something.',
    remediation: 'Record what was deferred and when it will be revisited.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DIS-CAPACITY-001',
    version: '1.0.0',
    title: 'Available hours are not the same as headcount',
    description: 'Part-time availability, other commitments and leave all reduce real capacity.',
    category: 'INTAKE',
    severity: 'RECOMMENDED',
    source: 'PROJECT_TYPE_PACK',
    conditions: [{ subject: 'INTAKE', key: 'capacity.hoursPerWeek', operator: 'IS_UNANSWERED' }],
    emittedRisks: [
      {
        key: 'capacity-overstated',
        title: 'Headcount overstates capacity',
        description:
          'A schedule built on nominal availability slips from the first week and never recovers.',
        likelihood: 'HIGH',
        impact: 'MEDIUM',
      },
    ],
    rationale:
      'Five people does not mean five people’s time. Planning against headcount rather than hours builds the overrun into the schedule from the start.',
    remediation: 'Record actual weekly hours available to this project, not nominal headcount.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DIS-DOMAIN-001',
    version: '1.0.0',
    title: 'Domains and certificates have lead times',
    description: 'Registration, transfer and verification are not instantaneous.',
    category: 'INTAKE',
    severity: 'ADVISORY',
    source: 'RECOMMENDED_DEFAULT',
    conditions: [{ subject: 'INTAKE', key: 'domains.required', operator: 'IS_ANSWERED' }],
    requiredInputs: ['domains.required'],
    emittedTasks: [
      {
        key: 'secure-domains',
        title: 'Register domains and certificates early',
        phaseKey: 'design',
      },
    ],
    rationale:
      'Domain transfers and extended-validation certificates can take days. Discovering that on release day is a delay for a reason nobody planned for.',
    remediation: 'Register domains and obtain certificates well before the release.',
    activeFrom: ACTIVE,
  }),

  /* ------------------------------------------------------------ Requirements */

  defineRule({
    id: 'REQ-VERIFY-001',
    version: '1.0.0',
    title: 'Every requirement states how it will be verified',
    description: 'A requirement with no verification method can only be closed by opinion.',
    category: 'REQUIREMENTS',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedGates: [
      {
        gateKey: 'REQUIREMENTS',
        criterion: 'Every requirement states its verification method.',
        blocking: true,
      },
    ],
    rationale:
      'Without a stated method, "done" is decided by whoever is asked, and the traceability matrix fills with requirements marked satisfied because somebody said so.',
    remediation: 'For each requirement, write down what would demonstrate it is met.',
    references: ['ISO/IEC/IEEE 29148 Requirements engineering'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'REQ-ATOMIC-001',
    version: '1.0.0',
    title: 'A requirement covers one thing',
    description:
      'Requirements joined by "and" cannot be partially satisfied or separately verified.',
    category: 'REQUIREMENTS',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    rationale:
      'A compound requirement is either wholly met or wholly unmet, so progress against it is invisible and its verification is ambiguous.',
    remediation: 'Split requirements containing "and" into separate items.',
    references: ['ISO/IEC/IEEE 29148 §5.2.4 Characteristics of individual requirements'],
    emittedTasks: [
      {
        key: 'split-compound-requirements',
        title: 'Split compound requirements',
        phaseKey: 'design',
      },
    ],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'REQ-TRACE-001',
    version: '1.0.0',
    title: 'Every requirement traces to an objective',
    description:
      'A requirement justified by nothing cannot be prioritised or descoped with confidence.',
    category: 'REQUIREMENTS',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedGates: [
      {
        gateKey: 'REQUIREMENTS',
        criterion: 'Every requirement traces to an objective.',
        blocking: false,
      },
    ],
    rationale:
      'When the deadline forces a cut, requirements with no traceable purpose are the ones nobody can defend — and sometimes the ones that mattered most.',
    remediation:
      'Link each requirement to the objective it serves, or question whether it belongs.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'REQ-PRIORITY-001',
    version: '1.0.0',
    title: 'Priorities have to distinguish things',
    description: 'If everything is a MUST, the priority field carries no information.',
    category: 'REQUIREMENTS',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    emittedTasks: [
      {
        key: 'review-priorities',
        title: 'Review requirement priorities for genuine differentiation',
        phaseKey: 'design',
      },
    ],
    rationale:
      'A list where everything is essential provides no guidance under pressure, which is exactly when guidance is needed.',
    remediation:
      'Ask of each MUST what would happen if it shipped later. If the answer is "it would be fine", it is not a MUST.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'REQ-NFR-001',
    version: '1.0.0',
    title: 'Non-functional requirements need numbers',
    description: '"Fast", "secure" and "scalable" cannot be verified.',
    category: 'REQUIREMENTS',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'measurable-nfrs',
        title: 'Quality attributes are stated with figures',
        description: 'A number, a condition and a measurement method.',
        priority: 'MUST',
        verification: 'Each non-functional requirement has a test that could fail.',
      },
    ],
    rationale:
      'An unquantified quality attribute is met by definition, because nobody can demonstrate otherwise.',
    remediation: 'Replace adjectives with figures and the conditions they hold under.',
    references: ['ISO/IEC 25010 Product quality model'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'REQ-CONFLICT-001',
    version: '1.0.0',
    title: 'Contradictory requirements must be resolved, not averaged',
    description: 'Two requirements that cannot both hold are a decision waiting to be taken.',
    category: 'REQUIREMENTS',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedTasks: [
      {
        key: 'resolve-requirement-conflicts',
        title: 'Resolve contradictory requirements explicitly',
        phaseKey: 'design',
      },
    ],
    rationale:
      'Unresolved contradictions are resolved implicitly, by whoever implements first, and the decision is then invisible to everyone who agreed to both.',
    remediation: 'Identify contradictions and have the decision taken by someone who can take it.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'REQ-CHANGE-001',
    version: '1.0.0',
    title: 'Requirement changes after a baseline go through change control',
    description: 'Otherwise the baseline stops describing the project.',
    category: 'REQUIREMENTS',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    lifecycleScope: ['APPROVED', 'IN_PROGRESS', 'VERIFYING', 'RELEASE_READY'],
    emittedGates: [
      {
        gateKey: 'COMPLETION',
        criterion: 'Requirement changes after baseline went through change control.',
        blocking: true,
      },
    ],
    rationale:
      'Scope that changes without a record is scope creep by definition — and at the end, nobody can say whether the project delivered what was agreed.',
    remediation: 'Route post-baseline requirement changes through a recorded change request.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'REQ-ACCEPT-001',
    version: '1.0.0',
    title: 'Acceptance criteria are written before the work, not after',
    description: 'Criteria written afterwards describe what was built.',
    category: 'REQUIREMENTS',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    emittedTasks: [
      {
        key: 'write-acceptance-criteria',
        title: 'Write acceptance criteria before starting each item',
        phaseKey: 'design',
      },
    ],
    rationale:
      'Acceptance criteria written after implementation cannot fail, because they were derived from the thing they are meant to judge.',
    remediation: 'Agree acceptance criteria before work starts on each item.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'REQ-SCOPE-001',
    version: '1.0.0',
    title: 'What is out of scope is recorded too',
    description: 'An unstated exclusion is an assumed inclusion.',
    category: 'REQUIREMENTS',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    emittedTasks: [
      {
        key: 'record-exclusions',
        title: 'Record what this project will not do',
        phaseKey: 'discovery',
      },
    ],
    rationale:
      'Most scope disputes are about something nobody ever said was excluded, and both sides are being reasonable.',
    remediation: 'Write down what is explicitly not being built.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'REQ-USER-001',
    version: '1.0.0',
    title: 'Requirements describe behaviour, not implementation',
    description: 'A requirement naming a technology has already made a design decision.',
    category: 'REQUIREMENTS',
    severity: 'ADVISORY',
    source: 'RECOMMENDED_DEFAULT',
    emittedTasks: [
      {
        key: 'separate-design-from-requirements',
        title: 'Move implementation choices out of requirements',
        phaseKey: 'design',
      },
    ],
    rationale:
      'A requirement that names a technology removes the option of meeting the need another way, usually without anyone noticing the choice was made.',
    remediation:
      'State what must be true, and record technology choices as architecture decisions.',
    references: ['ISO/IEC/IEEE 29148 §5.2.5 Implementation independence'],
    activeFrom: ACTIVE,
  }),
];
