/**
 * Status file hasil, diturunkan dari peristiwa yang benar-benar tercatat (MURNI, diuji unit).
 * File tanpa rujukan = draf. Satu file dapat diajukan, disetujui, lalu dikirim; semua tahap disimpan sebagai riwayat.
 */
export type ResultStage = "draft" | "submitted" | "approved" | "delivered";
export const RESULT_STAGE_LABEL: Record<ResultStage, string> = {
  draft: "Draf",
  submitted: "Diajukan untuk QC",
  approved: "Disetujui Manager",
  delivered: "Sudah diserahkan ke pemohon",
};

type Ev = { kind: string; at: string; detail: Record<string, unknown> };
type FeedbackEv = { kind: string; at: string; needsRevision?: boolean | null };
type SubmissionEv = { kind: string; at: string };

/**
 * true bila hasil BENAR-BENAR sudah diajukan ke pemohon (ada 'delivery_recorded' SETELAH persetujuan
 * Manager TERAKHIR, atau tanpa Manager sama sekali — Jalur A). ACC Manager ('qc_approved') SENDIRIAN tidak
 * pernah cukup: order.status sudah berpindah ke 'awaiting_requester' begitu Manager ACC (lihat
 * applyWorkflowAction), tapi itu HANYA berarti giliran pemohon sudah dekat — pemohon belum tentu benar-benar
 * menerima apa pun untuk diperiksa sampai PIC menekan "Ajukan ke Pemohon" (record_delivery). Dipakai halaman
 * Riwayat Request publik supaya "Menunggu Masukan Anda" tidak tampil prematur.
 */
export function hasSubmittedToRequester(events: SubmissionEv[]): boolean {
  const latestApproval = [...events].filter((e) => e.kind === "qc_approved").sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).at(-1);
  const latestDelivery = [...events].filter((e) => e.kind === "delivery_recorded").sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).at(-1);
  if (!latestDelivery) return false;
  return !latestApproval || latestDelivery.at >= latestApproval.at;
}

/**
 * true bila Pemohon SUDAH menyetujui hasil (QC Pemohon selesai) tapi pekerjaan BELUM ditutup PIC —
 * "Menunggu Penyelesaian PIC". QC disetujui ≠ pekerjaan nyata (komunikasi, serah terima, tindak lanjut di
 * luar aplikasi) sudah benar-benar tuntas, jadi persetujuan Pemohon TIDAK PERNAH menutup pekerjaan secara
 * otomatis (lihat record_feedback di applyWorkflowAction) — murni diturunkan dari peristiwa
 * 'feedback_recorded' TERAKHIR, bukan dari status order.
 */
export function awaitingPicClosure(events: FeedbackEv[], orderFinished: boolean): boolean {
  if (orderFinished) return false;
  const latest = [...events]
    .filter((e) => e.kind === "feedback_recorded")
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
    .at(-1);
  return latest ? latest.needsRevision === false : false;
}
const RANK: Record<ResultStage, number> = { draft: 0, submitted: 1, approved: 2, delivered: 3 };
const STAGE_OF: Record<string, ResultStage | "completed"> = {
  qc_submitted: "submitted",
  qc_approved: "approved",
  delivery_recorded: "delivered",
  completed: "completed",
};

export type ResultHistory = { stage: ResultStage; trail: { label: string; at: string }[]; usedInCompletion: boolean };

export function resultFileHistory(fileIds: string[], events: Ev[]): Record<string, ResultHistory> {
  const out: Record<string, ResultHistory> = {};
  for (const id of fileIds) out[id] = { stage: "draft", trail: [], usedInCompletion: false };
  const chronological = [...events].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  for (const e of chronological) {
    const s = STAGE_OF[e.kind];
    const ids = Array.isArray(e.detail.resultFileIds) ? (e.detail.resultFileIds as unknown[]).filter((x): x is string => typeof x === "string") : [];
    if (!s) continue;
    for (const id of ids) {
      const h = out[id];
      if (!h) continue;
      if (s === "completed") {
        h.usedInCompletion = true;
        h.trail.push({ label: "Referensi penyelesaian", at: e.at });
        continue;
      }
      h.trail.push({ label: RESULT_STAGE_LABEL[s], at: e.at });
      if (RANK[s] >= RANK[h.stage]) h.stage = s;
    }
  }
  return out;
}

/** File dari penyerahan/persetujuan terakhir (dipilih otomatis sebagai referensi di dialog). */
export function latestResultIds(events: Ev[]): string[] {
  const e = events.find((x) => ["qc_approved", "qc_submitted", "delivery_recorded"].includes(x.kind) && Array.isArray(x.detail.resultFileIds) && (x.detail.resultFileIds as unknown[]).length > 0);
  return e ? (e.detail.resultFileIds as string[]) : [];
}

/** Sama seperti latestResultIds tapi untuk link hasil (lihat order_result_links). */
export function latestResultLinkIds(events: Ev[]): string[] {
  const e = events.find((x) => ["qc_approved", "qc_submitted", "delivery_recorded"].includes(x.kind) && Array.isArray(x.detail.resultLinkIds) && (x.detail.resultLinkIds as unknown[]).length > 0);
  return e ? (e.detail.resultLinkIds as string[]) : [];
}

/** true bila link ini pernah dirujuk di peristiwa penyerahan/persetujuan mana pun — link yang sudah
 *  diserahkan tidak boleh dihapus (sama seperti aturan file hasil, lihat resultFileHistory). */
export function resultLinksUsed(linkIds: string[], events: Ev[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const id of linkIds) out[id] = false;
  for (const e of events) {
    const ids = Array.isArray(e.detail.resultLinkIds) ? (e.detail.resultLinkIds as unknown[]).filter((x): x is string => typeof x === "string") : [];
    for (const id of ids) if (id in out) out[id] = true;
  }
  return out;
}
