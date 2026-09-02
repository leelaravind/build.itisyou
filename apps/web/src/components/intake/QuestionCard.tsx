import type { FieldDefinition } from '@govintel/intake/fields';
import type { IntakeField } from '@govintel/intake/schema';
import { MaterialIcon } from '../ui/MaterialIcon.tsx';
import { answerQuestion } from '../../app/intake/[projectId]/actions.ts';

/**
 * One intake question, with all five answer modes.
 *
 * Contract: gap-spec §9.2 — every question must support a confirmed answer, "I don't know",
 * "unsure", "use recommended default", and "defer to external research".
 *
 * **The alternative answers are buttons, not a dropdown.** A dropdown makes "I don't know" a thing
 * you have to go looking for, which pushes people towards guessing — and a guess recorded as a
 * provided answer is worse than an honest unknown, because the engine will plan against it and the
 * external-AI prompt will never ask about it. The whole product depends on people flagging what
 * they do not know, so the affordance to do that is as prominent as the answer field.
 *
 * Rendered as a plain server-side form with no client JavaScript. The intake flow must work for a
 * guest on any device, and a wizard that needs a hydrated bundle to record an answer is a wizard
 * that fails on a slow connection at exactly the wrong moment.
 */

interface QuestionCardProps {
  readonly projectId: string;
  readonly definition: FieldDefinition;
  /**
   * `| undefined` is explicit because `exactOptionalPropertyTypes` distinguishes "absent" from
   * "present and undefined", and the caller genuinely passes the latter for an unanswered question.
   */
  readonly existing?: IntakeField | undefined;
}

export function QuestionCard({ projectId, definition, existing }: QuestionCardProps) {
  const hasDefault = definition.recommendedDefault !== undefined;

  return (
    <section
      className="flex flex-col gap-md rounded-lg border border-outline-variant bg-surface-container-low p-lg"
      aria-labelledby={`q-${definition.id}`}
    >
      <div className="flex items-start justify-between gap-md">
        <div className="min-w-0">
          <h2 id={`q-${definition.id}`} className="font-sans text-headline-sm text-on-surface">
            {definition.label}
          </h2>
          {/* The rationale is shown, not hidden behind a tooltip. A question with no visible
              purpose reads as bureaucracy, and people answer bureaucracy carelessly. */}
          <p className="mt-xs font-sans text-body-sm text-on-surface-variant">
            {definition.rationale}
          </p>
        </div>

        <span
          className={`shrink-0 rounded-sm border px-xs py-0 font-mono text-data-mono-sm uppercase ${
            definition.importance === 'CRITICAL'
              ? 'border-danger/30 bg-danger/10 text-danger'
              : definition.importance === 'RECOMMENDED'
                ? 'border-warning/30 bg-warning/10 text-warning'
                : 'border-outline-variant bg-surface-container-high text-on-surface-variant'
          }`}
        >
          {definition.importance}
        </span>
      </div>

      <form action={answerQuestion} className="flex flex-col gap-md">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="fieldId" value={definition.id} />

        <AnswerInput definition={definition} existing={existing} />

        <div className="flex flex-wrap items-center gap-sm">
          <button
            type="submit"
            name="mode"
            value="ANSWER"
            className="inline-flex items-center gap-sm rounded bg-primary px-lg py-sm font-sans text-body-sm font-medium text-on-primary transition-colors hover:bg-primary-fixed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Save answer
            <MaterialIcon name="arrow_forward" size={16} />
          </button>

          <button
            type="submit"
            name="mode"
            value="UNSURE"
            className="rounded border border-outline-variant px-md py-sm font-sans text-body-sm text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Save, but I’m not sure
          </button>
        </div>

        <div className="flex flex-col gap-sm border-t border-outline-variant pt-md">
          <p className="font-sans text-label-caps tracking-wider text-on-surface-variant uppercase">
            Or, if you don’t know
          </p>

          <div className="flex flex-wrap gap-sm">
            <button
              type="submit"
              name="mode"
              value="I_DONT_KNOW"
              formNoValidate
              className="inline-flex items-center gap-sm rounded border border-outline-variant px-md py-sm font-sans text-body-sm text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <MaterialIcon name="help" size={16} />I don’t know
            </button>

            <button
              type="submit"
              name="mode"
              value="DEFER_TO_EXTERNAL_RESEARCH"
              formNoValidate
              className="inline-flex items-center gap-sm rounded border border-outline-variant px-md py-sm font-sans text-body-sm text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <MaterialIcon name="travel_explore" size={16} />
              Research this for me
            </button>

            {hasDefault ? (
              <button
                type="submit"
                name="mode"
                value="USE_RECOMMENDED_DEFAULT"
                formNoValidate
                className="inline-flex items-center gap-sm rounded border border-outline-variant px-md py-sm font-sans text-body-sm text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <MaterialIcon name="wand_stars" size={16} />
                Use the recommended default
                <span className="font-mono text-data-mono-sm text-on-surface">
                  ({displayValue(definition.recommendedDefault)})
                </span>
              </button>
            ) : null}
          </div>

          {/* `formNoValidate` above is deliberate: "I don't know" must work on a required field.
              Requiring a value before letting someone say they have none would be absurd, and is a
              real reason people abandon forms. */}
          <p className="font-sans text-body-sm text-on-surface-variant">
            Anything you flag here goes into the research request the platform writes for you. It is
            recorded as an open question, never as a guess.
          </p>
        </div>
      </form>
    </section>
  );
}

