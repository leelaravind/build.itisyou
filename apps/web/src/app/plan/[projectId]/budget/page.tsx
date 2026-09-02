import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { intakeAnswers } from '@govintel/db/schema';
import type { IntakeField } from '@govintel/intake/schema';
import { graphFromRows } from '@govintel/twin/repository';
import { RULES, RULESET_VERSION } from '@govintel/rules/catalogue';
import { evaluateRules, summarise } from '@govintel/rules/evaluate';
import { evaluateGates } from '@govintel/rules/gates';
import { decompose, mergeIntoGraph } from '@govintel/execution/decompose';
import { findScheduleProblems } from '@govintel/execution/scheduling';
import {
  isCurrency,
  formatMoney,
  formatRange,
  money,
  type CurrencyCode,
} from '@govintel/finance/money';
import {
  aggregateConfidence,
  collectAssumptions,
  estimate,
  formatEffort,
  totalEffort,
  type Estimate,
} from '@govintel/finance/estimate';
import { addContingency, createBudget, sizeContingency, totals } from '@govintel/finance/budget';
import { assessFeasibility, assessHealth, nextAction } from '@govintel/finance/feasibility';
import { withDatabase } from '../../../../lib/server/database.ts';
import { PublicHeader } from '../../../../components/shell/PublicHeader.tsx';
import { MaterialIcon } from '../../../../components/ui/MaterialIcon.tsx';
import { loadPlanRows } from '../actions.ts';
import type { IconName } from '../../../../components/ui/icon-paths.ts';

/**
 * Money, feasibility and health.
 *
 * The page most likely to be screenshotted and quoted out of context, which is why every figure on it
 * carries its conditions. There is no total that silently includes contingency, no midpoint of a
 * range, no percentage score, and no delivery date.
 *
 * Gap-spec §22 and §23 both open by forbidding a single number, so the feasibility and health sections
 * show dimensions with their causes and name the one that decided the verdict. "At risk, because the
 * budget has no ceiling" is something a person can act on; 83/100 is not.
 */

export const metadata = { title: 'Budget and feasibility' };

