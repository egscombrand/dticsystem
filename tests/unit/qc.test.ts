import { describe, expect, it } from "vitest";
import { availableWorkflowActions, checkWorkflowAction, completionNeedsNote, HANDOVER_CHANNEL_LABEL, handoverProblem, SELECTABLE_HANDOVER_CHANNELS, type QcActor, type QcContext } from "@/lib/qc";

const pic: QcActor = { role: "staff", isAssignee: true };
const otherStaff: QcActor = { role: "staff", isAssignee: false };
const manager: QcActor = { role: "manager", isAssignee: false };
const admin: QcActor = { role: "super_admin", isAssignee: false };
const ctx = (over: Partial<QcContext> = {}): QcContext => ({ status: "in_progress", qcStatus: "none", ...over });
const check = (action: Parameters<typeof checkWorkflowAction>[0]["action"], c: QcContext, actor: QcActor, extra: { note?: string; confirmSent?: boolean } = {}) =>
  checkWorkflowAction({ action, ctx: c, actor, ...extra });

describe("penyerahan ke Manager", () => {
  it("PIC mengajukan QC; staff lain ditolak", () => {
    expect(check("submit_qc", ctx(), pic).ok).toBe(true);
    expect(check("submit_qc", ctx(), otherStaff)).toMatchObject({ ok: false, status: 403 });
  });
  it("tidak bisa mengajukan ganda atau saat revisi diminta", () => {
    expect(check("submit_qc", ctx({ status: "pending_confirmation", qcStatus: "pending" }), pic)).toMatchObject({ ok: false, status: 409 });
    expect(check("submit_qc", ctx({ status: "internal_revision", qcStatus: "revision" }), pic)).toMatchObject({ ok: false, status: 409 });
  });
  it("Manager/Super Admin memeriksa; PIC tidak bisa memeriksa hasilnya sendiri", () => {
    const c = ctx({ status: "pending_confirmation", qcStatus: "pending" });
    expect(check("approve_qc", c, manager).ok).toBe(true);
    expect(check("approve_qc", c, admin).ok).toBe(true);
    expect(check("approve_qc", c, pic)).toMatchObject({ ok: false, status: 403 });
    expect(check("approve_qc", c, { role: "manager", isAssignee: true })).toMatchObject({ ok: false, status: 403 });
    expect(check("request_revision", c, manager)).toMatchObject({ ok: false, status: 422, field: "note" });
    expect(check("request_revision", c, manager, { note: "Logo terlalu kecil" }).ok).toBe(true);
  });
  it("tidak ada QC menunggu → 409 (mencegah persetujuan ganda)", () => {
    expect(check("approve_qc", ctx({ qcStatus: "approved" }), manager)).toMatchObject({ ok: false, status: 409 });
  });
  it("PIC dapat menarik pengajuan yang menunggu", () => {
    expect(check("withdraw_qc", ctx({ status: "pending_confirmation", qcStatus: "pending" }), pic).ok).toBe(true);
    expect(check("withdraw_qc", ctx(), pic)).toMatchObject({ ok: false, status: 409 });
  });
});

describe("cara penyerahan ke Manager", () => {
  it("file di DTIC Nexus: minimal satu file (baru atau yang sudah ada)", () => {
    expect(handoverProblem({ method: "in_app", fileCount: 0 })).toMatchObject({ field: "resultFileIds" });
    expect(handoverProblem({ method: "in_app", fileCount: 1 })).toBeNull();
  });
  it("link hasil saja (tanpa file) juga memenuhi syarat penyerahan in_app", () => {
    expect(handoverProblem({ method: "in_app", fileCount: 0, resultLinkCount: 1 })).toBeNull();
    expect(handoverProblem({ method: "in_app", fileCount: 0, resultLinkCount: 0 })).toMatchObject({ field: "resultFileIds" });
    expect(handoverProblem({ method: "in_app", fileCount: 1, resultLinkCount: 1 })).toBeNull();
  });
  it("'dtic_nexus' punya label tapi TIDAK termasuk opsi yang dapat dipilih manual (sistem yang mencatatnya)", () => {
    expect(HANDOVER_CHANNEL_LABEL.dtic_nexus).toBe("Website DTIC Nexus");
    expect(SELECTABLE_HANDOVER_CHANNELS).not.toContain("dtic_nexus");
  });
  it("di luar DTIC Nexus: media & keterangan wajib; upload tidak wajib", () => {
    expect(handoverProblem({ method: "external", fileCount: 0 })).toMatchObject({ field: "channel" });
    expect(handoverProblem({ method: "external", fileCount: 0, channel: "whatsapp", note: "ok" })).toMatchObject({ field: "note" });
    expect(handoverProblem({ method: "external", fileCount: 0, channel: "whatsapp", note: "Sudah dikirim ke WA Manager" })).toBeNull();
  });
  it("hanya Manager/Super Admin yang meminta file/akses; wajib catatan", () => {
    const c = ctx({ status: "pending_confirmation", qcStatus: "pending" });
    expect(check("request_access", c, pic, { note: "x" })).toMatchObject({ ok: false, status: 403 });
    expect(check("request_access", c, manager)).toMatchObject({ ok: false, status: 422 });
    expect(check("request_access", c, manager, { note: "File belum diterima" }).ok).toBe(true);
  });
});

