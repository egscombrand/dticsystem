/**
 * Parser link Telegram (murni, dipakai frontend & backend). Hanya MENGHASILKAN KANDIDAT identitas:
 * tidak ada request jaringan, tidak mengikuti URL, dan tidak pernah menyatakan grup terverifikasi.
 * Verifikasi ke Telegram Bot API dilakukan terpisah (lihat services/telegram-verify).
 *
 * Format yang didukung (hanya host t.me, HTTPS):
 *  - https://t.me/c/<internalId>[/<n>[/<m>]]  → grup/kanal privat. Kandidat chat: "-100" + internalId.
 *    Pada grup forum, <n> adalah ID topik (link topik / pesan dalam topik). Ditentukan setelah Telegram
 *    menyatakan grup berupa forum; di grup biasa <n> hanya nomor pesan.
 *  - https://t.me/<username>                   → grup/kanal publik. Kandidat chat: "@username".
 *  - https://t.me/<username>/<messageId>       → pesan di grup/kanal publik. Kandidat sama seperti di atas.
 * Tidak didukung: link undangan (t.me/+…, joinchat), host lain, skema selain https, kredensial, port,
 * query/fragment, dan format lain.
 */

export const MAX_LINK_LENGTH = 300;

export type TelegramLinkTarget =
  | { kind: "private"; internalId: string; messageId: string | null; topicCandidate: string | null; candidateChatId: string; sourceLink: string }
  | { kind: "public"; username: string; messageId: string | null; topicCandidate: string | null; candidateChatRef: string; sourceLink: string };

export type LinkErrorCode =
  | "empty"
  | "too_long"
  | "invalid_url"
  | "insecure_scheme"
  | "unsupported_host"
  | "credentials"
  | "invite_link"
  | "unsupported_format"
  | "invalid_message_id";

export type LinkParseResult = { ok: true; target: TelegramLinkTarget } | { ok: false; code: LinkErrorCode; message: string };

/** Username yang tidak pernah berupa grup/kanal (halaman fitur Telegram). */
const RESERVED = new Set(["c", "joinchat", "share", "addstickers", "addemoji", "addtheme", "addlist", "proxy", "socks", "iv", "login", "setlanguage"]);
const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;
const INTERNAL_ID_RE = /^[1-9]\d{4,19}$/;
const MESSAGE_ID_RE = /^[1-9]\d{0,9}$/;

const INVITE_MESSAGE =
  "Link undangan (t.me/+…) tidak dapat diverifikasi otomatis. Di grup, klik kanan salah satu pesan → Salin Link Pesan, lalu tempel link berbentuk https://t.me/c/… di sini.";

function fail(code: LinkErrorCode, message: string): LinkParseResult {
  return { ok: false, code, message };
}

export function parseTelegramLink(raw: string): LinkParseResult {
  const input = raw.trim();
  if (!input) return fail("empty", "Tempel link grup atau pesan Telegram.");
  if (input.length > MAX_LINK_LENGTH) return fail("too_long", "Link terlalu panjang.");

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return fail("invalid_url", "Link tidak valid. Contoh: https://t.me/c/2436417110/9467");
  }
  if (url.protocol !== "https:") return fail("insecure_scheme", "Link harus memakai HTTPS.");
  if (url.username || url.password) return fail("credentials", "Link tidak boleh memuat nama pengguna atau kata sandi.");
  if (url.hostname.toLowerCase() !== "t.me") return fail("unsupported_host", "Hanya link t.me yang didukung.");
  if (url.port) return fail("unsupported_format", "Link tidak boleh memuat port.");
  if (url.search || url.hash) return fail("unsupported_format", "Hapus parameter tambahan dari link.");
  if (/%/.test(url.pathname)) return fail("unsupported_format", "Link tidak dikenali. Salin ulang link dari Telegram.");

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length === 0) return fail("unsupported_format", "Tempel link grup atau pesan, bukan halaman utama t.me.");
  const [first] = segments;

  if (first.startsWith("+") || first === "joinchat") return fail("invite_link", INVITE_MESSAGE);

  if (first === "c") {
    // Nomor pesan opsional: identitas grup hanya dari ID internal, dan tetap diverifikasi lewat Bot API.
    if (segments.length < 2 || segments.length > 4) {
      return fail("unsupported_format", "Link grup privat harus berbentuk https://t.me/c/ID_GRUP, …/ID_TOPIK, atau …/ID_PESAN.");
    }
    const [, internalId, n = null, m = null] = segments;
    if (!INTERNAL_ID_RE.test(internalId)) return fail("unsupported_format", "ID grup pada link tidak valid.");
    if ((n !== null && !MESSAGE_ID_RE.test(n)) || (m !== null && !MESSAGE_ID_RE.test(m))) return fail("invalid_message_id", "Nomor topik/pesan pada link tidak valid.");
    return {
      ok: true,
      target: {
        kind: "private",
        internalId,
        messageId: m ?? n,
        topicCandidate: n,
        candidateChatId: `-100${internalId}`,
        sourceLink: `https://t.me/c/${internalId}${n ? `/${n}` : ""}${m ? `/${m}` : ""}`,
      },
    };
  }

  if (segments.length > 3) return fail("unsupported_format", "Format link tidak dikenali.");
  if (RESERVED.has(first.toLowerCase()) || !USERNAME_RE.test(first)) {
    return fail("unsupported_format", "Format link tidak dikenali. Gunakan link grup (t.me/nama_grup) atau link pesan grup.");
  }
  const [, n = null, m = null] = segments;
  if ((n !== null && !MESSAGE_ID_RE.test(n)) || (m !== null && !MESSAGE_ID_RE.test(m))) return fail("invalid_message_id", "Nomor topik/pesan pada link tidak valid.");
  return {
    ok: true,
    target: {
      kind: "public",
      username: first,
      messageId: m ?? n,
      topicCandidate: n,
      candidateChatRef: `@${first}`,
      sourceLink: `https://t.me/${first}${n ? `/${n}` : ""}${m ? `/${m}` : ""}`,
    },
  };
}
