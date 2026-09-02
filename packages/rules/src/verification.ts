import type { RuleCategory } from './schema.ts';

/**
 * How a rule-emitted requirement is verified, decided from what the rule already says.
 *
 * Contract: plan §10 (a requirement carries a way of being verified), gap-spec §13 (a rule's
 * emissions are its output), and `packages/traceability`'s own standard — `checkRequirement` reports
 * `UNVERIFIABLE` for a requirement with no method, blocking when the requirement is a MUST.
 *
 * ## Why this is derivation and not classification
 *
 * The 139 requirements the catalogue emits each carry a `verification` string written by whoever
 * wrote the rule, and those strings are not vague. They read "A test that startup fails on missing
 * required configuration", "A review of which components write which tables", "Published
 * documentation". The method is already stated; it is stated in prose rather than as an enum member.
 *
 * So this reads what is there. It is not a heuristic that guesses a plausible method for a
 * requirement that never named one — that would be exactly the invented metadata this platform
 * exists to argue against, and it would be invisible afterwards, because a wrong method looks
 * identical to a right one.
 *
 * Three properties make that claim checkable rather than a hope:
 *
 * 1. **Every decision names the signal that produced it.** `why` carries the phrase that matched, so
 *    a wrong answer can be traced to the rule that produced it and fixed once.
 * 2. **Nothing is defaulted.** Prose that states no method returns `AMBIGUOUS` with its text, and the
 *    caller surfaces it. A default here would silently mark 139 requirements as inspectable.
 * 3. **The rule's category never selects a method.** It corroborates the *kind* of requirement, which
 *    is a different question. A TESTING-category rule whose verification says "a review" is an
 *    inspection, and the words win.
 */

/**
 * Mirrors `VERIFICATION_METHODS` in `@govintel/traceability`.
 *
 * Declared here rather than imported because `@govintel/rules` has no runtime dependency on
 * traceability and should not acquire one to read four strings. `verification.test.ts` asserts the
 * two lists are identical, so the copy cannot drift — which is the only reason a copy is acceptable.
 */
export const VERIFICATION_METHODS = ['TEST', 'INSPECTION', 'DEMONSTRATION', 'ANALYSIS'] as const;

export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];

export interface VerificationSignal {
  readonly method: VerificationMethod;
  readonly pattern: RegExp;
  /** Why this phrase means this method, in the vocabulary of the method's own definition. */
  readonly why: string;
}

/**
 * The vocabulary, and what each phrase commits to.
 *
 * Anchored on the artefact or activity being described, not on incidental words. `\btest` matches
 * "a test that…" and "tests covering…"; it must not match "the latest release", which is why every
 * pattern is word-bounded and most require the noun in subject position near the start.
 *
 * Order is irrelevant to correctness — every signal is evaluated and all matches contribute — but it
 * is kept in method order so the list reads as a definition rather than as a priority scheme.
 */
