/**
 * Deterministic project generation.
 *
 * Contract: plan §34 makes the Phase-6 gate "deterministic generation from golden fixture"; plan §2.3
 * makes the deterministic engine the core of the product, with external AI strictly optional.
 *
 * **Determinism is the feature, not an implementation detail.** The product's claim is that its plans
 * are explainable and reproducible: the same answers must produce the same plan, today and in six
 * months, on any machine. That claim is what distinguishes it from asking a model to write a project
 * plan, and it survives exactly as long as this file has no access to a clock, a random source, or
 * iteration order that varies.
 *
 * So three things are banned here, and each ban is load-bearing:
 *
 * - **No `Date.now()`.** The timestamp is an input. A generator that stamps its own output cannot
 *   produce byte-identical results twice, so the golden-fixture test could never be written.
 * - **No `crypto.randomUUID()`.** Node ids are derived from a stable path — `req:accessibility`, not
 *   a random UUID. Ids that change between runs make two identical plans incomparable, and make the
 *   change log useless: every regeneration would read as though everything was replaced.
 * - **No unordered iteration.** Everything walks arrays in declared order or sorts explicitly.
 *
 * The output is a graph, not a database write. Persistence is the caller's job, which keeps this
 * function pure and therefore testable without a database at all.
 */

import type { IntakeField } from '@govintel/intake/schema';
import { analyseMissing } from '@govintel/intake/missing';
import { FIELD_DEFINITIONS } from '@govintel/intake/fields';
import type { TwinNode, NodeProvenance } from './nodes.ts';
import { createNode } from './nodes.ts';
import type { TwinEdge, EdgeClass } from './edges.ts';
import { TwinGraph } from './graph.ts';

/**
 * The generator's own version.
 *
 * Bumped whenever the generation rules change. A plan carries the version that produced it, so a
 * stored plan stays explainable after the rules move on — the alternative is silently regenerating
 * old projects under new rules, which changes what the user was told without telling them.
 */
export const GENERATOR_VERSION = '1.0.0';

export interface GenerationInput {
  readonly projectId: string;
  readonly projectName: string;
  readonly projectSummary?: string;
  readonly intake: readonly IntakeField[];
  /** Supplied by the caller. See the note above on why this is not read from a clock. */
  readonly at: string;
}

