/**
 * The board and the Today view.
 *
 * Contract: plan §34 Phase 8 lists "board" and "Today" as deliverables; gap-spec §18.3 says solo
 * delivery still gets sequencing, checkpoints, dependencies and focus — "not team ceremony".
 *
 * The Today view is the harder of the two and the one worth explaining. A list of "everything you
 * could do" is not focus; it is the backlog with a different heading. What makes it useful is that it
 * answers a specific question — *what should I do next, and why that?* — and refuses to include
 * anything it cannot justify.
 *
 * So the selection is ranked by a stated reason, capped, and every entry carries the reason. A task
 * appearing because it happened to sort first is a task the user will ignore, and after a week of
 * that they ignore the whole view.
 */

import type { TwinGraph } from '@govintel/twin/graph';
import type { TwinNode } from '@govintel/twin/nodes';

/* -------------------------------------------------------------------------- */
/* Task status                                                                */
/* -------------------------------------------------------------------------- */

export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'DONE'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/**
 * The board columns.
 *
 * `IN_REVIEW` exists as its own column deliberately. Folding review into "in progress" hides the
 * most common queue in software delivery: work that is finished, waiting for someone to look at it,
 * and counted as active. A team can then be entirely "busy" with nothing moving.
 */
export const BOARD_COLUMNS: readonly {
  readonly status: TaskStatus;
  readonly label: string;
  readonly meaning: string;
}[] = [
  { status: 'TODO', label: 'To do', meaning: 'Not started.' },
  { status: 'IN_PROGRESS', label: 'In progress', meaning: 'Someone is working on it now.' },
  {
    status: 'BLOCKED',
    label: 'Blocked',
    meaning: 'Cannot proceed. Something outside this task has to change first.',
  },
  {
    status: 'IN_REVIEW',
    label: 'In review',
    meaning: 'Finished, waiting for someone else. The most common place for work to sit unnoticed.',
  },
  { status: 'DONE', label: 'Done', meaning: 'Complete against the definition of done.' },
];

export function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}

function statusOf(node: TwinNode): TaskStatus {
  const raw = node.attributes.status;
  return typeof raw === 'string' && isTaskStatus(raw) ? raw : 'TODO';
}

/* -------------------------------------------------------------------------- */
/* The board                                                                  */
/* -------------------------------------------------------------------------- */

export interface BoardCard {
  readonly id: string;
  readonly label: string;
  readonly status: TaskStatus;
  readonly phaseKey?: string;
  readonly group?: string;
  /** The rule or requirement this task exists for, so it can be challenged. */
  readonly because?: string;
  /** Ids of tasks that must finish first and have not. */
  readonly waitingOn: readonly string[];
  readonly assigneeId?: string;
}

export interface BoardColumn {
  readonly status: TaskStatus;
  readonly label: string;
  readonly meaning: string;
  readonly cards: readonly BoardCard[];
}

/**
 * Build the board.
 *
 * Cards are ordered by id within a column rather than by any heuristic. The board is a view of state,
 * and imposing a ranking on it would suggest an order that nothing in the data supports — the Today
 * view is where ranking belongs, and there it is justified per entry.
 */
export function buildBoard(graph: TwinGraph): readonly BoardColumn[] {
  const tasks = graph.nodesOfClass('TASK');
  const byStatus = new Map<TaskStatus, BoardCard[]>();

  for (const column of BOARD_COLUMNS) byStatus.set(column.status, []);

  for (const task of tasks) {
    const status = statusOf(task);
    const card = toCard(graph, task, status);
    byStatus.get(status)?.push(card);
  }

  return BOARD_COLUMNS.map((column) => ({
    ...column,
    cards: (byStatus.get(column.status) ?? []).sort((a, b) => a.id.localeCompare(b.id)),
  }));
}

function toCard(graph: TwinGraph, task: TwinNode, status: TaskStatus): BoardCard {
  const waitingOn = graph
    .edgesFrom(task.id, 'DEPENDS_ON')
    .map((edge) => graph.node(edge.to))
    .filter((node): node is TwinNode => node !== undefined && statusOf(node) !== 'DONE')
    .map((node) => node.id);

  const assignee = graph.edgesFrom(task.id, 'ASSIGNED_TO')[0]?.to;

  return {
    id: task.id,
    label: task.label,
    status,
    ...(typeof task.attributes.phaseKey === 'string' ? { phaseKey: task.attributes.phaseKey } : {}),
    ...(typeof task.attributes.group === 'string' ? { group: task.attributes.group } : {}),
    ...(task.provenance.sourceRef === undefined ? {} : { because: task.provenance.sourceRef }),
    waitingOn,
    ...(assignee === undefined ? {} : { assigneeId: assignee }),
  };
}

/* -------------------------------------------------------------------------- */
/* Today                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Why a task is on the Today list.
 *
 * Ordered by strength: a task that unblocks other work matters more than one that merely can be
 * started. The reason is shown with the task, so the ranking is arguable rather than mysterious.
 */
export const TODAY_REASONS = [
  'ALREADY_STARTED',
  'IN_REVIEW',
  'UNBLOCKS_MOST',
  'ON_CRITICAL_PATH',
  'READY',
] as const;

export type TodayReason = (typeof TODAY_REASONS)[number];

const REASON_TEXT: Readonly<Record<TodayReason, string>> = {
  ALREADY_STARTED: 'You have already started this. Finishing beats starting something else.',
  IN_REVIEW:
    'This is finished and waiting for someone. Work sitting in review is work not delivered.',
  UNBLOCKS_MOST: 'Other work is waiting on this.',
  ON_CRITICAL_PATH: 'This is on the chain that decides the end date.',
  READY: 'Nothing is stopping this from being started.',
};

