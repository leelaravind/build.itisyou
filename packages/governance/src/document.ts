/**
 * The document system.
 *
 * §30 sets a deliberate ceiling — structured rich text, versioned, one canonical version at a time,
 * optimistic concurrency, history, approval, entity links — and explicitly says *not* to build
 * real-time collaboration or a presence system. That restraint is the design, and it is worth
 * stating why rather than treating it as a corner cut: a governance platform's documents are read far
 * more than they are written, and usually written by one person at a time. Building for simultaneous
 * editors would spend most of the budget on the rarest case.
 *
 * §31 is where the interesting problem lives. Documents may be generated from project state, and:
 *
 * > canonical structured project data / human-readable generated document — **canonical data wins**.
 * > If user manually edits generated prose: preserve edits, do not silently overwrite, identify
 * > affected sections during regeneration, offer merge/update.
 *
 * Those two instructions pull in opposite directions, and resolving them badly gives you one of the
 * two failure modes every document generator has. Overwrite, and somebody's carefully worded
 * paragraph disappears without warning; the second time it happens they stop using the feature.
 * Never overwrite, and the document drifts from the project until it is actively misleading — which
 * is worse, because it still looks authoritative.
 *
 * The resolution is per-section provenance. A section nobody has touched regenerates silently. A
 * section somebody edited is never overwritten; instead regeneration produces a *proposal* naming
 * what the canonical data now says, and a person decides. Canonical data wins on the facts; the
 * human keeps their words until they choose otherwise.
 *
 * Contract: gap-spec §30, §31, §49 (optimistic concurrency).
 */

/* -------------------------------------------------------------------------- */
/* Sections                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Where a section's current content came from.
 *
 * The distinction that makes §31 implementable. Without it, regeneration has to choose one policy for
 * the whole document and both choices are wrong somewhere in it.
 */
export const SECTION_ORIGINS = ['GENERATED', 'EDITED', 'AUTHORED'] as const;

export type SectionOrigin = (typeof SECTION_ORIGINS)[number];

export const ORIGIN_MEANING: Readonly<Record<SectionOrigin, string>> = {
  GENERATED: 'Produced from project data and untouched since. Regenerates silently.',
  EDITED:
    'Generated once and then edited by a person. Never overwritten; regeneration proposes and a person decides.',
  AUTHORED:
    'Written by a person from the start. Nothing generates it, so nothing can overwrite it.',
};

export interface Section {
  readonly id: string;
  readonly heading: string;
  readonly body: string;
  readonly origin: SectionOrigin;
  /**
   * The generator that produced this, where one did.
   *
   * Kept on `EDITED` sections too — that is what lets regeneration know which generator's output the
   * person was editing, and therefore what to compare their version against.
   */
  readonly generator?: string;
  /**
   * Node ids this section describes. §30's entity links.
   *
   * Also what makes a section's staleness computable: when a linked node changes, this section is a
   * candidate for regeneration, and one nobody linked is not.
   */
  readonly links: readonly string[];
  /** The generated text as it stood when a person started editing. Never shown; used to diff. */
  readonly generatedBaseline?: string;
}

/* -------------------------------------------------------------------------- */
/* Documents                                                                  */
/* -------------------------------------------------------------------------- */

export const DOCUMENT_STATES = ['DRAFT', 'IN_REVIEW', 'APPROVED', 'SUPERSEDED'] as const;

export type DocumentState = (typeof DOCUMENT_STATES)[number];

export interface ProjectDocument {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly state: DocumentState;
  readonly sections: readonly Section[];
  /**
   * §30: one saved canonical version at a time, with optimistic concurrency.
   *
   * A save carrying a version other than the current one is refused rather than merged. Two people
   * editing prose at once is the case §30 says not to build for, and silently merging their text
   * would produce a document neither of them wrote.
   */
  readonly version: number;
  readonly updatedBy: string;
  readonly updatedAt: string;
}

export const DOCUMENT_REFUSALS = [
  'VERSION_CONFLICT',
  'APPROVED_DOCUMENT_IS_FROZEN',
  'UNKNOWN_SECTION',
  'NO_AUTHOR',
] as const;

