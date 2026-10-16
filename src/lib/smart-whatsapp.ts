/**
 * Smart WhatsApp Message (MURNI: tanpa I/O, diuji unit).
 *
 * Memilih template pesan untuk pemohon berdasarkan status pekerjaan, status QC, status pengiriman, dan
 * peristiwa yang benar-benar tercatat, lalu menyusun teksnya dari data aktual. Tidak ada data yang dikarang:
 * bagian opsional yang kosong dihilangkan, dan template yang butuh data yang tidak ada tidak ditawarkan.
 *
 * Batasan penting:
 *  - Tautan hasil HANYA tautan eksternal yang dicatat PIC pada persetujuan QC / pengiriman / penyelesaian.
 *    File di DTIC Nexus bersifat privat (butuh login) sehingga tidak pernah ditautkan ke pemohon.
 *  - Instruksi revisi internal dari Manager tidak dimasukkan ke pesan pemohon.
 *  - Membuka WhatsApp (wa.me) hanya menyiapkan pesan; PIC sendiri yang menekan kirim.
 */
import type { OrderStatus } from "@/lib/status";
import type { DeliveryStatus, QcStatus } from "@/lib/qc";

export const WA_TEMPLATES = [
  "intro",
  "started",
  "clarification",
  "progress",
  "revision_received",
  "revision_done",
  "internal_review",
  "result_ready",
  "send_result",
  "completed",
  "on_hold",
  "follow_up",
] as const;
export type WaTemplate = (typeof WA_TEMPLATES)[number];

export const WA_TEMPLATE_LABEL: Record<WaTemplate, string> = {
  intro: "Perkenalan & konfirmasi penugasan",
  started: "Pekerjaan mulai dikerjakan",
  clarification: "Minta klarifikasi",
  progress: "Informasi progres",
  revision_received: "Konfirmasi revisi diterima",
  revision_done: "Revisi selesai",
  internal_review: "Sedang pemeriksaan internal",
  result_ready: "Hasil sudah siap",
  send_result: "Kirim hasil pekerjaan",
  completed: "Pekerjaan selesai",
  on_hold: "Pekerjaan tertunda / kendala",
  follow_up: "Tindak lanjut setelah hasil dikirim",
};

/** Konteks pekerjaan yang dibaca dari data aktual (lihat buildWaContext di halaman detail). */
export type WaContext = {
  status: OrderStatus;
  qcStatus: QcStatus;
  delivery: DeliveryStatus;
  /** Jenis peristiwa alur kerja terbaru (qc_submitted, delivery_recorded, feedback_recorded, ...), null bila belum ada. */
  lastEventKind: string | null;
  /** Ringkasan revisi dari pemohon yang tercatat (feedback dengan revisi) dan belum diikuti pengiriman baru. */
  requesterRevision: string | null;
  /** Hasil revisi sudah dikirim ulang setelah permintaan revisi pemohon. */
  revisionDelivered: boolean;
  /** Tautan eksternal hasil yang boleh dibagikan (bukan tautan internal DTIC Nexus). */
  shareableLink: string | null;
  /** Jumlah file hasil internal (dilampirkan manual oleh PIC, tidak ditautkan). */
  resultFileCount: number;
  /** Alasan penundaan dari riwayat status (diisi PIC; dapat diedit sebelum dikirim). */
  holdReason: string | null;
  /** Pengguna ini belum pernah membuka WhatsApp untuk pekerjaan ini. */
  firstContact: boolean;
};

const hasResult = (c: WaContext) => Boolean(c.shareableLink) || c.resultFileCount > 0;

/** Template yang relevan (urutan = prioritas) beserta default. Tidak menebak kondisi yang tidak tercatat. */
export function waTemplateOptions(c: WaContext): { options: WaTemplate[]; preferred: WaTemplate | null } {
  const opts: WaTemplate[] = [];
  let preferred: WaTemplate | null = null;
  switch (c.status) {
    case "submitted":
    case "assigned":
      // Perkenalan hanya disarankan pada kontak pertama pengguna ini; setelahnya tetap dapat dipilih manual.
      if (c.firstContact) { opts.push("intro", "clarification"); preferred = "intro"; }
      else { opts.push("clarification", "intro"); preferred = "clarification"; }
      break;
    case "in_progress": {
      const revisionPending = Boolean(c.requesterRevision) && !c.revisionDelivered;
      if (revisionPending) opts.push("revision_received");
      if (revisionPending && hasResult(c) && c.qcStatus !== "pending") opts.push("revision_done");
      if (c.qcStatus === "approved" && c.delivery === "none" && hasResult(c)) opts.push("result_ready");
      if (hasResult(c) && !revisionPending) opts.push("send_result");
      if (c.lastEventKind === null && c.delivery === "none") opts.push("started");
      opts.push("progress", "clarification");
      preferred = revisionPending ? "revision_received" : opts.includes("result_ready") ? "result_ready" : c.lastEventKind === null ? "started" : "progress";
      break;
    }
    case "pending_confirmation":
      opts.push("internal_review", "progress", "clarification");
      preferred = "internal_review";
      break;
    case "internal_revision":
      // Instruksi revisi Manager bersifat internal: pemohon cukup menerima informasi progres.
      opts.push("progress", "clarification");
      preferred = "progress";
      break;
    case "awaiting_requester":
      opts.push("follow_up");
      if (hasResult(c)) opts.push("send_result");
      opts.push("clarification");
      preferred = "follow_up";
      break;
    case "on_hold":
      opts.push("on_hold", "clarification");
      preferred = "on_hold";
      break;
    case "completed":
      opts.push("completed");
      if (c.delivery !== "none") opts.push("follow_up");
      preferred = "completed";
      break;
    case "cancelled":
      break;
  }
  // Pengguna yang baru pertama kali menghubungi pemohon selalu dapat memilih perkenalan.
  if (c.firstContact && !opts.includes("intro") && c.status !== "cancelled") opts.push("intro");
  return { options: opts, preferred };
}

