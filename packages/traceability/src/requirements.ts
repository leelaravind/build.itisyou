/**
 * The requirement model.
 *
 * A requirement is the only thing in this platform that can *justify* work existing. Everything
 * downstream — components, tasks, tests, evidence, approvals — is ultimately defensible only by
 * pointing back at one. So the quality of the requirement set is a hard ceiling on the quality of
 * everything else, and this module's job is mostly to refuse requirements that cannot carry that
 * weight.
 *
 * The central check is testability. "The system must be fast" cannot be passed or failed; it can only
 * be argued about. A requirement nobody can fail is not a requirement, it is a wish, and a project
 * that marks it satisfied has not satisfied anything. Detecting that at the point the requirement is
 * written is cheap; discovering it at the release gate, when somebody has to decide whether "fast"
 * was achieved, is not.
 *
 * Contract: gap-spec §9 (intake), §15.2 (Requirements Gate), §32 (evidence).
 */

import type { TwinNode } from '@govintel/twin/nodes';

/* -------------------------------------------------------------------------- */
/* Kinds                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * What sort of obligation this is.
 *
 * The distinction matters because it changes what counts as satisfying it. A functional requirement
 * is satisfied by behaviour; a constraint is satisfied by a property of the design that holds even
 * when nobody is exercising it; a regulatory one is satisfied only with evidence someone outside the
 * project would accept.
 */
export const REQUIREMENT_KINDS = [
  'FUNCTIONAL',
  'QUALITY_ATTRIBUTE',
  'CONSTRAINT',
  'REGULATORY',
  'INTERFACE',
  'DATA',
] as const;

export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];

/**
 * Quality attributes the intake actually asks about.
 *
 * Deliberately not the full ISO 25010 tree. A taxonomy larger than the questions that feed it
 * produces categories nothing can ever land in, which reads as coverage and is not.
 */
export const QUALITY_ATTRIBUTES = [
  'PERFORMANCE',
  'AVAILABILITY',
  'SECURITY',
  'PRIVACY',
  'ACCESSIBILITY',
  'USABILITY',
  'MAINTAINABILITY',
  'COMPATIBILITY',
] as const;

export type QualityAttribute = (typeof QUALITY_ATTRIBUTES)[number];

/**
 * How satisfaction is demonstrated.
 *
 * There is deliberately no `ASSERTION` member. Every method here produces something a second person
 * can examine — a run, a reading, a document, a measurement. "Somebody said so" is what the absence
 * of a verification method already means, and giving it a name would make it selectable.
 */
export const VERIFICATION_METHODS = [
  /** Something runs and passes or fails. The only method that can be automated end to end. */
  'TEST',
  /** Someone reads the artefact — code, configuration, a document — against the requirement. */
  'INSPECTION',
  /** The behaviour is shown working to someone who can judge it. */
  'DEMONSTRATION',
  /** Reasoned from properties of the design, where exercising it directly is impractical. */
  'ANALYSIS',
] as const;

export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];

/**
 * MoSCoW, with `WONT` retained rather than deleted.
 *
 * A requirement decided against is a decision, and deleting it loses the decision — six months later
 * somebody asks "why doesn't it do X" and there is no record that the question was answered.
 */
export const PRIORITIES = ['MUST', 'SHOULD', 'COULD', 'WONT'] as const;

export type Priority = (typeof PRIORITIES)[number];

/* -------------------------------------------------------------------------- */
/* The requirement                                                            */
/* -------------------------------------------------------------------------- */

export interface AcceptanceCriterion {
  readonly id: string;
  /** What must be true. Stated so that a reader can say whether it holds. */
  readonly statement: string;
  /**
   * The measurable part, where there is one.
   *
   * Optional because functional requirements often have none and forcing a number would produce
   * invented ones. Its absence on a quality attribute is a defect — see `checkRequirement`.
   */
  readonly measure?: Measure;
}

export interface Measure {
  /** What is being measured. "95th-percentile page load", not "speed". */
  readonly metric: string;
  readonly comparator: 'AT_MOST' | 'AT_LEAST' | 'EQUALS';
  readonly value: number;
  readonly unit: string;
  /**
   * The conditions the measurement holds under.
   *
   * A performance target with no stated load is unfalsifiable: any measurement can be dismissed as
   * unrepresentative, in either direction.
   */
  readonly conditions?: string;
}

export interface Requirement {
  readonly id: string;
  readonly projectId: string;
  readonly kind: RequirementKind;
  readonly label: string;
  readonly description: string;
  readonly priority: Priority;

  /** Present only on `QUALITY_ATTRIBUTE`. Checked. */
  readonly qualityAttribute?: QualityAttribute;

  readonly verification: readonly VerificationMethod[];
  readonly acceptance: readonly AcceptanceCriterion[];

