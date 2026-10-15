import { describe, expect, it } from "vitest";
import { formatWhatsappDisplay, normalizeIdWhatsapp, whatsappLink } from "@/lib/whatsapp";

const ok = (input: string) => {
  const r = normalizeIdWhatsapp(input);
  if (!r.ok) throw new Error(`seharusnya valid: ${input} → ${r.message}`);
  return r.value;
};
const bad = (input: string) => {
  const r = normalizeIdWhatsapp(input);
  if (r.ok) throw new Error(`seharusnya ditolak: ${input}`);
  return r.message;
};

describe("normalisasi nomor WhatsApp Indonesia", () => {
  it("format lokal, internasional, dan variasi penulisan menghasilkan nilai yang sama", () => {
    const expected = "6281234567890";
    for (const input of ["081234567890", "+6281234567890", "+62 812-3456-7890", "62 812 3456 7890", "(0812) 3456.7890", "+62 0812 3456 7890", " 081234567890 "]) {
      expect(ok(input)).toBe(expected);
    }
  });
  it("kosong ditolak dengan pesan yang jelas", () => {
    expect(bad("")).toBe("Nomor WhatsApp wajib diisi.");
    expect(bad("   ")).toBe("Nomor WhatsApp wajib diisi.");
  });
  it("huruf dan karakter asing ditolak", () => {
    expect(bad("0812abc4567")).toMatch(/hanya boleh berisi angka/);
  });
  it("kode negara selain Indonesia ditolak", () => {
    expect(bad("+6581234567")).toMatch(/\+62/);
  });
  it("nomor bukan seluler (tidak diawali 8) atau terlalu pendek/panjang ditolak", () => {
    expect(bad("0212345678")).toMatch(/tidak valid/);
    expect(bad("0812345")).toMatch(/tidak valid/);
    expect(bad("081234567890123")).toMatch(/tidak valid/);
  });
  it("tampilan dan tautan wa.me memakai nomor ternormalisasi", () => {
    expect(formatWhatsappDisplay("6281234567890")).toBe("+6281234567890");
    expect(whatsappLink("6281234567890")).toBe("https://wa.me/6281234567890");
  });
});
