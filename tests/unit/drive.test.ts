import { describe, expect, it } from "vitest";
import { DriveApiError, driveAdminStatus, driveFolderPath, driveResultFileName, driveResultFolderPath, isRetryableDriveError, sanitizeDriveSegment } from "@/lib/drive";
import { resolveDriveConfig } from "@/lib/server/drive/config";

describe("klasifikasi error Drive (aman diulang vs permanen)", () => {
  it("timeout/429/5xx aman diulang; 403/404 tidak", () => {
    expect(isRetryableDriveError(new DriveApiError("x", "transient", 503))).toBe(true);
    expect(isRetryableDriveError(new DriveApiError("x", "transient", 429))).toBe(true);
    expect(isRetryableDriveError(new DriveApiError("x", "permanent", 403))).toBe(false);
    expect(isRetryableDriveError(new DriveApiError("x", "permanent", 404))).toBe(false);
  });
  it("error bukan DriveApiError bukan sementara", () => {
    expect(isRetryableDriveError(new Error("lain"))).toBe(false);
  });
});

describe("jalur folder Drive A", () => {
  it("tahun lalu nomor order (nomor order = identitas internal, bukan nama dari pengguna)", () => {
    expect(driveFolderPath("DTIC-2026-00009", 2026)).toEqual(["2026", "DTIC-2026-00009"]);
  });
});