export default async function BudgetPage({ params }: { params: Promise<{ projectId: string }> }) {
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

  const planGraph = graphFromRows(projectId, nodes, edges);

  if (planGraph.size === 0) {
    return <NoPlanYet projectId={projectId} name={project.name} />;
  }

  const evaluation = evaluateRules(
    RULES,
    {
      projectId,
      ...(project.projectType === 'UNKNOWN' ? {} : { projectType: project.projectType }),
      lifecycleState: project.lifecycleState,
      methodology: 'AGILE',
      intake,
      graph: planGraph,
      asOf: new Date().toISOString().slice(0, 10),
    },
    RULESET_VERSION,
  );

  const summary = summarise(evaluation);

  const decomposition = decompose({
    projectId,
    graph: planGraph,
    emissions: evaluation.emissions,
    at: new Date().toISOString(),
  });

  const graph = mergeIntoGraph(planGraph, decomposition);

  /*
   * Every task is estimated as UNKNOWN complexity.
   *
   * That is not laziness; it is the truth. Nobody has sized any of this work, and the enormous range
   * that produces is the honest representation of that — a comfortable-looking figure here would be
   * the platform inventing knowledge it does not have. The range narrows when someone sizes the work.
   */
  const tasks = graph.nodesOfClass('TASK');
  const estimates: Estimate[] = tasks.map(() =>
    estimate({ complexity: 'UNKNOWN', adjustments: ['REWORK_ALLOWANCE'] }),
  );

  const effort = totalEffort(estimates);
  const confidence = aggregateConfidence(estimates);
  const assumptions = collectAssumptions(estimates);

  const currency = currencyOf(intake);
  const dayRate = money(50_000, currency); // £500/day at 2 decimal places, stated as an assumption.

  const budgetCeiling = numberAnswer(intake, 'budget.total');

  const criticalUnknowns = graph
    .nodesOfClass('UNKNOWN')
    .filter((n) => n.attributes.importance === 'CRITICAL').length;

  const sized = sizeContingency(money(Math.round((effort.expected / 7.5) * 50_000), currency), {
    criticalUnknowns,
    unconfirmedAssumptions: graph.nodesOfClass('ASSUMPTION').length,
    unfamiliarTechnology: false,
    existingSystem: false,
  });

  let budget = createBudget(projectId, currency);
  budget = addContingency(budget, {
    id: `${projectId}:contingency`,
    label: 'Contingency',
    amount: sized.amount,
    justifications: sized.justifications,
    drawdowns: [],
  });

  const budgetTotals = totals(budget);

  const scheduleProblems = findScheduleProblems({ graph, resources: [] });
  const gates = evaluateGates(graph);
  const failedGates = gates.filter((g) => g.result === 'FAILED').map((g) => g.key);

  const assessmentInput = {
    graph,
    scheduleProblems,
    budget: budgetTotals,
    budgetCeilingKnown: budgetCeiling !== undefined,
    estimateConfidence: confidence,
    openMandatoryFindings: summary.mandatoryApplied,
    indeterminateFindings: summary.indeterminate,
    failedGates,
  };

  const feasibility = assessFeasibility(assessmentInput);
  const health = assessHealth(assessmentInput);
  const action = nextAction(assessmentInput);

  return (
    <div className="min-h-screen bg-background">
      <PublicHeader />

      <main id="main" className="mx-auto flex max-w-content flex-col gap-lg px-md py-xl">
        <header className="flex flex-col gap-sm">
          <p className="font-sans text-label-caps tracking-wider text-on-surface-variant uppercase">
            Budget and feasibility
          </p>
          <h1 className="font-sans text-headline-lg text-on-surface">{project.name}</h1>
          <p className="font-sans text-body-md text-on-surface-variant">
            Everything here is a range, and every range says what it assumed. There is no score and
            no delivery date — both would be precision this platform does not have.
          </p>
        </header>

        {/* What to deal with first. Gap-spec §24: the user should not have to inspect every module. */}
        {action === null ? null : (
          <section
            className="flex flex-col gap-sm rounded-lg border border-primary/40 bg-primary/10 p-lg"
            aria-labelledby="next-heading"
          >
            <h2
              id="next-heading"
              className="flex items-center gap-sm font-sans text-headline-sm text-on-surface"
            >
              <MaterialIcon name="priority_high" size={20} className="text-primary" />
              Deal with this first
            </h2>
            <p className="font-sans text-body-md text-on-surface">{action.summary}</p>
            <p className="font-sans text-body-sm text-on-surface-variant">{action.why}</p>
          </section>
        )}

        <section
          className="flex flex-col gap-md rounded-lg border border-outline-variant bg-surface-container-low p-lg"
          aria-labelledby="effort-heading"
        >
          <h2 id="effort-heading" className="font-sans text-headline-sm text-on-surface">
            Effort
          </h2>

          <p className="font-mono text-headline-sm text-on-surface">{formatEffort(effort)}</p>

          <p className="font-sans text-body-sm text-on-surface-variant">
            {confidence.toLowerCase()} confidence, derived from how wide the range is rather than
            asserted. A range this wide is not a schedule; it is a statement that the work has not
            been sized.
          </p>

          <details className="rounded border border-outline-variant bg-surface-container p-md">
            <summary className="cursor-pointer font-sans text-body-sm text-on-surface">
              What this figure assumed ({assumptions.length})
            </summary>
            <ul className="mt-sm flex flex-col gap-xs">
              {assumptions.map((assumption) => (
                <li key={assumption} className="font-sans text-body-sm text-on-surface-variant">
                  {assumption}
                </li>
              ))}
            </ul>
          </details>
        </section>

        <section
          className="flex flex-col gap-md rounded-lg border border-outline-variant bg-surface-container-low p-lg"
          aria-labelledby="budget-heading"
        >
          <h2 id="budget-heading" className="font-sans text-headline-sm text-on-surface">
            Contingency
          </h2>

          <div className="flex flex-wrap items-baseline gap-md">
            <span className="font-mono text-headline-sm text-on-surface">
              {formatMoney(budgetTotals.contingencyAllocated)}
            </span>
            <span className="font-sans text-body-sm text-on-surface-variant">
              {sized.percent}% allowance, at an assumed day rate of {formatMoney(dayRate)}
            </span>
          </div>

          {/*
            §21.5: contingency is explicit and explainable. Every component is named, so the figure
            can be argued with and so it visibly shrinks when an unknown is answered.
          */}
          <ul className="flex flex-col gap-xs">
            {sized.justifications.map((justification) => (
              <li
                key={justification}
                className="flex items-start gap-sm font-sans text-body-sm text-on-surface-variant"
              >
                <MaterialIcon name="arrow_right" size={16} />
                {justification}
              </li>
            ))}
          </ul>

          <ul className="flex flex-col gap-xs">
            {budgetTotals.caveats.map((caveat) => (
              <li
                key={caveat}
                className="flex items-start gap-sm font-sans text-body-sm text-warning"
              >
                <MaterialIcon name="info" size={16} />
                {caveat}
              </li>
            ))}
          </ul>

          {budgetCeiling === undefined ? (
            <p className="flex items-start gap-sm rounded border border-warning/40 bg-warning/10 p-md font-sans text-body-sm text-on-surface-variant">
              <MaterialIcon name="warning" size={16} className="text-warning" />
              No budget has been recorded, so there is nothing for these figures to be measured
              against. Nothing here can be over budget because there is no budget.
            </p>
          ) : (
            <p className="font-sans text-body-sm text-on-surface-variant">
              Recorded budget:{' '}
              {formatRange({
                low: money(budgetCeiling * 100, currency),
                high: money(budgetCeiling * 100, currency),
              })}
            </p>
          )}
        </section>

        <DimensionSection
          id="feasibility"
          title="Can this be delivered?"
          description="Eight dimensions, each with its causes. The verdict is the worst of them, and it says which."
          overall={feasibility.overall}
          decidedBy={feasibility.decidedBy}
          explanation={feasibility.explanation}
          dimensions={feasibility.dimensions}
        />

        <DimensionSection
          id="health"
          title="Is it going well?"
          description="A different question from whether it can work. There is no score here — a number nobody can argue with is a number nobody can act on."
          overall={health.overall}
          decidedBy={health.decidedBy}
          explanation={health.explanation}
          dimensions={health.dimensions}
        />

        <div className="flex flex-wrap gap-lg">
          <Link
            href={`/plan/${projectId}`}
            className="inline-flex items-center gap-sm font-sans text-body-sm text-on-surface-variant transition-colors hover:text-on-surface"
          >
            <MaterialIcon name="arrow_back" size={16} />
            Back to the plan
          </Link>
          <Link
            href={`/plan/${projectId}/work`}
            className="inline-flex items-center gap-sm font-sans text-body-sm text-on-surface-variant transition-colors hover:text-on-surface"
          >
            <MaterialIcon name="checklist" size={16} />
            The work
          </Link>
        </div>
      </main>
    </div>
  );
}

