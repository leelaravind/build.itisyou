/**
 * The Digital Twin's database constraints.
 *
 * Contract: gap-spec §8 (the canonical graph), §8.3 (invariants), §8.4 (versioning without copying).
 *
 * The application enforces every rule below already. These exist because the application is code,
 * and the same reasoning that put a third lock on the AI-import airlock applies here: the guarantee
 * that untrusted or malformed content cannot enter the canonical project graph should not rest on
 * any single layer being correct.
 *
 * Two of these tests also close a gap the application cannot: a node can arrive from a migration, a
 * script or a future integration that never passes through `packages/twin`.
 */

import { describe, expect, it, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from '../src/client.ts';
import { NODE_CLASSES } from '@govintel/twin/nodes';
import { EDGE_CLASSES } from '@govintel/twin/edges';

// Building a real Postgres instance takes seconds; see packages/db/test/schema-drift.test.ts.
vi.setConfig({ testTimeout: 30_000 });

const ORG = '00000000-0000-4000-8000-000000000001';

let database: TestDatabase;
let projectId: string;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.client.close();
});

beforeEach(async () => {
  await database.truncate();
  await database.db.execute(
    sql`INSERT INTO organizations (id, name, slug) VALUES (${ORG}, 'Acme', 'acme')`,
  );
  const project = await database.db.execute<{ id: string }>(
    sql`INSERT INTO projects (organization_id, name) VALUES (${ORG}, 'P') RETURNING id`,
  );
  projectId = project.rows[0]?.id ?? '';
});

async function insertNode(
  id: string,
  options: {
    nodeClass?: string;
    provenance?: string;
    confidence?: string;
    state?: string;
    revision?: number;
  } = {},
): Promise<void> {
  await database.db.execute(sql`
    INSERT INTO twin_nodes (id, organization_id, project_id, class, label, state, provenance, confidence, revision)
    VALUES (
      ${id}, ${ORG}, ${projectId}, ${options.nodeClass ?? 'TASK'}, ${id},
      ${options.state ?? 'ACTIVE'}, ${options.provenance ?? 'USER_PROVIDED'},
      ${options.confidence ?? 'HIGH'}, ${options.revision ?? 1}
    )
  `);
}

async function insertEdge(id: string, from: string, to: string, edgeClass = 'DEPENDS_ON') {
  return database.db.execute(sql`
    INSERT INTO twin_edges (id, organization_id, project_id, class, from_id, to_id)
    VALUES (${id}, ${ORG}, ${projectId}, ${edgeClass}, ${from}, ${to})
  `);
}

