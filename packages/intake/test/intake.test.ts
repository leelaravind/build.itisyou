/**
 * Intake schema, field catalogue and missing-information engine tests.
 *
 * Contract: gap-spec §9 (every field supports five answer modes and carries value, state,
 * provenance, confidence, timestamp and confirmer), §10 (Critical/Recommended/Optional
 * classification), §10.4 (rule-driven, not hardcoded in the UI).
 *
 * The idea under test throughout: **"I don't know" is an answer, not a blank.** A conventional form
 * cannot distinguish "not reached", "genuinely unknown", "assume something sensible" and "research
 * this externally" — and those four require completely different downstream behaviour.
 */

import { describe, it, expect } from 'vitest';
import {
  ANSWER_MODES,
  ANSWER_MODE_TO_STATE,
  FIELD_STATES,
  INTAKE_CATEGORIES,
  answerField,
  confirmField,
  fieldStateForbidsValue,
  fieldStateRequiresValue,
  intakeFieldSchema,
  validateFieldInvariants,
  type IntakeField,
} from '../src/schema.ts';
import {
  FIELD_DEFINITIONS,
  criticalFields,
  fieldsForCategory,
  fieldsForMode,
  findField,
} from '../src/fields.ts';
import {
  analyseMissing,
  completionPercent,
  hasRecommendedDefault,
  nextQuestion,
} from '../src/missing.ts';

const NOW = new Date('2026-01-01T00:00:00Z');

function field(overrides: Partial<IntakeField> & Pick<IntakeField, 'fieldId'>): IntakeField {
  return {
    category: 'IDEA',
    value: 'something',
    state: 'PROVIDED',
    provenance: 'USER_PROVIDED',
    confidence: 'MEDIUM',
    lastUpdatedAt: NOW.toISOString(),
    ...overrides,
  };
}

describe('every question supports the five answer modes', () => {
  it.each(ANSWER_MODES)('accepts mode %s', (mode) => {
    const result = answerField({
      fieldId: 'idea.summary',
      category: 'IDEA',
      mode,
      value: 'a value',
      recommendedDefault: 'a default',
      now: NOW,
    });

    expect(FIELD_STATES).toContain(result.state);
  });

  it('maps every mode to a distinct meaning', () => {
    // Gap-spec §9.2 lists five modes; collapsing any two would lose information the AI prompt
    // package and the assumption register both depend on.
    const states = new Set(ANSWER_MODES.map((m) => ANSWER_MODE_TO_STATE[m]));
    expect(states.size).toBeGreaterThanOrEqual(4);
  });

  it('records "I don\'t know" as a resolved state, not as a blank', () => {
    const result = answerField({
      fieldId: 'budget.total',
      category: 'BUDGET',
      mode: 'I_DONT_KNOW',
      now: NOW,
    });

    expect(result.state).toBe('UNKNOWN');
    expect(result.state).not.toBe('UNANSWERED');
  });

  it('treats "unsure" as a low-confidence answer, not as unknown', () => {
    // The user did give a value; they are simply not certain. Discarding it would throw away a
    // usable answer, and confirming it would overstate what they said.
    const result = answerField({
      fieldId: 'budget.total',
      category: 'BUDGET',
      mode: 'UNSURE',
      value: 50_000,
      now: NOW,
    });

    expect(result.state).toBe('PROVIDED');
    expect(result.value).toBe(50_000);
    expect(result.confidence).toBe('LOW');
  });

  it('marks a recommended default as an assumption, never as a user answer', () => {
    // Plan §11.2: the UI must never present an assumption as confirmed fact.
    const result = answerField({
      fieldId: 'accessibility.target',
      category: 'ACCESSIBILITY',
      mode: 'USE_RECOMMENDED_DEFAULT',
      recommendedDefault: 'WCAG 2.2 AA',
      now: NOW,
    });

    expect(result.state).toBe('ASSUMED');
    expect(result.provenance).toBe('ASSUMPTION');
    expect(result.value).toBe('WCAG 2.2 AA');
  });

  it('records a research deferral without inventing a value', () => {
    const result = answerField({
      fieldId: 'compliance.regimes',
      category: 'COMPLIANCE',
      mode: 'DEFER_TO_EXTERNAL_RESEARCH',
      value: 'ignored',
      now: NOW,
    });

    expect(result.state).toBe('EXTERNAL_RESEARCH_REQUIRED');
    expect(result.value).toBeNull();
  });

  it('discards a value supplied alongside "I don\'t know"', () => {
    // The dangerous case: a stale value hiding behind an "unknown" label, which the UI would show
    // as unknown while the engine planned against the number underneath.
    const result = answerField({
      fieldId: 'budget.total',
      category: 'BUDGET',
      mode: 'I_DONT_KNOW',
      value: 999_999,
      now: NOW,
    });

    expect(result.value).toBeNull();
  });
});

