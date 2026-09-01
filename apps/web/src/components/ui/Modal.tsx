'use client';

import { useEffect, useRef } from 'react';
import { cn } from './cn.ts';
import { MaterialIcon } from './MaterialIcon.tsx';

/**
 * Modal dialog.
 *
 * **Designed net-new (KI-008)** — no Stitch export contains a modal, so the visual treatment is
 * derived from the design system: `shadow-overlay` (the exact value DESIGN.md gives for modals)
 * paired with a strong border, over a 20% black backdrop, exactly as DESIGN.md's elevation section
 * prescribes.
 *
 * Built on the native `<dialog>` element rather than a div-with-role. `showModal()` gives focus
 * trapping, inertness of background content, Escape-to-close and top-layer stacking from the
 * platform. Hand-rolled focus traps are a well-known source of accessibility defects, and plan
 * section 25 requires "focus restoration after drawer/dialog close" — which the platform does
 * correctly and for free.
 */

interface ModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly description?: string;
  readonly children?: React.ReactNode;
  readonly footer?: React.ReactNode;
  /**
   * Require an explicit choice: no Escape, no backdrop dismissal.
   * For destructive or irreversible confirmations only — accidental dismissal of those is worse
   * than the mild friction.
   */
  readonly dismissible?: boolean;
  readonly size?: 'sm' | 'md' | 'lg';
}

const SIZES = { sm: 'max-w-narrow', md: 'max-w-prose', lg: 'max-w-wide' } as const;

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  dismissible = true,
  size = 'md',
}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;

    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;

    // `cancel` fires on Escape. Preventing it is what makes a modal non-dismissible.
    const onCancel = (event: Event) => {
      if (dismissible) onClose();
      else event.preventDefault();
    };
    dialog.addEventListener('cancel', onCancel);
    return () => {
      dialog.removeEventListener('cancel', onCancel);
    };
  }, [dismissible, onClose]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="modal-title"
      {...(description === undefined ? {} : { 'aria-describedby': 'modal-description' })}
      onClick={(event) => {
        // Backdrop clicks land on the dialog element itself; clicks on content land on children.
        if (dismissible && event.target === ref.current) onClose();
      }}
      className={cn(
        'w-full rounded-lg border border-outline bg-surface-container-high p-0 text-on-surface shadow-overlay',
        'backdrop:bg-black/20',
        SIZES[size],
      )}
    >
      <div className="flex items-start gap-md border-b border-outline-variant p-lg">
        <div className="min-w-0 flex-1">
          <h2 id="modal-title" className="font-sans text-headline-sm text-on-surface">
            {title}
          </h2>
          {description === undefined ? null : (
            <p
              id="modal-description"
              className="mt-xs font-sans text-body-sm text-on-surface-variant"
            >
              {description}
            </p>
          )}
        </div>

        {dismissible ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded p-xs text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <MaterialIcon name="close" size={20} />
          </button>
        ) : null}
      </div>

      {children === undefined ? null : <div className="p-lg">{children}</div>}

      {footer === undefined ? null : (
        <div className="flex justify-end gap-sm border-t border-outline-variant p-lg">{footer}</div>
      )}
    </dialog>
  );
}
