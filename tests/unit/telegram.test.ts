import { describe, expect, it } from "vitest";
import { buildOrderMessage, buildPicChangeMessage, buildStatusMessage, escapeHtml, publicAppUrl, readTelegramConfig, TEST_MESSAGE_PREFIX, telegramErrorMessage, telegramHtmlToText } from "@/lib/telegram";

const TOKEN = "123456:AAHtestTokenUjiDTIC-abcdefghijklmnop";
const valid = { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: "-1001234567890" };

describe("konfigurasi Telegram", () => {
  it("belum diisi → null (belum dikonfigurasi)", () => {
    expect(readTelegramConfig({})).toBeNull();
    expect(readTelegramConfig({ TELEGRAM_BOT_TOKEN: TOKEN })).toBeNull();
  });
  it("format token/chat ID salah → null, tidak menebak", () => {
    expect(readTelegramConfig({ ...valid, TELEGRAM_BOT_TOKEN: "bukan-token" })).toBeNull();
    expect(readTelegramConfig({ ...valid, TELEGRAM_CHAT_ID: "chat dengan spasi" })).toBeNull();
  });
  it("API base hanya https atau loopback; selain itu ditolak", () => {
    expect(readTelegramConfig({ ...valid, TELEGRAM_API_BASE: "http://evil.example" })).toBeNull();
    expect(readTelegramConfig({ ...valid, TELEGRAM_API_BASE: "http://127.0.0.1:9999/" })?.apiBase).toBe("http://127.0.0.1:9999");
    expect(readTelegramConfig(valid)?.apiBase).toBe("https://api.telegram.org");
  });
  it("token dan chat ID sah → konfigurasi; DTIC_APP_URL opsional", () => {
    const cfg = readTelegramConfig({ ...valid, DTIC_APP_URL: "https://dtic.example/" });
    expect(cfg).toMatchObject({ token: TOKEN, chatId: "-1001234567890", appUrl: "https://dtic.example" });
    expect(readTelegramConfig(valid)?.appUrl).toBeNull();
  });
});

