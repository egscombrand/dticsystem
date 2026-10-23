/** Identitas portal publik DTIC Connect (nama, tagline). */
export function ConnectBrand() {
  return (
    <div className="flex items-center gap-2 sm:gap-2.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-navy text-[12px] font-bold tracking-tight text-white sm:size-9 sm:text-[13px]" aria-hidden="true">
        DC
      </span>
      <span className="leading-tight">
        <span className="block text-[15px] font-semibold text-navy">DTIC Connect</span>
        <span className="hidden text-[11.5px] text-ink-3 sm:block">One Portal for Creative &amp; IT Requests</span>
      </span>
    </div>
  );
}
