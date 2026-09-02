/**
 * Import staging and prompt-package tests.
 *
 * Contract: gap-spec §12.3 (RAW → PARSED → VALIDATED → ACCEPTED → MATERIALIZED, never mutating the
 * canonical project during validation), §48 (idempotent materialisation), §11.1 (prompt package
 * contents), §11.3 (copy-safety screen), plan §19 (external-AI policy modes and redaction).
 *
 * The state machine is the reason an AI response cannot reach the Project Digital Twin by accident.
 * Every test below is really asking the same question: is there any sequence of legitimate-looking
 * calls that gets untrusted content into the project without validation and a human decision?
 */

import { describe, it, expect } from 'vitest';
import { AppError } from '@govintel/shared/errors';
import type { IntakeField } from '@govintel/intake/schema';
import {
  IMPORT_STATES,
  acceptStagedImport,
  canTransition,
  createStagedImport,
  isTerminal,
  materializeStagedImport,
  previewImport,
  rejectStagedImport,
  validateStagedImport,
} from '../src/staging.ts';
import { buildPromptPackage, hasSomethingToAsk } from '../src/prompt.ts';
import { evaluatePolicy, redactField, summariseDataLeaving } from '../src/redaction.ts';
import { INTERCHANGE_SCHEMA_VERSION } from '../src/versions.ts';

const CONTEXT = { intake: [] as IntakeField[] };

function validRaw(): string {
  return JSON.stringify({
    schemaVersion: INTERCHANGE_SCHEMA_VERSION,
    claims: [
      { fieldId: 'team.size', value: 5, provenance: 'EXTERNAL_AI_INFERENCE', confidence: 'MEDIUM' },
    ],
  });
}

function staged(raw = validRaw()) {
  return createStagedImport({ importId: 'imp-1', projectId: 'proj-1', raw });
}

describe('the state machine forbids shortcuts', () => {
  it('starts in RAW', () => {
    expect(staged().state).toBe('RAW');
  });

  it('has no path from RAW straight to MATERIALIZED', () => {
    // The absence of this edge is the control: no sequence of calls can reach the project without
    // passing through validation and a human decision.
    expect(canTransition('RAW', 'MATERIALIZED')).toBe(false);
  });

  it('has no path from VALIDATED straight to MATERIALIZED', () => {
    expect(canTransition('VALIDATED', 'MATERIALIZED')).toBe(false);
  });

  it('permits only ACCEPTED to materialise', () => {
    for (const state of IMPORT_STATES) {
      expect(canTransition(state, 'MATERIALIZED')).toBe(state === 'ACCEPTED');
    }
  });

  it('makes MATERIALIZED terminal', () => {
    expect(isTerminal('MATERIALIZED')).toBe(true);
  });

  it('makes REJECTED terminal', () => {
    expect(isTerminal('REJECTED')).toBe(true);
  });

  it('allows rejection from every non-terminal state', () => {
    for (const state of IMPORT_STATES) {
      if (isTerminal(state)) continue;
      expect(canTransition(state, 'REJECTED'), `${state} cannot be rejected`).toBe(true);
    }
  });

  it('refuses to accept an import that has not been validated', () => {
    expect(() => acceptStagedImport(staged(), 'user-1')).toThrow(AppError);
  });

  it('refuses to materialise an import that has not been accepted', () => {
    const validated = validateStagedImport(staged(), CONTEXT);
    expect(() => materializeStagedImport(validated)).toThrow(AppError);
  });

  it('refuses to materialise twice', () => {
    // Gap-spec §48: a replayed request must not apply a second time. MATERIALIZED has no outgoing
    // edges, so the second attempt throws rather than duplicating the effect.
    const done = materializeStagedImport(
      acceptStagedImport(validateStagedImport(staged(), CONTEXT), 'user-1'),
    );

    expect(() => materializeStagedImport(done)).toThrow(AppError);
  });

  it('refuses to accept an import after it was rejected', () => {
    const rejected = rejectStagedImport(validateStagedImport(staged(), CONTEXT), 'user-1', 'no');
    expect(() => acceptStagedImport(rejected, 'user-1')).toThrow(AppError);
  });
});

