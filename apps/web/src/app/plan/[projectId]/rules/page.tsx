import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { intakeAnswers } from '@govintel/db/schema';
import type { IntakeField } from '@govintel/intake/schema';
import { graphFromRows } from '@govintel/twin/repository';
import { RULES, RULESET_VERSION } from '@govintel/rules/catalogue';
import { evaluateRules, summarise, type RuleResult } from '@govintel/rules/evaluate';
import { evaluateGates } from '@govintel/rules/gates';
import { findField } from '@govintel/intake/fields';
import { withDatabase } from '../../../../lib/server/database.ts';
import { PublicHeader } from '../../../../components/shell/PublicHeader.tsx';
import { MaterialIcon } from '../../../../components/ui/MaterialIcon.tsx';
import { loadPlanRows } from '../actions.ts';

/**
 * What the rules require — the surface for the Phase-7 engine.
 *
 * Three things are shown, in this order, and the order is the argument:
 *
 * 1. **What cannot be decided yet**, and which question would decide it. A rule blocked by a missing
 *    answer is not a rule that does not apply, and putting these first turns the page from a verdict
 *    into something the user can act on.
 * 2. **The gates**, with the criteria that are not met.
 * 3. **The findings**, mandatory first.
 *
 * Every finding carries its rule id and its explanation. Plan §12 and gap-spec §13.3: a requirement
 * nobody can trace is one the user cannot challenge, and an engine whose conclusions cannot be
 * questioned is one people stop trusting the first time they disagree with it.
 */

export const metadata = { title: 'What the rules require' };

const SEVERITY_LABEL: Record<string, string> = {
  MANDATORY: 'Blocks a gate',
  RECOMMENDED: 'Strongly advised',
  ADVISORY: 'Worth considering',
};

