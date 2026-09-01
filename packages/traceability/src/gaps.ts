/**
 * Missing-link detection, in both directions.
 *
 * Forward traceability — does every requirement reach work, tests and evidence — is the half every
 * tool implements. Backward traceability is the half that gets left out, and it is the half that
 * catches the more expensive problem: work that traces back to no requirement is either scope nobody
 * asked for, or a requirement nobody wrote down. Both cost money, and neither is visible from the
 * forward direction, where the report can be a wall of green while a third of the build is
 * unaccounted for.
 *
 * The output is findings, never a percentage. "87% traceable" is the same failure as the 83/100 that
 * gap-spec §23 forbids: it is unactionable, it is optimisable, and it moves for reasons nobody can
 * see. What a reader needs is *which* requirement has no test, and the id so they can go and look.
 *
 * Contract: gap-spec §25 (exception-first — healthy items stay quiet), §15.2, §15.3.
 */

import type { TwinGraph } from '@govintel/twin/graph';
import type { TwinNode } from '@govintel/twin/nodes';
import { CHAIN, traceAll, type ChainTrace, type HopKey } from './chain.ts';
import { checkRequirement, requirementFromNode, type RequirementFinding } from './requirements.ts';
import { checkArchitecture, type ArchitectureFinding } from './architecture.ts';

/* -------------------------------------------------------------------------- */
/* Gap kinds                                                                  */
/* -------------------------------------------------------------------------- */

export const GAP_KINDS = [
  /* Forward: a requirement that does not reach something it must. */
  'REQUIREMENT_WITHOUT_WORK',
  'REQUIREMENT_WITHOUT_TEST',
  'REQUIREMENT_WITHOUT_EVIDENCE',
  'REQUIREMENT_EVIDENCE_STALE',

  /* Backward: something that exists for no recorded reason. */
  'WORK_WITHOUT_REQUIREMENT',
  'TEST_VERIFIES_NOTHING',
  'EVIDENCE_ATTACHED_TO_NOTHING',

  /* Neither direction: the requirement cannot be traced because it cannot be verified at all. */
  'REQUIREMENT_NOT_TRACEABLE',
] as const;

export type GapKind = (typeof GAP_KINDS)[number];

export type Direction = 'FORWARD' | 'BACKWARD' | 'NEITHER';

export interface Gap {
  readonly kind: GapKind;
  readonly direction: Direction;
  readonly summary: string;
  /** Why this matters, so a reader can disagree with the rule and not only with the verdict. */
  readonly why: string;
  /** Node ids to go and look at. */
  readonly evidence: readonly string[];
  readonly blocking: boolean;
}

/* -------------------------------------------------------------------------- */
/* Detection                                                                  */
/* -------------------------------------------------------------------------- */

export interface TraceabilityReport {
  readonly gaps: readonly Gap[];
  readonly requirementFindings: readonly RequirementFinding[];
  readonly architectureFindings: readonly ArchitectureFinding[];
  readonly traces: readonly ChainTrace[];

  /**
   * Counts, not a score.
   *
   * Deliberately absolute numbers rather than a ratio: "4 of 31 requirements have no test" is
   * actionable and "87% traceable" is not, and the ratio is the number that ends up on a slide.
   */
  readonly counts: {
    readonly requirements: number;
    readonly complete: number;
    readonly blocked: number;
    /** Requirements excluded because they cannot be verified at all — a different state from untraced. */
    readonly notAssessable: number;
  };
}

