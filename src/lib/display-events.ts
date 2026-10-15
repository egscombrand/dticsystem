/**
 * Deteksi event layar display (MURNI, diuji unit).
 * - Snapshot pertama hanya menjadi baseline: order lama TIDAK pernah dianggap baru atau berubah.
 * - Order baru = id yang belum ada di baseline.
 * - Perubahan status = id yang sama dengan status berbeda. Urutan daftar dan metadata lain bukan event.
 * - Setiap snapshot menggantikan baseline, sehingga event hanya keluar sekali walau polling berulang.
 */
export type DisplayEvent<T extends { id: string; status: string }> =
  | { kind: "new"; item: T }
  | { kind: "status"; item: T; from: string; to: string };

export function diffDisplay<T extends { id: string; status: string }>(
  prev: Map<string, string> | null,
  items: T[],
): { next: Map<string, string>; events: DisplayEvent<T>[] } {
  const next = new Map<string, string>();
  for (const it of items) next.set(it.id, it.status);
  if (prev === null) return { next, events: [] };

  const events: DisplayEvent<T>[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it.id)) continue; // tiap order hanya boleh menghasilkan satu event per snapshot
    seen.add(it.id);
    const before = prev.get(it.id);
    if (before === undefined) events.push({ kind: "new", item: it });
    else if (before !== it.status) events.push({ kind: "status", item: it, from: before, to: it.status });
  }
  return { next, events };
}

/** Penjaga respons usang: hanya respons dengan nomor urut lebih baru yang boleh diterapkan. */
export function isNewerResponse(lastApplied: number, candidate: number): boolean {
  return candidate > lastApplied;
}
