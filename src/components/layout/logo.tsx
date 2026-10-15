export function Logo({ name = "DTIC System", subtitle = "Department Creative IT", compact = false }: { name?: string; subtitle?: string; compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-[13px] font-bold tracking-tight text-white" aria-hidden="true">
        DT
      </span>
      {!compact && (
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-[15px] font-semibold text-ink">{name}</span>
          <span className="block truncate text-[11.5px] text-ink-3">{subtitle}</span>
        </span>
      )}
    </div>
  );
}