export type WaInputs = {
  /** Poin klarifikasi yang ditulis PIC (satu per baris). */
  clarification: string;
  /** Catatan progres aktual (opsional). */
  progressNote: string;
  /** Alasan kendala (diawali dari alasan penundaan; dapat diedit). */
  holdReason: string;
  /** Catatan revisi (diawali dari masukan pemohon yang tercatat). */
  revisionNote: string;
};

export type WaData = {
  requesterName: string | null;
  senderName: string;
  title: string;
  orderNumber: string;
  now: Date;
};

/** Sapaan waktu WIB. */
export function greetingFor(now: Date): string {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", hourCycle: "h23" }).format(now));
  if (h >= 4 && h < 11) return "selamat pagi";
  if (h >= 11 && h < 15) return "selamat siang";
  if (h >= 15 && h < 18) return "selamat sore";
  return "selamat malam";
}

/** "Kak Ani" bila nama tersedia; "Kak" bila tidak. Nama tidak dipaksakan. */
function kak(name: string | null): string {
  const n = name?.trim();
  return n ? `Kak ${n}` : "Kak";
}

const bullets = (text: string) =>
  text
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-•*\d.)\s]+/, "").trim())
    .filter(Boolean)
    .map((l) => `• ${l}`)
    .join("\n");

/** Data yang wajib ada sebelum pesan dapat dibuka di WhatsApp. null = siap. */
export function missingInput(t: WaTemplate, inputs: WaInputs): string | null {
  if (t === "clarification" && !inputs.clarification.trim()) return "Tulis poin yang ingin diklarifikasi terlebih dahulu.";
  if (t === "on_hold" && !inputs.holdReason.trim()) return "Tulis kendala yang ingin disampaikan kepada pemohon.";
  if (t === "revision_received" && !inputs.revisionNote.trim()) return "Tulis catatan revisi yang akan ditindaklanjuti.";
  return null;
}

/**
 * Susun pesan. Judul & nomor order ditebalkan dengan format WhatsApp (*teks*).
 * firstContact → perkenalan disisipkan sekali (template perkenalan sudah memuatnya).
 */
