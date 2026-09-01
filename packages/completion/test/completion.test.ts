import { describe, expect, it } from 'vitest';
import { TwinGraph } from '@govintel/twin/graph';
import { createNode, type NodeClass, type TwinNode } from '@govintel/twin/nodes';
import { OWNERSHIP_AREAS, type Ownership } from '@govintel/release/operations';
import type { Evidence } from '@govintel/governance/evidence';
import {
  LESSON_KINDS,
  checkLesson,
  checkRetrospective,
  transferableLessons,
  type Lesson,
  type Retrospective,
} from '../src/retrospective.ts';
import {
  CLOSURE_CRITERIA,
  CRITERION_MEANING,
  assessClosure,
  checkExceptions,
  type ClosureException,
  type ClosureInput,
} from '../src/closure.ts';
import { ARCHIVE_REASONS, archive, checkArchive, permittedOnArchived } from '../src/archive.ts';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const AT = '2026-01-01T00:00:00.000Z';
const PROJECT = 'p1';
const CLOSER = 'R. Okafor';

function node(id: string, nodeClass: NodeClass): TwinNode {
  return createNode({
    id,
    projectId: PROJECT,
    class: nodeClass,
    label: id,
    provenance: { provenance: 'DETERMINISTIC_CALCULATION', confidence: 'HIGH' },
    at: AT,
  });
}

function graph(): TwinGraph {
  return new TwinGraph({
    projectId: PROJECT,
    nodes: [node('proj', 'PROJECT'), node('t1', 'TASK')],
    edges: [],
  });
}

function lesson(overrides: Partial<Lesson> = {}): Lesson {
  return {
    id: 'l1',
    category: 'ESTIMATION',
    kind: 'DID_NOT_WORK',
    expected: 'The import work would take about two weeks.',
    happened: 'It took seven, and two of those were spent on the vendor’s date format.',
    why: 'Nobody had seen a real export file before committing to the estimate.',
    differently:
      'Obtain a real sample file before estimating any import, or estimate it as a range with the sample as the condition.',
    evidence: ['ev1'],
    ...overrides,
  };
}

function retrospective(overrides: Partial<Retrospective> = {}): Retrospective {
  return {
    projectId: PROJECT,
    heldAt: AT,
    participants: ['R. Okafor', 'A. Patel', 'S. Nkemelu'],
    lessons: [
      lesson(),
      lesson({
        id: 'l2',
        category: 'DELIVERY',
        kind: 'WORKED',
        expected: 'Weekly demos would be a distraction.',
        happened: 'They caught two misread requirements in the first fortnight.',
        why: 'Showing working software surfaced disagreements that the written requirement had hidden.',
        differently: 'Demo weekly from the first week rather than from the first milestone.',
      }),
    ],
    ...overrides,
  };
}

function ownership(): readonly Ownership[] {
  return OWNERSHIP_AREAS.map((area) => ({ area, owner: 'A. Patel', accepted: true }));
}

function exception(overrides: Partial<ClosureException> = {}): ClosureException {
  return {
    id: 'x1',
    criterion: 'DOCUMENTS_COMPLETE',
    reason: 'The operations runbook was never written; the vendor supplies their own.',
    consequence:
      'Whoever runs this depends on the vendor’s runbook, which they do not control and cannot amend.',
    acceptedBy: 'A. Patel',
    acceptedAt: AT,
    ...overrides,
  };
}

/** A project that can close cleanly. Broken per test, so each differs in exactly one respect. */
function closeable(overrides: Partial<ClosureInput> = {}): ClosureInput {
  return {
    graph: graph(),
    closedBy: CLOSER,
    exceptions: [],
    retrospective: retrospective(),
    ownership: ownership(),
    incidents: [],
    debt: [
      {
        id: 'd1',
        kind: 'MISSING_TEST',
        summary: 'No load test for the report export',
        consequence: 'Nobody knows how it behaves on a year of data.',
        disclosed: true,
      },
    ],
    blockingTraceabilityGaps: 0,
    untraceableRequirements: 0,
    failingTests: 0,
    openSecurityFindings: 0,
    staleDocuments: 0,
    unverifiableEvidence: 0,
    hasDeliveredWork: true,
    ...overrides,
  };
}

function evidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: 'ev1',
    projectId: PROJECT,
    type: 'TEST_REPORT',
    label: 'Report',
    hash: 'sha256:abc',
    mimeType: 'application/json',
    sizeBytes: 100,
    uploadedBy: 'CI',
    uploadedAt: AT,
    relatedEntities: ['r1'],
    retention: 'PROJECT_LIFETIME',
    state: 'CURRENT',
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* Lessons                                                                    */
/* -------------------------------------------------------------------------- */

describe('lessons have to be usable by somebody who was not there', () => {
  it('accepts a lesson with all four parts', () => {
    expect(checkLesson(lesson())).toEqual([]);
  });

  it('refuses a lesson that records no expectation', () => {
    /*
     * Without it there is no way to tell whether the outcome was a surprise, a known risk that
     * materialised, or exactly what everybody predicted and nobody acted on. Those need completely
     * different responses.
     */
    const findings = checkLesson(lesson({ expected: '  ' }));

    expect(findings.map((f) => f.defect)).toContain('NO_EXPECTATION');
    expect(findings.find((f) => f.defect === 'NO_EXPECTATION')?.blocking).toBe(true);
  });

  it('refuses a lesson that records no cause', () => {
    // The part with predictive value, and the part that gets skipped. Without it the lesson
    // describes one project and applies to none.
    expect(checkLesson(lesson({ why: '' })).map((f) => f.defect)).toContain('NO_CAUSE');
  });

  it('refuses a lesson nobody can act on', () => {
    // It may be entirely correct and it changes nothing.
    expect(checkLesson(lesson({ differently: '' })).map((f) => f.defect)).toContain(
      'NOT_ACTIONABLE',
    );
  });

  it('reports an intention dressed as an action, without blocking on it', () => {
    /*
     * "Be more careful with estimates" is an intention; "size unknowns before committing to a date"
     * is something a person can be handed. Advisory rather than blocking, because a rule that
     * rejects real writing gets worked around — and the workaround produces worse lessons that pass.
     */
    const findings = checkLesson(
      lesson({ differently: 'Be more careful with third-party estimates.' }),
    );

    const finding = findings.find((f) => f.defect === 'NOT_TRANSFERABLE');

    expect(finding?.blocking).toBe(false);
    expect(finding?.summary).toContain('be more careful');
  });

  it('reports a lesson with nothing behind it', () => {
    // A recollection of a project under pressure, and recollections of pressure are reliably wrong
    // about sequence and cause.
    expect(checkLesson(lesson({ evidence: [] })).map((f) => f.defect)).toContain('NO_EVIDENCE');
  });

  it('keeps a category for things that worked', () => {
    /*
     * A retrospective recording only failures teaches the next team what to avoid and nothing about
     * what to repeat — and makes the exercise something people dread, which is how retrospectives
     * stop happening.
     */
    expect(LESSON_KINDS).toContain('WORKED');
  });

  it('exports only the lessons a stranger could act on', () => {
    // A "lessons learned" export full of unactionable entries is why nobody reads them.
    const mixed = retrospective({
      lessons: [lesson(), lesson({ id: 'l9', why: '', differently: '' })],
    });

    expect(transferableLessons(mixed).map((l) => l.id)).toEqual(['l1']);
  });
});

describe('the retrospective as a whole', () => {
  it('accepts a well-formed retrospective', () => {
    expect(checkRetrospective(retrospective()).filter((f) => f.blocking)).toEqual([]);
  });

  it('blocks on a retrospective with no lessons', () => {
    // Every project teaches something. An empty one means the exercise did not happen, or happened
    // and nobody wrote it down — and afterwards those are indistinguishable.
    const findings = checkRetrospective(retrospective({ lessons: [] }));

    expect(findings.find((f) => f.defect === 'NO_LESSONS')?.blocking).toBe(true);
  });

  it('reports a retrospective with nothing that worked', () => {
    const findings = checkRetrospective(retrospective({ lessons: [lesson()] }));

    expect(findings.map((f) => f.defect)).toContain('ONLY_FAILURES');
  });

  it('reports a retrospective where nothing went wrong', () => {
    // No project runs without surprises. One with none was either not safe to speak in, or written
    // for an audience rather than for the next team.
    const findings = checkRetrospective(retrospective({ lessons: [lesson({ kind: 'WORKED' })] }));

    expect(findings.map((f) => f.defect)).toContain('ONLY_SUCCESSES');
  });

  it('says a single-participant retrospective is a review', () => {
    const findings = checkRetrospective(retrospective({ participants: ['R. Okafor'] }));

    expect(findings.find((f) => f.defect === 'SINGLE_PARTICIPANT')?.why).toMatch(
      /single perspective/i,
    );
  });

  it('notices when every lesson is about one thing', () => {
    // Usually a sign that one loud problem crowded out everything else in the room.
    const narrow = retrospective({
      lessons: [
        lesson({ id: 'a' }),
        lesson({ id: 'b' }),
        lesson({ id: 'c' }),
        lesson({ id: 'd', kind: 'WORKED' }),
      ],
    });

    expect(checkRetrospective(narrow).map((f) => f.defect)).toContain('NARROW_CATEGORIES');
  });
});

