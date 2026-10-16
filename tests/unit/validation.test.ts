import { describe, expect, it } from "vitest";
import { toFieldErrors } from "@/lib/validation/common";
import { brandUpdateSchema, slugify } from "@/lib/validation/brand";
import { orderSubmissionSchema, orderUpdateSchema, statusChangeSchema } from "@/lib/validation/order";

const doc = (text: string) => JSON.stringify({ type: "doc", content: text.split("\n").map((t) => ({ type: "paragraph", content: [{ type: "text", text: t }] })) });

const valid = {
  submissionKey: "2f1d7c4e-8a7b-4c1e-9d55-0e7d3c6b9a10",
  requesterName: "Ani Lestari",
  requesterWhatsapp: "081234567890",
  title: "Poster Promo Akhir Tahun",
  teamId: "9a3e1f20-7b6c-4d5e-8f10-2a3b4c5d6e7f",
  picIds: ["1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d"],
  brandId: "6c1b2a8e-3f4d-4e5a-9b6c-7d8e9f0a1b2c",
  department: "Marketing",
  designTypeId: "0b7f4d2e-1c3a-4e5f-8a9b-1c2d3e4f5a6b",
  sizePreset: "A4",
  briefDoc: doc("Poster Promo Akhir Tahun\nDiskon 20% untuk seluruh produk."),
  deadline: "2099-01-01",
};

describe("orderSubmissionSchema", () => {
  it("menerima input valid; deadline tanggal → 23.59 WIB; brief → dokumen + teks polos", () => {
    const r = orderSubmissionSchema.parse(valid);
    expect(r.deadlineAt.toISOString()).toBe("2099-01-01T16:59:00.000Z");
    expect(r.designSize).toBe("A4 (21 × 29,7 cm)");
    expect(r.brief).toBe("Poster Promo Akhir Tahun\nDiskon 20% untuk seluruh produk.");
    expect(r.briefRich.type).toBe("doc");
    expect(r.priority).toBeNull(); // → default dari konfigurasi server
    expect(r.driveUrl).toBeNull();
  });

  it("melaporkan field wajib yang kosong", () => {
    const r = orderSubmissionSchema.safeParse({ submissionKey: valid.submissionKey });
    expect(r.success).toBe(false);
    const fe = toFieldErrors(r.error!);
    for (const k of ["requesterName", "requesterWhatsapp", "title", "teamId", "picIds", "brandId", "department", "designTypeId", "sizePreset", "briefDoc", "deadline"]) {
      expect(fe[k], k).toBeTruthy();
    }
  });

  it("nomor WhatsApp wajib dan dinormalisasi ke 628… saat disimpan", () => {
    const out = orderSubmissionSchema.parse({ ...valid, requesterWhatsapp: "+62 812-3456-7890" });
    expect(out.requesterWhatsapp).toBe("6281234567890");
    const bad = toFieldErrors(orderSubmissionSchema.safeParse({ ...valid, requesterWhatsapp: "12345" }).error!);
    expect(bad.requesterWhatsapp).toMatch(/tidak valid/);
    const empty = toFieldErrors(orderSubmissionSchema.safeParse({ ...valid, requesterWhatsapp: "" }).error!);
    expect(empty.requesterWhatsapp).toMatch(/wajib/);
  });

  it("brief rich text: minimal 10 karakter teks, JSON rusak ditolak", () => {
    expect(toFieldErrors(orderSubmissionSchema.safeParse({ ...valid, briefDoc: doc("pendek") }).error!).briefDoc).toMatch(/minimal 10/);
    expect(toFieldErrors(orderSubmissionSchema.safeParse({ ...valid, briefDoc: "{bukan json" }).error!).briefDoc).toMatch(/tidak valid/);
  });

  it("menolak tanggal deadline sebelum hari ini, menerima hari ini", () => {
    const past = orderSubmissionSchema.safeParse({ ...valid, deadline: "2020-01-01" });
    expect(toFieldErrors(past.error!).deadline).toMatch(/sebelum hari ini/);
    const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
    expect(orderSubmissionSchema.safeParse({ ...valid, deadline: today }).success).toBe(true);
    expect(orderSubmissionSchema.safeParse({ ...valid, deadline: "2026-02-30" }).success).toBe(false);
  });

  it("ukuran custom wajib lebar & tinggi (cm)", () => {
    const bad = orderSubmissionSchema.safeParse({ ...valid, sizePreset: "custom", customWidth: "30" });
    expect(toFieldErrors(bad.error!).customHeight).toBeTruthy();
    const ok = orderSubmissionSchema.parse({ ...valid, sizePreset: "custom", customWidth: "30,5", customHeight: "40" });
    expect(ok.designSize).toBe("Custom 30,5 × 40 cm");
  });

  it("URL Google Drive: hanya https drive/docs.google.com", () => {
    const ok = orderSubmissionSchema.parse({ ...valid, driveUrl: "https://drive.google.com/drive/folders/abc123" });
    expect(ok.driveUrl).toBe("https://drive.google.com/drive/folders/abc123");
    for (const bad of ["http://drive.google.com/x", "https://drive.google.com.evil.com/x", "javascript:alert(1)", "https://user:pw@drive.google.com/x", "drive.google.com/x"]) {
      expect(orderSubmissionSchema.safeParse({ ...valid, driveUrl: bad }).success, bad).toBe(false);
    }
  });

  it("jenis & prioritas berupa identifier; field asing diabaikan", () => {
    expect(orderSubmissionSchema.safeParse({ ...valid, designTypeId: "Poster" }).success).toBe(false);
    expect(orderSubmissionSchema.safeParse({ ...valid, priority: "URGENT!" }).success).toBe(false);
    const r = orderSubmissionSchema.parse({ ...valid, priority: "urgent", status: "closed", orderNumber: "DTIC-2026-99999", internalNotes: "x" });
    expect(r.priority).toBe("urgent");
    expect(r).not.toHaveProperty("status");
    expect(r).not.toHaveProperty("orderNumber");
    expect(r).not.toHaveProperty("internalNotes");
  });
});

