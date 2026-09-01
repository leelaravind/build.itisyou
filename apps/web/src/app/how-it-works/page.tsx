import Link from 'next/link';
import { PublicHeader } from '../../components/shell/PublicHeader.tsx';
import { MaterialIcon } from '../../components/ui/MaterialIcon.tsx';

export const metadata = { title: 'How it works' };

/**
 * How it works.
 *
 * Exists because the landing page links to it, and a primary call to action that 404s is a broken
 * navigation defect the pre-live checklist (gap-spec §66) would reject.
 *
 * The content describes the flow as actually implemented. No capability is claimed here that does
 * not exist — a marketing page that overstates the product is the same honesty failure as a stat
 * tile that overstates a number.
 */
const STEPS = [
  {
    icon: 'edit_note',
    title: 'Describe the idea',
    body: 'A sentence is enough. No account, no setup.',
  },
  {
    icon: 'help',
    title: 'Answer what you know',
    body: 'Every question takes “I don’t know” as an answer. The engine records it as an open question rather than guessing on your behalf.',
  },
  {
    icon: 'content_copy',
    title: 'Take the research request to any AI',
    body: 'The platform writes a structured prompt covering exactly what you flagged. Paste it into whichever assistant you already use — there is no AI subscription here to buy.',
  },
  {
    icon: 'rule',
    title: 'Paste the reply back',
    body: 'It is checked against what you already confirmed before anything is created. Contradictions are surfaced, not silently applied.',
  },
  {
    icon: 'account_tree',
    title: 'Get a plan that shows its reasoning',
    body: 'Work breakdown, dependencies, budget, risks and quality gates — each traceable to the rule or input that produced it.',
  },
] as const;

export default function HowItWorksPage() {
  return (
    <div className="min-h-screen bg-background">
      <PublicHeader />

      <main id="main" className="mx-auto flex max-w-content flex-col gap-lg px-md py-3xl">
        <h1 className="font-sans text-headline-lg text-on-surface">How it works</h1>
        <p className="font-sans text-body-lg text-on-surface-variant">
          The engine is deterministic: the same inputs and the same ruleset produce the same plan,
          every time, and it can always tell you which rule produced which task.
        </p>

        <ol className="flex flex-col gap-md">
          {STEPS.map((step, index) => (
            <li
              key={step.title}
              className="flex gap-md rounded-lg border border-outline-variant bg-surface-container-low p-lg"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded border border-outline-variant bg-surface-container">
                <MaterialIcon name={step.icon} size={20} className="text-primary" />
              </span>
              <div>
                <p className="font-mono text-data-mono-sm text-on-surface-variant">
                  {String(index + 1).padStart(2, '0')}
                </p>
                <h2 className="mt-xs font-sans text-headline-sm text-on-surface">{step.title}</h2>
                <p className="mt-xs font-sans text-body-sm text-on-surface-variant">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <Link
          href="/start"
          className="inline-flex w-fit items-center gap-sm rounded bg-primary px-lg py-md font-sans text-body-sm font-medium text-on-primary transition-colors hover:bg-primary-fixed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          Start a project
          <MaterialIcon name="arrow_forward" size={18} />
        </Link>
      </main>
    </div>
  );
}
