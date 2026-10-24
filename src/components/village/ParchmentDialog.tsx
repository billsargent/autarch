"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

interface ParchmentDialogProps {
  title: ReactNode;
  // Small heading above the title, e.g. the room name.
  kicker?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  // Fill the height, with no padding or scrolling of its own: for content that
  // lays out its own scrolling areas (the chat).
  tall?: boolean;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// A modal in the village style. Focus moves into it and stays there (Tab
// wraps), Esc closes it, and focus returns to whatever opened it.
export default function ParchmentDialog({ title, kicker, onClose, children, footer, wide, tall }: ParchmentDialogProps) {
  const titleId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const box = boxRef.current;
    const first = box?.querySelector<HTMLElement>("[data-autofocus]") ?? box?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
      } else if (e.key === "Tab" && box) {
        const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)];
        if (!items.length) return;
        const firstItem = items[0];
        const lastItem = items[items.length - 1];
        if (e.shiftKey && document.activeElement === firstItem) {
          e.preventDefault();
          lastItem.focus();
        } else if (!e.shiftKey && document.activeElement === lastItem) {
          e.preventDefault();
          firstItem.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      opener?.focus?.();
    };
  }, []);

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/50 p-3 sm:p-6"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`village-panel flex max-h-full w-full flex-col overflow-hidden rounded-lg border-4 border-[#3b2716] bg-[#f4ead5] text-[#3b2716] shadow-2xl ${
          tall ? "h-full max-w-5xl" : wide ? "max-w-3xl" : "max-w-lg"
        }`}
      >
        <div className="flex items-center gap-3 border-b-4 border-[#3b2716] bg-[#6b4a2e] px-4 py-2 text-[#f4ead5]">
          <div className="min-w-0 flex-1">
            {kicker && <p className="village-pixel text-[10px] uppercase tracking-wider text-[#e9d6ae]">{kicker}</p>}
            <h2 id={titleId} className="village-pixel truncate text-sm">
              {title}
            </h2>
          </div>
          <button onClick={onClose} className="village-btn px-2 py-1 text-xs" aria-label="Close">
            ✕
          </button>
        </div>
        <div className={tall ? "flex min-h-0 flex-1 flex-col" : "min-h-0 flex-1 overflow-y-auto p-4"}>{children}</div>
        {footer && <div className="flex flex-wrap items-center gap-2 border-t-2 border-[#d8c49a] bg-[#ead9b4] px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

// "Are you sure?" for irreversible actions.
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ParchmentDialog
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button onClick={onConfirm} className="village-btn village-btn-danger px-4 py-2 text-xs">
            {confirmLabel}
          </button>
          <button onClick={onCancel} data-autofocus className="village-btn ml-auto px-3 py-2 text-xs">
            Keep it
          </button>
        </>
      }
    >
      <p className="text-sm">{message}</p>
    </ParchmentDialog>
  );
}
