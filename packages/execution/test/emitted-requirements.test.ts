/**
 * The catalogue's own requirements, made real.
 *
 * Contract: gap-spec §13 (a rule's emissions are its output), plan §10 (the Requirement → … → Release
 * chain is walkable), Phase 10's gate "complete Requirement→Release chain verified".
 *
 * ## What was wrong
 *
 * The evaluator emitted 139 requirements and `decompose` never read them. That cost more than the
 * requirements: emitted *tests* carry a `verifies` key naming an emitted requirement, so with none
 * of them in the graph no test could attach to anything, and the traceability chain broke at TEST
 * for every project in the product. The Phase-10 gate passed because it ran against hand-built
 * fixtures containing the very nodes the product never produced.
 *
 * These tests are built from the real generator and the real evaluator, for the same reason the rest
 * of this directory is: a fixture assembled by hand tests the decomposer against a shape I imagined.
 */

import { describe, expect, it } from 'vitest';
import { analyse, brokenHops } from '@govintel/traceability/gaps';
import { traceAll } from '@govintel/traceability/chain';
import { checkRequirement, requirementFromNode } from '@govintel/traceability/requirements';
import { decompose, mergeIntoGraph } from '../src/decompose.ts';
import { buildInputs, FIXED_TIME, TEAM_INTAKE, TEAM_PROJECT_ID } from './fixtures.ts';

function build() {
  const inputs = buildInputs(
    TEAM_PROJECT_ID,
    'A booking tool',
    TEAM_INTAKE,
    'INTERNAL_BUSINESS_APP',
  );

  const decomposition = decompose({
    projectId: TEAM_PROJECT_ID,
    graph: inputs.graph,
    emissions: inputs.emissions,
    teamSize: 4,
    at: FIXED_TIME,
  });

  return {
    evaluation: inputs.evaluation,
    decomposition,
    graph: mergeIntoGraph(inputs.graph, decomposition),
  };
}

describe('rule-emitted requirements reach the graph', () => {
  it('creates a requirement node for them', () => {
    const { evaluation, graph } = build();

    // The generator produces some of its own, so this is "more than the generator's", not an exact
    // count — the exact count is pinned by the golden fixtures.
    expect(graph.nodesOfClass('REQUIREMENT').length).toBeGreaterThan(
      evaluation.emissions.requirements.length,
    );
  });

  it('meets the standard the platform applies to everyone else’s requirements', () => {
    /*
     * The rule this file exists to honour. A platform that checks the user's requirements for a
     * verification method and an acceptance criterion, and exempts the ones it writes itself, is
     * asserting that its own conclusions need no justification — which is the position it exists to
     * argue against.
     */
    const { graph } = build();

    const blocking = graph
      .nodesOfClass('REQUIREMENT')
      .filter(
        (node) =>
          typeof node.attributes.sourceRef === 'string' &&
          node.attributes.sourceRef.startsWith('rule:'),
      )
      .map((node) => requirementFromNode(node))
      .filter((requirement) => requirement !== undefined)
      .flatMap((requirement) => checkRequirement(requirement))
      .filter((finding) => finding.blocking);

    expect(blocking).toEqual([]);
  });

  it('leaves the project’s own unmeasured targets reported, because that is the point', () => {
    /*
     * Scoped deliberately. The generator's availability and performance requirements come back
     * `UNMEASURED_QUALITY_ATTRIBUTE`, and that is the product working rather than a defect to fix:
     * `availability.expectation` is a choice between "Best effort", "Business hours" and "High
     * availability", so the user has stated an expectation and never stated a number. A requirement
     * that cannot be measured cannot be verified, and saying so is the whole job.
     *
     * Asserting it here keeps the scoping above honest — otherwise the narrower assertion would
     * read as though these findings had been made to go away.
     */
    const { graph } = build();

    const fromIntake = graph
      .nodesOfClass('REQUIREMENT')
      .filter(
        (node) =>
          typeof node.attributes.sourceRef === 'string' &&
          node.attributes.sourceRef.startsWith('intake:'),
      )
      .map((node) => requirementFromNode(node))
      .filter((requirement) => requirement !== undefined)
      .flatMap((requirement) => checkRequirement(requirement))
      .filter((finding) => finding.blocking);

    expect(fromIntake.map((finding) => finding.defect)).toEqual([
      'UNMEASURED_QUALITY_ATTRIBUTE',
      'UNMEASURED_QUALITY_ATTRIBUTE',
    ]);
  });

  it('carries the rule it came from, so it can be renegotiated', () => {
    const { graph } = build();

    const fromRules = graph
      .nodesOfClass('REQUIREMENT')
      .filter(
        (node) =>
          typeof node.attributes.sourceRef === 'string' &&
          node.attributes.sourceRef.startsWith('rule:'),
      );

    expect(fromRules.length).toBeGreaterThan(0);

    for (const node of fromRules) {
      expect(node.attributes.ruleId, node.id).toBeDefined();
      expect(node.attributes.ruleKey, node.id).toBeDefined();
    }
  });

  it('records why each verification method was chosen', () => {
    // The method is derived from the rule's own words; keeping the reason means a wrong answer can
    // be traced to the signal that produced it rather than argued about.
    const { graph } = build();

    const withRationale = graph
      .nodesOfClass('REQUIREMENT')
      .filter((node) => Array.isArray(node.attributes.verificationRationale));

    expect(withRationale.length).toBeGreaterThan(0);
  });

  it('reports a requirement whose rule does not say how it is verified', () => {
    /*
     * Exactly one rule in the catalogue names no method. It is not materialised with a guessed one:
     * a requirement carrying an invented verification method is indistinguishable afterwards from
     * one that was derived, and `checkRequirement` would call it satisfied when nobody had decided
     * how to satisfy it.
     */
    const { decomposition } = build();

    const reported = decomposition.notDecomposed.filter((entry) =>
      entry.includes('names no method'),
    );

    expect(reported).toHaveLength(1);
    expect(reported[0]).toContain('SEC-DEP-003');
  });
});

