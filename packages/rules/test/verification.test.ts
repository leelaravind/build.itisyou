/**
 * Deriving a verification method from what a rule already says.
 *
 * Contract: plan §10 (a requirement carries a way of being verified), gap-spec §13, and
 * `checkRequirement`'s own standard — a MUST with no method is a blocking `UNVERIFIABLE` finding.
 *
 * ## What these are guarding
 *
 * The alternative to this module was classifying 139 requirements by hand, which means 139 chances
 * to write down a plausible method nobody chose. The alternative to *these tests* is a derivation
 * that quietly drifts: a signal added for one rule changes the answer for eleven others, and every
 * answer still looks reasonable in a list. A wrong verification method is invisible by construction,
 * which is why the corpus assertions at the bottom pin the whole catalogue rather than a sample.
 */

import { describe, expect, it } from 'vitest';
import { VERIFICATION_METHODS as TRACEABILITY_METHODS } from '@govintel/traceability/requirements';
import { RULES } from '../src/catalogue.ts';
import { RULE_CATEGORIES } from '../src/schema.ts';
import {
  VERIFICATION_METHODS,
  classifyRequirement,
  deriveVerification,
} from '../src/verification.ts';

describe('the method vocabulary', () => {
  it('is the same list traceability defines', () => {
    /*
     * The copy exists so `@govintel/rules` does not take a runtime dependency on traceability to
     * read four strings. A copy is only acceptable while something checks it, because the failure
     * mode is a method this module emits and `checkRequirement` does not recognise.
     */
    expect([...VERIFICATION_METHODS]).toEqual([...TRACEABILITY_METHODS]);
  });
});

describe('the method comes from the head of the phrase', () => {
  it('reads a test as a test, and nothing else', () => {
    /*
     * The regression that matters most. Matching anywhere in the sentence made `configuration` an
     * inspection, so this requirement claimed two methods and one of them was invented. Measured
     * across the catalogue, that single mistake produced nine wrong classifications.
     */
    const derived = deriveVerification(
      'A test that startup fails on missing required configuration.',
    );

    expect(derived.methods).toEqual(['TEST']);
  });

  it.each([
    ['A migration test that builds the schema from empty.', 'schema'],
    ['A test asserting a triggered error returns no stack trace, query or internal path.', 'trace'],
    ['A test asserting the policy header and that a planted inline script does not run.', 'policy'],
    ['Contract tests validating responses against the published schema.', 'schema'],
    [
      'A test that attempts to modify and delete an audit record and asserts both are refused.',
      'record',
    ],
  ])('is TEST for %j despite the word %j appearing later', (verification) => {
    expect(deriveVerification(verification).methods).toEqual(['TEST']);
  });

  it.each([
    'A review of what the test suite mocks and why.',
    'A record of each quarantined test and what was found.',
    'Review of what a sample of tests would detect if the code were wrong.',
  ])('is INSPECTION for %j, which is about tests rather than run by them', (verification) => {
    // The subject is a review or a record. What it is *about* happens to be tests, which is not the
    // same thing as the method being a test — and reading it as one would be the mirror mistake.
    expect(deriveVerification(verification).methods).toEqual(['INSPECTION']);
  });
});

describe('a phrase naming two artefacts yields two methods', () => {
  it.each([
    [
      'A record of which accounts require it, and a test that a privileged sign-in demands it.',
      ['TEST', 'INSPECTION'],
    ],
    [
      'A review of what the binary contains, and server-side tests for each rule.',
      ['TEST', 'INSPECTION'],
    ],
    [
      'A static check plus tests sending injection payloads through each filterable endpoint.',
      ['TEST', 'ANALYSIS'],
    ],
  ])('splits %j', (verification, expected) => {
    expect(deriveVerification(verification).methods).toEqual(expected);
  });

  it('does not split a bare "and" joining two words', () => {
    /*
     * "non-ASCII names and text" is one noun phrase. Splitting on every "and" would make the second
     * half a clause of its own, and a clause naming no artefact reports an ambiguity that is not
     * there — noise that trains people to ignore the ambiguous list.
     */
    const derived = deriveVerification('Fixtures containing non-ASCII names and text.');

    expect(derived.methods).toEqual(['TEST']);
    expect(derived.ambiguous).toBe(false);
  });

  it('returns methods in the enum’s order, not the order the signals fired', () => {
    // Two rules whose prose says the same things must produce byte-identical requirements, or the
    // generator stops being deterministic and the golden fixtures fail for no reason.
    const a = deriveVerification('A static check plus tests.');
    const b = deriveVerification('Tests plus a static check.');

    expect(a.methods).toEqual(b.methods);
  });
});

describe('when the head names nothing, the rest of the clause is read', () => {
  it('finds the method after the subordinator', () => {
    // "A deployment pipeline" names no method on its own; "has been used for the last release" does.
    const derived = deriveVerification(
      'A deployment pipeline that has been used for the last release.',
    );

    expect(derived.methods).toEqual(['DEMONSTRATION']);
  });
});

describe('every decision explains itself', () => {
  it('names the signal behind each method', () => {
    const derived = deriveVerification(
      'A review of what the binary contains, and server-side tests for each rule.',
    );

    expect(derived.reasons).toHaveLength(2);
    for (const reason of derived.reasons) {
      expect(reason.why.length).toBeGreaterThan(10);
    }
  });

  it('reports prose that names no method rather than choosing one', () => {
    /*
     * The property that makes the whole thing trustworthy. A default here would mark a requirement
     * with a method nobody chose, and it would be indistinguishable afterwards from one that was
     * derived — which is the specific dishonesty this module was written to avoid.
     */
    const derived = deriveVerification('It is handled.');

    expect(derived.ambiguous).toBe(true);
    expect(derived.methods).toEqual([]);
    expect(derived.reasons).toEqual([]);
  });
});

