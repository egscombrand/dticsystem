/** Grafik garis tren masuk vs selesai (SVG, tanpa dependency). Data dari database; kosong ditandai eksplisit. */
export type TrendPoint = { day: string; intake: number; completed: number };

const W = 640;
const H = 220;
const PAD = { top: 12, right: 12, bottom: 28, left: 36 };

export function TrendChart({ data, label }: { data: TrendPoint[]; label: string }) {
  const intakeTotal = data.reduce((a, d) => a + d.intake, 0);
  const doneTotal = data.reduce((a, d) => a + d.completed, 0);
  if (data.length === 0) return <p className="text-sm text-ink-3">Tidak ada rentang tanggal.</p>;
  const max = Math.max(1, ...data.flatMap((d) => [d.intake, d.completed]));
  const niceMax = Math.ceil(max / 4) * 4 || 4;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (data.length === 1 ? innerW / 2 : (i * innerW) / (data.length - 1));
  const y = (v: number) => PAD.top + innerH - (v / niceMax) * innerH;
  const line = (key: "intake" | "completed") => data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(" ");
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(niceMax * f));
  const labelEvery = Math.max(1, Math.ceil(data.length / 6));

  return (
    <figure className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${label}: ${intakeTotal} pekerjaan masuk, ${doneTotal} selesai`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="stroke-line" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" className="fill-ink-3" fontSize={11}>{t}</text>
          </g>
        ))}
        <path d={line("intake")} fill="none" className="stroke-accent" strokeWidth={2.25} strokeLinejoin="round" />
        <path d={line("completed")} fill="none" className="stroke-ok" strokeWidth={2.25} strokeLinejoin="round" strokeDasharray="5 4" />
        {data.map((d, i) => (
          <g key={d.day}>
            <circle cx={x(i)} cy={y(d.intake)} r={2.5} className="fill-accent"><title>{`${d.day}: ${d.intake} masuk`}</title></circle>
            <circle cx={x(i)} cy={y(d.completed)} r={2.5} className="fill-ok"><title>{`${d.day}: ${d.completed} selesai`}</title></circle>
            {i % labelEvery === 0 && (
              <text x={x(i)} y={H - 8} textAnchor="middle" className="fill-ink-3" fontSize={11}>{d.day.slice(5).split("-").reverse().join("/")}</text>
            )}
          </g>
        ))}
      </svg>
      <figcaption className="flex flex-wrap gap-4 text-xs text-ink-2">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 bg-accent" aria-hidden="true" /> Masuk ({intakeTotal})</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-ok" aria-hidden="true" /> Selesai ({doneTotal})</span>
      </figcaption>
    </figure>
  );
}
