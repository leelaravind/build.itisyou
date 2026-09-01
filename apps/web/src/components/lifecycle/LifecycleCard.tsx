import { LIFECYCLE_STATES, type LifecycleState } from '@govintel/governance/lifecycle';
import type { TransitionVerdict } from '@govintel/governance/lifecycle';
import { MaterialIcon } from '../ui/MaterialIcon.tsx';
import { transitionProject } from '../../app/plan/[projectId]/lifecycle-actions.ts';

/**
 * Where the project is, and what it would take to move it on.
 *
 * The first surface in the product that can change `lifecycle_state`, which until now nothing could.
 *
 * ## Why blocked steps are shown rather than hidden
 *
 * The obvious design is to show the button when the move is allowed and nothing when it is not. That
 * produces a screen where a stuck project looks identical to a finished one, and the question this
 * product exists to answer — *why can we not advance* — has no surface at all.
 *
 * So a blocked step is shown, disabled, with the gates that are blocking it named. The refusal is the
 * content, not an error state.
 */

interface Option {
  readonly to: LifecycleState;
  readonly why: string;
  readonly verdict: TransitionVerdict;
}

export function LifecycleCard({
  projectId,
  current,
  options,
}: {
  readonly projectId: string;
  readonly current: LifecycleState;
  readonly options: readonly Option[];
}) {
  const position = LIFECYCLE_STATES.indexOf(current);

  return (
    <section
      aria-labelledby="lifecycle-heading"
      className="flex flex-col gap-md rounded-lg border border-outline-variant bg-surface-container-low p-lg"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-sm">
        <h2 id="lifecycle-heading" className="font-sans text-headline-sm text-on-surface">
          Where this project is
        </h2>
        <p className="font-sans text-label-caps tracking-wider text-on-surface-variant uppercase">
          Stage {position + 1} of {LIFECYCLE_STATES.length}
        </p>
      </div>

      {/*
        The whole path, not just the current step.
        A stage means little on its own — "verifying" is only informative next to what came before it
        and what is still ahead. Rendered as an ordered list so it reads correctly without CSS and to
        a screen reader, which a row of styled divs would not.
      */}
      <ol className="flex flex-wrap items-center gap-x-xs gap-y-sm">
        {LIFECYCLE_STATES.map((state, index) => {
          const done = index < position;
          const here = index === position;

          return (
            <li key={state} className="flex items-center gap-x-xs">
              <span
                aria-current={here ? 'step' : undefined}
                className={[
                  'rounded-full px-sm py-[2px] font-sans text-body-sm',
                  here
                    ? 'bg-primary text-on-primary'
                    : done
                      ? 'bg-surface-container-high text-on-surface-variant'
                      : 'text-on-surface-variant/60',
                ].join(' ')}
              >
                {humanise(state)}
              </span>
              {index < LIFECYCLE_STATES.length - 1 ? (
                <span aria-hidden className="text-on-surface-variant/30">
                  ·
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>

      {options.length === 0 ? (
        <p className="font-sans text-body-sm text-on-surface-variant">
          This project has reached the end of its lifecycle. There is nothing further to move it to.
        </p>
      ) : (
        <ul className="flex flex-col gap-md">
          {options.map((option) => (
            <li
              key={option.to}
              className="flex flex-col gap-sm rounded border border-outline-variant bg-surface p-md"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-sm">
                <h3 className="font-sans text-title-sm text-on-surface">
                  Move to {humanise(option.to)}
                </h3>
                {option.verdict.allowed ? (
                  <span className="flex items-center gap-xs font-sans text-body-sm text-success">
                    <MaterialIcon name="check_circle" size={16} />
                    Ready
                  </span>
                ) : (
                  <span className="flex items-center gap-xs font-sans text-body-sm text-on-surface-variant">
                    <MaterialIcon name="lock" size={16} />
                    Not yet
                  </span>
                )}
              </div>

              <p className="font-sans text-body-sm text-on-surface-variant">{option.why}</p>

              {option.verdict.allowed ? (
                <form action={transitionProject}>
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="to" value={option.to} />
                  <button
                    type="submit"
                    className="inline-flex w-fit items-center gap-xs rounded bg-primary px-md py-sm font-sans text-label-lg text-on-primary hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    Move to {humanise(option.to)}
                    <MaterialIcon name="arrow_forward" size={18} />
                  </button>
                </form>
              ) : (
                <div className="flex flex-col gap-xs rounded bg-surface-container-high p-sm">
                  <p className="font-sans text-body-sm text-on-surface">
                    {option.verdict.explanation}
                  </p>
                  {option.verdict.blocking.length === 0 ? null : (
                    <ul className="flex flex-wrap gap-xs">
                      {option.verdict.blocking.map((item) => (
                        <li
                          key={item}
                          className="rounded-full border border-outline-variant px-sm py-[2px] font-sans text-body-sm text-on-surface-variant"
                        >
                          {humanise(item)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** `RELEASE_READY` → `Release ready`. Sentence case, because these appear inside sentences. */
function humanise(value: string): string {
  const words = value.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