export const VERIFICATION_SIGNALS: readonly VerificationSignal[] = [
  /* -- TEST: something runs and passes or fails ---------------------------- */
  {
    method: 'TEST',
    pattern: /\btests?\b/i,
    why: 'names a test, which runs and either passes or fails',
  },
  {
    method: 'TEST',
    pattern: /\b(test )?(suite|pack)\b/i,
    why: 'names a suite or pack of tests',
  },
  {
    method: 'TEST',
    pattern: /\basserts?(ing|ion)?\b/i,
    why: 'asserts an outcome, which is what a test does',
  },
  {
    method: 'TEST',
    pattern: /\bautomated\b/i,
    why: 'is automated, and an automated check runs and reports',
  },
  {
    method: 'TEST',
    pattern: /\bcheck (that|for|asserting)\b/i,
    why: 'checks that something holds, which passes or fails',
  },
  {
    method: 'TEST',
    pattern: /\b(fixtures?|(boundary|edge|test) cases?)\b/i,
    why: 'names the inputs a test is run against',
  },

  /* -- INSPECTION: someone reads the artefact ------------------------------ */
  {
    method: 'INSPECTION',
    pattern: /\breview\b/i,
    why: 'is a review, which is a person reading an artefact against the requirement',
  },
  {
    method: 'INSPECTION',
    pattern: /\brecord(s|ed|ing)?\b/i,
    why: 'names a record, which is read rather than run',
  },
  {
    method: 'INSPECTION',
    pattern: /\bdocument(ation|ed)?\b/i,
    why: 'names a document, which is read rather than run',
  },
  {
    method: 'INSPECTION',
    pattern: /\b(inventory|matrix|mapping|register|list(ing)?)\b/i,
    why: 'names an enumeration somebody reads against the requirement',
  },
  {
    method: 'INSPECTION',
    pattern: /\bpolicy\b/i,
    why: 'names a policy, which is read',
  },
  {
    method: 'INSPECTION',
    pattern: /\bconfigur(ed|ation)\b/i,
    why: 'is a configuration, and a configuration is verified by reading it',
  },
  {
    method: 'INSPECTION',
    pattern: /\b(signed|acceptance|sign-?off)\b/i,
    why: 'names something a person put their name to, which is read',
  },
  {
    method: 'INSPECTION',
    pattern: /\b(rota|roster|schema|estimate|basis|threshold|pinning)\b/i,
    why: 'names a recorded artefact somebody reads against the requirement',
  },

  /* -- ANALYSIS: reasoned from the design, where exercising it is impractical */
  {
    method: 'ANALYSIS',
    pattern: /\b(static (check|analysis)|scanner?|scanning)\b/i,
    why: 'reasons over the artefact without exercising it',
  },
  {
    method: 'ANALYSIS',
    pattern: /\btraceabilit(y|ies)\b|\btraces? to\b/i,
    why: 'follows relationships through the model rather than running anything',
  },
  {
    method: 'ANALYSIS',
    pattern: /\bgenerated\b/i,
    why: 'is derived from the code rather than exercised',
  },

  /* -- DEMONSTRATION: shown working to somebody who can judge --------------- */
  {
    method: 'DEMONSTRATION',
    pattern: /\b(proven|proof|shown|demonstrat(e|ed|ion)|successfully)\b/i,
    why: 'is shown working to somebody who can judge it',
  },
  {
    method: 'DEMONSTRATION',
    pattern: /\b(pipeline|deployment|release)\b.*\b(promotes|used?|performed)\b/i,
    why: 'is exhibited by a pipeline or a release doing it, observed rather than asserted',
  },
];

/**
 * The artefacts a verification string names, one per clause.
 *
 * Split only on an explicit conjunction between clauses — ", and", ", plus", " plus " — never on a
 * bare "and", which joins words far more often than it joins clauses ("non-ASCII names and text").
 */
function clausesOf(verification: string): readonly string[] {
  return verification
    .split(/,\s*(?:and|plus|or)\s+|\s+plus\s+|\.\s+/i)
    .map((clause) => clause.trim())
    .filter((clause) => clause !== '');
}

/**
 * The head noun phrase of a clause: what the verification *is*, before it says what it does.
 *
 * Ends at the first subordinator, because everything after one describes the subject rather than
 * naming a second artefact. "An architecture record showing the payment path" is a record; what it
 * shows is not a second method.
 */
function headOf(clause: string): string {
  const subordinator =
    /\b(that|which|whose|who|showing|containing|asserting|covering|listing|verifying|validating|running|attempting|simulating|sending|feeding|issuing|logging|repeating|by|for|against|across|alongside|from|of|with|per)\b/i;

  const match = subordinator.exec(clause);

  return match === null ? clause : clause.slice(0, match.index);
}

export interface VerificationDerivation {
  /** Empty only when nothing matched, which is what `ambiguous` reports. */
  readonly methods: readonly VerificationMethod[];
  /** One entry per signal that fired, so a wrong answer is traceable to its cause. */
  readonly reasons: readonly { readonly method: VerificationMethod; readonly why: string }[];
  /** True when the prose names no method. Never resolved by guessing. */
  readonly ambiguous: boolean;
}

/**
 * Read the verification methods out of a rule's own words.
 *
 * Returns every method the prose supports, because several are often true at once and honestly so:
 * "A permissions matrix generated from the code, and tests per role" is an inspection of the matrix
 * *and* a test of the roles, and recording only one of those loses half the requirement.
 */