export interface GenerationResult {
  readonly graph: TwinGraph;
  readonly generatorVersion: string;
  /** Every assumption the generator had to make, for the "what we assumed" surface. */
  readonly assumptions: readonly string[];
  /** What the generator could not determine, stated rather than guessed. */
  readonly unknowns: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* Rule packs                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Phases by project type.
 *
 * Deliberately data rather than code. Plan §7 puts the real rule engine in Phase 7 with a DSL and
 * explanations; this is the minimum deterministic skeleton it will later replace, and writing it as
 * a table means the replacement is a change of evaluator rather than a rewrite of the generator.
 *
 * Every project type gets a *different* shape, not the same list with different labels. A plan that
 * proposes identical phases for an internal tool and an e-commerce platform is not planning; it is
 * autocomplete.
 */
interface PhaseTemplate {
  readonly key: string;
  readonly label: string;
  readonly summary: string;
}

const CORE_PHASES: readonly PhaseTemplate[] = [
  { key: 'discovery', label: 'Discovery', summary: 'Establish what is being built and for whom.' },
  { key: 'design', label: 'Design', summary: 'Decide how it will work before building it.' },
  { key: 'build', label: 'Build', summary: 'Implement the agreed scope.' },
  { key: 'verify', label: 'Verification', summary: 'Establish that it does what was agreed.' },
  { key: 'release', label: 'Release', summary: 'Put it in front of the people who need it.' },
];

const TYPE_PHASES: Readonly<Record<string, readonly PhaseTemplate[]>> = {
  PUBLIC_WEB_APP: [
    ...CORE_PHASES,
    {
      key: 'hardening',
      label: 'Security hardening',
      summary:
        'Anything on the public internet is attacked continuously, whether or not anyone knows it exists.',
    },
    { key: 'operate', label: 'Operation', summary: 'Keep it running, patched and observed.' },
  ],
  SAAS_WEB_APP: [
    ...CORE_PHASES,
    {
      key: 'tenancy',
      label: 'Tenant isolation',
      summary:
        'Multi-tenancy is the one defect class in SaaS that ends a company rather than causing a bad week.',
    },
    {
      key: 'hardening',
      label: 'Security hardening',
      summary: 'Public exposure plus customer data.',
    },
    { key: 'operate', label: 'Operation', summary: 'Uptime, support and continuous delivery.' },
  ],
  INTERNAL_BUSINESS_APP: [
    ...CORE_PHASES,
    {
      key: 'rollout',
      label: 'Rollout and training',
      summary: 'Internal tools fail on adoption far more often than on engineering.',
    },
  ],
  API_BACKEND_PLATFORM: [
    ...CORE_PHASES,
    {
      key: 'contract',
      label: 'Interface contract',
      summary:
        'Once consumers depend on it, the interface is harder to change than the implementation.',
    },
    { key: 'operate', label: 'Operation', summary: 'Versioning, deprecation and support.' },
  ],
  MOBILE_APP: [
    ...CORE_PHASES,
    {
      key: 'store',
      label: 'Store submission',
      summary: 'Review is an external dependency with its own timetable, and it is not negotiable.',
    },
    { key: 'operate', label: 'Operation', summary: 'Staged rollout and version support.' },
  ],
  AI_ENABLED_WEB_APP: [
    ...CORE_PHASES,
    {
      key: 'evaluation',
      label: 'Model evaluation',
      summary: 'A feature whose output cannot be evaluated cannot be improved, only guessed at.',
    },
    {
      key: 'hardening',
      label: 'Security hardening',
      summary: 'Public exposure and prompt-level abuse.',
    },
    { key: 'operate', label: 'Operation', summary: 'Cost, drift and provider change.' },
  ],
  DEVELOPER_TOOLING: [
    ...CORE_PHASES,
    {
      key: 'adoption',
      label: 'Adoption',
      summary:
        'Developer tools compete with the workflow people already have; that is the real bar.',
    },
  ],
  ECOMMERCE: [
    ...CORE_PHASES,
    {
      key: 'payments',
      label: 'Payments and compliance',
      summary: 'Taking money brings obligations that do not apply to any other kind of project.',
    },
    { key: 'hardening', label: 'Security hardening', summary: 'Public exposure and payment data.' },
    { key: 'operate', label: 'Operation', summary: 'Fulfilment, returns and seasonal load.' },
  ],
};

/** Used when the project type is unknown. Says so, rather than assuming a web app. */
const UNKNOWN_TYPE_PHASES: readonly PhaseTemplate[] = CORE_PHASES;

/**
 * Requirements implied by intake answers.
 *
 * Each entry names the field that triggers it and why. The `rationale` becomes the edge's rationale,
 * so the traceability report can answer "why is this requirement here?" with the actual answer rather
 * than "the generator added it".
 */
interface RequirementRule {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  /** The intake field this requirement is traceable to. Becomes the node's `sourceRef`. */
  readonly fieldId: string;
  readonly when: (ctx: IntakeLookup) => boolean;
  readonly rationale: string;

