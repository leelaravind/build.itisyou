/**
 * External-AI prompt package.
 *
 * Contract: gap-spec §11.1 — the package must contain purpose, project context, confirmed facts,
 * unknowns, assumptions allowed, prohibited assumptions, missing questions, research requests,
 * source requirements, output schema, exact output restrictions and version identifiers. §11.2 lists
 * what the external AI must be instructed to do.
 *
 * **Provider-neutral by construction.** The output is text a person copies. Nothing here calls an
 * API, holds a key, or knows which model will read it — which is what makes plan §2.2's "no paid AI
 * API dependency in V1" true rather than aspirational, and what lets a user run it past a colleague
 * instead of a model if they prefer.
 *
 * The instructions are written to make the response *checkable*. Every constraint below corresponds
 * to something the validator enforces on the way back in: asking for provenance is pointless unless
 * a response without it is rejected, and it is. An instruction the validator does not enforce is a
 * polite request, and polite requests are not a security boundary.
 */

import type { MissingItem } from '@govintel/intake/missing';
import {
  currentVersions,
  INTERCHANGE_SCHEMA_VERSION,
  type InterchangeVersions,
} from './versions.ts';
import { summariseDataLeaving, type DataLeavingSummary } from './redaction.ts';

export interface ConfirmedFact {
  readonly fieldId: string;
  readonly label: string;
  readonly value: string;
  /** True when the user explicitly confirmed it, as opposed to merely typing it. */
  readonly confirmed: boolean;
}

export interface PromptPackageInput {
  readonly projectName: string;
  readonly projectSummary: string;
  readonly confirmedFacts: readonly ConfirmedFact[];
  /** Everything the user flagged as unknown or deferred. */
  readonly researchRequests: readonly MissingItem[];
  /** Values the platform assumed, which the AI may challenge but must not silently overwrite. */
  readonly assumptions: readonly { fieldId: string; label: string; value: string }[];
}

export interface PromptPackage {
  readonly promptId: string;
  readonly text: string;
  readonly versions: InterchangeVersions;
  readonly dataLeaving: DataLeavingSummary;
  /** Number of open questions the prompt asks about. Zero means there is nothing to research. */
  readonly questionCount: number;
}

/**
 * Build the one-shot prompt package.
 *
 * Every free-text value is redacted before it reaches the output, so the returned `text` is already
 * safe to copy. The summary describes what was found, for the copy-safety screen — the user sees
 * what is going *and* what was taken out.
 */
export function buildPromptPackage(input: PromptPackageInput, promptId: string): PromptPackage {
  /*
   * The project name is redacted like everything else, and it was not.
   *
   * It was forwarded raw into the rendered text as `Name: …` and never appeared in the
   * data-leaving summary — so the one field the user always fills in, before they have been told
   * anything about redaction, was the one field that left unexamined. It is free text typed on
   * `/start` in answer to "describe your project", which is exactly where a client name, a product
   * codename or an internal system name ends up.
   *
   * Worse than the leak itself was the accounting: plan §19 requires a *clear* summary of what
   * leaves the platform, and a summary that omits a field is not merely incomplete, it is wrong. It
   * told the user the name was not going.
   */
  const redactableFields = [
    { fieldId: 'project.name', text: input.projectName },
    { fieldId: 'project.summary', text: input.projectSummary },
    ...input.confirmedFacts.map((f) => ({ fieldId: f.fieldId, text: f.value })),
    ...input.assumptions.map((a) => ({ fieldId: a.fieldId, text: a.value })),
  ];

  const { redacted, summary } = summariseDataLeaving(redactableFields);
  const byFieldId = new Map(redacted.map((r) => [r.fieldId, r.text]));

  const safeName = byFieldId.get('project.name') ?? '';
  const safeSummary = byFieldId.get('project.summary') ?? '';
  const safeFacts = input.confirmedFacts.map((f) => ({
    ...f,
    value: byFieldId.get(f.fieldId) ?? f.value,
  }));
  const safeAssumptions = input.assumptions.map((a) => ({
    ...a,
    value: byFieldId.get(a.fieldId) ?? a.value,
  }));

  const text = render({
    projectName: safeName,
    projectSummary: safeSummary,
    confirmedFacts: safeFacts,
    researchRequests: input.researchRequests,
    assumptions: safeAssumptions,
    promptId,
  });

  return {
    promptId,
    text,
    versions: currentVersions(),
    dataLeaving: summary,
    questionCount: input.researchRequests.length,
  };
}