describe('validation does not touch the project', () => {
  it('moves to VALIDATED and records the result', () => {
    const result = validateStagedImport(staged(), CONTEXT);

    expect(result.state).toBe('VALIDATED');
    expect(result.validation?.status).toBe('VALID');
  });

  it('reaches VALIDATED even when the payload is rejected', () => {
    // "Validated" means the checks ran, not that they passed. Conflating the two would leave a
    // rejected import stuck with nowhere to record why.
    const result = validateStagedImport(staged('{ broken'), CONTEXT);

    expect(result.state).toBe('VALIDATED');
    expect(result.validation?.status).toBe('INVALID');
  });

  it('refuses to accept a rejected payload', () => {
    const validated = validateStagedImport(staged('{ broken'), CONTEXT);
    expect(() => acceptStagedImport(validated, 'user-1')).toThrow(AppError);
  });

  it('keeps the raw text verbatim as evidence', () => {
    const raw = '```json\n' + validRaw() + '\n```';
    const result = validateStagedImport(staged(raw), CONTEXT);

    // The wrapper is tolerated for parsing but the submission is retained exactly as pasted.
    expect(result.raw).toBe(raw);
  });

  it('returns a new object rather than mutating', () => {
    // A staged import is a record of what happened; rewriting it in place would lose the prior
    // state that made the next transition legal.
    const original = staged();
    const validated = validateStagedImport(original, CONTEXT);

    expect(original.state).toBe('RAW');
    expect(validated).not.toBe(original);
  });

  it('records who decided, for the audit trail', () => {
    const accepted = acceptStagedImport(validateStagedImport(staged(), CONTEXT), 'user-42');
    expect(accepted.decidedBy).toBe('user-42');
  });

  it('records why an import was rejected', () => {
    const rejected = rejectStagedImport(
      validateStagedImport(staged(), CONTEXT),
      'user-1',
      'Budget looks wrong',
    );

    expect(rejected.decisionReason).toBe('Budget looks wrong');
  });
});

describe('preview shows the consequence without causing it', () => {
  it('counts what would be created', () => {
    const raw = JSON.stringify({
      schemaVersion: INTERCHANGE_SCHEMA_VERSION,
      claims: [
        { fieldId: 'team.size', value: 5, provenance: 'EXTERNAL_AI_INFERENCE', confidence: 'LOW' },
      ],
      requirements: [
        {
          id: 'R1',
          title: 'x',
          priority: 'MUST',
          provenance: 'EXTERNAL_AI_INFERENCE',
          confidence: 'HIGH',
        },
      ],
      risks: [
        {
          id: 'K1',
          title: 'y',
          likelihood: 'LOW',
          impact: 'HIGH',
          provenance: 'EXTERNAL_AI_INFERENCE',
          confidence: 'LOW',
        },
      ],
    });

    const preview = previewImport(validateStagedImport(staged(raw), CONTEXT));

    expect(preview.claimCount).toBe(1);
    expect(preview.requirementCount).toBe(1);
    expect(preview.riskCount).toBe(1);
  });

  it('separates cited claims from unverified ones', () => {
    // The preview is where the user decides. Showing "3 claims" without saying how many are guesses
    // would hide the thing they most need to weigh.
    const raw = JSON.stringify({
      schemaVersion: INTERCHANGE_SCHEMA_VERSION,
      claims: [
        {
          fieldId: 'team.size',
          value: 5,
          provenance: 'EXTERNAL_SOURCE',
          confidence: 'HIGH',
          sources: [{ title: 'Report' }],
        },
        { fieldId: 'budget.total', value: 1, provenance: 'ASSUMPTION', confidence: 'LOW' },
      ],
    });

    const preview = previewImport(validateStagedImport(staged(raw), CONTEXT));

    expect(preview.citedClaimCount).toBe(1);
    expect(preview.unverifiedClaimCount).toBe(1);
  });

  it('is empty for an import that never parsed', () => {
    const preview = previewImport(validateStagedImport(staged('{ broken'), CONTEXT));
    expect(preview.claimCount).toBe(0);
  });

  it('lists the fields an import would fill', () => {
    const preview = previewImport(validateStagedImport(staged(), CONTEXT));
    expect(preview.fillsFields).toEqual(['team.size']);
  });
});

