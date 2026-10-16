import { describe, expect, it } from "vitest";
import { composeWaMessage, greetingFor, isValidWaNumber, missingInput, waTemplateOptions, waUrl, type WaContext, type WaInputs } from "@/lib/smart-whatsapp";

const ctx = (over: Partial<WaContext> = {}): WaContext => ({
  status: "assigned", qcStatus: "none", delivery: "none", lastEventKind: null, requesterRevision: null, revisionDelivered: false,
  shareableLink: null, resultFileCount: 0, holdReason: null, firstContact: true, ...over,
});
const none: WaInputs = { clarification: "", progressNote: "", holdReason: "", revisionNote: "" };
const data = { requesterName: "Ani", senderName: "Nuri Khusnaini", title: "Poster Seminar", orderNumber: "DTIC-2026-00042", now: new Date("2026-10-16T01:00:00Z") };
const msg = (t: Parameters<typeof composeWaMessage>[0], c: Partial<WaContext> = {}, i: Partial<WaInputs> = {}) =>
  composeWaMessage(t, data, { ...ctx(c) }, { ...none, ...i });

describe("pemilihan template dari kondisi aktual", () => {
  it("baru ditugaskan → perkenalan; dibuka lagi → perkenalan tidak disarankan ulang", () => {
    expect(waTemplateOptions(ctx())).toEqual({ options: ["intro", "clarification"], preferred: "intro" });
    expect(waTemplateOptions(ctx({ firstContact: false }))).toEqual({ options: ["clarification", "intro"], preferred: "clarification" });
  });
  it("mulai dikerjakan tanpa aktivitas → informasi mulai; tidak ada hasil → tidak menawarkan kirim hasil", () => {
    const r = waTemplateOptions(ctx({ status: "in_progress", firstContact: false }));
    expect(r.preferred).toBe("started");
    expect(r.options).not.toContain("send_result");
    expect(r.options).not.toContain("result_ready");
  });
  it("menunggu QC → pemeriksaan internal; tidak ada template hasil siap", () => {
    const r = waTemplateOptions(ctx({ status: "pending_confirmation", qcStatus: "pending", resultFileCount: 2, lastEventKind: "qc_submitted" }));
    expect(r.preferred).toBe("internal_review");
    expect(r.options).not.toContain("result_ready");
    expect(r.options).not.toContain("send_result");
  });
  it("QC disetujui & ada hasil → hasil siap", () => {
    expect(waTemplateOptions(ctx({ status: "in_progress", qcStatus: "approved", shareableLink: "https://drive.example/x", lastEventKind: "qc_approved" })).preferred).toBe("result_ready");
  });
  it("revisi pemohon tercatat → konfirmasi revisi; revisi selesai hanya bila ada hasil", () => {
    const base = { status: "in_progress" as const, requesterRevision: "Ganti warna", lastEventKind: "feedback_recorded" };
    expect(waTemplateOptions(ctx(base)).preferred).toBe("revision_received");
    expect(waTemplateOptions(ctx(base)).options).not.toContain("revision_done");
    expect(waTemplateOptions(ctx({ ...base, resultFileCount: 1 })).options).toContain("revision_done");
  });
  it("revisi internal Manager → progres (instruksi internal tidak dikirim)", () => {
    expect(waTemplateOptions(ctx({ status: "internal_revision", qcStatus: "revision" })).preferred).toBe("progress");
  });
  it("sudah dikirim → tindak lanjut; ditunda → kendala; selesai → penyelesaian", () => {
    expect(waTemplateOptions(ctx({ status: "awaiting_requester", delivery: "direct" })).preferred).toBe("follow_up");
    expect(waTemplateOptions(ctx({ status: "on_hold" })).preferred).toBe("on_hold");
    const done = waTemplateOptions(ctx({ status: "completed", firstContact: false }));
    expect(done).toEqual({ options: ["completed"], preferred: "completed" });
    expect(waTemplateOptions(ctx({ status: "completed", delivery: "direct", firstContact: false })).options).toContain("follow_up");
  });
  it("dibatalkan → tanpa template", () => {
    expect(waTemplateOptions(ctx({ status: "cancelled" })).options).toEqual([]);
  });
});

