import { redirect } from "next/navigation";

/** Konfigurasi per brand tidak dipakai lagi: semua brand memakai satu grup global di Integrasi Telegram. */
export default function TelegramBrandsPage() {
  redirect("/dtic/settings/integrations");
}
