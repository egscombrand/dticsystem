/**
 * Catatan upaya pengiriman pengajuan — supaya kunci idempotensi (submissionKey) selamat dari muat ulang atau
 * keluar-masuk halaman saat pengiriman pertama belum jelas hasilnya. Tanpa ini, pemohon yang memuat ulang
 * halaman mendapat kunci BARU dan pengiriman kedua menjadi order ganda bila yang pertama ternyata sudah masuk.
 *
 * Hanya disimpan SAAT pengiriman benar-benar dimulai (bukan saat kunci dibuat), dan dipakai ulang hanya bila
 * isian sama persis (fingerprint) — isian berbeda = pengajuan lain = kunci baru.
 */
export type SubmissionAttempt = { key: string; fingerprint: string; startedAt: number };

const STORAGE_KEY = "dtic-submission-attempt-v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Catatan dibuang setelah ini (pengiriman setua ini dianggap sudah tidak relevan). */
export const ATTEMPT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Selama ini setelah dimulai, "belum ditemukan" masih mungkin berarti server sedang memproses. */
export const ATTEMPT_UNCERTAIN_MS = 15 * 60 * 1000;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStore(): Store | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // mode privat / akses penyimpanan diblokir — fitur tetap jalan, hanya tanpa penyimpanan
  }
}

/** Hash 53-bit sederhana (cyrb53) — bukan keamanan, hanya pembeda isian. */
function hash(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Sidik isian pengajuan: semua field teks (kecuali kunci itu sendiri), PIC terpilih, dan nama+ukuran berkas. */
export function fingerprintOf(raw: Record<string, string>, picIds: string[], files: { name: string; size: number }[]): string {
  const parts = Object.keys(raw)
    .filter((k) => k !== "submissionKey")
    .sort()
    .map((k) => `${k}=${raw[k]}`);
  parts.push(`pic=${[...picIds].sort().join(",")}`);
  parts.push(`files=${files.map((f) => `${f.name}:${f.size}`).sort().join("|")}`);
  return hash(parts.join("\n"));
}

export function loadAttempt(now: number = Date.now(), store: Store | null = defaultStore()): SubmissionAttempt | null {
  if (!store) return null;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return null;
    const a = JSON.parse(raw) as Partial<SubmissionAttempt>;
    const valid = typeof a.key === "string" && UUID.test(a.key) && typeof a.fingerprint === "string" && typeof a.startedAt === "number";
    if (!valid || now - (a.startedAt as number) > ATTEMPT_MAX_AGE_MS) {
      store.removeItem(STORAGE_KEY);
      return null;
    }
    return a as SubmissionAttempt;
  } catch {
    return null;
  }
}

export function clearAttempt(store: Store | null = defaultStore()): void {
  try {
    store?.removeItem(STORAGE_KEY);
  } catch {
    // diamkan
  }
}

/**
 * Dipanggil tepat sebelum mengirim. Isian sama dengan upaya tersimpan yang masih segar → pakai KUNCI LAMA
 * (server menjawab "sudah ada" bila yang lama sempat masuk). Berbeda/tidak ada → catat upaya baru dengan
 * `freshKey`.
 */
export function adoptAttempt(fingerprint: string, freshKey: string, now: number = Date.now(), store: Store | null = defaultStore()): SubmissionAttempt {
  const existing = loadAttempt(now, store);
  if (existing && existing.fingerprint === fingerprint) return existing;
  const attempt: SubmissionAttempt = { key: freshKey, fingerprint, startedAt: now };
  try {
    store?.setItem(STORAGE_KEY, JSON.stringify(attempt));
  } catch {
    // penyimpanan penuh/diblokir — lanjut tanpa catatan
  }
  return attempt;
}