  /**
   * Where this came from — an intake field, a rule, a regulation, a person.
   *
   * A requirement with no source cannot be renegotiated, because nobody knows who to ask. That is
   * how requirements outlive the reason they existed.
   */
  readonly sourceRef: string;

  /** Bumped on material change. Used to detect evidence that attests to an older version. */
  readonly revision: number;
}

/* -------------------------------------------------------------------------- */
/* Defects                                                                    */
/* -------------------------------------------------------------------------- */

export const REQUIREMENT_DEFECTS = [
  /** No verification method at all. Nothing can ever demonstrate this is satisfied. */
  'UNVERIFIABLE',
  /** No acceptance criteria. There is nothing to verify *against*. */
  'NO_ACCEPTANCE_CRITERIA',
  /** A quality attribute with no measure anywhere in its criteria. */
  'UNMEASURED_QUALITY_ATTRIBUTE',
  /** Wording that cannot be failed: "fast", "user-friendly", "robust", "as needed". */
  'SUBJECTIVE_WORDING',
  /** A measure with no stated conditions, so any measurement can be dismissed. */
  'MEASURE_WITHOUT_CONDITIONS',
  /** More than one obligation in one requirement, so it can be half-satisfied. */
  'COMPOUND',
  /** A regulatory requirement verifiable only by demonstration or assertion. */
  'REGULATORY_WITHOUT_ARTEFACT',
  /** `qualityAttribute` set on a requirement that is not one, or missing on one that is. */
  'KIND_MISMATCH',
  /** No source. Nobody can say who wanted this or why. */
  'UNSOURCED',
] as const;

export type RequirementDefect = (typeof REQUIREMENT_DEFECTS)[number];

export interface RequirementFinding {
  readonly defect: RequirementDefect;
  readonly requirementId: string;
  /** What is wrong, in terms of this requirement rather than of the rule. */
  readonly summary: string;
  /** Why it matters. Stated so a reader can disagree with the rule rather than only with the verdict. */
  readonly why: string;
  /** Whether this blocks the Requirements Gate or is advisory. */
  readonly blocking: boolean;
}

/**
 * Words that describe a feeling about software rather than a property of it.
 *
 * Kept deliberately short. A long list catches phrases that are fine in context — "simple" is a
 * perfectly good word in an acceptance criterion that then says what simple means — and a check that
 * fires on reasonable text gets switched off, taking the useful cases with it.
 */
const SUBJECTIVE_TERMS = [
  'user-friendly',
  'user friendly',
  'easy to use',
  'intuitive',
  'fast',
  'quick',
  'responsive',
  'scalable',
  'robust',
  'seamless',
  'as needed',
  'as appropriate',
  'best practice',
  'state of the art',
  'modern',
  'efficient',
  'reliable',
] as const;

/** Conjunctions that join two obligations into one untestable sentence. */
const COMPOUND_MARKERS = [' and also ', ' as well as ', '; and ', ' and must ', ' and should '];

/**
 * Every defect in one requirement, in a fixed order.
 *
 * Order is by declaration rather than by severity so the output is stable: a caller sorting by
 * severity gets to choose its own tie-break, and a caller diffing two runs sees only real changes.
 */