  /*
   * What the platform's own generated requirements have to carry.
   *
   * Phase 10 introduced a standard for requirements — kind, a way of being verified, at least one
   * criterion a reader can judge — and the engine's own output has to meet it. A platform that
   * applies a rule to the user's requirements and exempts the ones it writes itself is asserting
   * that its own conclusions need no justification, which is exactly the position it exists to
   * argue against.
   *
   * That check lives in `packages/execution/test/emitted-requirements.test.ts`, which runs
   * `checkRequirement` over every requirement in a generated graph. This comment previously named
   * `generate.test.ts`, which has never imported it — the check it described did not exist.
   */
  readonly kind: 'FUNCTIONAL' | 'QUALITY_ATTRIBUTE' | 'CONSTRAINT' | 'REGULATORY' | 'DATA';
  readonly qualityAttribute?:
    'PERFORMANCE' | 'AVAILABILITY' | 'SECURITY' | 'PRIVACY' | 'ACCESSIBILITY';
  readonly verification: readonly ('TEST' | 'INSPECTION' | 'ANALYSIS' | 'DEMONSTRATION')[];
  /** At least one. A requirement with nothing to verify against is checked in `checkRequirement`. */
  readonly acceptance: readonly { readonly id: string; readonly statement: string }[];
}

const REQUIREMENT_RULES: readonly RequirementRule[] = [
  {
    key: 'accessibility',
    label: 'Meet the stated accessibility standard',
    description:
      'Perceivable, operable, understandable and robust for users with disabilities, verified by automated and manual checks.',
    fieldId: 'accessibility.target',
    // "No formal target" is an answer, and it is not this requirement. Treating any answer as a
    // trigger would put an accessibility requirement on a project that explicitly declined one.
    when: (ctx) => {
      const target = ctx.stringOf('accessibility.target');
      return target !== undefined && target !== 'No formal target';
    },
    kind: 'REGULATORY',
    verification: ['TEST', 'INSPECTION'],
    acceptance: [
      {
        id: 'a11y-automated',
        statement:
          'An automated accessibility scan of every user-facing route reports no violations at the stated conformance level.',
      },
      {
        id: 'a11y-keyboard',
        statement:
          'Every interactive control is reachable and operable by keyboard alone, with a visible focus indicator.',
      },
    ],
    rationale: 'The intake named an accessibility standard.',
  },
  {
    key: 'personal-data',
    label: 'Handle personal data lawfully',
    description:
      'Lawful basis, retention limits, subject access, deletion, and a record of what is stored and why.',
    fieldId: 'data.types',
    when: (ctx) =>
      ctx.listIncludesAny('data.types', [
        'Personal data',
        'Health data',
        'Children’s data',
        'Government or regulated records',
      ]),
    // Regulatory, not a quality attribute. The obligation here is legal, and naming an attribute
    // as well would put the requirement in two categories with different checks — the quality-
    // attribute check would demand a number where the real obligation is to hold a record.
    kind: 'REGULATORY',
    verification: ['INSPECTION', 'ANALYSIS'],
    acceptance: [
      {
        id: 'privacy-record',
        statement:
          'A record of processing exists naming each category of personal data held, its lawful basis and its retention period.',
      },
      {
        id: 'privacy-deletion',
        statement:
          'A subject deletion request removes or anonymises the data within the stated period.',
      },
    ],
    rationale: 'The intake recorded that the system will hold personal data.',
  },
  {
    key: 'payment-data',
    label: 'Meet payment-card obligations',
    description:
      'Card data must not transit or rest in systems that are not in scope for it. The cheapest control is usually not to hold it at all.',
    fieldId: 'data.types',
    when: (ctx) => ctx.listIncludesAny('data.types', ['Payment card data']),
    kind: 'REGULATORY',
    verification: ['INSPECTION', 'ANALYSIS'],
    acceptance: [
      {
        id: 'pci-scope',
        statement:
          'A written scope statement names every component that stores, processes or transmits card data, or states that none does.',
      },
    ],
    rationale: 'The intake recorded that payment card data is held.',
  },
  {
    key: 'availability',
    label: 'Meet the stated availability expectation',
    description: 'Monitoring, alerting and a tested recovery path, sized to the expectation.',
    fieldId: 'availability.expectation',
    when: (ctx) => {
      const target = ctx.stringOf('availability.expectation');
      return target !== undefined && target !== 'Not yet decided';
    },
    kind: 'QUALITY_ATTRIBUTE',
    qualityAttribute: 'AVAILABILITY',
    verification: ['TEST', 'INSPECTION'],
    acceptance: [
      {
        id: 'availability-monitoring',
        statement:
          'Monitoring reports availability against the stated expectation, and an alert fires when it is not met.',
      },
      {
        id: 'availability-recovery',
        statement:
          'A recovery from backup has been performed and timed against the stated expectation.',
      },
    ],
    rationale: 'The intake recorded an availability expectation.',
  },
  {
    key: 'performance',
    label: 'Meet the stated performance expectation',
    description:
      'Measured against defined journeys under representative load. A target with no defined journey cannot be passed or failed.',
    fieldId: 'performance.expectation',
    when: (ctx) => ctx.stringOf('performance.expectation') !== undefined,
    kind: 'QUALITY_ATTRIBUTE',
    qualityAttribute: 'PERFORMANCE',
    verification: ['TEST'],
    acceptance: [
      {
        id: 'performance-journey',
        statement:
          'Each named user journey is measured under a stated load, and the measurement is compared against the recorded target.',
      },
    ],
    rationale: 'The intake recorded a performance expectation.',
  },
  {
    key: 'compliance',
    label: 'Evidence the named compliance obligations',
    description:
      'Controls mapped to obligations, with evidence retained for each. The platform records what has been evidenced; it never asserts that a project is compliant.',
    fieldId: 'compliance.regimes',
    when: (ctx) => ctx.listOf('compliance.regimes').length > 0,
    kind: 'REGULATORY',
    verification: ['INSPECTION'],
    acceptance: [
      {
        id: 'compliance-mapping',
        statement:
          'Each named obligation maps to a control, and each control has retained evidence a third party could examine.',
      },
    ],
    rationale: 'The intake named one or more compliance regimes.',
  },
  {
    key: 'authentication',
    label: 'Authenticate users',
    description:
      'Identity established before any tenant-scoped data is served, with session handling, recovery and lockout considered together.',
    fieldId: 'security.authentication',
    when: (ctx) => ctx.isTrue('security.authentication'),
    kind: 'FUNCTIONAL',
    verification: ['TEST'],
    acceptance: [
      {
        id: 'auth-required',
        statement: 'A request with no valid session receives no tenant-scoped data.',
      },
      {
        id: 'auth-lockout',
        statement:
          'Repeated failed sign-in attempts are throttled, and the throttle is observable.',
      },
    ],
    rationale: 'The intake recorded that users will sign in.',
  },
];

/**
 * Risks implied by the shape of the project rather than by a single answer.
 *
 * `when` is a predicate over the whole intake so a risk can depend on a combination — a fixed
 * deadline is not itself a risk, and a fixed deadline with an unknown budget is.
 */
interface RiskRule {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly likelihood: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly impact: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly when: (ctx: IntakeLookup) => boolean;
  readonly rationale: string;
}

const RISK_RULES: readonly RiskRule[] = [
  {
    key: 'fixed-deadline-open-scope',
    label: 'The deadline is fixed and the scope is not',
    description:
      'When the date cannot move, scope is the only variable left. Deciding what ships before work starts is cheaper than deciding it in the final week.',
    likelihood: 'HIGH',
    impact: 'HIGH',
    when: (ctx) => ctx.isTrue('deadline.fixed') && !ctx.isAnswered('capabilities.key'),
    rationale: 'A fixed deadline was recorded with no agreed capability list.',
  },
  {
    key: 'unknown-budget',
    label: 'No budget has been established',
    description:
      'Every estimate below is a range with no ceiling to check it against, so the plan cannot tell you when it has become unaffordable.',
    likelihood: 'MEDIUM',
    impact: 'HIGH',
    when: (ctx) => !ctx.isAnswered('budget.total'),
    rationale: 'The budget field was not answered.',
  },
  {
    key: 'single-person',
    label: 'The project depends on one person',
    description:
      'A team of one has no redundancy: illness, a new job or a bad week moves the whole timeline. Worth planning around rather than hoping about.',
    likelihood: 'MEDIUM',
    impact: 'HIGH',
    when: (ctx) => ctx.numberOf('team.size') === 1,
    rationale: 'The intake recorded a team of one.',
  },
  {
    key: 'skills-gap',
    label: 'The work needs skills the team has not confirmed',
    description:
      'Learning time is real time. Unstated, it comes out of the schedule anyway — just later and less visibly.',
    likelihood: 'MEDIUM',
    impact: 'MEDIUM',
    when: (ctx) => !ctx.isAnswered('team.skills'),
    rationale: 'Team skills were not recorded.',
  },
  {
    key: 'public-exposure',
    label: 'The system is exposed to the public internet',
    description:
      'Anything reachable from the internet is scanned continuously within hours of appearing, regardless of whether anyone has been told it exists.',
    likelihood: 'HIGH',
    impact: 'HIGH',
    when: (ctx) =>
      ['PUBLIC_WEB_APP', 'SAAS_WEB_APP', 'ECOMMERCE', 'AI_ENABLED_WEB_APP'].includes(
        ctx.stringOf('project.type') ?? '',
      ),
    rationale: 'The project type is publicly exposed.',
  },
  {
    key: 'unknown-type',
    label: 'The kind of project has not been established',
    description:
      'The rule pack that decides security, testing and release obligations is chosen by project type. Without it the plan is generic, and generic plans miss the obligations that matter most.',
    likelihood: 'HIGH',
    impact: 'MEDIUM',
    when: (ctx) => ctx.stringOf('project.type') === undefined,
    rationale: 'The project type was not answered.',
  },
];

/* -------------------------------------------------------------------------- */
/* Intake lookup                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Reading intake answers, with the state taken seriously.
 *
 * An `UNKNOWN` field has a value in the database — the marker the user chose — and treating that as
 * an answer would let "I don't know" masquerade as a fact. Every accessor below therefore checks the
 * state, not just the presence of a value.
 */
class IntakeLookup {
  private readonly byId: ReadonlyMap<string, IntakeField>;

