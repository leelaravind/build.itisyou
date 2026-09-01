/**
 * Integrations, and the boundary around them.
 *
 * §44 says two things that pull against each other, and the tension is the whole design:
 *
 * > Integrations screen can exist even when connectors are not implemented.
 * > **Do not fake functionality.**
 *
 * A screen listing integrations that do not exist is useful — it tells somebody what is coming and
 * lets them stop looking for it — and it is one careless label away from being a lie. The difference
 * is entirely in whether the states are honest, so the states carry the weight here rather than the
 * connectors.
 *
 * `PLANNED` is the important one. It is not a softer `NOT_CONNECTED`; it means *there is nothing to
 * connect to*, and rendering the two alike would put a Connect button on something that cannot
 * connect. That is the specific way an integrations screen fakes functionality: not by claiming a
 * feature works, but by offering an action that does nothing.
 *
 * Contract: gap-spec §44, §45 (source control contract).
 */

/* -------------------------------------------------------------------------- */
/* States                                                                     */
/* -------------------------------------------------------------------------- */

/** §44's four states, in the order it names them. */
export const INTEGRATION_STATES = ['AVAILABLE', 'CONNECTED', 'NOT_CONNECTED', 'PLANNED'] as const;

export type IntegrationState = (typeof INTEGRATION_STATES)[number];

export const STATE_MEANING: Readonly<Record<IntegrationState, string>> = {
  AVAILABLE: 'Built, and you can connect it.',
  CONNECTED: 'Built and connected. Data is flowing.',
  NOT_CONNECTED: 'Built and not connected. Connecting it is something you can do now.',
  PLANNED:
    'Not built. There is nothing to connect to, and there is no date. Listed so you know it is coming and can stop looking for it.',
};

/**
 * Whether a state should offer a connect action.
 *
 * The single most important function in this module. §44's "do not fake functionality" fails most
 * often not through a false claim but through a button: an action offered on something that cannot
 * perform it, which the user discovers by pressing it.
 */
export function offersConnect(state: IntegrationState): boolean {
  return state === 'AVAILABLE' || state === 'NOT_CONNECTED';
}

/* -------------------------------------------------------------------------- */
/* The catalogue                                                              */
/* -------------------------------------------------------------------------- */

export interface Integration {
  readonly key: string;
  readonly name: string;
  readonly category: 'SOURCE_CONTROL' | 'CI_CD' | 'CALENDAR' | 'MONITORING' | 'ISSUE_TRACKER';
  readonly state: IntegrationState;
  /** What it would do. Written for somebody deciding whether to wait for it. */
  readonly whatItWouldDo: string;
  /**
   * What the platform still cannot do even once this is connected.
   *
   * The field that keeps an integrations screen honest. Every integration is oversold by omission —
   * people assume a connected source control means the platform knows what the code does — and the
   * cheapest correction is to say what it does not.
   */
  readonly whatItStillCannotDo: string;
}

/**
 * V1's integrations, all `PLANNED`.
 *
 * That is the truthful state, and writing it down is worth more than it looks: the alternative is an
 * empty screen, which tells a user nothing about whether integration is coming, or a screen of
 * plausible-looking connectors, which tells them something false.
 *
 * §44 recommends source control first if bandwidth allows, then CI/CD, calendar and monitoring. The
 * order below is that order, so the screen reads as a sequence rather than a menu.
 */