export function checkRequirement(requirement: Requirement): readonly RequirementFinding[] {
  const findings: RequirementFinding[] = [];

  const at = (defect: RequirementDefect, summary: string, why: string, blocking: boolean): void => {
    findings.push({ defect, requirementId: requirement.id, summary, why, blocking });
  };

  if (requirement.verification.length === 0) {
    at(
      'UNVERIFIABLE',
      'No verification method is recorded.',
      'Nothing can ever demonstrate this is satisfied, so marking it done would be an assertion. This is the defect that survives all the way to the release gate, where somebody has to decide it on the day.',
      requirement.priority === 'MUST',
    );
  }

  if (requirement.acceptance.length === 0) {
    at(
      'NO_ACCEPTANCE_CRITERIA',
      'No acceptance criteria are recorded.',
      'A verification method with nothing to verify against tests whatever the person running it thought the requirement meant.',
      requirement.priority === 'MUST',
    );
  }

  if (requirement.sourceRef.trim() === '') {
    at(
      'UNSOURCED',
      'No source is recorded.',
      'A requirement nobody can trace to a person, a rule or an intake answer cannot be renegotiated, because nobody knows who to ask. That is how requirements outlive the reason they existed.',
      false,
    );
  }

  const isQuality = requirement.kind === 'QUALITY_ATTRIBUTE';
  const hasAttribute = requirement.qualityAttribute !== undefined;

  if (isQuality !== hasAttribute) {
    at(
      'KIND_MISMATCH',
      isQuality
        ? 'Declared as a quality attribute but names no attribute.'
        : `Names the quality attribute ${String(requirement.qualityAttribute)} but is of kind ${requirement.kind}.`,
      'The kind decides which checks apply. A mismatch means the requirement is being checked as something it is not.',
      false,
    );
  }

  if (isQuality && !requirement.acceptance.some((c) => c.measure !== undefined)) {
    at(
      'UNMEASURED_QUALITY_ATTRIBUTE',
      'A quality attribute with no measurable criterion.',
      'Quality attributes are exactly the requirements that cannot be judged by looking. Without a number and a unit, "satisfied" means whatever the person asked at the time believes.',
      requirement.priority === 'MUST',
    );
  }

  for (const criterion of requirement.acceptance) {
    if (criterion.measure !== undefined && criterion.measure.conditions === undefined) {
      at(
        'MEASURE_WITHOUT_CONDITIONS',
        `Criterion ${criterion.id} states a measure with no conditions.`,
        'A target with no stated load, dataset or environment is unfalsifiable: any measurement can be dismissed as unrepresentative, and the argument goes whichever way the arguer wants.',
        false,
      );
    }
  }

  const subjective = findSubjective(requirement);
  if (subjective !== undefined) {
    at(
      'SUBJECTIVE_WORDING',
      `Uses "${subjective}", which describes a feeling about software rather than a property of it.`,
      'Wording that cannot be failed produces a requirement that is never not satisfied. The fix is usually to say what the word was standing in for.',
      // Advisory: subjective wording alongside a real measure is normal prose, and blocking on it
      // would train people to write worse requirements that pass the check.
      false,
    );
  }

  const compound = COMPOUND_MARKERS.find((marker) =>
    requirement.description.toLowerCase().includes(marker),
  );

  if (compound !== undefined) {
    at(
      'COMPOUND',
      'States more than one obligation.',
      'A compound requirement can be half-satisfied, and there is no way to record that: it is either done or not, and both answers are wrong.',
      false,
    );
  }

  if (requirement.kind === 'REGULATORY') {
    const producesArtefact = requirement.verification.some(
      (m) => m === 'TEST' || m === 'INSPECTION' || m === 'ANALYSIS',
    );

    if (requirement.verification.length > 0 && !producesArtefact) {
      at(
        'REGULATORY_WITHOUT_ARTEFACT',
        'Verified only by demonstration, which leaves nothing behind.',
        'A regulator, auditor or customer asking how this was satisfied needs something they can examine after the fact. A demonstration convinces the people in the room and nobody else.',
        true,
      );
    }
  }

  return findings;
}

function findSubjective(requirement: Requirement): string | undefined {
  const haystack = [
    requirement.label,
    requirement.description,
    ...requirement.acceptance.map((c) => c.statement),
  ]
    .join(' ')
    .toLowerCase();

  return SUBJECTIVE_TERMS.find((term) => haystack.includes(term));
}

/* -------------------------------------------------------------------------- */
/* Reading requirements out of the twin                                       */
/* -------------------------------------------------------------------------- */

/**
 * Read a `REQUIREMENT` node as a requirement.
 *
 * Returns `undefined` rather than a partially-populated requirement when the node does not carry the
 * attributes. A half-read requirement would be checked against rules its missing halves cannot fail,
 * and would report clean.
 */
export function requirementFromNode(node: TwinNode): Requirement | undefined {
  if (node.class !== 'REQUIREMENT') return undefined;

  const kind = node.attributes.kind;
  const priority = node.attributes.priority;

  if (!isKind(kind) || !isPriority(priority)) return undefined;

  const attribute = node.attributes.qualityAttribute;
  const verification = node.attributes.verification;
  const acceptance = node.attributes.acceptance;

  return {
    id: node.id,
    projectId: node.projectId,
    kind,
    label: node.label,
    description: node.description ?? '',
    priority,
    ...(isQualityAttribute(attribute) ? { qualityAttribute: attribute } : {}),
    verification: Array.isArray(verification) ? verification.filter(isVerificationMethod) : [],
    acceptance: Array.isArray(acceptance) ? acceptance.filter(isCriterion) : [],
    sourceRef: typeof node.attributes.sourceRef === 'string' ? node.attributes.sourceRef : '',
    revision: node.revision,
  };
}

function isKind(value: unknown): value is RequirementKind {
  return typeof value === 'string' && (REQUIREMENT_KINDS as readonly string[]).includes(value);
}

function isPriority(value: unknown): value is Priority {
  return typeof value === 'string' && (PRIORITIES as readonly string[]).includes(value);
}

function isQualityAttribute(value: unknown): value is QualityAttribute {
  return typeof value === 'string' && (QUALITY_ATTRIBUTES as readonly string[]).includes(value);
}

function isVerificationMethod(value: unknown): value is VerificationMethod {
  return typeof value === 'string' && (VERIFICATION_METHODS as readonly string[]).includes(value);
}

function isCriterion(value: unknown): value is AcceptanceCriterion {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string' && typeof record.statement === 'string';
}