describe("judul pekerjaan", () => {
  it("disimpan sebagai field tersendiri, tidak diturunkan dari deskripsi", () => {
    const r = orderSubmissionSchema.parse({ ...valid, title: "  Desain Poster Seminar Lingkungan 2026  " });
    expect(r.title).toBe("Desain Poster Seminar Lingkungan 2026");
    expect(r.brief).toBe("Poster Promo Akhir Tahun\nDiskon 20% untuk seluruh produk.");
  });
  it("menolak judul kosong, terlalu pendek, atau lebih dari 160 karakter (API langsung juga)", () => {
    for (const title of ["", "   ", "ab", "x".repeat(161)]) {
      const r = orderSubmissionSchema.safeParse({ ...valid, title });
      expect(r.success, JSON.stringify(title.slice(0, 10))).toBe(false);
      expect(toFieldErrors(r.error!).title).toBeTruthy();
    }
    const missing = { ...valid } as Record<string, unknown>;
    delete missing.title;
    expect(toFieldErrors(orderSubmissionSchema.safeParse(missing).error!).title).toBeTruthy();
  });
});

describe("skema internal", () => {
  it("edit order menolak field sensitif (strict)", () => {
    const base = {
      requesterName: "Ani", requesterWhatsapp: "", company: "", department: "Marketing", brandId: valid.brandId, designTypeId: valid.designTypeId,
      designSize: "A4", title: "Poster Promo", briefDoc: JSON.parse(valid.briefDoc), driveUrl: "", deadline: "2026-10-15T23:59",
      priority: "urgent", briefYear: "", briefReference: "", designRequirements: "",
    };
    const ok = orderUpdateSchema.parse(base);
    expect(ok.company).toBeNull();
    expect(ok.brief).toContain("Poster Promo Akhir Tahun");
    expect(orderUpdateSchema.safeParse({ ...base, status: "closed" }).success).toBe(false);
    expect(orderUpdateSchema.safeParse({ ...base, orderNumber: "X" }).success).toBe(false);
  });

  it("status harus salah satu status yang dikenal", () => {
    expect(statusChangeSchema.safeParse({ status: "in_progress" }).success).toBe(true);
    expect(statusChangeSchema.safeParse({ status: "deleted" }).success).toBe(false);
  });

  it("brand: slug tervalidasi", () => {
    expect(brandUpdateSchema.safeParse({ name: "Brand A", slug: "brand-a", isActive: true }).success).toBe(true);
    expect(brandUpdateSchema.safeParse({ name: "Brand A", slug: "Brand A!", isActive: true }).success).toBe(false);
    expect(slugify("Kopi Nusantara Café")).toBe("kopi-nusantara-cafe");
  });
});