export type DocumentRefusal = (typeof DOCUMENT_REFUSALS)[number];

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refusal: DocumentRefusal; readonly reason: string };

/* -------------------------------------------------------------------------- */
/* Editing                                                                    */
/* -------------------------------------------------------------------------- */

export interface Edit {
  readonly sectionId: string;
  readonly body: string;
  readonly editedBy: string;
  readonly editedAt: string;
  /** The version the editor was looking at. §49. */
  readonly baseVersion: number;
}

export function edit(document: ProjectDocument, change: Edit): Result<ProjectDocument> {
  if (document.state === 'APPROVED') {
    /*
     * An approved document is frozen for the same reason a baseline is: somebody signed off *this
     * text*. Editing in place would silently change what they approved, and their name would still be
     * on it.
     */
    return {
      ok: false,
      refusal: 'APPROVED_DOCUMENT_IS_FROZEN',
      reason:
        'This document is approved. Somebody signed off this text; editing it in place would change what they approved while leaving their name on it. Supersede it with a new version instead.',
    };
  }

  if (change.baseVersion !== document.version) {
    return {
      ok: false,
      refusal: 'VERSION_CONFLICT',
      reason: `You were editing version ${String(change.baseVersion)} and the document is now at version ${String(document.version)}. §30 keeps one canonical version at a time, and merging two people's prose automatically would produce a document neither of them wrote.`,
    };
  }

  if (change.editedBy.trim() === '') {
    return {
      ok: false,
      refusal: 'NO_AUTHOR',
      reason: 'An edit nobody made cannot be attributed, reverted or asked about.',
    };
  }

  const target = document.sections.find((s) => s.id === change.sectionId);

  if (target === undefined) {
    return {
      ok: false,
      refusal: 'UNKNOWN_SECTION',
      reason: `${change.sectionId} is not a section of this document. Creating it silently would let a typo produce a section nobody meant to add.`,
    };
  }

  return {
    ok: true,
    value: {
      ...document,
      version: document.version + 1,
      updatedBy: change.editedBy,
      updatedAt: change.editedAt,
      sections: document.sections.map((section) =>
        section.id === change.sectionId
          ? {
              ...section,
              body: change.body,
              // A generated section becomes edited the moment somebody touches it, and the text it
              // held at that moment is kept so regeneration can tell what they changed from.
              origin: section.origin === 'GENERATED' ? 'EDITED' : section.origin,
              ...(section.origin === 'GENERATED' && section.generatedBaseline === undefined
                ? { generatedBaseline: section.body }
                : {}),
            }
          : section,
      ),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Regeneration                                                               */
/* -------------------------------------------------------------------------- */

export const REGENERATION_OUTCOMES = ['UPDATED', 'UNCHANGED', 'PROPOSED', 'NOT_GENERATED'] as const;

export type RegenerationOutcome = (typeof REGENERATION_OUTCOMES)[number];

export interface SectionProposal {
  readonly sectionId: string;
  readonly heading: string;
  readonly outcome: RegenerationOutcome;
  /** What the generator now produces. Present on `UPDATED` and `PROPOSED`. */
  readonly proposed?: string;
  /** What the section currently holds. Present on `PROPOSED`, so a person can compare. */
  readonly current?: string;
  readonly explanation: string;
}

export interface RegenerationResult {
  /** The document with silently-regenerable sections updated. Edited ones are untouched. */
  readonly document: ProjectDocument;
  /** Every section's outcome, including the ones that did nothing. */
  readonly proposals: readonly SectionProposal[];
  /** Sections needing a person. The whole point of the return value. */
  readonly needsDecision: readonly SectionProposal[];
}

/**
 * Regenerate from project data, resolving §31's two instructions.
 *
 * Canonical data wins on the facts: a section nobody has touched is replaced with what the data now
 * says, silently, because there is nothing to lose.
 *
 * A section somebody edited is **never** overwritten. Regeneration produces a proposal showing what
 * the data now says beside what the section holds, and a person decides. That is what "preserve
 * edits, do not silently overwrite, offer merge/update" means, and it is the only reading that does
 * not either destroy somebody's writing or let the document drift into being confidently wrong.
 */
export function regenerate(
  document: ProjectDocument,
  generated: Readonly<Record<string, string>>,
  at: string,
): RegenerationResult {
  const proposals: SectionProposal[] = [];

  const sections = document.sections.map((section): Section => {
    const fresh = generated[section.id];

    if (fresh === undefined) {
      proposals.push({
        sectionId: section.id,
        heading: section.heading,
        outcome: 'NOT_GENERATED',
        explanation:
          section.origin === 'AUTHORED'
            ? 'Written by a person. Nothing generates it, so nothing can overwrite it.'
            : 'No generator produced anything for this section on this run.',
      });

      return section;
    }

    if (section.origin === 'EDITED' || section.origin === 'AUTHORED') {
      if (fresh === section.body) {
        proposals.push({
          sectionId: section.id,
          heading: section.heading,
          outcome: 'UNCHANGED',
          explanation: 'What the data says and what the section says are already the same.',
        });

        return section;
      }

      proposals.push({
        sectionId: section.id,
        heading: section.heading,
        outcome: 'PROPOSED',
        proposed: fresh,
        current: section.body,
        explanation:
          'Somebody edited this section, so it is not overwritten. The project data now says something different — compare the two and decide. Leaving it as it is means the document says something the project no longer does.',
      });

      return section;
    }

    if (fresh === section.body) {
      proposals.push({
        sectionId: section.id,
        heading: section.heading,
        outcome: 'UNCHANGED',
        explanation: 'The generator produces the same text it produced last time.',
      });

      return section;
    }

    proposals.push({
      sectionId: section.id,
      heading: section.heading,
      outcome: 'UPDATED',
      proposed: fresh,
      explanation:
        'Nobody had edited this section, so it has been replaced with what the project data now says. There was nothing to lose.',
    });

    return { ...section, body: fresh };
  });

  /*
   * Derived from the proposals rather than tracked with a flag while building them.
   *
   * Type-flow analysis cannot see a mutation inside a `.map` callback, so a flag reads as permanently
   * false to the compiler. Deriving it removes the discrepancy and there is only one definition of
   * "did anything change" to keep in step with the proposals.
   */
  const changed = proposals.some((p) => p.outcome === 'UPDATED');

  return {
    document: changed
      ? {
          ...document,
          sections,
          version: document.version + 1,
          updatedAt: at,
          updatedBy: 'generator',
        }
      : document,
    proposals,
    needsDecision: proposals.filter((p) => p.outcome === 'PROPOSED'),
  };
}

/**
 * Accept a proposal, replacing an edited section with the generated text.
 *
 * The section goes back to `GENERATED`: the person has chosen the machine's words, so there is
 * nothing left to preserve and future regenerations can proceed silently again. Leaving it `EDITED`
 * would mean it prompted forever, which teaches people to dismiss the prompt.
 */
export function acceptProposal(
  document: ProjectDocument,
  sectionId: string,
  acceptedBy: string,
  at: string,
): Result<ProjectDocument> {
  const section = document.sections.find((s) => s.id === sectionId);

  if (section === undefined) {
    return {
      ok: false,
      refusal: 'UNKNOWN_SECTION',
      reason: `${sectionId} is not a section of this document.`,
    };
  }

  return {
    ok: true,
    value: {
      ...document,
      version: document.version + 1,
      updatedBy: acceptedBy,
      updatedAt: at,
      sections: document.sections.map((s) =>
        s.id === sectionId ? { ...s, origin: 'GENERATED' as const } : s,
      ),
    },
  };
}

/**
 * Sections a change to these nodes would affect.
 *
 * Used to tell a reader *which parts* of a document a project change touched, rather than marking the
 * whole document stale. A document flagged stale in its entirety gets re-read once and ignored
 * thereafter; four named sections get looked at.
 */
export function affectedSections(
  document: ProjectDocument,
  changedNodeIds: readonly string[],
): readonly Section[] {
  const changed = new Set(changedNodeIds);
  return document.sections.filter((section) => section.links.some((id) => changed.has(id)));
}
