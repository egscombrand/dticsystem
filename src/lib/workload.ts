/**
 * Aturan workload anggota (murni, tanpa database). Dipakai halaman Workload Tim dan panel Kelola PIC.
 *
 * Definisi (dihitung dari relasi PIC order_assignments, satu baris per order per anggota):
 *  - Aktif       = Pengajuan Masuk (data lama), Siap Dikerjakan, Sedang Dikerjakan, Menunggu Konfirmasi.
 *  - Ditunda     = ditampilkan terpisah dan TIDAK ikut indikator beban aktif (pekerjaan sedang dihentikan).
 *  - Terlambat   = deadline lewat dan order belum Selesai/Dibatalkan (termasuk yang Ditunda),
 *                  sama dengan aturan "Terlambat" di seluruh aplikasi.
 *  - Selesai & Dibatalkan tidak dihitung.
 * Satu order dengan beberapa PIC muncul di workload SETIAP PIC-nya, sehingga jumlah per anggota
 * bukan jumlah order unik tim.
 *
 * Indikator beban (rendah/sedang/tinggi) bersifat KOMPARATIF terhadap anggota lain yang ditampilkan,
 * bukan ambang kapasitas: belum ada batas kapasitas yang dikonfigurasi di sistem.
 * Rekomendasi hanya informasi untuk Manager; sistem tidak pernah memindahkan PIC.
 */

export const ACTIVE_LOAD_STATUSES = ["submitted", "assigned", "in_progress", "pending_confirmation"] as const;

export type MemberWorkload = {
  memberId: string;
  name: string;
  division: string;
  /** Nama tim anggota (bisa kosong untuk anggota tanpa tim yang masih memegang order lama). */
  teams: string[];
  active: number;
  inProgress: number;
  pendingConfirmation: number;
  onHold: number;
  overdue: number;
  /** Deadline terdekat dari order aktif/ditunda (ISO), null bila tidak ada. */
  nearestDeadline: string | null;
};

export type LoadLevel = "low" | "medium" | "high" | "even";

export const LOAD_LABEL: Record<LoadLevel, string> = {
  low: "Relatif ringan",
  medium: "Sedang",
  high: "Relatif berat",
  even: "Setara",
};

/**
 * Tingkat beban relatif berdasarkan jumlah order aktif dibanding anggota lain dalam daftar yang sama.
 * Rentang (min–maks) dibagi tiga; bila semua sama, semuanya "Setara".
 */
export function loadLevels(rows: Pick<MemberWorkload, "memberId" | "active">[]): Record<string, LoadLevel> {
  const out: Record<string, LoadLevel> = {};
  if (rows.length === 0) return out;
  const values = rows.map((r) => r.active);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  for (const r of rows) {
    if (span === 0) out[r.memberId] = "even";
    else if (r.active - min <= span / 3) out[r.memberId] = "low";
    else if (max - r.active <= span / 3) out[r.memberId] = "high";
    else out[r.memberId] = "medium";
  }
  return out;
}

export type Recommendation =
  | { kind: "none"; message: string }
  | { kind: "even"; message: string }
  | { kind: "suggest"; memberIds: string[]; reasons: Record<string, string> };

/**
 * Rekomendasi kandidat dengan beban relatif lebih ringan: urut berdasarkan order aktif, lalu order
 * terlambat. Yang direkomendasikan = kandidat dengan pasangan (aktif, terlambat) terkecil, hanya bila
 * ada perbedaan nyata antar kandidat. Tidak memperhitungkan jam kerja, tingkat kesulitan, atau estimasi
 * durasi karena data tersebut tidak tersedia.
 */
export function recommendCandidates(rows: MemberWorkload[]): Recommendation {
  if (rows.length === 0) return { kind: "none", message: "Belum ada anggota tim untuk direkomendasikan." };
  if (rows.length === 1) return { kind: "none", message: "Hanya ada satu anggota tim aktif." };
  const key = (r: MemberWorkload) => [r.active, r.overdue] as const;
  const best = rows.reduce((a, b) => {
    const [aa, ao] = key(a);
    const [ba, bo] = key(b);
    return ba < aa || (ba === aa && bo < ao) ? b : a;
  });
  const [bestActive, bestOverdue] = key(best);
  const winners = rows.filter((r) => r.active === bestActive && r.overdue === bestOverdue);
  if (winners.length === rows.length) {
    return { kind: "even", message: "Beban kerja anggota tim saat ini setara; tidak ada rekomendasi khusus." };
  }
  const maxActive = Math.max(...rows.map((r) => r.active));
  const reasons: Record<string, string> = {};
  for (const w of winners) {
    const parts = [`${w.active} order aktif`];
    if (w.active < maxActive) parts.push(`lebih sedikit dari anggota lain (maks. ${maxActive})`);
    parts.push(w.overdue === 0 ? "tidak ada order terlambat" : `${w.overdue} order terlambat`);
    reasons[w.memberId] = `Beban relatif lebih ringan: ${parts.join(", ")}.`;
  }
  return { kind: "suggest", memberIds: winners.map((w) => w.memberId), reasons };
}