/* -------------------------------------------------------------------------- */
/* Closure                                                                    */
/* -------------------------------------------------------------------------- */

describe('a project can close only when criteria pass or accepted exceptions exist', () => {
  it('closes a project that meets every criterion', () => {
    /*
     * The positive case, and without it every negative test below could pass against an engine that
     * never lets anything close.
     */
    const result = assessClosure(closeable());

    expect(result.outcomes.every((o) => o.result === 'MET')).toBe(true);
    expect(result.mayClose).toBe(true);
    expect(result.restingOn).toEqual([]);
    expect(result.headline).toMatch(/every closure criterion is met/i);
  });

  it('refuses to close on an unmet criterion with no exception', () => {
    const result = assessClosure(closeable({ staleDocuments: 2 }));

    expect(result.mayClose).toBe(false);
    expect(result.outcomes.find((o) => o.criterion === 'DOCUMENTS_COMPLETE')?.result).toBe(
      'NOT_MET',
    );
  });

  it('closes on an accepted exception, and names it', () => {
    const result = assessClosure(closeable({ staleDocuments: 2, exceptions: [exception()] }));

    expect(result.mayClose).toBe(true);
    expect(result.restingOn.map((e) => e.id)).toEqual(['x1']);
  });

  it('says a project resting on exceptions did not close the same way as one resting on none', () => {
    /*
     * The strongest claim this platform makes is "the project closed successfully". A headline that
     * renders four accepted exceptions identically to none is lying by omission on exactly that
     * claim.
     */
    const clean = assessClosure(closeable());
    const excepted = assessClosure(closeable({ staleDocuments: 2, exceptions: [exception()] }));

    expect(clean.headline).not.toEqual(excepted.headline);
    expect(excepted.headline).toMatch(/resting permanently on 1 accepted exception/i);
  });

  it('carries the consequence into the criterion’s explanation', () => {
    // The exception's reader is the receiving team, and they read the criterion, not the exception
    // list.
    const result = assessClosure(closeable({ staleDocuments: 2, exceptions: [exception()] }));

    expect(result.outcomes.find((o) => o.criterion === 'DOCUMENTS_COMPLETE')?.explanation).toMatch(
      /the receiving team inherits/i,
    );
  });

  it('refuses to let a malformed exception excuse anything', () => {
    /*
     * Otherwise the highest-standard gate in the platform could be cleared by an exception with no
     * reason, no owner and no consequence — which is not an accepted exception, it is a blank line
     * where one should be.
     */
    const result = assessClosure(
      closeable({
        staleDocuments: 2,
        exceptions: [exception({ reason: '', consequence: '', acceptedBy: '' })],
      }),
    );

    expect(result.mayClose).toBe(false);
    expect(result.exceptionFindings.length).toBeGreaterThan(0);
  });

  it('refuses an exception accepted by the person closing the project', () => {
    /*
     * Accepting your own exception on the way out records a decision with nobody independent behind
     * it. The record looks complete, which is what makes it worse than no exception at all.
     */
    const result = assessClosure(
      closeable({ staleDocuments: 2, exceptions: [exception({ acceptedBy: CLOSER })] }),
    );

    expect(result.mayClose).toBe(false);
    expect(result.exceptionFindings.map((f) => f.defect)).toContain('ACCEPTED_BY_THE_CLOSER');
  });

  it('refuses an exception with no consequence for the receiving team', () => {
    // A reason explains the outgoing team's decision. A consequence tells the incoming team what it
    // means for them, and they are the only people who will ever read it.
    const findings = checkExceptions([exception({ consequence: '  ' })], CLOSER);

    expect(findings.map((f) => f.defect)).toContain('NO_CONSEQUENCE');
  });

  it('will not let an exception excuse a criterion nobody can evaluate', () => {
    /*
     * An exception accepts a *known* shortfall. Letting it cover an undecidable criterion turns "we
     * could not tell" into "we decided it was fine", which is the more dangerous of the two by a
     * long way.
     */
    const result = assessClosure(
      closeable({
        untraceableRequirements: 3,
        exceptions: [exception({ id: 'x2', criterion: 'REQUIREMENTS_DISPOSITIONED' })],
      }),
    );

    const outcome = result.outcomes.find((o) => o.criterion === 'REQUIREMENTS_DISPOSITIONED');

    expect(outcome?.result).toBe('UNKNOWN');
    expect(outcome?.explanation).toMatch(/cannot be excepted/i);
    expect(result.mayClose).toBe(false);
  });

  it('says an undecidable criterion needs answering rather than accepting', () => {
    const result = assessClosure(closeable({ untraceableRequirements: 3 }));

    expect(result.headline).toMatch(/nothing here to accept/i);
  });

  it('blocks closure when nobody holds the credentials', () => {
    // An unassigned credential is either lost or held by somebody who has left, and this is the last
    // moment anybody can fix it.
    const result = assessClosure({
      ...closeable(),
      ownership: ownership().filter((o) => o.area !== 'CREDENTIALS'),
    });

    expect(result.outcomes.find((o) => o.criterion === 'CREDENTIALS_TRANSFERRED')?.result).toBe(
      'NOT_MET',
    );
  });

  it('blocks closure on an empty debt register after real delivery', () => {
    // Zero recorded debt does not mean there is none; it means nobody wrote them down, and the
    // receiving team inherits them anyway.
    const result = assessClosure(closeable({ debt: [] }));

    expect(result.outcomes.find((o) => o.criterion === 'DEBT_RECORDED')?.result).toBe('NOT_MET');
  });

  it('blocks closure with no retrospective', () => {
    /*
     * Built by omission rather than by setting `retrospective: undefined`.
     *
     * `exactOptionalPropertyTypes` distinguishes "absent" from "present and undefined", and this
     * fixture has to be the first — the module's own check reads `=== undefined`, and a test that
     * could only construct the second would be exercising a case the type system forbids callers
     * from producing.
     */
    const { retrospective: _omitted, ...withoutRetrospective } = closeable();
    const result = assessClosure(withoutRetrospective);

    expect(result.outcomes.find((o) => o.criterion === 'RETROSPECTIVE_HELD')?.explanation).toMatch(
      /learned again at full price/i,
    );
  });

  it('blocks closure when a retrospective produced nothing transferable', () => {
    // A retrospective whose lessons apply to no other project has met the letter of the requirement
    // and none of its purpose.
    const useless = retrospective({
      lessons: [
        lesson({ why: '', differently: '' }),
        lesson({ id: 'l2', kind: 'WORKED', why: '' }),
      ],
    });

    const result = assessClosure(closeable({ retrospective: useless }));

    expect(result.outcomes.find((o) => o.criterion === 'RETROSPECTIVE_HELD')?.result).toBe(
      'NOT_MET',
    );
  });

  it('blocks closure on evidence that no longer verifies', () => {
    // The people who could vouch for it are leaving.
    const result = assessClosure(closeable({ unverifiableEvidence: 1 }));

    expect(result.outcomes.find((o) => o.criterion === 'EVIDENCE_CAPTURED')?.result).toBe(
      'NOT_MET',
    );
  });

  it('states what each criterion is asking, in terms of the day after everybody leaves', () => {
    for (const criterion of CLOSURE_CRITERIA) {
      expect(CRITERION_MEANING[criterion].length, criterion).toBeGreaterThan(60);
    }
  });

  it('is deterministic', () => {
    const input = closeable({ staleDocuments: 1, exceptions: [exception()] });

    expect(JSON.stringify(assessClosure(input))).toBe(JSON.stringify(assessClosure(input)));
  });
});

