import { describe, expect, it } from 'vitest';
import { TwinGraph } from '@govintel/twin/graph';
import { createNode, type NodeClass, type TwinNode } from '@govintel/twin/nodes';
import type { EdgeClass, TwinEdge } from '@govintel/twin/edges';
import {
  BASELINE_TYPES,
  REQUIRES_APPROVAL,
  createBaseline,
  matchesBaseline,
  supersede,
  variance,
  verifyIntegrity,
  type GovernanceBaseline,
} from '../src/baseline.ts';
import {
  ALLOWED_MIME_TYPES,
  EVIDENCE_TYPES,
  MAX_EVIDENCE_BYTES,
  canSupportAClaim,
  checkUpload,
  mayDelete,
  quarantine,
  verifyEvidence,
  type Evidence,
  type UploadCandidate,
} from '../src/evidence.ts';
import {
  APPROVAL_STATES,
  SIGN_OFF,
  decide,
  invalidateIfStale,
  isStale,
  signOffStatus,
  withdraw,
  type Approval,
} from '../src/approval.ts';
import {
  acceptProposal,
  affectedSections,
  edit,
  regenerate,
  type ProjectDocument,
} from '../src/document.ts';
import { append, query, redact, redactionEvent, verifyLog, type AuditEvent } from '../src/audit.ts';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const AT = '2026-01-01T00:00:00.000Z';
const LATER = '2026-02-01T00:00:00.000Z';
const PROJECT = 'p1';

function node(id: string, nodeClass: NodeClass, revision = 1): TwinNode {
  return {
    ...createNode({
      id,
      projectId: PROJECT,
      class: nodeClass,
      label: id,
      provenance: { provenance: 'DETERMINISTIC_CALCULATION', confidence: 'HIGH' },
      at: AT,
    }),
    revision,
  };
}

function edge(from: string, to: string, edgeClass: EdgeClass): TwinEdge {
  return {
    id: `${from}:${edgeClass}:${to}`,
    projectId: PROJECT,
    class: edgeClass,
    from,
    to,
    createdAt: AT,
  };
}

function graphOf(nodes: readonly TwinNode[], edges: readonly TwinEdge[] = []): TwinGraph {
  return new TwinGraph({ projectId: PROJECT, nodes, edges });
}

function baselineGraph(): TwinGraph {
  return graphOf(
    [node('proj', 'PROJECT'), node('r1', 'REQUIREMENT'), node('t1', 'TASK')],
    [edge('t1', 'r1', 'IMPLEMENTS')],
  );
}

function takeApprovedPlan(graph = baselineGraph()): GovernanceBaseline {
  const result = createBaseline(graph, {
    id: 'b1',
    type: 'APPROVED_PLAN',
    label: 'Plan agreed at kick-off',
    version: 1,
    createdBy: 'A. Patel',
    reason: 'The plan the client signed off before work started.',
    takenAt: AT,
    correlationId: 'c1',
  });

  if (!result.ok) throw new Error(`expected a baseline, got ${result.refusal}`);
  return result.value;
}

function evidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: 'e1',
    projectId: PROJECT,
    type: 'TEST_REPORT',
    label: 'Accessibility scan, 2026-01-01',
    hash: 'sha256:abc',
    mimeType: 'application/json',
    sizeBytes: 4096,
    uploadedBy: 'CI',
    uploadedAt: AT,
    relatedEntities: ['r1'],
    retention: 'PROJECT_LIFETIME',
    state: 'CURRENT',
    ...overrides,
  };
}

function candidate(overrides: Partial<UploadCandidate> = {}): UploadCandidate {
  return {
    filename: 'scan.json',
    mimeType: 'application/json',
    sizeBytes: 4096,
    hash: 'sha256:abc',
    uploadedBy: 'CI',
    relatedEntities: ['r1'],
    ...overrides,
  };
}

function approval(overrides: Partial<Approval> = {}): Approval {
  return {
    id: 'a1',
    projectId: PROJECT,
    subjectType: 'DEPLOYMENT',
    subjectId: 'd1',
    subjectVersion: 3,
    requestedBy: 'R. Okafor',
    requestedAt: AT,
    approverRole: 'ENGINEERING_LEAD',
    state: 'REQUESTED',
    evidence: [],
    ...overrides,
  };
}

