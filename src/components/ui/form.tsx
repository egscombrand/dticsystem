import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/components/ui/cn";

const control =
  "block w-full rounded-lg border bg-surface px-3 text-sm text-ink placeholder:text-[#9aa1ad] transition-colors " +
  "focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/15 disabled:cursor-not-allowed disabled:bg-subtle disabled:text-ink-3";

const okBorder = "border-line-strong hover:border-[#bfc5cd]";
const errBorder = "border-bad focus:border-bad focus:ring-bad/15";

export function Field({
  label,
  htmlFor,
  required,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink">
        {label}
        {required ? <span className="ml-0.5 text-bad" aria-hidden="true">*</span> : <span className="ml-1 font-normal text-ink-3">(opsional)</span>}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-[12.5px] text-bad">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-[12.5px] text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type Invalid = { invalid?: boolean };

function a11y(id: string | undefined, invalid?: boolean) {
  return invalid && id ? { "aria-invalid": true as const, "aria-describedby": `${id}-error` } : {};
}

export function Input({ invalid, className, ...rest }: ComponentProps<"input"> & Invalid) {
  return <input className={cn(control, "h-10", invalid ? errBorder : okBorder, className)} {...a11y(rest.id, invalid)} {...rest} />;
}

export function Select({ invalid, className, children, ...rest }: ComponentProps<"select"> & Invalid) {
  return (
    <select className={cn(control, "h-10 pr-8", invalid ? errBorder : okBorder, className)} {...a11y(rest.id, invalid)} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ invalid, className, ...rest }: ComponentProps<"textarea"> & Invalid) {
  return <textarea className={cn(control, "min-h-24 py-2.5 leading-relaxed", invalid ? errBorder : okBorder, className)} {...a11y(rest.id, invalid)} {...rest} />;
}