describe("resolveDriveConfig (MURNI, tanpa rahasia yang ditampilkan)", () => {
  it("semua variabel kosong → fitur nonaktif, bukan error", () => {
    expect(resolveDriveConfig({})).toEqual({ ok: false, problem: null });
  });
  it("kredensial terisi tapi root folder kosong → problem jelas", () => {
    const r = resolveDriveConfig({ GOOGLE_SERVICE_ACCOUNT_EMAIL: "a@x.iam.gserviceaccount.com", GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----" });
    expect(r).toMatchObject({ ok: false });
    expect((r as { problem: string }).problem).toMatch(/GOOGLE_DRIVE_ROOT_FOLDER_ID/);
  });
  it("hanya salah satu dari email/private key terisi → problem, bukan nonaktif diam-diam", () => {
    const r = resolveDriveConfig({ GOOGLE_SERVICE_ACCOUNT_EMAIL: "a@x.iam.gserviceaccount.com", GOOGLE_DRIVE_ROOT_FOLDER_ID: "1AbCdEfGhIjKlMnOpQrSt" });
    expect(r).toMatchObject({ ok: false });
    expect((r as { problem: string }).problem).toMatch(/GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY/);
  });
  it("root folder id tidak terlihat valid → problem", () => {
    const r = resolveDriveConfig({
      GOOGLE_SERVICE_ACCOUNT_EMAIL: "a@x.iam.gserviceaccount.com",
      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----",
      GOOGLE_DRIVE_ROOT_FOLDER_ID: "!!!",
    });
    expect(r).toMatchObject({ ok: false });
  });
  it("lengkap via dua variabel terpisah → ok, newline literal private key diterjemahkan", () => {
    const r = resolveDriveConfig({
      GOOGLE_SERVICE_ACCOUNT_EMAIL: "a@x.iam.gserviceaccount.com",
      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----",
      GOOGLE_DRIVE_ROOT_FOLDER_ID: "1AbCdEfGhIjKlMnOpQrSt",
    });
    expect(r).toMatchObject({ ok: true, serviceAccountEmail: "a@x.iam.gserviceaccount.com", rootFolderId: "1AbCdEfGhIjKlMnOpQrSt", sharedDriveId: null });
    expect((r as { privateKeyPem: string }).privateKeyPem).toContain("\n");
    expect((r as { privateKeyPem: string }).privateKeyPem).not.toContain("\\n");
  });
  it("lengkap via GOOGLE_SERVICE_ACCOUNT_JSON", () => {
    const json = JSON.stringify({ client_email: "svc@x.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----" });
    const r = resolveDriveConfig({ GOOGLE_SERVICE_ACCOUNT_JSON: json, GOOGLE_DRIVE_ROOT_FOLDER_ID: "1AbCdEfGhIjKlMnOpQrSt", GOOGLE_DRIVE_SHARED_DRIVE_ID: "0AbCdEfGhIjKlMnOpQrSt" });
    expect(r).toMatchObject({ ok: true, serviceAccountEmail: "svc@x.iam.gserviceaccount.com", sharedDriveId: "0AbCdEfGhIjKlMnOpQrSt" });
  });
  it("GOOGLE_SERVICE_ACCOUNT_JSON tidak valid → problem, bukan crash", () => {
    const r = resolveDriveConfig({ GOOGLE_SERVICE_ACCOUNT_JSON: "{bukan json", GOOGLE_DRIVE_ROOT_FOLDER_ID: "1AbCdEfGhIjKlMnOpQrSt" });
    expect(r).toMatchObject({ ok: false });
  });
});

describe("driveAdminStatus (dashboard Super Admin, MURNI — tanpa I/O)", () => {
  it("belum ada env sama sekali → not_configured", () => {
    expect(driveAdminStatus({ configOk: false, configProblem: null, enabled: false, lastTestOk: null })).toBe("not_configured");
  });
  it("sebagian env terisi salah → config_invalid, bukan not_configured", () => {
    expect(driveAdminStatus({ configOk: false, configProblem: "GOOGLE_DRIVE_ROOT_FOLDER_ID kosong.", enabled: false, lastTestOk: null })).toBe("config_invalid");
  });
  it("konfigurasi lengkap, belum pernah diuji → ready_untested", () => {
    expect(driveAdminStatus({ configOk: true, configProblem: null, enabled: false, lastTestOk: null })).toBe("ready_untested");
  });
  it("pengujian terakhir gagal → test_failed, bukan ready_untested", () => {
    expect(driveAdminStatus({ configOk: true, configProblem: null, enabled: false, lastTestOk: false })).toBe("test_failed");
  });
  it("pengujian berhasil tapi belum diaktifkan Super Admin → connected_inactive, bukan active", () => {
    expect(driveAdminStatus({ configOk: true, configProblem: null, enabled: false, lastTestOk: true })).toBe("connected_inactive");
  });
  it("diaktifkan dan konfigurasi valid → active", () => {
    expect(driveAdminStatus({ configOk: true, configProblem: null, enabled: true, lastTestOk: true })).toBe("active");
  });
  it("sudah diaktifkan sebelumnya, tapi konfigurasi env sekarang rusak/dihapus → active_config_broken, bukan active maupun not_configured", () => {
    expect(driveAdminStatus({ configOk: false, configProblem: "GOOGLE_DRIVE_ROOT_FOLDER_ID kosong.", enabled: true, lastTestOk: true })).toBe("active_config_broken");
    expect(driveAdminStatus({ configOk: false, configProblem: null, enabled: true, lastTestOk: true })).toBe("active_config_broken");
  });
});

describe("sanitizeDriveSegment (MURNI — nama folder/file Drive tidak pernah kosong atau memuat karakter bermasalah)", () => {
  it("huruf/angka/spasi biasa → spasi jadi tanda hubung", () => {
    expect(sanitizeDriveSegment("Budi Santoso", "x")).toBe("Budi-Santoso");
  });
  it("karakter terlarang Drive/OS dibuang", () => {
    expect(sanitizeDriveSegment('Desain: "Logo"/v2*?<>|', "x")).toBe("Desain-Logov2");
  });
  it("hasil kosong setelah sanitasi → pakai fallback, tidak pernah string kosong", () => {
    expect(sanitizeDriveSegment("   ", "Fallback")).toBe("Fallback");
    expect(sanitizeDriveSegment("///", "Fallback")).toBe("Fallback");
  });
  it("aksen/diakritik dilepas, bukan dibuang jadi kosong", () => {
    expect(sanitizeDriveSegment("Évéline", "x")).toBe("Eveline");
  });
});

describe("driveResultFolderPath (MURNI — {PIC}/{Tahun}/{Tanggal DD-MM-YYYY}/{Pemohon}/{NomorOrder - Judul}/{Kategori})", () => {
  const base = {
    picName: "Budi Santoso",
    submittedAt: new Date("2026-10-20T03:00:00.000Z"), // 10:00 WIB → 20-10-2026 — tanggal pengajuan QC PERTAMA, bukan tanggal order dibuat.
    requesterName: "PT Maju Jaya",
    orderNumber: "DTIC-2026-00123",
    orderTitle: "Poster Promo Akhir Tahun",
  };
  it("kategori proses_pengerjaan (draf)", () => {
    expect(driveResultFolderPath({ ...base, category: "proses_pengerjaan" })).toEqual([
      "Budi-Santoso", "2026", "20-10-2026", "PT-Maju-Jaya", "DTIC-2026-00123 - Poster-Promo-Akhir-Tahun", "02_Proses_Pengerjaan",
    ]);
  });
  it("kategori hasil_awal", () => {
    expect(driveResultFolderPath({ ...base, category: "hasil_awal" })).toEqual([
      "Budi-Santoso", "2026", "20-10-2026", "PT-Maju-Jaya", "DTIC-2026-00123 - Poster-Promo-Akhir-Tahun", "03_Hasil_Awal",
    ]);
  });
  it("kategori revisi (folder datar, tanpa sub-nomor revisi — nomor revisi ada di nama file, lihat driveResultFileName)", () => {
    expect(driveResultFolderPath({ ...base, category: "revisi" })).toEqual([
      "Budi-Santoso", "2026", "20-10-2026", "PT-Maju-Jaya", "DTIC-2026-00123 - Poster-Promo-Akhir-Tahun", "04_Revisi",
    ]);
  });
  it("kategori hasil_final", () => {
    expect(driveResultFolderPath({ ...base, category: "hasil_final" })).toEqual([
      "Budi-Santoso", "2026", "20-10-2026", "PT-Maju-Jaya", "DTIC-2026-00123 - Poster-Promo-Akhir-Tahun", "05_Hasil_Final",
    ]);
  });
  it("PIC belum ditentukan → folder 'Belum-Ada-PIC', bukan nama kosong/null", () => {
    expect(driveResultFolderPath({ ...base, picName: null, category: "hasil_awal" })[0]).toBe("Belum-Ada-PIC");
  });
  it("tanggal memakai format DD-MM-YYYY (bukan YYYY-MM-DD) sesuai permintaan", () => {
    expect(driveResultFolderPath({ ...base, category: "hasil_awal" })[2]).toBe("20-10-2026");
  });
  it("dua pekerjaan dari pemohon+PIC+tanggal yang sama TIDAK berbagi folder (nomor order membedakan)", () => {
    const a = driveResultFolderPath({ ...base, orderNumber: "DTIC-2026-00123", category: "hasil_awal" });
    const b = driveResultFolderPath({ ...base, orderNumber: "DTIC-2026-00124", orderTitle: "Banner Media Sosial", category: "hasil_awal" });
    expect(a[4]).not.toBe(b[4]);
  });
  it("judul panjang dipotong agar nama folder tidak melebihi batas wajar", () => {
    const seg = driveResultFolderPath({ ...base, orderTitle: "A".repeat(200), category: "hasil_awal" })[4];
    expect(seg.length).toBeLessThan(80);
  });
});

describe("driveResultFileName (MURNI — identitas lengkap LANGSUNG di nama file: nomor, pemohon, PIC, tahun, jenis, kategori, versi)", () => {
  const base = { orderNumber: "DTIC-2026-00123", requesterName: "PT Maju Jaya", picName: "Budi Santoso", designType: "Desain" };
  it("hasil awal", () => {
    expect(driveResultFileName({ ...base, category: "hasil_awal", version: 1, uploadedAt: new Date("2026-10-20T03:00:00.000Z"), ext: "pdf" }))
      .toBe("DTIC-2026-00123_PT-Maju-Jaya_Budi-Santoso_2026_Desain_Hasil-Awal_v01.pdf");
  });
  it("revisi menyertakan nomor revisi pada TIPE file", () => {
    expect(driveResultFileName({ ...base, category: "revisi", revisionNumber: 2, version: 3, uploadedAt: new Date("2026-10-21T03:00:00.000Z"), ext: "pdf" }))
      .toBe("DTIC-2026-00123_PT-Maju-Jaya_Budi-Santoso_2026_Desain_Revisi-02_v03.pdf");
  });
  it("hasil final ditandai FINAL", () => {
    expect(driveResultFileName({ ...base, category: "hasil_final", version: 4, uploadedAt: new Date("2026-10-23T03:00:00.000Z"), ext: "pdf" }))
      .toBe("DTIC-2026-00123_PT-Maju-Jaya_Budi-Santoso_2026_Desain_FINAL_v04.pdf");
  });
  it("PIC belum ditentukan → 'Belum-Ada-PIC', bukan nama kosong/null", () => {
    expect(driveResultFileName({ ...base, picName: null, category: "hasil_awal", version: 1, uploadedAt: new Date("2026-10-20T03:00:00.000Z"), ext: "pdf" }))
      .toBe("DTIC-2026-00123_PT-Maju-Jaya_Belum-Ada-PIC_2026_Desain_Hasil-Awal_v01.pdf");
  });
  it("nama pemohon/PIC yang sangat panjang tidak boleh memotong akhiran versi (pembeda antar-versi file)", () => {
    const nama = "A".repeat(200);
    const v1 = driveResultFileName({ ...base, requesterName: nama, picName: nama, category: "hasil_awal", version: 1, uploadedAt: new Date("2026-10-20T03:00:00.000Z"), ext: "pdf" });
    const v2 = driveResultFileName({ ...base, requesterName: nama, picName: nama, category: "hasil_awal", version: 2, uploadedAt: new Date("2026-10-20T03:00:00.000Z"), ext: "pdf" });
    expect(v1.endsWith("_v01.pdf")).toBe(true);
    expect(v2.endsWith("_v02.pdf")).toBe(true);
    expect(v1).not.toBe(v2);
  });
});
