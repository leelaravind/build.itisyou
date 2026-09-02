/**
 * Turning an accepted response into changes to the project.
 *
 * Contract: gap-spec §12 (the import loop), §11.2 (provenance and confidence travel with a claim),
 * plan §17 (external AI is advisory, never authoritative).
 *
 * ## What was wrong
 *
 * Accepting an import set a status column and nothing else. The user copied the prompt out, ran it,
 * pasted the answer back, watched it validate, pressed accept — and every open question was still
 * open. The loop was open at the end that matters.
 *
 * These tests are mostly about what materialisation must *refuse* to do. Writing the answers is the
 * easy half; not overwriting a person with a model is the half worth testing.
 */

import { describe, expect, it } from 'vitest';
import { planMaterialisation, stateFor, type ExistingField } from '../src/materialise.ts';
import type { InterchangeResponse } from '../src/schema.ts';

const KNOWN = new Set(['team.size', 'compliance.regimes', 'accessibility.target']);
const TYPES = new Set(['PUBLIC_WEB_APP', 'SAAS_WEB_APP']);

function response(over: Partial<InterchangeResponse> = {}): InterchangeResponse {
  return { schemaVersion: '1.0.0', ...over };
}

function plan(over: {
  response?: Partial<InterchangeResponse>;
  existing?: readonly ExistingField[];
  currentProjectType?: string;
}) {
  return planMaterialisation({
    response: response(over.response),
    existing: over.existing ?? [],
    knownFieldIds: KNOWN,
    currentProjectType: over.currentProjectType ?? 'UNKNOWN',
    supportedProjectTypes: TYPES,
  });
}

describe('claims become answers', () => {
  it('applies a claim to a field nobody has answered', () => {
    const result = plan({
      response: {
        claims: [
          {
            fieldId: 'team.size',
            value: 6,
            provenance: 'EXTERNAL_AI_INFERENCE',
            confidence: 'MEDIUM',
            rationale: 'Typical for the scope described.',
          },
        ],
      },
    });

    expect(result.answers).toHaveLength(1);
    expect(result.answers[0]?.value).toBe(6);
    expect(result.answers[0]?.confidence).toBe('MEDIUM');
    expect(result.answers[0]?.note).toBe('Typical for the scope described.');
  });

  it('applies one to a field the user explicitly deferred for research', () => {
    // The entire purpose of the loop: EXTERNAL_RESEARCH_REQUIRED is the user asking for exactly this.
    const result = plan({
      response: {
        claims: [
          {
            fieldId: 'team.size',
            value: 6,
            provenance: 'EXTERNAL_AI_INFERENCE',
            confidence: 'LOW',
          },
        ],
      },
      existing: [{ fieldId: 'team.size', state: 'EXTERNAL_RESEARCH_REQUIRED' }],
    });

    expect(result.answers).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
  });

  it('applies one to a field the user said they did not know', () => {
    const result = plan({
      response: {
        claims: [{ fieldId: 'team.size', value: 6, provenance: 'ASSUMPTION', confidence: 'LOW' }],
      },
      existing: [{ fieldId: 'team.size', state: 'UNKNOWN' }],
    });

    expect(result.answers).toHaveLength(1);
  });
});

describe('what a model may not overwrite', () => {
  it.each(['CONFIRMED', 'PROVIDED'])('leaves a %s answer alone', (state) => {
    /*
     * The load-bearing rule. The prompt asks the model not to contradict the user and validation
     * rejects responses that do, but neither is a control — this is the layer that does not have to
     * trust the model at all.
     */
    const result = plan({
      response: {
        claims: [
          {
            fieldId: 'team.size',
            value: 99,
            provenance: 'EXTERNAL_SOURCE',
            confidence: 'HIGH',
          },
        ],
      },
      existing: [{ fieldId: 'team.size', state }],
    });

    expect(result.answers).toHaveLength(0);
    expect(result.skipped).toEqual([{ fieldId: 'team.size', reason: 'USER_ANSWERED' }]);
  });

  it('drops a claim against a field the platform does not have', () => {
    // An answer to a question nobody asks reaches no rule, no gate and no screen. It would sit in
    // the table looking exactly like an answer.
    const result = plan({
      response: {
        claims: [
          { fieldId: 'not.a.field', value: 'x', provenance: 'ASSUMPTION', confidence: 'LOW' },
        ],
      },
    });

    expect(result.answers).toHaveLength(0);
    expect(result.skipped).toEqual([{ fieldId: 'not.a.field', reason: 'UNKNOWN_FIELD' }]);
  });
});

