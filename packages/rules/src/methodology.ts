/**
 * The methodology engine.
 *
 * Contract: gap-spec §16 — "The product cannot hardcode one delivery method." Five methodologies are
 * supported in V1, and each affects decomposition, milestone structure, iteration boundaries, gate
 * placement, planning cadence and change handling.
 *
 * The sentence that constrains everything here is the last one in §16: **"Methodology must not bypass
 * mandatory security/release gates."**
 *
 * That is the distinction the whole file rests on. A methodology decides *how work is organised* —
 * how it is sliced, when it is reviewed, how change is handled. It does not decide *which obligations
 * apply*. Conflating the two is the most common way a lighter process becomes a lighter standard, and
 * it happens gradually: dropping a ceremony, then a review, then a gate, each justified by the
 * methodology rather than by anyone deciding the check was unnecessary.
 *
 * So methodology here can move a gate, change what triggers it, and change how often it runs. It
 * cannot remove one.
 */

import { GATES, type GateKey } from './gates.ts';

export const METHODOLOGIES = ['AGILE', 'KANBAN', 'WATERFALL', 'HYBRID', 'SOLO'] as const;
export type Methodology = (typeof METHODOLOGIES)[number];

const METHODOLOGY_SET: ReadonlySet<string> = new Set<string>(METHODOLOGIES);

export function isMethodology(value: string): value is Methodology {
  return METHODOLOGY_SET.has(value);
}

/* -------------------------------------------------------------------------- */
/* What a methodology decides                                                 */
/* -------------------------------------------------------------------------- */

/** How work is sliced. */
export type DecompositionStyle = 'ITERATION' | 'CONTINUOUS_FLOW' | 'PHASE' | 'MIXED';

/** When gates run. */
export type GateCadence = 'PER_ITERATION' | 'CONTINUOUS' | 'PER_PHASE' | 'PER_RELEASE';

export interface MethodologyProfile {
  readonly key: Methodology;
  readonly label: string;
  readonly summary: string;

  readonly decomposition: DecompositionStyle;
  readonly gateCadence: GateCadence;

  /** Iteration length in days, where the methodology has iterations. */
  readonly iterationDays?: number;

  /** Whether milestones follow iterations, phases or are set independently. */
  readonly milestoneBasis: 'ITERATION' | 'PHASE' | 'OUTCOME';

  /** How a change to agreed scope is handled. */
  readonly changeHandling: string;

  /** How planning is refreshed. */
  readonly planningCadence: string;

  /**
   * Gates this methodology runs more often than once.
   *
   * Never fewer. A methodology may bring a gate forward or repeat it; it may not skip one.
   */
  readonly repeatedGates: readonly GateKey[];

  /** What this methodology is good at, and what it is bad at. Both, honestly. */
  readonly suitedTo: string;
  readonly poorlySuitedTo: string;
}

/**
 * The five supported methodologies.
 *
 * Each entry states what it is *bad* at as well as what it is good at. A tool that presents every
 * option as equally suitable is not helping anyone choose, and the choice matters most to the people
 * least equipped to make it.
 */
export const METHODOLOGY_PROFILES: Readonly<Record<Methodology, MethodologyProfile>> = {
  AGILE: {
    key: 'AGILE',
    label: 'Iterative (Scrum-like)',
    summary: 'Fixed-length iterations, each ending with something demonstrable.',
    decomposition: 'ITERATION',
    gateCadence: 'PER_ITERATION',
    iterationDays: 14,
    milestoneBasis: 'ITERATION',
    changeHandling:
      'Change enters the backlog and is prioritised for a future iteration. The current iteration is left alone.',
    planningCadence: 'Re-planned at each iteration boundary.',
    repeatedGates: ['DEVELOPMENT', 'TESTING'],
    suitedTo:
      'Work where the requirements will genuinely change as people see the thing being built, and where a stakeholder is available every couple of weeks.',
    poorlySuitedTo:
      'Fixed-scope, fixed-price contracts, and work where the sequence is dictated externally — the ceremony then costs time without delivering the adaptation it exists for.',
  },

  KANBAN: {
    key: 'KANBAN',
    label: 'Continuous flow',
    summary: 'Work moves through stages continuously, with a limit on how much is in progress.',
    decomposition: 'CONTINUOUS_FLOW',
    gateCadence: 'CONTINUOUS',
    milestoneBasis: 'OUTCOME',
    changeHandling:
      'Change is added to the queue and pulled when capacity allows. Priority is re-decided at the moment of pulling.',
    planningCadence: 'Continuous; re-prioritised whenever something is pulled.',
    repeatedGates: ['DEVELOPMENT', 'TESTING', 'SECURITY'],
    suitedTo:
      'Support, maintenance and any work arriving unpredictably, where fixed iterations would either sit idle or be constantly interrupted.',
    poorlySuitedTo:
      'Work needing a committed date. Continuous flow optimises throughput, and gives weaker predictions about when a specific item will be done.',
  },

  WATERFALL: {
    key: 'WATERFALL',
    label: 'Sequential',
    summary: 'Phases completed in order, each with an exit gate.',
    decomposition: 'PHASE',
    gateCadence: 'PER_PHASE',
    milestoneBasis: 'PHASE',
    changeHandling:
      'Change after a phase closes goes through formal change control, with impact assessed before approval.',
    planningCadence: 'Planned once, revised at phase boundaries.',
    repeatedGates: [],
    suitedTo:
      'Work where the requirements genuinely are known, the cost of change is high, and an audit trail of approvals is needed — regulated environments and integrations against fixed external specifications.',
    poorlySuitedTo:
      'Anything where the requirements are still being discovered. The cost of being wrong is paid entirely at the end, when it is most expensive.',
  },

  HYBRID: {
    key: 'HYBRID',
    label: 'Hybrid',
    summary: 'Sequential at the phase level, iterative within the build.',
    decomposition: 'MIXED',
    gateCadence: 'PER_PHASE',
    iterationDays: 14,
    milestoneBasis: 'PHASE',
    changeHandling:
      'Change within a phase is absorbed by the iteration; change crossing a phase boundary goes through change control.',
    planningCadence: 'Phase-level plan, refined each iteration.',
    repeatedGates: ['DEVELOPMENT', 'TESTING'],
    suitedTo:
      'Organisations that need phase approvals and dates for governance, but want the feedback of iterating inside the build.',
    poorlySuitedTo:
      'Small teams, where the overhead of maintaining both structures exceeds what either contributes.',
  },

  SOLO: {
    key: 'SOLO',
    label: 'Solo or agent-assisted',
    summary: 'One person, possibly with AI assistance, working continuously.',
    decomposition: 'CONTINUOUS_FLOW',
    gateCadence: 'PER_RELEASE',
    milestoneBasis: 'OUTCOME',
    changeHandling: 'Change is decided immediately by the person doing the work, and recorded.',
    planningCadence: 'Continuous, with a written decision log in place of meetings.',
    repeatedGates: ['TESTING'],
    suitedTo:
      'Individual builders and very small teams, where coordination overhead has no one to coordinate with.',
    poorlySuitedTo:
      'Anything needing separation of duties. A single person cannot both request and approve, so the review controls have to come from automation or from someone outside.',
  },
};

