import type { OrderStatus } from "@/lib/status";

/**
 * Warna event kalender (khusus halaman kalender). Status dan keterlambatan adalah dua hal berbeda:
 * - warna chip = status pekerjaan;
 * - aksen merah = deadline terlewati dan pekerjaan belum selesai (ditambahkan di atas warna status).
 */
export const CAL_STATUS_STYLE: Record<OrderStatus, { chip: string; dot: string; label: string }> = {
  submitted: { chip: "bg-[#f2f4f7] text-[#344054] ring-[#d0d5dd]", dot: "bg-[#667085]", label: "Pengajuan Masuk" },
  assigned: { chip: "bg-[#eff8ff] text-[#175cd3] ring-[#b2ddff]", dot: "bg-[#2e90fa]", label: "Siap Dikerjakan" },
  in_progress: { chip: "bg-[#f4f3ff] text-[#5925dc] ring-[#d9d6fe]", dot: "bg-[#7a5af8]", label: "Sedang Dikerjakan" },
  pending_confirmation: { chip: "bg-[#fff6ed] text-[#b93815] ring-[#f9dbaf]", dot: "bg-[#f79009]", label: "Menunggu Konfirmasi" },
  on_hold: { chip: "bg-[#fefbe8] text-[#854d0e] ring-[#fef0c7]", dot: "bg-[#eaaa08]", label: "Ditunda" },
  completed: { chip: "bg-[#ecfdf3] text-[#067647] ring-[#abefc6]", dot: "bg-[#17b26a]", label: "Selesai" },
  cancelled: { chip: "bg-[#f9fafb] text-[#98a2b3] ring-[#eaecf0] opacity-70", dot: "bg-[#d0d5dd]", label: "Dibatalkan" },
};

export const CAL_OVERDUE_STYLE = "bg-[#fef3f2] text-[#b42318] ring-[#fecdca]";