export const INTEGRATIONS: readonly Integration[] = [
  {
    key: 'source-control',
    name: 'Source control',
    category: 'SOURCE_CONTROL',
    state: 'PLANNED',
    whatItWouldDo:
      'Associate commits, branches and pull requests with tasks, so the work in the plan and the work in the repository are the same work.',
    whatItStillCannotDo:
      'It cannot tell whether the code does what the requirement asked. A commit linked to a task proves somebody worked on it, not that they finished it or got it right.',
  },
  {
    key: 'ci-cd',
    name: 'CI/CD',
    category: 'CI_CD',
    state: 'PLANNED',
    whatItWouldDo:
      'Record pipeline runs as test evidence automatically, with the artefact hash, so the release argument builds itself as work happens.',
    whatItStillCannotDo:
      'It cannot tell whether the tests that ran were the right tests. A green pipeline is evidence about what was checked, never about what exists.',
  },
  {
    key: 'calendar',
    name: 'Calendar',
    category: 'CALENDAR',
    state: 'PLANNED',
    whatItWouldDo:
      'Read real availability instead of assuming it, so capacity comes from what people are actually doing rather than from a default deduction.',
    whatItStillCannotDo:
      'It cannot see the work that never reaches a calendar, which for most people is most of it.',
  },
  {
    key: 'monitoring',
    name: 'Monitoring',
    category: 'MONITORING',
    state: 'PLANNED',
    whatItWouldDo:
      'Supply the production verification checks §15.9 requires, so availability and error rates are observed rather than attested.',
    whatItStillCannotDo:
      'It cannot verify the checks nobody configured. An unmonitored failure mode looks identical to one that never happens.',
  },
  {
    key: 'issue-tracker',
    name: 'Issue tracker',
    category: 'ISSUE_TRACKER',
    state: 'PLANNED',
    whatItWouldDo:
      'Keep tasks in step with wherever the team already tracks them, so nobody maintains two lists.',
    whatItStillCannotDo:
      'It cannot resolve a disagreement about which list is authoritative. That is a decision somebody has to make, and importing both directions without making it produces two lists that are each other’s copy.',
  },
];

/* -------------------------------------------------------------------------- */
/* Checks                                                                     */
/* -------------------------------------------------------------------------- */

export const INTEGRATION_DEFECTS = [
  'CONNECT_OFFERED_ON_PLANNED',
  'CONNECTED_WITHOUT_A_CONNECTOR',
  'NO_LIMITATION_STATED',
] as const;

export type IntegrationDefect = (typeof INTEGRATION_DEFECTS)[number];

export interface IntegrationFinding {
  readonly defect: IntegrationDefect;
  readonly key: string;
  readonly summary: string;
  readonly why: string;
}

/**
 * Whether the catalogue itself is honest.
 *
 * Run as a test rather than at runtime, because these are defects in what was written down rather
 * than in what a user did. The point is that adding an integration in a state the product cannot back
 * up fails the build.
 */
export function checkIntegrations(
  integrations: readonly Integration[],
  implemented: ReadonlySet<string>,
): readonly IntegrationFinding[] {
  const findings: IntegrationFinding[] = [];

  for (const integration of integrations) {
    if (integration.state === 'PLANNED' && offersConnect(integration.state)) {
      findings.push({
        defect: 'CONNECT_OFFERED_ON_PLANNED',
        key: integration.key,
        summary: 'Offers a connect action for something that does not exist.',
        why: '§44’s "do not fake functionality" fails most often through a button rather than a claim: an action offered on something that cannot perform it, which the user discovers by pressing it.',
      });
    }

    if (
      (integration.state === 'CONNECTED' ||
        integration.state === 'AVAILABLE' ||
        integration.state === 'NOT_CONNECTED') &&
      !implemented.has(integration.key)
    ) {
      findings.push({
        defect: 'CONNECTED_WITHOUT_A_CONNECTOR',
        key: integration.key,
        summary: `Declared ${integration.state.toLowerCase().replace(/_/g, ' ')} with no connector behind it.`,
        why: 'Any state other than PLANNED is a claim that the thing is built. Making that claim without the code is the exact failure §44 names.',
      });
    }

    if (integration.whatItStillCannotDo.trim() === '') {
      findings.push({
        defect: 'NO_LIMITATION_STATED',
        key: integration.key,
        summary: 'Says what it would do and not what it still would not.',
        why: 'Every integration is oversold by omission — people assume a connected source control means the platform knows what the code does. The cheapest correction is to say what it does not.',
      });
    }
  }

  return findings;
}

/**
 * What is genuinely implemented.
 *
 * Empty in V1, and deliberately a separate value from the catalogue rather than a flag on it. The
 * catalogue describes intent; this describes reality, and keeping them apart means a state can be
 * checked against something rather than against itself.
 */
export const IMPLEMENTED_CONNECTORS: ReadonlySet<string> = new Set<string>();
