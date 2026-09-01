'use client';

import { useState } from 'react';
import { MaterialIcon } from '../ui/MaterialIcon.tsx';

/**
 * A block of text with a copy button.
 *
 * The only client component in the guest flow, and it earns that: copying to the clipboard has no
 * server-side equivalent. Everything else in the intake journey is server-rendered forms so it works
 * without JavaScript — and this degrades honestly rather than breaking, because the text is present
 * in the DOM and selectable whether or not the button works.
 */
export function CopyBlock({ text }: { readonly text: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  const copy = () => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        setFailed(false);
        // Reset so the button does not sit on "Copied" indefinitely and mislead a second attempt.
        setTimeout(() => {
          setCopied(false);
        }, 3_000);
      })
      .catch(() => {
        // The clipboard API fails in insecure contexts and when permission is refused. Saying so is
        // more useful than a button that silently does nothing.
        setFailed(true);
      });
  };

  return (
    <div className="flex flex-col gap-sm">
      <div className="flex flex-wrap items-center gap-sm">
        <button
          type="button"
          onClick={copy}
          className="inline-flex min-h-11 items-center gap-sm rounded bg-primary px-lg font-sans text-body-sm font-medium text-on-primary transition-colors hover:bg-primary-fixed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <MaterialIcon name={copied ? 'check' : 'content_copy'} size={18} />
          {copied ? 'Copied' : 'Copy the request'}
        </button>

        {/* Announced, so a screen-reader user learns the copy succeeded rather than only seeing it. */}
        <span role="status" className="font-sans text-body-sm text-tertiary">
          {copied ? 'Request copied to the clipboard.' : ''}
        </span>

        {failed ? (
          <span role="alert" className="font-sans text-body-sm text-warning">
            Could not reach the clipboard. Select the text below and copy it manually.
          </span>
        ) : null}
      </div>

      {/* `tabIndex` makes the block reachable and scrollable by keyboard — a long scrollable region
          that cannot be focused is unusable without a mouse. */}
      <pre
        tabIndex={0}
        aria-label="Research request text"
        className="max-h-96 overflow-auto rounded-lg border border-outline-variant bg-surface-container-lowest p-md font-mono text-data-mono-sm whitespace-pre-wrap text-on-surface-variant focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {text}
      </pre>
    </div>
  );
}
