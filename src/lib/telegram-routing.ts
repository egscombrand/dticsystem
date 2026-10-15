import type { OrderStatus } from "@/lib/status";

/**
 * Routing notifikasi Telegram per brand (murni, tanpa database). Dipakai server dan UI.
 *
 * Satu event = satu notifikasi. Perubahan status dipetakan ke tepat satu jenis event,
 * sehingga satu transisi tidak menghasilkan dua pesan walau dua jenis aktif.
 */
export const TELEGRAM_EVENT_TYPES = [
  "new_order",
  "status_changed",
  "waiting_confirmation",
  "completed",
  "on_hold",
  "cancelled",
  "pic_changed",
] as const;
export type TelegramEventType = (typeof TELEGRAM_EVENT_TYPES)[number];

export const EVENT_LABEL: Record<TelegramEventType, string> = {
  new_order: "Pengajuan baru",
  status_changed: "Perubahan status pekerjaan",
  waiting_confirmation: "Menunggu konfirmasi",
  completed: "Pekerjaan selesai",
  on_hold: "Pekerjaan ditunda",
  cancelled: "Pekerjaan dibatalkan",
  pic_changed: "Perubahan PIC",
};

/** Jenis event untuk transisi ke status tertentu. Status lain (mis. assigned, in_progress) = perubahan status umum. */
export function eventTypeForStatus(to: OrderStatus): TelegramEventType {
  switch (to) {
    case "pending_confirmation":
      return "waiting_confirmation";
    case "completed":
      return "completed";
    case "on_hold":
      return "on_hold";
    case "cancelled":
      return "cancelled";
    default:
      return "status_changed";
  }
}

/** Kolom boolean pada telegram_brand_channels untuk setiap jenis event. */
export const EVENT_FLAG: Record<TelegramEventType, "notify_new_order" | "notify_status_changed" | "notify_waiting_confirmation" | "notify_completed" | "notify_on_hold" | "notify_cancelled" | "notify_pic_changed"> = {
  new_order: "notify_new_order",
  status_changed: "notify_status_changed",
  waiting_confirmation: "notify_waiting_confirmation",
  completed: "notify_completed",
  on_hold: "notify_on_hold",
  cancelled: "notify_cancelled",
  pic_changed: "notify_pic_changed",
};

/** Format yang sama dengan validasi database (telegram_brand_channels.chat_id). */
export const CHAT_ID_RE = /^(-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{4,})$/;

/** Chat ID ditampilkan tanpa seluruh nilainya: hanya 4 karakter terakhir (atau awalan @ untuk username). */
export function maskChatId(chatId: string): string {
  if (chatId.startsWith("@")) return `${chatId.slice(0, 2)}••••`;
  return `••••${chatId.slice(-4)}`;
}

export const SKIP_REASON = {
  no_channel: "Brand belum memiliki grup Telegram. Notifikasi tidak dikirim.",
  inactive: "Integrasi Telegram untuk brand ini nonaktif. Notifikasi tidak dikirim.",
  event_disabled: "Jenis notifikasi ini dinonaktifkan di Integrasi Telegram.",
  channel_changed: "Grup Telegram brand berubah atau dinonaktifkan sejak antrean dibuat. Pesan tidak dikirim.",
  unverified: "Grup Telegram brand belum diverifikasi. Notifikasi tidak dikirim.",
  no_destination: "Grup Telegram global belum aktif. Notifikasi menunggu tujuan dan dikirim otomatis setelah grup diaktifkan.",
} as const;

/** Keadaan grup global untuk satu jenis event. */
export type GroupState = "ok" | "no_channel" | "inactive" | "unverified" | "event_disabled";
export type DestinationChoice = "send" | "await" | "skip";

/**
 * Tujuan notifikasi (murni). SATU grup global untuk semua brand: brand tidak menentukan tujuan.
 * Grup global aktif → kirim. Jenis event dimatikan → dilewati. Belum ada grup aktif: pengajuan baru menunggu tujuan
 * (dikirim otomatis setelah aktif); event status dilewati (tidak relevan bila terlambat).
 */
export function chooseDestination(input: { group: GroupState; eventType: TelegramEventType }): DestinationChoice {
  if (input.group === "ok") return "send";
  if (input.group === "event_disabled") return "skip";
  return input.eventType === "new_order" ? "await" : "skip";
}
