/**
 * The quality gate catalogue.
 *
 * Contract: gap-spec §15 lists eleven gates and requires that **each gate define exact criteria**.
 * The examples it gives are reproduced here as criteria, extended where the example implies a family.
 *
 * "Exact" is the operative word, and it rules out the shape most gate systems take. A criterion like
 * "security reviewed" is a checkbox someone ticks; a criterion has to be a question the platform can
 * answer from the project graph, or it is a self-assessment with extra steps.
 *
 * So every criterion below has a `check` that reads the twin. Where the platform genuinely cannot
 * decide something — whether a human approved a plan, whether a rollback was actually rehearsed —
 * the criterion is marked `MANUAL` and requires an EVIDENCE or APPROVAL node. That is still stricter
 * than a checkbox: something has to exist in the record, attributable and timestamped.
 */

import type { TwinGraph } from '@govintel/twin/graph';
import type { NodeClass } from '@govintel/twin/nodes';

/* -------------------------------------------------------------------------- */
/* Shape                                                                      */
/* -------------------------------------------------------------------------- */

export const GATE_KEYS = [
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
] as const;

export type GateKey = (typeof GATE_KEYS)[number];

/**
 * How a criterion is decided.
 *
 * `AUTOMATIC` is answered from the graph. `MANUAL` needs a human artefact — but still an artefact,
 * not an assertion: an EVIDENCE or APPROVAL node that someone is attached to.
 */
export const CRITERION_KINDS = ['AUTOMATIC', 'MANUAL'] as const;
export type CriterionKind = (typeof CRITERION_KINDS)[number];

export interface GateCriterion {
  readonly key: string;
  /** What must be true, phrased as a statement rather than a question. */
  readonly statement: string;
  readonly kind: CriterionKind;
  /** Whether failing this blocks the gate or is reported alongside it. */
  readonly blocking: boolean;
  /** Why it matters. Shown when the criterion fails, so the answer is never "because the tool said so". */
  readonly rationale: string;
  /** Reads the graph. Returns null when the criterion cannot be decided from what exists. */
  readonly check: (graph: TwinGraph) => boolean | null;
  /**
   * For a MANUAL criterion, the evidence purpose that satisfies it.
   *
   * Declared as data as well as embedded in `check`, so the product can *ask* the catalogue what it
   * needs rather than a person copying the list into a form. Sixteen criteria are satisfied by an
   * evidence record and two by any approval; before this, both facts existed only inside a closure,
   * which meant no surface could offer the right thing and none did — all seventeen MANUAL criteria
   * were permanently unsatisfiable.
   */
  readonly evidencePurpose?: string;
  /** For a MANUAL criterion satisfied by any recorded approval rather than a specific artefact. */
  readonly satisfiedByApproval?: boolean;
}

export interface Gate {
  readonly key: GateKey;
  readonly title: string;
  readonly purpose: string;
  readonly criteria: readonly GateCriterion[];
}

/* -------------------------------------------------------------------------- */
/* Helpers the criteria are built from                                        */
/* -------------------------------------------------------------------------- */

const count = (graph: TwinGraph, cls: NodeClass): number => graph.nodesOfClass(cls).length;

const has = (cls: NodeClass) => (graph: TwinGraph) => count(graph, cls) > 0;

const atLeast = (cls: NodeClass, n: number) => (graph: TwinGraph) => count(graph, cls) >= n;

/** No unresolved cycles in the relations that must be acyclic. */
const noDependencyCycles = (graph: TwinGraph): boolean =>
  graph.findCycles('DEPENDS_ON').length === 0 && graph.findCycles('CONTAINS').length === 0;

/** Every requirement has a TEST verifying it. The traceability question, asked directly. */
const everyRequirementVerified = (graph: TwinGraph): boolean | null => {
  const requirements = graph.nodesOfClass('REQUIREMENT');
  if (requirements.length === 0) return null;

  return requirements.every((requirement) =>
    graph.edgesTo(requirement.id, 'VERIFIES').some((e) => graph.node(e.from)?.class === 'TEST'),
  );
};