describe("assigneesSchema (koreksi PIC oleh Super Admin)", () => {
  it("menerima minimal satu uuid (duplikat dibuang); kosong dan selain uuid ditolak", async () => {
    const { assigneesSchema } = await import("@/lib/validation/order");
    const id = "6c1b2a8e-3f4d-4e5a-9b6c-7d8e9f0a1b2c";
    const reason = "Redistribusi beban kerja";
    expect(assigneesSchema.parse({ memberIds: [id, id], reason }).memberIds).toEqual([id]);
    expect(assigneesSchema.safeParse({ memberIds: [], reason }).success).toBe(false);
    expect(assigneesSchema.safeParse({ memberIds: ["Nuri Khusnaini"], reason }).success).toBe(false);
    expect(assigneesSchema.safeParse({ memberIds: [id], names: ["x"], reason }).success).toBe(false);
  });

  it("alasan wajib (min 5 karakter) dan expectedMemberIds harus uuid", async () => {
    const { assigneesSchema } = await import("@/lib/validation/order");
    const id = "6c1b2a8e-3f4d-4e5a-9b6c-7d8e9f0a1b2c";
    expect(assigneesSchema.safeParse({ memberIds: [id] }).success).toBe(false);
    expect(assigneesSchema.safeParse({ memberIds: [id], reason: "abc" }).success).toBe(false);
    expect(assigneesSchema.safeParse({ memberIds: [id], reason: "   " }).success).toBe(false);
    expect(assigneesSchema.safeParse({ memberIds: [id], reason: "Alasan cukup", expectedMemberIds: ["bukan-uuid"] }).success).toBe(false);
    expect(assigneesSchema.safeParse({ memberIds: [id], reason: "Alasan cukup", expectedMemberIds: [id] }).success).toBe(true);
  });
});

describe("kategori & PIC pilihan pemohon (anggota tim)", () => {
  const A = "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";
  const B = "2c3d4e5f-6071-4b8c-9d0e-1f2a3b4c5d6e";
  const C = "3d4e5f60-7182-4c9d-8e1f-2a3b4c5d6e7f";
  it("kategori (teamId) wajib berupa uuid", () => {
    const { teamId: _ignored, ...rest } = valid;
    void _ignored;
    expect(orderSubmissionSchema.safeParse(rest).success).toBe(false);
    expect(orderSubmissionSchema.safeParse({ ...valid, teamId: "bukan-uuid" }).success).toBe(false);
  });
  it("satu, dua, atau tiga PIC diterima", () => {
    expect(orderSubmissionSchema.parse({ ...valid, picIds: [A] }).picIds).toEqual([A]);
    expect(orderSubmissionSchema.parse({ ...valid, picIds: [A, B] }).picIds).toEqual([A, B]);
    expect(orderSubmissionSchema.parse({ ...valid, picIds: [A, B, C] }).picIds).toEqual([A, B, C]);
  });
  it("tanpa PIC, PIC duplikat, atau ID tidak valid ditolak", () => {
    expect(orderSubmissionSchema.safeParse({ ...valid, picIds: [] }).success).toBe(false);
    const { picIds: _p, ...noPics } = valid;
    void _p;
    expect(orderSubmissionSchema.safeParse(noPics).success).toBe(false);
    expect(orderSubmissionSchema.safeParse({ ...valid, picIds: [A, A] }).success).toBe(false);
    expect(orderSubmissionSchema.safeParse({ ...valid, picIds: ["bukan-uuid"] }).success).toBe(false);
  });
  it("field PIC lain dari klien (picId/assigneeIds) tidak ikut ke hasil validasi", () => {
    const parsed = orderSubmissionSchema.parse({ ...valid, picId: B, assigneeIds: [C] }) as Record<string, unknown>;
    expect(parsed.picId).toBeUndefined();
    expect(parsed.assigneeIds).toBeUndefined();
  });
  it("ukuran 'na' diterima untuk pekerjaan non-desain", () => {
    expect(orderSubmissionSchema.safeParse({ ...valid, sizePreset: "na" }).success).toBe(true);
  });
});

describe("perubahan deadline & jam deadline pemohon", () => {
  it("jam kosong = akhir hari 23.59 WIB; jam diisi dipakai sebagai WIB", async () => {
    const { deadlineChangeSchema } = await import("@/lib/validation/order");
    const endOfDay = deadlineChangeSchema.parse({ deadlineDate: "2099-01-01", reason: "Alasan cukup" });
    expect(endOfDay.deadlineAt.toISOString()).toBe("2099-01-01T16:59:00.000Z");
    const nine = deadlineChangeSchema.parse({ deadlineDate: "2099-01-01", deadlineTime: "09:30", reason: "Alasan cukup" });
    expect(nine.deadlineAt.toISOString()).toBe("2099-01-01T02:30:00.000Z");
  });
  it("alasan pendek, tanggal tak valid, dan jam tak valid ditolak", async () => {
    const { deadlineChangeSchema } = await import("@/lib/validation/order");
    expect(deadlineChangeSchema.safeParse({ deadlineDate: "2099-01-01", reason: "abc" }).success).toBe(false);
    expect(deadlineChangeSchema.safeParse({ deadlineDate: "2099-02-31", reason: "Alasan cukup" }).success).toBe(false);
    expect(deadlineChangeSchema.safeParse({ deadlineDate: "2099-01-01", deadlineTime: "25:00", reason: "Alasan cukup" }).success).toBe(false);
    expect(deadlineChangeSchema.safeParse({ deadlineDate: "2099-01-01", reason: "Alasan cukup", status: "completed" }).success).toBe(false);
  });
});
