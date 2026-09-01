/**
 * Capacity, the board and the Today view.
 *
 * Contract: gap-spec §19 (capacity formula, and detecting overload, impossible parallelism, missing
 * skills and single-person bottlenecks); §18.2 (AI tools are capabilities, not employees); §18.3
 * (solo delivery gets focus, not ceremony); plan §34 lists board and Today as Phase-8 deliverables.
 *
 * The capacity tests are mostly about what is *subtracted*. Every deduction in §19's formula is
 * something plans routinely omit, and each omission points the same way — a schedule built on nominal
 * headcount is wrong from the first week. So the assertions are about the deductions being itemised
 * and the assumptions being stated, not just about the arithmetic.
 */

import { describe, expect, it } from 'vitest';
import { TwinGraph } from '@govintel/twin/graph';
import { createNode, type TwinNode } from '@govintel/twin/nodes';
import type { EdgeClass, TwinEdge } from '@govintel/twin/edges';
import {
  DEFAULT_DEDUCTIONS,
  capacityOf,
  findScheduleProblems,
  maxConcurrentWork,
  summariseCapacity,
  type HumanResource,
} from '../src/scheduling.ts';
import {
  BOARD_COLUMNS,
  TASK_STATUSES,
  buildBoard,
  buildToday,
  isTaskStatus,
  summariseProject,
} from '../src/board.ts';
import { decompose, mergeIntoGraph } from '../src/decompose.ts';
import {
  FIXED_TIME,
  SOLO_CAPABILITIES,
  SOLO_PROJECT_ID,
  SOLO_RESOURCES,
  TEAM_PROJECT_ID,
  TEAM_RESOURCES,
  soloInputs,
  teamInputs,
} from './fixtures.ts';

const AT = '2026-03-01T09:00:00.000Z';
const PROJECT = 'p1';

function task(id: string, status = 'TODO', attributes: Record<string, unknown> = {}): TwinNode {
  return createNode({
    id,
    projectId: PROJECT,
    class: 'TASK',
    label: id,
    provenance: {
      provenance: 'DETERMINISTIC_CALCULATION',
      confidence: 'HIGH',
      sourceRef: 'rule:X',
    },
    attributes: { status, ...attributes },
    at: AT,
  });
}

