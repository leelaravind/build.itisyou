/**
 * Deployment, environments and production verification.
 *
 * Two gates live here, and they differ in a way worth stating up front.
 *
 * The **Release Readiness Gate** (§15.8) asks whether the plan exists: is there a deployment plan, a
 * rollback plan, a migration plan, release notes, approvals, monitoring, backups, configuration.
 * Every one of those is a document or a decision, and the platform can check it is present.
 *
 * The **Production Verification Gate** (§15.9) asks whether the thing is actually working in
 * production — availability, TLS, security headers, critical journeys, auth, APIs, monitoring,
 * logging, backup assumptions, deployment identity. The platform **cannot answer any of those**. It
 * can only record what somebody checked and what they kept.
 *
 * That distinction drives the whole design here: an unrecorded production check is `INDETERMINATE`,
 * never `PASSED`. Software that reports its own production as healthy because nobody entered a
 * failure is the exact failure mode this platform exists to argue against, and it is worse in this
 * gate than anywhere else, because this is the gate people cite afterwards.
 *
 * Contract: gap-spec §15.8, §15.9, §51 (backup targets), §52 (degraded mode).
 */

/* -------------------------------------------------------------------------- */
/* Environments                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Environments, ordered.
 *
 * The order is load-bearing: `PRODUCTION` may only be reached from `STAGING`, so a deployment cannot
 * skip a stage. That matches the standing instruction to deploy only through verified stages, and it
 * is checked rather than documented.
 */
export const ENVIRONMENTS = ['LOCAL', 'CI', 'PREVIEW', 'STAGING', 'PRODUCTION'] as const;

export type Environment = (typeof ENVIRONMENTS)[number];

const ENVIRONMENT_INDEX: Readonly<Record<Environment, number>> = {
  LOCAL: 0,
  CI: 1,
  PREVIEW: 2,
  STAGING: 3,
  PRODUCTION: 4,
};

/**
 * Whether a deployment may go straight to this environment given where it has already been.
 *
 * Anything up to `PREVIEW` is reachable freely — those are cheap and reversible. `STAGING` and
 * `PRODUCTION` each require the environment immediately before them, because the point of a stage is
 * that something was learned there.
 */
export function mayPromoteTo(
  target: Environment,
  alreadyDeployedTo: readonly Environment[],
): boolean {
  if (ENVIRONMENT_INDEX[target] <= ENVIRONMENT_INDEX.PREVIEW) return true;

  const previous = ENVIRONMENTS[ENVIRONMENT_INDEX[target] - 1];
  return previous !== undefined && alreadyDeployedTo.includes(previous);
}

/* -------------------------------------------------------------------------- */
/* Release plans                                                              */
/* -------------------------------------------------------------------------- */

export const PLAN_KINDS = [
  'DEPLOYMENT',
  'ROLLBACK',
  'MIGRATION',
  'RELEASE_NOTES',
  'MONITORING',
  'BACKUP',
  'CONFIGURATION',
] as const;

export type PlanKind = (typeof PLAN_KINDS)[number];

/**
 * Why each plan is required, and what its absence actually costs.
 *
 * Stated per plan because "you are missing a rollback plan" is a checklist item and "the decision to
 * roll back will be made under pressure by whoever is awake" is an argument.
 */
export const PLAN_MEANING: Readonly<Record<PlanKind, string>> = {
  DEPLOYMENT:
    'Without it, the steps are in somebody’s head, and the release depends on that person being available.',
  ROLLBACK:
    'Without it, the decision to roll back gets made under pressure, at speed, by whoever is awake — which is when a rollback is most likely to make things worse.',
  MIGRATION:
    'Without it, schema changes and code changes go out with no stated order, and the window where they disagree is unbounded.',
  RELEASE_NOTES:
    'Without them, nobody outside the team can tell what changed, and the first report of a regression arrives without the context that would explain it.',
  MONITORING:
    'Without it, the first person to notice a failure is a user. Availability targets are not met by intending to meet them.',
  BACKUP:
    'Without it, recovery time is unknown, which means the recovery objective is unknown, which means it is not an objective.',
  CONFIGURATION:
    'Without it, production differs from staging in ways nobody has written down, and every difference is a place where testing did not apply.',
};

export interface ReleasePlan {
  readonly kind: PlanKind;
  /** A document or evidence node id. */
  readonly documentId: string;
  /**
   * Whether the plan has been exercised rather than only written.
   *
   * A rollback plan nobody has run is a hypothesis. This distinction is the difference between the
   * Release Readiness Gate being a formality and it being useful.
   */
  readonly rehearsed: boolean;
}

/* -------------------------------------------------------------------------- */
/* Production checks                                                          */
/* -------------------------------------------------------------------------- */

export const PRODUCTION_CHECKS = [
  'AVAILABILITY',
  'TLS',
  'SECURITY_HEADERS',
  'CRITICAL_JOURNEYS',
  'AUTHENTICATION',
  'APIS',
  'MONITORING',
  'LOGGING',
  'BACKUP_RESTORE',
  'DEPLOYMENT_IDENTITY',
] as const;

export type ProductionCheck = (typeof PRODUCTION_CHECKS)[number];

/**
 * The result of a production check.
 *
 * `NOT_CHECKED` is the default and it is **not** a pass. A verification gate that treats silence as
 * success reports a healthy production for a release nobody looked at, which is the most damaging
 * possible false claim in the whole platform: it is the record people cite when something later goes
 * wrong.
 */
export const CHECK_RESULTS = ['PASSED', 'FAILED', 'NOT_CHECKED'] as const;

export type CheckResult = (typeof CHECK_RESULTS)[number];

