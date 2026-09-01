/**
 * Planning, resource and budget rules.
 *
 * Contract: gap-spec §14 asks for at least 20 planning, 15 resource/capacity and 20 budget rules.
 *
 * The theme here is that most planning failures are not arithmetic. They are the result of a number
 * that was produced honestly, then quoted without the conditions that made it honest — a range that
 * became a midpoint, an estimate that became a commitment, a capacity figure that assumed nobody
 * takes leave. Almost every rule below is about keeping a number attached to what it actually means.
 */

import { defineRule, type Rule } from '../schema.ts';

const ACTIVE = '2026-01-01';

export const DELIVERY_RULES: readonly Rule[] = [
  /* ---------------------------------------------------------------- Planning */

  defineRule({
    id: 'PLN-WBS-001',
    version: '1.0.0',
    title: 'Work is broken down before it is scheduled',
    description: 'A schedule over undivided work is a guess with dates on it.',
    category: 'PLANNING',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedGates: [{ gateKey: 'PLANNING', criterion: 'A work breakdown exists.', blocking: true }],
    rationale:
      'Undecomposed work cannot be assigned, tracked or estimated with any confidence, and progress against it is unmeasurable until it is finished.',
    remediation: 'Break the work into items small enough to be finished in a few days.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'PLN-WBS-002',
    version: '1.0.0',
    title: 'A work item longer than about a week is not understood yet',
    description: 'Large items hide their own uncertainty.',
    category: 'PLANNING',
    severity: 'RECOMMENDED',
    source: 'RECOMMENDED_DEFAULT',
    emittedTasks: [
      {
        key: 'split-large-items',
        title: 'Split work items larger than a week',
        phaseKey: 'design',
      },
    ],
    rationale:
      'A two-week item reports as "in progress" for two weeks and then reveals it needs another two. Smaller items expose the same problem in days.',
    remediation: 'Split anything larger than about a week until each piece is understood.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'PLN-DEP-001',
    version: '1.0.0',
    title: 'Dependencies must form no cycles',
    description: 'A cycle is a deadlock the plan would otherwise present as a schedule.',
    category: 'PLANNING',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedGates: [
      { gateKey: 'PLANNING', criterion: 'The dependency graph is acyclic.', blocking: true },
    ],
    rationale:
      'Circular dependencies cannot be built in any order, so the schedule containing them is not achievable by anyone.',
    remediation: 'Break the cycle by splitting one of the items or removing a false dependency.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'PLN-DEP-002',
    version: '1.0.0',
    title: 'External dependencies get lead times, not assumptions',
    description: 'Approvals, access and third-party availability are on the critical path.',
    category: 'PLANNING',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    conditions: [{ subject: 'INTAKE', key: 'integrations.thirdParties', operator: 'IS_ANSWERED' }],
    requiredInputs: ['integrations.thirdParties'],
    emittedTasks: [
      {
        key: 'external-lead-times',
        title: 'Record lead times for external dependencies',
        phaseKey: 'design',
      },
    ],
    rationale:
      'External lead times are invisible in an estimate of the work and frequently longer than it. They also cannot be compressed by working harder.',
    remediation: 'Ask each external party for their lead time and put it in the schedule.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'PLN-CRIT-001',
    version: '1.0.0',
    title: 'The critical path is identified',
    description: 'Which chain of work decides the end date.',
    category: 'PLANNING',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    emittedTasks: [
      { key: 'identify-critical-path', title: 'Identify the critical path', phaseKey: 'design' },
    ],
    rationale:
      'Effort spent speeding up work that is not on the critical path changes nothing about the end date, and it is the most common way of being busy without progressing.',
    remediation: 'Compute the longest dependent chain and watch it specifically.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'PLN-MILE-001',
    version: '1.0.0',
    title: 'Milestones are verifiable, not calendar dates',
    description: 'A milestone that cannot be objectively assessed will be declared met.',
    category: 'PLANNING',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedGates: [
      {
        gateKey: 'PLANNING',
        criterion: 'Milestones have objective completion criteria.',
        blocking: false,
      },
    ],
    rationale:
      'Under schedule pressure, a milestone with no criteria is met by saying so, which removes the only intermediate signal the plan had.',
    remediation: 'Give each milestone a condition someone could check.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'PLN-BUFFER-001',
    version: '1.0.0',
    title: 'Contingency is explicit and held centrally',
    description: 'Padding hidden inside individual estimates is spent invisibly.',
    category: 'PLANNING',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    emittedTasks: [
      {
        key: 'explicit-contingency',
        title: 'Hold contingency as a named allowance',
        phaseKey: 'design',
      },
    ],
    rationale:
      'Buffer distributed into every estimate is consumed by whichever task happens to overrun, and nobody can see it going. Held centrally, spending it is a decision.',
    remediation: 'Estimate honestly and hold contingency as a separate, visible allowance.',
    references: ['Goldratt: Critical Chain'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'PLN-PARALLEL-001',
    version: '1.0.0',
    title: 'Parallel work needs people to be parallel',
    description:
      'A plan with six simultaneous streams and two people is sequential work drawn wrongly.',
    category: 'PLANNING',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedGates: [
      {
        gateKey: 'PLANNING',
        criterion: 'Parallel work is consistent with available capacity.',
        blocking: true,
      },
    ],
    rationale:
      'Plans routinely show parallelism the team cannot supply, which makes the end date arithmetic rather than a forecast.',
    remediation: 'Check that concurrent work never exceeds actual capacity.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'PLN-RISK-001',
    version: '1.0.0',
    title: 'An empty risk register means nobody looked',
    description:
      'Every project has risks; a register with none is a register that was not filled in.',
    category: 'PLANNING',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedGates: [{ gateKey: 'PLANNING', criterion: 'Major risks are recorded.', blocking: true }],
    rationale:
      'Risks that were never written down are handled by reacting, which costs more than mitigating and happens at a worse time.',
    remediation: 'Record the risks, with likelihood, impact and what would reduce them.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'PLN-RISK-002',
    version: '1.0.0',
    title: 'A risk needs a mitigation and an owner',
    description: 'A recorded risk with neither is a note.',
    category: 'PLANNING',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    emittedTasks: [
      {
        key: 'assign-risk-owners',
        title: 'Give each risk an owner and a mitigation',
        phaseKey: 'design',
      },
    ],
    rationale:
      'Risk registers fill with observations nobody is doing anything about, and the volume then hides the ones that matter.',
    remediation: 'For each risk, name who is watching it and what would reduce it.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'PLN-SEQ-001',
    version: '1.0.0',
    title: 'Riskiest work goes first where it can',
    description: 'Learning that something is impossible is cheapest early.',
    category: 'PLANNING',
    severity: 'RECOMMENDED',
    source: 'RECOMMENDED_DEFAULT',
    emittedTasks: [
      {
        key: 'front-load-risk',
        title: 'Schedule the most uncertain work early',
        phaseKey: 'design',
      },
    ],
    rationale:
      'Deferring the uncertain part means committing budget and schedule to a plan whose most fragile assumption has not been tested.',
    remediation: 'Move the highest-uncertainty work earlier, even if it is not the natural order.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'PLN-GATE-001',
    version: '1.0.0',
    title: 'Every phase has an exit criterion',
    description: 'A phase that can end whenever someone says so has not ended.',
    category: 'PLANNING',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedGates: [
      {
        gateKey: 'PLANNING',
        criterion: 'Each phase has a defined exit criterion.',
        blocking: true,
      },
    ],
    rationale:
      'Without exit criteria, phases overlap indefinitely and the work each was supposed to complete leaks into the next.',
    remediation: 'Give each phase a gate with criteria that can be checked.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'PLN-REPLAN-001',
    version: '1.0.0',
    title: 'A plan that has been overtaken is replanned, not ignored',
    description: 'A stale plan is worse than none, because people still act on it.',
    category: 'PLANNING',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    lifecycleScope: ['IN_PROGRESS', 'VERIFYING'],
    emittedTasks: [
      {
        key: 'replan-on-drift',
        title: 'Replan when actuals diverge materially',
        phaseKey: 'build',
      },
    ],
    rationale:
      'Everyone knows the plan is wrong and continues to report against it, so the reporting becomes fiction and the real state is held informally.',
    remediation: 'Replan when reality has diverged, and record why.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'PLN-METHOD-001',
    version: '1.0.0',
    title: 'Methodology never removes a mandatory security or release gate',
    description: 'A delivery method decides how work is organised, not which obligations apply.',
    category: 'PLANNING',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    emittedGates: [
      {
        gateKey: 'RELEASE_READINESS',
        criterion: 'Mandatory gates apply regardless of methodology.',
        blocking: true,
      },
    ],
    rationale:
      'Adopting a lighter process is frequently used to justify skipping verification, which conflates how work is scheduled with whether it was checked.',
    remediation:
      'Keep mandatory gates in every methodology; vary only how the work reaching them is organised.',
    references: ['ISO/IEC/IEEE 12207 Software life cycle processes'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'PLN-ITER-001',
    version: '1.0.0',
    title: 'Iterations end with something demonstrable',
    description: 'An iteration producing nothing observable produced no information.',
    category: 'PLANNING',
    severity: 'RECOMMENDED',
    source: 'METHODOLOGY_PACK',
    methodologyScope: ['AGILE', 'HYBRID'],
    emittedTasks: [
      {
        key: 'iteration-outcome',
        title: 'Define a demonstrable outcome per iteration',
        phaseKey: 'build',
      },
    ],
    rationale:
      'The point of iterating is feedback. An iteration with nothing to show has the overhead of the ceremony and none of the benefit.',
    remediation: 'End each iteration with something someone outside the team can look at.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'PLN-WIP-001',
    version: '1.0.0',
    title: 'Work in progress is limited',
    description: 'Starting more than can be finished converts progress into partial work.',
    category: 'PLANNING',
    severity: 'RECOMMENDED',
    source: 'METHODOLOGY_PACK',
    methodologyScope: ['KANBAN', 'HYBRID'],
    emittedTasks: [{ key: 'wip-limit', title: 'Set a work-in-progress limit', phaseKey: 'build' }],
    rationale:
      'Everything at 80% is nothing delivered, and context switching between many open items measurably reduces throughput.',
    remediation: 'Cap concurrent items per person and finish before starting.',
    references: ['Anderson: Kanban'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'PLN-SOLO-001',
    version: '1.0.0',
    title: 'Solo delivery needs written decisions more, not less',
    description: 'There is nobody to ask, so the record has to carry the context.',
    category: 'PLANNING',
    severity: 'RECOMMENDED',
    source: 'METHODOLOGY_PACK',
    conditions: [{ subject: 'INTAKE', key: 'team.size', operator: 'LESS_THAN', value: 2 }],
    requiredInputs: ['team.size'],
    emittedTasks: [{ key: 'solo-decision-log', title: 'Keep a decision log', phaseKey: 'build' }],
    rationale:
      'Solo projects skip documentation because everything is in one head, which is exactly why the project stops entirely if that person is unavailable.',
    remediation: 'Keep a short decision log; it costs minutes and is the whole handover.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'PLN-DONE-001',
    version: '1.0.0',
    title: 'Done is defined once, in advance',
    description: 'Otherwise each item is finished according to whoever finished it.',
    category: 'PLANNING',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'definition-of-done',
        title: 'A single definition of done applies to every item',
        description: 'Including tests, review, documentation and accessibility.',
        priority: 'MUST',
        verification: 'The definition is written down and referenced at review.',
      },
    ],
    rationale:
      'Without a shared definition, "done" drifts downwards under pressure, one item at a time, and nobody notices the standard moving.',
    remediation: 'Agree the definition of done before the first item and apply it uniformly.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'PLN-HANDOVER-001',
    version: '1.0.0',
    title: 'Handover work is in the plan, not after it',
    description: 'Documentation and transfer are work, and unplanned work does not happen.',
    category: 'PLANNING',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedTasks: [
      {
        key: 'plan-handover',
        title: 'Schedule handover and documentation work',
        phaseKey: 'release',
      },
    ],
    rationale:
      'Handover left until after the deadline competes with whatever is next, and loses. The knowledge then leaves with the team.',
    remediation: 'Put handover in the schedule as estimated work.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'PLN-CHANGE-001',
    version: '1.0.0',
    title: 'Scope added must displace scope or move the date',
    description: 'Adding work without changing anything else is a wish.',
    category: 'PLANNING',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    lifecycleScope: ['APPROVED', 'IN_PROGRESS'],
    emittedGates: [
      {
        gateKey: 'COMPLETION',
        criterion: 'Scope additions were traded against date, budget or other scope.',
        blocking: false,
      },
    ],
    rationale:
      'Scope added on the assumption it will absorb is how projects arrive at the deadline with everything half-built.',
    remediation: 'For each addition, decide what is removed or what date moves.',
    activeFrom: ACTIVE,
  }),

  /* --------------------------------------------------------------- Resource */

  defineRule({
    id: 'RES-CAP-001',
    version: '1.0.0',
    title: 'Capacity is hours available, not headcount',
    description: 'Meetings, support and other projects all reduce it.',
    category: 'RESOURCE',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    requiredInputs: ['capacity.hoursPerWeek'],
    emittedGates: [
      { gateKey: 'PLANNING', criterion: 'Capacity is stated in available hours.', blocking: true },
    ],
    rationale:
      'Planning against nominal headcount builds a systematic overestimate into the schedule from the first week, and it compounds.',
    remediation: 'Record hours actually available to this project per person per week.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'RES-CAP-002',
    version: '1.0.0',
    title: 'Plan for leave, illness and public holidays',
    description: 'They are predictable in aggregate even when not individually.',
    category: 'RESOURCE',
    severity: 'RECOMMENDED',
    source: 'RECOMMENDED_DEFAULT',
    calculationEffects: [
      {
        calculation: 'capacity.total',
        kind: 'MULTIPLY_EFFORT',
        low: 0.8,
        high: 0.9,
        basis:
          'Leave, public holidays and ordinary sickness typically remove ten to twenty per cent of nominal capacity across a year.',
      },
    ],
    rationale:
      'A plan assuming full attendance for six months is wrong by several weeks before it starts, and the error is entirely predictable.',
    remediation: 'Reduce nominal capacity by a realistic factor and say what it is.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'RES-CAP-003',
    version: '1.0.0',
    title: 'Nobody is a hundred per cent productive on project work',
    description: 'Support, administration and interruptions consume real hours.',
    category: 'RESOURCE',
    severity: 'RECOMMENDED',
    source: 'RECOMMENDED_DEFAULT',
    calculationEffects: [
      {
        calculation: 'capacity.effective',
        kind: 'MULTIPLY_EFFORT',
        low: 0.6,
        high: 0.8,
        basis: 'Sixty to eighty per cent of nominal time typically reaches project work.',
      },
    ],
    rationale:
      'Planning at full utilisation removes every buffer, so any interruption becomes a delay and there is nowhere for it to absorb.',
    remediation: 'Plan at sixty to eighty per cent of nominal hours and state the assumption.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'RES-SKILL-001',
    version: '1.0.0',
    title: 'Work assigned to someone still learning takes longer',
    description: 'This is normal and worth planning for rather than hoping about.',
    category: 'RESOURCE',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    calculationEffects: [
      {
        calculation: 'effort.total',
        kind: 'MULTIPLY_EFFORT',
        low: 1.3,
        high: 2.0,
        basis:
          'Work in an unfamiliar technology typically takes between a third and twice as long again.',
      },
    ],
    rationale:
      'Learning time is real and is usually planned as though it were zero, which makes the first estimate in any new technology reliably wrong in one direction.',
    remediation:
      'Apply a learning factor where the technology is new to whoever is doing the work.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'RES-BUS-001',
    version: '1.0.0',
    title: 'Knowledge concentrated in one person is a scheduling risk',
    description: 'Especially on the critical path.',
    category: 'RESOURCE',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    emittedRisks: [
      {
        key: 'knowledge-concentration',
        title: 'Only one person can do part of the work',
        description: 'Their absence stops that work entirely, regardless of who else is available.',
        likelihood: 'MEDIUM',
        impact: 'HIGH',
      },
    ],
    emittedTasks: [
      {
        key: 'spread-knowledge',
        title: 'Share knowledge of single-owner areas',
        phaseKey: 'build',
      },
    ],
    rationale:
      'Adding people does not help if only one of them can do the work. Concentration is invisible until the person is unavailable.',
    remediation: 'Pair or document on the areas only one person understands.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'RES-ONBOARD-001',
    version: '1.0.0',
    title: 'New people reduce capacity before they add to it',
    description: 'Onboarding costs the time of whoever is already productive.',
    category: 'RESOURCE',
    severity: 'RECOMMENDED',
    source: 'RECOMMENDED_DEFAULT',
    emittedRisks: [
      {
        key: 'late-staffing',
        title: 'Adding people to a late project makes it later',
        description: 'The onboarding cost lands immediately; the benefit arrives weeks later.',
        likelihood: 'HIGH',
        impact: 'MEDIUM',
      },
    ],
    rationale:
      'Onboarding consumes the time of the people who are already effective, so the immediate effect of adding someone is negative.',
    remediation: 'Staff early or not at all, and budget for onboarding time.',
    references: ['Brooks: The Mythical Man-Month'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'RES-CONTEXT-001',
    version: '1.0.0',
    title: 'Splitting a person across projects costs more than the split suggests',
    description: 'Two half-time assignments are worth less than one full-time one.',
    category: 'RESOURCE',
    severity: 'RECOMMENDED',
    source: 'RECOMMENDED_DEFAULT',
    calculationEffects: [
      {
        calculation: 'capacity.effective',
        kind: 'MULTIPLY_EFFORT',
        low: 0.6,
        high: 0.8,
        basis:
          'Context switching between projects costs roughly twenty to forty per cent of the divided time.',
      },
    ],
    rationale: 'The cost of switching is paid every time, and it does not appear in any timesheet.',
    remediation:
      'Prefer whole-person assignments; where splitting is unavoidable, discount the capacity.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'RES-REVIEW-001',
    version: '1.0.0',
    title: 'Review capacity is capacity',
    description: 'Work that cannot be reviewed cannot be finished.',
    category: 'RESOURCE',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedTasks: [
      {
        key: 'plan-review-capacity',
        title: 'Allow for review time in capacity',
        phaseKey: 'build',
      },
    ],
    rationale:
      'Planning only for implementation creates a review queue, which converts finished work into work in progress and hides the true state.',
    remediation: 'Include review time in each person’s capacity.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'RES-KEY-001',
    version: '1.0.0',
    title: 'Key people are named and their availability confirmed',
    description: 'A plan depending on someone who has not agreed to it is a hope.',
    category: 'RESOURCE',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedGates: [
      { gateKey: 'PLANNING', criterion: 'Key people are named and available.', blocking: true },
    ],
    rationale:
      'Plans routinely assume the availability of people who have other commitments and were never asked.',
    remediation: 'Confirm availability with each named person and record it.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'RES-EXTERNAL-001',
    version: '1.0.0',
    title: 'External resources need contracts before they need tasks',
    description: 'Procurement takes longer than the work in most organisations.',
    category: 'RESOURCE',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    emittedTasks: [
      {
        key: 'procurement-lead-time',
        title: 'Start procurement before the work is needed',
        phaseKey: 'discovery',
      },
    ],
    rationale:
      'Contracting and approval routinely take weeks, entirely outside the project’s control and invisible in any estimate of the work.',
    remediation: 'Begin procurement as soon as the need is known.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'RES-ONCALL-001',
    version: '1.0.0',
    title: 'On-call is a commitment with a cost',
    description: 'It reduces daytime capacity and cannot be staffed by one person indefinitely.',
    category: 'RESOURCE',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
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
        key: 'oncall-rota',
        title: 'A sustainable on-call rota exists',
        description: 'Enough people to rotate, with compensation and a documented escalation path.',
        priority: 'MUST',
        verification: 'A rota with named people and an escalation path.',
      },
    ],
    rationale:
      'A rota of one or two people is not sustainable, and the failure mode is those people leaving.',
    remediation: 'Size the rota for sustainability before committing to the availability target.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'RES-HANDOFF-001',
    version: '1.0.0',
    title: 'Every handoff between people is a delay',
    description: 'Waiting time between stages usually exceeds working time.',
    category: 'RESOURCE',
    severity: 'ADVISORY',
    source: 'RECOMMENDED_DEFAULT',
    emittedTasks: [
      { key: 'reduce-handoffs', title: 'Reduce handoffs on the critical path', phaseKey: 'design' },
    ],
    rationale:
      'In most workflows the elapsed time is dominated by waiting, not by working, and each handoff adds a queue.',
    remediation: 'Minimise handoffs, especially on the critical path.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'RES-LEAVE-001',
    version: '1.0.0',
    title: 'Known absences are in the schedule',
    description: 'Booked leave is not a risk; it is a fact.',
    category: 'RESOURCE',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedTasks: [
      {
        key: 'record-known-absence',
        title: 'Put known absences in the schedule',
        phaseKey: 'design',
      },
    ],
    rationale:
      'Booked leave omitted from a plan makes the plan wrong by exactly that amount, for no reason at all.',
    remediation: 'Enter known absences before computing the schedule.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'RES-SPEC-001',
    version: '1.0.0',
    title: 'Specialists are a bottleneck even when they are available',
    description: 'Work needing one specific person queues behind everything else needing them.',
    category: 'RESOURCE',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    emittedTasks: [
      { key: 'level-specialist-load', title: 'Level the load on specialists', phaseKey: 'design' },
    ],
    rationale:
      'A specialist at full utilisation has an unbounded queue, which is a scheduling property rather than an effort one.',
    remediation: 'Spread specialist-dependent work across the schedule rather than clustering it.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'RES-TRACK-001',
    version: '1.0.0',
    title: 'Actual effort is recorded against estimates',
    description: 'Without it, estimation never improves.',
    category: 'RESOURCE',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    emittedTasks: [
      { key: 'record-actuals', title: 'Record actual effort against estimates', phaseKey: 'build' },
    ],
    rationale:
      'Estimates improve only from feedback. Without recorded actuals, the same systematic error is repeated every project.',
    remediation: 'Record actual effort per item and compare periodically.',
    activeFrom: ACTIVE,
  }),

  /* ----------------------------------------------------------------- Budget */

  defineRule({
    id: 'BUD-RANGE-001',
    version: '1.0.0',
    title: 'Estimates are ranges',
    description: 'A single figure implies a certainty that does not exist.',
    category: 'BUDGET',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedGates: [
      { gateKey: 'PLANNING', criterion: 'Estimates are expressed as ranges.', blocking: true },
    ],
    rationale:
      'A single number is read as a commitment. A range communicates the uncertainty that was always there, and makes the conversation about which end is likely.',
    remediation: 'Give every estimate a low and a high figure.',
    references: ['McConnell: Software Estimation'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'BUD-RANGE-002',
    version: '1.0.0',
    title: 'A range is not summarised by its midpoint',
    description: 'Averaging a range discards exactly the information the range carried.',
    category: 'BUDGET',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    rationale:
      'Reporting the midpoint reintroduces false precision by the back door, and everyone downstream treats it as the number.',
    remediation: 'Report both ends. If one figure is needed, say which end it is and why.',
    emittedGates: [
      {
        gateKey: 'PLANNING',
        criterion: 'Ranges are reported as ranges, not midpoints.',
        blocking: false,
      },
    ],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'BUD-BASIS-001',
    version: '1.0.0',
    title: 'Every estimate records what it assumed',
    description: 'An estimate with no basis cannot be checked or revised.',
    category: 'BUDGET',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'estimate-basis',
        title: 'Each estimate records its assumptions and inputs',
        description: 'Rate, effort, scope assumed and anything excluded.',
        priority: 'MUST',
        verification: 'Each estimate has a recorded basis.',
      },
    ],
    rationale:
      'Six months later, "the budget said one hundred and eighty thousand" cannot be defended or corrected without knowing what it assumed.',
    remediation: 'Record the inputs and assumptions with every estimate.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'BUD-CURRENCY-001',
    version: '1.0.0',
    title: 'Money carries its currency everywhere',
    description: 'A number without a currency is not an amount.',
    category: 'BUDGET',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    requiredInputs: ['budget.currency'],
    emittedRequirements: [
      {
        key: 'currency-on-amounts',
        title: 'Every stored amount has an explicit currency',
        description: 'And a recorded rate where conversion happens.',
        priority: 'MUST',
        verification: 'The schema stores currency alongside every amount.',
      },
    ],
    rationale:
      'Currency inferred from context is currency that will eventually be inferred wrongly, and the error is invisible because the number looks fine.',
    remediation: 'Store currency with every amount, and record the rate used for any conversion.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'BUD-VAT-001',
    version: '1.0.0',
    title: 'Budgets state whether tax is included',
    description: 'The difference is material and frequently unstated.',
    category: 'BUDGET',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedTasks: [
      {
        key: 'state-tax-treatment',
        title: 'State whether budget figures include tax',
        phaseKey: 'design',
      },
    ],
    rationale:
      'A twenty per cent discrepancy discovered at invoicing is a real overrun caused entirely by an unstated convention.',
    remediation: 'Say explicitly whether figures include tax.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'BUD-RUN-001',
    version: '1.0.0',
    title: 'Running costs are budgeted, not only build costs',
    description: 'Hosting, licences, support and monitoring continue after the project ends.',
    category: 'BUDGET',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'running-costs',
        title: 'Ongoing costs are estimated for at least a year',
        description: 'Infrastructure, licences, third-party services and support time.',
        priority: 'MUST',
        verification: 'A running-cost estimate alongside the build budget.',
      },
    ],
    rationale:
      'A project delivered within budget that costs more per year than anyone expected has not succeeded; it has moved the problem.',
    remediation: 'Estimate the first year of running costs alongside the build.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'BUD-CONT-001',
    version: '1.0.0',
    title: 'Contingency is sized to uncertainty, not by habit',
    description: 'Ten per cent is a convention, not an analysis.',
    category: 'BUDGET',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    emittedTasks: [
      {
        key: 'size-contingency',
        title: 'Size contingency against actual uncertainty',
        phaseKey: 'design',
      },
    ],
    rationale:
      'A fixed percentage is too much for well-understood work and far too little for novel work, and it is applied to both identically.',
    remediation: 'Size contingency from the number and severity of unknowns.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'BUD-UNKNOWN-001',
    version: '1.0.0',
    title: 'Unknowns increase the range, they do not vanish',
    description: 'An estimate produced despite unknowns must widen to reflect them.',
    category: 'BUDGET',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    calculationEffects: [
      {
        calculation: 'budget.total',
        kind: 'ADD_CONTINGENCY_PERCENT',
        low: 10,
        high: 50,
        basis:
          'Each unresolved critical unknown widens the plausible range rather than shifting it.',
      },
    ],
    rationale:
      'Estimating around an unknown by picking the likely case produces a number that looks the same as a well-founded one and is not.',
    remediation: 'Widen the range for each unresolved unknown and say which ones drove it.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'BUD-TRACK-001',
    version: '1.0.0',
    title: 'Spend is tracked against the plan while there is still time to act',
    description: 'Discovering an overrun at the end is discovering it too late.',
    category: 'BUDGET',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    lifecycleScope: ['IN_PROGRESS', 'VERIFYING'],
    emittedTasks: [
      { key: 'track-spend', title: 'Track spend against plan regularly', phaseKey: 'build' },
    ],
    rationale:
      'Budget variance is only actionable while there is budget left, which means it has to be visible continuously rather than at the end.',
    remediation: 'Compare committed and actual spend to plan at each reporting point.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'BUD-CHANGE-001',
    version: '1.0.0',
    title: 'A change request states its cost before it is approved',
    description: 'Approving work of unknown cost is approving an unknown.',
    category: 'BUDGET',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedGates: [
      {
        gateKey: 'COMPLETION',
        criterion: 'Approved changes carried a cost estimate.',
        blocking: false,
      },
    ],
    rationale:
      'Changes approved without cost accumulate into an overrun nobody agreed to, one reasonable decision at a time.',
    remediation: 'Estimate every change request before approval.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'BUD-LICENCE-001',
    version: '1.0.0',
    title: 'Licence costs scale with something — know what',
    description: 'Per user, per seat, per request or per environment.',
    category: 'BUDGET',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    conditions: [{ subject: 'INTAKE', key: 'integrations.thirdParties', operator: 'IS_ANSWERED' }],
    requiredInputs: ['integrations.thirdParties'],
    emittedTasks: [
      { key: 'model-licence-scaling', title: 'Model how licence costs scale', phaseKey: 'design' },
    ],
    rationale:
      'A per-user licence that is trivial at launch can dominate the running cost at scale, and the discovery usually coincides with success.',
    remediation: 'Model each licence cost at expected and at ten times expected volume.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'BUD-CLOUD-001',
    version: '1.0.0',
    title: 'Cloud costs need a ceiling and an alert',
    description: 'Usage-based pricing has no natural upper bound.',
    category: 'BUDGET',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'cost-alerts',
        title: 'Spend alerts exist before the first deployment',
        description: 'At a threshold someone will actually act on.',
        priority: 'MUST',
        verification: 'A configured budget alert.',
      },
    ],
    rationale:
      'A runaway loop or an unexpected traffic spike can produce a very large bill within hours, and nothing stops it by default.',
    remediation: 'Set budget alerts, and hard limits where the platform supports them.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'BUD-SUNK-001',
    version: '1.0.0',
    title: 'Money already spent is not a reason to continue',
    description: 'The decision is about future cost against future value.',
    category: 'BUDGET',
    severity: 'ADVISORY',
    source: 'RECOMMENDED_DEFAULT',
    rationale:
      'Sunk cost reasoning keeps failing projects running long past the point where stopping was the cheaper option.',
    remediation: 'Evaluate continuation on remaining cost and remaining value only.',
    emittedTasks: [
      {
        key: 'review-continuation',
        title: 'Review continuation on forward cost alone',
        phaseKey: 'build',
      },
    ],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'BUD-DEBT-001',
    version: '1.0.0',
    title: 'Deliberate shortcuts are recorded as debt with a cost',
    description: 'Undocumented shortcuts become permanent.',
    category: 'BUDGET',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    emittedTasks: [
      {
        key: 'record-technical-debt',
        title: 'Record deliberate shortcuts and their cost',
        phaseKey: 'build',
      },
    ],
    rationale:
      'A shortcut taken deliberately and recorded can be repaid. One taken and forgotten is indistinguishable from a mistake, and gets treated as normal.',
    remediation: 'Record each deliberate shortcut with what it will cost to undo.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'BUD-COMPARE-001',
    version: '1.0.0',
    title: 'Estimates are compared against the same project’s history',
    description: 'Other teams’ velocity does not transfer.',
    category: 'BUDGET',
    severity: 'ADVISORY',
    source: 'RECOMMENDED_DEFAULT',
    rationale:
      'Estimation accuracy comes from local calibration. Industry figures describe a different team on a different codebase.',
    remediation: 'Calibrate against this project’s own recorded actuals.',
    emittedTasks: [
      {
        key: 'calibrate-estimates',
        title: 'Calibrate estimates against local actuals',
        phaseKey: 'build',
      },
    ],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'BUD-PHASE-001',
    version: '1.0.0',
    title: 'Estimates get narrower as the project proceeds',
    description: 'An estimate that never narrows was never based on anything.',
    category: 'BUDGET',
    severity: 'ADVISORY',
    source: 'RECOMMENDED_DEFAULT',
    rationale:
      'Uncertainty should reduce as unknowns resolve. A range that stays constant is a sign the range was decorative.',
    remediation: 'Re-estimate at each phase boundary and expect the range to narrow.',
    emittedTasks: [
      {
        key: 're-estimate-per-phase',
        title: 'Re-estimate at each phase boundary',
        phaseKey: 'build',
      },
    ],
    references: ['Boehm: Cone of Uncertainty'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'BUD-EXIT-001',
    version: '1.0.0',
    title: 'The cost of leaving a dependency is part of choosing it',
    description: 'Migration cost is invisible at adoption and dominant at exit.',
    category: 'BUDGET',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    emittedTasks: [
      {
        key: 'estimate-exit-cost',
        title: 'Estimate the cost of leaving key dependencies',
        phaseKey: 'design',
      },
    ],
    rationale:
      'A dependency with high exit cost is a commercial commitment as much as a technical one, and it is usually made without anyone treating it as such.',
    remediation: 'For each significant dependency, estimate what leaving would cost.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'BUD-SECURITY-001',
    version: '1.0.0',
    title: 'Security work is budgeted, not absorbed',
    description: 'Unbudgeted security work is deferred security work.',
    category: 'BUDGET',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    emittedTasks: [
      {
        key: 'budget-security-work',
        title: 'Budget for security testing and remediation',
        phaseKey: 'design',
      },
    ],
    rationale:
      'Security work with no budget line competes with features for the same time and loses, every time, until an incident reprioritises it.',
    remediation: 'Give security testing and remediation their own budget line.',
    references: ['OWASP SAMM: Governance — Strategy and Metrics'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'BUD-REWORK-001',
    version: '1.0.0',
    title: 'Rework is budgeted, because there will be some',
    description:
      'A plan with no allowance for redoing things assumes every decision is right first time.',
    category: 'BUDGET',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    calculationEffects: [
      {
        calculation: 'effort.total',
        kind: 'ADD_CONTINGENCY_PERCENT',
        low: 10,
        high: 30,
        basis:
          'Rework from review feedback, changed understanding and defects found in verification is routine, and is systematically omitted from estimates.',
      },
    ],
    rationale:
      'Estimates are made for building the thing once. Review comments, misunderstood requirements and defects found in testing all produce work that was real and unplanned, so the overrun is structural rather than a sign anything went wrong.',
    remediation:
      'Include an explicit rework allowance rather than absorbing it into individual estimates, where it becomes invisible.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'BUD-A11Y-001',
    version: '1.0.0',
    title: 'Accessibility remediation costs more than accessible design',
    description: 'Several times more, and it never reaches the same quality.',
    category: 'BUDGET',
    severity: 'RECOMMENDED',
    source: 'LEGAL_SECURITY',
    calculationEffects: [
      {
        calculation: 'effort.accessibility',
        kind: 'MULTIPLY_EFFORT',
        low: 3,
        high: 10,
        basis:
          'Retrofitting accessibility typically costs several times what designing for it costs.',
      },
    ],
    rationale:
      'Retrofitted accessibility means reworking markup, focus order and colour decisions across every page, and the result is usually still worse than designing for it.',
    remediation: 'Budget accessibility into design rather than into a remediation phase.',
    references: ['WCAG 2.2', 'W3C: Cost of accessibility retrofitting'],
    activeFrom: ACTIVE,
  }),
];