/* -------------------------------------------------------------------------- */
/* The constraint                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Gates no methodology may remove.
 *
 * Derived from the gate catalogue rather than listed by hand: a gate with any blocking criterion is
 * mandatory. Hard-coding the list would let a new blocking gate be added and silently not protected,
 * which is the failure mode this rule exists to prevent.
 */
export const MANDATORY_GATES: readonly GateKey[] = GATES.filter((gate) =>
  gate.criteria.some((c) => c.blocking),
).map((gate) => gate.key);

/**
 * Which gates apply under a methodology.
 *
 * Always all of the mandatory ones. This function exists to make that explicit and testable — a
 * methodology feature that later wanted to skip a gate would have to change this signature, which is
 * a much more visible act than adding an exception somewhere in the evaluation.
 */
export function gatesFor(methodology: Methodology): readonly GateKey[] {
  const profile = METHODOLOGY_PROFILES[methodology];
  // Every mandatory gate applies, regardless of profile. The profile decides cadence, not existence.
  void profile;
  return GATES.map((g) => g.key);
}

/** How often a gate runs under a methodology. */
export function cadenceFor(methodology: Methodology, gate: GateKey): 'ONCE' | 'REPEATED' {
  return METHODOLOGY_PROFILES[methodology].repeatedGates.includes(gate) ? 'REPEATED' : 'ONCE';
}

/**
 * Whether a methodology could skip a gate.
 *
 * Always false, and deliberately a function rather than a constant. A future change that wanted to
 * introduce an exception would have to make this return true for something, and that is a change
 * someone would notice in review — which a scattered conditional would not be.
 */
export function canSkipGate(): boolean {
  return false;
}

/* -------------------------------------------------------------------------- */
/* Recommendation                                                             */
/* -------------------------------------------------------------------------- */

export interface MethodologySuggestion {
  readonly methodology: Methodology;
  readonly because: string;
  /** What this choice will be bad at. Stated with the recommendation, not hidden behind it. */
  readonly tradeOff: string;
}

/**
 * Suggest a methodology from what is known about the project.
 *
 * A suggestion, never a decision — and it always states the trade-off. A recommendation that only
 * lists advantages is advertising, and the person most likely to accept it uncritically is the
 * inexperienced user this product exists to help.
 */
export function suggestMethodology(input: {
  readonly teamSize?: number;
  readonly deadlineFixed?: boolean;
  readonly complianceRegimes?: readonly string[];
  readonly requirementsKnown?: boolean;
}): MethodologySuggestion {
  const { teamSize, deadlineFixed, complianceRegimes, requirementsKnown } = input;

  if (teamSize !== undefined && teamSize <= 1) {
    return {
      methodology: 'SOLO',
      because:
        'A team of one has nobody to coordinate with, so coordination ceremony costs time and returns nothing.',
      tradeOff: METHODOLOGY_PROFILES.SOLO.poorlySuitedTo,
    };
  }

  if (complianceRegimes !== undefined && complianceRegimes.length > 0) {
    return {
      methodology: 'HYBRID',
      because:
        'Compliance obligations need phase approvals and an audit trail, and iterating inside the build keeps the feedback that a purely sequential approach loses.',
      tradeOff: METHODOLOGY_PROFILES.HYBRID.poorlySuitedTo,
    };
  }

  if (requirementsKnown === true && deadlineFixed === true) {
    return {
      methodology: 'WATERFALL',
      because:
        'When the requirements are genuinely settled and the date cannot move, sequencing the work gives the clearest view of whether the date is achievable.',
      tradeOff: METHODOLOGY_PROFILES.WATERFALL.poorlySuitedTo,
    };
  }

  if (requirementsKnown === false) {
    return {
      methodology: 'AGILE',
      because:
        'Requirements that are still being discovered are best handled by building something small and looking at it.',
      tradeOff: METHODOLOGY_PROFILES.AGILE.poorlySuitedTo,
    };
  }

  return {
    methodology: 'AGILE',
    because:
      'Iterations suit most projects where a stakeholder can look at progress regularly, and they surface problems earlier than the alternatives.',
    tradeOff: METHODOLOGY_PROFILES.AGILE.poorlySuitedTo,
  };
}