describe('nodes', () => {
  it('stores a node', async () => {
    await insertNode('n1');
    const rows = await database.db.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM twin_nodes`,
    );
    expect(rows.rows[0]?.count).toBe(1);
  });

  it('keeps the generator’s stable id rather than assigning one', async () => {
    // The id is text, not uuid, precisely so regenerating a plan produces the same ids. A uuid column
    // would force random ids and make two versions of a plan incomparable.
    await insertNode(`${projectId}:req:accessibility`);
    const rows = await database.db.execute<{ id: string }>(sql`SELECT id FROM twin_nodes`);
    expect(rows.rows[0]?.id).toBe(`${projectId}:req:accessibility`);
  });

  it('refuses a provenance class outside the taxonomy', async () => {
    // The interchange schema already makes this unrepresentable in an *import*. A node can also
    // arrive from a rule or a migration, and the schema only guards one path.
    await expect(insertNode('n1', { provenance: 'TOTALLY_LEGIT' })).rejects.toThrow();
  });

  it('refuses a confidence level outside the taxonomy', async () => {
    await expect(insertNode('n1', { confidence: 'ABSOLUTE' })).rejects.toThrow();
  });

  it('refuses a node state outside the taxonomy', async () => {
    await expect(insertNode('n1', { state: 'PROBABLY_FINE' })).rejects.toThrow();
  });

  it('refuses a revision below one', async () => {
    // Revisions start at 1 and only increase. A zero or negative revision means something wrote the
    // column directly, which is exactly what the change log is supposed to make unnecessary.
    await expect(insertNode('n1', { revision: 0 })).rejects.toThrow();
  });

  it('permits every provenance class the platform actually uses', async () => {
    // The inverse assertion. A constraint that refused a legitimate class would be discovered in
    // production rather than here.
    const classes = [
      'USER_CONFIRMED',
      'DETERMINISTIC_CALCULATION',
      'USER_PROVIDED',
      'EXTERNAL_SOURCE',
      'ASSUMPTION',
      'EXTERNAL_AI_INFERENCE',
      'FUTURE_ML_PREDICTION',
    ];

    for (const [i, provenance] of classes.entries()) {
      await insertNode(`n${String(i)}`, { provenance });
    }

    const rows = await database.db.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM twin_nodes`,
    );
    expect(rows.rows[0]?.count).toBe(classes.length);
  });

  it('removes a project’s nodes when the project is deleted', async () => {
    await insertNode('n1');
    await database.db.execute(sql`DELETE FROM projects WHERE id = ${projectId}`);

    const rows = await database.db.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM twin_nodes`,
    );
    expect(rows.rows[0]?.count).toBe(0);
  });
});

describe('edges', () => {
  beforeEach(async () => {
    await insertNode('a');
    await insertNode('b');
  });

  it('stores an edge between two nodes', async () => {
    await insertEdge('e1', 'a', 'b');
    const rows = await database.db.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM twin_edges`,
    );
    expect(rows.rows[0]?.count).toBe(1);
  });

  it('refuses an edge from a node to itself', async () => {
    // Irreflexive in every relation the taxonomy has, so the column enforces it rather than leaving
    // it to a pass that runs later — by which point the row already exists.
    await expect(insertEdge('e1', 'a', 'a')).rejects.toThrow();
  });

  it('refuses a duplicate of the same relationship', async () => {
    // The same relationship asserted twice is not additional information; it is a row every
    // traversal would count twice.
    await insertEdge('e1', 'a', 'b');
    await expect(insertEdge('e2', 'a', 'b')).rejects.toThrow();
  });

  it('permits two different relationships between the same pair', async () => {
    // "A depends on B" and "A blocks B" are different facts. A unique index on the pair alone would
    // have refused this.
    await insertEdge('e1', 'a', 'b', 'DEPENDS_ON');
    await expect(insertEdge('e2', 'a', 'b', 'BLOCKS')).resolves.toBeDefined();
  });

  it('refuses an edge pointing at a node that does not exist', async () => {
    // A dangling edge makes every traversal silently return less than the truth.
    await expect(insertEdge('e1', 'a', 'ghost')).rejects.toThrow();
  });

  it('removes edges when a node they touch is deleted', async () => {
    await insertEdge('e1', 'a', 'b');
    await database.db.execute(sql`DELETE FROM twin_nodes WHERE id = 'b'`);

    const rows = await database.db.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM twin_edges`,
    );
    expect(rows.rows[0]?.count).toBe(0);
  });
});

describe('the change log', () => {
  it('stores one entry per material change', async () => {
    await insertNode('n1');
    await database.db.execute(sql`
      INSERT INTO twin_changes (organization_id, project_id, version, correlation_id, kind, target_id, before_value, after_value, reason)
      VALUES (${ORG}, ${projectId}, 2, gen_random_uuid(), 'NODE_UPDATED', 'n1',
              '{"label":"old"}'::jsonb, '{"label":"new"}'::jsonb, 'CR-14')
    `);

    const rows = await database.db.execute<{ reason: string }>(
      sql`SELECT reason FROM twin_changes`,
    );
    expect(rows.rows[0]?.reason).toBe('CR-14');
  });

  it('refuses a change kind outside the taxonomy', async () => {
    await expect(
      database.db.execute(sql`
        INSERT INTO twin_changes (organization_id, project_id, version, correlation_id, kind, target_id)
        VALUES (${ORG}, ${projectId}, 2, gen_random_uuid(), 'SOMETHING_HAPPENED', 'n1')
      `),
    ).rejects.toThrow();
  });

  it('does not require the target to still exist', async () => {
    /*
     * Deliberate: `target_id` is not a foreign key.
     *
     * The log records that something was withdrawn or superseded. If deleting the node also deleted
     * its history, the record would be complete only for things that still exist — which is the
     * opposite of what a change log is for.
     */
    await expect(
      database.db.execute(sql`
        INSERT INTO twin_changes (organization_id, project_id, version, correlation_id, kind, target_id)
        VALUES (${ORG}, ${projectId}, 2, gen_random_uuid(), 'NODE_WITHDRAWN', 'long-gone')
      `),
    ).resolves.toBeDefined();
  });
});

describe('baselines', () => {
  const CHECKSUM = 'a'.repeat(64);

  async function insertBaseline(id = 'b1', checksum = CHECKSUM) {
    return database.db.execute(sql`
      INSERT INTO twin_baselines (id, organization_id, project_id, version, label, correlation_id, checksum, snapshot)
      VALUES (${id}, ${ORG}, ${projectId}, 1, 'Agreed plan', gen_random_uuid(), ${checksum}, '{"nodes":[],"edges":[]}'::jsonb)
    `);
  }

  it('stores a baseline', async () => {
    await expect(insertBaseline()).resolves.toBeDefined();
  });

  it('refuses a checksum that is not a sha-256 digest', async () => {
    // A truncated or absent checksum would make the baseline unverifiable while still looking like
    // evidence — worse than storing none at all.
    await expect(insertBaseline('b1', 'too-short')).rejects.toThrow();
  });

  it('cannot be updated', async () => {
    /*
     * Gap-spec §8.3: a baseline is immutable.
     *
     * Enforced by trigger rather than by convention, for the same reason the audit table is: "we
     * never call UPDATE on it" is a promise, and a control has to be something the application
     * cannot get wrong.
     */
    await insertBaseline();
    await expect(
      database.db.execute(sql`UPDATE twin_baselines SET label = 'edited' WHERE id = 'b1'`),
    ).rejects.toThrow();
  });

  it('cannot be deleted', async () => {
    await insertBaseline();
    await expect(
      database.db.execute(sql`DELETE FROM twin_baselines WHERE id = 'b1'`),
    ).rejects.toThrow();
  });

  it('says why the write was refused', async () => {
    // The trigger message reaches the operator through the cause chain; a bare constraint violation
    // would leave them guessing which rule they hit.
    await insertBaseline();

    let message = '';
    try {
      await database.db.execute(sql`UPDATE twin_baselines SET label = 'edited' WHERE id = 'b1'`);
    } catch (error) {
      let current: unknown = error;
      while (current instanceof Error) {
        message += ` ${current.message}`;
        current = (current as { cause?: unknown }).cause;
      }
    }

    expect(message).toMatch(/immutable/i);
  });
});

describe('calculation snapshots', () => {
  it('stores the inputs, the dependencies and the assumptions alongside the result', async () => {
    // Plan §12: a stored number with no record of what produced it cannot be explained six months
    // later, and carries an authority it has not earned.
    await database.db.execute(sql`
      INSERT INTO twin_calculations
        (id, organization_id, project_id, version, calculation, formula_version, correlation_id, inputs, result, depends_on, assumptions)
      VALUES
        ('c1', ${ORG}, ${projectId}, 1, 'budget.total', '1.0.0', gen_random_uuid(),
         '{"rate":500}'::jsonb, '{"low":18000,"high":24000}'::jsonb,
         ARRAY['t1','t2'], ARRAY['A day rate of 500 was assumed.'])
    `);

    const rows = await database.db.execute<{
      formula_version: string;
      depends_on: string[];
      assumptions: string[];
    }>(sql`SELECT formula_version, depends_on, assumptions FROM twin_calculations`);

    expect(rows.rows[0]?.formula_version).toBe('1.0.0');
    expect(rows.rows[0]?.depends_on).toEqual(['t1', 't2']);
    expect(rows.rows[0]?.assumptions).toHaveLength(1);
  });

  it('defaults the dependency and assumption lists to empty rather than null', async () => {
    // A null list and an empty list mean different things in every consumer, and conflating them
    // makes "this calculation depends on nothing" indistinguishable from "nobody recorded it".
    await database.db.execute(sql`
      INSERT INTO twin_calculations
        (id, organization_id, project_id, version, calculation, formula_version, correlation_id, inputs, result)
      VALUES ('c1', ${ORG}, ${projectId}, 1, 'x', '1.0.0', gen_random_uuid(), '{}'::jsonb, '{}'::jsonb)
    `);

    const rows = await database.db.execute<{ depends_on: string[] }>(
      sql`SELECT depends_on FROM twin_calculations`,
    );
    expect(rows.rows[0]?.depends_on).toEqual([]);
  });
});

describe('the database and the code agree on the taxonomy', () => {
  it('accepts every node class the code declares', async () => {
    /*
     * The check that stops the two drifting.
     *
     * The class column is text with a CHECK rather than an enum, which is the right trade for
     * migration cost — but it means nothing stops the code and the database disagreeing except a
     * test that inserts one of each.
     */
    for (const [i, nodeClass] of NODE_CLASSES.entries()) {
      await insertNode(`n${String(i)}`, { nodeClass });
    }

    const rows = await database.db.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM twin_nodes`,
    );
    expect(rows.rows[0]?.count).toBe(NODE_CLASSES.length);
  });

  it('accepts every edge class the code declares', async () => {
    await insertNode('a');
    await insertNode('b');

    for (const [i, edgeClass] of EDGE_CLASSES.entries()) {
      await insertEdge(`e${String(i)}`, 'a', 'b', edgeClass);
    }

    const rows = await database.db.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM twin_edges`,
    );
    expect(rows.rows[0]?.count).toBe(EDGE_CLASSES.length);
  });
});
