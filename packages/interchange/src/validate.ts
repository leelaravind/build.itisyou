/**
 * The AI import validation pipeline.
 *
 * Contract: plan §11.1 lists eleven validation steps and seven result statuses; gap-spec §12.1 lists
 * fourteen layers and §12.2 the conflict cases. Plan §11.1 is emphatic: **"Never silently convert an
 * invalid response into a project."**
 *
 * Treat this file as the airlock. Everything upstream of it is untrusted text a person pasted from a
 * system this platform does not run and cannot authenticate. Everything downstream assumes the data
 * is structurally sound, internally consistent, and does not contradict something the user already
 * confirmed. This is the only thing standing between those two worlds.
 *
 * Two properties shape the design:
 *
 * **Layers run in order, cheapest and most-defensive first.** Size before parse, parse before
 * schema, schema before semantics. A 50 MB payload must be rejected on its length, not after
 * `JSON.parse` has already allocated it.
 *
 * **Everything is collected, not short-circuited** — within a layer. The user has to take failures
 * back to an external AI, and a validator that reports one problem per round trip turns a
 * five-minute fix into an afternoon. Layers still stop the pipeline, because there is nothing useful
 * to say about the semantics of something that is not valid JSON.
 */

import { AppError } from '@govintel/shared/errors';
import type { IntakeField } from '@govintel/intake/schema';
import { findField } from '@govintel/intake/fields';
import { canOverwrite } from '@govintel/shared/provenance';
import {
  interchangeResponseSchema,
  isSupportedProjectType,
  MAX_PAYLOAD_BYTES,
  type InterchangeResponse,
} from './schema.ts';
import { currentVersions, isSupportedSchemaVersion, supportedSchemaVersions } from './versions.ts';

/** Result statuses, verbatim from plan §11.1. */
export const VALIDATION_STATUSES = [
  'VALID',
  'VALID_WITH_WARNINGS',
  'INCOMPLETE',
  'CONFLICTING',
  'UNSUPPORTED',
  'INVALID',
  'UNSAFE',
] as const;

export type ValidationStatus = (typeof VALIDATION_STATUSES)[number];

/** The fourteen layers of gap-spec §12.1, in execution order. */
export const VALIDATION_LAYERS = [
  'PAYLOAD_SIZE',
  'ENCODING',
  'JSON_SYNTAX',
  'JSON_SCHEMA',
  'SCHEMA_VERSION',
  'REFERENCE_INTEGRITY',
  'FIELD_DOMAIN',
  'SEMANTIC_INVARIANTS',
  'CONFLICT',
  'PROVENANCE',
  'CONFIDENCE',
  'POLICY_SECURITY',
  'COMPLETENESS',
  'GENERATION_READINESS',
] as const;

export type ValidationLayer = (typeof VALIDATION_LAYERS)[number];

export type IssueSeverity = 'ERROR' | 'WARNING' | 'INFO';

export interface ValidationIssue {
  readonly layer: ValidationLayer;
  readonly severity: IssueSeverity;
  /** Stable code so the UI can explain it and tests can assert on it. */
  readonly code: string;
  /** Shown to the user. Must not echo untrusted content — see `safeExcerpt`. */
  readonly message: string;
  /** Where in the payload, e.g. `requirements[2].dependsOn`. */
  readonly path?: string;
}

export interface ValidationResult {
  readonly status: ValidationStatus;
  readonly issues: readonly ValidationIssue[];
  /** Present only when the payload parsed and matched the schema. */
  readonly response?: InterchangeResponse;
  readonly versions: ReturnType<typeof currentVersions>;
  /** True only when the import may proceed to materialisation. */
  readonly canMaterialize: boolean;
}

export interface ValidationContext {
  /** The user's current intake answers, used for conflict detection. */
  readonly intake: readonly IntakeField[];
  /** The prompt this response is supposed to answer, if known. */
  readonly expectedPromptId?: string;
}

/**
 * Quote untrusted content safely.
 *
 * Validation messages are rendered in the UI and written to logs. Echoing a raw fragment of an
 * attacker-controlled payload into either is how a validator becomes an injection vector, so
 * anything quoted is truncated and stripped of control characters and markup delimiters.
 */
function safeExcerpt(value: unknown, max = 60): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value) || '';
  return (
    text
      // Stripping control characters is the purpose, not an accident: an excerpt is written into
      // log lines, where a newline can forge an entry, and into the DOM, where angle brackets do
      // the obvious.
      // eslint-disable-next-line no-control-regex -- removing control characters is the point
      .replace(/[\u0000-\u001f\u007f<>]/g, '')
      .slice(0, max)
      .trim()
  );
}