  constructor(fields: readonly IntakeField[]) {
    this.byId = new Map(fields.map((f) => [f.fieldId, f]));
  }

  field(id: string): IntakeField | undefined {
    return this.byId.get(id);
  }

  /** Answered means the user or the platform committed to a value — not that a row exists. */
  isAnswered(id: string): boolean {
    const field = this.byId.get(id);
    if (field === undefined) return false;
    if (field.value === null || field.value === undefined) return false;
    return field.state === 'CONFIRMED' || field.state === 'PROVIDED' || field.state === 'ASSUMED';
  }

  isTrue(id: string): boolean {
    return this.isAnswered(id) && this.byId.get(id)?.value === true;
  }

  stringOf(id: string): string | undefined {
    if (!this.isAnswered(id)) return undefined;
    const value = this.byId.get(id)?.value;
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  numberOf(id: string): number | undefined {
    if (!this.isAnswered(id)) return undefined;
    const value = this.byId.get(id)?.value;
    return typeof value === 'number' ? value : undefined;
  }

  /** A multi-select answer as a list. Never returns the raw value for an unanswered field. */
  listOf(id: string): readonly string[] {
    if (!this.isAnswered(id)) return [];
    const value = this.byId.get(id)?.value;
    if (!Array.isArray(value)) return [];
    return value.filter((v): v is string => typeof v === 'string');
  }

  listIncludesAny(id: string, candidates: readonly string[]): boolean {
    const values = this.listOf(id);
    return candidates.some((c) => values.includes(c));
  }

  provenanceOf(id: string): NodeProvenance {
    const field = this.byId.get(id);
    if (field === undefined) {
      return { provenance: 'ASSUMPTION', confidence: 'LOW', sourceRef: `intake:${id}` };
    }
    return {
      provenance: field.provenance,
      confidence: field.confidence,
      sourceRef: `intake:${id}`,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Generation                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Build the project graph from intake answers.
 *
 * Pure. Same input, same output, byte for byte — which is what the golden-fixture test asserts.
 */
export function generateProject(input: GenerationInput): GenerationResult {
  const ctx = new IntakeLookup(input.intake);
  const analysis = analyseMissing(input.intake);

  const nodes: TwinNode[] = [];
  const edges: TwinEdge[] = [];
  const assumptions: string[] = [];
  const unknowns: string[] = [];

  /* -- ids ---------------------------------------------------------------- */

  // Derived from a stable path rather than generated. Two runs over the same intake produce the same
  // ids, so the plans are comparable and the change log stays meaningful across regeneration.
  const id = (kind: string, key: string): string => `${input.projectId}:${kind}:${key}`;

  const link = (edgeClass: EdgeClass, from: string, to: string, rationale?: string): void => {
    edges.push({
      id: `${from}->${edgeClass}->${to}`,
      projectId: input.projectId,
      class: edgeClass,
      from,
      to,
      ...(rationale === undefined ? {} : { rationale }),
      createdAt: input.at,
    });
  };

  const engineProvenance: NodeProvenance = {
    provenance: 'DETERMINISTIC_CALCULATION',
    confidence: 'HIGH',
    sourceRef: `generator:${GENERATOR_VERSION}`,
  };

  /* -- the project itself ------------------------------------------------- */

  const projectNodeId = id('project', 'root');
  nodes.push(
    createNode({
      id: projectNodeId,
      projectId: input.projectId,
      class: 'PROJECT',
      label: input.projectName,
      ...(input.projectSummary === undefined ? {} : { description: input.projectSummary }),
      provenance: ctx.provenanceOf('idea.summary'),
      attributes: {
        generatorVersion: GENERATOR_VERSION,
        projectType: ctx.stringOf('project.type') ?? 'UNKNOWN',
      },
      at: input.at,
    }),
  );

  /* -- objectives --------------------------------------------------------- */

  const primaryObjective = ctx.stringOf('objectives.primary');

  if (primaryObjective !== undefined) {
    const objectiveId = id('objective', 'primary');
    nodes.push(
      createNode({
        id: objectiveId,
        projectId: input.projectId,
        class: 'OBJECTIVE',
        label: primaryObjective,
        provenance: ctx.provenanceOf('objectives.primary'),
        at: input.at,
      }),
    );
    link('CONTAINS', projectNodeId, objectiveId);
  } else {
    unknowns.push(
      'No primary objective was recorded, so nothing in the plan can be traced to one.',
    );
  }

  /* -- requirements ------------------------------------------------------- */

  // Declared order, not the order the intake happens to be stored in.
  for (const rule of REQUIREMENT_RULES) {
    if (!rule.when(ctx)) continue;

    const requirementId = id('req', rule.key);
    nodes.push(
      createNode({
        id: requirementId,
        projectId: input.projectId,
        class: 'REQUIREMENT',
        label: rule.label,
        description: rule.description,
        // The requirement is the engine's conclusion; the *fact* it rests on came from the user, and
        // `sourceRef` records which field so the chain stays walkable.
        provenance: {
          provenance: 'DETERMINISTIC_CALCULATION',
          confidence: 'HIGH',
          sourceRef: `intake:${rule.fieldId}`,
        },
        attributes: {
          priority: 'MUST',
          ruleKey: rule.key,
          kind: rule.kind,
          ...(rule.qualityAttribute === undefined
            ? {}
            : { qualityAttribute: rule.qualityAttribute }),
          verification: rule.verification,
          acceptance: rule.acceptance,
          // Duplicated from `provenance.sourceRef` because the traceability model reads attributes
          // rather than provenance: a requirement's *source* and a node's *provenance* answer
          // different questions, and collapsing them would make one of the two lossy.
          sourceRef: `intake:${rule.fieldId}`,
        },
        at: input.at,
      }),
    );
    link('CONTAINS', projectNodeId, requirementId);

    if (primaryObjective !== undefined) {
      link('SATISFIES', requirementId, id('objective', 'primary'), rule.rationale);
    }
  }

  /* -- phases ------------------------------------------------------------- */

  const projectType = ctx.stringOf('project.type');
  const phases =
    projectType === undefined
      ? UNKNOWN_TYPE_PHASES
      : (TYPE_PHASES[projectType] ?? UNKNOWN_TYPE_PHASES);

  if (projectType === undefined) {
    /*
     * Recorded as a node, not only in the summary list.
     *
     * An assumption that exists only in `result.assumptions` never reaches the graph, so it is
     * absent from the plan page, from any export, and from every later traversal — which makes it
     * indistinguishable from a decision nobody had to make. This is the single most consequential
     * assumption the engine makes: the project-type rule pack decides the security, testing and
     * release obligations, and a generic structure quietly omits all of them.
     */
    const statement =
      'The kind of project was not established, so a generic phase structure was used. The security, testing and release obligations that depend on project type are not included.';

    const assumptionId = id('assumption', 'phase-structure');
    nodes.push(
      createNode({
        id: assumptionId,
        projectId: input.projectId,
        class: 'ASSUMPTION',
        label: 'A generic phase structure was used',
        description: statement,
        provenance: {
          provenance: 'ASSUMPTION',
          confidence: 'LOW',
          sourceRef: 'intake:project.type',
        },
        attributes: { fieldId: 'project.type' },
        at: input.at,
      }),
    );
    link('CONTAINS', projectNodeId, assumptionId);

    assumptions.push(statement);
  }

  let previousPhaseId: string | undefined;

  for (const phase of phases) {
    const phaseId = id('phase', phase.key);
    nodes.push(
      createNode({
        id: phaseId,
        projectId: input.projectId,
        class: 'PHASE',
        label: phase.label,
        description: phase.summary,
        provenance: engineProvenance,
        attributes: { phaseKey: phase.key, projectType: projectType ?? 'UNKNOWN' },
        at: input.at,
      }),
    );
    link('CONTAINS', projectNodeId, phaseId);

    // A linear chain, which is honest about what the engine actually knows at this stage. Real
    // parallelism needs capacity and dependency data that arrives in Phases 8 and 9; inventing it
    // here would produce a schedule that looks more considered than it is.
    if (previousPhaseId !== undefined) {
      link(
        'DEPENDS_ON',
        phaseId,
        previousPhaseId,
        'Sequential by default until dependencies are established.',
      );
    }

    // A gate per phase. Plan §7 makes quality gates first-class; a phase that can be declared done
    // with no criterion is a phase that is always done.
    const gateId = id('gate', phase.key);
    nodes.push(
      createNode({
        id: gateId,
        projectId: input.projectId,
        class: 'GATE',
        label: `${phase.label} complete`,
        description: `Criteria that must hold before ${phase.label.toLowerCase()} is considered finished.`,
        provenance: engineProvenance,
        attributes: { result: 'NOT_EVALUATED', phaseKey: phase.key },
        at: input.at,
      }),
    );
    link('CONTAINS', phaseId, gateId);
    link('VERIFIES', gateId, phaseId);

    previousPhaseId = phaseId;
  }

  /* -- risks -------------------------------------------------------------- */

  for (const rule of RISK_RULES) {
    if (!rule.when(ctx)) continue;

    const riskId = id('risk', rule.key);
    nodes.push(
      createNode({
        id: riskId,
        projectId: input.projectId,
        class: 'RISK',
        label: rule.label,
        description: rule.description,
        provenance: engineProvenance,
        attributes: {
          likelihood: rule.likelihood,
          impact: rule.impact,
          ruleKey: rule.key,
          rationale: rule.rationale,
        },
        at: input.at,
      }),
    );
    link('CONTAINS', projectNodeId, riskId);
  }

  /* -- unknowns and assumptions ------------------------------------------- */

  /*
   * Both are first-class nodes, not a footnote.
   *
   * Plan §10 and gap-spec §10: the missing-information engine's output is part of the plan. A plan
   * that silently proceeds past what it does not know produces numbers that look identical to
   * well-founded ones — and that is the specific dishonesty this product exists to avoid.
   */
  for (const item of analysis.critical) {
    if (item.reason !== 'UNANSWERED') continue;

    const unknownId = id('unknown', item.fieldId);
    nodes.push(
      createNode({
        id: unknownId,
        projectId: input.projectId,
        class: 'UNKNOWN',
        label: item.label,
        description: item.rationale,
        provenance: {
          provenance: 'DETERMINISTIC_CALCULATION',
          confidence: 'HIGH',
          sourceRef: `intake:${item.fieldId}`,
        },
        attributes: { fieldId: item.fieldId, importance: 'CRITICAL' },
        at: input.at,
      }),
    );
    link('CONTAINS', projectNodeId, unknownId);
    unknowns.push(item.label);
  }

  for (const field of orderedIntake(input.intake)) {
    if (field.state !== 'ASSUMED') continue;

    const definition = FIELD_DEFINITIONS.find((d) => d.id === field.fieldId);
    const assumptionId = id('assumption', field.fieldId);

    nodes.push(
      createNode({
        id: assumptionId,
        projectId: input.projectId,
        class: 'ASSUMPTION',
        label: definition?.label ?? field.fieldId,
        description: `Assumed: ${formatValue(field.value)}. Nobody has confirmed this.`,
        provenance: {
          provenance: 'ASSUMPTION',
          confidence: field.confidence,
          sourceRef: `intake:${field.fieldId}`,
        },
        attributes: { fieldId: field.fieldId, value: field.value },
        at: input.at,
      }),
    );
    link('CONTAINS', projectNodeId, assumptionId);
    assumptions.push(`${definition?.label ?? field.fieldId}: ${formatValue(field.value)}`);
  }

  return {
    graph: new TwinGraph({ projectId: input.projectId, nodes, edges }),
    generatorVersion: GENERATOR_VERSION,
    assumptions,
    unknowns,
  };
}

/**
 * Intake in a stable order.
 *
 * Sorted by field id rather than taken as supplied. The caller reads answers from a database, and a
 * `SELECT` without `ORDER BY` returns rows in whatever order the engine finds convenient — which is
 * stable in practice and not guaranteed, which is exactly the kind of dependency that produces a
 * generator that is deterministic until the day it is not.
 */
function orderedIntake(fields: readonly IntakeField[]): readonly IntakeField[] {
  return [...fields].sort((a, b) => a.fieldId.localeCompare(b.fieldId));
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'nothing';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return value.toString();
  return JSON.stringify(value);
}