describe('every requirement has work against it', () => {
  it('links implementing work to all of them, not only the generator’s', () => {
    /*
     * The moment the rule-emitted requirements became real, the WORK hop broke for all of them —
     * the task-per-requirement loop read the input graph, so it only ever saw the generator's. The
     * gap moved rather than closed, which is the failure mode of fixing one hop at a time.
     */
    const { graph } = build();
    const traces = traceAll(graph);

    const withoutWork = traces.filter(
      (trace) => trace.links.find((link) => link.hop === 'WORK')?.status !== 'LINKED',
    );

    expect(withoutWork).toEqual([]);
  });
});

describe('the tests a requirement specifies', () => {
  it('creates one for a requirement verified by a test and not otherwise covered', () => {
    const { graph } = build();

    const specified = graph
      .nodesOfClass('TEST')
      .filter((node) => node.attributes.kind === 'SPECIFIED');

    expect(specified.length).toBeGreaterThan(0);
  });

  it('marks them as never run, because they have not been', () => {
    /*
     * The one lie that would make the whole report worthless. A specified test is a statement of
     * what must be true, not evidence that it is — and `executed: true` would turn every requirement
     * in a project that has never run a test into a fully traced one.
     */
    const { graph } = build();

    for (const node of graph.nodesOfClass('TEST')) {
      if (node.attributes.kind !== 'SPECIFIED') continue;
      expect(node.attributes.executed, node.id).toBe(false);
    }
  });

  it('does not duplicate a test the catalogue already emitted', () => {
    const { graph } = build();

    const verified = graph
      .nodesOfClass('TEST')
      .flatMap((test) => graph.edgesFrom(test.id).filter((edge) => edge.class === 'VERIFIES'));

    const targets = verified.map((edge) => edge.to);

    expect(new Set(targets).size).toBe(targets.length);
  });
});

describe('the chain a real project produces', () => {
  it('no longer breaks at WORK or leaves TEST with nothing to point at', () => {
    const { graph } = build();
    const traces = traceAll(graph);

    const testLinks = traces.map(
      (trace) => trace.links.find((link) => link.hop === 'TEST')?.status,
    );

    // Every requirement either has a test to point at or says it is verified another way. `MISSING`
    // — a requirement that should have a test and has none — is what this closes.
    expect(testLinks).not.toContain('MISSING');
    expect(brokenHops(traces)).not.toContain('WORK');
  });

  it('traces some requirements end to end, where before it traced none', () => {
    /*
     * "Fully traced: 0" was a fact about what had been written down rather than about the project.
     * The ones that complete are those verified by inspection, analysis or demonstration: they have
     * work, and they are not waiting on a test run.
     */
    const { graph } = build();

    expect(analyse(graph).counts.complete).toBeGreaterThan(0);
  });

  it('does not claim the ones waiting on a test run are complete', () => {
    // The other half, and the one that keeps the number honest.
    const report = analyse(build().graph);

    expect(report.counts.complete).toBeLessThan(report.counts.requirements);
  });
});