/* -------------------------------------------------------------------------- */
/* The pipeline                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Validate a pasted response.
 *
 * Takes the raw string, never a pre-parsed object: parsing is itself a layer, and accepting an
 * object would mean some caller already did it under rules this function cannot see.
 */
export function validateImport(raw: string, context: ValidationContext): ValidationResult {
  const versions = currentVersions();
  const issues: ValidationIssue[] = [];

  const fail = (status: ValidationStatus): ValidationResult => ({
    status,
    issues,
    versions,
    canMaterialize: false,
  });

  /* Layer 1 — payload size. Before anything touches the content. */
  const bytes = Buffer.byteLength(raw, 'utf8');
  if (bytes > MAX_PAYLOAD_BYTES) {
    issues.push({
      layer: 'PAYLOAD_SIZE',
      severity: 'ERROR',
      code: 'PAYLOAD_TOO_LARGE',
      message: `The response is ${String(Math.round(bytes / 1024))} KB. The limit is ${String(
        Math.round(MAX_PAYLOAD_BYTES / 1024),
      )} KB.`,
    });
    return fail('INVALID');
  }

  if (raw.trim().length === 0) {
    issues.push({
      layer: 'PAYLOAD_SIZE',
      severity: 'ERROR',
      code: 'PAYLOAD_EMPTY',
      message: 'Nothing was pasted.',
    });
    return fail('INVALID');
  }

  /* Layer 2 — encoding. */
  // A lone surrogate survives `JSON.parse` and then breaks at the database boundary, far from here.
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(raw)) {
    issues.push({
      layer: 'ENCODING',
      severity: 'ERROR',
      code: 'INVALID_ENCODING',
      message: 'The text contains malformed characters. Try copying it again.',
    });
    return fail('INVALID');
  }

  /* Layer 3 — JSON syntax, after stripping the wrapper models habitually add. */
  const candidate = stripWrapper(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (error) {
    issues.push({
      layer: 'JSON_SYNTAX',
      severity: 'ERROR',
      code: 'INVALID_JSON',
      message:
        'That is not valid JSON. Make sure you copied the whole object, including the closing brace.',
      ...(error instanceof SyntaxError ? { path: safeExcerpt(error.message, 120) } : {}),
    });
    return fail('INVALID');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    issues.push({
      layer: 'JSON_SYNTAX',
      severity: 'ERROR',
      code: 'NOT_AN_OBJECT',
      message: 'The response must be a single JSON object.',
    });
    return fail('INVALID');
  }

  /* Layer 5 (before 4) — schema version. */
  // Checked before the shape, so a payload written against a different version gets a message about
  // the version rather than a wall of shape errors that make it look malformed.
  const declaredVersion = (parsed as { schemaVersion?: unknown }).schemaVersion;
  if (typeof declaredVersion !== 'string') {
    issues.push({
      layer: 'SCHEMA_VERSION',
      severity: 'ERROR',
      code: 'SCHEMA_VERSION_MISSING',
      message: 'The response does not say which schema version it uses.',
      path: 'schemaVersion',
    });
    return fail('INVALID');
  }

  if (!isSupportedSchemaVersion(declaredVersion)) {
    issues.push({
      layer: 'SCHEMA_VERSION',
      severity: 'ERROR',
      code: 'SCHEMA_VERSION_UNSUPPORTED',
      message: `Schema version ${safeExcerpt(declaredVersion, 20)} is not supported. This build accepts: ${supportedSchemaVersions().join(', ')}. Generate a fresh prompt and try again.`,
      path: 'schemaVersion',
    });
    return fail('UNSUPPORTED');
  }

  /* Layer 4 — JSON Schema. */
  const shape = interchangeResponseSchema.safeParse(parsed);
  if (!shape.success) {
    for (const issue of shape.error.issues.slice(0, 50)) {
      issues.push({
        layer: 'JSON_SCHEMA',
        severity: 'ERROR',
        code: issue.code === 'unrecognized_keys' ? 'UNKNOWN_PROPERTY' : 'SCHEMA_MISMATCH',
        message: issue.message,
        path: issue.path.join('.'),
      });
    }
    return fail('INVALID');
  }

  const response = shape.data;

  /* Layer 12 (early) — policy and security. */
  // Run before the expensive semantic passes: a payload carrying an injection attempt is rejected
  // whether or not its dependency graph happens to be acyclic.
  const unsafe = detectUnsafeContent(response);
  if (unsafe.length > 0) {
    issues.push(...unsafe);
    return fail('UNSAFE');
  }

  /* Layer 6 — reference integrity, including cycles. */
  issues.push(...checkReferences(response));

  /* Layer 7 — field domain. */
  issues.push(...checkFieldDomains(response));

  /* Layer 8 — semantic invariants. */
  issues.push(...checkSemantics(response));

  /* Layer 10 & 11 — provenance and confidence. */
  issues.push(...checkProvenance(response));

  /* Layer 9 — conflict with what the user already confirmed. */
  const conflicts = checkConflicts(response, context.intake);
  issues.push(...conflicts);

  /* Prompt correlation. A mismatch is a warning: a user may legitimately reuse a response. */
  if (
    context.expectedPromptId !== undefined &&
    response.promptId !== undefined &&
    response.promptId !== context.expectedPromptId
  ) {
    issues.push({
      layer: 'SEMANTIC_INVARIANTS',
      severity: 'WARNING',
      code: 'PROMPT_ID_MISMATCH',
      message:
        'This response answers a different prompt. Check it is the right one before accepting.',
      path: 'promptId',
    });
  }

  /* Layer 13 — completeness. */
  issues.push(...checkCompleteness(response));

  /* Layer 14 — generation readiness. */
  const errors = issues.filter((i) => i.severity === 'ERROR');
  const warnings = issues.filter((i) => i.severity === 'WARNING');
  const hasConflict = conflicts.some((c) => c.severity === 'ERROR');

  const status: ValidationStatus = hasConflict
    ? 'CONFLICTING'
    : errors.length > 0
      ? issues.some((i) => i.code === 'PROJECT_TYPE_UNSUPPORTED')
        ? 'UNSUPPORTED'
        : 'INVALID'
      : issues.some((i) => i.code === 'NOTHING_USABLE')
        ? 'INCOMPLETE'
        : warnings.length > 0
          ? 'VALID_WITH_WARNINGS'
          : 'VALID';

  return {
    status,
    issues,
    response,
    versions,
    // Only these two statuses may proceed. Everything else requires the user to act first —
    // plan §11.1: never silently convert an invalid response into a project.
    canMaterialize: status === 'VALID' || status === 'VALID_WITH_WARNINGS',
  };
}

