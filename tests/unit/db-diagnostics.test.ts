import { describe, expect, it } from "vitest";
import { diagnoseDbError, isRetryableDbError, withTransientRetry } from "@/lib/server/db-diagnostics";

const pgError = (code: string, message = "") => Object.assign(new Error(message), { code });

describe("diagnosis error database (aman, tanpa rahasia)", () => {
  it("batas koneksi session pooler dikenali dari kode atau pesan", () => {
    expect(diagnoseDbError(pgError("EMAXCONNSESSION", "max clients reached in session mode"))).toMatch(/Batas koneksi database tercapai/);
    expect(diagnoseDbError(pgError("53300", "too many connections"))).toMatch(/DB_POOL_MAX/);
    expect(diagnoseDbError(pgError("XX000", "max clients reached in session mode"))).toMatch(/Transaction Pooler/);
  });
  it("error lain tetap diklasifikasi seperti sebelumnya; error bukan database → null", () => {
    expect(diagnoseDbError(pgError("ECONNREFUSED", "connect ECONNREFUSED"))).toMatch(/ECONNREFUSED/);
    expect(diagnoseDbError(new Error("validasi gagal"))).toBeNull();
  });
  it("hint tidak memuat kredensial atau URL", () => {
    const hint = diagnoseDbError(pgError("EMAXCONNSESSION", "max clients reached postgres://user:secret@host:5432/db")) ?? "";
    expect(hint).not.toMatch(/secret|postgres:\/\/|user:/);
  });
});

describe("klasifikasi error sementara (aman diulang) vs permanen", () => {
  it("deadlock, serialization failure, lock timeout, query canceled, dan koneksi terputus dikenali sebagai sementara", () => {
    for (const code of ["40P01", "40001", "55P03", "57014", "08006", "08003", "08001", "08004"]) {
      expect(diagnoseDbError(pgError(code))).toMatch(/coba lagi|belum tersimpan/);
      expect(isRetryableDbError(pgError(code))).toBe(true);
    }
  });
  it("error permanen (kredensial, tabel hilang) TIDAK dianggap sementara", () => {
    expect(isRetryableDbError(pgError("28P01"))).toBe(false);
    expect(isRetryableDbError(pgError("42P01"))).toBe(false);
    expect(isRetryableDbError(new Error("validasi gagal"))).toBe(false);
  });
});

describe("withTransientRetry", () => {
  it("mengulang SEKALI untuk error sementara, lalu berhasil; jeda di antara percobaan", async () => {
    let calls = 0;
    const start = Date.now();
    const result = await withTransientRetry(async () => {
      calls++;
      if (calls === 1) throw pgError("55P03", "lock_not_available");
      return "ok";
    }, 2, 10);
    expect(result).toBe("ok");
    expect(calls).toBe(2);
    expect(Date.now() - start).toBeGreaterThanOrEqual(9);
  });
  it("melempar langsung tanpa mengulang bila error BUKAN sementara (mis. AppError validasi)", async () => {
    let calls = 0;
    await expect(
      withTransientRetry(async () => {
        calls++;
        throw new Error("validasi gagal");
      }),
    ).rejects.toThrow("validasi gagal");
    expect(calls).toBe(1);
  });
  it("melempar error asli setelah percobaan habis (tidak disembunyikan sebagai sukses)", async () => {
    let calls = 0;
    await expect(
      withTransientRetry(async () => {
        calls++;
        throw pgError("40P01", "deadlock");
      }, 2, 1),
    ).rejects.toMatchObject({ code: "40P01" });
    expect(calls).toBe(2);
  });
});