function render(input: PromptPackageInput & { promptId: string }): string {
  const facts =
    input.confirmedFacts.length === 0
      ? '  (none recorded yet)'
      : input.confirmedFacts
          .map(
            (f) =>
              `  - ${f.label}: ${f.value}${f.confirmed ? '  [CONFIRMED BY THE USER — do not contradict]' : ''}`,
          )
          .join('\n');

  const questions =
    input.researchRequests.length === 0
      ? '  (none — the user answered everything)'
      : input.researchRequests
          .map(
            (q, i) =>
              `  ${String(i + 1)}. [${q.fieldId}] ${q.label}\n     Why it matters: ${q.rationale}`,
          )
          .join('\n');

  const assumptions =
    input.assumptions.length === 0
      ? '  (none)'
      : input.assumptions.map((a) => `  - ${a.label}: ${a.value}`).join('\n');

  return `# Project research request

You are helping plan a software project. Everything below was provided by the person who owns it.

## Purpose

Answer the open questions in section 4, then return a single JSON object matching the schema in
section 6. The answers feed a deterministic planning engine, so the format matters as much as the
content.

## 1. Project

Name: ${input.projectName}
Summary: ${input.projectSummary}

## 2. Confirmed facts

These come from the project owner. Anything marked CONFIRMED BY THE USER is settled: you may note a
concern about it in \`openQuestions\`, but you must not contradict it, restate it with a different
value, or include it as a claim of your own. A response that changes a confirmed fact will be
rejected.

${facts}

## 3. Assumptions already made

The platform assumed these to proceed. You may challenge any of them — say so in \`openQuestions\` —
but do not silently replace them.

${assumptions}

## 4. Open questions

The owner marked these as unknown or asked for them to be researched. These are what you are here
for.

${questions}

## 5. How to answer

- **Ask first if you must.** If something critical is genuinely ambiguous, ask the person before
  producing the final JSON. One clarifying exchange is better than a confident wrong answer.
- **Do not invent facts.** If you do not know, say so in \`openQuestions\` rather than guessing.
- **Mark every claim.** Each item carries \`provenance\` and \`confidence\`:
  - \`EXTERNAL_SOURCE\` — you found this in an identifiable source. **Cite it** in \`sources\`.
  - \`EXTERNAL_AI_INFERENCE\` — your own reasoning. Legitimate; just label it honestly.
  - \`ASSUMPTION\` — you assumed it so the rest would hang together.
- **Confidence is \`LOW\`, \`MEDIUM\` or \`HIGH\`**, and should reflect the evidence, not your tone.
- **Ranges, not false precision.** Estimates use \`{ low, high }\`. A single number implies a
  certainty that does not exist.
- **No hidden reasoning.** Do not include chain-of-thought. \`rationale\` is one or two sentences
  answering "why do you say that?" — nothing longer is wanted or stored.
- **Return only the JSON object.** No prose before it, no prose after it, no markdown fence.

## 6. Output schema

Return exactly one JSON object of this shape. Unknown properties are rejected.

\`\`\`json
{
  "schemaVersion": "${INTERCHANGE_SCHEMA_VERSION}",
  "promptId": "${input.promptId}",
  "projectType": "PUBLIC_WEB_APP | SAAS_WEB_APP | INTERNAL_BUSINESS_APP | API_BACKEND_PLATFORM | MOBILE_APP | AI_ENABLED_WEB_APP | DEVELOPER_TOOLING | ECOMMERCE",
  "claims": [
    {
      "fieldId": "one of the [bracketed] ids in section 4",
      "value": "string | number | boolean | string[]",
      "provenance": "EXTERNAL_SOURCE | EXTERNAL_AI_INFERENCE | ASSUMPTION",
      "confidence": "LOW | MEDIUM | HIGH",
      "rationale": "one or two sentences",
      "sources": [{ "title": "...", "url": "https://..." }]
    }
  ],
  "requirements": [
    {
      "id": "REQ-001",
      "title": "...",
      "description": "...",
      "priority": "MUST | SHOULD | COULD | WONT",
      "dependsOn": ["REQ-002"],
      "provenance": "...",
      "confidence": "..."
    }
  ],
  "risks": [
    {
      "id": "RSK-001",
      "title": "...",
      "likelihood": "LOW | MEDIUM | HIGH",
      "impact": "LOW | MEDIUM | HIGH",
      "mitigation": "...",
      "provenance": "...",
      "confidence": "..."
    }
  ],
  "phases": [
    {
      "id": "PH-001",
      "name": "...",
      "dependsOn": ["PH-000"],
      "estimatedDays": { "low": 5, "high": 12 },
      "provenance": "...",
      "confidence": "..."
    }
  ],
  "assumptions": [
    { "id": "ASM-001", "statement": "...", "ifWrong": "...", "confidence": "..." }
  ],
  "openQuestions": [
    { "id": "Q-001", "question": "...", "relatesToFieldId": "...", "whyItMatters": "..." }
  ],
  "summary": "a short paragraph the project owner will read"
}
\`\`\`

## 7. Rules that will cause rejection

- \`schemaVersion\` other than \`${INTERCHANGE_SCHEMA_VERSION}\`.
- Any property not in the schema above.
- A claim, requirement, risk or phase missing \`provenance\` or \`confidence\`.
- \`provenance: "EXTERNAL_SOURCE"\` with no \`sources\`.
- Duplicate ids within a section.
- \`dependsOn\` pointing at an id that does not exist, or forming a cycle.
- Contradicting a fact marked CONFIRMED BY THE USER.
- Anything other than the JSON object in the response.
`;
}

/**
 * Whether there is anything worth asking about.
 *
 * A prompt with no open questions wastes the user's time and invites the model to fill the silence
 * with invention, which is the failure mode this whole workflow exists to avoid.
 */
export function hasSomethingToAsk(researchRequests: readonly MissingItem[]): boolean {
  return researchRequests.length > 0;
}
