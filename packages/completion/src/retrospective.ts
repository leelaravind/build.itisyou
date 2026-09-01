/**
 * Retrospectives and lessons.
 *
 * The reason most retrospective records are worthless is not that people write them badly. It is that
 * the format does not demand the thing that makes a lesson transferable, so what gets recorded is a
 * feeling — "communication could have been better", "we underestimated" — and a feeling cannot be
 * applied to the next project by somebody who was not on this one.
 *
 * A lesson that transfers has four parts, and each one is refused if missing:
 *
 * 1. What was **expected**. Without it there is no way to tell whether the outcome was surprising.
 * 2. What actually **happened**.
 * 3. **Why** they differed — the part that is usually skipped, and the only part with any predictive
 *    value.
 * 4. What would be done **differently**, stated as an action somebody could take rather than an
 *    intention somebody could hold.
 *
 * The fourth is the hardest to enforce and the most important. "Be more careful with estimates" is
 * an intention. "Size unknowns before committing to a date, or commit to a range" is an action. The
 * check here catches the most common intention-shaped phrasings, and it is advisory rather than
 * blocking, because a rule that rejects real writing gets worked around.
 *
 * Contract: `MASTER_IMPLEMENTATION_PLAN.md` Phase 14.
 */

/* -------------------------------------------------------------------------- */
/* Lessons                                                                    */
/* -------------------------------------------------------------------------- */

export const LESSON_CATEGORIES = [
  'ESTIMATION',
  'SCOPE',
  'REQUIREMENTS',
  'ARCHITECTURE',
  'DELIVERY',
  'QUALITY',
  'SECURITY',
  'PEOPLE',
  'PROCESS',
  'EXTERNAL',
] as const;

export type LessonCategory = (typeof LESSON_CATEGORIES)[number];

/**
 * Whether the lesson is about something that went well or badly.
 *
 * `WORKED` is not decoration. A retrospective that records only failures teaches the next team what
 * to avoid and nothing about what to repeat, and it makes the exercise something people dread — which
 * is how retrospectives stop happening.
 */
export const LESSON_KINDS = ['WORKED', 'DID_NOT_WORK', 'SURPRISED_US'] as const;

export type LessonKind = (typeof LESSON_KINDS)[number];

export interface Lesson {
  readonly id: string;
  readonly category: LessonCategory;
  readonly kind: LessonKind;
  /** What was expected. Without it nothing below can be judged as surprising or not. */
  readonly expected: string;
  readonly happened: string;
  /** Why they differed. The part usually skipped, and the only part with predictive value. */
  readonly why: string;
  /** What would be done differently, as an action rather than an intention. */
  readonly differently: string;
  /**
   * Node or evidence ids supporting this.
   *
   * A lesson with nothing behind it is somebody's recollection of a project under pressure, and
   * recollections of pressure are reliably wrong about sequence and cause.
   */
  readonly evidence: readonly string[];
}

export const LESSON_DEFECTS = [
  'NO_EXPECTATION',
  'NO_CAUSE',
  'NOT_ACTIONABLE',
  'NO_EVIDENCE',
  'NOT_TRANSFERABLE',
] as const;

export type LessonDefect = (typeof LESSON_DEFECTS)[number];

export interface LessonFinding {
  readonly defect: LessonDefect;
  readonly lessonId: string;
  readonly summary: string;
  readonly why: string;
  readonly blocking: boolean;
}

/**
 * Phrasings that describe an intention rather than an action.
 *
 * Short on purpose. A long list catches sentences that are fine in context, and a check that fires on
 * reasonable writing gets ignored — taking the useful cases with it. Every entry here is a phrase that
 * cannot be handed to somebody as a thing to do.
 */
const INTENTION_PHRASES = [
  'be more careful',
  'try to',
  'should have been better',
  'communicate better',
  'better communication',
  'more attention',
  'take more time',
  'be aware',
  'keep in mind',
  'remember to',
];