export function deriveVerification(verification: string): VerificationDerivation {
  const reasons: { method: VerificationMethod; why: string }[] = [];
  const seen = new Set<VerificationMethod>();

  const record = (signal: VerificationSignal): void => {
    if (seen.has(signal.method)) return;
    seen.add(signal.method);
    reasons.push({ method: signal.method, why: signal.why });
  };

  for (const clause of clausesOf(verification)) {
    /*
     * The head first, and usually only the head.
     *
     * Matching anywhere in the sentence reads the *object* as if it were the artefact: "a test that
     * startup fails on missing required configuration" is a test, and counting `configuration` made
     * it an inspection as well. Measured on the catalogue, that one mistake produced nine wrong
     * classifications — every one of which would have looked entirely reasonable in a list.
     */
    const head = headOf(clause);
    const inHead = VERIFICATION_SIGNALS.filter((s) => s.pattern.test(head));

    if (inHead.length > 0) {
      inHead.forEach(record);
      continue;
    }

    /*
     * Nothing in the head, so read the whole clause.
     *
     * "A deployment pipeline that has been used for the last release" names its method after the
     * subordinator, and refusing to look there would report an ambiguity that is not there. The head
     * is preferred, not required.
     */
    VERIFICATION_SIGNALS.filter((s) => s.pattern.test(clause)).forEach(record);
  }

  /*
   * Method order is the enum's, not the order the signals happened to fire in.
   *
   * Two rules whose prose says the same things must produce byte-identical requirements, or the
   * generator stops being deterministic and the golden fixtures start failing for no reason.
   */
  const methods = VERIFICATION_METHODS.filter((method) => seen.has(method));

  return { methods, reasons, ambiguous: methods.length === 0 };
}

/* -------------------------------------------------------------------------- */
/* What kind of requirement it is                                             */
/* -------------------------------------------------------------------------- */

export interface RequirementClassification {
  readonly kind: 'FUNCTIONAL' | 'QUALITY_ATTRIBUTE' | 'CONSTRAINT' | 'REGULATORY' | 'DATA';
  readonly qualityAttribute?:
    | 'PERFORMANCE'
    | 'AVAILABILITY'
    | 'SECURITY'
    | 'PRIVACY'
    | 'ACCESSIBILITY'
    | 'USABILITY'
    | 'MAINTAINABILITY'
    | 'COMPATIBILITY';
}

/**
 * The kind of requirement a rule in this category emits.
 *
 * This *is* decided by category, and legitimately: a rule's category is an editorial statement about
 * what the rule is about, made by the person who wrote it.
 *
 * **Nothing maps to `QUALITY_ATTRIBUTE`**, and that was a correction rather than a decision. Mapping
 * SECURITY and ACCESSIBILITY there was the obvious reading of the words and produced 46 blocking
 * `UNMEASURED_QUALITY_ATTRIBUTE` findings, because `checkRequirement` reserves that kind for
 * properties with a *measure* — "p95 under 200ms", not "objects cannot be reached by non-owners".
 * A rule-emitted obligation is a limit on behaviour or a conformance demand, and both have kinds of
 * their own. The platform's own standard caught the misclassification, which is the standard doing
 * its job.
 *
 * Nothing maps to `FUNCTIONAL` either. None of these describe a feature the product has, and
 * inventing a functional requirement from a governance rule would misfile every one of them.
 */
export function classifyRequirement(category: RuleCategory): RequirementClassification {
  switch (category) {
    case 'ACCESSIBILITY':
    case 'GOVERNANCE':
      /*
       * REGULATORY rather than CONSTRAINT: both exist because somebody outside the team requires
       * them, which is exactly the distinction the two kinds draw — a constraint is a limit the team
       * accepted, a regulatory requirement is one imposed on it. The generator already classifies
       * its own accessibility requirement this way, and disagreeing with it would put two
       * classifications of the same obligation in one graph.
       */
      return { kind: 'REGULATORY' };
    case 'INTAKE':
    case 'REQUIREMENTS':
      return { kind: 'DATA' };
    case 'SECURITY':
    case 'TESTING':
    case 'DOCUMENTATION':
    case 'OPERATIONS':
    case 'PRODUCTION_VERIFICATION':
    case 'ARCHITECTURE':
    case 'PLANNING':
    case 'RESOURCE':
    case 'BUDGET':
    case 'DEPLOYMENT':
      return { kind: 'CONSTRAINT' };
  }
}
