import 'server-only';

import { eq } from 'drizzle-orm';
import { approvals, evidence, twinEdges, twinNodes } from '@govintel/db/schema';
import type { ApprovalRow, Evidence } from '@govintel/db/schema';
import { graphFromRows, type NodeRow } from '@govintel/twin/repository';
import type { TwinGraph } from '@govintel/twin/graph';
import { withDatabase } from './database.ts';

/**
 * The project's twin graph, including its evidence and approvals.
 *
 * ## Why the projection exists
 *
 * Gates read the graph. `evidenceFor('code-review')` looks for an `EVIDENCE` node whose `purpose`
 * attribute matches, and two criteria are satisfied by any `APPROVAL` node existing at all.
 *
 * But the graph is **rebuilt from nothing** every time a plan is regenerated — `generatePlan` deletes
 * every node and edge for the project and writes the generator's output. Evidence stored as a twin
 * node would therefore survive exactly until somebody pressed *Build the plan* again, and its
 * disappearance would look like a gate spontaneously regressing.
 *
 * So evidence and approvals live in their own tables, which is where durable records belong anyway —
 * they have their own lifecycle, their own constraints and their own audit trail — and they are
 * projected into the graph on every read.
 *
 * ## Why every caller must come through here
 *
 * Because a page that loads the graph without the projection sees a project with no evidence, and
 * reports gates as unsatisfiable when they are satisfied. That is not a visible failure; it is a
 * quietly wrong answer, which is the worst kind this product can give.
 *
 * There is deliberately no exported "load the raw nodes" helper alongside this one.
 */

export interface ProjectGraph {
  readonly graph: TwinGraph;
  readonly evidence: readonly Evidence[];
  readonly approvals: readonly ApprovalRow[];
}

export interface ProjectRows {
  /** The stored twin nodes **and** the evidence and approval projection. */
  readonly nodes: readonly NodeRow[];
  readonly edges: readonly (typeof twinEdges.$inferSelect)[];
  readonly evidence: readonly Evidence[];
  readonly approvals: readonly ApprovalRow[];
}

/**
 * The rows a project graph is built from, with evidence and approvals already projected in.
 *
 * Every page reads its graph through this — through `loadPlanRows` or `loadProjectGraph` — and that
 * is the point. Eleven surfaces used to build their graph from the raw twin rows, so a gate that the
 * evidence page showed as satisfied was unsatisfied on the plan page, the rules page, the release
 * page, the closure page and, decisively, in the lifecycle transition itself: evidence recorded
 * through the product could never move a project forward.
 */
export async function loadProjectRows(
  projectId: string,
  organizationId: string,
): Promise<ProjectRows> {
  const [nodes, edges, evidenceRows, approvalRows] = await Promise.all([
    withDatabase((db) => db.select().from(twinNodes).where(eq(twinNodes.projectId, projectId))),
    withDatabase((db) => db.select().from(twinEdges).where(eq(twinEdges.projectId, projectId))),
    withDatabase((db) => db.select().from(evidence).where(eq(evidence.projectId, projectId))),
    withDatabase((db) => db.select().from(approvals).where(eq(approvals.projectId, projectId))),
  ]);

  const projected: NodeRow[] = [
    ...evidenceRows.map((row) => evidenceNode(row, organizationId)),
    ...approvalRows.map((row) => approvalNode(row, organizationId)),
  ];

  return {
    nodes: [...nodes, ...projected],
    edges,
    evidence: evidenceRows,
    approvals: approvalRows,
  };
}

export async function loadProjectGraph(
  projectId: string,
  organizationId: string,
): Promise<ProjectGraph> {
  const rows = await loadProjectRows(projectId, organizationId);

  return {
    graph: graphFromRows(projectId, rows.nodes, rows.edges),
    evidence: rows.evidence,
    approvals: rows.approvals,
  };
}

/**
 * An evidence record as a graph node.
 *
 * Provenance is `USER_PROVIDED` and confidence follows the record's own state rather than being
 * asserted here: superseded or quarantined evidence is still *in* the graph, because the graph
 * records what was believed and not only what is believed now (see `TwinNode.state`), but it must not
 * carry the weight of current evidence.
 */
function evidenceNode(row: Evidence, organizationId: string): NodeRow {
  return {
    id: row.id,
    organizationId,
    projectId: row.projectId,
    class: 'EVIDENCE',
    label: row.label,
    description: row.note,
    state: row.state === 'CURRENT' ? 'ACTIVE' : 'SUPERSEDED',
    provenance: 'USER_PROVIDED',
    /*
     * An attestation is weaker than an artefact, and the graph should say so rather than treat a
     * sentence somebody typed as equivalent to a hash of a test report (§32's grading).
     */
    confidence: row.contentHash === null ? 'MEDIUM' : 'HIGH',
    sourceRef: row.uri,
    revision: 1,
    attributes: {
      purpose: row.purpose,
      type: row.type,
      collectedBy: row.collectedBy,
      collectedAt: row.collectedAt.toISOString(),
      ...(row.contentHash === null ? {} : { contentHash: row.contentHash }),
      ...(row.uri === null ? {} : { uri: row.uri }),
    },
    createdAt: row.createdAt,
    updatedAt: row.createdAt,
  };
}

/**
 * An approval as a graph node.
 *
 * Only a *granted* approval becomes an `APPROVAL` node. A requested, rejected or withdrawn one is a
 * record of a conversation, not a decision, and `has('APPROVAL')` would otherwise be satisfied by
 * somebody having merely asked — which is the difference between a gate and a formality.
 */
function approvalNode(row: ApprovalRow, organizationId: string): NodeRow {
  return {
    id: row.id,
    organizationId,
    projectId: row.projectId,
    class: 'APPROVAL',
    label: `${row.subjectType} approved by ${row.approverRole}`,
    description: row.comment,
    state: row.state === 'APPROVED' ? 'ACTIVE' : 'WITHDRAWN',
    provenance: 'USER_CONFIRMED',
    confidence: 'HIGH',
    sourceRef: null,
    revision: row.subjectVersion,
    attributes: {
      purpose: `${row.subjectType.toLowerCase()}-approval`,
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      subjectVersion: row.subjectVersion,
      approverRole: row.approverRole,
      state: row.state,
      ...(row.approverUser === null ? {} : { approverUser: row.approverUser }),
    },
    createdAt: row.createdAt,
    updatedAt: row.decidedAt ?? row.createdAt,
  };
}
