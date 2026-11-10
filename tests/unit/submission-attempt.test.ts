import { describe, expect, it } from "vitest";
import { adoptAttempt, ATTEMPT_MAX_AGE_MS, clearAttempt, fingerprintOf, loadAttempt } from "@/lib/client/submission-attempt";

function memoryStore() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

const KEY_A = "11111111-1111-4111-8111-111111111111";
const KEY_B = "22222222-2222-4222-8222-222222222222";
const raw = { submissionKey: KEY_A, requesterName: "Ani", title: "Cover Laporan", deadline: "2026-11-16" };

describe("fingerprintOf", () => {
  it("tidak terpengaruh kunci pengajuan atau urutan field/PIC/berkas", () => {
    const a = fingerprintOf(raw, ["p1", "p2"], [{ name: "a.pdf", size: 10 }, { name: "b.png", size: 20 }]);
    const b = fingerprintOf({ deadline: raw.deadline, title: raw.title, requesterName: raw.requesterName, submissionKey: KEY_B }, ["p2", "p1"], [{ name: "b.png", size: 20 }, { name: "a.pdf", size: 10 }]);
    expect(a).toBe(b);
  });

  it("berubah bila isian, PIC, atau berkas berubah", () => {
    const base = fingerprintOf(raw, ["p1"], []);
    expect(fingerprintOf({ ...raw, title: "Judul lain" }, ["p1"], [])).not.toBe(base);
    expect(fingerprintOf(raw, ["p2"], [])).not.toBe(base);
    expect(fingerprintOf(raw, ["p1"], [{ name: "a.pdf", size: 1 }])).not.toBe(base);
  });
});

describe("adoptAttempt", () => {
  it("mencatat upaya baru bila belum ada", () => {
    const store = memoryStore();
    const a = adoptAttempt("fp1", KEY_A, 1000, store);
    expect(a).toEqual({ key: KEY_A, fingerprint: "fp1", startedAt: 1000 });
    expect(loadAttempt(1500, store)).toEqual(a);
  });

  it("memakai kunci LAMA bila isian sama (mencegah order ganda setelah muat ulang)", () => {
    const store = memoryStore();
    adoptAttempt("fp1", KEY_A, 1000, store);
    const again = adoptAttempt("fp1", KEY_B, 5000, store);
    expect(again.key).toBe(KEY_A);
    expect(again.startedAt).toBe(1000);
  });

  it("memakai kunci BARU bila isian berbeda (pengajuan lain)", () => {
    const store = memoryStore();
    adoptAttempt("fp1", KEY_A, 1000, store);
    const other = adoptAttempt("fp2", KEY_B, 2000, store);
    expect(other.key).toBe(KEY_B);
    expect(loadAttempt(2500, store)?.key).toBe(KEY_B);
  });

  it("membuang catatan yang sudah kedaluwarsa", () => {
    const store = memoryStore();
    adoptAttempt("fp1", KEY_A, 1000, store);
    expect(loadAttempt(1000 + ATTEMPT_MAX_AGE_MS + 1, store)).toBeNull();
    const fresh = adoptAttempt("fp1", KEY_B, 1000 + ATTEMPT_MAX_AGE_MS + 2, store);
    expect(fresh.key).toBe(KEY_B);
  });

  it("menolak catatan rusak/bukan UUID tanpa error", () => {
    const store = memoryStore();
    store.setItem("dtic-submission-attempt-v1", JSON.stringify({ key: "bukan-uuid", fingerprint: "x", startedAt: 1 }));
    expect(loadAttempt(2, store)).toBeNull();
    store.setItem("dtic-submission-attempt-v1", "{rusak");
    expect(loadAttempt(2, store)).toBeNull();
  });

  it("clearAttempt menghapus catatan; tanpa penyimpanan tidak error", () => {
    const store = memoryStore();
    adoptAttempt("fp1", KEY_A, 1000, store);
    clearAttempt(store);
    expect(loadAttempt(1100, store)).toBeNull();
    expect(adoptAttempt("fp1", KEY_B, 1, null).key).toBe(KEY_B);
    expect(() => clearAttempt(null)).not.toThrow();
  });
});
