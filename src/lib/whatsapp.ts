/**
 * Nomor WhatsApp Indonesia: validasi & normalisasi. MURNI (dipakai frontend, server, dan tes).
 *
 * Bentuk tersimpan: "628xxxxxxxxx" (kode negara tanpa "+", tanpa spasi/tanda baca).
 * Format itu langsung dipakai untuk tautan https://wa.me/<nomor>.
 */

export type WhatsappResult = { ok: true; value: string } | { ok: false; message: string };

const FORMAT_HINT = "Contoh: 081234567890 atau +6281234567890.";

export function normalizeIdWhatsapp(input: string): WhatsappResult {
  const raw = input.trim();
  if (raw === "") return { ok: false, message: "Nomor WhatsApp wajib diisi." };
  if (/[^0-9+\s\-().]/.test(raw)) return { ok: false, message: `Nomor hanya boleh berisi angka dan tanda +. ${FORMAT_HINT}` };

  const s = raw.replace(/[\s\-().]/g, "");
  let rest: string;
  if (s.startsWith("+")) {
    if (!s.startsWith("+62")) return { ok: false, message: `Gunakan kode negara Indonesia (+62). ${FORMAT_HINT}` };
    rest = s.slice(3);
  } else if (s.startsWith("62")) {
    rest = s.slice(2);
  } else if (s.startsWith("0")) {
    rest = s.slice(1);
  } else {
    return { ok: false, message: `Nomor tidak valid. ${FORMAT_HINT}` };
  }
  // "+62 0812…" dan "62 0812…" juga diterima: nol di depan nomor lokal dibuang.
  if (rest.startsWith("0")) rest = rest.slice(1);

  // Nomor seluler Indonesia: setelah kode negara selalu diawali 8, total 9–12 digit.
  if (!/^8\d{7,11}$/.test(rest)) return { ok: false, message: `Nomor tidak valid. ${FORMAT_HINT}` };
  return { ok: true, value: `62${rest}` };
}

/** "628123456789" → "+628123456789" untuk ditampilkan. */
export function formatWhatsappDisplay(value: string): string {
  return `+${value}`;
}

/** Tautan percakapan manual (tim DTIC yang memulai, bukan pengiriman otomatis). */
export function whatsappLink(value: string): string {
  return `https://wa.me/${value}`;
}