describe("format pesan request pekerjaan baru (bahasa Indonesia)", () => {
  const data = {
    id: "11111111-1111-4111-8111-111111111111",
    orderNumber: "DTIC-2026-0001",
    status: "assigned" as const,
    createdAt: new Date("2026-10-13T08:30:00Z"),
    requesterName: "Ani <script>",
    department: "Marketing",
    brandName: "LSP & PLI",
    designType: "Poster",
    title: "Poster <b>Promo</b>",
    brief: "Judul\n\n   Promo   akhir tahun " + "x".repeat(900),
    priorityName: "Normal",
    deadlineAt: new Date("2026-10-20T16:59:00Z"),
    attachmentCount: 2,
    picInfos: [{ fullName: "Nuri Khusnaini", displayName: "Nuri K", username: "nuri_k", userId: "555001", status: "recorded" as const }],
  };
  const BASE_URL = "https://dtic.example";

  it("memuat bagian template berbahasa Indonesia dengan data database", () => {
    const text = buildOrderMessage(data, BASE_URL);
    expect(text).toContain("🔔 <b>REQUEST PEKERJAAN BARU</b>");
    expect(text).toContain("Nomor Order: <b>DTIC-2026-0001</b>");
    expect(text).toContain("Status: SIAP DIKERJAKAN");
    expect(text).toContain("Jenis Pekerjaan: Poster");
    expect(text).toContain("Prioritas: Normal");
    expect(text).toContain("Tenggat: ");
    expect(text).toContain("📎 Lampiran: 2 file");
    expect(text).toContain("👤 Pemohon: Ani &lt;script&gt; · Marketing");
    expect(text).toContain('<a href="https://dtic.example/dtic/orders/11111111-1111-4111-8111-111111111111">Buka Detail Pekerjaan</a>');
    expect(text).toContain("📣 <b>TINDAKAN SELANJUTNYA</b>");
    expect(text).toContain("DTIC Nexus · Notifikasi Otomatis");
  });
  it("tidak memuat nomor WhatsApp, ukuran desain, atau istilah Inggris", () => {
    const text = buildOrderMessage(data, BASE_URL);
    expect(text).not.toMatch(/WhatsApp|62812|Ukuran/);
    expect(text).not.toMatch(/New Work|Request Overview|Assigned|Work Brief|Action Required|Data Pemohon|Pengajuan Resmi/i);
  });
  it("PIC: nama anggota + nama/username Telegram sebagai informasi; tanpa mention langsung bila belum terverifikasi", () => {
    const text = buildOrderMessage(data, null);
    expect(text).toContain("• Nuri Khusnaini · @nuri_k");
    expect(text).not.toContain("tg://user");
  });
  it("mention langsung hanya bila status verified dan User ID ada", () => {
    const text = buildOrderMessage({ ...data, picInfos: [{ ...data.picInfos[0], status: "verified" }] }, null);
    expect(text).toContain('<a href="tg://user?id=555001">Nuri K</a>');
  });
  it("tanpa PIC ditulis 'Belum ada PIC'; field kosong 'Belum diisi'; tanpa lampiran 'Tidak ada'", () => {
    const text = buildOrderMessage({ ...data, picInfos: [], title: "", priorityName: null, attachmentCount: 0 }, null);
    expect(text).toContain("• Belum ada PIC");
    expect(text).toContain("Judul: <b>Belum diisi</b>");
    expect(text).toContain("Prioritas: Belum diisi");
    expect(text).toContain("📎 Lampiran: Tidak ada");
  });
  it("PIC tanpa data Telegram tampil sebagai nama anggota", () => {
    const text = buildOrderMessage({ ...data, picInfos: [{ fullName: "Siti Amelia", displayName: null, username: null, userId: null, status: "not_linked" }] }, null);
    expect(text).toContain("• Siti Amelia");
  });
  it("waktu pengajuan memakai zona WIB (Asia/Jakarta)", () => {
    // 08:30 UTC = 15:30 WIB
    expect(buildOrderMessage(data, null)).toMatch(/Tenggat: .*15[.:]59|20 Okt/);
  });
  it("menyaring HTML dari input (judul dan nama pemohon)", () => {
    const text = buildOrderMessage(data, null);
    expect(text).toContain("Judul: <b>Poster &lt;b&gt;Promo&lt;/b&gt;</b>");
    expect(text).not.toContain("<script>");
    expect(text).not.toContain("<b>Promo</b>");
  });
  it("deskripsi dipotong; nomor order tetap di atas; panjang di bawah batas Telegram", () => {
    const text = buildOrderMessage(data, null);
    expect(text.indexOf("Nomor Order")).toBeLessThan(text.indexOf("BRIEF PEKERJAAN"));
    expect(text).toContain("…");
    expect(text.length).toBeLessThanOrEqual(4096);
  });
  it("tautan detail hanya bila ada", () => {
    expect(buildOrderMessage(data, null)).not.toContain("Buka Detail Pekerjaan");
  });
  it("tidak pernah memuat token", () => {
    expect(buildOrderMessage(data, BASE_URL)).not.toContain(TOKEN);
  });
  it("escapeHtml hanya menangani karakter yang bermakna untuk Telegram HTML", () => {
    expect(escapeHtml(`a & b < c > d "e"`)).toBe(`a &amp; b &lt; c &gt; d "e"`);
  });
});

describe("format pesan perubahan status (bahasa Indonesia)", () => {
  const data = {
    orderId: "22222222-2222-4222-8222-222222222222",
    orderNumber: "DTIC-2026-0002",
    title: "Banner <i>Promo</i>",
    previousStatus: "assigned",
    newStatus: "on_hold",
    changedAt: new Date("2026-10-13T08:30:00Z"),
    note: "Menunggu aset logo dari pemohon",
    actorName: "Nuri Khusnaini",
    picInfos: [{ fullName: "Nuri Khusnaini", displayName: null, username: null, userId: null, status: "not_linked" as const }],
  };
  it("memuat nomor order, judul, PIC, status sebelum/sesudah, waktu, dan catatan", () => {
    const text = buildStatusMessage(data, "https://dtic.example");
    expect(text).toContain("🔄 <b>PEMBARUAN STATUS PEKERJAAN</b>");
    expect(text).toContain("Nomor Order: DTIC-2026-0002");
    expect(text).toContain("Judul: Banner &lt;i&gt;Promo&lt;/i&gt;");
    expect(text).toContain("• Nuri Khusnaini");
    expect(text).toContain("Status sebelumnya: Siap Dikerjakan");
    expect(text).toContain("Status baru: <b>DITUNDA</b>");
    expect(text).toContain("Catatan: Menunggu aset logo dari pemohon");
    expect(text).toContain("/dtic/orders/22222222-2222-4222-8222-222222222222");
    expect(text).not.toMatch(/Status update|Request Overview|Assigned/);
  });
  it("tanpa catatan dan tanpa URL: baris itu dihilangkan", () => {
    const text = buildStatusMessage({ ...data, note: null, actorName: null }, null);
    expect(text).not.toContain("Catatan:");
    expect(text).not.toContain("Diubah oleh:");
    expect(text).not.toContain("Buka Detail");
  });
});