/* -------------------------------------------------------------------------- */
/* Layer implementations                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Strip the wrapper models habitually add.
 *
 * Every instruction to "return only JSON" is followed some of the time. Chat interfaces add
 * markdown fences, a leading "Here is the JSON:", and trailing commentary. Rejecting those would be
 * technically correct and practically useless — the user did nothing wrong and cannot fix the
 * model's manners.
 *
 * Only the outermost object is extracted. Nothing inside it is altered, so this is a tolerance for
 * packaging, not for content.
 */
export function stripWrapper(raw: string): string {
  let text = raw.trim();

  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/.exec(text);
  if (fence?.[1] !== undefined) text = fence[1].trim();

  // Prose either side of the object: take from the first brace to its matching close.
  if (!text.startsWith('{')) {
    const start = text.indexOf('{');
    if (start === -1) return text;
    text = text.slice(start);
  }

  const end = findMatchingBrace(text);
  return end === -1 ? text : text.slice(0, end + 1);
}

/** Index of the brace closing the one at position 0, honouring strings and escapes. */
function findMatchingBrace(text: string): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
}

/** Collect every id, reporting duplicates within each section. */
function collectIds(response: InterchangeResponse): {
  ids: Map<string, Set<string>>;
  issues: ValidationIssue[];
} {
  const ids = new Map<string, Set<string>>();
  const issues: ValidationIssue[] = [];

  const sections: [string, readonly { id: string }[] | undefined][] = [
    ['requirements', response.requirements],
    ['risks', response.risks],
    ['phases', response.phases],
    ['assumptions', response.assumptions],
    ['openQuestions', response.openQuestions],
  ];

  for (const [name, items] of sections) {
    const seen = new Set<string>();
    for (const [index, item] of (items ?? []).entries()) {
      if (seen.has(item.id)) {
        // Duplicate ids make every reference to that id ambiguous, and an ambiguous reference in a
        // dependency graph is a silently wrong plan rather than a visible error.
        issues.push({
          layer: 'REFERENCE_INTEGRITY',
          severity: 'ERROR',
          code: 'DUPLICATE_ID',
          message: `Two items in ${name} share the id "${safeExcerpt(item.id, 32)}".`,
          path: `${name}[${String(index)}].id`,
        });
      }
      seen.add(item.id);
    }
    ids.set(name, seen);
  }

  return { ids, issues };
}

