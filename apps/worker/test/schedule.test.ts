import { describe, expect, it } from 'vitest';
import {
  awakeMinutesPerDay,
  firingMinutes,
  scheduleCost,
  SCALE_TO_ZERO_MINUTES,
} from '../src/schedule.ts';
import wranglerToml from '../wrangler.toml?raw';

/**
 * The cron schedule is a budgeted quantity.
 *
 * Staging's database was suspended for the rest of the month on 2026-09-11 because a per-minute
 * cron kept it from ever scaling to zero. These tests read the schedules out of the deployed
 * configuration, so the next one written into wrangler.toml is costed before it is deployed rather
 * than after the database stops answering.
 */

/** Every `crons = [...]` in the file, keyed by the environment table it sits under. */
function schedulesByEnvironment(toml: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  let section = '(top level)';
  for (const line of toml.split(/\r?\n/)) {
    const header = /^\s*\[+([^\]]+)\]+\s*$/.exec(line);
    if (header?.[1] !== undefined) section = header[1].trim();
    const crons = /^\s*crons\s*=\s*\[(.*)\]\s*$/.exec(line);
    if (crons?.[1] !== undefined) {
      const expressions = [...crons[1].matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? '');
      result.set(section, [...(result.get(section) ?? []), ...expressions]);
    }
  }
  return result;
}

describe('cron parsing', () => {
  it('fires every minute for a wildcard minute field', () => {
    expect(firingMinutes('* * * * *')).toHaveLength(1440);
  });

  it('fires once an hour at the named minute', () => {
    const minutes = firingMinutes('17 * * * *');
    expect(minutes).toHaveLength(24);
    expect(minutes[0]).toBe(17);
    expect(minutes[1]).toBe(77);
  });

  it('honours an hour step', () => {
    const minutes = firingMinutes('17 */3 * * *');
    expect(minutes).toEqual([17, 197, 377, 557, 737, 917, 1097, 1277]);
  });

  it('honours minute steps, lists and ranges', () => {
    expect(firingMinutes('*/15 0 * * *')).toEqual([0, 15, 30, 45]);
    expect(firingMinutes('5,35 1 * * *')).toEqual([65, 95]);
    expect(firingMinutes('0 1-2 * * *')).toEqual([60, 120]);
    expect(firingMinutes('5/20 0 * * *')).toEqual([5, 25, 45]);
  });

  it('refuses what it cannot cost rather than guessing', () => {
    expect(() => firingMinutes('@hourly')).toThrow();
    expect(() => firingMinutes('*/0 * * * *')).toThrow();
    expect(() => firingMinutes('L * * * *')).toThrow();
  });
});

describe('awake time', () => {
  it('merges wakes closer together than the scale-to-zero window', () => {
    // The failure that happened: a query every minute is a compute that never sleeps.
    expect(awakeMinutesPerDay(['* * * * *'])).toBe(1440);
    expect(awakeMinutesPerDay(['*/5 * * * *'])).toBe(1440);
  });

  it('counts separate wakes separately', () => {
    expect(awakeMinutesPerDay(['0 0 * * *'])).toBe(1 + SCALE_TO_ZERO_MINUTES);
    expect(awakeMinutesPerDay(['0 0,12 * * *'])).toBe(2 * (1 + SCALE_TO_ZERO_MINUTES));
  });

  it('does not double-count two schedules that wake together', () => {
    expect(awakeMinutesPerDay(['0 0 * * *', '0 0 * * *'])).toBe(1 + SCALE_TO_ZERO_MINUTES);
  });

  it('counts a run that straddles midnight once', () => {
    expect(awakeMinutesPerDay(['58 23 * * *'])).toBe(1 + SCALE_TO_ZERO_MINUTES);
  });
});

describe('schedule cost against the database quota', () => {
  it('reports the schedule that suspended staging as over budget', () => {
    // Verify the verifier: the configuration that caused the outage must fail this check.
    const cost = scheduleCost(['* * * * *']);
    expect(cost.withinBudget).toBe(false);
    expect(cost.cuHoursPerMonth).toBeGreaterThan(100);
  });

  it('reports an hourly schedule as over budget too', () => {
    // Hourly sounds modest. It is 36 CU-hours a month on its own, a third of the quota.
    expect(scheduleCost(['17 * * * *']).withinBudget).toBe(false);
  });

  it('finds at least one schedule in the deployed configuration', () => {
    const all = [...schedulesByEnvironment(wranglerToml).values()].flat();
    expect(all.length).toBeGreaterThan(0);
  });

  for (const [environment, expressions] of schedulesByEnvironment(wranglerToml)) {
    it(`keeps ${environment} within a fifth of the monthly compute quota`, () => {
      const cost = scheduleCost(expressions);
      expect(
        cost.withinBudget,
        `${expressions.join(', ')} keeps the database awake ${cost.awakeMinutesPerDay} min/day ` +
          `= ${cost.cuHoursPerMonth} CU-h/month against a budget of ${cost.budgetCuHours}`,
      ).toBe(true);
    });
  }
});
