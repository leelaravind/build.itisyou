/**
 * Provenance tests.
 * Contract: MASTER_IMPLEMENTATION_PLAN.md section 11.2 - "The UI must never present
 * assumption/inference as confirmed fact." Gap-spec section 12.2 - a lower-trust claim must never
 * silently overwrite a user-confirmed one.
 */

import { describe, it, expect } from 'vitest';
import {
  PROVENANCE_CLASSES,
  canOverwrite,
  canPresentAsFact,
  isProvenanceClass,
  requiresQualifier,
  trustRank,
  type ProvenanceClass,
} from '../src/provenance.ts';

describe('presentation rules', () => {
  it('permits only user-confirmed and deterministic values to be shown as fact', () => {
    expect(canPresentAsFact('USER_CONFIRMED')).toBe(true);
    expect(canPresentAsFact('DETERMINISTIC_CALCULATION')).toBe(true);
  });

  it.each([
    'EXTERNAL_AI_INFERENCE',
    'ASSUMPTION',
    'FUTURE_ML_PREDICTION',
    'EXTERNAL_SOURCE',
    'USER_PROVIDED',
  ] as const)('refuses to present %s as fact', (provenance) => {
    expect(canPresentAsFact(provenance)).toBe(false);
  });

  it('requires a visible qualifier for everything not presentable as fact', () => {
    // The two sets must partition the space: anything not assertable must be visibly qualified,
    // otherwise a class could slip through unlabelled.
    for (const provenance of PROVENANCE_CLASSES) {
      expect(
        canPresentAsFact(provenance) !== requiresQualifier(provenance),
        `${provenance} must be either presentable as fact or require a qualifier, not both/neither`,
      ).toBe(true);
    }
  });

  it('never lets an AI inference be presented as fact', () => {
    // The single most important rule in the file: this is the product's honesty guarantee.
    expect(canPresentAsFact('EXTERNAL_AI_INFERENCE')).toBe(false);
    expect(requiresQualifier('EXTERNAL_AI_INFERENCE')).toBe(true);
  });
});

describe('trust ordering', () => {
  it('ranks user-confirmed above every other class', () => {
    for (const provenance of PROVENANCE_CLASSES) {
      if (provenance === 'USER_CONFIRMED') continue;
      expect(trustRank('USER_CONFIRMED')).toBeGreaterThan(trustRank(provenance));
    }
  });

  it('ranks deterministic calculation above every external input', () => {
    expect(trustRank('DETERMINISTIC_CALCULATION')).toBeGreaterThan(trustRank('EXTERNAL_SOURCE'));
    expect(trustRank('DETERMINISTIC_CALCULATION')).toBeGreaterThan(
      trustRank('EXTERNAL_AI_INFERENCE'),
    );
    expect(trustRank('DETERMINISTIC_CALCULATION')).toBeGreaterThan(trustRank('ASSUMPTION'));
  });

  it('ranks a cited source above an unsourced AI inference', () => {
    expect(trustRank('EXTERNAL_SOURCE')).toBeGreaterThan(trustRank('EXTERNAL_AI_INFERENCE'));
  });

  it('ranks future ML predictions lowest, so they can never silently win', () => {
    for (const provenance of PROVENANCE_CLASSES) {
      if (provenance === 'FUTURE_ML_PREDICTION') continue;
      expect(trustRank('FUTURE_ML_PREDICTION')).toBeLessThan(trustRank(provenance));
    }
  });

  it('assigns a distinct rank to every class so ordering is total', () => {
    const ranks = PROVENANCE_CLASSES.map(trustRank);
    expect(new Set(ranks).size).toBe(PROVENANCE_CLASSES.length);
  });
});

describe('overwrite rules', () => {
  it('refuses to let an AI inference overwrite a user-confirmed value', () => {
    // Gap-spec section 12.2: "user says budget = GBP 20,000 but AI says GBP 200,000 as fact" must
    // not resolve in the AI's favour.
    expect(canOverwrite('USER_CONFIRMED', 'EXTERNAL_AI_INFERENCE')).toBe(false);
  });

  it('refuses to let an assumption overwrite anything the user supplied', () => {
    expect(canOverwrite('USER_CONFIRMED', 'ASSUMPTION')).toBe(false);
    expect(canOverwrite('USER_PROVIDED', 'ASSUMPTION')).toBe(false);
  });

  it('allows a higher-trust class to overwrite a lower one', () => {
    expect(canOverwrite('ASSUMPTION', 'USER_CONFIRMED')).toBe(true);
    expect(canOverwrite('EXTERNAL_AI_INFERENCE', 'USER_PROVIDED')).toBe(true);
    expect(canOverwrite('ASSUMPTION', 'DETERMINISTIC_CALCULATION')).toBe(true);
  });

  it('treats equal trust as a conflict rather than resolving by arrival order', () => {
    // Two user-confirmed values that disagree is a genuine conflict for the user to settle.
    for (const provenance of PROVENANCE_CLASSES) {
      expect(canOverwrite(provenance, provenance)).toBe(false);
    }
  });

  it('is antisymmetric across every pair', () => {
    for (const a of PROVENANCE_CLASSES) {
      for (const b of PROVENANCE_CLASSES) {
        if (a === b) continue;
        expect(
          canOverwrite(a, b) && canOverwrite(b, a),
          `${a}/${b} must not overwrite each other`,
        ).toBe(false);
      }
    }
  });
});

describe('class guard', () => {
  it.each(PROVENANCE_CLASSES)('recognises %s', (provenance) => {
    expect(isProvenanceClass(provenance)).toBe(true);
  });

  it.each([['NOT_A_CLASS'], [''], [null], [undefined], [42], [{}]])('rejects %s', (value) => {
    expect(isProvenanceClass(value)).toBe(false);
  });
});

describe('taxonomy completeness', () => {
  it('declares exactly the seven classes the plan requires', () => {
    const required: ProvenanceClass[] = [
      'USER_CONFIRMED',
      'USER_PROVIDED',
      'EXTERNAL_SOURCE',
      'EXTERNAL_AI_INFERENCE',
      'ASSUMPTION',
      'DETERMINISTIC_CALCULATION',
      'FUTURE_ML_PREDICTION',
    ];

    expect([...PROVENANCE_CLASSES].sort()).toEqual([...required].sort());
  });
});
