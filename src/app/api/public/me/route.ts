import { findSession, tokenFromRequest } from "@/lib/server/auth";
import { json } from "@/lib/server/http";

/**
 * Identitas sesi ringan — HANYA role & nama, tanpa data sensitif. Dipakai komponen area publik yang
 * perlu tahu apakah pengunjung sedang login secara internal (mis. Pusat Bantuan mengambang, supaya
 * "Panduan Penggunaan" & "Tiket Saya" mengarah ke pengalaman yang benar) tanpa memaksa seluruh
 * halaman publik membaca sesi di server. Tamu (tanpa sesi) mendapat role null, bukan 401 — endpoint
 * ini memang untuk dipanggil dari halaman yang TIDAK mewajibkan login.
 */
export async function GET(request: Request) {
  const session = await findSession(tokenFromRequest(request));
  return json({ role: session?.role ?? null, name: session?.name ?? null });
}