describe("langsung ke pemohon", () => {
  it("PIC boleh mengirim langsung tanpa QC, tetapi wajib konfirmasi benar-benar terkirim", () => {
    expect(check("record_delivery", ctx(), pic)).toMatchObject({ ok: false, status: 422, field: "confirmSent" });
    expect(check("record_delivery", ctx(), pic, { confirmSent: true }).ok).toBe(true);
    expect(check("record_delivery", ctx({ status: "awaiting_requester" }), pic, { confirmSent: true }).ok).toBe(true);
  });
  it("tidak saat menunggu Manager atau saat revisi diminta; staff lain ditolak", () => {
    expect(check("record_delivery", ctx({ status: "pending_confirmation", qcStatus: "pending" }), pic, { confirmSent: true })).toMatchObject({ ok: false, status: 409 });
    expect(check("record_delivery", ctx({ status: "internal_revision", qcStatus: "revision" }), pic, { confirmSent: true })).toMatchObject({ ok: false, status: 409 });
    expect(check("record_delivery", ctx(), otherStaff, { confirmSent: true })).toMatchObject({ ok: false, status: 403 });
  });
  it("masukan pemohon hanya setelah pengiriman tercatat dan wajib ringkasan", () => {
    expect(check("record_feedback", ctx(), pic, { note: "ok" })).toMatchObject({ ok: false, status: 409 });
    expect(check("record_feedback", ctx({ status: "awaiting_requester" }), pic)).toMatchObject({ ok: false, status: 422 });
    expect(check("record_feedback", ctx({ status: "awaiting_requester" }), pic, { note: "Ganti warna" }).ok).toBe(true);
  });
});

describe("Selesaikan Pekerjaan", () => {
  it("PIC menyelesaikan; catatan wajib bila belum ada pengiriman tercatat", () => {
    expect(completionNeedsNote(ctx())).toBe(true);
    expect(completionNeedsNote(ctx({ status: "awaiting_requester" }))).toBe(false);
    expect(check("complete", ctx(), pic)).toMatchObject({ ok: false, status: 422, field: "note" });
    expect(check("complete", ctx(), pic, { note: "abc" })).toMatchObject({ ok: false, status: 422 });
    expect(check("complete", ctx(), pic, { note: "Hasil sudah dikirim lewat WhatsApp" }).ok).toBe(true);
    expect(check("complete", ctx({ status: "awaiting_requester" }), pic).ok).toBe(true);
  });
  it("tidak saat menunggu pemeriksaan Manager", () => {
    const c = ctx({ status: "pending_confirmation", qcStatus: "pending" });
    expect(check("complete", c, pic, { note: "Sudah disepakati" })).toMatchObject({ ok: false, status: 409 });
    expect(check("complete", c, manager, { note: "Sudah disepakati" })).toMatchObject({ ok: false, status: 409 });
  });
  it("saat revisi diminta: PIC tidak bisa menutup; Manager boleh dengan catatan", () => {
    const c = ctx({ status: "internal_revision", qcStatus: "revision" });
    expect(check("complete", c, pic, { note: "Sudah disepakati" })).toMatchObject({ ok: false, status: 409 });
    expect(check("complete", c, manager, { note: "Pemohon menerima versi ini" }).ok).toBe(true);
  });
  it("staff lain, status awal, dan pekerjaan selesai ditolak", () => {
    expect(check("complete", ctx(), otherStaff, { note: "Sudah selesai" })).toMatchObject({ ok: false, status: 403 });
    expect(check("complete", ctx({ status: "assigned" }), pic, { note: "Sudah selesai" })).toMatchObject({ ok: false, status: 409 });
    expect(check("complete", ctx({ status: "completed" }), pic, { note: "Sudah selesai" })).toMatchObject({ ok: false, status: 409 });
  });
});

describe("tombol sesuai status & role", () => {
  it("PIC saat mengerjakan: Ajukan QC (dua tujuan) dan Selesaikan", () => {
    expect(availableWorkflowActions(ctx(), pic)).toEqual(["submit_qc", "record_delivery", "complete"]);
  });
  it("PIC saat menunggu Manager: hanya tarik pengajuan", () => {
    expect(availableWorkflowActions(ctx({ status: "pending_confirmation", qcStatus: "pending" }), pic)).toEqual(["withdraw_qc"]);
  });
  it("Manager saat menunggu: setujui & minta revisi", () => {
    expect(availableWorkflowActions(ctx({ status: "pending_confirmation", qcStatus: "pending" }), manager)).toEqual(["approve_qc", "request_revision", "request_access"]);
  });
  it("PIC setelah dikirim: ajukan/kirim ulang, catat masukan, selesaikan", () => {
    expect(availableWorkflowActions(ctx({ status: "awaiting_requester" }), pic)).toEqual(["submit_qc", "record_delivery", "record_feedback", "complete"]);
  });
  it("staff lain tidak mendapat tombol", () => {
    expect(availableWorkflowActions(ctx(), otherStaff)).toEqual([]);
  });
});
