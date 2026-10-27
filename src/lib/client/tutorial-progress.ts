"use client";

/**
 * Progres panduan interaktif — tersimpan lewat localStorage. Area publik (pemohon, tanpa akun) menyimpan
 * progres per BROWSER (ns kosong, kunci TANPA sufiks — kompatibel dengan data yang sudah ada). Area internal
 * (Manager, dsb. — punya akun) WAJIB memberi `ns` = id akun (lihat AppFrame di sidebar.tsx) supaya preferensi
 * tidak bercampur antar-akun pada komputer yang dipakai bersama; kunci jadi `${KEY}:${ns}`.
 */

export type TutorialStatus = "not_started" | "in_progress" | "completed";
export type TutorialProgressEntry = { status: TutorialStatus; stepIndex: number; updatedAt: string };
export type TutorialProgressState = Record<string, TutorialProgressEntry>;

const PROGRESS_KEY = "dtic-tutorial-progress-v1";
/** Tiga hal berbeda, sengaja TIDAK dicampur jadi satu status (lihat isAutoWelcomeEnabled/hasSeenWelcome):
 *  preferensi (boleh/tidak ditampilkan otomatis), status "sudah pernah dilihat" (supaya tidak menyapa
 *  berulang), dan status penyelesaian tutorial (PROGRESS_KEY di atas) — status aktif tour sendiri
 *  tersimpan terpisah di sessionStorage, lihat tutorial-context.tsx. */
const AUTO_WELCOME_ENABLED_KEY = "dtic-tutorial-auto-welcome-enabled-v1";
const WELCOME_SEEN_KEY = "dtic-tutorial-welcome-seen-v1";

const keyFor = (base: string, ns: string): string => (ns ? `${base}:${ns}` : base);

function readProgress(ns: string): TutorialProgressState {
  try {
    const raw = localStorage.getItem(keyFor(PROGRESS_KEY, ns));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as TutorialProgressState) : {};
  } catch {
    return {};
  }
}

function writeProgress(ns: string, state: TutorialProgressState): void {
  try {
    localStorage.setItem(keyFor(PROGRESS_KEY, ns), JSON.stringify(state));
  } catch {
    // Private window / storage penuh / dinonaktifkan — panduan tetap bisa dipakai, hanya progres tidak tersimpan.
  }
}

export function getAllProgress(ns = ""): TutorialProgressState {
  return readProgress(ns);
}

export function getTutorialProgress(id: string, ns = ""): TutorialProgressEntry {
  return readProgress(ns)[id] ?? { status: "not_started", stepIndex: 0, updatedAt: "" };
}

export function setTutorialProgress(id: string, status: TutorialStatus, stepIndex: number, ns = ""): void {
  const state = readProgress(ns);
  state[id] = { status, stepIndex, updatedAt: new Date().toISOString() };
  writeProgress(ns, state);
}

export function resetTutorialProgress(id: string, ns = ""): void {
  const state = readProgress(ns);
  delete state[id];
  writeProgress(ns, state);
}

/** Preferensi: boleh/tidak sambutan tampil otomatis. Default aktif (belum pernah diatur = "1"). */
export function isAutoWelcomeEnabled(ns = ""): boolean {
  try {
    return localStorage.getItem(keyFor(AUTO_WELCOME_ENABLED_KEY, ns)) !== "0";
  } catch {
    return true;
  }
}

/** Menonaktifkan: sambutan berhenti tampil otomatis. Mengaktifkan kembali: sambutan akan tampil lagi
 *  pada kunjungan berikutnya (reset status "sudah pernah dilihat") — sesuai perilaku yang diharapkan
 *  pengguna saat sengaja menghidupkan kembali preferensi ini. */
export function setAutoWelcomeEnabled(enabled: boolean, ns = ""): void {
  try {
    localStorage.setItem(keyFor(AUTO_WELCOME_ENABLED_KEY, ns), enabled ? "1" : "0");
    if (enabled) localStorage.removeItem(keyFor(WELCOME_SEEN_KEY, ns));
  } catch {
    // diamkan — preferensi hanya kenyamanan, tidak memengaruhi kemampuan memakai tutorial secara manual
  }
}

/** Sudah pernah melihat & menutup sambutan (lewat tombol mana pun) — dipisah dari preferensi aktif/nonaktif. */
export function hasSeenWelcome(ns = ""): boolean {
  try {
    return localStorage.getItem(keyFor(WELCOME_SEEN_KEY, ns)) === "1";
  } catch {
    return true; // storage tidak tersedia → jangan memaksa sambutan berulang-ulang
  }
}

export function markWelcomeSeen(ns = ""): void {
  try {
    localStorage.setItem(keyFor(WELCOME_SEEN_KEY, ns), "1");
  } catch {
    // diamkan — paling buruk sambutan muncul lagi, tidak merusak apa pun
  }
}