export function composeWaMessage(t: WaTemplate, d: WaData, c: Pick<WaContext, "shareableLink" | "resultFileCount" | "firstContact" | "delivery">, inputs: WaInputs): string {
  const job = `*${d.title}* dengan nomor order *${d.orderNumber}*`;
  const hello = t === "intro" ? `Halo ${kak(d.requesterName)}, ${greetingFor(d.now)}!` : `Halo ${kak(d.requesterName)}!`;
  const intro = `Perkenalkan, ${d.senderName} dari Tim DTIC Environesia.`;
  const resultAccess = (lead: string): string[] => {
    if (c.shareableLink) return [lead, "", c.shareableLink];
    // File internal tidak ditautkan (butuh login); PIC melampirkannya sendiri di WhatsApp.
    if (c.resultFileCount > 0) return ["File hasil kami lampirkan langsung di percakapan ini."];
    return [];
  };
  const p: string[] = [hello, ""];
  if (c.firstContact && t !== "intro") p.push(intro, "");

  switch (t) {
    case "intro":
      p.push(`${intro} Kami menghubungi Kakak terkait permohonan pekerjaan ${job}.`, "",
        "Kami sudah menerima penugasan untuk pekerjaan ini dan akan menindaklanjutinya sesuai dengan kebutuhan yang Kakak sampaikan.", "",
        "Jika ada detail tambahan yang perlu kami pastikan selama proses pengerjaan, kami akan menghubungi Kakak kembali melalui WhatsApp ini.", "",
        "Terima kasih, Kak, atas kepercayaan dan kerja samanya!");
      break;
    case "started":
      p.push(`Kami ingin menginformasikan bahwa pekerjaan ${job} sudah mulai kami kerjakan.`, "",
        "Kami akan menindaklanjuti pekerjaan ini sesuai dengan detail permohonan yang telah disampaikan. Jika ada informasi tambahan yang diperlukan, kami akan menghubungi Kakak kembali.", "",
        "Terima kasih, Kak!");
      break;
    case "clarification":
      p.push(`Kami sedang menindaklanjuti pekerjaan ${job}.`, "",
        "Ada beberapa hal yang ingin kami pastikan agar hasil pekerjaan nantinya sesuai dengan kebutuhan Kakak:", "",
        bullets(inputs.clarification) || "• …", "",
        "Boleh dibantu konfirmasi untuk poin tersebut, Kak? Dengan begitu, kami bisa melanjutkan pekerjaan dengan lebih tepat.", "",
        "Terima kasih!");
      break;
    case "progress": {
      const note = inputs.progressNote.trim();
      p.push(`Kami ingin memberikan informasi terbaru mengenai pekerjaan ${job}.`, "",
        `Saat ini, pekerjaan masih dalam proses pengerjaan oleh tim kami.${note ? ` ${note}` : ""}`, "",
        "Kami akan memberikan informasi kembali apabila ada perkembangan penting atau hasil pekerjaan sudah siap.", "",
        "Terima kasih atas kesabaran dan kerja samanya, Kak!");
      break;
    }
    case "revision_received":
      p.push(`Kami sudah menerima catatan revisi untuk pekerjaan ${job}.`, "",
        "Catatan revisi yang akan kami tindak lanjuti:", bullets(inputs.revisionNote) || "• …", "",
        "Kami akan menyesuaikan hasil pekerjaan berdasarkan catatan tersebut. Jika ada bagian yang memerlukan klarifikasi, kami akan menghubungi Kakak kembali.", "",
        "Terima kasih atas masukan dan arahannya, Kak!");
      break;
    case "revision_done":
      p.push(`Kami ingin menginformasikan bahwa revisi untuk pekerjaan ${job} sudah selesai kami kerjakan.`, "",
        ...resultAccess("Hasil terbaru dapat Kakak lihat melalui tautan berikut:"), "",
        "Silakan ditinjau terlebih dahulu, Kak. Jika masih ada bagian yang perlu disesuaikan, silakan sampaikan catatannya agar dapat kami tindak lanjuti.", "",
        "Terima kasih!");
      break;
    case "internal_review":
      p.push(`Pekerjaan ${job} sedang memasuki tahap pemeriksaan internal agar hasilnya dapat ditinjau sebelum disampaikan kepada Kakak.`, "",
        "Kami akan menginformasikan kembali setelah ada perkembangan lebih lanjut.", "",
        "Terima kasih, Kak!");
      break;
    case "result_ready":
      p.push(`Kami ingin menginformasikan bahwa hasil pekerjaan ${job} sudah siap.`, "",
        ...resultAccess("Kakak dapat melihat atau mengunduh hasilnya melalui tautan berikut:"), "",
        "Silakan ditinjau, Kak. Jika ada pertanyaan terkait hasil yang kami sampaikan, kami siap membantu memberikan penjelasan.", "",
        "Terima kasih atas kepercayaan dan kerja samanya!");
      break;
    case "send_result":
      p.push(`Berikut kami sampaikan hasil pekerjaan ${job}.`, "",
        ...resultAccess("Hasil pekerjaan dapat Kakak akses melalui tautan berikut:"), "",
        "Silakan diperiksa terlebih dahulu, Kak. Jika ada pertanyaan atau bagian yang perlu didiskusikan, kami siap membantu.", "",
        "Terima kasih atas kerja samanya!");
      break;
    case "completed": {
      p.push(`Kami ingin menginformasikan bahwa pekerjaan ${job} telah kami selesaikan.`, "");
      // Tautan hanya bila memang ada; penyelesaian tidak berarti hasil sudah dikirim.
      if (c.shareableLink) p.push("Untuk hasil pekerjaan, Kakak dapat mengaksesnya melalui tautan berikut:", "", c.shareableLink, "");
      p.push("Terima kasih atas kepercayaan Kakak kepada Tim DTIC Environesia. Jika ada hal yang ingin ditanyakan terkait hasil pekerjaan, silakan hubungi kami kembali.");
      break;
    }
    case "on_hold":
      p.push(`Kami ingin memberikan informasi terkait pekerjaan ${job}.`, "",
        `Saat ini, pekerjaan mengalami kendala berupa ${inputs.holdReason.trim().replace(/[.\s]+$/, "") || "…"}. Kami sedang menindaklanjuti kendala tersebut dan akan memberikan informasi lanjutan setelah ada perkembangan.`, "",
        "Mohon pengertiannya, Kak. Terima kasih atas kesabaran dan kerja samanya.");
      break;
    case "follow_up":
      p.push(`Kami ingin memastikan apakah hasil pekerjaan ${job} sudah dapat diakses dengan baik.`, "",
        "Jika ada kendala saat membuka file atau ada hal yang ingin ditanyakan, silakan kabari kami melalui WhatsApp ini, ya, Kak.", "",
        "Terima kasih!");
      break;
  }
  return p.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Nomor tersimpan berbentuk 628xxxxxxxxx (lihat src/lib/whatsapp.ts). */
export function isValidWaNumber(n: string | null | undefined): n is string {
  return typeof n === "string" && /^628\d{7,12}$/.test(n);
}

export function waUrl(number: string, text: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}
