/**
 * The Phase-8 gate: solo and twelve-person fixtures produce valid execution plans.
 *
 * Contract: plan §34; gap-spec §17 (hierarchy, avoid fake levels), §18.3 (solo without ceremony),
 * §19 (overload, impossible parallelism, missing skills, single-person bottleneck).
 *
 * "Valid" is doing a lot of work in that gate, so it is broken into what it actually has to mean:
 * the graph satisfies its own invariants, the hierarchy has no level that groups one thing, every
 * task traces to something that required it, and the two fixtures produce genuinely different shapes.
 * The last one matters most — a decomposer that produced the same structure for a solo project and a
 * twelve-person one would pass every other assertion and be useless.
 */

import { describe, expect, it } from 'vitest';
import { checkInvariants, errorsOnly } from '@govintel/twin/invariants';
import { stableStringify } from '@govintel/twin/versioning';
import { decompose, mergeIntoGraph, DECOMPOSER_VERSION } from '../src/decompose.ts';
import {
  actualDepth,
  canNest,
  depthOf,
  findFakeHierarchy,
  HIERARCHY,
  planHierarchy,
  REQUIRED_LEVELS,
  type HierarchyNode,
} from '../src/hierarchy.ts';
import {
  FIXED_TIME,
  SOLO_PROJECT_ID,
  TEAM_PROJECT_ID,
  soloInputs,
  teamInputs,
} from './fixtures.ts';

function decomposeSolo() {
  const { graph, emissions } = soloInputs();
  return {
    graph,
    result: decompose({
      projectId: SOLO_PROJECT_ID,
      graph,
      emissions,
      teamSize: 1,
      at: FIXED_TIME,
    }),
  };
}

function decomposeTeam() {
  const { graph, emissions } = teamInputs();
  return {
    graph,
    result: decompose({
      projectId: TEAM_PROJECT_ID,
      graph,
      emissions,
      teamSize: 12,
      parallelAreas: 3,
      formalGovernance: true,
      at: FIXED_TIME,
    }),
  };
}

/* -------------------------------------------------------------------------- */
/* The gate                                                                   */
/* -------------------------------------------------------------------------- */

