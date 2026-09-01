/**
 * The external-AI interchange contract.
 *
 * Contract: plan §11 (versioned JSON Schema), §11.2 (provenance classes), gap-spec §12 (validation
 * layers), §11.2 (the external AI must mark assumptions, separate researched claims from inference,
 * include confidence and provenance, and **not include hidden chain-of-thought**).
 *
 * This schema is a **security boundary**, not a convenience. Everything arriving through it is
 * attacker-controlled: the user pastes text from a system this platform does not run, cannot
 * authenticate, and has no reason to trust. A response can be malformed, contradictory, hostile, or
 * simply confidently wrong — and the last of those is the most dangerous, because it looks fine.
 *
 * Three decisions follow from that:
 *
 * 1. **`.strict()` everywhere.** An unrecognised property is rejected rather than ignored. Silently
 *    dropping unknown fields is how a payload passes validation while carrying something the
 *    validator never examined.
 * 2. **Every claim must carry provenance and confidence.** Optional provenance would be omitted at
 *    exactly the call sites that matter, and then the UI could not tell the user which numbers were
 *    researched and which were invented.
 * 3. **Bounded everything.** Every string has a maximum length and every array a maximum size, so a
 *    payload cannot exhaust memory before the size check runs.
 */

import { z } from 'zod';
import { PROVENANCE_CLASSES, CONFIDENCE_LEVELS } from '@govintel/shared/provenance';

/** Maximum accepted payload, in bytes. Checked before parsing (gap-spec §12.1 layer 1). */
export const MAX_PAYLOAD_BYTES = 512 * 1024;

/** Bounds chosen to be generous for real responses and hostile to padding attacks. */
const MAX_ITEMS = 200;
const MAX_SHORT = 200;
const MAX_TEXT = 4_000;
const MAX_ID = 64;

/**
 * Identifiers the AI assigns to items so they can reference each other.
 *
 * Constrained to a conservative character set. These end up in URLs, log lines, DOM ids and SQL
 * parameters; an id containing a quote, an angle bracket or a newline is a problem waiting for a
 * context that forgets to escape it. Rejecting the character is cheaper than escaping it everywhere.
 */
const idSchema = z
  .string()
  .min(1)
  .max(MAX_ID)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'must be alphanumeric with dots, dashes or underscores');

const shortText = z.string().min(1).max(MAX_SHORT);
const longText = z.string().min(1).max(MAX_TEXT);

/**
 * Provenance the external AI must state for every claim.
 *
 * `USER_CONFIRMED` and `DETERMINISTIC_CALCULATION` are **excluded**: an external AI is not in a
 * position to assert either. Letting it claim `USER_CONFIRMED` would let a response launder an
 * invention into the highest trust tier, which is precisely the attack the provenance system exists
 * to prevent.
 */
export const AI_PROVENANCE_CLASSES = PROVENANCE_CLASSES.filter(
  (p) => p === 'EXTERNAL_SOURCE' || p === 'EXTERNAL_AI_INFERENCE' || p === 'ASSUMPTION',
);

const aiProvenanceSchema = z.enum(['EXTERNAL_SOURCE', 'EXTERNAL_AI_INFERENCE', 'ASSUMPTION']);
const confidenceSchema = z.enum(CONFIDENCE_LEVELS);

/**
 * A source citation.
 *
 * Only present for `EXTERNAL_SOURCE` claims, and required for them — a claim that says "researched"
 * with nothing to point at is inference wearing a better label.
 */
const sourceSchema = z
  .object({
    title: shortText,
    url: z.url().max(2_000).optional(),
    note: z.string().max(500).optional(),
  })
  .strict();

/**
 * One claim from the AI.
 *
 * `rationale` is deliberately short and is explicitly **not** chain-of-thought. Plan §11.2 instructs
 * the external AI not to include hidden reasoning, and this platform does not want it: storing a
 * model's internal deliberation would mean retaining a large volume of unverified text of unclear
 * provenance, attached to a customer's project, for no benefit the user can act on. What is useful
 * is the short answer to "why do you say that?", which is what this field holds.
 */
const claimSchema = z
  .object({
    fieldId: idSchema,
    /** JSON value. Bounded by the payload size check rather than by shape. */
    value: z.union([z.string().max(MAX_TEXT), z.number(), z.boolean(), z.array(shortText).max(50)]),
    provenance: aiProvenanceSchema,
    confidence: confidenceSchema,
    /** One or two sentences. Not chain-of-thought — see above. */
    rationale: z.string().max(1_000).optional(),
    sources: z.array(sourceSchema).max(10).optional(),
  })
  .strict();

