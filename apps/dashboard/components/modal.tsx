'use client';

import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

/** sm 28rem, md 36rem, lg 48rem; xl 90vw by 88vh, full 90vw by 90vh. All of them leave a margin on a small screen. */
const SIZES: Record<ModalSize, string> = {
  sm: 'w-[28rem] max-h-[90vh]',
  md: 'w-[36rem] max-h-[90vh]',
  lg: 'w-[48rem] max-h-[90vh]',
  xl: 'w-[90vw] h-[88vh]',
  full: 'w-[90vw] h-[90vh]',
};

export interface ModalProps {
  open: boolean;
  /** Called when the person closes it (✕, Esc, a click on the backdrop), after the "discard" question when `dirty`. */
  onClose: () => void;
  title: string;
  description?: string;
  size?: ModalSize;
  /** There is something to lose: closing asks "Discard your changes?" first. */
  dirty?: boolean;
  /** A bar under the content that stays in view. */
  footer?: ReactNode;
  children: ReactNode;
}

/**
 * The one modal of the dashboard, on the browser's own `<dialog>`: it traps the focus, sits above everything and closes on Esc without any
 * code of ours. The content is only mounted while it is open, so a form starts empty every time. Focus goes back to what opened it.
 */
export function Modal({ open, onClose, title, description, size = 'md', dirty = false, footer, children }: ModalProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  const requestClose = useCallback(() => {
    if (dirty && !window.confirm('Discard your changes?')) return;
    onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    const d = dialog.current;
    if (!d || !open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!d.open) d.showModal();
    document.documentElement.style.overflow = 'hidden'; // the page behind does not scroll
    return () => {
      document.documentElement.style.overflow = '';
      if (d.open) d.close();
      opener?.focus();
    };
  }, [open]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(e) => {
        e.preventDefault(); // Esc: ours to decide, because of the "discard" question
        requestClose();
      }}
      onClick={(e) => e.target === dialog.current && requestClose()} // the backdrop is part of the dialog's own box
      className={`modal m-auto max-w-[calc(100vw-2rem)] bg-transparent p-0 text-text backdrop:bg-black/50 ${SIZES[size]}`}
    >
      {open && (
        <div className="panel flex h-full max-h-[inherit] flex-col shadow-lg">
          <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <h2 id={titleId} className="text-lg font-semibold">
                {title}
              </h2>
              {description && (
                <p id={descriptionId} className="mt-1 text-sm text-muted">
                  {description}
                </p>
              )}
            </div>
            <button type="button" onClick={requestClose} aria-label="Close" className="-mr-1 shrink-0 rounded-md border border-border px-2 py-1 text-sm text-muted hover:text-text">
              ✕
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <footer className="border-t border-border px-5 py-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