export interface ProductionCheckRecord {
  readonly check: ProductionCheck;
  readonly result: CheckResult;
  /** Who ran it. A check with no runner cannot be asked about. */
  readonly checkedBy?: string;
  /** ISO timestamp of the run. */
  readonly checkedAt?: string;
  /** Evidence node ids. A passed check with nothing kept is an assertion. */
  readonly evidence: readonly string[];
  readonly notes?: string;
}

export const DEPLOYMENT_DEFECTS = [
  'PLAN_MISSING',
  'ROLLBACK_NOT_REHEARSED',
  'PRODUCTION_CHECK_NOT_RUN',
  'PRODUCTION_CHECK_FAILED',
  'PRODUCTION_CHECK_WITHOUT_EVIDENCE',
  'PROMOTED_WITHOUT_A_STAGE',
  'NO_APPROVAL',
] as const;

export type DeploymentDefect = (typeof DEPLOYMENT_DEFECTS)[number];

export interface DeploymentGap {
  readonly defect: DeploymentDefect;
  readonly summary: string;
  readonly why: string;
  readonly evidence: readonly string[];
  readonly blocking: boolean;
}

export interface DeploymentInput {
  readonly target: Environment;
  readonly alreadyDeployedTo: readonly Environment[];
  readonly plans: readonly ReleasePlan[];
  readonly checks: readonly ProductionCheckRecord[];
  /** Approval node ids. Required for production. */
  readonly approvals: readonly string[];
  /** Which plans this release must have. Decided by rules, not here. */
  readonly requiredPlans: readonly PlanKind[];

  /**
   * Whether to evaluate the production checks now.
   *
   * Separate from `target` on purpose, and the separation was a bug before it was a design. Deriving
   * it from `target === 'PRODUCTION'` conflates two different questions — "is this release destined
   * for production" and "has production been verified" — which made the Release Readiness Gate
   * unpassable: it would demand evidence from a deployment it had not yet authorised. A gate that
   * must fail in order to be reached is not a gate.
   */
  readonly verifyProduction: boolean;
}

export function checkDeployment(input: DeploymentInput): readonly DeploymentGap[] {
  const gaps: DeploymentGap[] = [];
  const toProduction = input.target === 'PRODUCTION';

  const present = new Map(input.plans.map((plan) => [plan.kind, plan]));

  for (const kind of input.requiredPlans) {
    if (present.has(kind)) continue;

    gaps.push({
      defect: 'PLAN_MISSING',
      summary: `No ${kind.toLowerCase().replace(/_/g, ' ')} plan.`,
      why: PLAN_MEANING[kind],
      evidence: [`plan:${kind}`],
      blocking: toProduction,
    });
  }

  const rollback = present.get('ROLLBACK');
  if (rollback !== undefined && !rollback.rehearsed) {
    gaps.push({
      defect: 'ROLLBACK_NOT_REHEARSED',
      summary: 'The rollback plan has never been exercised.',
      why: 'An unrehearsed rollback plan is a hypothesis, and the moment it is needed is the worst possible time to discover which step was wrong.',
      evidence: [rollback.documentId],
      // Not blocking: rehearsing a rollback has a real cost and there are releases where the
      // judgement is defensible. Blocking would make the field get ticked rather than the rehearsal
      // get done, which loses the information entirely.
      blocking: false,
    });
  }

  if (!mayPromoteTo(input.target, input.alreadyDeployedTo)) {
    const previous = ENVIRONMENTS[ENVIRONMENT_INDEX[input.target] - 1];

    gaps.push({
      defect: 'PROMOTED_WITHOUT_A_STAGE',
      summary: `Deploying to ${input.target.toLowerCase()} without having deployed to ${String(previous).toLowerCase()}.`,
      why: 'The point of a stage is that something is learned there. Skipping one does not save the time; it moves the discovery to the environment where it costs most.',
      evidence: [`environment:${input.target}`],
      blocking: true,
    });
  }

  if (toProduction && input.approvals.length === 0) {
    gaps.push({
      defect: 'NO_APPROVAL',
      summary: 'Nobody has approved this release.',
      why: 'Shipping to production is a decision somebody is accountable for. §33 keeps approval separate from task completion precisely so that finishing the work and deciding to release it are two acts.',
      evidence: ['approval:none'],
      blocking: true,
    });
  }

  if (!input.verifyProduction) return gaps;

  const byCheck = new Map(input.checks.map((record) => [record.check, record]));

  for (const check of PRODUCTION_CHECKS) {
    const record = byCheck.get(check);

    if (record === undefined || record.result === 'NOT_CHECKED') {
      gaps.push({
        defect: 'PRODUCTION_CHECK_NOT_RUN',
        summary: `${label(check)} has not been checked in production.`,
        why: 'This platform cannot observe production. An unrecorded check is unknown, never passed — reporting silence as success would make this gate say a release was verified when nobody looked, which is the claim people cite afterwards.',
        evidence: [`check:${check}`],
        blocking: true,
      });
      continue;
    }

    if (record.result === 'FAILED') {
      gaps.push({
        defect: 'PRODUCTION_CHECK_FAILED',
        summary: `${label(check)} failed in production.`,
        why: record.notes ?? 'Recorded as failed by whoever ran it.',
        evidence: [`check:${check}`, ...record.evidence],
        blocking: true,
      });
      continue;
    }

    if (record.evidence.length === 0) {
      gaps.push({
        defect: 'PRODUCTION_CHECK_WITHOUT_EVIDENCE',
        summary: `${label(check)} passed with nothing kept.`,
        why: 'A production check with no artefact cannot be distinguished later from one nobody ran. The evidence is the whole difference between a verification gate and a checklist.',
        evidence: [`check:${check}`],
        blocking: false,
      });
    }
  }

  return gaps;
}

function label(check: ProductionCheck): string {
  const words = check.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