describe('provenance survives the trip', () => {
  it.each([
    ['EXTERNAL_SOURCE', 'EXTERNAL_SOURCE'],
    ['EXTERNAL_AI_INFERENCE', 'EXTERNAL_AI_INFERENCE'],
    ['ASSUMPTION', 'ASSUMPTION'],
  ])('%s is stored as %s', (claimed, stored) => {
    /*
     * "It found a source" and "it reasoned it out" are different claims, and §11 spends a paragraph
     * asking the model to distinguish them. Collapsing them here would throw that away at the last
     * step — and in the direction that lets an inference be read as a cited fact.
     */
    const result = plan({
      response: {
        claims: [
          {
            fieldId: 'team.size',
            value: 6,
            provenance: claimed as 'EXTERNAL_SOURCE',
            confidence: 'HIGH',
          },
        ],
      },
    });

    expect(result.answers[0]?.provenance).toBe(stored);
  });

  it('never marks anything as confirmed by a user', () => {
    const result = plan({
      response: {
        claims: [
          {
            fieldId: 'team.size',
            value: 6,
            provenance: 'EXTERNAL_SOURCE',
            confidence: 'HIGH',
          },
        ],
      },
    });

    // `USER_CONFIRMED` would make an AI claim indistinguishable from something a person affirmed.
    expect(result.answers[0]?.provenance).not.toBe('USER_CONFIRMED');
    expect(result.answers[0]?.provenance).not.toBe('USER_PROVIDED');
  });

  it('gives a sourced claim a state that does not require ASSUMPTION provenance', () => {
    // `checkField` refuses `ASSUMED` unless provenance is `ASSUMPTION`, so mapping everything to
    // ASSUMED would force the provenance to be flattened.
    expect(stateFor('EXTERNAL_SOURCE')).toBe('PROVIDED');
    expect(stateFor('EXTERNAL_AI_INFERENCE')).toBe('PROVIDED');
    expect(stateFor('ASSUMPTION')).toBe('ASSUMED');
  });
});

describe('the project type', () => {
  it('is set when the project does not have one', () => {
    /*
     * Worth more than any single answer: while the type is UNKNOWN every type-scoped rule evaluates
     * as INDETERMINATE, so a project that never states its type escapes every type-specific
     * obligation in the catalogue.
     */
    const result = plan({ response: { projectType: 'SAAS_WEB_APP' } });
    expect(result.projectType).toBe('SAAS_WEB_APP');
  });

  it('is not changed when the project already has one', () => {
    const result = plan({
      response: { projectType: 'SAAS_WEB_APP' },
      currentProjectType: 'PUBLIC_WEB_APP',
    });

    expect(result.projectType).toBeUndefined();
  });

  it('is ignored when it is not a type this platform supports', () => {
    // Reported rather than coerced (§12.2). Coercing would silently plan the wrong kind of project.
    const result = plan({ response: { projectType: 'BLOCKCHAIN_THING' } });
    expect(result.projectType).toBeUndefined();
  });
});

describe('what is deliberately not applied', () => {
  it('counts the requirements, risks and phases it leaves alone', () => {
    /*
     * `generatePlan` deletes and rewrites every node it owns, so requirements written as nodes would
     * disappear the next time somebody rebuilt the plan — which reads as data loss, not as design.
     * Counted and reported so the user is told rather than left to notice.
     */
    const result = plan({
      response: {
        requirements: [
          {
            id: 'REQ-1',
            title: 'A requirement',
            priority: 'MUST',
            provenance: 'EXTERNAL_AI_INFERENCE',
            confidence: 'HIGH',
          },
        ],
        risks: [
          {
            id: 'RSK-1',
            title: 'A risk',
            likelihood: 'LOW',
            impact: 'HIGH',
            provenance: 'EXTERNAL_AI_INFERENCE',
            confidence: 'LOW',
          },
        ],
      },
    });

    expect(result.notApplied).toEqual({ requirements: 1, risks: 1, phases: 0 });
  });

  it('reports zero rather than nothing when the response carried none', () => {
    expect(plan({}).notApplied).toEqual({ requirements: 0, risks: 0, phases: 0 });
  });
});