export function analyse(graph: TwinGraph): TraceabilityReport {
  const traces = traceAll(graph);
  const gaps: Gap[] = [];
  const requirementFindings: RequirementFinding[] = [];

  const notAssessable = new Set<string>();

  for (const node of graph.nodesOfClass('REQUIREMENT')) {
    const requirement = requirementFromNode(node);

    if (requirement === undefined) {
      /*
       * A REQUIREMENT node the model cannot read is not reported as clean.
       *
       * Silently skipping it would exclude it from every check below, so a malformed requirement
       * would be the safest kind to have — which is exactly backwards.
       */
      gaps.push({
        kind: 'REQUIREMENT_NOT_TRACEABLE',
        direction: 'NEITHER',
        summary: `${node.label} does not record a kind and priority, so it cannot be checked.`,
        why: 'A requirement the model cannot read is excluded from every other check. Reporting it as clean would make a malformed requirement the safest kind to have.',
        evidence: [node.id],
        blocking: false,
      });

      notAssessable.add(node.id);
      continue;
    }

    const findings = checkRequirement(requirement);
    requirementFindings.push(...findings);

    // A requirement with no verification method cannot be traced to a test, and reporting that as a
    // missing test would blame the wrong thing: the test cannot be written until somebody decides
    // how the requirement is to be demonstrated.
    if (findings.some((f) => f.defect === 'UNVERIFIABLE')) {
      gaps.push({
        kind: 'REQUIREMENT_NOT_TRACEABLE',
        direction: 'NEITHER',
        summary: `${requirement.label} records no way of being verified.`,
        why: 'This cannot be traced to a test because nobody has decided what would demonstrate it. Reporting it as a missing test would blame the wrong thing and send somebody to write a test they cannot specify.',
        evidence: [node.id],
        blocking: requirement.priority === 'MUST',
      });

      notAssessable.add(node.id);
    }
  }

  for (const trace of traces) {
    if (notAssessable.has(trace.requirementId)) continue;
    gaps.push(...forwardGaps(trace));
  }

  gaps.push(...backwardGaps(graph));

  const assessable = traces.filter((t) => !notAssessable.has(t.requirementId));

  return {
    gaps,
    requirementFindings,
    architectureFindings: checkArchitecture(graph),
    traces,
    counts: {
      requirements: traces.length,
      complete: assessable.filter((t) => t.complete).length,
      blocked: gaps.filter((g) => g.blocking).length,
      notAssessable: notAssessable.size,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Forward                                                                    */
/* -------------------------------------------------------------------------- */

const FORWARD: Readonly<Record<string, { kind: GapKind; why: string }>> = {
  WORK: {
    kind: 'REQUIREMENT_WITHOUT_WORK',
    why: 'The project has accepted this obligation and has nothing planned that would meet it. This is the gap that becomes visible at the release gate, when it is far too late to plan the work.',
  },
  TEST: {
    kind: 'REQUIREMENT_WITHOUT_TEST',
    why: 'Nothing will notice if this stops being true. Work with no verification is a claim about a moment in the past, and it decays without anybody being told.',
  },
  EVIDENCE: {
    kind: 'REQUIREMENT_WITHOUT_EVIDENCE',
    why: 'Anyone asking later how this was satisfied — an auditor, a customer, the next team — has only the assertion that it was.',
  },
};

function forwardGaps(trace: ChainTrace): readonly Gap[] {
  const gaps: Gap[] = [];

  for (const link of trace.links) {
    const hop = CHAIN.find((h) => h.key === link.hop);
    if (!hop?.required) continue;

    if (link.status === 'STALE') {
      gaps.push({
        kind: 'REQUIREMENT_EVIDENCE_STALE',
        direction: 'FORWARD',
        summary: `${trace.requirementLabel}: ${hop.label.toLowerCase()} attests to an earlier revision.`,
        why: 'Every link in the chain is present, so a check that looks only for links reports this as complete. It is not: what was demonstrated is not what the requirement now says, and the difference is invisible unless somebody compares revisions.',
        evidence: [trace.requirementId, ...link.nodeIds],
        blocking: true,
      });
      continue;
    }

    if (link.status === 'LINKED') continue;

    const spec = FORWARD[link.hop];
    if (spec === undefined) continue;

    gaps.push({
      kind: spec.kind,
      direction: 'FORWARD',
      summary:
        link.status === 'UNVERIFIED'
          ? `${trace.requirementLabel}: ${link.detail}`
          : `${trace.requirementLabel} has no ${hop.label.toLowerCase()}.`,
      why: spec.why,
      evidence: [trace.requirementId, ...link.nodeIds],
      // Only the first broken hop blocks. A requirement with no work will also have no test and no
      // evidence, and reporting three blocking gaps for one cause turns the report into a wall that
      // hides the other requirements' real problems.
      blocking: trace.brokeAt === link.hop,
    });
  }

  return gaps;
}

/* -------------------------------------------------------------------------- */
/* Backward                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Things that exist for no recorded reason.
 *
 * This is the direction that catches scope creep, and it is uncomfortable on purpose: a project that
 * looks fully traced forward can be a third unaccounted for backwards.
 */
function backwardGaps(graph: TwinGraph): readonly Gap[] {
  const gaps: Gap[] = [];

  for (const task of graph.nodesOfClass('TASK')) {
    if (task.state === 'WITHDRAWN') continue;
    if (reaches(graph, task, 'IMPLEMENTS', 'REQUIREMENT')) continue;

    /*
     * Work generated by a rule is exempt.
     *
     * The rule *is* the recorded reason — it names the obligation and cites its source, which is
     * everything a requirement link would provide. Reporting it as unjustified would fill the report
     * with the platform's own output and teach people to skim past this section, which is precisely
     * where the real scope creep would then hide.
     */
    if (typeof task.attributes.ruleId === 'string') continue;

    gaps.push({
      kind: 'WORK_WITHOUT_REQUIREMENT',
      direction: 'BACKWARD',
      summary: `${task.label} implements no recorded requirement.`,
      why: 'Either somebody is building something nobody asked for, or there is a requirement nobody wrote down. The graph cannot tell which, and both are worth knowing before the work is paid for. This is the direction most traceability reports omit, and it is where scope creep is visible.',
      evidence: [task.id],
      blocking: false,
    });
  }

  for (const test of graph.nodesOfClass('TEST')) {
    if (test.state === 'WITHDRAWN') continue;
    if (graph.edgesFrom(test.id, 'VERIFIES').length > 0) continue;

    gaps.push({
      kind: 'TEST_VERIFIES_NOTHING',
      direction: 'BACKWARD',
      summary: `${test.label} verifies nothing recorded.`,
      why: 'A passing test that is attached to no requirement contributes nothing to the release argument, and a failing one gives nobody a way to judge how much it matters.',
      evidence: [test.id],
      blocking: false,
    });
  }

  for (const evidence of graph.nodesOfClass('EVIDENCE')) {
    if (evidence.state === 'WITHDRAWN') continue;
    if (graph.edgesTo(evidence.id, 'EVIDENCED_BY').length > 0) continue;

    gaps.push({
      kind: 'EVIDENCE_ATTACHED_TO_NOTHING',
      direction: 'BACKWARD',
      summary: `${evidence.label} is attached to nothing.`,
      why: 'Evidence supports a specific claim. Held loose it is a file, and at the point somebody needs it there is no way to know what it was meant to show.',
      evidence: [evidence.id],
      blocking: false,
    });
  }

  return gaps;
}

function reaches(graph: TwinGraph, from: TwinNode, via: 'IMPLEMENTS', to: 'REQUIREMENT'): boolean {
  return graph.edgesFrom(from.id, via).some((edge) => graph.node(edge.to)?.class === to);
}

/* -------------------------------------------------------------------------- */
/* The exception-first surface                                                */
/* -------------------------------------------------------------------------- */

/**
 * What to say when there is nothing to say.
 *
 * §25 requires healthy items to stay quiet, which creates a specific hazard: an empty report and a
 * report on an empty project look identical. So an empty result is never rendered as success — the
 * caller is told which of the two it is.
 */
export function summarise(report: TraceabilityReport): {
  readonly headline: string;
  readonly quiet: boolean;
} {
  if (report.counts.requirements === 0) {
    return {
      headline:
        'No requirements are recorded, so there is nothing to trace. This is not the same as being fully traced, and it is the more common of the two.',
      quiet: false,
    };
  }

  const blocking = report.gaps.filter((g) => g.blocking).length;

  if (blocking > 0) {
    return {
      headline: `${String(blocking)} traceability gap${blocking === 1 ? '' : 's'} block${blocking === 1 ? 's' : ''} release.`,
      quiet: false,
    };
  }

  if (report.gaps.length > 0) {
    return {
      headline: `${String(report.gaps.length)} gap${report.gaps.length === 1 ? '' : 's'} worth looking at, none blocking.`,
      quiet: false,
    };
  }

  return {
    headline: `All ${String(report.counts.requirements)} requirements trace to work, a passing test and kept evidence.`,
    quiet: true,
  };
}

/** The hops a trace failed at, for callers wanting the shape of the problem rather than each instance. */
export function brokenHops(traces: readonly ChainTrace[]): readonly HopKey[] {
  const seen = new Set<HopKey>();

  for (const trace of traces) {
    if (trace.brokeAt !== undefined) seen.add(trace.brokeAt);
  }

  // Ordered by the chain rather than by discovery, so the output reads in the direction the chain
  // runs and does not depend on graph iteration order.
  return CHAIN.filter((hop) => seen.has(hop.key)).map((hop) => hop.key);
}