describe('field invariants', () => {
  it('accepts a well-formed provided field', () => {
    expect(validateFieldInvariants(field({ fieldId: 'a' }))).toEqual([]);
  });

  it.each(['CONFIRMED', 'PROVIDED', 'ASSUMED', 'CONFLICTING'] as const)(
    'requires a value in state %s',
    (state) => {
      expect(fieldStateRequiresValue(state)).toBe(true);
    },
  );

  it.each(['UNKNOWN', 'UNANSWERED', 'EXTERNAL_RESEARCH_REQUIRED'] as const)(
    'forbids a value in state %s',
    (state) => {
      expect(fieldStateForbidsValue(state)).toBe(true);
    },
  );

  it('rejects an UNKNOWN field that still carries a value', () => {
    const problems = validateFieldInvariants(field({ fieldId: 'a', state: 'UNKNOWN', value: 42 }));
    expect(problems.join(' ')).toMatch(/must not carry a value/);
  });

  it('rejects a PROVIDED field with no value', () => {
    const problems = validateFieldInvariants(
      field({ fieldId: 'a', state: 'PROVIDED', value: null }),
    );
    expect(problems.join(' ')).toMatch(/requires a value/);
  });

  it('requires a confirmer on a CONFIRMED field', () => {
    const problems = validateFieldInvariants(
      field({ fieldId: 'a', state: 'CONFIRMED', provenance: 'USER_CONFIRMED' }),
    );
    expect(problems.join(' ')).toMatch(/confirmedBy/);
  });

  it('rejects a confirmer on a field that is not confirmed', () => {
    const problems = validateFieldInvariants(
      field({ fieldId: 'a', state: 'PROVIDED', confirmedBy: 'user-1' }),
    );
    expect(problems.join(' ')).toMatch(/only meaningful/);
  });

  it('requires ASSUMPTION provenance on an assumed field', () => {
    // An assumption recorded with any other provenance could be presented as fact.
    const problems = validateFieldInvariants(
      field({ fieldId: 'a', state: 'ASSUMED', provenance: 'USER_PROVIDED' }),
    );
    expect(problems.join(' ')).toMatch(/provenance ASSUMPTION/);
  });

  it('requires USER_CONFIRMED provenance on a confirmed field', () => {
    const problems = validateFieldInvariants(
      field({ fieldId: 'a', state: 'CONFIRMED', provenance: 'USER_PROVIDED', confirmedBy: 'u' }),
    );
    expect(problems.join(' ')).toMatch(/USER_CONFIRMED/);
  });

  it('validates against the zod schema', () => {
    expect(intakeFieldSchema.safeParse(field({ fieldId: 'a' })).success).toBe(true);
  });

  it('rejects an unknown state at the schema boundary', () => {
    const bad = { ...field({ fieldId: 'a' }), state: 'MAYBE' };
    expect(intakeFieldSchema.safeParse(bad).success).toBe(false);
  });
});