function edge(from: string, to: string, edgeClass: EdgeClass = 'DEPENDS_ON'): TwinEdge {
  return {
    id: `${from}->${edgeClass}->${to}`,
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

/* -------------------------------------------------------------------------- */
/* Capacity                                                                   */
/* -------------------------------------------------------------------------- */

describe('capacity', () => {
  const fullTime: HumanResource = {
    id: 'r1',
    name: 'Sam',
    role: 'Developer',
    skills: ['TypeScript'],
    workingHoursPerWeek: 37.5,
    projectAllocation: 1,
  };

  it('subtracts leave and overhead by default', () => {
    // §19's formula names both. A plan that omits them is wrong by roughly a third, predictably.
    const capacity = capacityOf(fullTime);
    expect(capacity.availableHours).toBeLessThan(fullTime.workingHoursPerWeek);
    expect(capacity.deductions.map((d) => d.reason)).toEqual(
      expect.arrayContaining(['Leave and sickness', 'Meetings and overhead']),
    );
  });

  it('itemises each deduction rather than applying one factor', () => {
    /*
     * "You have 22 hours" invites disagreement with no way to locate it. The itemised form locates
     * the disagreement precisely, which is the difference between a figure that can be argued with
     * and one that is merely disbelieved.
     */
    const capacity = capacityOf(fullTime);
    for (const deduction of capacity.deductions) {
      expect(deduction.hours).toBeGreaterThan(0);
      expect(deduction.reason.length).toBeGreaterThan(3);
    }
  });

  it('states that the defaults were assumed', () => {
    const capacity = capacityOf(fullTime);
    expect(capacity.assumptions.join(' ')).toMatch(/assumed at/i);
    expect(capacity.assumptions.join(' ')).toMatch(/because none was recorded/i);
  });

  it('does not assume when the figures were supplied', () => {
    const stated: HumanResource = { ...fullTime, leaveHoursPerWeek: 2, overheadHoursPerWeek: 5 };
    expect(capacityOf(stated).assumptions.join(' ')).not.toMatch(/assumed at/i);
  });

  it('subtracts other projects and support commitments', () => {
    const busy: HumanResource = {
      ...fullTime,
      otherProjectHoursPerWeek: 10,
      supportHoursPerWeek: 5,
    };

    const reasons = capacityOf(busy).deductions.map((d) => d.reason);
    expect(reasons).toContain('Other projects');
    expect(reasons).toContain('Support and on-call');
  });

  it('applies allocation to what remains, not to the contracted hours', () => {
    /*
     * Applying allocation first would deduct a full person's overhead from a half person's time,
     * producing a negative figure for anyone under about half allocation.
     */
    const half: HumanResource = { ...fullTime, projectAllocation: 0.25 };
    expect(capacityOf(half).availableHours).toBeGreaterThan(0);
  });

  it('warns that splitting a person costs more than the arithmetic', () => {
    // Stated, not silently applied. The size of the effect is disputed and applying an unmeasured
    // factor would be inventing precision.
    const split: HumanResource = { ...fullTime, projectAllocation: 0.5 };
    expect(capacityOf(split).assumptions.join(' ')).toMatch(/context switching/i);
  });

  it('never produces a negative figure', () => {
    const overcommitted: HumanResource = {
      ...fullTime,
      otherProjectHoursPerWeek: 30,
      supportHoursPerWeek: 20,
    };

    expect(capacityOf(overcommitted).availableHours).toBeGreaterThanOrEqual(0);
  });

  it('uses defaults in the range the comment claims', () => {
    // Guards the constants against being quietly changed to make a fixture pass.
    expect(DEFAULT_DEDUCTIONS.leaveProportion).toBeGreaterThan(0.05);
    expect(DEFAULT_DEDUCTIONS.overheadProportion).toBeGreaterThan(0.1);
  });
});

/* -------------------------------------------------------------------------- */
/* Schedule problems §19 requires                                             */
/* -------------------------------------------------------------------------- */

describe('the problems gap-spec §19 requires detecting', () => {
  const tasks = [task('t1'), task('t2'), task('t3')];

  it('reports no capacity when there is nobody', () => {
    const problems = findScheduleProblems({ graph: graphOf(tasks), resources: [] });
    expect(problems.map((p) => p.code)).toContain('NO_CAPACITY');
    expect(problems[0]?.severity).toBe('ERROR');
  });

  it('reports only that, rather than every consequence of it', () => {
    // Everything else reasons about capacity, and there is none. Listing the consequences separately
    // would bury the single fact that matters.
    const problems = findScheduleProblems({ graph: graphOf(tasks), resources: [] });
    expect(problems).toHaveLength(1);
  });

  it('reports overload as an error when even the optimistic estimate does not fit', () => {
    const problems = findScheduleProblems({
      graph: graphOf(tasks),
      resources: SOLO_RESOURCES,
      effortByTask: { t1: { low: 200, high: 300 } },
      weeks: 2,
    });

    const overload = problems.find((p) => p.code === 'OVERLOAD');
    expect(overload?.severity).toBe('ERROR');
    expect(overload?.message).toMatch(/scope, people or the date/i);
  });

  it('reports overload as a warning when it fits only if everything goes well', () => {
    const problems = findScheduleProblems({
      graph: graphOf(tasks),
      resources: SOLO_RESOURCES,
      effortByTask: { t1: { low: 10, high: 60 } },
      weeks: 2,
    });

    const overload = problems.find((p) => p.code === 'OVERLOAD');
    expect(overload?.severity).toBe('WARNING');
    expect(overload?.message).toMatch(/which is not a plan/i);
  });

  it('reports no overload when the work fits', () => {
    const problems = findScheduleProblems({
      graph: graphOf(tasks),
      resources: TEAM_RESOURCES,
      effortByTask: { t1: { low: 10, high: 20 } },
      weeks: 4,
    });

    expect(problems.map((p) => p.code)).not.toContain('OVERLOAD');
  });

  it('reports impossible parallelism', () => {
    // A plan with more simultaneous work than people is sequential work drawn wrongly, and the end
    // date it implies is arithmetic rather than a forecast.
    const many = Array.from({ length: 12 }, (_, i) => task(`t${String(i)}`));
    const problems = findScheduleProblems({ graph: graphOf(many), resources: SOLO_RESOURCES });

    expect(problems.map((p) => p.code)).toContain('IMPOSSIBLE_PARALLELISM');
  });

  it('reports a dependency cycle as an error', () => {
    const cyclic = graphOf([task('a'), task('b')], [edge('a', 'b'), edge('b', 'a')]);
    const problems = findScheduleProblems({ graph: cyclic, resources: SOLO_RESOURCES });

    const cycle = problems.find((p) => p.code === 'IMPOSSIBLE_PARALLELISM');
    expect(cycle?.severity).toBe('ERROR');
    expect(cycle?.message).toMatch(/cycle/i);
  });

  it('reports the single-person bottleneck without drowning it in noise', () => {
    // §18.3: solo delivery gets sequencing and focus, not assignment bureaucracy. Reporting every
    // task as unassigned when there is one person would be exactly that.
    const problems = findScheduleProblems({ graph: graphOf(tasks), resources: SOLO_RESOURCES });

    expect(problems.map((p) => p.code)).toContain('SINGLE_PERSON_BOTTLENECK');
    expect(problems.map((p) => p.code)).not.toContain('UNASSIGNED_WORK');
  });

  it('says what a solo project should do about it', () => {
    const problems = findScheduleProblems({ graph: graphOf(tasks), resources: SOLO_RESOURCES });
    const bottleneck = problems.find((p) => p.code === 'SINGLE_PERSON_BOTTLENECK');

    expect(bottleneck?.message).toMatch(/the plan should say what happens then/i);
  });

  it('finds a skill only one person on a team has', () => {
    /*
     * Invisible in a capacity total, which is why it needs its own check. Work needing that skill
     * queues behind one person regardless of who else is free.
     */
    const problems = findScheduleProblems({ graph: graphOf(tasks), resources: TEAM_RESOURCES });
    const skillProblems = problems.filter(
      (p) => p.code === 'SINGLE_PERSON_BOTTLENECK' && /only/i.test(p.message),
    );

    expect(skillProblems.length).toBeGreaterThan(0);
    expect(skillProblems.map((p) => p.message).join(' ')).toMatch(
      /Infrastructure|Security|Delivery/,
    );
  });

  it('reports unassigned work on a team but not on a solo project', () => {
    const team = findScheduleProblems({ graph: graphOf(tasks), resources: TEAM_RESOURCES });
    expect(team.map((p) => p.code)).toContain('UNASSIGNED_WORK');
  });

  it('is deterministic', () => {
    const input = { graph: graphOf(tasks), resources: TEAM_RESOURCES };
    expect(JSON.stringify(findScheduleProblems(input))).toBe(
      JSON.stringify(findScheduleProblems(input)),
    );
  });
});

describe('parallelism width', () => {
  it('is one for a strict chain', () => {
    const chain = graphOf([task('a'), task('b'), task('c')], [edge('b', 'a'), edge('c', 'b')]);
    expect(maxConcurrentWork(chain)).toBe(1);
  });

  it('is the count when nothing depends on anything', () => {
    expect(maxConcurrentWork(graphOf([task('a'), task('b'), task('c')]))).toBe(3);
  });

  it('is zero with no tasks', () => {
    expect(maxConcurrentWork(graphOf([]))).toBe(0);
  });

  it('terminates on a cycle', () => {
    const cyclic = graphOf([task('a'), task('b')], [edge('a', 'b'), edge('b', 'a')]);
    expect(maxConcurrentWork(cyclic)).toBeGreaterThan(0);
  });
});

describe('AI capabilities are not employees', () => {
  it('does not add their effect to the hours available', () => {
    /*
     * §18.2: a capability influences effort assumptions and suggested parallelism, and has no
     * employment cost. Folding an unmeasured multiplier into the capacity number would turn a
     * disputed effect into something that looks like a measurement.
     */
    const withTool = summariseCapacity({
      graph: graphOf([task('a')]),
      resources: SOLO_RESOURCES,
      capabilities: SOLO_CAPABILITIES,
    });

    const without = summariseCapacity({
      graph: graphOf([task('a')]),
      resources: SOLO_RESOURCES,
    });

    expect(withTool.totalWeeklyHours).toBe(without.totalWeeklyHours);
  });

  it('records the capability as an assumption instead', () => {
    const summary = summariseCapacity({
      graph: graphOf([task('a')]),
      resources: SOLO_RESOURCES,
      capabilities: SOLO_CAPABILITIES,
    });

    expect(summary.assumptions.join(' ')).toMatch(/Coding agent is available/);
    expect(summary.assumptions.join(' ')).toMatch(/not included in the hours above/);
  });

  it('says its output still needs verifying', () => {
    // §18.2: "its work requires verification based on project policy."
    const summary = summariseCapacity({
      graph: graphOf([task('a')]),
      resources: SOLO_RESOURCES,
      capabilities: SOLO_CAPABILITIES,
    });

    expect(summary.assumptions.join(' ')).toMatch(/requires human verification/i);
  });

  it('expresses its effect as a range rather than a figure', () => {
    for (const capability of SOLO_CAPABILITIES) {
      expect(capability.effortMultiplier.low).toBeLessThan(capability.effortMultiplier.high);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* The board                                                                  */
/* -------------------------------------------------------------------------- */

describe('the board', () => {
  it('has a column for every status', () => {
    expect(BOARD_COLUMNS.map((c) => c.status).sort()).toEqual([...TASK_STATUSES].sort());
  });

  it('keeps review as its own column', () => {
    /*
     * Folding review into "in progress" hides the most common queue in software delivery: work that
     * is finished, waiting for someone, and counted as active. A team can then be entirely busy with
     * nothing moving.
     */
    expect(BOARD_COLUMNS.map((c) => c.status)).toContain('IN_REVIEW');
    const column = BOARD_COLUMNS.find((c) => c.status === 'IN_REVIEW');
    expect(column?.meaning).toMatch(/sit unnoticed/i);
  });

  it('places each task in its status column', () => {
    const graph = graphOf([task('a', 'TODO'), task('b', 'IN_PROGRESS'), task('c', 'DONE')]);
    const board = buildBoard(graph);

    expect(board.find((c) => c.status === 'TODO')?.cards.map((x) => x.id)).toEqual(['a']);
    expect(board.find((c) => c.status === 'DONE')?.cards.map((x) => x.id)).toEqual(['c']);
  });

  it('treats an unrecognised status as not started rather than dropping the task', () => {
    // A task that vanished because its status was unexpected is worse than one shown in the wrong
    // column: nobody looks for what they cannot see.
    const graph = graphOf([task('a', 'SOMETHING_ELSE')]);
    const board = buildBoard(graph);
    const all = board.flatMap((c) => c.cards);

    expect(all.map((c) => c.id)).toEqual(['a']);
  });

  it('shows what each card is waiting on', () => {
    const graph = graphOf([task('a'), task('b')], [edge('a', 'b')]);
    const board = buildBoard(graph);
    const card = board.flatMap((c) => c.cards).find((c) => c.id === 'a');

    expect(card?.waitingOn).toEqual(['b']);
  });

  it('does not count a finished dependency as something to wait for', () => {
    const graph = graphOf([task('a'), task('b', 'DONE')], [edge('a', 'b')]);
    const card = buildBoard(graph)
      .flatMap((c) => c.cards)
      .find((c) => c.id === 'a');

    expect(card?.waitingOn).toEqual([]);
  });

  it('carries the reason each task exists', () => {
    const card = buildBoard(graphOf([task('a')]))
      .flatMap((c) => c.cards)
      .find((c) => c.id === 'a');

    expect(card?.because).toBe('rule:X');
  });

  it('is deterministic', () => {
    const graph = graphOf([task('c'), task('a'), task('b')]);
    expect(JSON.stringify(buildBoard(graph))).toBe(JSON.stringify(buildBoard(graph)));
  });

  it('rejects a status it does not know', () => {
    expect(isTaskStatus('ALMOST_DONE')).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Today                                                                      */
/* -------------------------------------------------------------------------- */

describe('the Today view', () => {
  it('puts work already started first', () => {
    // Finishing beats starting something else, and it is the cheapest way to reduce work in progress.
    const graph = graphOf([task('a', 'TODO'), task('b', 'IN_PROGRESS')]);
    expect(buildToday({ graph })[0]?.id).toBe('b');
  });

  it('puts work waiting for review near the top', () => {
    const graph = graphOf([task('a', 'TODO'), task('r', 'IN_REVIEW')]);
    const today = buildToday({ graph });

    expect(today[0]?.id).toBe('r');
    expect(today[0]?.explanation).toMatch(/work not delivered/i);
  });

  it('excludes blocked work', () => {
    // A blocked task is not actionable, and putting it on a focus list teaches people the list is not
    // actionable either.
    const graph = graphOf([task('a', 'BLOCKED'), task('b', 'TODO')]);
    expect(buildToday({ graph }).map((i) => i.id)).toEqual(['b']);
  });

  it('excludes work whose dependencies are unfinished', () => {
    const graph = graphOf([task('a', 'TODO'), task('b', 'TODO')], [edge('a', 'b')]);
    expect(buildToday({ graph }).map((i) => i.id)).toEqual(['b']);
  });

  it('excludes finished work', () => {
    expect(buildToday({ graph: graphOf([task('a', 'DONE')]) })).toEqual([]);
  });

  it('gives every item a reason', () => {
    /*
     * The property that makes this focus rather than a backlog with a different heading. A task
     * appearing because it happened to sort first is a task the user ignores, and after a week of
     * that they ignore the view.
     */
    const graph = graphOf([task('a'), task('b'), task('c')]);
    for (const item of buildToday({ graph })) {
      expect(item.explanation.length).toBeGreaterThan(20);
    }
  });

  it('prefers work that unblocks other work', () => {
    const graph = graphOf(
      [task('hub'), task('x'), task('y'), task('lonely')],
      [edge('x', 'hub'), edge('y', 'hub')],
    );

    const today = buildToday({ graph });
    expect(today[0]?.id).toBe('hub');
    expect(today[0]?.reason).toBe('UNBLOCKS_MOST');
  });

  it('is capped, because a focus list of thirty is a backlog', () => {
    const many = Array.from({ length: 30 }, (_, i) => task(`t${String(i)}`));
    expect(buildToday({ graph: graphOf(many) })).toHaveLength(5);
  });

  it('can be filtered to one person', () => {
    const nodes = [
      task('mine'),
      task('theirs'),
      createNode({
        id: 'r1',
        projectId: PROJECT,
        class: 'RESOURCE',
        label: 'Sam',
        provenance: { provenance: 'USER_PROVIDED', confidence: 'HIGH' },
        at: AT,
      }),
    ];

    const graph = graphOf(nodes, [edge('mine', 'r1', 'ASSIGNED_TO')]);
    expect(buildToday({ graph, resourceId: 'r1' }).map((i) => i.id)).toEqual(['mine']);
  });

  it('is deterministic, including its ordering', () => {
    const graph = graphOf([task('c'), task('a'), task('b')]);
    expect(buildToday({ graph })).toEqual(buildToday({ graph }));
  });
});

/* -------------------------------------------------------------------------- */
/* Project home                                                               */
/* -------------------------------------------------------------------------- */

describe('the project summary', () => {
  it('counts completion in tasks and says so', () => {
    /*
     * "60% complete" means sixty per cent of the *items*, which is a different claim from sixty per
     * cent of the *work*. The difference is where every optimistic status report comes from, so the
     * caveat travels with the number rather than sitting in small text somewhere.
     */
    const graph = graphOf([task('a', 'DONE'), task('b', 'TODO')]);
    const summary = summariseProject(graph);

    expect(summary.completionPercent).toBe(50);
    expect(summary.caveats.join(' ')).toMatch(/counts tasks, not effort/i);
  });

  it('surfaces work waiting on review', () => {
    const graph = graphOf([task('a', 'IN_REVIEW'), task('b', 'TODO')]);
    expect(summariseProject(graph).caveats.join(' ')).toMatch(/done but not delivered/i);
  });

  it('warns when progress will stop', () => {
    const graph = graphOf([task('a', 'BLOCKED'), task('b', 'TODO')]);
    expect(summariseProject(graph).caveats.join(' ')).toMatch(/progress will stop/i);
  });

  it('reports zero rather than dividing by nothing', () => {
    expect(summariseProject(graphOf([])).completionPercent).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* End to end, on the golden fixtures                                         */
/* -------------------------------------------------------------------------- */

describe('the fixtures produce usable execution surfaces', () => {
  function build(which: 'solo' | 'team') {
    const inputs = which === 'solo' ? soloInputs() : teamInputs();
    const result = decompose({
      projectId: which === 'solo' ? SOLO_PROJECT_ID : TEAM_PROJECT_ID,
      graph: inputs.graph,
      emissions: inputs.emissions,
      teamSize: which === 'solo' ? 1 : 12,
      ...(which === 'team' ? { parallelAreas: 3, formalGovernance: true } : {}),
      at: FIXED_TIME,
    });

    return mergeIntoGraph(inputs.graph, result);
  }

  for (const which of ['solo', 'team'] as const) {
    it(`produces a board with work on it: ${which}`, () => {
      const board = buildBoard(build(which));
      expect(board.flatMap((c) => c.cards).length).toBeGreaterThan(0);
    });

    it(`produces a Today list that is actionable: ${which}`, () => {
      const today = buildToday({ graph: build(which) });
      expect(today.length).toBeGreaterThan(0);
      expect(today.every((i) => i.explanation.length > 20)).toBe(true);
    });

    it(`produces a summary with its caveats: ${which}`, () => {
      const summary = summariseProject(build(which));
      expect(summary.totalTasks).toBeGreaterThan(0);
      expect(summary.caveats.length).toBeGreaterThan(0);
    });

    it(`reports capacity with stated assumptions: ${which}`, () => {
      const summary = summariseCapacity({
        graph: build(which),
        resources: which === 'solo' ? SOLO_RESOURCES : TEAM_RESOURCES,
        ...(which === 'solo' ? { capabilities: SOLO_CAPABILITIES } : {}),
      });

      expect(summary.totalWeeklyHours).toBeGreaterThan(0);
      expect(summary.assumptions.length).toBeGreaterThan(0);
    });
  }

  it('gives the twelve-person project far more weekly capacity than the solo one', () => {
    const solo = summariseCapacity({ graph: build('solo'), resources: SOLO_RESOURCES });
    const team = summariseCapacity({ graph: build('team'), resources: TEAM_RESOURCES });

    expect(team.totalWeeklyHours).toBeGreaterThan(solo.totalWeeklyHours * 5);
  });
});