describe("isi pesan", () => {
  it("perkenalan memakai nama pengirim, 'Kak', sapaan waktu WIB, tanpa placeholder mentah", () => {
    const m = msg("intro");
    expect(m).toMatch(/^Halo Kak Ani, selamat pagi!/);
    expect(m).toContain("Perkenalkan, Nuri Khusnaini dari Tim DTIC Environesia.");
    expect(m).toContain("*Poster Seminar* dengan nomor order *DTIC-2026-00042*");
    expect(m).not.toMatch(/\{\{|Bapak|Ibu|\baku\b/);
  });
  it("tanpa nama pemohon → 'Kak' saja", () => {
    expect(composeWaMessage("progress", { ...data, requesterName: null }, ctx({ firstContact: false }), none)).toMatch(/^Halo Kak!/);
  });
  it("pesan lanjutan tidak mengulang perkenalan; kontak pertama menyisipkannya sekali", () => {
    expect(msg("progress", { firstContact: false })).not.toContain("Perkenalkan");
    expect(msg("progress", { firstContact: true }).match(/Perkenalkan/g)).toHaveLength(1);
    expect(msg("intro").match(/Perkenalkan/g)).toHaveLength(1);
  });
  it("progres tanpa catatan → kalimat netral, tanpa angka karangan", () => {
    const m = msg("progress", { firstContact: false });
    expect(m).toContain("Saat ini, pekerjaan masih dalam proses pengerjaan oleh tim kami.");
    expect(m).not.toMatch(/%/);
    expect(msg("progress", { firstContact: false }, { progressNote: "Konsep warna sudah dibuat." })).toContain("tim kami. Konsep warna sudah dibuat.");
  });
  it("klarifikasi dari poin PIC menjadi daftar; wajib diisi", () => {
    expect(missingInput("clarification", none)).toBeTruthy();
    expect(msg("clarification", { firstContact: false }, { clarification: "Ukuran logo?\n- Warna utama?" })).toContain("• Ukuran logo?\n• Warna utama?");
  });
  it("hasil: tautan eksternal bila ada; file internal tidak ditautkan", () => {
    expect(msg("send_result", { firstContact: false, shareableLink: "https://drive.example/hasil" })).toContain("https://drive.example/hasil");
    const internal = msg("send_result", { firstContact: false, resultFileCount: 2 });
    expect(internal).toContain("File hasil kami lampirkan langsung di percakapan ini.");
    expect(internal).not.toMatch(/\/api\/internal|attachments/);
  });
  it("selesai tanpa tautan → tidak mengklaim hasil sudah dikirim", () => {
    const m = msg("completed", { firstContact: false });
    expect(m).not.toMatch(/tautan|terkirim|disetujui/i);
    expect(m).toContain("telah kami selesaikan");
  });
  it("kendala & revisi memakai catatan yang diisi", () => {
    expect(msg("on_hold", { firstContact: false }, { holdReason: "menunggu logo dari pemohon." })).toContain("kendala berupa menunggu logo dari pemohon. Kami");
    expect(missingInput("on_hold", none)).toBeTruthy();
    expect(msg("revision_received", { firstContact: false }, { revisionNote: "Ganti warna latar" })).toContain("• Ganti warna latar");
  });
});

describe("tautan WhatsApp", () => {
  it("nomor tersimpan 628… valid; lainnya ditolak", () => {
    expect(isValidWaNumber("6281234567890")).toBe(true);
    expect(isValidWaNumber("081234567890")).toBe(false);
    expect(isValidWaNumber(null)).toBe(false);
  });
  it("teks Indonesia, emoji, baris baru, dan URL di-encode dengan benar", () => {
    const text = "Halo Kak! 🙏\nHasil: https://drive.example/a?b=1&c=2\nTerima kasih — Tim";
    const url = waUrl("6281234567890", text);
    expect(url.startsWith("https://wa.me/6281234567890?text=")).toBe(true);
    expect(decodeURIComponent(url.split("?text=")[1])).toBe(text);
    expect(url).not.toContain(" ");
  });
  it("sapaan waktu sesuai WIB", () => {
    expect(greetingFor(new Date("2026-10-16T00:30:00Z"))).toBe("selamat pagi"); // 07.30 WIB
    expect(greetingFor(new Date("2026-10-16T06:00:00Z"))).toBe("selamat siang"); // 13.00
    expect(greetingFor(new Date("2026-10-16T09:00:00Z"))).toBe("selamat sore"); // 16.00
    expect(greetingFor(new Date("2026-10-16T13:00:00Z"))).toBe("selamat malam"); // 20.00
  });
});