export default async function RulesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const loaded = await loadPlanRows(projectId);
  if (loaded === null) notFound();

  const { project, nodes, edges } = loaded;

  const answerRows = await withDatabase((db) =>
    db.select().from(intakeAnswers).where(eq(intakeAnswers.projectId, projectId)),
  );

  const intake: IntakeField[] = answerRows.map((row) => ({
    fieldId: row.fieldId,
    category: row.category as IntakeField['category'],
    value: row.value ?? null,
    state: row.state as IntakeField['state'],
    provenance: row.provenance as IntakeField['provenance'],
    confidence: row.confidence as IntakeField['confidence'],
    lastUpdatedAt: row.updatedAt.toISOString(),
  }));

  const graph = graphFromRows(projectId, nodes, edges);

  const evaluation = evaluateRules(
    RULES,
    {
      projectId,
      /*
       * 'UNKNOWN' is the column default, not a project type.
       *
       * Passing it through would make every type-scoped rule evaluate against a type that does not
       * exist and report NOT_APPLICABLE — so a project that never answered the question would
       * silently escape every type-specific security obligation. Passing undefined instead makes
       * those rules INDETERMINATE, which is the truth.
       */
      ...(project.projectType === 'UNKNOWN' ? {} : { projectType: project.projectType }),
      lifecycleState: project.lifecycleState,
      methodology: 'AGILE',
      intake,
      // The date is an input, never read from a clock inside the engine — that separation is what
      // makes the determinism claim testable.
      asOf: new Date().toISOString().slice(0, 10),
      ...(graph.size > 0 ? { graph } : {}),
    },
    RULESET_VERSION,
  );

  const summary = summarise(evaluation);
  const gates = graph.size > 0 ? evaluateGates(graph) : [];

  const applied = evaluation.results.filter((r) => r.outcome === 'APPLIED');
  const mandatory = applied.filter((r) => r.severity === 'MANDATORY');
  const advisory = applied.filter((r) => r.severity !== 'MANDATORY');
  const indeterminate = evaluation.results.filter((r) => r.outcome === 'INDETERMINATE');
  const unresolvable = evaluation.conflicts.filter((c) => c.kind === 'UNRESOLVABLE');

  return (
    <div className="min-h-screen bg-background">
      <PublicHeader />

      <main id="main" className="mx-auto flex max-w-content flex-col gap-lg px-md py-xl">
        <header className="flex flex-col gap-sm">
          <p className="font-sans text-label-caps tracking-wider text-on-surface-variant uppercase">
            What the rules require
          </p>
          <h1 className="font-sans text-headline-lg text-on-surface">{project.name}</h1>
          <p className="font-sans text-body-md text-on-surface-variant">
            Every item below names the rule that produced it and why. Nothing here came from a model
            — the same answers produce the same list every time.
          </p>
          <p className="font-mono text-data-mono-sm text-on-surface-variant">
            ruleset {evaluation.rulesetVersion} · {RULES.length} rules evaluated
          </p>
        </header>

        <section
          className="flex flex-col gap-md rounded-lg border border-outline-variant bg-surface-container-low p-lg"
          aria-labelledby="summary-heading"
        >
          <h2 id="summary-heading" className="font-sans text-headline-sm text-on-surface">
            Where this project stands
          </h2>

          <dl className="grid grid-cols-2 gap-md sm:grid-cols-4">
            <Stat label="Obligations that apply" value={summary.mandatoryApplied} />
            <Stat label="Also recommended" value={advisory.length} />
            <Stat label="Cannot decide yet" value={summary.indeterminate} tone="warning" />
            <Stat label="Do not apply" value={summary.notApplicable} />
          </dl>
        </section>

        {/* Conflicts first when there are any: nothing downstream is safe to act on. */}
        {unresolvable.length > 0 ? (
          <section
            className="flex flex-col gap-sm rounded-lg border border-danger/40 bg-danger/10 p-lg"
            aria-labelledby="conflicts-heading"
          >
            <h2
              id="conflicts-heading"
              className="flex items-center gap-sm font-sans text-headline-sm text-on-surface"
            >
              <MaterialIcon name="gpp_maybe" size={20} className="text-danger" />
              Rules that contradict each other
            </h2>
            <p className="font-sans text-body-sm text-on-surface-variant">
              The platform will not choose between these. Whatever depends on them stays blocked
              until somebody decides.
            </p>
            <ul className="flex flex-col gap-sm">
              {unresolvable.map((conflict) => (
                <li
                  key={conflict.subject}
                  className="rounded border border-outline-variant bg-surface-container p-md"
                >
                  <p className="font-sans text-body-sm text-on-surface">{conflict.explanation}</p>
                  <p className="mt-xs font-mono text-data-mono-sm text-on-surface-variant">
                    {conflict.ruleIds.join(', ')}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/*
          What is undecidable, and the question that would decide it.
          Placed above the findings because it is the part the user can act on immediately.
        */}
        {summary.blockingInputs.length > 0 ? (
          <section
            className="flex flex-col gap-md rounded-lg border border-warning/40 bg-warning/10 p-lg"
            aria-labelledby="blocking-heading"
          >
            <h2
              id="blocking-heading"
              className="flex items-center gap-sm font-sans text-headline-sm text-on-surface"
            >
              <MaterialIcon name="help" size={20} className="text-warning" />
              {indeterminate.length} rules cannot be decided yet
            </h2>
            <p className="font-sans text-body-sm text-on-surface-variant">
              These are not rules that do not apply — the platform genuinely cannot tell. Answering
              the questions below would settle them, and some of them decide whether security or
              privacy obligations are in force at all.
            </p>
            <ul className="flex flex-wrap gap-xs">
              {summary.blockingInputs.map((fieldId) => (
                <li
                  key={fieldId}
                  className="rounded border border-outline-variant bg-surface-container px-sm py-xs font-sans text-body-sm text-on-surface-variant"
                >
                  {findField(fieldId)?.label ?? fieldId}
                </li>
              ))}
            </ul>
            <Link
              href={`/intake/${projectId}`}
              className="mt-sm inline-flex w-fit min-h-11 items-center gap-sm rounded bg-primary px-lg font-sans text-body-sm font-medium text-on-primary transition-colors hover:bg-primary-fixed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              Answer these
              <MaterialIcon name="arrow_forward" size={18} />
            </Link>
          </section>
        ) : null}

        {gates.length > 0 ? (
          <section className="flex flex-col gap-md" aria-labelledby="gates-heading">
            <div className="flex flex-col gap-xs">
              <h2 id="gates-heading" className="font-sans text-headline-sm text-on-surface">
                Quality gates
              </h2>
              <p className="font-sans text-body-sm text-on-surface-variant">
                A gate that cannot be decided is shown as such rather than as failed. The two are
                different, and treating them the same teaches people to ignore both.
              </p>
            </div>

            <ul className="flex flex-col gap-sm">
              {gates.map((gate) => (
                <li
                  key={gate.key}
                  className="flex flex-col gap-sm rounded border border-outline-variant bg-surface-container-low p-md"
                >
                  <div className="flex flex-wrap items-center gap-sm">
                    <MaterialIcon
                      name={
                        gate.result === 'PASSED'
                          ? 'check_circle'
                          : gate.result === 'FAILED'
                            ? 'cancel'
                            : 'help'
                      }
                      size={18}
                      className={
                        gate.result === 'PASSED'
                          ? 'text-tertiary'
                          : gate.result === 'FAILED'
                            ? 'text-danger'
                            : 'text-warning'
                      }
                    />
                    <span className="font-sans text-body-md text-on-surface">{gate.title}</span>
                    {/* Never colour alone — WCAG 2.2 §1.4.1, and one of our own rules. */}
                    <span className="font-mono text-data-mono-sm text-on-surface-variant">
                      {gate.result.toLowerCase().replace(/_/g, ' ')}
                    </span>
                  </div>

                  <p className="font-sans text-body-sm text-on-surface-variant">
                    {gate.explanation}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <FindingList
          id="mandatory"
          title="Obligations"
          description="Each of these blocks a gate. The rule that produced it is named so it can be challenged."
          findings={mandatory}
        />

        <FindingList
          id="advisory"
          title="Also recommended"
          description="Not blocking, but each names a specific consequence of skipping it."
          findings={advisory}
        />

        <div className="flex flex-wrap gap-lg">
          <Link
            href={`/plan/${projectId}`}
            className="inline-flex items-center gap-sm font-sans text-body-sm text-on-surface-variant transition-colors hover:text-on-surface"
          >
            <MaterialIcon name="arrow_back" size={16} />
            Back to the plan
          </Link>
        </div>
      </main>
    </div>
  );
}

function FindingList({
  id,
  title,
  description,
  findings,
}: {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly findings: readonly RuleResult[];
}) {
  if (findings.length === 0) return null;

  return (
    <section className="flex flex-col gap-md" aria-labelledby={`${id}-heading`}>
      <div className="flex flex-col gap-xs">
        <h2 id={`${id}-heading`} className="font-sans text-headline-sm text-on-surface">
          {title} ({findings.length})
        </h2>
        <p className="font-sans text-body-sm text-on-surface-variant">{description}</p>
      </div>

      <ul className="flex flex-col gap-sm">
        {findings.map((finding) => (
          <li
            key={finding.ruleId}
            className="flex flex-col gap-xs rounded border border-outline-variant bg-surface-container-low p-md"
          >
            <p className="font-sans text-body-md text-on-surface">{finding.title}</p>
            <p className="font-sans text-body-sm text-on-surface-variant">{finding.explanation}</p>
            {/* The rule id, so a finding can be traced, argued with, or looked up in the catalogue. */}
            <p className="font-mono text-data-mono-sm text-on-surface-variant">
              {finding.ruleId} · {finding.category.toLowerCase().replace(/_/g, ' ')} ·{' '}
              {SEVERITY_LABEL[finding.severity] ?? finding.severity}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Stat({
  label,
  value,
  tone = 'default',
}: {
  readonly label: string;
  readonly value: number;
  readonly tone?: 'default' | 'warning';
}) {
  return (
    <div>
      <dt className="font-sans text-label-caps tracking-wider text-on-surface-variant uppercase">
        {label}
      </dt>
      <dd
        className={`mt-xs font-mono text-headline-sm ${tone === 'warning' ? 'text-warning' : 'text-on-surface'}`}
      >
        {value}
      </dd>
    </div>
  );
}