describe("URL publik untuk tautan detail", () => {
  it("https dipakai; http non-loopback dan kosong ditolak", () => {
    expect(publicAppUrl({ DTIC_APP_URL: "https://dtic.example.com/" })).toBe("https://dtic.example.com");
    expect(publicAppUrl({ DTIC_APP_URL: "http://dtic.example.com" })).toBeNull();
    expect(publicAppUrl({})).toBeNull();
    expect(publicAppUrl({ DTIC_APP_URL: "bukan url" })).toBeNull();
  });
  it("localhost tidak pernah dikirim sebagai tautan (penerima ada di perangkat lain)", () => {
    expect(publicAppUrl({ DTIC_APP_URL: "http://localhost:3000", NODE_ENV: "production" })).toBeNull();
    expect(publicAppUrl({ DTIC_APP_URL: "http://localhost:3000", NODE_ENV: "development" })).toBeNull();
  });
});

describe("pesan galat aman dan spesifik", () => {
  it("menyertakan error_code dan description asli dari Telegram", () => {
    expect(telegramErrorMessage(400, "Bad Request: chat not found")).toContain("Respons Telegram: 400 Bad Request: chat not found.");
    expect(telegramErrorMessage(401, "Unauthorized")).toMatch(/401 Unauthorized/);
  });
  it("chat tidak ditemukan (400) menunjuk chat pribadi dan /start", () => {
    const msg = telegramErrorMessage(400, "Bad Request: chat not found");
    expect(msg).toMatch(/chat not found/);
    expect(msg).toMatch(/\/start/);
    expect(msg).toMatch(/Integrasi Telegram/);
  });
  it("diblokir pengguna (403) dibedakan dari izin grup", () => {
    const blocked = telegramErrorMessage(403, "Forbidden: bot was blocked by the user");
    expect(blocked).toMatch(/diblokir/);
    expect(blocked).not.toMatch(/grup/);
    const group = telegramErrorMessage(403, "Forbidden: bot is not a member of the supergroup chat");
    expect(group).toMatch(/grup\/kanal/);
    expect(group).not.toMatch(/diblokir/);
  });
  it("chat ID menunjuk bot sendiri (403 can't send messages to bots) dibedakan dari izin grup", () => {
    const msg = telegramErrorMessage(403, "Forbidden: the bot can't send messages to the bot");
    expect(msg).toMatch(/mengarah ke bot/);
    expect(msg).toMatch(/getUpdates/);
    expect(msg).not.toMatch(/grup/);
  });
  it("belum /start (403 can't initiate conversation) dikenali", () => {
    expect(telegramErrorMessage(403, "Forbidden: bot can't initiate conversation with a user")).toMatch(/kirim \/start/);
  });
  it("status lain tetap punya pesan jelas", () => {
    expect(telegramErrorMessage(429)).toMatch(/dicoba lagi/);
    expect(telegramErrorMessage(502)).toMatch(/dicoba lagi/);
    expect(telegramErrorMessage(418)).toBe("Telegram menolak permintaan (418). Respons Telegram: 418.");
  });
  it("token dan URL dalam description disaring", () => {
    const msg = telegramErrorMessage(400, `Bad Request ${TOKEN} https://api.telegram.org`);
    expect(msg).not.toContain(TOKEN);
    expect(msg).not.toContain("api.telegram.org");
    expect(msg).toContain("[token disembunyikan]");
  });
});

describe("pratinjau & pesan uji", () => {
  it("telegramHtmlToText mengembalikan teks biasa (tag dibuang, entitas dikembalikan)", () => {
    expect(telegramHtmlToText('<b>JUDUL</b> &lt;a&gt; &amp; <a href="tg://user?id=1">Nama</a>')).toBe("JUDUL <a> & Nama");
  });
  it("awalan pesan uji jelas dan tidak menyamar sebagai pekerjaan baru", () => {
    expect(TEST_MESSAGE_PREFIX).toContain("PESAN UJI");
    expect(TEST_MESSAGE_PREFIX).toContain("BUKAN PEKERJAAN BARU");
  });
});