function checkReferences(response: InterchangeResponse): ValidationIssue[] {
  const { ids, issues } = collectIds(response);

  const checkEdges = (
    section: 'requirements' | 'phases',
    // `dependsOn?: string[]` rather than `readonly string[]`: the schema produces mutable arrays,
    // and a readonly parameter will not accept them under `exactOptionalPropertyTypes`.
    items: readonly { id: string; dependsOn?: string[] | undefined }[] | undefined,
  ): void => {
    const known = ids.get(section) ?? new Set<string>();
    const graph = new Map<string, readonly string[]>();

    for (const [index, item] of (items ?? []).entries()) {
      graph.set(item.id, item.dependsOn ?? []);

      for (const [edgeIndex, target] of (item.dependsOn ?? []).entries()) {
        if (target === item.id) {
          issues.push({
            layer: 'REFERENCE_INTEGRITY',
            severity: 'ERROR',
            code: 'SELF_REFERENCE',
            message: `"${safeExcerpt(item.id, 32)}" depends on itself.`,
            path: `${section}[${String(index)}].dependsOn[${String(edgeIndex)}]`,
          });
        } else if (!known.has(target)) {
          issues.push({
            layer: 'REFERENCE_INTEGRITY',
            severity: 'ERROR',
            code: 'BROKEN_REFERENCE',
            message: `"${safeExcerpt(item.id, 32)}" depends on "${safeExcerpt(target, 32)}", which does not exist.`,
            path: `${section}[${String(index)}].dependsOn[${String(edgeIndex)}]`,
          });
        }
      }
    }

    for (const cycle of findCycles(graph)) {
      issues.push({
        layer: 'REFERENCE_INTEGRITY',
        severity: 'ERROR',
        code: 'DEPENDENCY_CYCLE',
        message: `These ${section} depend on each other in a loop: ${cycle.map((id) => safeExcerpt(id, 24)).join(' → ')}.`,
        path: section,
      });
    }
  };

  checkEdges('requirements', response.requirements);
  checkEdges('phases', response.phases);

  // Open questions may point at an intake field; an unknown one is a warning, not an error, since
  // it costs nothing and the question text is still useful.
  for (const [index, question] of (response.openQuestions ?? []).entries()) {
    if (
      question.relatesToFieldId !== undefined &&
      findField(question.relatesToFieldId) === undefined
    ) {
      issues.push({
        layer: 'REFERENCE_INTEGRITY',
        severity: 'WARNING',
        code: 'UNKNOWN_FIELD_REFERENCE',
        message: `An open question refers to "${safeExcerpt(question.relatesToFieldId, 32)}", which is not a known field.`,
        path: `openQuestions[${String(index)}].relatesToFieldId`,
      });
    }
  }

  return issues;
}

/**
 * Every cycle in a directed graph, via depth-first search.
 *
 * Iterative rather than recursive: a hostile payload could nest deeply enough to blow the call
 * stack, and a crash inside the validator is a denial of service on the import endpoint.
 */
function findCycles(graph: ReadonlyMap<string, readonly string[]>): string[][] {
  const cycles: string[][] = [];
  const state = new Map<string, 'visiting' | 'done'>();

  for (const start of graph.keys()) {
    if (state.get(start) !== undefined) continue;

    const stack: { node: string; path: string[] }[] = [{ node: start, path: [start] }];
    state.set(start, 'visiting');

    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (top === undefined) break;
      const neighbours = graph.get(top.node) ?? [];
      const next = neighbours.find((n) => !top.path.includes(n) && state.get(n) !== 'done');

      const looped = neighbours.find((n) => top.path.includes(n));
      if (looped !== undefined && !cycles.some((c) => c.includes(looped))) {
        cycles.push([...top.path.slice(top.path.indexOf(looped)), looped]);
      }

      if (next === undefined) {
        state.set(top.node, 'done');
        stack.pop();
      } else {
        state.set(next, 'visiting');
        stack.push({ node: next, path: [...top.path, next] });
      }
    }
  }

  return cycles;
}