export function checkLesson(lesson: Lesson): readonly LessonFinding[] {
  const findings: LessonFinding[] = [];

  const at = (defect: LessonDefect, summary: string, why: string, blocking: boolean): void => {
    findings.push({ defect, lessonId: lesson.id, summary, why, blocking });
  };

  if (lesson.expected.trim() === '') {
    at(
      'NO_EXPECTATION',
      'Records what happened but not what was expected.',
      'Without the expectation there is no way to tell whether the outcome was a surprise, a known risk that materialised, or exactly what everybody predicted and nobody acted on. Those need completely different responses.',
      true,
    );
  }

  if (lesson.why.trim() === '') {
    at(
      'NO_CAUSE',
      'Records the difference but not why it happened.',
      'This is the part with predictive value, and it is the part that gets skipped. Without it the lesson describes one project and applies to none.',
      true,
    );
  }

  if (lesson.differently.trim() === '') {
    at(
      'NOT_ACTIONABLE',
      'Says nothing about what would be done differently.',
      'A lesson nobody can act on is a complaint. It may be entirely correct and it changes nothing.',
      true,
    );
  } else {
    const intention = INTENTION_PHRASES.find((phrase) =>
      lesson.differently.toLowerCase().includes(phrase),
    );

    if (intention !== undefined) {
      at(
        'NOT_TRANSFERABLE',
        `"${intention}" describes an intention rather than an action.`,
        'Somebody reading this on a different project cannot do it. "Be more careful with estimates" is an intention; "size unknowns before committing to a date, or commit to a range" is something a person can be handed.',
        // Advisory. A rule that rejects real writing gets worked around, and the workaround produces
        // worse lessons that pass the check.
        false,
      );
    }
  }

  if (lesson.evidence.length === 0) {
    at(
      'NO_EVIDENCE',
      'Nothing supports this.',
      'It is a recollection of a project under pressure, and recollections of pressure are reliably wrong about sequence and cause. The evidence is what lets somebody check the story rather than believe it.',
      false,
    );
  }

  return findings;
}

/* -------------------------------------------------------------------------- */
/* The retrospective                                                          */
/* -------------------------------------------------------------------------- */

export interface Retrospective {
  readonly projectId: string;
  readonly heldAt: string;
  /** Who was there. A retrospective by one person is a review, and it should say so. */
  readonly participants: readonly string[];
  readonly lessons: readonly Lesson[];
}

export const RETROSPECTIVE_DEFECTS = [
  'NO_LESSONS',
  'ONLY_FAILURES',
  'ONLY_SUCCESSES',
  'SINGLE_PARTICIPANT',
  'NARROW_CATEGORIES',
] as const;

export type RetrospectiveDefect = (typeof RETROSPECTIVE_DEFECTS)[number];

export interface RetrospectiveFinding {
  readonly defect: RetrospectiveDefect;
  readonly summary: string;
  readonly why: string;
  readonly blocking: boolean;
}

/**
 * What is wrong with the retrospective as a whole, as opposed to with individual lessons.
 *
 * These are the shapes that indicate the exercise did not really happen: nobody wrote anything, one
 * person wrote all of it, or every lesson is about the same thing — which usually means one loud
 * problem crowded out everything else in the room.
 */
export function checkRetrospective(retrospective: Retrospective): readonly RetrospectiveFinding[] {
  const findings: RetrospectiveFinding[] = [];

  if (retrospective.lessons.length === 0) {
    findings.push({
      defect: 'NO_LESSONS',
      summary: 'No lessons are recorded.',
      why: 'Every project teaches something. An empty retrospective means the exercise did not happen, or happened and nobody wrote it down — and the two are indistinguishable afterwards.',
      blocking: true,
    });

    return findings;
  }

  const kinds = new Set(retrospective.lessons.map((l) => l.kind));

  if (!kinds.has('WORKED')) {
    findings.push({
      defect: 'ONLY_FAILURES',
      summary: 'Nothing is recorded as having worked.',
      why: 'A retrospective recording only failures teaches the next team what to avoid and nothing about what to repeat. It also makes the exercise something people dread, which is how retrospectives stop happening.',
      blocking: false,
    });
  }

  if (!kinds.has('DID_NOT_WORK') && !kinds.has('SURPRISED_US')) {
    findings.push({
      defect: 'ONLY_SUCCESSES',
      summary: 'Nothing is recorded as having gone wrong or surprised anybody.',
      why: 'No project runs without surprises. A retrospective with none was either not safe to speak in, or was written for an audience rather than for the next team.',
      blocking: false,
    });
  }

  if (retrospective.participants.length <= 1) {
    findings.push({
      defect: 'SINGLE_PARTICIPANT',
      summary: 'One participant.',
      why: 'That is a review rather than a retrospective, and it should be labelled as one. A single account of what happened is a single perspective on it — which may be right, and cannot be checked.',
      blocking: false,
    });
  }

  const categories = new Set(retrospective.lessons.map((l) => l.category));

  if (retrospective.lessons.length >= 4 && categories.size === 1) {
    findings.push({
      defect: 'NARROW_CATEGORIES',
      summary: `Every lesson is about ${[...categories][0]?.toLowerCase() ?? 'one thing'}.`,
      why: 'Usually a sign that one loud problem crowded out everything else in the room. The other things that happened are still worth recording, and nobody will remember them by the next project.',
      blocking: false,
    });
  }

  return findings;
}

/**
 * Lessons worth carrying to another project.
 *
 * Filters to the ones that pass every blocking check, because those are the ones a stranger can act
 * on. A "lessons learned" export full of unactionable entries is why nobody reads them.
 */
export function transferableLessons(retrospective: Retrospective): readonly Lesson[] {
  return retrospective.lessons.filter(
    (lesson) => !checkLesson(lesson).some((finding) => finding.blocking),
  );
}
