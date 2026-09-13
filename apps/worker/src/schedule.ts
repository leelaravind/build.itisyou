/**
 * What a cron schedule costs the database it wakes.
 *
 * ## Why this exists
 *
 * Staging's database stopped answering on 2026-09-11 with HTTP 402, "Your account or project has
 * exceeded the compute time quota". Neon's free plan gives each project 100 CU-hours a month and
 * suspends the compute — until the next billing period, not the next minute — once they are spent.
 *
 * Nothing about the product's traffic caused it. The drainer ran `* * * * *`, and Neon only scales a
 * compute to zero after five idle minutes, so a query every minute meant the compute was never idle
 * at all: 839,488 active seconds over the ten days it survived, 97% of wall-clock time, measured from
 * the Neon API. The cron was costing the full quota on its own, and production had the identical
 * schedule waiting for it.
 *
 * So the schedule is now a budgeted quantity rather than a latency preference, and this module is
 * the arithmetic a test holds it to.
 *
 * ## The model
 *
 * A wake keeps the compute running for the job's duration plus the scale-to-zero window. Wakes
 * closer together than that merge into one continuous run, which is exactly how a per-minute cron
 * becomes 24 hours a day. The day is treated as circular so a run straddling midnight is counted once.
 */

/** Neon suspends a free-plan compute after this many idle minutes, and it cannot be changed. */
export const SCALE_TO_ZERO_MINUTES = 5;

/** A generous upper bound on one tick's work: connect, drain a batch, purge, disconnect. */
export const JOB_MINUTES = 1;

/**
 * Average compute size while awake, in CU.
 *
 * Not the 0.25 CU floor. Staging averaged 0.47 CU across its life (396,247 CU-seconds over 839,488
 * active seconds), because the purge and the drain autoscale it. Rounded up, since the budget should
 * fail on the side of the quota.
 */
export const AVERAGE_CU = 0.5;

/** Neon free plan: 100 CU-hours per project per month. */
export const MONTHLY_CU_HOUR_QUOTA = 100;

/**
 * The share of the quota scheduled work may consume.
 *
 * A fifth. The rest belongs to people using the product — a schedule that spends the quota before
 * anybody signs in has made the product unavailable to protect a background job.
 */
export const SCHEDULE_SHARE = 0.2;

const MINUTES_PER_DAY = 24 * 60;
const DAYS_PER_MONTH = 30.44;

function fieldMatches(field: string, value: number, min: number, max: number): boolean {
  return field.split(',').some((part) => {
    const [range, stepText] = part.split('/');
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) throw new Error(`Unsupported cron step: ${part}`);

    let from: number;
    let to: number;
    if (range === '*') {
      from = min;
      to = max;
    } else if (range?.includes('-') === true) {
      const [a, b] = range.split('-').map(Number);
      from = a ?? NaN;
      to = b ?? NaN;
    } else {
      from = Number(range);
      // `5/15` means "from 5, every 15"; a bare number means exactly that value.
      to = stepText === undefined ? from : max;
    }
    if (!Number.isInteger(from) || !Number.isInteger(to)) {
      throw new Error(`Unsupported cron field: ${field}`);
    }
    return value >= from && value <= to && (value - from) % step === 0;
  });
}

/**
 * Minutes of the day at which a five-field cron expression fires.
 *
 * The day-of-month, month and day-of-week fields are ignored, which can only over-count: a schedule
 * restricted to weekdays is costed as though it ran every day. That is the safe direction for a
 * budget.
 */
export function firingMinutes(expression: string): number[] {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`Expected five cron fields: ${expression}`);
  const [minute, hour] = fields as [string, string];

  const minutes: number[] = [];
  for (let t = 0; t < MINUTES_PER_DAY; t++) {
    if (fieldMatches(hour, Math.floor(t / 60), 0, 23) && fieldMatches(minute, t % 60, 0, 59)) {
      minutes.push(t);
    }
  }
  return minutes;
}

/** Minutes per day the compute is awake because of these schedules, with overlapping runs merged. */
export function awakeMinutesPerDay(expressions: readonly string[]): number {
  const awake = new Uint8Array(MINUTES_PER_DAY);
  const window = JOB_MINUTES + SCALE_TO_ZERO_MINUTES;

  for (const expression of expressions) {
    for (const start of firingMinutes(expression)) {
      for (let k = 0; k < window; k++) awake[(start + k) % MINUTES_PER_DAY] = 1;
    }
  }
  return awake.reduce((sum, minute) => sum + minute, 0);
}

export interface ScheduleCost {
  readonly awakeMinutesPerDay: number;
  readonly cuHoursPerMonth: number;
  readonly budgetCuHours: number;
  readonly withinBudget: boolean;
}

export function scheduleCost(expressions: readonly string[]): ScheduleCost {
  const minutes = awakeMinutesPerDay(expressions);
  const cuHoursPerMonth = ((minutes * DAYS_PER_MONTH) / 60) * AVERAGE_CU;
  const budgetCuHours = MONTHLY_CU_HOUR_QUOTA * SCHEDULE_SHARE;
  return {
    awakeMinutesPerDay: minutes,
    cuHoursPerMonth: Math.round(cuHoursPerMonth * 10) / 10,
    budgetCuHours,
    withinBudget: cuHoursPerMonth <= budgetCuHours,
  };
}