export type InterchangeClaim = z.infer<typeof claimSchema>;

const requirementSchema = z
  .object({
    id: idSchema,
    title: shortText,
    description: longText.optional(),
    priority: z.enum(['MUST', 'SHOULD', 'COULD', 'WONT']),
    /** Ids of other requirements this one depends on. Validated for existence and cycles later. */
    dependsOn: z.array(idSchema).max(50).optional(),
    provenance: aiProvenanceSchema,
    confidence: confidenceSchema,
    rationale: z.string().max(1_000).optional(),
  })
  .strict();

const riskSchema = z
  .object({
    id: idSchema,
    title: shortText,
    description: longText.optional(),
    likelihood: z.enum(['LOW', 'MEDIUM', 'HIGH']),
    impact: z.enum(['LOW', 'MEDIUM', 'HIGH']),
    mitigation: longText.optional(),
    provenance: aiProvenanceSchema,
    confidence: confidenceSchema,
  })
  .strict();

const phaseSchema = z
  .object({
    id: idSchema,
    name: shortText,
    summary: longText.optional(),
    /** Ids of phases that must complete first. Cycle-checked during validation. */
    dependsOn: z.array(idSchema).max(50).optional(),
    /** Estimates are ranges, never single numbers (plan §12.3, no fake precision). */
    estimatedDays: z
      .object({
        low: z.number().int().min(0).max(10_000),
        high: z.number().int().min(0).max(10_000),
      })
      .strict()
      .optional(),
    provenance: aiProvenanceSchema,
    confidence: confidenceSchema,
  })
  .strict();

const assumptionSchema = z
  .object({
    id: idSchema,
    statement: longText,
    /** What breaks if the assumption is wrong. The reason an assumption register is worth keeping. */
    ifWrong: longText.optional(),
    confidence: confidenceSchema,
  })
  .strict();

const openQuestionSchema = z
  .object({
    id: idSchema,
    question: longText,
    /** The intake field this question relates to, when it maps to one. */
    relatesToFieldId: idSchema.optional(),
    whyItMatters: z.string().max(1_000).optional(),
  })
  .strict();

/**
 * The complete response.
 *
 * Every top-level section is optional except the version and the metadata: an AI that could only
 * answer half the questions should still be usable, and forcing it to emit empty arrays would
 * encourage it to invent content to fill them.
 */
export const interchangeResponseSchema = z
  .object({
    /** Must match a supported version. Checked before anything else is trusted. */
    schemaVersion: z.string().max(20),

    /** Which prompt this answers, so an import can be tied back to what was asked. */
    promptId: idSchema.optional(),

    /**
     * Project type the AI believes this is. Validated against the supported V1 taxonomy; an
     * unsupported value is reported rather than coerced (gap-spec §12.2).
     */
    projectType: z.string().max(64).optional(),

    claims: z.array(claimSchema).max(MAX_ITEMS).optional(),
    requirements: z.array(requirementSchema).max(MAX_ITEMS).optional(),
    risks: z.array(riskSchema).max(MAX_ITEMS).optional(),
    phases: z.array(phaseSchema).max(MAX_ITEMS).optional(),
    assumptions: z.array(assumptionSchema).max(MAX_ITEMS).optional(),
    openQuestions: z.array(openQuestionSchema).max(MAX_ITEMS).optional(),

    /** Free-text summary shown to the user before they accept. Never executed or interpreted. */
    summary: z.string().max(MAX_TEXT).optional(),
  })
  .strict();

export type InterchangeResponse = z.infer<typeof interchangeResponseSchema>;
export type InterchangeRequirement = z.infer<typeof requirementSchema>;
export type InterchangeRisk = z.infer<typeof riskSchema>;
export type InterchangePhase = z.infer<typeof phaseSchema>;
export type InterchangeAssumption = z.infer<typeof assumptionSchema>;
export type InterchangeOpenQuestion = z.infer<typeof openQuestionSchema>;

/** Project types the platform supports in V1 (gap-spec §4.1). */
export const SUPPORTED_PROJECT_TYPES = [
  'PUBLIC_WEB_APP',
  'SAAS_WEB_APP',
  'INTERNAL_BUSINESS_APP',
  'API_BACKEND_PLATFORM',
  'MOBILE_APP',
  'AI_ENABLED_WEB_APP',
  'DEVELOPER_TOOLING',
  'ECOMMERCE',
] as const;

export function isSupportedProjectType(value: string): boolean {
  return (SUPPORTED_PROJECT_TYPES as readonly string[]).includes(value);
}
