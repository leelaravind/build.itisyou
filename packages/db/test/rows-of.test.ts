import { describe, expect, it } from 'vitest';
import { rowsOf } from '../src/client.ts';

/**
 * `rowsOf` exists because two Drizzle adapters disagree about what `execute()` returns, and nothing
 * in the type system says so.
 *
 * The postgres-js case below is the one that matters. Before it existed, every test in this project
 * ran against PGlite — so the `{ rows }` shape was covered a hundred times over and the bare-array
 * shape was covered never, in a codebase whose deployed path uses only the bare-array shape.
 *
 * Two live defects came from that gap and both reached a real deployment: the outbox drainer threw
 * `TypeError` on every cron tick, and the schema fingerprint check would have refused to serve
 * against a correctly-migrated database. Neither could fail locally.
 */
describe('rowsOf', () => {
  it('reads the PGlite shape', () => {
    // What drizzle-orm/pglite returns.
    expect(rowsOf<{ id: number }>({ rows: [{ id: 1 }, { id: 2 }] })).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('reads the postgres-js shape', () => {
    // What drizzle-orm/postgres-js returns: the array itself. This is the deployed path.
    expect(rowsOf<{ id: number }>([{ id: 1 }, { id: 2 }])).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('reads an empty result from either driver', () => {
    // Distinguishing "no rows" from "wrong shape" is the point; both drivers must reach the former.
    expect(rowsOf({ rows: [] })).toEqual([]);
    expect(rowsOf([])).toEqual([]);
  });

  it('preserves the postgres-js result array, which carries more than its elements', () => {
    /*
     * postgres.js returns an array subclass with `count` and `command` attached. Returning it as-is
     * rather than copying keeps those available to a caller that wants them — and copying would look
     * harmless while quietly discarding the row count for statements that return no rows at all.
     */
    const result = Object.assign([{ id: 1 }], { count: 1, command: 'SELECT' });

    expect(rowsOf(result)).toBe(result);
  });

  it('refuses a shape it does not recognise rather than reporting no rows', () => {
    /*
     * The load-bearing assertion.
     *
     * Returning `[]` here is precisely what the broken drainer did in effect, and "there is nothing
     * to do" is indistinguishable from "I could not tell" — right up until somebody asks why a queue
     * never drained. A driver that changes its result shape must break loudly.
     */
    expect(() => rowsOf({ recordset: [{ id: 1 }] })).toThrow(TypeError);
    expect(() => rowsOf(undefined)).toThrow(/Unrecognised query result shape/);
    expect(() => rowsOf(null)).toThrow(/received null/);
    expect(() => rowsOf('rows')).toThrow(/received string/);
  });

  it('names where to look when it throws', () => {
    // The message has to survive being read at 3am in a log line with no stack attached.
    expect(() => rowsOf(42)).toThrow(/rowsOf\(\) in packages\/db\/src\/client\.ts/);
  });
});
