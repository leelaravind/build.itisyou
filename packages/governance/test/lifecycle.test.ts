import { describe, expect, it } from 'vitest';
import {
  LIFECYCLE_STATES,
  TRANSITIONS,
  evaluateTransition,
  transitionsFrom,
  type GateReadiness,
  type LifecycleState,
  type TransitionContext,
} from '../src/lifecycle.ts';
import type { Approval } from '../src/approval.ts';

/**
 * Golden transition tests, as plan §6 requires: *"Create golden transition tests for every allowed
 * and prohibited transition."*
 *
 * Every allowed and prohibited transition means all 144 ordered pairs of the twelve states, not the
 * eleven edges that happen to exist. A table that only tests what it allows cannot tell you it stopped
 * allowing something, and cannot tell you at all when a new edge appears by accident.
 */

const ALL_GATES: readonly GateReadiness[] = [
  'DISCOVERY',
  'REQUIREMENTS',
  'ARCHITECTURE',
  'PLANNING',
  'DEVELOPMENT',
  'TESTING',
  'SECURITY',
  'RELEASE_READINESS',
  'PRODUCTION_VERIFICATION',
  'OPERATIONAL_READINESS',
  'COMPLETION',
].map((key) => ({ key, result: 'PASSED' }) as GateReadiness);

function approval(subjectType: Approval['subjectType'], subjectVersion = 1): Approval {
  return {
    id: `approval-${subjectType}-${String(subjectVersion)}`,
    projectId: 'project-1',
    subjectType,
    subjectId: 'project-1',
    subjectVersion,
    requestedBy: 'user-1',
    requestedAt: '2026-01-01T00:00:00.000Z',
    approverRole: 'PROJECT_OWNER',
    state: 'APPROVED',
    approverUser: 'user-2',
    decidedAt: '2026-01-02T00:00:00.000Z',
    comment: 'Agreed.',
    evidence: [],
  };
}

/** Everything satisfied: every gate passed, every approval granted and current, owner asking. */
const SATISFIED: TransitionContext = {
  gates: ALL_GATES,
  approvals: [approval('BASELINE'), approval('DEPLOYMENT')],
  subjectVersion: 1,
  role: 'PROJECT_OWNER',
};

const ALLOWED_EDGES = new Set(TRANSITIONS.map((t) => `${t.from}->${t.to}`));

describe('the transition table', () => {
  it('covers every state as a source or a destination', () => {
    // A state nothing reaches and nothing leaves is unreachable by construction, which would make it
    // a value the schema permits and the machine cannot produce.
    for (const state of LIFECYCLE_STATES) {
      const touches = TRANSITIONS.some((t) => t.from === state || t.to === state);
      expect(touches, `${state} appears in no transition`).toBe(true);
    }
  });

  it('has exactly one backward edge, and it is the archive restore', () => {
    /*
     * Deliberate, and worth pinning. The contract names twelve states and six forward examples; it
     * names no backward edge. §71 requires an archive to be restorable, which is a restore rather
     * than a reversal — reworking something that has moved on is a change request (§28), and a
     * silent backward slide would route around it.
     */
    const order = (s: LifecycleState) => LIFECYCLE_STATES.indexOf(s);
    const backward = TRANSITIONS.filter((t) => order(t.to) < order(t.from));

    expect(backward).toHaveLength(1);
    expect(backward[0]?.from).toBe('ARCHIVED');
    expect(backward[0]?.to).toBe('COMPLETED');
  });

  it('never skips a state on the forward path', () => {
    // Every forward edge moves exactly one step. A skip would let a project reach LIVE without ever
    // having been VERIFYING, and the gates attached to the step it jumped would never be consulted.
    const order = (s: LifecycleState) => LIFECYCLE_STATES.indexOf(s);

    for (const t of TRANSITIONS) {
      if (order(t.to) < order(t.from)) continue;
      expect(order(t.to) - order(t.from), `${t.from} -> ${t.to} skips a state`).toBe(1);
    }
  });

  it('states a reason for every edge', () => {
    // The refusal text is shown to whoever is blocked; the `why` is what a reviewer reads when asked
    // to remove a requirement. An edge with no stated reason is one nobody can argue with.
    for (const t of TRANSITIONS) {
      expect(t.why.length, `${t.from} -> ${t.to} has no stated reason`).toBeGreaterThan(30);
    }
  });
});

