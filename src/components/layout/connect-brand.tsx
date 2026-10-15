/** Identitas portal publik DTIC Connect (nama, tagline). */
export function ConnectBrand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex size-9 items-center justify-center rounded-lg bg-navy text-[13px] font-bold tracking-tight text-white" aria-hidden="true">
        DC
      </span>
      <span className="leading-tight">
        <span className="block text-[15px] font-semibold text-navy">DTIC Connect</span>
        <span className="block text-[11.5px] text-ink-3">One Portal for Creative &amp; IT Requests</span>
      </span>
    </div>
  );
}