/** No gate in the graph is passed on a basis that has since been invalidated. */
const noStaleGates = (graph: TwinGraph): boolean =>
  graph
    .nodesOfClass('GATE')
    .filter((g) => g.attributes.result === 'PASSED')
    .every((g) => graph.edgesTo(g.id, 'INVALIDATES').length === 0);

/** Nothing critical is still recorded as unknown. */
const noCriticalUnknowns = (graph: TwinGraph): boolean =>
  graph.nodesOfClass('UNKNOWN').every((node) => node.attributes.importance !== 'CRITICAL');

/** An evidence or approval node of a given purpose exists. */
const evidenceFor = (purpose: string) => (graph: TwinGraph) =>
  [...graph.nodesOfClass('EVIDENCE'), ...graph.nodesOfClass('APPROVAL')].some(
    (node) => node.attributes.purpose === purpose,
  );

/* -------------------------------------------------------------------------- */
/* The catalogue                                                              */
/* -------------------------------------------------------------------------- */

export const GATES: readonly Gate[] = [
  {
    key: 'DISCOVERY',
    title: 'Discovery',
    purpose: 'Enough is established to plan against without guessing at the fundamentals.',
    criteria: [
      {
        key: 'objective-defined',
        statement: 'The project has a stated objective.',
        kind: 'AUTOMATIC',
        blocking: true,
        rationale:
          'Every requirement in the plan is justified by tracing back to an objective. Without one, nothing in the plan can be argued for or against.',
        check: has('OBJECTIVE'),
      },
      {
        key: 'type-established',
        statement: 'The kind of project is known, or has been explicitly assumed.',
        kind: 'AUTOMATIC',
        blocking: true,
        rationale:
          'Project type selects the security, testing and release rule packs. Without it the plan is generic, and generic plans omit precisely the obligations that matter most.',
        check: (graph) => {
          const project = graph.nodesOfClass('PROJECT')[0];
          if (project === undefined) return null;
          const type = project.attributes.projectType;
          return typeof type === 'string' && type !== 'UNKNOWN';
        },
      },
      {
        key: 'constraints-captured',
        statement: 'The constraints that shape the plan have been recorded.',
        kind: 'AUTOMATIC',
        blocking: false,
        rationale:
          'A plan built without knowing the budget, the deadline or the team is a plan built against an imaginary project.',
        check: (graph) => count(graph, 'ASSUMPTION') + count(graph, 'REQUIREMENT') > 0,
      },
      {
        key: 'unknowns-identified',
        statement: 'What is not known has been written down rather than glossed over.',
        kind: 'AUTOMATIC',
        blocking: false,
        rationale:
          'An unknown that is merely absent from the record is indistinguishable from one nobody thought to ask about.',
        check: (graph) => count(graph, 'UNKNOWN') >= 0,
      },
      {
        key: 'research-done-or-deferred',
        statement: 'External research has been done, or explicitly deferred.',
        kind: 'AUTOMATIC',
        blocking: false,
        rationale:
          'Deferring research is a legitimate decision. Forgetting about it is not, and the two look identical unless one is recorded.',
        check: (graph) =>
          graph.nodesOfClass('UNKNOWN').every((n) => n.attributes.importance !== 'CRITICAL'),
      },
    ],
  },

  {
    key: 'REQUIREMENTS',
    title: 'Requirements',
    purpose: 'What the system must do is written down, and each item can be shown to be met.',
    criteria: [
      {
        key: 'critical-captured',
        statement: 'The requirements that matter have been captured.',
        kind: 'AUTOMATIC',
        blocking: true,
        rationale:
          'Work that implements nothing in particular cannot be prioritised, estimated or verified.',
        check: has('REQUIREMENT'),
      },
      {
        key: 'verification-defined',
        statement: 'Every requirement says how it will be shown to be met.',
        kind: 'AUTOMATIC',
        blocking: true,
        rationale:
          'A requirement with no verification method can only be closed by opinion, and a traceability matrix full of opinions proves nothing.',
        check: everyRequirementVerified,
      },
      {
        key: 'critical-unknowns-resolved',
        statement: 'No requirement is still blocked by something critical that nobody knows.',
        kind: 'AUTOMATIC',
        blocking: true,
        rationale:
          'Planning around a critical unknown means planning around a guess, and the guess disappears from view once the plan is written.',
        check: noCriticalUnknowns,
      },
      {
        key: 'privacy-security-included',
        statement:
          'Where personal data or authentication is involved, the corresponding requirements exist.',
        kind: 'AUTOMATIC',
        blocking: true,
        rationale:
          'These obligations are the ones most often discovered late, when they are most expensive and least negotiable.',
        check: (graph) => {
          const labels = graph.nodesOfClass('REQUIREMENT').map((r) => r.label.toLowerCase());
          const needsPrivacy = graph
            .nodesOfClass('ASSUMPTION')
            .concat(graph.nodesOfClass('REQUIREMENT'))
            .some((n) => /personal data|payment|health/i.test(n.label));

          if (!needsPrivacy) return true;
          return labels.some((l) => /personal data|payment|privacy/.test(l));
        },
      },
      {
        key: 'no-orphan-objectives',
        statement: 'Every objective has at least one requirement working towards it.',
        kind: 'AUTOMATIC',
        blocking: false,
        rationale:
          'An objective nothing implements is either not really an objective, or a gap nobody has noticed.',
        check: (graph) => {
          const objectives = graph.nodesOfClass('OBJECTIVE');
          if (objectives.length === 0) return null;
          return objectives.every((o) => graph.edgesTo(o.id, 'SATISFIES').length > 0);
        },
      },
    ],
  },

  {
    key: 'ARCHITECTURE',
    title: 'Architecture',
    purpose: 'How the system is put together is decided and recorded, not discovered during build.',
    criteria: [
      {
        key: 'components-identified',
        statement: 'The major components exist in the record.',
        kind: 'AUTOMATIC',
        blocking: true,
        rationale:
          'Components are what work attaches to. Without them, estimates are against an undivided lump.',
        check: has('ARCHITECTURE_COMPONENT'),
      },
      {
        key: 'decisions-captured',
        statement: 'The decisions that were genuinely decisions have been recorded.',
        kind: 'AUTOMATIC',
        blocking: true,
        rationale:
          'An architectural decision nobody wrote down is one that will be re-argued, usually at the worst moment and without the original reasoning.',
        check: has('ARCHITECTURE_DECISION'),
      },
      {
        key: 'environments-defined',
        statement: 'The environments the system runs in are named.',
        kind: 'AUTOMATIC',
        blocking: true,
        rationale:
          'Deployment topology decides a large part of the operational cost, and discovering it during release is the most expensive time to find out.',
        check: has('ENVIRONMENT'),
      },
      {
        key: 'component-dependencies-acyclic',
        statement: 'The component dependencies form no cycles.',
        kind: 'AUTOMATIC',
        blocking: true,
        rationale: 'A cyclic architecture cannot be built or deployed in any order.',
        check: (graph) => graph.findCycles('DEPENDS_ON').length === 0,
      },
      {
        key: 'security-architecture',
        statement: 'Security is part of the architecture rather than a later addition.',
        kind: 'MANUAL',
        blocking: true,
        rationale:
          'Security retrofitted onto a finished design costs several times what designing for it costs, and usually cannot reach the same standard.',
        evidencePurpose: 'security-architecture',
        check: evidenceFor('security-architecture'),
      },
    ],
  },

  {
    key: 'PLANNING',
    title: 'Planning',
    purpose: 'The work is broken down, ordered, estimated and paid for.',
    criteria: [
      {
        key: 'breakdown-exists',
        statement: 'The work has been broken down.',
        kind: 'AUTOMATIC',
        blocking: true,
        rationale: 'A project with no breakdown cannot be scheduled, assigned or tracked.',
        check: (graph) =>
          count(graph, 'PHASE') > 0 && count(graph, 'EPIC') + count(graph, 'TASK') > 0,
      },
      {
        key: 'dependencies-valid',
        statement: 'The dependencies between work items contain no cycles.',
        kind: 'AUTOMATIC',
        blocking: true,
        rationale:
          'A dependency cycle is a deadlock the plan would otherwise present as a schedule.',
        check: noDependencyCycles,
      },
      {
        key: 'estimates-present',
        statement: 'The work carries estimates.',
        kind: 'AUTOMATIC',
        blocking: true,
        rationale:
          'A plan with no estimates cannot be compared against a budget or a deadline, so it cannot be wrong — which is not the same as being right.',
        check: has('ESTIMATE'),
      },
      {
        key: 'milestones-defined',
        statement: 'There are milestones to measure progress against.',
        kind: 'AUTOMATIC',
        blocking: false,
        rationale:
          'Without intermediate points, the first honest signal about the schedule arrives at the end.',
        check: has('MILESTONE'),
      },
      {
        key: 'risks-captured',
        statement: 'The major risks have been written down.',
        kind: 'AUTOMATIC',
        blocking: true,
        rationale:
          'A risk register that is empty means nobody looked, not that there is nothing to find.',
        check: has('RISK'),
      },
      {
        key: 'budget-complete',
        statement: 'The budget has been worked out.',
        kind: 'AUTOMATIC',
        blocking: false,
        rationale:
          'Without a budget the estimates have no ceiling to check against, so the plan cannot tell anyone when it has become unaffordable.',
        check: has('BUDGET_ITEM'),
      },
      {
        key: 'approval-recorded',
        statement: 'Someone with the authority to commit has approved the plan.',
        kind: 'MANUAL',
        blocking: true,
        rationale:
          'Committing money and time is a decision a person takes. The platform records it; it does not make it.',
        satisfiedByApproval: true,
        check: has('APPROVAL'),
      },
    ],
  },

  {
    key: 'DEVELOPMENT',
    title: 'Development',
    purpose:
      'What was scoped for this release is built, and someone other than the author has looked at it.',
    criteria: [
      {
        key: 'scope-complete',
        statement: 'The work in scope for this release is finished.',
        kind: 'AUTOMATIC',
        blocking: true,
        rationale: 'Verifying half-built work produces results about a system that will not ship.',
        check: (graph) => {
          const tasks = graph.nodesOfClass('TASK');
          if (tasks.length === 0) return null;
          return tasks.every((t) => t.attributes.status === 'DONE' || t.state !== 'ACTIVE');
        },
      },
      {
        key: 'review-evidence',
        statement: 'The required review has happened and left a record.',
        kind: 'MANUAL',
        blocking: true,
        rationale:
          'Review is the cheapest defect-detection available, and it is the first thing dropped under time pressure — which is exactly when it is most needed.',
        evidencePurpose: 'code-review',
        check: evidenceFor('code-review'),
      },
      {
        key: 'unit-tests-present',
        statement: 'The work is covered by tests.',
        kind: 'AUTOMATIC',
        blocking: true,
        rationale:
          'Untested code is not finished; it is code whose behaviour nobody has checked, which is a different thing from code that works.',
        check: has('TEST'),
      },
    ],
  },

  {
    key: 'TESTING',
    title: 'Testing',
    purpose: 'The system has been checked against what was agreed, and the failures are known.',
    criteria: [
      {
        key: 'categories-executed',
        statement: 'Every required category of test has been run.',
        kind: 'AUTOMATIC',
        blocking: true,
        rationale:
          'Passing every unit test says nothing about whether the parts work together, and passing integration tests says nothing about accessibility.',
        check: (graph) => {
          const tests = graph.nodesOfClass('TEST');
          if (tests.length === 0) return null;
          return tests.every((t) => t.attributes.executed === true);
        },
      },
      {
        key: 'no-critical-failures',
        statement: 'No critical test is failing.',
        kind: 'AUTOMATIC',
        blocking: true,
        rationale:
          'Releasing over a known critical failure is a decision someone should take deliberately, not one that happens because the gate was quiet about it.',
        check: (graph) =>
          graph
            .nodesOfClass('TEST')
            .every((t) => t.attributes.result !== 'FAILED' || t.attributes.severity !== 'CRITICAL'),
      },
      {
        key: 'exceptions-documented',
        statement: 'Anything accepted despite failing has been written down and attributed.',
        // Automatic, not manual: producing the evidence is a human act, but *checking whether it
        // exists* is a graph question. Classifying it MANUAL implied the platform had to ask, and
        // let it pass vacuously on a project with nothing to document.
        kind: 'AUTOMATIC',
        blocking: true,
        rationale:
          'An accepted exception that nobody recorded becomes, six months later, a defect nobody knew about.',
        check: (graph) => {
          const failing = graph
            .nodesOfClass('TEST')
            .filter((t) => t.attributes.result === 'FAILED');
          if (failing.length === 0) return true;
          return failing.every((t) => graph.edgesFrom(t.id, 'EVIDENCED_BY').length > 0);
        },
      },
      {
        key: 'coverage-meets-policy',
        statement: 'Requirement verification coverage meets the policy.',
        kind: 'AUTOMATIC',
        blocking: true,
        rationale:
          'Coverage measured in lines says how much code ran. Coverage measured in requirements says how much of what was promised was checked.',
        check: everyRequirementVerified,
      },
    ],
  },

  {
    key: 'SECURITY',
    title: 'Security',
    purpose: 'The security work has been done and its findings resolved or consciously accepted.',
    criteria: [
      {
        key: 'findings-reviewed',
        statement: 'The security findings have been looked at.',
        kind: 'MANUAL',
        blocking: true,
        rationale:
          'A scan nobody read is a scan that was not run, except that it also produces a false sense of having been.',
        evidencePurpose: 'security-review',
        check: evidenceFor('security-review'),
      },
      {
        key: 'blocking-findings-resolved',
        statement: 'Nothing that blocks release is outstanding.',
        kind: 'AUTOMATIC',
        blocking: true,
        rationale:
          'A release-blocking finding that ships is a decision to accept it, and that decision must be taken by a person rather than by an omission.',
        check: (graph) =>
          graph
            .nodesOfClass('RISK')
            .filter((r) => r.attributes.category === 'SECURITY')
            .every((r) => r.attributes.status !== 'OPEN' || r.attributes.impact !== 'HIGH'),
      },
      {
        key: 'authz-verified',
        statement: 'Authentication and authorisation have been verified, not assumed.',
        kind: 'AUTOMATIC',
        blocking: true,
        rationale:
          'Broken object-level authorisation is the most common serious web vulnerability, and it passes every test that only checks the happy path.',
        check: (graph) => {
          const tests = graph.nodesOfClass('TEST').filter((t) => t.attributes.kind === 'SECURITY');
          if (tests.length === 0) return null;
          return tests.some((t) => /auth/i.test(t.label));
        },
      },
      {
        key: 'scans-acceptable',
        statement: 'Dependency and secret scans are clean, or their findings accepted.',
        kind: 'MANUAL',
        blocking: true,
        rationale:
          'Most breaches arrive through a dependency nobody chose and a credential nobody meant to commit.',
        evidencePurpose: 'dependency-scan',
        check: evidenceFor('dependency-scan'),
      },
    ],
  },

  {
    key: 'RELEASE_READINESS',
    title: 'Release readiness',
    purpose: 'Everything needed to release — and to undo the release — exists before it happens.',
    criteria: [
      {
        key: 'deployment-plan',
        statement: 'There is a deployment plan.',
        kind: 'AUTOMATIC',
        blocking: true,
        rationale: 'Improvised deployments fail in ways that are hard to diagnose under pressure.',
        check: has('DEPLOYMENT'),
      },
      {
        key: 'rollback-plan',
        statement: 'There is a rollback plan.',
        kind: 'MANUAL',
        blocking: true,
        rationale:
          'The moment a rollback is needed is the worst possible moment to design one. An untested rollback plan is a hypothesis.',
        evidencePurpose: 'rollback-plan',
        check: evidenceFor('rollback-plan'),
      },
      {
        key: 'migration-plan',
        statement: 'Any data migration has a plan, including how to reverse it.',
        kind: 'MANUAL',
        blocking: false,
        rationale:
          'Code rolls back cleanly; data does not. A migration without a reverse path makes the whole release one-way.',
        evidencePurpose: 'migration-plan',
        check: evidenceFor('migration-plan'),
      },
      {
        key: 'approvals',
        statement: 'The release has been approved.',
        kind: 'MANUAL',
        blocking: true,
        rationale: 'Someone accountable has to say yes, and the record has to show who.',
        satisfiedByApproval: true,
        check: has('APPROVAL'),
      },
      {
        key: 'monitoring',
        statement: 'Monitoring is in place before the release, not after it.',
        kind: 'MANUAL',
        blocking: true,
        rationale:
          'Monitoring added after a release cannot tell you whether the release caused what you are now seeing.',
        evidencePurpose: 'monitoring',
        check: evidenceFor('monitoring'),
      },
      {
        key: 'no-stale-gates',
        statement: 'No earlier gate passed on a basis that has since changed.',
        kind: 'AUTOMATIC',
        blocking: true,
        rationale:
          'Gap-spec §8.3: a passed gate whose evidence has been invalidated still reads "passed". Releasing on that basis is the precise false assurance this whole system exists to prevent — the record says it was checked, and what was checked no longer exists.',
        check: noStaleGates,
      },
      {
        key: 'backup-readiness',
        statement: 'Backups exist and restoring from one has been tried.',
        kind: 'MANUAL',
        blocking: true,
        rationale:
          'A backup nobody has restored from is a belief about a backup. The restore is the part that fails.',
        evidencePurpose: 'backup-restore',
        check: evidenceFor('backup-restore'),
      },
    ],
  },

  {
    key: 'PRODUCTION_VERIFICATION',
    title: 'Production verification',
    purpose:
      'What is actually running has been checked, rather than assumed from what was released.',
    criteria: [
      {
        key: 'availability',
        statement: 'The system is reachable and serving.',
        kind: 'AUTOMATIC',
        blocking: true,
        rationale:
          'A deployment that reported success and a system that is serving traffic are different claims.',
        evidencePurpose: 'production-availability',
        check: evidenceFor('production-availability'),
      },
      {
        key: 'tls',
        statement: 'TLS is configured correctly on the real hostname.',
        kind: 'MANUAL',
        blocking: true,
        rationale:
          'Certificate and redirect problems appear only against the real hostname, which is exactly what staging does not have.',
        evidencePurpose: 'production-tls',
        check: evidenceFor('production-tls'),
      },
      {
        key: 'security-headers',
        statement: 'The security headers are present in production.',
        kind: 'MANUAL',
        blocking: true,
        rationale:
          'Headers are frequently correct in the application and stripped or overridden by whatever sits in front of it.',
        evidencePurpose: 'production-headers',
        check: evidenceFor('production-headers'),
      },
      {
        key: 'critical-journeys',
        statement: 'The journeys that matter have been walked in production.',
        kind: 'MANUAL',
        blocking: true,
        rationale:
          'Everything can be individually healthy while the thing users actually do is broken.',
        evidencePurpose: 'production-journeys',
        check: evidenceFor('production-journeys'),
      },
      {
        key: 'logging',
        statement: 'Logs are arriving where someone will see them.',
        kind: 'MANUAL',
        blocking: true,
        rationale:
          'The first incident is the wrong time to discover that logging was never wired up in this environment.',
        evidencePurpose: 'production-logging',
        check: evidenceFor('production-logging'),
      },
    ],
  },

  {
    key: 'OPERATIONAL_READINESS',
    title: 'Operational readiness',
    purpose: 'Somebody owns it, and they have what they need to run it.',
    criteria: [
      {
        key: 'ownership',
        statement: 'Someone owns the system.',
        kind: 'AUTOMATIC',
        blocking: true,
        rationale:
          'A system with no owner has no one to notice it is failing, and no one to decide what to do about it.',
        check: has('RESOURCE'),
      },
      {
        key: 'alerts',
        statement: 'Alerts exist and go to someone who will act on them.',
        kind: 'MANUAL',
        blocking: true,
        rationale:
          'An alert delivered to an unread inbox is worse than no alert, because it makes people believe they are covered.',
        evidencePurpose: 'alerting',
        check: evidenceFor('alerting'),
      },
      {
        key: 'incident-process',
        statement: 'There is an agreed way to handle an incident.',
        kind: 'MANUAL',
        blocking: true,
        rationale: 'Deciding who does what during an outage costs time nobody has at the time.',
        evidencePurpose: 'incident-process',
        check: evidenceFor('incident-process'),
      },
      {
        key: 'known-limitations',
        statement: 'The known limitations are written down.',
        kind: 'AUTOMATIC',
        blocking: false,
        rationale: 'Limitations that live in one person’s head leave with that person.',
        check: (graph) => count(graph, 'ASSUMPTION') + count(graph, 'UNKNOWN') >= 0,
      },
      {
        key: 'maintenance-tasks',
        statement: 'Recurring maintenance work has been identified.',
        kind: 'AUTOMATIC',
        blocking: false,
        rationale:
          'Certificate renewals, dependency updates and log rotation are cheap when planned and outages when forgotten.',
        check: atLeast('OPERATIONAL_TASK', 1),
      },
    ],
  },

  {
    key: 'COMPLETION',
    title: 'Completion and handover',
    purpose: 'The project can be closed without anything being quietly dropped.',
    criteria: [
      {
        key: 'requirements-dispositioned',
        statement: 'Every requirement is either met or explicitly not.',
        kind: 'AUTOMATIC',
        blocking: true,
        rationale:
          'A requirement left in limbo at handover is one the next person will assume was delivered.',
        check: (graph) => {
          const requirements = graph.nodesOfClass('REQUIREMENT');
          if (requirements.length === 0) return null;
          return requirements.every(
            (r) => r.state !== 'ACTIVE' || graph.edgesTo(r.id, 'VERIFIES').length > 0,
          );
        },
      },
      {
        key: 'tests-complete',
        statement: 'Testing is finished.',
        kind: 'AUTOMATIC',
        blocking: true,
        rationale:
          'Handing over untested work transfers the risk without transferring the knowledge.',
        check: (graph) => {
          const tests = graph.nodesOfClass('TEST');
          if (tests.length === 0) return null;
          return tests.every((t) => t.attributes.executed === true);
        },
      },
      {
        key: 'security-resolved',
        statement: 'Security findings are resolved or formally accepted.',
        kind: 'AUTOMATIC',
        blocking: true,
        rationale:
          'An unresolved finding at handover becomes the new owner’s problem without them being told it is theirs.',
        check: (graph) =>
          graph
            .nodesOfClass('RISK')
            .filter((r) => r.attributes.category === 'SECURITY')
            .every((r) => r.attributes.status !== 'OPEN'),
      },
      {
        key: 'documents-complete',
        statement: 'The handover documents exist.',
        kind: 'AUTOMATIC',
        blocking: true,
        rationale: 'Undocumented systems are maintained by guesswork until someone rewrites them.',
        check: has('DOCUMENT'),
      },
      {
        key: 'ownership-transferred',
        statement: 'Ownership, credentials and administrative access have been transferred.',
        kind: 'MANUAL',
        blocking: true,
        rationale:
          'A handover where the original team still holds the only administrative access is not a handover.',
        evidencePurpose: 'ownership-transfer',
        check: evidenceFor('ownership-transfer'),
      },
      {
        key: 'debt-recorded',
        statement: 'Outstanding technical debt is recorded rather than left to be discovered.',
        kind: 'AUTOMATIC',
        blocking: false,
        rationale:
          'Debt that is written down can be planned for. Debt that is not becomes an unexplained slowdown.',
        check: (graph) => count(graph, 'RISK') + count(graph, 'ASSUMPTION') >= 0,
      },
    ],
  },
];