function AnswerInput({
  definition,
  existing,
}: {
  readonly definition: FieldDefinition;
  /**
   * `| undefined` is explicit because `exactOptionalPropertyTypes` distinguishes "absent" from
   * "present and undefined", and the caller genuinely passes the latter for an unanswered question.
   */
  readonly existing?: IntakeField | undefined;
}) {
  const current = existing?.value;
  const baseClass =
    'w-full rounded border border-outline-variant bg-surface-container p-md font-sans text-body-md text-on-surface placeholder:text-on-surface-variant/60 focus:border-primary focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

  switch (definition.kind) {
    case 'longText':
      return (
        <textarea
          id={definition.id}
          name="value"
          rows={4}
          maxLength={2000}
          defaultValue={typeof current === 'string' ? current : ''}
          {...(definition.placeholder === undefined ? {} : { placeholder: definition.placeholder })}
          aria-label={definition.label}
          className={baseClass}
        />
      );

    case 'select':
      return (
        <select
          id={definition.id}
          name="value"
          defaultValue={typeof current === 'string' ? current : ''}
          aria-label={definition.label}
          className={baseClass}
        >
          <option value="">Choose…</option>
          {(definition.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );

    case 'multiSelect':
      return (
        <fieldset className="flex flex-col gap-sm">
          <legend className="sr-only">{definition.label}</legend>
          {(definition.options ?? []).map((option) => (
            // The whole label is the target, and it is at least 44px tall. A bare 16px checkbox
            // fails WCAG 2.2 2.5.8 and is genuinely hard to hit on a phone.
            <label
              key={option}
              className="flex min-h-11 cursor-pointer items-center gap-sm rounded px-xs font-sans text-body-sm text-on-surface hover:bg-surface-container"
            >
              <input
                type="checkbox"
                name="value"
                value={option}
                defaultChecked={Array.isArray(current) && current.includes(option)}
                className="size-5 rounded-sm border-outline-variant bg-surface-container accent-primary"
              />
              {option}
            </label>
          ))}
        </fieldset>
      );

    case 'boolean':
      return (
        <fieldset className="flex gap-md">
          <legend className="sr-only">{definition.label}</legend>
          {[
            { label: 'Yes', value: 'true' },
            { label: 'No', value: 'false' },
          ].map((option) => (
            <label
              key={option.value}
              className="flex min-h-11 cursor-pointer items-center gap-sm rounded px-xs font-sans text-body-sm text-on-surface hover:bg-surface-container"
            >
              <input
                type="radio"
                name="value"
                value={option.value}
                defaultChecked={displayValue(current) === option.value}
                className="size-5 border-outline-variant bg-surface-container accent-primary"
              />
              {option.label}
            </label>
          ))}
        </fieldset>
      );

    // Named rather than `default:`, so adding a field kind to the catalogue produces a compile
    // error here instead of silently falling through to a text input.
    case 'text':
    case 'number':
    case 'currency':
    case 'date':
      return (
        <input
          id={definition.id}
          name="value"
          type={
            definition.kind === 'number' || definition.kind === 'currency'
              ? 'number'
              : definition.kind === 'date'
                ? 'date'
                : 'text'
          }
          defaultValue={displayValue(current)}
          {...(definition.placeholder === undefined ? {} : { placeholder: definition.placeholder })}
          aria-label={definition.label}
          className={baseClass}
        />
      );
  }
}

/**
 * Render an `unknown` value for display.
 *
 * Values arrive from a `jsonb` column, so their type is genuinely unknown at compile time.
 * `String()` on an object yields "[object Object]", which would show the user a placeholder that
 * looks like a bug — so objects are serialised and everything else stringified.
 */
function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' || typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return value;
  return '';
}
