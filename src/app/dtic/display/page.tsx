import type { Metadata } from "next";
import { LiveDisplay } from "@/components/display/live-display";

export const metadata: Metadata = { title: "Live Order Display", robots: { index: false, follow: false } };

/**
 * Layar display PUBLIK (layar TV kantor/ruang tunggu) — di luar layout panel (tanpa sidebar admin) dan
 * TANPA login (lihat src/proxy.ts: "/dtic/display" ada di PUBLIC_PAGES). Data yang ditampilkan sudah
 * dibatasi ke field minimal non-sensitif (tanpa WhatsApp, brief, catatan internal — lihat displaySnapshot
 * & /api/public/display/orders), sama sekali tidak melalui sesi.
 */
export default function DisplayPage() {
  return <LiveDisplay />;
}
