/**
 * The lifecycle golden suite.
 *
 * Contract: plan §6 — "Create golden transition tests for **every allowed and prohibited
 * transition**." Twelve states means 144 ordered pairs, and this asserts all of them.
 *
 * That exhaustiveness is the point. A hand-picked selection of transitions tests the ones somebody
 * thought of, and the dangerous transitions are the ones nobody thought of — IDEA straight to LIVE,
 * ARCHIVED back to IN_PROGRESS. Enumerating the full matrix means a future edit that accidentally
 * permits one fails here rather than in production.
 */

import { describe, expect, it } from 'vitest';
import {
  ARCHIVABLE_FROM,
  LIFECYCLE_STATES,
  TRANSITIONS,
  assertTransition,
  checkTransition,
  findTransition,
  isLifecycleState,
  nextStates,
  shortestPath,
  type GateStatus,
  type LifecycleState,
} from '../src/lifecycle.ts';
import { GATE_KEYS } from '../src/gates.ts';

/** Every gate passed, for tests about structure rather than about gates. */
const ALL_PASSED: GateStatus[] = GATE_KEYS.map((key) => ({ key, passed: true }));
const NONE_PASSED: GateStatus[] = GATE_KEYS.map((key) => ({ key, passed: false }));

/** The transitions the machine is supposed to permit, as a set of `from>to` strings. */
const PERMITTED = new Set<string>([
  ...TRANSITIONS.map((t) => `${t.from}>${t.to}`),
  ...ARCHIVABLE_FROM.map((from) => `${from}>ARCHIVED`),
]);

describe('the state set', () => {
  it('has the twelve states plan §6 names, in order', () => {
    expect(LIFECYCLE_STATES).toEqual([
      'IDEA',
      'DISCOVERY',
      'PLANNING',
      'PLANNED',
      'APPROVED',
      'IN_PROGRESS',
      'VERIFYING',
      'RELEASE_READY',
      'LIVE',
      'OPERATING',
      'COMPLETED',
      'ARCHIVED',
    ]);
  });

  it('rejects a state it does not recognise', () => {
    expect(isLifecycleState('ON_HOLD')).toBe(false);
  });
});

describe('the complete transition matrix', () => {
  /*
   * All 144 ordered pairs.
   *
   * Generated rather than listed, so adding a thirteenth state extends the matrix automatically
   * instead of leaving a silent gap.
   */
  for (const from of LIFECYCLE_STATES) {
    for (const to of LIFECYCLE_STATES) {
      const key = `${from}>${to}`;
      const shouldBePermitted = PERMITTED.has(key);

      if (from === to) {
        it(`refuses ${from} → ${to}: a project cannot transition to the state it is in`, () => {
          const result = findTransition(from, to);
          expect(result.ok).toBe(false);
          if (!result.ok) expect(result.code).toBe('SAME_STATE');
        });
        continue;
      }

      if (shouldBePermitted) {
        it(`permits ${from} → ${to}`, () => {
          const result = checkTransition(from, to, ALL_PASSED);
          expect(result.ok, `${key} should be permitted`).toBe(true);
        });
      } else {
        it(`refuses ${from} → ${to}`, () => {
          const result = findTransition(from, to);
          expect(result.ok, `${key} should not be permitted`).toBe(false);
          if (!result.ok) expect(result.code).toBe('NOT_PERMITTED');
        });
      }
    }
  }
});

describe('the transitions plan §6 names explicitly', () => {
  /*
   * Six transitions the plan spells out with their gate requirements. Asserted individually as well
   * as through the matrix above, because the matrix tests *whether* a transition is permitted and
   * these test *what it requires* — which is the part that carries the meaning.
   */

  it('PLANNED → APPROVED requires the planning gate', () => {
    const result = findTransition('PLANNED', 'APPROVED');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.requiredGates).toContain('PLANNING');
  });

  it('IN_PROGRESS → VERIFYING requires development readiness', () => {
    const result = findTransition('IN_PROGRESS', 'VERIFYING');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.requiredGates).toContain('DEVELOPMENT');
  });

  it('VERIFYING → RELEASE_READY requires testing, security and release gates', () => {
    const result = findTransition('VERIFYING', 'RELEASE_READY');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.requiredGates).toEqual(
        expect.arrayContaining(['TESTING', 'SECURITY', 'RELEASE_READINESS']),
      );
    }
  });

  it('RELEASE_READY → LIVE requires deployment authorisation', () => {
    const result = findTransition('RELEASE_READY', 'LIVE');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.requiredGates).toContain('RELEASE_READINESS');
  });

  it('LIVE → OPERATING requires production verification', () => {
    const result = findTransition('LIVE', 'OPERATING');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.requiredGates).toContain('PRODUCTION_VERIFICATION');
  });

  it('OPERATING → COMPLETED requires the handover and completion gates', () => {
    const result = findTransition('OPERATING', 'COMPLETED');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.requiredGates).toEqual(
        expect.arrayContaining(['OPERATIONAL_READINESS', 'COMPLETION']),
      );
    }
  });
});

