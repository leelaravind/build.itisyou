import { describe, expect, it } from 'vitest';
import { FIELD_DEFINITIONS } from '@govintel/intake/fields';
import { METHODOLOGIES, methodologyFromAnswer } from '../src/methodology.ts';

/**
 * The intake answer reaches the engine. Every evaluation passed a hard-coded AGILE, so a rule scoped to
 * Kanban delivery could never apply to anyone.
 */
describe('methodology from the intake answer', () => {
  const question = FIELD_DEFINITIONS.find((field) => field.id === 'team.methodology');

  it('is asked in the intake', () => {
    expect(question?.kind).toBe('select');
  });

  it('maps every option the intake offers to a distinct methodology', () => {
    const mapped = (question?.options ?? []).map((option) => methodologyFromAnswer(option));
    expect(new Set(mapped)).toEqual(new Set(METHODOLOGIES));
  });

  it('falls back to the recommended default when unanswered or unrecognised', () => {
    expect(methodologyFromAnswer(undefined)).toBe('AGILE');
    expect(methodologyFromAnswer(null)).toBe('AGILE');
    expect(methodologyFromAnswer('Something else')).toBe('AGILE');
    expect(methodologyFromAnswer(question?.recommendedDefault)).toBe('AGILE');
  });

  it('reads Kanban as Kanban, which the hard-coded value never could', () => {
    expect(methodologyFromAnswer('Kanban (continuous flow)')).toBe('KANBAN');
  });
});