describe('every ordered pair of states', () => {
  const pairs = LIFECYCLE_STATES.flatMap((from) =>
    LIFECYCLE_STATES.map((to) => ({ from, to, key: `${from}->${to}` })),
  );

  it('is exhaustive over the twelve states', () => {
    expect(pairs).toHaveLength(144);
  });

  it.each(pairs)('$from -> $to', ({ from, to, key }) => {
    const verdict = evaluateTransition(from, to, SATISFIED);

    if (from === to) {
      expect(verdict.allowed).toBe(false);
      if (!verdict.allowed) expect(verdict.refusal).toBe('ALREADY_IN_STATE');
      return;
    }

    if (ALLOWED_EDGES.has(key)) {
      // With everything satisfied, every declared edge must actually be traversable. An edge whose
      // requirements can never be met is a state nobody can leave.
      expect(verdict.allowed, `${key} is declared but refused when everything is satisfied`).toBe(
        true,
      );
      return;
    }

    expect(verdict.allowed, `${key} is not declared but was allowed`).toBe(false);
    if (!verdict.allowed) expect(verdict.refusal).toBe('NOT_A_TRANSITION');
  });
});

describe('gates are required, and indeterminate is a refusal', () => {
  it('refuses when a required gate has not passed', () => {
    const verdict = evaluateTransition('IN_PROGRESS', 'VERIFYING', {
      ...SATISFIED,
      gates: ALL_GATES.map((g) => (g.key === 'DEVELOPMENT' ? { ...g, result: 'FAILED' } : g)),
    });

    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.refusal).toBe('GATE_NOT_PASSED');
      expect(verdict.blocking).toEqual(['DEVELOPMENT']);
    }
  });

  it.each(['INDETERMINATE', 'NOT_EVALUATED'] as const)('refuses on a %s gate', (result) => {
    /*
     * The load-bearing case. A gate nobody evaluated is not a gate anybody satisfied — §15.9's own
     * rule, applied to the thing that consumes gates. If this ever passes, an unrun check becomes
     * indistinguishable from a passed one, which is the failure the whole gate model exists to stop.
     */
    const verdict = evaluateTransition('IN_PROGRESS', 'VERIFYING', {
      ...SATISFIED,
      gates: ALL_GATES.map((g) => (g.key === 'DEVELOPMENT' ? { ...g, result } : g)),
    });

    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.refusal).toBe('GATE_NOT_PASSED');
  });

  it('refuses when a gate is absent entirely', () => {
    // Absence is not neutrality either: a gate missing from the list has not passed.
    const verdict = evaluateTransition('IN_PROGRESS', 'VERIFYING', {
      ...SATISFIED,
      gates: ALL_GATES.filter((g) => g.key !== 'DEVELOPMENT'),
    });

    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.blocking).toEqual(['DEVELOPMENT']);
  });

  it('names every unmet gate at once, not the first', () => {
    // Three gates guard this edge and they fail independently. Reporting one at a time costs three
    // rounds of "fix it and try again" to learn what one message could have said.
    const verdict = evaluateTransition('VERIFYING', 'RELEASE_READY', {
      ...SATISFIED,
      gates: ALL_GATES.map((g) =>
        g.key === 'TESTING' || g.key === 'SECURITY' ? { ...g, result: 'FAILED' } : g,
      ),
    });

    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.blocking).toEqual(['TESTING', 'SECURITY']);
  });
});