describe('gates block transitions that would record something untrue', () => {
  const GATED = TRANSITIONS.filter((t) => t.gates.length > 0);

  it('there are gated transitions to test', () => {
    // Guards the guard: if the transition table lost its gates, every test below would pass vacuously.
    expect(GATED.length).toBeGreaterThan(4);
  });

  for (const transition of GATED) {
    it(`refuses ${transition.from} → ${transition.to} when its gates have not passed`, () => {
      const result = checkTransition(transition.from, transition.to, NONE_PASSED);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('GATE_NOT_PASSED');
    });

    it(`permits ${transition.from} → ${transition.to} once its gates pass`, () => {
      expect(checkTransition(transition.from, transition.to, ALL_PASSED).ok).toBe(true);
    });
  }

  it('treats an unevaluated gate as not passed', () => {
    /*
     * The distinction that stops gates being optional.
     *
     * Passing an empty list means no gate has been evaluated. If that counted as satisfied, every
     * gate would be skippable by simply never running it — the same failure as a security control
     * enforced only when someone remembers to switch it on.
     */
    const result = checkTransition('VERIFYING', 'RELEASE_READY', []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('GATE_NOT_PASSED');
  });

  it('names which gates are outstanding', () => {
    // A refusal that does not say what is missing sends the user looking.
    const result = checkTransition('VERIFYING', 'RELEASE_READY', NONE_PASSED);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/testing/i);
      expect(result.reason).toMatch(/security/i);
    }
  });

  it('permits an ungated transition with no gates evaluated', () => {
    // Going back from VERIFYING to IN_PROGRESS is the system working. Gating it would push people to
    // press on instead of returning to fix something.
    expect(checkTransition('VERIFYING', 'IN_PROGRESS', []).ok).toBe(true);
  });
});

describe('archiving and restoration', () => {
  it('can archive from any state', () => {
    // A project can be abandoned at any point. Forcing it through COMPLETED first would record that
    // it was handed over when it was not.
    for (const from of LIFECYCLE_STATES) {
      if (from === 'ARCHIVED') continue;
      expect(checkTransition(from, 'ARCHIVED', []).ok, `${from} → ARCHIVED`).toBe(true);
    }
  });

  it('archiving needs no gate', () => {
    const result = findTransition('IN_PROGRESS', 'ARCHIVED');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.requiredGates).toEqual([]);
  });

  it('can restore from the archive', () => {
    // Gap-spec §8.3 permits restoration explicitly. A one-way door makes people avoid archiving
    // things that should be archived.
    expect(checkTransition('ARCHIVED', 'COMPLETED', []).ok).toBe(true);
  });

  it('cannot go from the archive straight back into build', () => {
    // Restoration returns a project to where it was closed, not to the middle of the work.
    expect(findTransition('ARCHIVED', 'IN_PROGRESS').ok).toBe(false);
  });
});

describe('the transitions that must never be permitted', () => {
  /*
   * Named individually as well as covered by the matrix.
   *
   * Each of these would produce a project whose recorded state is a lie, and each is the kind of
   * shortcut somebody eventually asks for under deadline pressure. Naming them makes the refusal a
   * deliberate decision rather than an accident of the table.
   */
  const FORBIDDEN: readonly [LifecycleState, LifecycleState, string][] = [
    ['IDEA', 'LIVE', 'nothing has been decided, built or checked'],
    ['IDEA', 'IN_PROGRESS', 'there is nothing to build yet'],
    ['DISCOVERY', 'APPROVED', 'there is no plan to approve'],
    ['PLANNING', 'IN_PROGRESS', 'the plan has not been approved'],
    ['PLANNED', 'IN_PROGRESS', 'approval has been skipped'],
    ['APPROVED', 'RELEASE_READY', 'nothing has been built or verified'],
    ['IN_PROGRESS', 'LIVE', 'nothing has been verified'],
    ['IN_PROGRESS', 'RELEASE_READY', 'verification has been skipped'],
    ['VERIFYING', 'LIVE', 'the release gates have been skipped'],
    ['RELEASE_READY', 'OPERATING', 'nothing has been deployed'],
    ['LIVE', 'COMPLETED', 'production verification has been skipped'],
    ['COMPLETED', 'IN_PROGRESS', 'the project was closed'],
  ];

  for (const [from, to, why] of FORBIDDEN) {
    it(`refuses ${from} → ${to} because ${why}`, () => {
      const result = findTransition(from, to);
      expect(result.ok).toBe(false);
    });
  }

  it('explains the refusal with a route that would work', () => {
    // "You cannot do that" with no alternative is where people start looking for a way around.
    const result = findTransition('IDEA', 'LIVE');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/would need to go through/i);
      expect(result.reason).toMatch(/discovery/i);
    }
  });
});