function checkFieldDomains(response: InterchangeResponse): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (response.projectType !== undefined && !isSupportedProjectType(response.projectType)) {
    // Reported, never coerced. Silently mapping an unsupported type onto the nearest supported one
    // would produce a plan built on a rule pack the project does not actually match (gap-spec §4.2).
    issues.push({
      layer: 'FIELD_DOMAIN',
      severity: 'ERROR',
      code: 'PROJECT_TYPE_UNSUPPORTED',
      message: `"${safeExcerpt(response.projectType, 40)}" is not a project type this platform supports yet.`,
      path: 'projectType',
    });
  }

  for (const [index, claim] of (response.claims ?? []).entries()) {
    if (findField(claim.fieldId) === undefined) {
      issues.push({
        layer: 'FIELD_DOMAIN',
        severity: 'ERROR',
        code: 'UNKNOWN_CLAIM_FIELD',
        message: `A claim refers to "${safeExcerpt(claim.fieldId, 40)}", which is not a field this platform has.`,
        path: `claims[${String(index)}].fieldId`,
      });
    }
  }

  return issues;
}

function checkSemantics(response: InterchangeResponse): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const [index, phase] of (response.phases ?? []).entries()) {
    const estimate = phase.estimatedDays;
    if (estimate !== undefined && estimate.low > estimate.high) {
      issues.push({
        layer: 'SEMANTIC_INVARIANTS',
        severity: 'ERROR',
        code: 'IMPOSSIBLE_RANGE',
        message: `Phase "${safeExcerpt(phase.name, 32)}" has a minimum estimate larger than its maximum.`,
        path: `phases[${String(index)}].estimatedDays`,
      });
    }
  }

  // A response that is entirely WONT-priority requirements has answered nothing useful.
  const requirements = response.requirements ?? [];
  if (requirements.length > 0 && requirements.every((r) => r.priority === 'WONT')) {
    issues.push({
      layer: 'SEMANTIC_INVARIANTS',
      severity: 'WARNING',
      code: 'ALL_REQUIREMENTS_EXCLUDED',
      message: 'Every requirement is marked as out of scope. Check this is what you expected.',
      path: 'requirements',
    });
  }

  return issues;
}

function checkProvenance(response: InterchangeResponse): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const [index, claim] of (response.claims ?? []).entries()) {
    // A "researched" claim with nothing to point at is inference wearing a better label, and the
    // difference matters: the trust ranking treats EXTERNAL_SOURCE above EXTERNAL_AI_INFERENCE.
    if (claim.provenance === 'EXTERNAL_SOURCE' && (claim.sources ?? []).length === 0) {
      issues.push({
        layer: 'PROVENANCE',
        severity: 'ERROR',
        code: 'SOURCE_CLAIMED_WITHOUT_CITATION',
        message: `A claim about "${safeExcerpt(claim.fieldId, 32)}" says it came from a source but cites none.`,
        path: `claims[${String(index)}].sources`,
      });
    }

    // High confidence on an assumption is a contradiction in terms.
    if (claim.provenance === 'ASSUMPTION' && claim.confidence === 'HIGH') {
      issues.push({
        layer: 'CONFIDENCE',
        severity: 'WARNING',
        code: 'HIGH_CONFIDENCE_ASSUMPTION',
        message: `An assumption about "${safeExcerpt(claim.fieldId, 32)}" is marked high confidence. Treated as an assumption regardless.`,
        path: `claims[${String(index)}].confidence`,
      });
    }
  }

  for (const [index, requirement] of (response.requirements ?? []).entries()) {
    if (requirement.priority === 'MUST' && requirement.confidence === 'LOW') {
      issues.push({
        layer: 'CONFIDENCE',
        severity: 'WARNING',
        code: 'LOW_CONFIDENCE_MUST',
        message: `"${safeExcerpt(requirement.title, 40)}" is a MUST but low confidence. Worth confirming before planning around it.`,
        path: `requirements[${String(index)}].confidence`,
      });
    }
  }

  return issues;
}

/**
 * Conflict detection against what the user already told us.
 *
 * Gap-spec §12.2's examples are all the same shape: the AI asserting something that contradicts a
 * user-confirmed fact. The rule is the provenance trust ordering — a claim may only overwrite a
 * value of *lower* trust, and an AI claim never outranks a user confirmation.
 *
 * Equal trust is also a conflict, not a silent win for whichever arrived last.
 */
