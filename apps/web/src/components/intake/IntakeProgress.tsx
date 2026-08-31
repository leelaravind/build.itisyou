import { MaterialIcon } from '../ui/MaterialIcon.tsx';

/**
 * Intake progress.
 *
 * The bar is weighted by question importance, not a raw count, so it cannot read 40% while every
 * critical question is outstanding. It also counts a resolved "I don't know" as progress: scoring an
 * honest unknown as zero would mean the bar never fills for the user being most candid, which is
 * precisely the behaviour the product wants to encourage.
 */
interface IntakeProgressProps {
  readonly percent: number;
  readonly answered: number;
  readonly total: number;
  readonly canGenerate: boolean;
  readonly criticalOutstanding: number;
}

export function IntakeProgress({
  percent,
  answered,
  total,
  canGenerate,
  criticalOutstanding,
}: IntakeProgressProps) {
  return (
    <div className="flex flex-col gap-sm rounded-lg border border-outline-variant bg-surface-container-low p-md">
      <div className="flex items-baseline justify-between gap-md">
        <p className="font-sans text-label-caps tracking-wider text-on-surface-variant uppercase">
          Intake progress
        </p>
        <p className="font-mono text-data-mono-sm text-on-surface">
          {answered} of {total} answered
        </p>
      </div>

      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Intake completion"
        className="h-2 w-full overflow-hidden rounded-full bg-surface-container-high"
      >
        <div
          className={`h-full transition-all ${canGenerate ? 'bg-tertiary' : 'bg-primary'}`}
          style={{ width: `${String(percent)}%` }}
        />
      </div>

      <p className="flex items-center gap-sm font-sans text-body-sm text-on-surface-variant">
        <MaterialIcon
          name={canGenerate ? 'check_circle' : 'pending'}
          size={16}
          className={canGenerate ? 'text-tertiary' : 'text-primary'}
        />
        {canGenerate
          ? 'Enough to generate a plan. Answering more improves it.'
          : `${String(criticalOutstanding)} critical ${
              criticalOutstanding === 1 ? 'question' : 'questions'
            } still to look at.`}
      </p>
    </div>
  );
}