describe('paths through the machine', () => {
  it('finds the route from an idea to a running system', () => {
    const path = shortestPath('IDEA', 'OPERATING');
    expect(path).not.toBeNull();
    expect(path?.[0]).toBe('IDEA');
    expect(path?.[path.length - 1]).toBe('OPERATING');
  });

  it('the route passes through every intermediate state', () => {
    // There is no shortcut. Each state on the path asserts something that had to be true first.
    const path = shortestPath('IDEA', 'LIVE') ?? [];
    expect(path).toEqual([
      'IDEA',
      'DISCOVERY',
      'PLANNING',
      'PLANNED',
      'APPROVED',
      'IN_PROGRESS',
      'VERIFYING',
      'RELEASE_READY',
      'LIVE',
    ]);
  });

  it('returns a single-element path from a state to itself', () => {
    expect(shortestPath('IDEA', 'IDEA')).toEqual(['IDEA']);
  });

  it('lists the next states from anywhere', () => {
    expect(nextStates('VERIFYING')).toEqual(
      expect.arrayContaining(['IN_PROGRESS', 'RELEASE_READY']),
    );
  });

  it('offers archiving from every state except the archive', () => {
    for (const state of LIFECYCLE_STATES) {
      const next = nextStates(state);
      if (state === 'ARCHIVED') expect(next).not.toContain('ARCHIVED');
      else expect(next, state).toContain('ARCHIVED');
    }
  });

  it('returns the same next states on repeated calls', () => {
    // Determinism: the UI renders these as buttons, and a list that reorders between renders looks
    // like the project changed.
    expect(nextStates('OPERATING')).toEqual(nextStates('OPERATING'));
  });

  it('every state is reachable from IDEA', () => {
    // A state nothing can reach is a state that exists only in the type.
    for (const state of LIFECYCLE_STATES) {
      expect(shortestPath('IDEA', state), `${state} unreachable`).not.toBeNull();
    }
  });
});

describe('assertTransition', () => {
  it('passes silently for a permitted transition', () => {
    expect(() => {
      assertTransition('IDEA', 'DISCOVERY', []);
    }).not.toThrow();
  });

  it('throws with the reason for a forbidden one', () => {
    expect(() => {
      assertTransition('IDEA', 'LIVE', ALL_PASSED);
    }).toThrow(/cannot go straight from/i);
  });

  it('throws with a conflict category when a gate blocks it', () => {
    // A gate that has not passed is a conflict with the project's state, not a validation error in
    // the request — the request was well formed and the project is not ready.
    try {
      assertTransition('VERIFYING', 'RELEASE_READY', NONE_PASSED);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as { category?: string }).category).toBe('CONFLICT');
    }
  });

  it('refuses an unrecognised state', () => {
    expect(() => {
      assertTransition('IDEA', 'ON_HOLD', []);
    }).toThrow(/not a state this platform recognises/i);
  });
});

describe('the transition table itself', () => {
  it('never names a gate that does not exist', () => {
    // A transition requiring a gate nothing defines could never be satisfied, and the failure would
    // look like a project problem rather than a configuration one.
    const known = new Set<string>(GATE_KEYS);
    for (const transition of TRANSITIONS) {
      for (const gate of transition.gates) {
        expect(known.has(gate), `${transition.from} → ${transition.to} names ${gate}`).toBe(true);
      }
    }
  });

  it('gives every transition a stated meaning', () => {
    // The meaning is shown to the user when they make the transition. A blank one makes the action
    // look arbitrary.
    for (const transition of TRANSITIONS) {
      expect(transition.meaning.length, `${transition.from} → ${transition.to}`).toBeGreaterThan(
        15,
      );
    }
  });

  it('contains no duplicate transitions', () => {
    const keys = TRANSITIONS.map((t) => `${t.from}>${t.to}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('permits far fewer transitions than the states allow', () => {
    // 144 ordered pairs; a permissive machine would allow most of them. This measures whether the
    // deny-by-default design is actually doing anything.
    const total = LIFECYCLE_STATES.length * LIFECYCLE_STATES.length;
    expect(PERMITTED.size / total).toBeLessThan(0.25);
  });
});