/* -------------------------------------------------------------------------- */
/* Archive                                                                    */
/* -------------------------------------------------------------------------- */

describe('archiving is not deletion', () => {
  const request = {
    projectId: PROJECT,
    reason: 'COMPLETED' as const,
    narrative: 'Delivered and handed to the operations team in January.',
    archivedBy: CLOSER,
    archivedAt: AT,
    closureAssessed: true,
  };

  it('archives a closed project', () => {
    const record = archive(request, [evidence()]);

    expect(record?.readable).toBe(true);
    expect(record?.editable).toBe(false);
  });

  it('refuses to archive as completed without a closure assessment', () => {
    /*
     * The refusal that stops archiving becoming a way around the closure gate. Archiving is always
     * allowed — work gets cancelled. Archiving *as completed* is the same claim the closure criteria
     * decide, and letting it through here would make the whole gate optional.
     */
    const refusals = checkArchive({ ...request, closureAssessed: false }, []);

    expect(refusals.map((r) => r.refusal)).toContain('CLAIMS_COMPLETION_WITHOUT_CLOSURE');
    expect(refusals[0]?.reason).toMatch(/make the closure gate optional/i);
  });

  it('allows archiving an unclosed project as cancelled', () => {
    // There are legitimate reasons a project ends without closing, and none of them are "it
    // finished". Cancelled is honest.
    expect(checkArchive({ ...request, reason: 'CANCELLED', closureAssessed: false }, [])).toEqual(
      [],
    );
  });

  it('keeps completed and cancelled as different facts', () => {
    /*
     * A portfolio that renders them identically has lost the only thing anybody wants from it later:
     * which of these finished and which stopped.
     */
    expect(ARCHIVE_REASONS).toContain('COMPLETED');
    expect(ARCHIVE_REASONS).toContain('CANCELLED');
    expect(ARCHIVE_REASONS).toContain('ON_HOLD_INDEFINITELY');
  });

  it('refuses to archive with no narrative', () => {
    // Somebody finding this in two years reads the narrative first; a category alone tells them
    // nothing they can act on.
    expect(checkArchive({ ...request, narrative: '' }, []).map((r) => r.refusal)).toContain(
      'NO_NARRATIVE',
    );
  });

  it('refuses to record a supersession with no successor', () => {
    // A dead end for anybody following the trail: they learn the work moved and not where.
    const refusals = checkArchive({ ...request, reason: 'SUPERSEDED_BY_ANOTHER_PROJECT' }, []);

    expect(refusals.map((r) => r.refusal)).toContain('NO_SUCCESSOR');
  });

  it('refuses to archive while regulatory evidence is unreachable', () => {
    /*
     * A retention obligation set by somebody outside the project does not end because the project
     * did. Archiving now satisfies the letter of retention while defeating it — invisibly, until
     * somebody asks for the evidence.
     */
    const quarantined = evidence({
      retention: 'REGULATORY',
      state: 'QUARANTINED',
      quarantineReason: 'Hash mismatch.',
    });

    const refusals = checkArchive(request, [quarantined]);

    expect(refusals.map((r) => r.refusal)).toContain('REGULATORY_EVIDENCE_UNREACHABLE');
    expect(archive(request, [quarantined])).toBeUndefined();
  });

  it('does not block on quarantined evidence with no retention obligation', () => {
    // The rule is about the obligation, not about the quarantine. Blocking on every quarantined
    // record would make archiving impossible for any project that ever found a hash mismatch.
    const quarantined = evidence({ retention: 'TRANSIENT', state: 'QUARANTINED' });

    expect(checkArchive(request, [quarantined])).toEqual([]);
  });

  it('names the evidence that must stay reachable', () => {
    // On the record rather than implicit, so a later retention sweep has something to check against
    // rather than a rule it has to remember.
    const record = archive(request, [
      evidence({ id: 'ev1', retention: 'REGULATORY' }),
      evidence({ id: 'ev2', retention: 'TRANSIENT' }),
    ]);

    expect(record?.retainedEvidence).toEqual(['ev1']);
  });

  it('returns nothing rather than a record when the request would be refused', () => {
    // The only way to obtain a record is to pass, so a caller cannot archive by ignoring the check.
    expect(archive({ ...request, narrative: '' }, [])).toBeUndefined();
  });

  it('permits reading an archived project and nothing else', () => {
    /*
     * "Archived" is exactly the kind of state where two parts of a system quietly disagree — one
     * treating it as read-only and another as deleted.
     */
    expect(permittedOnArchived('read')).toBe(true);
    expect(permittedOnArchived('export')).toBe(true);
    expect(permittedOnArchived('verify')).toBe(true);
    expect(permittedOnArchived('edit')).toBe(false);
    expect(permittedOnArchived('delete')).toBe(false);
  });
});