describe("format pesan perubahan distribusi pekerjaan (PIC)", () => {
  const data = {
    orderId: "22222222-2222-4222-8222-222222222222",
    orderNumber: "DTIC-2026-00007",
    title: "Poster <Seminar> & Lingkungan",
    teamName: "Graphic Design",
    operation: "add" as const,
    before: ["Fathin Maqbulloh Sawiji"],
    after: ["Fathin Maqbulloh Sawiji", "Gilar Dwi Rahayu"],
    added: [{ fullName: "Gilar Dwi Rahayu", displayName: null, username: null, userId: null, status: "not_linked" as const }],
    removed: [] as string[],
    reason: "Tambah PIC untuk kolaborasi",
    actorName: "Daniel Manager",
    changedAt: new Date("2026-10-20T08:59:00Z"),
  };
  it("penambahan: judul distribusi, PIC lama tetap, daftar sebelum/sesudah berbutir, pelaku, alasan, waktu WIB, tautan", () => {
    const text = buildPicChangeMessage(data, "https://dtic.example");
    expect(text).toContain("PERUBAHAN DISTRIBUSI PEKERJAAN — DTIC CONNECT");
    expect(text).not.toContain("REQUEST PEKERJAAN BARU");
    expect(text).toContain("Nomor Pekerjaan: DTIC-2026-00007");
    expect(text).toContain("Operasi: Penambahan PIC");
    expect(text).toContain("PIC lama tetap ditugaskan.");
    expect(text).toContain("PIC Sebelumnya:\n• Fathin Maqbulloh Sawiji");
    expect(text).toContain("PIC Setelah Perubahan:\n• Fathin Maqbulloh Sawiji\n• Gilar Dwi Rahayu");
    expect(text).toContain("Diubah oleh: Daniel Manager");
    expect(text).toContain("Alasan: Tambah PIC untuk kolaborasi");
    expect(text).toMatch(/Waktu Perubahan: .+ WIB/);
    expect(text).not.toMatch(/WIB WIB/);
    expect(text).toContain("Lihat Pekerjaan: https://dtic.example/dtic/orders/22222222-2222-4222-8222-222222222222");
  });
  it("pemindahan: PIC dilepas dan PIC penerima disebut", () => {
    const text = buildPicChangeMessage({ ...data, operation: "move", before: ["Fathin Maqbulloh Sawiji"], after: ["Gilar Dwi Rahayu"], removed: ["Fathin Maqbulloh Sawiji"] }, null);
    expect(text).toContain("Operasi: Pemindahan Pekerjaan");
    expect(text).toContain("PIC dilepas: Fathin Maqbulloh Sawiji");
    expect(text).toContain("PIC penerima pekerjaan:");
    expect(text).not.toContain("PIC lama tetap ditugaskan.");
  });
  it("penggantian & penghapusan memakai label yang sesuai", () => {
    expect(buildPicChangeMessage({ ...data, operation: "replace" }, null)).toContain("Operasi: Penggantian PIC");
    expect(buildPicChangeMessage({ ...data, operation: "remove", added: [], removed: ["Gilar Dwi Rahayu"] }, null)).toContain("Operasi: Penghapusan PIC");
  });
  it("karakter khusus di-escape; field kosong tidak tampil dengan nilai palsu", () => {
    const text = buildPicChangeMessage({ ...data, reason: null, actorName: null, teamName: null }, null);
    expect(text).toContain("Poster &lt;Seminar&gt; &amp; Lingkungan");
    expect(text).not.toMatch(/Alasan:|Diubah oleh:|Kategori:|Lihat Pekerjaan:/);
  });
});

describe("template order: tindakan selanjutnya dan tautan berlabel", () => {
  const d = {
    id: "11111111-1111-4111-8111-111111111111",
    orderNumber: "DTIC-2026-00007",
    status: "assigned" as const,
    title: "Desain Poster",
    teamName: "Graphic Design",
    designType: "Poster",
    brandName: "LSP PLI",
    priorityName: "Normal",
    deadlineAt: new Date("2026-10-20T16:59:00Z"),
    brief: "Brief uji",
    attachmentCount: 0,
    requesterName: "Ani",
    department: "Marketing",
    picInfos: [{ fullName: "Fathin Maqbulloh Sawiji", displayName: null, username: null, userId: null, status: "not_linked" as const }],
  } as unknown as Parameters<typeof buildOrderMessage>[0];
  it("langkah bernomor menjelaskan cara membuka detail dan login", () => {
    const text = buildOrderMessage(d, "https://dtic.example");
    expect(text).toContain("1. <a href=");
    expect(text).toContain("perlu login akun DTIC");
    expect(text).toContain("2. Periksa brief, tenggat, dan lampiran.");
    expect(text).toContain("3. Mulai pengerjaan sesuai status dan alur kerja yang berlaku.");
  });
  it("tanpa URL publik tidak ada tautan dan tidak ada URL localhost", () => {
    const text = buildOrderMessage(d, null);
    expect(text).not.toContain("<a href");
    expect(text).toContain("Buka sistem DTIC Connect lalu cari nomor order");
    expect(text).not.toMatch(/localhost|127\.0\.0\.1/);
  });
  it("URL dengan tanda kutip tidak merusak atribut href", () => {
    const text = buildOrderMessage(d, "https://dtic.example/x\"onmouseover=1");
    expect(text).not.toContain("\"onmouseover=1\">");
  });
});