function checkConflicts(
  response: InterchangeResponse,
  intake: readonly IntakeField[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const byFieldId = new Map(intake.map((f) => [f.fieldId, f]));

  for (const [index, claim] of (response.claims ?? []).entries()) {
    const existing = byFieldId.get(claim.fieldId);
    if (existing === undefined) continue;

    // Nothing to conflict with: the user has no answer here, which is exactly what was asked about.
    if (
      existing.state === 'UNANSWERED' ||
      existing.state === 'UNKNOWN' ||
      existing.state === 'EXTERNAL_RESEARCH_REQUIRED'
    ) {
      continue;
    }

    const sameValue = JSON.stringify(existing.value) === JSON.stringify(claim.value);
    if (sameValue) continue;

    if (!canOverwrite(existing.provenance, claim.provenance)) {
      const definition = findField(claim.fieldId);
      issues.push({
        layer: 'CONFLICT',
        // An ERROR, not a warning. Gap-spec §12.2 requires rejection or explicit resolution, and
        // applying it silently is the exact failure the provenance system exists to prevent.
        severity: 'ERROR',
        code:
          existing.state === 'CONFIRMED' ? 'CONTRADICTS_CONFIRMED_FACT' : 'CONTRADICTS_USER_INPUT',
        message:
          existing.state === 'CONFIRMED'
            ? `The response contradicts something you confirmed: ${definition?.label ?? claim.fieldId}. Yours stands unless you change it.`
            : `The response disagrees with your answer for ${definition?.label ?? claim.fieldId}. Choose which to keep.`,
        path: `claims[${String(index)}]`,
      });
    }
  }

  return issues;
}

/**
 * Content-level security checks.
 *
 * The realistic threat is not code execution — nothing here evaluates the payload. It is that a
 * response carries text engineered to be read as an instruction by a *later* consumer: a summary
 * rendered into a document, a value shown to another model, a string interpolated into a report.
 * Prompt injection travels through data, and this is where the data enters.
 */
function detectUnsafeContent(response: InterchangeResponse): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const INJECTION_PATTERNS: readonly { pattern: RegExp; code: string; what: string }[] = [
    {
      pattern: /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions/i,
      code: 'PROMPT_INJECTION',
      what: 'an attempt to override instructions',
    },
    {
      pattern: /\bdisregard\s+(?:the\s+)?(?:system|previous)\b/i,
      code: 'PROMPT_INJECTION',
      what: 'an attempt to override instructions',
    },
    {
      pattern: /<\s*script\b/i,
      code: 'SCRIPT_CONTENT',
      what: 'a script tag',
    },
    {
      pattern: /\bjavascript:\s*\S/i,
      code: 'SCRIPT_CONTENT',
      what: 'a javascript: URL',
    },
    {
      pattern: /\bdata:text\/html\b/i,
      code: 'SCRIPT_CONTENT',
      what: 'an inline HTML data URL',
    },
    {
      pattern: /-----BEGIN(?:[A-Z ]+)?PRIVATE KEY-----/,
      code: 'CREDENTIAL_IN_RESPONSE',
      what: 'a private key',
    },
  ];

  const walk = (value: unknown, path: string): void => {
    if (typeof value === 'string') {
      for (const { pattern, code, what } of INJECTION_PATTERNS) {
        if (pattern.test(value)) {
          issues.push({
            layer: 'POLICY_SECURITY',
            severity: 'ERROR',
            code,
            // The matched text is deliberately not quoted — echoing an injection payload into the
            // UI and the logs is the thing being defended against.
            message: `The response contains ${what}. It has been rejected without being applied.`,
            path,
          });
        }
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        walk(item, `${path}[${String(index)}]`);
      });
      return;
    }

    if (typeof value === 'object' && value !== null) {
      for (const [key, item] of Object.entries(value)) {
        walk(item, path === '' ? key : `${path}.${key}`);
      }
    }
  };

  walk(response, '');
  return issues;
}

function checkCompleteness(response: InterchangeResponse): ValidationIssue[] {
  const usable =
    (response.claims?.length ?? 0) +
    (response.requirements?.length ?? 0) +
    (response.risks?.length ?? 0) +
    (response.phases?.length ?? 0);

  if (usable === 0) {
    return [
      {
        layer: 'COMPLETENESS',
        severity: 'WARNING',
        code: 'NOTHING_USABLE',
        message:
          'The response parsed correctly but contains nothing to import — no claims, requirements, risks or phases.',
      },
    ];
  }

  return [];
}

/** Guard for callers that must not proceed on an unvalidated result. */
export function assertMaterializable(result: ValidationResult): void {
  if (!result.canMaterialize) {
    throw new AppError({
      code: 'IMPORT_NOT_MATERIALIZABLE',
      category: 'VALIDATION',
      safeMessage: 'This response has not passed validation and cannot be applied.',
      details: { status: result.status, errorCount: result.issues.length },
    });
  }
}