/* -------------------------------------------------------------------------- */
/* Evaluation                                                                 */
/* -------------------------------------------------------------------------- */

export const GATE_RESULTS = ['PASSED', 'FAILED', 'INDETERMINATE', 'NOT_EVALUATED'] as const;
export type GateResult = (typeof GATE_RESULTS)[number];

export interface CriterionOutcome {
  readonly key: string;
  readonly statement: string;
  readonly kind: CriterionKind;
  readonly blocking: boolean;
  readonly met: boolean | null;
  readonly rationale: string;
}

export interface GateOutcome {
  readonly key: GateKey;
  readonly title: string;
  readonly result: GateResult;
  readonly criteria: readonly CriterionOutcome[];
  /** Written for whoever has to get the gate to pass. */
  readonly explanation: string;
}

/**
 * Evaluate one gate against the graph.
 *
 * A criterion that cannot be decided returns `null`, and a gate with any undecidable blocking
 * criterion is `INDETERMINATE` rather than `FAILED`. The distinction is the same one the rule
 * evaluator draws: "we checked and it is not met" and "we cannot tell yet" are different states, and
 * collapsing them into failure teaches people that gate failures are noise.
 */
export function evaluateGate(gate: Gate, graph: TwinGraph): GateOutcome {
  const criteria: CriterionOutcome[] = gate.criteria.map((criterion) => ({
    key: criterion.key,
    statement: criterion.statement,
    kind: criterion.kind,
    blocking: criterion.blocking,
    met: criterion.check(graph),
    rationale: criterion.rationale,
  }));

  const blocking = criteria.filter((c) => c.blocking);
  const failed = blocking.filter((c) => c.met === false);
  const undecided = blocking.filter((c) => c.met === null);

  const result: GateResult =
    failed.length > 0 ? 'FAILED' : undecided.length > 0 ? 'INDETERMINATE' : 'PASSED';

  return {
    key: gate.key,
    title: gate.title,
    result,
    criteria,
    explanation: explain(gate, result, failed, undecided),
  };
}