describe('confirmation is a distinct act', () => {
  it('promotes a provided field to confirmed', () => {
    const confirmed = confirmField(field({ fieldId: 'a' }), 'user-1', NOW);

    expect(confirmed.state).toBe('CONFIRMED');
    expect(confirmed.provenance).toBe('USER_CONFIRMED');
    expect(confirmed.confidence).toBe('HIGH');
    expect(confirmed.confirmedBy).toBe('user-1');
  });

  it('refuses to confirm a field with no value', () => {
    // Confirming an unknown is meaningless, and allowing it would let the UI manufacture certainty.
    expect(() =>
      confirmField(field({ fieldId: 'a', state: 'UNKNOWN', value: null }), 'u'),
    ).toThrow();
  });

  it('produces a field that passes its own invariants', () => {
    expect(validateFieldInvariants(confirmField(field({ fieldId: 'a' }), 'u', NOW))).toEqual([]);
  });
});

describe('field catalogue', () => {
  it('covers every category gap-spec §9.1 requires', () => {
    for (const category of INTAKE_CATEGORIES) {
      expect(fieldsForCategory(category).length, `no question for ${category}`).toBeGreaterThan(0);
    }
  });

  it('gives every field a stable id, label and rationale', () => {
    // The rationale is shown inline: a question with no stated purpose reads as bureaucracy.
    for (const definition of FIELD_DEFINITIONS) {
      expect(definition.id.length).toBeGreaterThan(0);
      expect(definition.label.length).toBeGreaterThan(0);
      expect(definition.rationale.length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate field ids', () => {
    const ids = FIELD_DEFINITIONS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives select fields their options', () => {
    for (const definition of FIELD_DEFINITIONS) {
      if (definition.kind === 'select' || definition.kind === 'multiSelect') {
        expect(definition.options?.length ?? 0, `${definition.id} has no options`).toBeGreaterThan(
          0,
        );
      }
    }
  });

  it('offers no recommended default for the project idea or deadline', () => {
    // Defaulting these would be inventing the project, or inventing pressure.
    expect(findField('idea.summary')?.recommendedDefault).toBeUndefined();
    expect(findField('deadline.target')?.recommendedDefault).toBeUndefined();
  });

  it('marks the fields that select a rule pack as critical', () => {
    const ids = criticalFields().map((f) => f.id);

    expect(ids).toContain('idea.summary');
    expect(ids).toContain('project.type');
    // Security and privacy rule packs key off these two; guessing either would mean guessing
    // whether the project needs, say, payment-card controls.
    expect(ids).toContain('data.types');
    expect(ids).toContain('security.authentication');
  });

  it('shows a beginner fewer questions than an enterprise user', () => {
    expect(fieldsForMode('beginner').length).toBeLessThan(fieldsForMode('enterprise').length);
  });

  it('never hides a critical question from a beginner', () => {
    // Progressive disclosure must not hide something that blocks generation.
    const beginner = new Set(fieldsForMode('beginner').map((f) => f.id));
    for (const definition of criticalFields()) {
      expect(beginner.has(definition.id), `${definition.id} is critical but hidden`).toBe(true);
    }
  });

  it('discloses monotonically across modes', () => {
    const beginner = new Set(fieldsForMode('beginner').map((f) => f.id));
    const professional = new Set(fieldsForMode('professional').map((f) => f.id));

    for (const id of beginner)
      expect(professional.has(id), `${id} vanishes above beginner`).toBe(true);
  });
});

describe('missing-information classification', () => {
  it('reports everything as missing for an empty intake', () => {
    const analysis = analyseMissing([]);

    expect(analysis.answeredCount).toBe(0);
    expect(analysis.critical.length).toBeGreaterThan(0);
  });

  it('blocks generation while a critical field is unanswered', () => {
    expect(analyseMissing([]).canGenerate).toBe(false);
  });

  it('does not block when the user has resolved every critical field', () => {
    // A user who says "I don't know" has made a decision. Blocking on that would make the product
    // unusable for exactly the inexperienced user it is meant to serve.
    const answers = criticalFields().map((d) =>
      answerField({ fieldId: d.id, category: d.category, mode: 'I_DONT_KNOW', now: NOW }),
    );

    expect(analyseMissing(answers).canGenerate).toBe(true);
  });

  it('does not block when a critical field was deferred to research', () => {
    const answers = criticalFields().map((d) =>
      answerField({
        fieldId: d.id,
        category: d.category,
        mode: 'DEFER_TO_EXTERNAL_RESEARCH',
        now: NOW,
      }),
    );

    expect(analyseMissing(answers).canGenerate).toBe(true);
  });

  it('still lists a resolved critical field as missing information', () => {
    // Resolved does not mean answered. It stays visible so the user can see what the plan rests on.
    const answers = criticalFields().map((d) =>
      answerField({ fieldId: d.id, category: d.category, mode: 'I_DONT_KNOW', now: NOW }),
    );

    expect(analyseMissing(answers).critical.length).toBe(criticalFields().length);
  });

  it('distinguishes unanswered from unknown in the reason', () => {
    const answers = [
      answerField({
        fieldId: 'project.type',
        category: 'PROJECT_TYPE',
        mode: 'I_DONT_KNOW',
        now: NOW,
      }),
    ];
    const analysis = analyseMissing(answers);

    const known = analysis.critical.find((i) => i.fieldId === 'project.type');
    const untouched = analysis.critical.find((i) => i.fieldId === 'idea.summary');

    expect(known?.reason).toBe('USER_DOES_NOT_KNOW');
    expect(untouched?.reason).toBe('UNANSWERED');
  });

  it('does not count an answered field as missing', () => {
    const answers = [
      answerField({
        fieldId: 'idea.summary',
        category: 'IDEA',
        mode: 'ANSWER',
        value: 'x',
        now: NOW,
      }),
    ];

    expect(analyseMissing(answers).critical.map((i) => i.fieldId)).not.toContain('idea.summary');
  });

  it('sorts items into the three importance tiers', () => {
    const analysis = analyseMissing([]);

    expect(analysis.critical.every((i) => i.importance === 'CRITICAL')).toBe(true);
    expect(analysis.recommended.every((i) => i.importance === 'RECOMMENDED')).toBe(true);
    expect(analysis.optional.every((i) => i.importance === 'OPTIONAL')).toBe(true);
  });
});

describe('research requests and assumptions', () => {
  it('routes unknowns into the external-AI research request', () => {
    const answers = [
      answerField({
        fieldId: 'compliance.regimes',
        category: 'COMPLIANCE',
        mode: 'I_DONT_KNOW',
        now: NOW,
      }),
    ];

    expect(analyseMissing(answers).researchRequests.map((i) => i.fieldId)).toContain(
      'compliance.regimes',
    );
  });

  it('routes explicit deferrals into the research request', () => {
    const answers = [
      answerField({
        fieldId: 'privacy.jurisdictions',
        category: 'PRIVACY',
        mode: 'DEFER_TO_EXTERNAL_RESEARCH',
        now: NOW,
      }),
    ];

    expect(analyseMissing(answers).researchRequests.map((i) => i.fieldId)).toContain(
      'privacy.jurisdictions',
    );
  });

  it('does not put merely-unanswered fields into the research request', () => {
    // Asking an external AI about a question the user has not even seen would be presumptuous, and
    // would pad the prompt with things they may be about to answer themselves.
    const analysis = analyseMissing([]);
    expect(analysis.researchRequests).toHaveLength(0);
  });

  it('lists assumptions separately so the plan can show what it rests on', () => {
    const answers = [
      answerField({
        fieldId: 'accessibility.target',
        category: 'ACCESSIBILITY',
        mode: 'USE_RECOMMENDED_DEFAULT',
        recommendedDefault: 'WCAG 2.2 AA',
        now: NOW,
      }),
    ];

    expect(analyseMissing(answers).assumptions.map((i) => i.fieldId)).toContain(
      'accessibility.target',
    );
  });

  it('does not treat an assumption as a research request', () => {
    // The user chose the default; there is nothing to research.
    const answers = [
      answerField({
        fieldId: 'accessibility.target',
        category: 'ACCESSIBILITY',
        mode: 'USE_RECOMMENDED_DEFAULT',
        recommendedDefault: 'WCAG 2.2 AA',
        now: NOW,
      }),
    ];

    expect(analyseMissing(answers).researchRequests).toHaveLength(0);
  });
});

describe('question ordering', () => {
  it('asks a critical question before a recommended one', () => {
    expect(nextQuestion([])?.importance).toBe('CRITICAL');
  });

  it('moves on once the critical questions are answered', () => {
    const answers = criticalFields().map((d) =>
      answerField({ fieldId: d.id, category: d.category, mode: 'ANSWER', value: 'x', now: NOW }),
    );

    expect(nextQuestion(answers)?.importance).not.toBe('CRITICAL');
  });

  it('returns undefined when nothing is left', () => {
    const answers = FIELD_DEFINITIONS.map((d) =>
      answerField({ fieldId: d.id, category: d.category, mode: 'ANSWER', value: 'x', now: NOW }),
    );

    expect(nextQuestion(answers)).toBeUndefined();
  });

  it('does not re-ask a question the user marked unknown', () => {
    const answers = FIELD_DEFINITIONS.map((d) =>
      answerField({ fieldId: d.id, category: d.category, mode: 'I_DONT_KNOW', now: NOW }),
    );

    expect(nextQuestion(answers)).toBeUndefined();
  });
});

describe('completion', () => {
  it('reports 0% for an untouched intake', () => {
    expect(completionPercent([])).toBe(0);
  });

  it('reports 100% when every question is resolved', () => {
    const answers = FIELD_DEFINITIONS.map((d) =>
      answerField({ fieldId: d.id, category: d.category, mode: 'ANSWER', value: 'x', now: NOW }),
    );

    expect(completionPercent(answers)).toBe(100);
  });

  it('counts a resolved unknown as progress', () => {
    // Scoring an honest "I don't know" as zero would mean the bar never fills for the user who is
    // being most candid about what they do not know.
    const answers = FIELD_DEFINITIONS.map((d) =>
      answerField({ fieldId: d.id, category: d.category, mode: 'I_DONT_KNOW', now: NOW }),
    );

    expect(completionPercent(answers)).toBe(100);
  });

  it('weights critical questions more heavily than optional ones', () => {
    // A bar reading 40% while every critical question is outstanding would be actively misleading.
    const criticalOnly = criticalFields().map((d) =>
      answerField({ fieldId: d.id, category: d.category, mode: 'ANSWER', value: 'x', now: NOW }),
    );

    const optionalDefs = FIELD_DEFINITIONS.filter((f) => f.importance === 'OPTIONAL').slice(
      0,
      criticalFields().length,
    );
    const optionalOnly = optionalDefs.map((d) =>
      answerField({ fieldId: d.id, category: d.category, mode: 'ANSWER', value: 'x', now: NOW }),
    );

    expect(completionPercent(criticalOnly)).toBeGreaterThan(completionPercent(optionalOnly));
  });
});

describe('recommended defaults', () => {
  it('offers a default where one is sensible', () => {
    expect(hasRecommendedDefault('accessibility.target')).toBe(true);
  });

  it('offers none for the project idea', () => {
    expect(hasRecommendedDefault('idea.summary')).toBe(false);
  });

  it('defaults accessibility to the accessible option', () => {
    // Accessibility retrofitted late costs several times what it costs designed in, so the default
    // is the one that keeps the option open.
    expect(findField('accessibility.target')?.recommendedDefault).toBe('WCAG 2.2 AA');
  });
});
