"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/** Dialog modal berbasis <dialog> native (focus trap & Esc bawaan browser). */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  dismissible = true,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  dismissible?: boolean;
  /** "wide" untuk form bertahap yang padat (±1000px di desktop). */
  size?: "md" | "wide";
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissible) onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current && dismissible) onClose();
      }}
      aria-labelledby="modal-title"
      className={cn(
        "m-auto max-h-[90vh] overflow-hidden rounded-xl border border-line bg-surface p-0 text-ink shadow-pop",
        size === "wide" ? "w-[calc(100%-1.5rem)] max-w-[1000px] sm:w-[calc(100%-3rem)]" : "w-[calc(100%-2rem)] max-w-md",
      )}
    >
      {open && (
        // Header & footer tetap terlihat; hanya isi yang bergulir bila melebihi tinggi layar.
        <div className="flex max-h-[90vh] flex-col">
          <div className={cn("flex shrink-0 items-start justify-between gap-4 px-5 pt-5", size === "wide" && "border-b border-line pb-4 sm:px-7 sm:pt-6")}>
            <div>
              <h2 id="modal-title" className={size === "wide" ? "text-lg font-semibold sm:text-xl" : "text-base font-semibold"}>
                {title}
              </h2>
              {description && <div className="mt-1 text-sm text-ink-2">{description}</div>}
            </div>
            {dismissible && (
              <button type="button" onClick={onClose} className="rounded-md p-1 text-ink-3 hover:bg-subtle hover:text-ink" aria-label="Tutup">
                <X className="size-4" />
              </button>
            )}
          </div>
          {children && <div className={cn("min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-5", size === "wide" && "sm:px-7 sm:pt-5")}>{children}</div>}
          {footer && <div className={cn("flex shrink-0 justify-end gap-2 border-t border-line bg-subtle px-5 py-3", size === "wide" && "sm:px-7")}>{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