export interface TodayItem {
  readonly id: string;
  readonly label: string;
  readonly status: TaskStatus;
  readonly reason: TodayReason;
  readonly explanation: string;
  /** How many other tasks are waiting on this one. */
  readonly unblocks: number;
}

export interface TodayInput {
  readonly graph: TwinGraph;
  /** Only tasks assigned to this person, when supplied. */
  readonly resourceId?: string;
  /**
   * How many items to show.
   *
   * Small on purpose. A "focus" view of thirty items is the backlog with a different heading, and
   * the number that makes a list actionable is closer to five than fifty.
   */
  readonly limit?: number;
}

/**
 * What to do next, and why.
 *
 * Deterministic: same graph, same list, same order. Ties break on id so two identical calls cannot
 * disagree — a focus list that reorders between page loads is one people stop trusting immediately.
 */
export function buildToday(input: TodayInput): readonly TodayItem[] {
  const { graph, resourceId } = input;
  const limit = input.limit ?? 5;

  const tasks = graph.nodesOfClass('TASK').filter((task) => {
    if (statusOf(task) === 'DONE') return false;
    if (resourceId === undefined) return true;
    return graph.edgesFrom(task.id, 'ASSIGNED_TO').some((e) => e.to === resourceId);
  });

  /** How many not-done tasks depend on this one. */
  const unblockCount = new Map<string, number>();
  for (const task of tasks) {
    for (const edge of graph.edgesFrom(task.id, 'DEPENDS_ON')) {
      unblockCount.set(edge.to, (unblockCount.get(edge.to) ?? 0) + 1);
    }
  }

  const candidates: TodayItem[] = [];

  for (const task of tasks) {
    const status = statusOf(task);

    // A blocked task is not actionable, and putting it on a focus list teaches people the list is
    // not actionable either.
    if (status === 'BLOCKED') continue;

    const blockers = graph
      .edgesFrom(task.id, 'DEPENDS_ON')
      .map((e) => graph.node(e.to))
      .filter((n): n is TwinNode => n !== undefined && statusOf(n) !== 'DONE');

    // Same reasoning: work whose dependencies are unfinished cannot be started today.
    if (blockers.length > 0 && status === 'TODO') continue;

    const unblocks = unblockCount.get(task.id) ?? 0;
    const reason = reasonFor(status, unblocks);

    candidates.push({
      id: task.id,
      label: task.label,
      status,
      reason,
      explanation: REASON_TEXT[reason],
      unblocks,
    });
  }

  const rank = (item: TodayItem): number => TODAY_REASONS.indexOf(item.reason);

  return candidates
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        b.unblocks - a.unblocks ||
        // Explicit final tie-break, so the order cannot depend on graph iteration.
        a.id.localeCompare(b.id),
    )
    .slice(0, limit);
}

function reasonFor(status: TaskStatus, unblocks: number): TodayReason {
  if (status === 'IN_PROGRESS') return 'ALREADY_STARTED';
  if (status === 'IN_REVIEW') return 'IN_REVIEW';
  if (unblocks >= 2) return 'UNBLOCKS_MOST';
  if (unblocks === 1) return 'ON_CRITICAL_PATH';
  return 'READY';
}

/* -------------------------------------------------------------------------- */
/* Project home                                                               */
/* -------------------------------------------------------------------------- */

export interface ProjectSummary {
  readonly totalTasks: number;
  readonly byStatus: Readonly<Record<TaskStatus, number>>;
  /** Finished over total. Derived from completed work, never from judgement. */
  readonly completionPercent: number;
  readonly blocked: number;
  /** Work finished and waiting on someone — the queue that hides in "in progress". */
  readonly waitingOnReview: number;
  /** What the completion figure does and does not mean. */
  readonly caveats: readonly string[];
}

/**
 * The numbers for the project home screen.
 *
 * Completion is counted in tasks, and the caveat saying so is returned alongside it rather than
 * printed in small text somewhere. Tasks are not equal in size, so "60% complete" means sixty per cent
 * of the *items*, which is a different claim from sixty per cent of the *work* — and the difference is
 * where every optimistic status report comes from.
 */
export function summariseProject(graph: TwinGraph): ProjectSummary {
  const tasks = graph.nodesOfClass('TASK');

  const byStatus = Object.fromEntries(TASK_STATUSES.map((s) => [s, 0])) as Record<
    TaskStatus,
    number
  >;

  for (const task of tasks) byStatus[statusOf(task)] += 1;

  const caveats: string[] = [];

  if (tasks.length > 0) {
    caveats.push(
      'Completion counts tasks, not effort. Tasks are not equal in size, so this is the proportion of items finished rather than the proportion of the work.',
    );
  }

  if (byStatus.IN_REVIEW > 0) {
    caveats.push(
      `${String(byStatus.IN_REVIEW)} ${byStatus.IN_REVIEW === 1 ? 'task is' : 'tasks are'} finished and waiting for someone. That work is done but not delivered.`,
    );
  }

  if (byStatus.BLOCKED > 0) {
    caveats.push(
      `${String(byStatus.BLOCKED)} ${byStatus.BLOCKED === 1 ? 'task is' : 'tasks are'} blocked. Progress will stop when the unblocked work runs out.`,
    );
  }

  return {
    totalTasks: tasks.length,
    byStatus,
    completionPercent: tasks.length === 0 ? 0 : Math.round((byStatus.DONE / tasks.length) * 100),
    blocked: byStatus.BLOCKED,
    waitingOnReview: byStatus.IN_REVIEW,
    caveats,
  };
}
