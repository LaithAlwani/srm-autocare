"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useModalTransition } from "@/lib/use-modal-transition";

// Reusable confirmation modal for destructive admin actions. Replaces
// window.confirm()/alert() so the dialog matches Midnight Precision and we
// can show inline loading + error states without leaving the page.
export function ConfirmModal({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  onConfirm,
  onClose,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "danger";
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { shown, handleClose } = useModalTransition(onClose);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) handleClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [submitting, handleClose]);

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      className={`fixed inset-0 z-50 bg-surface/80 backdrop-blur flex items-center justify-center p-4 transition-opacity duration-200 ${
        shown ? "opacity-100" : "opacity-0"
      }`}
      onClick={() => !submitting && handleClose()}
    >
      <div
        className={`gloss-card bg-surface-container w-full max-w-md transition-all duration-200 ${
          shown ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 p-6 border-b border-border">
          <div className="flex items-center gap-3">
            {variant === "danger" && (
              <span className="w-9 h-9 flex items-center justify-center bg-error/15 text-error border border-error/30 shrink-0">
                <AlertTriangle size={16} />
              </span>
            )}
            <h2 id="confirm-modal-title" className="text-headline-md uppercase">
              {title}
            </h2>
          </div>
          <button
            onClick={handleClose}
            disabled={submitting}
            className="text-foreground-muted hover:text-foreground disabled:opacity-40"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 text-body-md text-foreground-muted leading-relaxed">
          {message}
        </div>

        {error && (
          <div className="mx-6 mb-2 p-3 border border-error/30 bg-error/10 text-error text-body-md">
            {error}
          </div>
        )}

        <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end p-6 border-t border-border">
          <Button variant="ghost" size="md" onClick={handleClose} disabled={submitting}>
            {cancelLabel}
          </Button>
          <Button
            variant={variant === "danger" ? "danger" : "primary"}
            size="md"
            onClick={handleConfirm}
            disabled={submitting}
          >
            {submitting ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Working...
              </>
            ) : (
              confirmLabel
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