function DimensionSection({
  id,
  title,
  description,
  overall,
  decidedBy,
  explanation,
  dimensions,
}: {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly overall: string;
  readonly decidedBy: string;
  readonly explanation: string;
  readonly dimensions: readonly {
    readonly key: string;
    readonly label: string;
    readonly status: string;
    readonly causes: readonly { readonly summary: string; readonly evidence: readonly string[] }[];
  }[];
}) {
  return (
    <section className="flex flex-col gap-md" aria-labelledby={`${id}-heading`}>
      <div className="flex flex-col gap-xs">
        <h2 id={`${id}-heading`} className="font-sans text-headline-sm text-on-surface">
          {title}
        </h2>
        <p className="font-sans text-body-sm text-on-surface-variant">{description}</p>
      </div>

      <div
        className={`flex flex-col gap-xs rounded-lg border p-lg ${toneClasses(overall)}`}
        role="status"
      >
        <p className="flex items-center gap-sm font-sans text-headline-sm text-on-surface">
          <MaterialIcon name={toneIcon(overall)} size={20} />
          {/* Never colour alone — WCAG 2.2 §1.4.1 and rule A11Y-STATUS-001. */}
          {overall.toLowerCase().replace(/_/g, ' ')}
        </p>
        <p className="font-sans text-body-sm text-on-surface-variant">{explanation}</p>
        <p className="font-mono text-data-mono-sm text-on-surface-variant">
          decided by: {decidedBy}
        </p>
      </div>

      <ul className="grid gap-sm sm:grid-cols-2">
        {dimensions.map((dimension) => (
          <li
            key={dimension.key}
            className="flex flex-col gap-xs rounded border border-outline-variant bg-surface-container-low p-md"
          >
            <p className="flex items-center gap-sm font-sans text-body-md text-on-surface">
              <MaterialIcon name={toneIcon(dimension.status)} size={16} />
              {dimension.label}
              <span className="font-mono text-data-mono-sm text-on-surface-variant">
                {dimension.status.toLowerCase().replace(/_/g, ' ')}
              </span>
            </p>

            {dimension.causes.length === 0 ? null : (
              <ul className="flex flex-col gap-xs">
                {dimension.causes.map((cause) => (
                  <li
                    key={cause.summary}
                    className="font-sans text-body-sm text-on-surface-variant"
                  >
                    {cause.summary}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function toneClasses(status: string): string {
  if (status === 'FEASIBLE' || status === 'HEALTHY') return 'border-tertiary/40 bg-tertiary/10';
  if (status === 'UNREALISTIC' || status === 'CRITICAL') return 'border-danger/40 bg-danger/10';
  if (status === 'UNKNOWN') return 'border-outline-variant bg-surface-container-low';
  return 'border-warning/40 bg-warning/10';
}

function toneIcon(status: string): IconName {
  if (status === 'FEASIBLE' || status === 'HEALTHY') return 'check_circle';
  if (status === 'UNREALISTIC' || status === 'CRITICAL') return 'cancel';
  if (status === 'UNKNOWN') return 'help';
  return 'warning';
}

function NoPlanYet({ projectId, name }: { readonly projectId: string; readonly name: string }) {
  return (
    <div className="min-h-screen bg-background">
      <PublicHeader />
      <main id="main" className="mx-auto flex max-w-content flex-col gap-lg px-md py-xl">
        <h1 className="font-sans text-headline-lg text-on-surface">{name}</h1>
        <section className="flex flex-col gap-md rounded-lg border border-outline-variant bg-surface-container-low p-lg">
          <h2 className="font-sans text-headline-sm text-on-surface">Nothing to cost yet</h2>
          <p className="font-sans text-body-sm text-on-surface-variant">
            The budget is derived from the work, and the work from the plan. Build the plan first.
          </p>
          <Link
            href={`/plan/${projectId}`}
            className="mt-sm inline-flex min-h-11 w-fit items-center gap-sm rounded bg-primary px-lg font-sans text-body-sm font-medium text-on-primary transition-colors hover:bg-primary-fixed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Go to the plan
            <MaterialIcon name="arrow_forward" size={18} />
          </Link>
        </section>
      </main>
    </div>
  );
}

/** The project's base currency, defaulting to GBP where none was recorded. */
function currencyOf(intake: readonly IntakeField[]): CurrencyCode {
  const field = intake.find((f) => f.fieldId === 'budget.currency');
  const value = field?.value;
  return typeof value === 'string' && isCurrency(value) ? value : 'GBP';
}

/** An answered numeric intake field. Never reads a value from an unanswered one. */
function numberAnswer(intake: readonly IntakeField[], fieldId: string): number | undefined {
  const field = intake.find((f) => f.fieldId === fieldId);
  if (field === undefined) return undefined;
  if (field.state !== 'CONFIRMED' && field.state !== 'PROVIDED' && field.state !== 'ASSUMED') {
    return undefined;
  }
  return typeof field.value === 'number' ? field.value : undefined;
}