describe('the Phase-8 gate: both fixtures produce valid execution plans', () => {
  const cases = [
    ['solo', decomposeSolo],
    ['twelve-person', decomposeTeam],
  ] as const;

  for (const [name, build] of cases) {
    it(`produces work: ${name}`, () => {
      const { result } = build();
      expect(result.nodes.filter((n) => n.class === 'TASK').length).toBeGreaterThan(0);
    });

    it(`produces a graph that satisfies its own invariants: ${name}`, () => {
      // The strongest single check: edge legality, acyclicity, single parentage, tenancy.
      const { graph, result } = build();
      const merged = mergeIntoGraph(graph, result);

      expect(errorsOnly(checkInvariants(merged))).toEqual([]);
    });

    it(`contains no fake hierarchy: ${name}`, () => {
      /*
       * Gap-spec §17. A level that groups one thing adds a row to every view and separates nothing,
       * and it makes the plan harder to read while looking more thorough.
       */
      const { result } = build();
      const singleChild = result.fakeHierarchy.filter((f) => f.message.includes('one item'));

      expect(singleChild).toEqual([]);
    });

    it(`traces every task to something that required it: ${name}`, () => {
      // A task nobody can trace is one nobody can drop, and a decomposer that invented work would
      // produce a plan that looks thorough and is fiction.
      const { result } = build();

      for (const task of result.nodes.filter((n) => n.class === 'TASK')) {
        expect(task.provenance.sourceRef, task.label).toBeDefined();
      }
    });

    it(`is deterministic: ${name}`, () => {
      const first = stableStringify(build().result.nodes);
      const second = stableStringify(build().result.nodes);
      expect(second).toBe(first);
    });

    it(`produces stable, non-random ids: ${name}`, () => {
      const ids = build().result.nodes.map((n) => n.id);
      expect(ids.some((id) => /^[0-9a-f-]{36}$/.test(id))).toBe(false);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it(`records the decomposer version: ${name}`, () => {
      expect(build().result.decomposerVersion).toBe(DECOMPOSER_VERSION);
    });

    it(`explains every hierarchy decision: ${name}`, () => {
      // The reasoning is shown to the user. "We chose four levels" with no reason is a decision
      // nobody can disagree with.
      const { result } = build();
      expect(result.hierarchy.reasoning.length).toBeGreaterThan(4);
      for (const line of result.hierarchy.reasoning) {
        expect(line.length).toBeGreaterThan(30);
      }
    });
  }

  it('produces genuinely different shapes for the two fixtures', () => {
    /*
     * The assertion the whole gate rests on.
     *
     * A decomposer that produced the same structure regardless of team size would pass every test
     * above — valid graph, traceable tasks, deterministic output — and be worthless. Gap-spec §17
     * gives two worked examples precisely because the difference is the point.
     */
    const solo = decomposeSolo().result;
    const team = decomposeTeam().result;

    expect(solo.hierarchy.levels).not.toEqual(team.hierarchy.levels);
    expect(team.hierarchy.levels.length).toBeGreaterThan(solo.hierarchy.levels.length);
  });
});

/* -------------------------------------------------------------------------- */
/* Solo                                                                       */
/* -------------------------------------------------------------------------- */

describe('the solo project', () => {
  const { result } = decomposeSolo();

  it('is still decomposed', () => {
    // Gap-spec §18.3: the system must still decompose. Sequencing, checkpoints, dependencies and
    // focus are useful to one person; team ceremony is not.
    expect(result.nodes.filter((n) => n.class === 'TASK').length).toBeGreaterThan(3);
  });

  it('has no workstreams', () => {
    // With one person there are no separate groups to divide, so a workstream is a folder with
    // everybody in it.
    expect(result.hierarchy.levels).not.toContain('WORKSTREAM');
    expect(result.nodes.some((n) => n.class === 'WORKSTREAM')).toBe(false);
  });

  it('has no subtasks', () => {
    expect(result.hierarchy.levels).not.toContain('SUBTASK');
  });

  it('says why each level was left out', () => {
    const reasoning = result.hierarchy.reasoning.join(' ');
    expect(reasoning).toMatch(/no workstreams/i);
    expect(reasoning).toMatch(/same conversation/i);
  });

  it('still sequences the work', () => {
    // The thing decomposition is for, even alone: knowing what comes before what.
    expect(result.edges.some((e) => e.class === 'DEPENDS_ON')).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Twelve people                                                              */
/* -------------------------------------------------------------------------- */

describe('the twelve-person project', () => {
  const { result } = decomposeTeam();

  it('uses workstreams, because there are parallel areas and enough people', () => {
    expect(result.hierarchy.levels).toContain('WORKSTREAM');
    expect(result.nodes.some((n) => n.class === 'WORKSTREAM')).toBe(true);
  });

  it('uses milestones', () => {
    expect(result.hierarchy.levels).toContain('MILESTONE');
  });

  it('uses checkpoints, because governance needs intermediate evidence', () => {
    expect(result.hierarchy.levels).toContain('CHECKPOINT');
  });

  it('produces substantially more work than the solo project', () => {
    const solo = decomposeSolo().result;
    const soloTasks = solo.nodes.filter((n) => n.class === 'TASK').length;
    const teamTasks = result.nodes.filter((n) => n.class === 'TASK').length;

    expect(teamTasks).toBeGreaterThan(soloTasks);
  });

  it('groups work by the rule family that produced it, within a phase', () => {
    /*
     * Rule families correspond to how teams actually divide — security work, testing work — and a
     * different invented taxonomy would produce groupings nobody recognises.
     *
     * Labels carry the phase as well, because the same family recurs across phases and "Security"
     * appearing five times in a sidebar is not navigable.
     */
    const workstreams = result.nodes.filter((n) => n.class === 'WORKSTREAM').map((n) => n.label);

    expect(workstreams.length).toBeGreaterThan(1);
    expect(workstreams.join(' | ')).toMatch(/Security/);
    expect(workstreams.every((label) => label.includes(' — '))).toBe(true);
  });

  it('does not create a workstream for a family with no work in that phase', () => {
    // Containers are built from the work rather than from the taxonomy: creating one per possible
    // combination would produce mostly-empty structure whose emptiness is only visible afterwards.
    const workstreams = result.nodes.filter((n) => n.class === 'WORKSTREAM');
    const contained = new Set(
      result.edges.filter((e) => e.class === 'CONTAINS').map((e) => e.from),
    );

    for (const workstream of workstreams) {
      expect(contained.has(workstream.id), workstream.label).toBe(true);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Hierarchy                                                                  */
/* -------------------------------------------------------------------------- */

describe('choosing a hierarchy depth', () => {
  it('always includes the structural levels', () => {
    for (const shape of [
      { teamSize: 1, taskCount: 2 },
      { teamSize: 12, taskCount: 200, formalGovernance: true, parallelAreas: 4 },
    ]) {
      const plan = planHierarchy(shape);
      for (const level of REQUIRED_LEVELS) {
        expect(plan.levels, JSON.stringify(shape)).toContain(level);
      }
    }
  });

  it('gives a solo project the shallow shape gap-spec §17 shows', () => {
    // "Solo small project: Project → Phase → Milestone → Task".
    const plan = planHierarchy({ teamSize: 1, taskCount: 10 });
    expect(plan.levels).toEqual(['PROJECT', 'PHASE', 'MILESTONE', 'TASK']);
  });

  it('gives a large team a deep shape, but omits epics where workstreams already divide the work', () => {
    /*
     * A deliberate deviation from the literal §17 enterprise example, and worth stating plainly.
     *
     * §17 shows "Project → Phase → Workstream → Milestone → Epic → Task → Subtask". This engine has
     * exactly two axes to divide by: the phase, and the family of work the rule that emitted a task
     * belongs to. Workstreams already use both. An epic beneath one would therefore contain exactly
     * that workstream's tasks and nothing else — a level that groups one thing, which the same
     * section forbids two lines earlier.
     *
     * This was not reasoned out in advance; the fake-hierarchy check found it, and the first fix
     * produced a plan with no workstreams at all because the collapse pass removed them.
     *
     * An organisation with a genuine third axis — a product line, a customer segment — would justify
     * both levels. Adding epics without one would be adding rows to every screen to match a diagram.
     */
    const plan = planHierarchy({
      teamSize: 12,
      taskCount: 120,
      parallelAreas: 3,
      formalGovernance: true,
    });

    expect(plan.levels).toEqual(
      expect.arrayContaining(['WORKSTREAM', 'MILESTONE', 'TASK', 'SUBTASK', 'CHECKPOINT']),
    );
    expect(plan.levels).not.toContain('EPIC');
    expect(plan.reasoning.join(' ')).toMatch(/workstreams already divide the work by family/i);
  });

  it('uses epics when there are no workstreams to divide the work', () => {
    // The inverse. Without workstreams the family axis is unused, so epics are what carries it.
    const plan = planHierarchy({ teamSize: 3, taskCount: 60 });
    expect(plan.levels).toContain('EPIC');
  });

  it('does not add workstreams for a small team even with parallel areas', () => {
    // Below four people everyone is in the same conversation, and a boundary between them adds
    // coordination rather than removing it.
    expect(planHierarchy({ teamSize: 3, taskCount: 50, parallelAreas: 3 }).levels).not.toContain(
      'WORKSTREAM',
    );
  });

  it('does not add epics to a project with few tasks', () => {
    expect(planHierarchy({ teamSize: 8, taskCount: 10, parallelAreas: 2 }).levels).not.toContain(
      'EPIC',
    );
  });

  it('is deterministic', () => {
    const shape = { teamSize: 6, taskCount: 40, parallelAreas: 2 };
    expect(planHierarchy(shape)).toEqual(planHierarchy(shape));
  });

  it('gives a reason for every optional level, included or not', () => {
    const plan = planHierarchy({ teamSize: 2, taskCount: 5 });
    // Four optional levels, each accounted for.
    expect(plan.reasoning.length).toBeGreaterThanOrEqual(4);
  });
});

describe('detecting fake hierarchy', () => {
  function node(id: string, cls: HierarchyNode['class'], children: string[]): HierarchyNode {
    return { id, class: cls, label: id, childIds: children };
  }

  it('flags a container with exactly one child', () => {
    const findings = findFakeHierarchy([node('ws', 'WORKSTREAM', ['e1'])]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toMatch(/groups a single thing/i);
  });

  it('flags an empty container separately', () => {
    // An empty phase usually means work that was planned and forgotten, which is a different problem
    // from a structural mistake.
    const findings = findFakeHierarchy([node('ph', 'PHASE', [])]);
    expect(findings[0]?.message).toMatch(/is empty/i);
  });

  it('does not flag a container with two children', () => {
    expect(findFakeHierarchy([node('ws', 'WORKSTREAM', ['a', 'b'])])).toEqual([]);
  });

  it('does not flag a project with one phase', () => {
    // A project with one phase is a small project, not a fake hierarchy.
    expect(findFakeHierarchy([node('p', 'PROJECT', ['ph'])])).toEqual([]);
  });

  it('does not flag a task with one subtask', () => {
    expect(findFakeHierarchy([node('t', 'TASK', ['s'])])).toEqual([]);
  });

  it('says what to do about it', () => {
    const findings = findFakeHierarchy([node('ws', 'WORKSTREAM', ['e1'])]);
    expect(findings[0]?.message).toMatch(/fold it into its parent/i);
  });
});

describe('hierarchy nesting', () => {
  it('permits a level to contain any deeper level', () => {
    // Skipping levels is correct when the project omitted them: a phase containing tasks directly is
    // right when workstreams, milestones and epics were all left out.
    expect(canNest('PHASE', 'TASK')).toBe(true);
    expect(canNest('PROJECT', 'SUBTASK')).toBe(true);
  });

  it('refuses inversion', () => {
    expect(canNest('TASK', 'PHASE')).toBe(false);
    expect(canNest('EPIC', 'WORKSTREAM')).toBe(false);
  });

  it('refuses a level containing itself', () => {
    expect(canNest('TASK', 'TASK')).toBe(false);
  });

  it('orders the hierarchy as gap-spec §17 does', () => {
    expect(HIERARCHY).toEqual([
      'PROJECT',
      'PHASE',
      'WORKSTREAM',
      'MILESTONE',
      'EPIC',
      'TASK',
      'SUBTASK',
      'CHECKPOINT',
    ]);
    expect(depthOf('PROJECT')).toBeLessThan(depthOf('TASK'));
  });

  it('reports the levels actually used', () => {
    const used = actualDepth([
      { id: 'p', class: 'PROJECT', label: 'p', childIds: [] },
      { id: 't', class: 'TASK', label: 't', childIds: [] },
    ]);

    expect(used).toEqual(['PROJECT', 'TASK']);
  });
});