function document(): ProjectDocument {
  return {
    id: 'doc1',
    projectId: PROJECT,
    title: 'Project summary',
    state: 'DRAFT',
    version: 1,
    updatedBy: 'generator',
    updatedAt: AT,
    sections: [
      {
        id: 'scope',
        heading: 'Scope',
        body: 'Two requirements are recorded.',
        origin: 'GENERATED',
        links: ['r1'],
      },
      {
        id: 'context',
        heading: 'Context',
        body: 'The clinic has run on paper since 2011.',
        origin: 'AUTHORED',
        links: [],
      },
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Baselines                                                                  */
/* -------------------------------------------------------------------------- */

describe('gap-spec §29: baselines are deliberate governance snapshots', () => {
  it('takes a baseline of the graph', () => {
    const baseline = takeApprovedPlan();

    expect(baseline.nodes).toHaveLength(3);
    expect(baseline.checksum).not.toBe('');
  });

  it('refuses a baseline with no stated reason', () => {
    /*
     * The field that makes eleven baselines distinguishable from each other. Without it, a baseline
     * is indistinguishable from a scheduled snapshot, and six months later nobody can tell which one
     * mattered — which is exactly when somebody needs to.
     */
    const result = createBaseline(baselineGraph(), {
      id: 'b1',
      type: 'APPROVED_PLAN',
      label: 'x',
      version: 1,
      createdBy: 'A. Patel',
      reason: '   ',
      takenAt: AT,
      correlationId: 'c1',
    });

    expect(result.ok ? undefined : result.refusal).toBe('NO_REASON');
  });

  it('refuses a baseline nobody took', () => {
    const result = createBaseline(baselineGraph(), {
      id: 'b1',
      type: 'APPROVED_PLAN',
      label: 'x',
      version: 1,
      createdBy: '',
      reason: 'A reason.',
      takenAt: AT,
      correlationId: 'c1',
    });

    expect(result.ok ? undefined : result.refusal).toBe('NO_CREATOR');
  });

  it('refuses a release baseline with no approval', () => {
    // A release baseline records what was shipped, and shipping is a decision somebody is
    // accountable for. Without an approval it records a decision nobody made.
    const result = createBaseline(baselineGraph(), {
      id: 'b1',
      type: 'RELEASE_BASELINE',
      label: 'v1.0',
      version: 1,
      createdBy: 'A. Patel',
      reason: 'What went to production.',
      takenAt: AT,
      correlationId: 'c1',
    });

    expect(result.ok ? undefined : result.refusal).toBe('APPROVAL_REQUIRED');
  });

  it('allows an approved plan without an approval', () => {
    /*
     * The asymmetry is deliberate: an approved plan is often the artefact the approval is *about*, so
     * requiring the approval first would make it impossible to produce.
     */
    expect(REQUIRES_APPROVAL.APPROVED_PLAN).toBe(false);
    expect(REQUIRES_APPROVAL.RELEASE_BASELINE).toBe(true);
  });

  it('refuses to baseline an empty project', () => {
    // An empty baseline hashes cleanly and verifies forever while recording nothing, which makes it
    // worse than no baseline — it looks like one.
    const result = createBaseline(graphOf([]), {
      id: 'b1',
      type: 'APPROVED_PLAN',
      label: 'x',
      version: 1,
      createdBy: 'A. Patel',
      reason: 'A reason.',
      takenAt: AT,
      correlationId: 'c1',
    });

    expect(result.ok ? undefined : result.refusal).toBe('EMPTY_GRAPH');
  });

  it('offers only the two types V1 supports', () => {
    /*
     * `MONTHLY_CONTROL_BASELINE` and `CONTRACT_BASELINE` are named in §29.1 as optional later. An enum
     * member nothing produces looks like a supported feature to everyone reading the type, and the
     * first person to select it discovers it does nothing.
     */
    expect(BASELINE_TYPES).toEqual(['APPROVED_PLAN', 'RELEASE_BASELINE']);
  });

  it('verifies an untouched baseline', () => {
    expect(verifyIntegrity(takeApprovedPlan()).intact).toBe(true);
  });

  it('detects a tampered baseline and says it cannot be repaired by rehashing', () => {
    /*
     * The whole point of storing the hash. A baseline nobody can verify is a claim about the past
     * with nothing behind it.
     */
    const baseline = takeApprovedPlan();

    const tampered: GovernanceBaseline = {
      ...baseline,
      nodes: baseline.nodes.map((n) => (n.id === 'r1' ? { ...n, label: 'quietly different' } : n)),
    };

    const result = verifyIntegrity(tampered);

    expect(result.intact).toBe(false);
    expect(result.recomputed).not.toBe(baseline.checksum);
    expect(result.explanation).toMatch(/erase the only sign anything was wrong/i);
  });

  it('detects a node removed from a baseline', () => {
    // Removal is the case a naive comparison misses: what is left still all matches.
    const baseline = takeApprovedPlan();
    const shortened = { ...baseline, nodes: baseline.nodes.slice(1) };

    expect(verifyIntegrity(shortened).intact).toBe(false);
  });

  it('exports no way to edit a baseline', async () => {
    /*
     * §29.3 in three words: "Never edit baseline." Enforced by absence rather than by a guard — a
     * guard is a decision somebody can reverse in a hurry, and a missing function is one they have to
     * notice they are adding.
     */
    const module: Record<string, unknown> = await import('../src/baseline.ts');
    const names = Object.keys(module);

    expect(names.filter((n) => /^(edit|update|amend|modify|patch)/i.test(n))).toEqual([]);
  });

  it('supersedes by chaining rather than overwriting', () => {
    const first = takeApprovedPlan();
    const second: GovernanceBaseline = { ...first, id: 'b2', label: 'Revised plan' };

    const { previous, next } = supersede(first, second);

    expect(previous.supersededBy).toBe('b2');
    // The superseded baseline's content is untouched, and the pointer lives outside the hash so
    // recording the supersession cannot break the integrity of what was baselined.
    expect(previous.nodes).toEqual(first.nodes);
    expect(verifyIntegrity(previous).intact).toBe(true);
    expect(next.id).toBe('b2');
  });

  it('reports no variance against the graph it was taken from', () => {
    const graph = baselineGraph();
    const baseline = takeApprovedPlan(graph);

    expect(variance(baseline, graph).summary).toMatch(/nothing has moved/i);
    expect(matchesBaseline(baseline, graph)).toBe(true);
  });

  it('names what moved rather than reporting a drift percentage', () => {
    /*
     * "38% divergence" is unactionable and optimisable. "These changed, this was added, this was
     * removed" is the conversation somebody actually needs to have.
     */
    const baseline = takeApprovedPlan();

    const moved = graphOf(
      [node('proj', 'PROJECT'), node('r1', 'REQUIREMENT', 4), node('r2', 'REQUIREMENT')],
      [],
    );

    const result = variance(baseline, moved);

    expect(result.changed).toEqual(['r1']);
    expect(result.added).toEqual(['r2']);
    expect(result.removed).toEqual(['t1']);
    expect(result.summary).not.toMatch(/%/);
  });

  it('notices a node that quietly stopped existing', () => {
    // The one people miss: a requirement that was removed does not show up in a diff of the things
    // that are still there.
    const baseline = takeApprovedPlan();
    const without = graphOf([node('proj', 'PROJECT'), node('r1', 'REQUIREMENT')]);

    expect(variance(baseline, without).removed).toEqual(['t1']);
  });

  it('notices structural change with no node change', () => {
    // Edges are what people notice last, and a dependency that appeared is a real change to the plan.
    const baseline = takeApprovedPlan();

    const rewired = graphOf(
      [node('proj', 'PROJECT'), node('r1', 'REQUIREMENT'), node('t1', 'TASK')],
      [],
    );

    expect(variance(baseline, rewired).edgesRemoved).toHaveLength(1);
    expect(matchesBaseline(baseline, rewired)).toBe(false);
  });

  it('is deterministic', () => {
    const graph = baselineGraph();
    const a = takeApprovedPlan(graph);
    const b = takeApprovedPlan(graph);

    expect(a.checksum).toBe(b.checksum);
  });
});

/* -------------------------------------------------------------------------- */
/* Evidence                                                                   */
/* -------------------------------------------------------------------------- */

describe('gap-spec §32 and §35: evidence', () => {
  it('accepts a well-formed upload', () => {
    expect(checkUpload(candidate())).toEqual([]);
  });

  it('refuses a MIME type not on the allowlist', () => {
    const refusals = checkUpload(candidate({ mimeType: 'text/html', filename: 'x.html' }));

    expect(refusals.map((r) => r.refusal)).toContain('MIME_NOT_ALLOWED');
  });

  it('does not allow SVG', () => {
    /*
     * An image to a user and a script host to a browser. The single most common way an image upload
     * becomes stored cross-site scripting, and the reason the allowlist is a list rather than a
     * pattern.
     */
    expect(ALLOWED_MIME_TYPES['image/svg+xml']).toBeUndefined();
  });

  it('refuses a file whose extension disagrees with its declared type', () => {
    // Not a mistake anybody makes by accident, and trusting the declared type alone lets the browser
    // decide what the file is at download time.
    const refusals = checkUpload(candidate({ mimeType: 'image/png', filename: 'payload.html' }));

    expect(refusals.map((r) => r.refusal)).toContain('EXTENSION_MISMATCH');
  });

  it('refuses an oversized file', () => {
    const refusals = checkUpload(candidate({ sizeBytes: MAX_EVIDENCE_BYTES + 1 }));
    expect(refusals.map((r) => r.refusal)).toContain('TOO_LARGE');
  });

  it('refuses an empty file', () => {
    // It hashes consistently and proves nothing, and it would sit in the list looking like evidence.
    expect(checkUpload(candidate({ sizeBytes: 0 })).map((r) => r.refusal)).toContain('EMPTY');
  });

  it('refuses evidence attached to nothing', () => {
    // Held loose it is a file, and at the point somebody needs it nobody knows what it was meant to
    // show.
    expect(checkUpload(candidate({ relatedEntities: [] })).map((r) => r.refusal)).toContain(
      'ATTACHED_TO_NOTHING',
    );
  });

  it('refuses evidence with no hash', () => {
    // Without one it cannot be distinguished from a record whose artefact was swapped, which makes it
    // testimony rather than evidence.
    expect(checkUpload(candidate({ hash: '  ' })).map((r) => r.refusal)).toContain('NO_HASH');
  });

  it('verifies evidence whose artefact is unchanged', () => {
    expect(verifyEvidence(evidence(), 'sha256:abc').intact).toBe(true);
  });

  it('detects an artefact that has been replaced, naming who uploaded it and when', () => {
    const result = verifyEvidence(evidence(), 'sha256:different');

    expect(result.intact).toBe(false);
    expect(result.explanation).toContain('CI');
    expect(result.explanation).toContain(AT);
  });

  it('quarantines tampered evidence rather than deleting it', () => {
    /*
     * The central decision. The fact that evidence was tampered with is the most important thing the
     * system knows about it, and deleting the record destroys exactly that. It also keeps the
     * *absence* of evidence meaningful: if tampered records were deleted, a missing one could mean
     * "never existed" or "was removed" and nobody could tell.
     */
    const held = quarantine(evidence(), 'Hash mismatch found during the quarterly audit.');

    expect(held.state).toBe('QUARANTINED');
    expect(held.quarantineReason).toMatch(/quarterly audit/i);
    expect(held.hash).toBe('sha256:abc');
    expect(held.uploadedBy).toBe('CI');
  });

  it('refuses to let a retention sweep delete quarantined evidence', () => {
    /*
     * The most convenient possible bug: housekeeping that tidies away the record of tampering, and
     * looks like housekeeping working correctly while it does.
     */
    const held = quarantine(evidence({ retention: 'TRANSIENT' }), 'Hash mismatch.');

    expect(mayDelete(evidence({ retention: 'TRANSIENT' }))).toBe(true);
    expect(mayDelete(held)).toBe(false);
  });

  it('refuses to delete regulatory evidence on any schedule', () => {
    expect(mayDelete(evidence({ retention: 'REGULATORY' }))).toBe(false);
    expect(mayDelete(evidence({ retention: 'INDEFINITE' }))).toBe(false);
  });

  it('does not let superseded or quarantined evidence support a claim', () => {
    expect(canSupportAClaim(evidence())).toBe(true);
    expect(canSupportAClaim(evidence({ state: 'SUPERSEDED' }))).toBe(false);
    expect(canSupportAClaim(evidence({ state: 'QUARANTINED' }))).toBe(false);
  });

  it('keeps manual attestation distinguishable from machine evidence', () => {
    // §32 permits it "if unavoidable". It should never sit in a report looking identical to a scan.
    expect(EVIDENCE_TYPES).toContain('MANUAL_ATTESTATION');
  });
});

/* -------------------------------------------------------------------------- */
/* Approvals                                                                  */
/* -------------------------------------------------------------------------- */

describe('gap-spec §33: approvals', () => {
  it('records an approval by a named person', () => {
    const result = decide(approval(), {
      outcome: 'APPROVED',
      approverUser: 'A. Patel',
      decidedAt: LATER,
      subjectVersionNow: 3,
    });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.state : undefined).toBe('APPROVED');
  });

  it('refuses an approval with nobody named', () => {
    const result = decide(approval(), {
      outcome: 'APPROVED',
      approverUser: '',
      decidedAt: LATER,
      subjectVersionNow: 3,
    });

    expect(result.ok ? undefined : result.refusal).toBe('NO_APPROVER');
  });

  it('refuses self-approval', () => {
    // Records a decision with nobody independent behind it, which is worse than no approval because
    // the record looks complete.
    const result = decide(approval(), {
      outcome: 'APPROVED',
      approverUser: 'R. Okafor',
      decidedAt: LATER,
      subjectVersionNow: 3,
    });

    expect(result.ok ? undefined : result.refusal).toBe('APPROVER_IS_REQUESTER');
  });

  it('requires a reason for rejection but not for approval', () => {
    /*
     * Deliberate asymmetry. A rejection with no reason leaves the requester guessing at what would
     * make it acceptable, so the next attempt is a guess too. An approval is complete on its own: the
     * thing was found acceptable as it stood.
     */
    const rejected = decide(approval(), {
      outcome: 'REJECTED',
      approverUser: 'A. Patel',
      decidedAt: LATER,
      subjectVersionNow: 3,
    });

    const approved = decide(approval(), {
      outcome: 'APPROVED',
      approverUser: 'A. Patel',
      decidedAt: LATER,
      subjectVersionNow: 3,
    });

    expect(rejected.ok ? undefined : rejected.refusal).toBe('NO_REASON_FOR_REJECTION');
    expect(approved.ok).toBe(true);
  });

  it('refuses to decide when the subject moved between request and decision', () => {
    /*
     * The approver is looking at version 7; the request was raised against version 3. Recording the
     * decision against 3 misattributes it, and recording it against 7 claims they reviewed a request
     * nobody showed them.
     */
    const result = decide(approval(), {
      outcome: 'APPROVED',
      approverUser: 'A. Patel',
      decidedAt: LATER,
      subjectVersionNow: 7,
    });

    expect(result.ok ? undefined : result.refusal).toBe('SUBJECT_MOVED');
  });

  it('refuses to decide something already decided', () => {
    const result = decide(approval({ state: 'APPROVED' }), {
      outcome: 'REJECTED',
      approverUser: 'A. Patel',
      decidedAt: LATER,
      comment: 'Changed my mind.',
      subjectVersionNow: 3,
    });

    expect(result.ok ? undefined : result.refusal).toBe('ALREADY_DECIDED');
  });

  it('keeps withdrawn distinct from rejected', () => {
    /*
     * Rejected means somebody considered it and said no. Withdrawn means it was pulled before anybody
     * decided. Collapsing them attributes a decision to somebody who never made one.
     */
    expect(APPROVAL_STATES).toContain('WITHDRAWN');
    expect(APPROVAL_STATES).toContain('REJECTED');

    const result = withdraw(approval(), 'Superseded by a different plan.');
    expect(result.ok ? result.value.state : undefined).toBe('WITHDRAWN');
  });

  it('refuses to withdraw a decided approval', () => {
    // That would erase a decision somebody made. INVALIDATED records the subject moving, which is a
    // different thing.
    const result = withdraw(approval({ state: 'APPROVED' }), 'x');
    expect(result.ok ? undefined : result.refusal).toBe('ALREADY_DECIDED');
  });

  it('invalidates an approval when its subject changes', () => {
    /*
     * §33's closing line, resolved strictly. The lenient reading puts somebody's name on a decision
     * they did not make: an approver who signed off version 3 has not signed off version 7.
     */
    const approved = approval({ state: 'APPROVED', approverUser: 'A. Patel' });

    expect(isStale(approved, 7)).toBe(true);

    const invalidated = invalidateIfStale(approved, 7);

    expect(invalidated?.state).toBe('INVALIDATED');
    expect(invalidated?.comment).toContain('A. Patel');
  });

  it('does not make a rejection stale when the subject changes', () => {
    // A rejection records what somebody thought of the version they saw, and that remains true.
    expect(isStale(approval({ state: 'REJECTED' }), 7)).toBe(false);
  });

  it('returns undefined when nothing needs invalidating', () => {
    // So a caller sweeping every approval can tell which ones it actually touched.
    expect(invalidateIfStale(approval({ state: 'APPROVED' }), 3)).toBeUndefined();
  });

  it('requires every named role to sign off, not any one of them', () => {
    /*
     * "Any of" is how a multi-party sign-off quietly becomes a single-party one: the fastest approver
     * clears it and the others never look.
     */
    const engineering = approval({
      state: 'APPROVED',
      approverRole: 'ENGINEERING_LEAD',
      approverUser: 'A. Patel',
    });

    const partial = signOffStatus('DEPLOYMENT', [engineering], 3);

    expect(partial.satisfied).toBe(false);
    expect(partial.missing).toEqual(['PRODUCT_OWNER']);
    expect(partial.explanation).toMatch(/technical judgement and a product one/i);

    const product = approval({
      id: 'a2',
      state: 'APPROVED',
      approverRole: 'PRODUCT_OWNER',
      approverUser: 'S. Nkemelu',
    });

    expect(signOffStatus('DEPLOYMENT', [engineering, product], 3).satisfied).toBe(true);
  });

  it('does not count a stale approval towards a sign-off', () => {
    // Otherwise a multi-party gate is satisfied by decisions made about a version nobody is shipping.
    const stale = approval({
      state: 'APPROVED',
      approverRole: 'ENGINEERING_LEAD',
      subjectVersion: 2,
    });

    const product = approval({ id: 'a2', state: 'APPROVED', approverRole: 'PRODUCT_OWNER' });

    expect(signOffStatus('DEPLOYMENT', [stale, product], 3).missing).toEqual(['ENGINEERING_LEAD']);
  });

  it('states why each sign-off requirement exists', () => {
    for (const requirement of SIGN_OFF) {
      expect(requirement.why.length, requirement.subjectType).toBeGreaterThan(40);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Documents                                                                  */
/* -------------------------------------------------------------------------- */

describe('gap-spec §30 and §31: documents', () => {
  it('applies an edit and advances the version', () => {
    const result = edit(document(), {
      sectionId: 'scope',
      body: 'Two requirements, both about privacy.',
      editedBy: 'A. Patel',
      editedAt: LATER,
      baseVersion: 1,
    });

    expect(result.ok ? result.value.version : undefined).toBe(2);
  });

  it('marks an edited generated section as edited, keeping what it replaced', () => {
    // The generated text is kept so regeneration can tell what the person changed it from.
    const result = edit(document(), {
      sectionId: 'scope',
      body: 'Rewritten.',
      editedBy: 'A. Patel',
      editedAt: LATER,
      baseVersion: 1,
    });

    const section = result.ok ? result.value.sections.find((s) => s.id === 'scope') : undefined;

    expect(section?.origin).toBe('EDITED');
    expect(section?.generatedBaseline).toBe('Two requirements are recorded.');
  });

  it('refuses an edit against a stale version', () => {
    // §30 keeps one canonical version at a time, and merging two people's prose automatically would
    // produce a document neither of them wrote.
    const result = edit(document(), {
      sectionId: 'scope',
      body: 'x',
      editedBy: 'A. Patel',
      editedAt: LATER,
      baseVersion: 0,
    });

    expect(result.ok ? undefined : result.refusal).toBe('VERSION_CONFLICT');
  });

  it('refuses to edit an approved document', () => {
    // Somebody signed off this text. Editing it in place would change what they approved while
    // leaving their name on it.
    const result = edit(
      { ...document(), state: 'APPROVED' },
      { sectionId: 'scope', body: 'x', editedBy: 'A. Patel', editedAt: LATER, baseVersion: 1 },
    );

    expect(result.ok ? undefined : result.refusal).toBe('APPROVED_DOCUMENT_IS_FROZEN');
  });

  it('refuses an edit to a section that does not exist', () => {
    // Creating it silently would let a typo produce a section nobody meant to add.
    const result = edit(document(), {
      sectionId: 'nope',
      body: 'x',
      editedBy: 'A. Patel',
      editedAt: LATER,
      baseVersion: 1,
    });

    expect(result.ok ? undefined : result.refusal).toBe('UNKNOWN_SECTION');
  });

  it('regenerates an untouched section silently', () => {
    // Canonical data wins, and there is nothing to lose.
    const result = regenerate(document(), { scope: 'Three requirements are recorded.' }, LATER);

    const scope = result.document.sections.find((s) => s.id === 'scope');

    expect(scope?.body).toBe('Three requirements are recorded.');
    expect(result.needsDecision).toEqual([]);
  });

  it('never overwrites an edited section, and proposes instead', () => {
    /*
     * §31's two instructions resolved. Overwrite and somebody's paragraph disappears; never overwrite
     * and the document drifts into being confidently wrong. Per-section provenance is what lets both
     * be honoured.
     */
    const edited = edit(document(), {
      sectionId: 'scope',
      body: 'Two requirements, both about privacy, and one is contested.',
      editedBy: 'A. Patel',
      editedAt: LATER,
      baseVersion: 1,
    });

    if (!edited.ok) throw new Error('expected the edit to apply');

    const result = regenerate(edited.value, { scope: 'Three requirements are recorded.' }, LATER);

    const scope = result.document.sections.find((s) => s.id === 'scope');

    expect(scope?.body).toContain('contested');
    expect(result.needsDecision).toHaveLength(1);
    expect(result.needsDecision[0]?.proposed).toBe('Three requirements are recorded.');
    expect(result.needsDecision[0]?.current).toContain('contested');
  });

  it('says what leaving an edited section unchanged would mean', () => {
    // A prompt saying "these differ" is a chore. Saying what ignoring it costs is a reason.
    const edited = edit(document(), {
      sectionId: 'scope',
      body: 'Rewritten.',
      editedBy: 'A. Patel',
      editedAt: LATER,
      baseVersion: 1,
    });

    if (!edited.ok) throw new Error('expected the edit to apply');

    const result = regenerate(edited.value, { scope: 'Different.' }, LATER);

    expect(result.needsDecision[0]?.explanation).toMatch(
      /says something the project no longer does/i,
    );
  });

  it('never generates over an authored section', () => {
    const result = regenerate(document(), { context: 'Machine prose.' }, LATER);

    expect(result.document.sections.find((s) => s.id === 'context')?.body).toContain('2011');
  });

  it('does not advance the version when nothing regenerated', () => {
    // A version history full of entries that changed nothing is one nobody trusts to be complete.
    const result = regenerate(document(), { scope: 'Two requirements are recorded.' }, LATER);

    expect(result.document.version).toBe(1);
  });

  it('returns a section to generated once a proposal is accepted', () => {
    /*
     * Otherwise it prompts forever, which teaches people to dismiss the prompt — and the next
     * prompt, and the one that mattered.
     */
    const edited = edit(document(), {
      sectionId: 'scope',
      body: 'Rewritten.',
      editedBy: 'A. Patel',
      editedAt: LATER,
      baseVersion: 1,
    });

    if (!edited.ok) throw new Error('expected the edit to apply');

    const accepted = acceptProposal(edited.value, 'scope', 'A. Patel', LATER);

    if (!accepted.ok) throw new Error('expected the proposal to be accepted');

    expect(accepted.value.sections.find((s) => s.id === 'scope')?.origin).toBe('GENERATED');
    expect(regenerate(accepted.value, { scope: 'Fresh.' }, LATER).needsDecision).toEqual([]);
  });

  it('names the sections a project change affects rather than the whole document', () => {
    /*
     * A document flagged stale in its entirety gets re-read once and ignored thereafter. Four named
     * sections get looked at.
     */
    expect(affectedSections(document(), ['r1']).map((s) => s.id)).toEqual(['scope']);
    expect(affectedSections(document(), ['r9'])).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Audit                                                                      */
/* -------------------------------------------------------------------------- */

describe('gap-spec §40: audit immutability', () => {
  function logOf(count: number): AuditEvent[] {
    const log: AuditEvent[] = [];

    for (let i = 1; i <= count; i += 1) {
      log.push(
        append(
          log,
          {
            projectId: PROJECT,
            category: 'PROJECT_CHANGE',
            action: 'NODE_UPDATED',
            subjectId: `n${String(i)}`,
            actor: 'A. Patel',
            at: `2026-01-0${String(i)}T00:00:00.000Z`,
            correlationId: 'c1',
            payload: { email: 'someone@example.com', field: 'label' },
          },
          `ev${String(i)}`,
        ),
      );
    }

    return log;
  }

  it('exports no way to update or delete an event', async () => {
    /*
     * §40 enforced by absence. A guard that throws is a decision somebody can reverse in a hurry at
     * two in the morning; a missing function is one they have to notice they are adding.
     */
    const module: Record<string, unknown> = await import('../src/audit.ts');
    const names = Object.keys(module);

    expect(names.filter((n) => /^(update|delete|remove|edit|purge)/i.test(n))).toEqual([]);
  });

  it('derives the sequence rather than accepting one', () => {
    // A caller cannot produce two events claiming the same position, which would make the log's
    // ordering unusable exactly where it matters.
    const log = logOf(3);

    expect(log.map((e) => e.sequence)).toEqual([1, 2, 3]);
  });

  it('records an unnamed actor as unknown rather than leaving it blank', () => {
    // An empty actor and an automated one are different, and a log that cannot distinguish them
    // cannot answer "did a person do this".
    const event = append(
      [],
      {
        projectId: PROJECT,
        category: 'RETENTION',
        action: 'SWEEP',
        subjectId: 'x',
        actor: '  ',
        at: AT,
        correlationId: 'c1',
      },
      'ev1',
    );

    expect(event.actor).toBe('unknown');
  });

  it('finds nothing wrong with a well-formed log', () => {
    expect(verifyLog(logOf(4))).toEqual([]);
  });

  it('detects a deleted event as a sequence gap', () => {
    /*
     * The reason to audit the audit. Every individual event still looks correct; only the sequence
     * shows one is missing, so this is the single defect nothing else would reveal.
     */
    const log = logOf(4);
    const withHole = [...log.slice(0, 1), ...log.slice(2)];

    const findings = verifyLog(withHole);

    expect(findings.map((f) => f.defect)).toContain('SEQUENCE_GAP');
    expect(findings[0]?.why).toMatch(/nothing else would reveal/i);
  });

  it('detects two events claiming the same position', () => {
    const log = logOf(2);
    const duplicated = [...log, { ...log[1]!, id: 'ev3' }];

    expect(verifyLog(duplicated).map((f) => f.defect)).toContain('SEQUENCE_DUPLICATE');
  });

  it('detects events recorded out of order', () => {
    const log = logOf(2);
    const backwards = [log[0]!, { ...log[1]!, at: '2025-01-01T00:00:00.000Z' }];

    expect(verifyLog(backwards).map((f) => f.defect)).toContain('OUT_OF_ORDER');
  });

  it('redacts a payload while preserving the event', () => {
    /*
     * §40's documented strategy for legal deletion. What survives is deliberate: the id, the
     * position, the timestamp, the actor, the category and the action. A missing row cannot be
     * distinguished from a row never written, and a log with unexplained gaps proves nothing about
     * anything near them.
     */
    const log = logOf(2);
    const target = log[1]!;

    const result = redact(target, {
      redactedBy: 'DPO',
      at: LATER,
      authority: 'UK GDPR Article 17 erasure request, ref SAR-2026-014',
      keys: ['email'],
    });

    if (!result.ok) throw new Error('expected a redaction');

    expect(result.value.id).toBe(target.id);
    expect(result.value.sequence).toBe(target.sequence);
    expect(result.value.at).toBe(target.at);
    expect(result.value.actor).toBe(target.actor);
    expect(result.value.payload.email).toBeUndefined();
    expect(result.value.payload.field).toBe('label');
    expect(result.value.redaction?.removedKeys).toEqual(['email']);
    expect(result.value.redaction?.authority).toMatch(/Article 17/);
  });

  it('leaves a redacted log with no sequence gap', () => {
    // The whole point. Redaction removes content; deletion would remove the evidence that anything
    // was ever there.
    const log = logOf(3);

    const result = redact(log[1]!, {
      redactedBy: 'DPO',
      at: LATER,
      authority: 'Erasure request.',
      keys: ['email'],
    });

    if (!result.ok) throw new Error('expected a redaction');

    expect(verifyLog([log[0]!, result.value, log[2]!])).toEqual([]);
  });

  it('refuses a redaction with no recorded authority', () => {
    // A redaction with no basis is indistinguishable from somebody removing an inconvenient record.
    const result = redact(logOf(1)[0]!, {
      redactedBy: 'DPO',
      at: LATER,
      authority: '  ',
      keys: ['email'],
    });

    expect(result.ok ? undefined : result.refusal).toBe('NO_AUTHORITY');
  });

  it('refuses to redact an already-redacted event', () => {
    // Redacting twice would overwrite the record of the first redaction, which is the one thing a
    // second redaction must not do.
    const first = redact(logOf(1)[0]!, {
      redactedBy: 'DPO',
      at: LATER,
      authority: 'Erasure request.',
      keys: ['email'],
    });

    if (!first.ok) throw new Error('expected a redaction');

    const second = redact(first.value, {
      redactedBy: 'DPO',
      at: LATER,
      authority: 'Another request.',
      keys: ['field'],
    });

    expect(second.ok ? undefined : second.refusal).toBe('ALREADY_REDACTED');
  });

  it('records the redaction as an auditable act of its own', () => {
    const target = logOf(1)[0]!;

    const event = redactionEvent(target, {
      redactedBy: 'DPO',
      at: LATER,
      authority: 'Erasure request.',
      keys: ['email'],
    });

    expect(event.category).toBe('RETENTION');
    expect(event.subjectId).toBe(target.id);
    expect(event.actor).toBe('DPO');
  });

  it('queries in sequence order regardless of how the log was filtered', () => {
    const log = logOf(4);

    const found = query([...log].reverse(), { category: 'PROJECT_CHANGE' });

    expect(found.map((e) => e.sequence)).toEqual([1, 2, 3, 4]);
  });

  it('filters by subject, actor and time', () => {
    const log = logOf(4);

    expect(query(log, { subjectId: 'n2' }).map((e) => e.id)).toEqual(['ev2']);
    expect(query(log, { actor: 'nobody' })).toEqual([]);
    expect(query(log, { since: '2026-01-03T00:00:00.000Z' }).map((e) => e.id)).toEqual([
      'ev3',
      'ev4',
    ]);
  });
});