describe('redaction before anything leaves', () => {
  it.each([
    ['a private key', 'key: -----BEGIN RSA PRIVATE KEY-----\nMIIE'],
    ['an API key', 'token sk-abcdefghijklmnopqrstuvwxyz012345'],
    ['a GitHub token', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'],
    ['a connection string', 'postgres://admin:hunter2@db.example.com:5432/app'],
    ['a bearer token', 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345'],
    ['an email address', 'contact alice@example.com for access'],
    ['an internal hostname', 'deployed on billing.internal today'],
  ])('removes %s', (_label, text) => {
    const result = redactField('f', text);

    expect(result.changed).toBe(true);
    expect(result.detected[0]?.redacted).toBe(true);
  });

  it('leaves ordinary project text alone', () => {
    const result = redactField('f', 'A reporting tool for accountancy firms in the UK.');
    expect(result.changed).toBe(false);
    expect(result.detected).toHaveLength(0);
  });

  it('flags source code without removing it', () => {
    // Over-redacting here would gut the prompt; the user is told and decides.
    const result = redactField('f', 'We call SELECT * FROM invoices WHERE paid = false');

    expect(result.detected.some((d) => d.kind === 'Source code')).toBe(true);
    expect(result.detected.find((d) => d.kind === 'Source code')?.redacted).toBe(false);
  });

  it('removes every occurrence, not just the first', () => {
    const result = redactField('f', 'a@example.com and b@example.com');
    expect(result.text).not.toContain('@example.com');
  });

  it('reports which field a finding came from', () => {
    // The user has to go and look at it, so "somewhere in your project" is not good enough.
    const { summary } = summariseDataLeaving([
      { fieldId: 'stack.existing', text: 'db at postgres://u:p@h/db' },
    ]);

    expect(summary.detected[0]?.fieldId).toBe('stack.existing');
  });

  it('marks a summary containing credentials as restricted', () => {
    const { summary } = summariseDataLeaving([
      { fieldId: 'a', text: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' },
    ]);

    expect(summary.hasRestricted).toBe(true);
    expect(summary.redactedCount).toBeGreaterThan(0);
  });

  it('lists every field that will be sent', () => {
    const { summary } = summariseDataLeaving([
      { fieldId: 'a', text: 'one' },
      { fieldId: 'b', text: 'two' },
    ]);

    expect(summary.includedFields).toEqual(['a', 'b']);
  });
});

describe('external-AI policy is enforced server-side', () => {
  const cleanSummary = {
    includedFields: [],
    detected: [],
    hasRestricted: false,
    redactedCount: 0,
    flaggedCount: 0,
  };

  it('blocks the workflow entirely when the organisation disabled it', () => {
    // A UI that merely hides the button is not a policy.
    const decision = evaluatePolicy('DISABLED', cleanSummary);

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('turned off');
  });

  it('allows a clean prompt under USER_CHOICE', () => {
    expect(evaluatePolicy('USER_CHOICE', cleanSummary).allowed).toBe(true);
  });

  it('blocks under REDACTED_ONLY when something could not be removed automatically', () => {
    const decision = evaluatePolicy('REDACTED_ONLY', { ...cleanSummary, flaggedCount: 1 });
    expect(decision.allowed).toBe(false);
  });

  it('allows under REDACTED_ONLY when everything was removed', () => {
    const decision = evaluatePolicy('REDACTED_ONLY', { ...cleanSummary, redactedCount: 3 });
    expect(decision.allowed).toBe(true);
  });
});

describe('the prompt package', () => {
  const input = {
    projectName: 'Compliance reporting',
    projectSummary: 'A reporting tool for accountancy firms.',
    confirmedFacts: [
      { fieldId: 'budget.total', label: 'What is the budget?', value: '£20,000', confirmed: true },
    ],
    researchRequests: [
      {
        fieldId: 'compliance.regimes',
        label: 'Are there compliance obligations?',
        rationale: 'The platform tracks evidence against them.',
        importance: 'OPTIONAL' as const,
        reason: 'USER_DOES_NOT_KNOW' as const,
      },
    ],
    assumptions: [{ fieldId: 'budget.currency', label: 'Which currency?', value: 'GBP' }],
  };

  it('redacts the project name, and counts it in the data-leaving summary', () => {
    /*
     * The name used to be forwarded raw into the rendered text and omitted from the summary
     * entirely — so the one field every user fills in, before they have been told anything about
     * redaction, was the one field that left unexamined.
     *
     * The accounting was the worse half. Plan §19 requires a *clear* summary of what leaves the
     * platform; one that omits a field is not incomplete, it is wrong, because it told the user the
     * name was not going.
     */
    const pkg = buildPromptPackage(
      {
        ...input,
        projectName: 'Reporting tool for Acme Ltd, contact sarah.jones@acme.example',
      },
      'prompt-1',
    );

    expect(pkg.text).not.toContain('sarah.jones@acme.example');
    expect(pkg.dataLeaving.includedFields).toContain('project.name');
  });

  it('states the schema version the response must use', () => {
    const pkg = buildPromptPackage(input, 'prompt-1');
    expect(pkg.text).toContain(INTERCHANGE_SCHEMA_VERSION);
  });

  it('marks confirmed facts so the AI cannot contradict them', () => {
    const pkg = buildPromptPackage(input, 'prompt-1');
    expect(pkg.text).toContain('CONFIRMED BY THE USER');
  });

  it('includes the open questions', () => {
    const pkg = buildPromptPackage(input, 'prompt-1');
    expect(pkg.text).toContain('Are there compliance obligations?');
  });

  it('states what will cause a rejection', () => {
    // An instruction the validator does not enforce is a polite request. Listing the rejection
    // rules is what makes the response checkable rather than merely requested.
    const pkg = buildPromptPackage(input, 'prompt-1');
    expect(pkg.text).toContain('Rules that will cause rejection');
  });

  it('tells the AI not to include hidden reasoning', () => {
    const pkg = buildPromptPackage(input, 'prompt-1');
    expect(pkg.text).toMatch(/no hidden reasoning|chain-of-thought/i);
  });

  it('asks for ranges rather than single numbers', () => {
    const pkg = buildPromptPackage(input, 'prompt-1');
    expect(pkg.text).toMatch(/false precision|ranges/i);
  });

  it('redacts secrets out of the prompt text itself', () => {
    // The returned text is what the user copies. If a credential survives into it, everything else
    // about the copy-safety screen is decoration.
    const pkg = buildPromptPackage(
      {
        ...input,
        projectSummary: 'Connects to postgres://admin:hunter2@db.internal:5432/app',
      },
      'prompt-1',
    );

    expect(pkg.text).not.toContain('hunter2');
    expect(pkg.dataLeaving.hasRestricted).toBe(true);
  });

  it('reports what will leave the platform', () => {
    const pkg = buildPromptPackage(input, 'prompt-1');
    expect(pkg.dataLeaving.includedFields.length).toBeGreaterThan(0);
  });

  it('carries all four version identifiers', () => {
    const pkg = buildPromptPackage(input, 'prompt-1');

    expect(pkg.versions.schema).toBeDefined();
    expect(pkg.versions.promptTemplate).toBeDefined();
    expect(pkg.versions.ruleset).toBeDefined();
    expect(pkg.versions.validator).toBeDefined();
  });

  it('embeds the prompt id so a response can be tied back', () => {
    expect(buildPromptPackage(input, 'prompt-xyz').text).toContain('prompt-xyz');
  });

  it('is deterministic', () => {
    // Provider-neutral and deterministic: the same inputs produce the same prompt every time.
    expect(buildPromptPackage(input, 'p').text).toBe(buildPromptPackage(input, 'p').text);
  });

  it('knows when there is nothing worth asking', () => {
    // A prompt with no open questions wastes the user's time and invites the model to fill the
    // silence with invention.
    expect(hasSomethingToAsk([])).toBe(false);
    expect(hasSomethingToAsk(input.researchRequests)).toBe(true);
  });

  it('handles a project with no confirmed facts yet', () => {
    const pkg = buildPromptPackage({ ...input, confirmedFacts: [], assumptions: [] }, 'prompt-1');

    expect(pkg.text).toContain('none recorded yet');
  });
});

describe('round trip', () => {
  it('validates a response generated against its own prompt', () => {
    // The prompt advertises a schema; the validator enforces it. This asserts they agree — the two
    // drifting apart would mean users following the instructions exactly and still being rejected.
    const pkg = buildPromptPackage(
      {
        projectName: 'Test',
        projectSummary: 'A test project.',
        confirmedFacts: [],
        researchRequests: [],
        assumptions: [],
      },
      'prompt-1',
    );

    const response = JSON.stringify({
      schemaVersion: INTERCHANGE_SCHEMA_VERSION,
      promptId: pkg.promptId,
      projectType: 'SAAS_WEB_APP',
      claims: [
        {
          fieldId: 'team.size',
          value: 3,
          provenance: 'EXTERNAL_AI_INFERENCE',
          confidence: 'MEDIUM',
          rationale: 'Matches the described scope.',
        },
      ],
      requirements: [
        {
          id: 'REQ-001',
          title: 'Users can sign in',
          priority: 'MUST',
          provenance: 'EXTERNAL_AI_INFERENCE',
          confidence: 'HIGH',
        },
      ],
      phases: [
        {
          id: 'PH-001',
          name: 'Discovery',
          estimatedDays: { low: 5, high: 12 },
          provenance: 'EXTERNAL_AI_INFERENCE',
          confidence: 'MEDIUM',
        },
      ],
      openQuestions: [{ id: 'Q-001', question: 'Which regulator applies?' }],
      summary: 'A first pass at the plan.',
    });

    const result = validateStagedImport(
      createStagedImport({ importId: 'i', projectId: 'p', raw: response }),
      { intake: [], expectedPromptId: pkg.promptId },
    );

    expect(result.validation?.status).toBe('VALID');
    expect(result.validation?.canMaterialize).toBe(true);
  });

  it('completes the full lifecycle exactly once', () => {
    const initial = staged();
    const validated = validateStagedImport(initial, CONTEXT);
    const accepted = acceptStagedImport(validated, 'user-1');
    const materialized = materializeStagedImport(accepted);

    expect(materialized.state).toBe('MATERIALIZED');
    expect(() => materializeStagedImport(materialized)).toThrow(AppError);
  });
});