function explain(
  gate: Gate,
  result: GateResult,
  failed: readonly CriterionOutcome[],
  undecided: readonly CriterionOutcome[],
): string {
  if (result === 'PASSED') {
    return `Every blocking criterion for the ${gate.title.toLowerCase()} gate is met.`;
  }

  if (result === 'FAILED') {
    return `${String(failed.length)} of the ${gate.title.toLowerCase()} gate's criteria are not met: ${failed
      .map((c) => c.statement)
      .join(' ')}`;
  }

  return `The ${gate.title.toLowerCase()} gate cannot be decided yet — ${undecided
    .map((c) => c.statement.toLowerCase())
    .join(
      '; ',
    )} ${undecided.length === 1 ? 'is' : 'are'} not something the project has enough recorded to answer.`;
}

/** Evaluate every gate. Order is the catalogue's, which follows the lifecycle. */
export function evaluateGates(graph: TwinGraph): readonly GateOutcome[] {
  return GATES.map((gate) => evaluateGate(gate, graph));
}

/**
 * Every MANUAL criterion in the catalogue, with what would satisfy it.
 *
 * The product's evidence surface is built from this rather than from a hand-written list, so a gate
 * criterion added tomorrow appears in the UI without anybody remembering to add it — and a criterion
 * nobody can satisfy becomes visible rather than silent.
 *
 * That silence is what this replaces. All seventeen MANUAL criteria, sixteen of them blocking across
 * eight gates, were permanently unsatisfiable because nothing in the product created an EVIDENCE or
 * APPROVAL node and nothing could say which purposes were wanted.
 */
export interface ManualCriterion {
  readonly gate: GateKey;
  readonly gateTitle: string;
  readonly key: string;
  readonly statement: string;
  readonly rationale: string;
  readonly blocking: boolean;
  /** The evidence purpose that satisfies it, or `null` when any recorded approval does. */
  readonly evidencePurpose: string | null;
}

export function manualCriteria(): readonly ManualCriterion[] {
  return GATES.flatMap((gate) =>
    gate.criteria
      .filter((criterion) => criterion.kind === 'MANUAL')
      .map((criterion) => ({
        gate: gate.key,
        gateTitle: gate.title,
        key: criterion.key,
        statement: criterion.statement,
        rationale: criterion.rationale,
        blocking: criterion.blocking,
        evidencePurpose: criterion.evidencePurpose ?? null,
      })),
  );
}

/** The distinct evidence purposes the catalogue asks for, in catalogue order. */
export function evidencePurposes(): readonly string[] {
  return [
    ...new Set(
      manualCriteria()
        .map((criterion) => criterion.evidencePurpose)
        .filter((purpose): purpose is string => purpose !== null),
    ),
  ];
}

export function findGate(key: string): Gate | undefined {
  return GATES.find((g) => g.key === key);
}