describe('against the whole catalogue', () => {
  const emitted = RULES.flatMap((rule) =>
    rule.emittedRequirements.map((requirement) => ({
      ruleId: rule.id,
      verification: requirement.verification,
      derived: deriveVerification(requirement.verification),
    })),
  );

  it('has 139 requirements to derive from', () => {
    // If this ever reads zero the assertions below pass vacuously.
    expect(emitted).toHaveLength(139);
  });

  /**
   * The rules whose verification genuinely does not name a method.
   *
   * Exactly one, and it is a real judgement rather than a gap in the vocabulary: "CI uses a
   * frozen-lockfile install" is either an inspection of the pipeline configuration or a
   * demonstration of the pipeline behaving, and choosing between them is a decision for whoever owns
   * the rule. It is surfaced by `decompose` rather than resolved here.
   *
   * The list is asserted exactly, in both directions. A new rule that names no method must appear
   * here deliberately, and a signal change that accidentally resolves this one must be noticed.
   */
  const KNOWN_AMBIGUOUS = ['SEC-DEP-003'];

  it('derives a method for every requirement except the ones known to be ambiguous', () => {
    const ambiguous = emitted.filter((e) => e.derived.ambiguous).map((e) => e.ruleId);

    expect(ambiguous.sort()).toEqual([...KNOWN_AMBIGUOUS].sort());
  });

  it('never returns a method outside the vocabulary', () => {
    for (const { ruleId, derived } of emitted) {
      for (const method of derived.methods) {
        expect(VERIFICATION_METHODS, ruleId).toContain(method);
      }
    }
  });

  it('gives every derived method a reason', () => {
    for (const { ruleId, derived } of emitted) {
      expect(
        derived.reasons.map((r) => r.method),
        ruleId,
      ).toEqual(
        [...derived.methods].sort(
          (a, b) =>
            derived.reasons.findIndex((r) => r.method === a) -
            derived.reasons.findIndex((r) => r.method === b),
        ),
      );
    }
  });

  it('is deterministic', () => {
    for (const { ruleId, verification, derived } of emitted) {
      expect(deriveVerification(verification).methods, ruleId).toEqual(derived.methods);
    }
  });

  /*
   * The distribution, pinned.
   *
   * Not a vanity metric: a signal edited to fix one rule shifts these, and a shift is the earliest
   * visible sign that a change did more than intended. The numbers are what the catalogue actually
   * says, measured — 92 of the 139 name a test, which is what a catalogue of engineering rules
   * should look like.
   */
  it('assigns the methods the catalogue actually names', () => {
    const counts: Record<string, number> = {};

    for (const { derived } of emitted) {
      for (const method of derived.methods) counts[method] = (counts[method] ?? 0) + 1;
    }

    expect(counts).toEqual({ TEST: 92, INSPECTION: 42, ANALYSIS: 5, DEMONSTRATION: 6 });
  });

  it('gives most requirements exactly one method', () => {
    const multiple = emitted.filter((e) => e.derived.methods.length > 1);

    // Six name two artefacts joined by "and" or "plus"; one names three. Anything much larger would
    // mean the signals are firing on incidental words again.
    expect(multiple).toHaveLength(6);
  });
});

describe('what kind of requirement a category emits', () => {
  it('classifies every category', () => {
    for (const category of RULE_CATEGORIES) {
      expect(() => classifyRequirement(category), category).not.toThrow();
    }
  });

  it('pairs QUALITY_ATTRIBUTE with an attribute, and never otherwise', () => {
    /*
     * `checkRequirement` reports `KIND_MISMATCH` when these disagree, so getting it wrong would
     * emit 139 requirements each carrying a defect finding — noise that buries the real ones.
     */
    for (const category of RULE_CATEGORIES) {
      const { kind, qualityAttribute } = classifyRequirement(category);

      expect(kind === 'QUALITY_ATTRIBUTE', category).toBe(qualityAttribute !== undefined);
    }
  });

  it('never calls a governance obligation a feature', () => {
    // Nothing maps to FUNCTIONAL: none of these describe something the product does for a user.
    for (const category of RULE_CATEGORIES) {
      expect(classifyRequirement(category).kind, category).not.toBe('FUNCTIONAL');
    }
  });

  it('reads a security rule as a constraint rather than a quality attribute', () => {
    /*
     * The obvious reading of the word is QUALITY_ATTRIBUTE, and it is wrong here. That kind is
     * reserved for properties with a measure — "p95 under 200ms" — and a security obligation is a
     * limit on behaviour: "objects cannot be reached by users who do not own them". Classifying them
     * as quality attributes produced 46 blocking `UNMEASURED_QUALITY_ATTRIBUTE` findings, which is
     * the platform's own standard rejecting the classification.
     */
    expect(classifyRequirement('SECURITY')).toEqual({ kind: 'CONSTRAINT' });
  });

  it('never emits a quality attribute, because none of these carry a measure', () => {
    for (const category of RULE_CATEGORIES) {
      expect(classifyRequirement(category).kind, category).not.toBe('QUALITY_ATTRIBUTE');
    }
  });

  it('reads a governance rule as regulatory rather than as a constraint', () => {
    // A constraint is a limit the team accepted; a regulatory requirement is one imposed on it, and
    // governance rules exist because somebody outside the team requires them.
    expect(classifyRequirement('GOVERNANCE').kind).toBe('REGULATORY');
  });
});
