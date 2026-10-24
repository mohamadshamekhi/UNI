"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { errorMessage } from "../api";
import { Button } from "./button";
import { Field, Textarea } from "./field";

/**
 * Modal on top of the native <dialog>: focus is trapped and restored by the browser, Esc closes.
 */
export function Dialog({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={`m-auto w-[calc(100%-2rem)] rounded-2xl border border-border bg-card p-0 text-foreground shadow-[0_30px_80px_-20px_rgb(2_6_23/0.5)] ${wide ? "max-w-2xl" : "max-w-md"}`}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <header className="flex items-center justify-between gap-2 border-b border-border px-5 py-4">
            <h2 id={titleId} className="font-semibold">
              {title}
            </h2>
            <button type="button" onClick={onClose} aria-label="بستن" className="cursor-pointer rounded p-1.5 text-muted-foreground hover:bg-muted">
              <X aria-hidden className="size-4" />
            </button>
          </header>
          <div className="overflow-y-auto px-5 py-5">{children}</div>
          {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-border bg-muted/40 px-5 py-3.5">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

/** Form dialog: submit handler errors are shown inline instead of closing. */
export function FormDialog({
  open,
  onClose,
  title,
  submitLabel,
  danger,
  onSubmit,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  submitLabel: string;
  danger?: boolean;
  onSubmit: () => Promise<unknown>;
  children: ReactNode;
  wide?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formId = useId();
  // reset when (re)opened — adjusting state on prop change, without an effect
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setError(null);
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await onSubmit();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      wide={wide}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            انصراف
          </Button>
          <Button type="submit" form={formId} variant={danger ? "danger" : "primary"} loading={pending}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-4">
        {children}
        {error && (
          <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}

/** Destructive or sensitive action: confirmation with a mandatory reason (UX-12). */
export function ReasonDialog({
  open,
  onClose,
  title,
  description,
  submitLabel,
  danger = true,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  submitLabel: string;
  danger?: boolean;
  onConfirm: (reason: string) => Promise<unknown>;
}) {
  const [reason, setReason] = useState("");
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setReason("");
  }
  return (
    <FormDialog open={open} onClose={onClose} title={title} submitLabel={submitLabel} danger={danger} onSubmit={() => onConfirm(reason.trim())}>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
      <Field label="دلیل" required hint="در تاریخچه و ممیزی ثبت می‌شود.">
        {(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />}
      </Field>
    </FormDialog>
  );
}