describe('approvals are required, and staleness counts', () => {
  it('refuses PLANNED -> APPROVED without a baseline approval', () => {
    const verdict = evaluateTransition('PLANNED', 'APPROVED', { ...SATISFIED, approvals: [] });

    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.refusal).toBe('APPROVAL_MISSING');
      expect(verdict.blocking).toEqual(['BASELINE']);
    }
  });

  it('does not accept an approval for a different subject', () => {
    // A deployment sign-off is not a baseline sign-off. Accepting any approval would make the
    // subject field decorative.
    const verdict = evaluateTransition('PLANNED', 'APPROVED', {
      ...SATISFIED,
      approvals: [approval('DEPLOYMENT')],
    });

    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.refusal).toBe('APPROVAL_MISSING');
  });

  it('does not accept a rejected or withdrawn approval as a granted one', () => {
    for (const state of ['REJECTED', 'WITHDRAWN', 'INVALIDATED', 'REQUESTED'] as const) {
      const verdict = evaluateTransition('PLANNED', 'APPROVED', {
        ...SATISFIED,
        approvals: [{ ...approval('BASELINE'), state }],
      });

      expect(verdict.allowed, `${state} was treated as granted`).toBe(false);
    }
  });

  it('refuses an approval given against an older version of the project', () => {
    /*
     * §33: "If subject changes after approval: approval becomes stale/invalid." The signature was
     * about a different plan, and treating it as current is how a change ships under an approval
     * nobody gave it.
     */
    const verdict = evaluateTransition('PLANNED', 'APPROVED', {
      ...SATISFIED,
      approvals: [approval('BASELINE', 1)],
      subjectVersion: 4,
    });

    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.refusal).toBe('APPROVAL_STALE');
  });

  it('accepts when at least one granted approval is current', () => {
    // A sign-off can require several roles. One stale signature alongside a current one is a partial
    // sign-off, not a failed one — the missing role is `signOffStatus`'s question, not this one's.
    const verdict = evaluateTransition('PLANNED', 'APPROVED', {
      ...SATISFIED,
      approvals: [approval('BASELINE', 1), approval('BASELINE', 4)],
      subjectVersion: 4,
    });

    expect(verdict.allowed).toBe(true);
  });
});

describe('the archive restore', () => {
  it('is refused for anyone but the project owner', () => {
    for (const role of ['PROJECT_MANAGER', 'ENGINEER', 'REVIEWER', 'APPROVER', 'VIEWER'] as const) {
      const verdict = evaluateTransition('ARCHIVED', 'COMPLETED', { ...SATISFIED, role });

      expect(verdict.allowed, `${role} was allowed to restore an archive`).toBe(false);
      if (!verdict.allowed) expect(verdict.refusal).toBe('ROLE_NOT_PERMITTED');
    }
  });

  it('is refused for a caller with no project role at all', () => {
    // A guest holds no project role. Deny by default rather than treating "no role" as unrestricted.
    const { role: _omitted, ...withoutRole } = SATISFIED;
    const verdict = evaluateTransition('ARCHIVED', 'COMPLETED', withoutRole);

    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.refusal).toBe('ROLE_NOT_PERMITTED');
  });

  it('is allowed for the project owner', () => {
    expect(evaluateTransition('ARCHIVED', 'COMPLETED', SATISFIED).allowed).toBe(true);
  });
});

describe('transitionsFrom', () => {
  it('offers exactly one next step from every state except COMPLETED', () => {
    // COMPLETED is the only fork: archive it, or leave it. Everything else is a line.
    for (const state of LIFECYCLE_STATES) {
      const next = transitionsFrom(state);
      if (state === 'COMPLETED') expect(next).toHaveLength(1);
      else if (state === 'ARCHIVED') expect(next).toHaveLength(1);
      else expect(next.length, `${state} should offer one next step`).toBe(1);
    }
  });

  it('never offers a state as its own next step', () => {
    for (const state of LIFECYCLE_STATES) {
      expect(transitionsFrom(state).some((t) => t.to === state)).toBe(false);
    }
  });
});

describe('refusal messages', () => {
  it('say what is missing without suggesting how to avoid it', () => {
    const verdict = evaluateTransition('IN_PROGRESS', 'VERIFYING', {
      ...SATISFIED,
      gates: ALL_GATES.map((g) => (g.key === 'DEVELOPMENT' ? { ...g, result: 'FAILED' } : g)),
    });

    if (!verdict.allowed) {
      expect(verdict.explanation).toContain('development');
      // An operator who cannot see which gate blocked them asks for the gate to be removed.
      expect(verdict.explanation).not.toMatch(/override|bypass|force|skip/i);
    }
  });

  it('reads as a sentence rather than an enum', () => {
    const verdict = evaluateTransition('IDEA', 'LIVE', SATISFIED);

    if (!verdict.allowed) {
      expect(verdict.explanation).toBe('A project cannot move from idea to live.');
    }
  });
});
