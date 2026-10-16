// Uji end-to-end alur utama DTIC System terhadap build produksi.
// - Database: PGlite in-memory (Postgres 18) via protokol Postgres — tidak menyentuh Supabase.
// - Storage: driver lokal di folder sementara.
// Prasyarat: `npm run build`. Jalankan: `npm run test:e2e`.
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

const DB_PORT = await freePort();
const APP_PORT = await freePort();
const BASE = `http://127.0.0.1:${APP_PORT}`;
const ADMIN_EMAIL = "admin@dtic.example";
const ADMIN_PW = "KataSandiUji2026";
let ADMIN = ""; // cookie sesi Super Admin (diisi setelah login sungguhan)
const uploadDir = await mkdtemp(path.join(os.tmpdir(), "dtic-e2e-"));

// ---------------------------------------------------------------- database
const pg = await PGlite.create("memory://");
const pgServer = new PGLiteSocketServer({ db: pg, port: DB_PORT, host: "127.0.0.1", maxConnections: 2, debug: process.env.E2E_PG_DEBUG === "1" });
await pgServer.start();
const DATABASE_URL = `postgres://postgres@127.0.0.1:${DB_PORT}/postgres`;
for (const f of (await readdir("supabase/migrations")).filter((x) => x.endsWith(".sql")).sort()) {
  await pg.exec(await readFile(path.join("supabase/migrations", f), "utf8"));
}

// ---------------------------------------------------------------- app
// Bootstrap Super Admin (skrip produksi), dijalankan terhadap database uji.
{
  const boot = await runNode("scripts/bootstrap-admin.mjs", { ...process.env, DATABASE_URL, BOOTSTRAP_ADMIN_EMAIL: ADMIN_EMAIL, BOOTSTRAP_ADMIN_NAME: "Admin Uji", BOOTSTRAP_ADMIN_PASSWORD: ADMIN_PW });
  if (boot.status !== 0) throw new Error("bootstrap gagal: " + boot.stderr + boot.stdout);
}
// Tiruan Telegram Bot API (loopback). Mode dikendalikan tes: ok | 500 | 401 | badchat.
const TG_TOKEN = "123456:AAHtestTokenUjiDTIC-abcdefghijklmnop";
const TG_CHAT = "-1001234567890";
const TG_CHAT_2 = "-1001234567891";
// Grup yang dikenal tiruan (kunci = chat_id yang dikirim klien). Chat tak dikenal → 400 chat not found.
const tg = {
  mode: "ok",
  queue: [],
  calls: [],
  chats: {
    [TG_CHAT]: { id: -1001234567890, type: "supergroup", title: "Grup Environesia Uji" },
    [TG_CHAT_2]: { id: -1001234567891, type: "supergroup", title: "Grup Greenlab Uji" },
    "-1001234567899": { id: -1001234567899, type: "supergroup", title: "Grup Uji Baru" },
    "-1001234567898": { id: -1001234567898, type: "supergroup", title: "Grup Uji Pengganti" },
    "-1001234567988": { id: -1001234567999, type: "supergroup", title: "Grup Salah Id" },
    "-1001234566666": { id: -1001234566666, type: "supergroup", title: "Grup Tanpa Bot" },
    "@grupuji": { id: -1001234567777, type: "supergroup", username: "grupuji", title: "Grup Publik Uji" },
    "-1234567444": { id: -1234567444, type: "group", title: "Grup Biasa Uji" },
    "-1001234567333": { id: -1001234567333, type: "supergroup", is_forum: true, title: "Grup Forum Uji" },
  },
  members: { "-1001234566666": "left" },
  lookup: {}, // mode galat per metode baca: drop | 429 | html | 500 | 401 (diatur tes)
};
const BOT_ID = 999000111;
const TG_PORT = await freePort();
const tgServer = http.createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const m = req.url.match(/^\/bot([^/]+)\/(\w+)$/);
  if (!m || req.method !== "POST") {
    res.writeHead(404).end();
    return;
  }
  let body = {};
  try {
    body = JSON.parse(raw);
  } catch {}
  const sendJson = (code, payload) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  };
  // Metode baca untuk verifikasi grup (tidak masuk daftar pesan terkirim).
  const look = tg.lookup[m[2]];
  if (look) {
    if (look === "drop") return req.socket.destroy();
    if (look === "html") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end("<html><body>gateway</body></html>");
    }
    if (look === "429") return sendJson(429, { ok: false, error_code: 429, description: "Too Many Requests: retry after 7", parameters: { retry_after: 7 } });
    if (look === "500") return sendJson(500, { ok: false, error_code: 500, description: "Internal Server Error" });
    if (look === "401") return sendJson(401, { ok: false, error_code: 401, description: "Unauthorized" });
  }
  if (m[2] === "getMe") return sendJson(200, { ok: true, result: { id: BOT_ID, is_bot: true, username: "dtic_nexus_uji_bot" } });
  if (m[2] === "getChat") {
    const info = tg.chats[String(body.chat_id)];
    if (!info) return sendJson(400, { ok: false, error_code: 400, description: "Bad Request: chat not found" });
    return sendJson(200, { ok: true, result: info });
  }
  if (m[2] === "getChatMember") {
    return sendJson(200, { ok: true, result: { status: tg.members[String(body.chat_id)] ?? "administrator", user: { id: body.user_id } } });
  }
  if (m[2] !== "sendMessage") return sendJson(404, { ok: false, error_code: 404, description: "Not Found" });
  // Perilaku per panggilan: antrean dulu, lalu mode tetap. drop = koneksi diputus tanpa respons.
  const mode = tg.queue.length ? tg.queue.shift() : tg.mode;
  tg.calls.push({ token: m[1], body, mode });
  const send = (code, payload, headers = {}) => {
    res.writeHead(code, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(payload));
  };
  if (mode === "drop") return req.socket.destroy();
  if (mode === "ok") return send(200, { ok: true, result: { message_id: tg.calls.length } });
  if (mode === "401") return send(401, { ok: false, error_code: 401, description: "Unauthorized" });
  if (mode === "badchat") return send(400, { ok: false, error_code: 400, description: "Bad Request: chat not found" });
  if (mode === "403") return send(403, { ok: false, error_code: 403, description: "Forbidden: bot is not a member of the supergroup chat" });
  if (mode === "429") return send(429, { ok: false, error_code: 429, description: "Too Many Requests: retry later", parameters: { retry_after: 1 } });
  return send(500, { ok: false, error_code: 500, description: "Internal Server Error" });
});
await new Promise((resolve) => tgServer.listen(TG_PORT, "127.0.0.1", resolve));

// Satu grup Telegram GLOBAL untuk semua brand (baris tanpa brand), terverifikasi & aktif.
await pg.query(
  `insert into telegram_brand_channels (brand_id, chat_id, chat_title, source_link, verification_status, verified_at, is_active)
   values (null, $1, 'Grup Request Desain Uji', 'https://t.me/c/1234567890/1', 'verified', now(), true)`,
  [TG_CHAT],
);
const app = spawn("node_modules/.bin/next", ["start", "-p", String(APP_PORT), "-H", "127.0.0.1"], {
  env: {
    ...process.env,
    NODE_ENV: "production",
    // Build E2E di folder terpisah (dibuat dengan NEXT_DIST_DIR=.next-e2e npm run build).
    NEXT_DIST_DIR: process.env.NEXT_DIST_DIR ?? ".next-e2e",
    DATABASE_URL,
    DB_POOL_MAX: "1",
    STORAGE_DRIVER: "local",
    LOCAL_STORAGE_DIR: uploadDir,
    RESULT_UPLOAD_MAX_MB: "1",
    SESSION_COOKIE_SECURE: "false",
    SUBMIT_RATE_LIMIT_MAX: "3",
    SUBMIT_RATE_LIMIT_WINDOW_SECONDS: "600",
    TELEGRAM_BOT_TOKEN: TG_TOKEN,
    TELEGRAM_CHAT_ID: TG_CHAT,
    TELEGRAM_API_BASE: `http://127.0.0.1:${TG_PORT}`,
    // Default: worker mati agar tes deterministik (tick dipanggil manual). E2E_WORKER_LIVE=1: worker sungguhan.
    TELEGRAM_WORKER: process.env.E2E_WORKER_LIVE === "1" ? "on" : "off",
    TELEGRAM_WORKER_INTERVAL_MS: "500",
    TELEGRAM_RETRY_DELAYS_SECONDS: "0.1,0.1,0.1,0.1",
    DTIC_APP_URL: BASE,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let appLog = "";
app.stdout.on("data", (d) => (appLog += d));
app.stderr.on("data", (d) => (appLog += d));

async function waitForApp() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${BASE}/`);
      if (r.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Aplikasi tidak menyala:\n" + appLog);
}

// ---------------------------------------------------------------- helpers
/**
 * Klien database untuk asersi tes: memakai instance PGlite LANGSUNG (dalam proses),
 * bukan lewat socket. Satu-satunya koneksi socket adalah milik aplikasi, sehingga
 * multiplexer pglite-socket tidak pernah mencampur respons dua koneksi (sumber flaky
 * "RangeError: offset out of range" → React error #441 pada uji browser).
 * API-nya meniru tagged template `postgres`: db`select ... ${nilai}` → array baris.
 */
const db = Object.assign(
  async (strings, ...values) => {
    let text = strings[0];
    values.forEach((_, i) => (text += `$${i + 1}${strings[i + 1]}`));
    return (await pg.query(text, values)).rows;
  },
  { end: async () => {} },
);
let ipCounter = 0;
const freshIp = () => `10.0.0.${++ipCounter}`;

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

/** Tanggal WIB "YYYY-MM-DD" + n hari (input deadline form = tanggal). */
function wibDate(offsetDays) {
  return new Date(Date.now() + 7 * 3600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

/** Dokumen rich text sederhana (paragraf per baris). */
const richDoc = (text) => ({ type: "doc", content: text.split("\n").map((t) => ({ type: "paragraph", content: [{ type: "text", text: t }] })) });
let TYPES = {}; // nama jenis order → id (dibaca dari database setelah migration)
let TEAM_OF = {}; // id jenis pekerjaan → id tim (kategori), dibaca dari database
let TEAMS = {}; // slug tim → id
let TEAM_MEMBERS = {}; // id tim → id anggota aktif (urut nama)

function orderForm(brandId, overrides = {}, files = []) {
  const fd = new FormData();
  const fields = {
    submissionKey: randomUUID(),
    requesterName: "Ani Lestari",
    requesterWhatsapp: "081234567890",
    brandId,
    department: "Marketing",
    designTypeId: TYPES["Poster"],
    sizePreset: "A4",
    title: "Judul Uji Poster Akhir Tahun",
    briefDoc: JSON.stringify(richDoc("Poster Promo Akhir Tahun\nDiskon 20% untuk seluruh produk, 1–31 Desember 2026.")),
    deadline: wibDate(3),
    ...overrides,
  };
  // Kategori (tim) mengikuti jenis pekerjaan, dan PIC default = satu anggota tim itu, kecuali tes mengisinya sendiri.
  if (!("teamId" in overrides)) fields.teamId = TEAM_OF[fields.designTypeId];
  if (!("picIds" in overrides)) fields.picIds = (TEAM_MEMBERS[fields.teamId] ?? []).slice(0, 1);
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) for (const item of v) fd.append(k, item);
    else if (v !== undefined) fd.set(k, v);
  }
  for (const f of files) fd.append("attachments", new Blob([f.data], { type: f.type ?? "application/octet-stream" }), f.name);
  return { fd, fields };
}

const submit = (fd, headers = {}) =>
  fetch(`${BASE}/api/public/orders`, { method: "POST", body: fd, headers: { "x-forwarded-for": freshIp(), ...headers } });

const internal = (url, method, body, headers = {}, cookie = ADMIN) =>
  fetch(`${BASE}${url}`, {
    method,
    headers: { Cookie: cookie, Origin: BASE, "Content-Type": "application/json", "X-DTIC-Request": "1", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

// Pengajuan QC wajib menyertakan tautan hasil; `link: null` sengaja dipakai untuk menguji penolakan.
const workflow = (id, body, cookie = ADMIN) =>
  internal(`/api/internal/orders/${id}/workflow`, "POST", {
    requestKey: randomUUID(),
    // Bawaan uji: hasil diserahkan di luar DTIC Nexus (tanpa upload). Tes metode lain mengisi `method` sendiri.
    ...(body.action === "submit_qc" && !("method" in body) ? { method: "external", channel: "direct", note: "Uji: hasil diserahkan langsung" } : {}),
    ...body,
  }, {}, cookie);
/** Alur penyerahan lengkap: ajukan ke Manager → setujui → catat pengiriman → selesaikan. */
async function finishViaQc(id, cookie = ADMIN) {
  for (const body of [{ action: "submit_qc" }, { action: "approve_qc" }, { action: "record_delivery", confirmSent: true, stage: "final" }, { action: "complete" }]) {
    const r = await workflow(id, body, cookie);
    assert.equal(r.status, 200, `${body.action}: ${await r.clone().text()}`);
  }
}

const page = async (url, auth = true) => {
  const r = await fetch(`${BASE}${url}`, { headers: auth ? { Cookie: ADMIN } : {} });
  return { status: r.status, html: await r.text() };
};

/**
 * Menjalankan skrip Node secara ASINKRON. (spawnSync akan memblokir event loop proses ini,
 * padahal server PGlite uji berjalan di proses yang sama → koneksi bootstrap macet.)
 */
function runNode(script, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

/** Login sungguhan lewat API; mengembalikan header Cookie "dtic_session=…". */
async function login(email, password, opts = {}) {
  const r = await fetch(`${BASE}/api/dtic/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-DTIC-Request": "1", Origin: BASE, "x-forwarded-for": opts.ip ?? freshIp() },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) {
    const err = new Error(`login gagal (${r.status})`);
    err.status = r.status;
    err.body = await r.json().catch(() => ({}));
    throw err;
  }
  const cookie = r.headers.getSetCookie().find((c) => c.startsWith("dtic_session="));
  return cookie.split(";")[0];
}

/**
 * Mendeteksi pengalihan ke login. Proxy membalas 307; redirect dari layout panel yang di-stream
 * (Cache Components) membalas 200 dengan instruksi redirect di body. Keduanya dianggap pengalihan.
 */
async function redirectsToLogin(r) {
  if (r.status === 307) return new URL(r.headers.get("location"), BASE).pathname === "/dtic/login";
  if (r.status !== 200) return false;
  const body = await r.text();
  return body.includes("/dtic/login") && !/Dashboard<\/h1>|Pengelolaan Pekerjaan<\/h1>|Pengaturan<\/h1>/.test(body);
}

/** Pengalihan ke halaman tidak berizin (307 atau redirect streaming di body). */
async function redirectsToUnauthorized(r) {
  if (r.status === 307) return new URL(r.headers.get("location"), BASE).pathname === "/dtic/unauthorized";
  return r.status === 200 && (await r.text()).includes("/dtic/unauthorized");
}

/** Permintaan halaman tanpa mengikuti redirect (untuk memeriksa pengalihan login/izin). */
const pageRaw = (url, cookie) =>
  fetch(`${BASE}${url}`, { redirect: "manual", headers: cookie ? { Cookie: cookie } : {} });

const results = [];
/**
 * Notifikasi Telegram berjalan di latar (`after()`) setelah pengajuan. Harness PGlite (satu koneksi,
 * socket) tidak tahan bila query latar itu tumpang tindih dengan request lain, sehingga tes menunggu
 * sampai tidak ada notifikasi yang sedang dikirim. Server produksi tidak memakai harness ini.
 */
async function settleBackgroundWork() {
  for (let i = 0; i < 100; i++) {
    // 'processing' = notifikasi yang sedang dikirim (status 'sending' lama sudah diganti di migrasi 20261013070000).
    const [{ c }] = await db`select count(*)::int as c from notification_outbox where status = 'processing'`.catch(() => [{ c: 0 }]);
    if (c === 0) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await new Promise((r) => setTimeout(r, 250));
}

async function test(name, fn) {
  try {
    await settleBackgroundWork();
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log(`  ✗ ${name}\n    ${error.message.split("\n").join("\n    ")}`);
  }
}

// ---------------------------------------------------------------- tests
try {
  await waitForApp();
  // Akun Super Admin dibuat lewat skrip bootstrap (jalur produksi), lalu login sungguhan.
  ADMIN = await login(ADMIN_EMAIL, ADMIN_PW);
  const brands = await db`select id, name, slug from brands order by sort_order`;
  const brand1 = brands[0].id;
  const typeRows = await db`select id, name, team_id from design_order_types`;
  TYPES = Object.fromEntries(typeRows.map((t) => [t.name, t.id]));
  TEAM_OF = Object.fromEntries(typeRows.map((t) => [t.id, t.team_id]));
  TEAMS = Object.fromEntries((await db`select id, slug from dtic_teams`).map((t) => [t.slug, t.id]));
  for (const r of await db`select tm.team_id, m.id from dtic_team_members tm join dtic_members m on m.id = tm.member_id where m.is_active order by m.full_name`) {
    (TEAM_MEMBERS[r.team_id] ??= []).push(r.id);
  }
  let order1; // { id, orderNumber }

  if (process.env.E2E_WORKER_LIVE === "1") {
    console.log("\nWorker antrean sungguhan (timer di proses server; tanpa tick manual, tanpa tombol)");
    await test("worker live: event Menunggu Tujuan terkirim otomatis setelah Grup Default diaktifkan di database", async () => {
      assert.ok(appLog.includes("[telegram-worker] berjalan setiap 500 ms"), "worker dimulai oleh instrumentation server");
      await db`update telegram_brand_channels set is_active = false where brand_id is null`;
      const r = await submit(orderForm(brands[4].id).fd); // brand tanpa grup
      assert.equal(r.status, 201, await r.clone().text());
      const { orderNumber } = await r.json();
      const statusOf = async () => (await db`select n.status, n.attempts from notification_outbox n join orders o on o.id = n.order_id where o.order_number = ${orderNumber}`)[0];
      await new Promise((resolve) => setTimeout(resolve, 2000)); // ±4 tick worker tanpa tujuan
      const waiting = await statusOf();
      assert.equal(waiting.status, "awaiting_destination");
      assert.equal(waiting.attempts, 0, "worker tidak me-retry selama belum ada tujuan");
      const callsBefore = tg.calls.length;
      await db`update telegram_brand_channels set is_active = true where brand_id is null`;
      const end = Date.now() + 15000;
      while (Date.now() < end && (await statusOf()).status !== "sent") await new Promise((resolve) => setTimeout(resolve, 200));
      assert.equal((await statusOf()).status, "sent", "worker mengirim otomatis");
      const sent = tg.calls.slice(callsBefore).filter((c) => c.body.text.includes(orderNumber));
      assert.equal(sent.length, 1, "tepat satu pesan");
      assert.equal(sent[0].body.chat_id, TG_CHAT);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      assert.equal(tg.calls.slice(callsBefore).filter((c) => c.body.text.includes(orderNumber)).length, 1, "tick berikutnya tidak mengirim ulang");
      assert.ok(appLog.includes("dipindahkan ke antrean kirim"), "pemindahan tercatat di log server");
      assert.ok(!appLog.includes(TG_TOKEN), "token tidak tercatat");
    });
  }
  if (process.env.E2E_WORKER_LIVE !== "1") {

  console.log("\nAkses & pemisahan publik/internal");
  await test("halaman utama / = form pengajuan client, publik tanpa login, memuat brand aktif", async () => {
    const { status, html } = await page("/", false);
    assert.equal(status, 200);
    assert.match(html, /Ajukan Pekerjaan/);
    assert.match(html, /DTIC Connect/);
    assert.match(html, /One Portal for Creative/);
    assert.match(html, /href="\/riwayat"/, "navigasi Riwayat Request");
    for (const b of brands) assert.ok(html.includes(b.name), b.name);
  });
  await test("/ajukan (alamat lama) dialihkan ke /", async () => {
    const r = await fetch(`${BASE}/ajukan`, { redirect: "manual" });
    assert.ok([307, 308].includes(r.status), `status ${r.status}`);
    assert.equal(new URL(r.headers.get("location"), BASE).pathname, "/");
  });
  await test("halaman internal tanpa sesi → dialihkan ke /dtic/login; cookie palsu ditolak di server", async () => {
    for (const url of ["/dtic/dashboard", "/dtic/orders", "/dtic/settings/brands"]) {
      const r = await pageRaw(url);
      assert.equal(r.status, 307, url);
      assert.equal(new URL(r.headers.get("location"), BASE).pathname, "/dtic/login", url);
    }
    const forged = await pageRaw("/dtic/dashboard", "dtic_session=bukan-sesi-valid");
    assert.ok(await redirectsToLogin(forged), "cookie palsu → login (isi panel tidak dirender)");
  });
  await test("API internal tanpa sesi → 401; tanpa header CSRF → 403/422", async () => {
    const r1 = await fetch(`${BASE}/api/internal/orders/${randomUUID()}/status`, { method: "POST", body: "{}" });
    assert.equal(r1.status, 401);
    const r2 = await internal(`/api/internal/orders/${randomUUID()}/status`, "POST", { status: "in_progress" }, { "X-DTIC-Request": "" });
    assert.ok([403, 422].includes(r2.status), `status ${r2.status}`);
  });
  await test("login: kata sandi salah & email tidak terdaftar memberi pesan SAMA (tidak membocorkan akun)", async () => {
    const wrongPw = await login(ADMIN_EMAIL, "SalahSekali2026").catch((e) => e);
    const noUser = await login("tidak.ada@dtic.example", "SalahSekali2026").catch((e) => e);
    assert.equal(wrongPw.status, 401);
    assert.equal(noUser.status, 401);
    assert.equal(wrongPw.body.error, noUser.body.error);
    assert.equal(wrongPw.body.error, "Email atau kata sandi salah.");
  });
  await test("login berhasil: cookie httpOnly + SameSite=Lax; sesi memberi akses ke dashboard", async () => {
    const r = await fetch(`${BASE}/api/dtic/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-DTIC-Request": "1", Origin: BASE, "x-forwarded-for": freshIp() },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PW }),
    });
    assert.equal(r.status, 200);
    const setCookie = r.headers.getSetCookie().find((c) => c.startsWith("dtic_session="));
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    const dash = await page("/dtic/dashboard");
    assert.equal(dash.status, 200);
    assert.match(dash.html, /Dashboard/);
  });

  console.log("\nPengajuan order");
  await test("field wajib kosong → 422 dengan pesan per field, tidak ada order tersimpan", async () => {
    const fd = new FormData();
    fd.set("submissionKey", randomUUID());
    const r = await submit(fd);
    assert.equal(r.status, 422);
    const body = await r.json();
    for (const k of ["requesterName", "requesterWhatsapp", "title", "brandId", "department", "designTypeId", "sizePreset", "briefDoc", "deadline"])
      assert.ok(body.fieldErrors?.[k], `fieldErrors.${k}`);
    assert.equal((await db`select count(*)::int as c from orders`)[0].c, 0);
  });
  await test("order valid + PDF → 201, nomor DTIC-YYYY-00001, file tersimpan", async () => {
    const { fd, fields } = orderForm(brand1, {}, [{ name: "brief referensi.pdf", data: PDF, type: "application/pdf" }]);
    const r = await submit(fd);
    assert.equal(r.status, 201, await r.clone().text());
    const body = await r.json();
    const year = new Date(Date.now() + 7 * 3600_000).getUTCFullYear();
    assert.equal(body.orderNumber, `DTIC-${year}-00001`);
    assert.equal(body.attachmentCount, 1);
    const [row] = await db`select id, order_number, status, priority, submission_key, title, company, created_at, deadline_at from orders`;
    assert.equal(row.status, "assigned", "status awal pengajuan: Siap Dikerjakan (PIC dipilih pemohon)");
    assert.equal(row.priority, "normal");
    assert.equal(row.title, "Judul Uji Poster Akhir Tahun", "judul dari field Judul Pekerjaan, bukan dari deskripsi");
    assert.equal(row.company, null);
    assert.ok(Math.abs(new Date(body.createdAt) - row.created_at) < 1000, "timestamp dari server dikembalikan");
    assert.equal(row.deadline_at.toISOString(), `${wibDate(3)}T16:59:00.000Z`, "deadline tanggal → 23.59 WIB");
    order1 = { id: row.id, orderNumber: row.order_number, submissionKey: fields.submissionKey };
    const att = await db`select storage_path, file_name, mime_type from order_attachments where order_id = ${row.id}`;
    assert.equal(att.length, 1);
    assert.equal(att[0].file_name, "brief referensi.pdf");
    assert.match(att[0].storage_path, /^orders\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/);
    const hist = await db`select previous_status, new_status from order_status_history where order_id = ${row.id}`;
    assert.deepEqual(hist.map((h) => [h.previous_status, h.new_status]), [[null, "assigned"]]);
  });
  await test("order dari client muncul di dashboard & daftar internal, tapi tidak di halaman publik", async () => {
    const dash = await page("/dtic/dashboard");
    assert.ok(dash.html.includes(order1.orderNumber), "dashboard (order terbaru)");
    assert.ok((await page("/dtic/orders")).html.includes(order1.orderNumber), "daftar order");
    const pub = await page("/", false);
    assert.ok(!pub.html.includes(order1.orderNumber), "halaman publik tidak memuat data order");
    assert.ok(!/Catatan internal|Pengelolaan Pekerjaan|Beban Kerja Tim/.test(pub.html), "halaman publik tidak memuat UI internal");
  });
  await test("kirim ulang dengan submissionKey sama → 200 duplicate, tidak membuat order ganda", async () => {
    const { fd } = orderForm(brand1, { submissionKey: order1.submissionKey });
    const r = await submit(fd);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.duplicate, true);
    assert.equal(body.orderNumber, order1.orderNumber);
    assert.equal((await db`select count(*)::int as c from orders`)[0].c, 1);
  });
  await test("pengajuan TANPA field URL Drive sama sekali (seperti form browser) → 201, drive_url null", async () => {
    const { fd } = orderForm(brand1);
    fd.delete("driveUrl");
    const r = await submit(fd);
    assert.equal(r.status, 201, await r.clone().text());
    const { orderNumber } = await r.json();
    const [o] = await db`select drive_url, priority from orders where order_number = ${orderNumber}`;
    assert.equal(o.drive_url, null);
  });
  await test("field sensitif dari publik diabaikan (status/catatan internal)", async () => {
    const { fd } = orderForm(brand1, { status: "completed", internalNotes: "hack", orderNumber: "DTIC-1999-00001" });
    const r = await submit(fd);
    assert.equal(r.status, 201);
    const { orderNumber } = await r.json();
    const [row] = await db`select status, internal_notes from orders where order_number = ${orderNumber}`;
    assert.equal(row.status, "assigned");
    assert.equal(row.internal_notes, null);
  });
  await test("jenis desain 'Lainnya' wajib diisi, disimpan sebagai teks yang ditulis client", async () => {
    let r = await submit(orderForm(brand1, { designTypeId: TYPES["Lainnya"] }).fd);
    assert.equal(r.status, 422);
    assert.ok((await r.json()).fieldErrors.designTypeOther);
    r = await submit(orderForm(brand1, { designTypeId: TYPES["Lainnya"], designTypeOther: "Desain merchandise kaos", sizePreset: "custom", customWidth: "30", customHeight: "40" }).fd);
    assert.equal(r.status, 201);
    const { orderNumber } = await r.json();
    const [o] = await db`select design_type, design_size, design_order_type_id from orders where order_number = ${orderNumber}`;
    assert.equal(o.design_type, "Desain merchandise kaos");
    assert.equal(o.design_order_type_id, TYPES["Lainnya"]);
    assert.equal(o.design_size, "Custom 30 × 40 cm");
  });
  await test("file .exe disamarkan sebagai .pdf → 422, tidak ada order/file tersimpan", async () => {
    const before = (await db`select count(*)::int as c from orders`)[0].c;
    const { fd } = orderForm(brand1, {}, [{ name: "invoice.pdf", data: Buffer.from("MZ\x90\x00 fake exe"), type: "application/pdf" }]);
    const r = await submit(fd);
    assert.equal(r.status, 422);
    assert.match((await r.json()).fieldErrors.attachments, /tidak sesuai/);
    assert.equal((await db`select count(*)::int as c from orders`)[0].c, before);
  });
  await test("ekstensi tidak diizinkan (.svg/.html) → 422", async () => {
    const { fd } = orderForm(brand1, {}, [{ name: "x.html", data: Buffer.from("<script>alert(1)</script>") }]);
    const r = await submit(fd);
    assert.equal(r.status, 422);
    assert.match((await r.json()).fieldErrors.attachments, /tidak didukung/);
  });
  await test("file > 10 MB → 422", async () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 10, 0x20);
    PDF.copy(big);
    const { fd } = orderForm(brand1, {}, [{ name: "besar.pdf", data: big }]);
    const r = await submit(fd);
    assert.equal(r.status, 422);
    assert.match((await r.json()).fieldErrors.attachments, /melebihi/);
  });
  await test("deadline di masa lalu → 422", async () => {
    const { fd } = orderForm(brand1, { deadline: wibDate(-1) });
    const r = await submit(fd);
    assert.equal(r.status, 422);
    assert.ok((await r.json()).fieldErrors.deadline);
  });
  await test("permintaan lintas origin → 403", async () => {
    const { fd } = orderForm(brand1);
    const r = await submit(fd, { Origin: "https://situs-jahat.example" });
    assert.equal(r.status, 403);
  });
  await test("pengajuan bersamaan (6 paralel) → nomor order unik & berurutan", async () => {
    const before = await db`select order_number from orders`;
    const responses = await Promise.all(Array.from({ length: 6 }, () => submit(orderForm(brand1).fd)));
    const numbers = await Promise.all(responses.map(async (r) => (assert.equal(r.status, 201), (await r.json()).orderNumber)));
    assert.equal(new Set(numbers).size, 6);
    const all = (await db`select order_number from orders order by order_number`).map((r) => r.order_number);
    assert.equal(all.length, before.length + 6);
    const seq = all.map((n) => Number(n.slice(-5)));
    assert.deepEqual(seq, seq.map((_, i) => i + 1));
  });
  await test("rate limit: pengajuan ke-4 dari IP yang sama dalam 10 menit → 429", async () => {
    const ip = "203.0.113.50";
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await submit(orderForm(brand1).fd, { "x-forwarded-for": ip })).status);
    assert.deepEqual(codes, [201, 201, 201, 429]);
  });

  console.log("\nDetail, edit, status, catatan, dokumen");
  await test("halaman daftar, detail, edit, workboard, kalender, brand dapat dibuka (200)", async () => {
    for (const url of ["/dtic/dashboard", "/dtic/orders", `/dtic/orders/${order1.id}`, `/dtic/orders/${order1.id}/edit`, "/dtic/workboard", "/dtic/calendar", "/dtic/settings/brands", "/dtic/settings/members"]) {
      const { status, html } = await page(url);
      assert.equal(status, 200, url);
      if (!url.startsWith("/dtic/settings/") && url !== "/dtic/calendar") assert.ok(html.includes(order1.orderNumber), `${url} memuat ${order1.orderNumber}`);
    }
  });
  await test("detail order id tidak dikenal → halaman 'Pekerjaan tidak ditemukan'", async () => {
    // Halaman di-stream (shell + loading state), sehingga status HTTP sudah 200 saat notFound() dipanggil;
    // Next.js lalu merender UI not-found + meta noindex.
    for (const url of [`/dtic/orders/${randomUUID()}`, `/dtic/orders/bukan-uuid`]) {
      const { html } = await page(url);
      assert.match(html, /Pekerjaan tidak ditemukan/, url);
    }
  });
  await test("pencarian & filter daftar order", async () => {
    let { html } = await page(`/dtic/orders?q=${encodeURIComponent(order1.orderNumber)}`);
    assert.ok(html.includes(order1.orderNumber));
    ({ html } = await page(`/dtic/orders?q=tidak-ada-yang-cocok-xyz`));
    assert.match(html, /Tidak ada order yang cocok/);
    ({ html } = await page(`/dtic/orders?brand=${brands[1].id}`));
    assert.match(html, /Tidak ada order yang cocok/);
    ({ html } = await page(`/dtic/orders?q=${encodeURIComponent(brands[0].name)}`));
    assert.ok(html.includes(order1.orderNumber), "cari berdasarkan nama perusahaan/brand");
    ({ html } = await page(`/dtic/orders?priority=urgent`));
    assert.match(html, /Tidak ada order yang cocok/);
    ({ html } = await page(`/dtic/orders?status=assigned&sort=deadline_asc&deadline=week`));
    assert.ok(html.includes(order1.orderNumber));
  });
  await test("pagination: 15 per halaman", async () => {
    const total = (await db`select count(*)::int as c from orders`)[0].c;
    const { html } = await page(`/dtic/orders?page=1`);
    assert.match(html, new RegExp(`dari <span[^>]*>${total}</span>`));
    const p2 = await page(`/dtic/orders?page=2`);
    assert.equal(p2.status, 200);
  });
  await test("alur status: transisi sah tercatat (pelaku & catatan); status sama tidak dicatat ulang; completed_at terisi", async () => {
    let r = await internal(`/api/internal/orders/${order1.id}/status`, "POST", { status: "in_progress", note: "Mulai dikerjakan" });
    assert.equal(r.status, 200, await r.clone().text());
    r = await internal(`/api/internal/orders/${order1.id}/status`, "POST", { status: "in_progress" });
    assert.equal((await r.json()).changed, false);
    // Status QC/pengiriman/selesai tidak dapat dicapai lewat endpoint status (tanpa pintasan).
    for (const to of ["pending_confirmation", "awaiting_requester", "completed"]) {
      assert.equal((await internal(`/api/internal/orders/${order1.id}/status`, "POST", { status: to })).status, 409, `status ${to} lewat endpoint status`);
    }
    await finishViaQc(order1.id);
    const hist = await db`select previous_status, new_status, notes, changed_by from order_status_history where order_id = ${order1.id} order by changed_at, id`;
    assert.deepEqual(hist.map((h) => h.new_status), ["assigned", "in_progress", "pending_confirmation", "in_progress", "awaiting_requester", "completed"]);
    assert.equal(hist[1].notes, "Mulai dikerjakan");
    assert.ok(hist.slice(1).every((h) => h.changed_by), "setiap perubahan mencatat pelaku");
    const [o] = await db`select status, completed_at from orders where id = ${order1.id}`;
    assert.equal(o.status, "completed");
    assert.ok(o.completed_at);
    const { html } = await page(`/dtic/orders/${order1.id}`);
    assert.match(html, /Mulai dikerjakan/);
    assert.match(html, /oleh/, "riwayat menampilkan pelaku");
  });
  await test("transisi tidak sah ditolak backend (409) dan alasan wajib (422)", async () => {
    const [o] = await db`select id from orders where id <> ${order1.id} order by order_number desc limit 1`;
    assert.equal((await internal(`/api/internal/orders/${o.id}/status`, "POST", { status: "completed" })).status, 409, "lompat assigned → completed");
    assert.equal((await internal(`/api/internal/orders/${o.id}/status`, "POST", { status: "on_hold" })).status, 409, "assigned → on_hold tidak ada");
    assert.equal((await internal(`/api/internal/orders/${o.id}/status`, "POST", { status: "in_progress" })).status, 200);
    const noReason = await internal(`/api/internal/orders/${o.id}/status`, "POST", { status: "on_hold" });
    assert.equal(noReason.status, 422, "penundaan wajib alasan");
    assert.equal((await internal(`/api/internal/orders/${o.id}/status`, "POST", { status: "on_hold", note: "Menunggu aset logo" })).status, 200);
    assert.equal((await internal(`/api/internal/orders/${o.id}/status`, "POST", { status: "in_progress" })).status, 200, "ditunda → dilanjutkan");
  });
  await test("pembatalan oleh Super Admin: alasan wajib tersimpan; status akhir tidak bisa dilanjutkan", async () => {
    const [o] = await db`select id from orders where status = 'in_progress' and id <> ${order1.id} order by order_number desc limit 1`;
    assert.equal((await internal(`/api/internal/orders/${o.id}/status`, "POST", { status: "cancelled" })).status, 422, "batal wajib alasan");
    const r = await internal(`/api/internal/orders/${o.id}/status`, "POST", { status: "cancelled", note: "Dibatalkan pemohon" });
    assert.equal(r.status, 200);
    const [row] = await db`select status, completed_at from orders where id = ${o.id}`;
    assert.equal(row.status, "cancelled");
    assert.equal(row.completed_at, null, "dibatalkan bukan Selesai");
    const [h] = await db`select new_status, notes from order_status_history where order_id = ${o.id} order by changed_at desc limit 1`;
    assert.deepEqual([h.new_status, h.notes], ["cancelled", "Dibatalkan pemohon"]);
    assert.equal((await internal(`/api/internal/orders/${o.id}/status`, "POST", { status: "in_progress", note: "coba buka lagi" })).status, 409, "dibatalkan tidak bisa dilanjutkan langsung");
  });
  await test("status tidak valid → 422", async () => {
    const r = await internal(`/api/internal/orders/${order1.id}/status`, "POST", { status: "deleted" });
    assert.equal(r.status, 422);
  });
  await test("catatan internal tersimpan dan tampil di detail", async () => {
    const r = await internal(`/api/internal/orders/${order1.id}/notes`, "PUT", { internalNotes: "Gunakan logo versi 2026." });
    assert.equal(r.status, 200);
    assert.equal((await db`select internal_notes from orders where id = ${order1.id}`)[0].internal_notes, "Gunakan logo versi 2026.");
    assert.match((await page(`/dtic/orders/${order1.id}`)).html, /Gunakan logo versi 2026\./);
  });
  const editBody = {
    requesterName: "Ani L.",
    company: "PT Uji Coba",
    department: "Brand Marketing",
    brandId: brand1,
    designTypeId: TYPES["Banner / Spanduk"],
    designTypeOther: "",
    designSize: "Custom 60 × 160 cm",
    title: "Banner Promo Akhir Tahun",
    briefDoc: richDoc("Banner roll-up untuk promo akhir tahun di toko."),
    driveUrl: "https://drive.google.com/drive/folders/uji-edit",
    briefYear: "",
    briefReference: "",
    designRequirements: "Warna brand",
    deadline: "2026-10-15T23:30",
    priority: "urgent",
  };

  await test("edit detail order tersimpan; deadline 15 Okt 23:30 WIB tersimpan sebagai 16:30Z", async () => {
    const r = await internal(`/api/internal/orders/${order1.id}`, "PATCH", editBody);
    assert.equal(r.status, 200, await r.clone().text());
    const [o] = await db`select title, priority, design_size, deadline_at, order_number from orders where id = ${order1.id}`;
    assert.equal(o.title, "Banner Promo Akhir Tahun");
    assert.equal(o.priority, "urgent");
    assert.equal(o.order_number, order1.orderNumber);
    assert.equal(o.deadline_at.toISOString(), "2026-10-15T16:30:00.000Z");
  });
  await test("edit dengan field terlarang (status/orderNumber) atau data tidak valid → 422", async () => {
    let r = await internal(`/api/internal/orders/${order1.id}`, "PATCH", { ...editBody, status: "closed" });
    assert.equal(r.status, 422);
    r = await internal(`/api/internal/orders/${order1.id}`, "PATCH", { ...editBody, title: "" });
    assert.equal(r.status, 422);
    assert.ok((await r.json()).fieldErrors.title);
  });
  await test("kalender: deadline 15 Okt 23:30 WIB muncul di tanggal 15 (tidak bergeser)", async () => {
    const { html } = await page(`/dtic/calendar?month=2026-10`);
    assert.match(html, /aria-label="15: 1 order"/);
    assert.ok(html.includes("Banner Promo Akhir Tahun"));
    const day = await page(`/dtic/calendar?month=2026-10&day=2026-10-15`);
    assert.ok(day.html.includes(order1.orderNumber));
    // Konten kalender (deadline pada tanggal yang benar) harus ada di respons streaming.
    // Pemeriksaan dibatasi pada hasil yang bisa diandalkan di harness PGlite (lihat catatan di README).
    const cal = await page(`/dtic/calendar?month=2026-10&day=2026-10-15`);
    assert.ok(cal.html.includes("Banner Promo Akhir Tahun"), "deadline 15 Okt tampil di kalender");
  });
  await test("unduh dokumen: dengan auth → isi identik & header aman; tanpa auth → 401", async () => {
    const [att] = await db`select a.id from order_attachments a where a.order_id = ${order1.id}`;
    const r = await fetch(`${BASE}/api/internal/attachments/${att.id}`, { headers: { Cookie: ADMIN } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "application/pdf");
    assert.match(r.headers.get("content-disposition"), /^attachment;/);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), PDF);
    const inline = await fetch(`${BASE}/api/internal/attachments/${att.id}?inline=1`, { headers: { Cookie: ADMIN } });
    assert.match(inline.headers.get("content-disposition"), /^inline;/);
    assert.equal((await fetch(`${BASE}/api/internal/attachments/${att.id}`)).status, 401);
  });

  console.log("\nDashboard & keterlambatan");
  await test("order lewat deadline: aktif dihitung terlambat, Completed tidak", async () => {
    // Set deadline lampau langsung di database (form publik menolak deadline lampau).
    const [late] = await db`select id, order_number from orders where id <> ${order1.id} order by order_number limit 1`;
    await db`update orders set deadline_at = now() - interval '2 days' where id = ${late.id}`;
    await db`update orders set deadline_at = now() - interval '2 days' where id = ${order1.id}`; // status completed
    const { html } = await page(`/dtic/orders?deadline=overdue`);
    assert.ok(html.includes(late.order_number), "order aktif terlambat tampil");
    assert.ok(!html.includes(order1.orderNumber), "order completed tidak dianggap terlambat");
    const dash = await page(`/dtic/dashboard`);
    assert.match(dash.html, /Terlambat/);
    const stats = await db`select count(*)::int as c from orders where deadline_at < now() and status not in ('completed','cancelled')`;
    assert.equal(stats[0].c, 1);
  });
  await test("dashboard menampilkan angka sesuai database", async () => {
    const total = (await db`select count(*)::int as c from orders`)[0].c;
    const { html } = await page(`/dtic/dashboard`);
    assert.ok(html.includes(`>${total}<`), `total ${total}`);
    const filtered = await page(`/dtic/dashboard?brand=${brands[2].id}`);
    assert.equal(filtered.status, 200);
    assert.match(filtered.html, /Belum ada pekerjaan/);
    const ranged = await page(`/dtic/dashboard?from=2020-01-01&to=2020-01-31`);
    assert.match(ranged.html, /Belum ada pekerjaan/);
  });

  console.log("\nPengaturan brand");
  await test("ubah nama & slug brand; slug duplikat → 409", async () => {
    let r = await internal(`/api/internal/brands/${brands[4].id}`, "PATCH", { name: "Brand Kelima", slug: "brand-kelima", isActive: true });
    assert.equal(r.status, 200);
    r = await internal(`/api/internal/brands/${brands[3].id}`, "PATCH", { name: "Brand Lain", slug: "brand-kelima", isActive: true });
    assert.equal(r.status, 409);
    assert.ok((await r.json()).fieldErrors.slug);
    r = await internal(`/api/internal/brands/${brands[3].id}`, "PATCH", { name: "Brand Lain", slug: "Slug Salah!", isActive: true });
    assert.equal(r.status, 422);
  });
  await test("brand nonaktif hilang dari form & ditolak server; order lama tetap terhubung", async () => {
    const r = await internal(`/api/internal/brands/${brand1}`, "PATCH", { name: brands[0].name, slug: brands[0].slug, isActive: false });
    assert.equal(r.status, 200);
    const form = await page("/", false);
    assert.ok(!form.html.includes(`value="${brand1}"`));
    const s = await submit(orderForm(brand1).fd);
    assert.equal(s.status, 422);
    assert.ok((await s.json()).fieldErrors.brandId);
    assert.ok((await page(`/dtic/orders/${order1.id}`)).html.includes(brands[0].name));
    await internal(`/api/internal/brands/${brand1}`, "PATCH", { name: brands[0].name, slug: brands[0].slug, isActive: true });
  });

  console.log("\nData master dinamis, rich text, Google Drive");
  await test("seed: 5 brand DTIC, 5 divisi, 9 member, 3 prioritas, jenis order", async () => {
    // `brands` = kondisi awal setelah migration (sebelum tes pengaturan brand mengubah nama).
    assert.deepEqual(brands.map((b) => b.name), ["PT Environesia Global Saraya", "PT Greenlab Indo Global", "Greenskill ID", "LSP PLI", "Bikin.co"]);
    assert.equal((await db`select count(*)::int as c from dtic_departments`)[0].c, 5);
    const members = await db`select m.full_name, d.name as dept from dtic_members m join dtic_departments d on d.id = m.department_id`;
    assert.equal(members.length, 9);
    assert.equal(members.find((m) => m.full_name === "Stevan Hary Laksono").dept, "Video Production");
    assert.deepEqual((await db`select code, name from priority_levels order by sort_order`).map((p) => `${p.code}:${p.name}`), ["low:Rendah", "normal:Normal", "urgent:Urgent"]);
    assert.ok(TYPES["Poster"] && TYPES["Lainnya"]);
  });
  await test("form publik membaca brand, jenis order & prioritas dari database (tanpa data internal)", async () => {
    const { html } = await page("/", false);
    for (const t of ["PT Environesia Global Saraya", "LSP PLI", "Poster", "Rendah", "Urgent", "URL Google Drive"]) assert.ok(html.includes(t), t);
    // Kategori & nama anggota tim tampil (panel tim), tetapi pilihan PIC manual & data internal lain tidak.
    assert.ok(html.includes("Graphic Design") && html.includes("Nuri Khusnaini"), "kategori & anggota tim tersedia");
    assert.ok(!html.includes('name="picId"'), "tidak ada pilihan PIC manual");
    assert.ok(!html.includes("uji@dtic.example"), "email member tidak dikirim ke client");
    assert.ok(!/"email"/.test(html), "field email tidak ada di payload");
  });
  let richOrder;
  await test("rich text tersimpan sebagai dokumen tersanitasi & dirender aman (XSS dibuang)", async () => {
    const evil = {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { textAlign: "center" }, content: [{ type: "text", text: "Judul Tebal", marks: [{ type: "bold" }] }] },
        { type: "paragraph", attrs: { onclick: "alert(1)" }, content: [{ type: "text", text: "<script>alert(1)</script>", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Poin satu" }] }] }] },
        { type: "image", attrs: { src: "https://evil.example/x.png" } },
      ],
    };
    const r = await submit(orderForm(brand1, { title: "Judul Tebal", briefDoc: JSON.stringify(evil), priority: "urgent", driveUrl: "https://drive.google.com/drive/folders/uji123" }).fd);
    assert.equal(r.status, 201, await r.clone().text());
    const { orderNumber } = await r.json();
    const [o] = await db`select id, brief, brief_rich, title, priority, drive_url from orders where order_number = ${orderNumber}`;
    richOrder = o;
    assert.equal(o.title, "Judul Tebal");
    assert.equal(o.priority, "urgent");
    assert.equal(o.drive_url, "https://drive.google.com/drive/folders/uji123");
    assert.match(o.brief, /• Poin satu/);
    assert.ok(!/javascript|onclick|image|evil|"link"/.test(JSON.stringify(o.brief_rich)), "dokumen tersanitasi di database");
    const { html } = await page(`/dtic/orders/${o.id}`);
    assert.match(html, /<strong>Judul Tebal<\/strong>/);
    assert.match(html, /text-center/);
    assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "teks HTML di-escape");
    assert.ok(!html.includes("<script>alert(1)"), "tidak ada script tereksekusi");
    assert.ok(!html.includes("javascript:alert"), "tidak ada link javascript:");
    assert.match(html, /href="https:\/\/drive\.google\.com\/drive\/folders\/uji123"[^>]*rel="noopener noreferrer nofollow"/);
  });
  await test("URL bukan Google Drive / bukan https → 422", async () => {
    for (const bad of ["https://evil.example/file", "http://drive.google.com/x", "javascript:alert(1)"]) {
      const r = await submit(orderForm(brand1, { driveUrl: bad }).fd);
      assert.equal(r.status, 422, bad);
      assert.ok((await r.json()).fieldErrors.driveUrl, bad);
    }
  });
  await test("prioritas dari database: ubah nama level di Pengaturan → badge order ikut berubah", async () => {
    let r = await internal(`/api/internal/settings/priorities/urgent`, "PATCH", { name: "Sangat Urgent", tone: "danger", isActive: true });
    assert.equal(r.status, 200, await r.clone().text());
    assert.ok((await page(`/dtic/orders/${richOrder.id}`)).html.includes("Sangat Urgent"));
    assert.ok((await page("/", false)).html.includes("Sangat Urgent"), "dropdown client ikut berubah");
    r = await internal(`/api/internal/settings/priorities/urgent`, "PATCH", { name: "Urgent", tone: "danger", isActive: true });
    assert.equal(r.status, 200);
  });
  await test("prioritas default (konfigurasi server) tidak bisa dinonaktifkan; kode tidak bisa diubah", async () => {
    let r = await internal(`/api/internal/settings/priorities/normal`, "PATCH", { name: "Normal", tone: "neutral", isActive: false });
    assert.equal(r.status, 422);
    r = await internal(`/api/internal/settings/priorities/normal`, "PATCH", { code: "biasa", name: "Normal", tone: "neutral", isActive: true });
    assert.equal(r.status, 200);
    assert.equal((await db`select count(*)::int as c from priority_levels where code = 'normal'`)[0].c, 1);
  });
  await test("tambah jenis order di Pengaturan → langsung muncul di form; dinonaktifkan → hilang & ditolak server", async () => {
    let r = await internal(`/api/internal/settings/order-types`, "POST", { name: "Desain Kemasan Uji", teamId: TEAMS["graphic-design"], requiresDetail: false, sortOrder: 50, isActive: true });
    assert.equal(r.status, 201, await r.clone().text());
    const { id } = await r.json();
    assert.ok((await page("/", false)).html.includes("Desain Kemasan Uji"));
    r = await internal(`/api/internal/settings/order-types`, "POST", { name: "desain kemasan uji", teamId: TEAMS["graphic-design"], requiresDetail: false, isActive: true });
    assert.equal(r.status, 409, "nama duplikat (case-insensitive) ditolak");
    r = await internal(`/api/internal/settings/order-types/${id}`, "PATCH", { name: "Desain Kemasan Uji", teamId: TEAMS["graphic-design"], requiresDetail: false, isActive: false });
    assert.equal(r.status, 200);
    assert.ok(!(await page("/", false)).html.includes("Desain Kemasan Uji"));
    const s2 = await submit(orderForm(brand1, { designTypeId: id, teamId: TEAMS["graphic-design"] }).fd);
    assert.equal(s2.status, 422);
    assert.ok((await s2.json()).fieldErrors.designTypeId);
  });
  await test("divisi & member DTIC dapat dikelola; duplikat & field asing ditolak", async () => {
    let r = await internal(`/api/internal/settings/departments`, "POST", { name: "Divisi Uji", slug: "divisi-uji", isActive: true });
    assert.equal(r.status, 201);
    const { id: deptId } = await r.json();
    r = await internal(`/api/internal/settings/members`, "POST", { fullName: "Anggota Uji", departmentId: deptId, position: "Staff", email: "uji@dtic.example", isActive: true });
    assert.equal(r.status, 201, await r.clone().text());
    r = await internal(`/api/internal/settings/members`, "POST", { fullName: "anggota uji", departmentId: deptId, position: "Staff", isActive: true });
    assert.equal(r.status, 409);
    r = await internal(`/api/internal/settings/members`, "POST", { fullName: "Admin", departmentId: deptId, position: "Staff", isActive: true, role: "admin" });
    assert.equal(r.status, 422);
    const { html } = await page("/dtic/settings/members");
    for (const n of ["Nuri Khusnaini", "Luthfi Imam Tauchid Faried Akbar", "Anggota Uji"]) assert.ok(html.includes(n), n);
  });
  await test("halaman & API pengaturan khusus internal", async () => {
    for (const e of ["brands", "departments", "members", "order-types", "priorities"]) {
      assert.equal((await page(`/dtic/settings/${e}`)).status, 200, e);
      assert.equal((await pageRaw(`/dtic/settings/${e}`)).status, 307, e);
    }
    const r = await fetch(`${BASE}/api/internal/settings/order-types`, { method: "POST", headers: { "Content-Type": "application/json", "X-DTIC-Request": "1" }, body: "{}" });
    assert.equal(r.status, 401);
  });

  console.log("\nPIC / Member DTIC");
  const memberRows = await db`select m.id, m.full_name, m.position || ' of ' || d.name as division from dtic_members m join dtic_departments d on d.id = m.department_id order by m.sort_order`;
  const M = Object.fromEntries(memberRows.map((m) => [m.full_name, m]));
  // Order khusus kategori Dokumentasi & Event: tes di blok ini memakai anggota tim tersebut (Nuri, Hikmatud, Stevan),
  // dan PIC hanya boleh dari tim kategori order. Order masih terbuka (PIC order selesai/dibatalkan terkunci).
  const picSubmit = await submit(orderForm(brand1, { designTypeId: TYPES["Dokumentasi Event"], sizePreset: "na", title: "Dokumentasi Uji PIC" }).fd);
  assert.equal(picSubmit.status, 201, await picSubmit.clone().text());
  const [picOrder] = await db`select id, order_number from orders where order_number = ${(await picSubmit.json()).orderNumber}`;
  // PIC yang benar-benar dirender (bukan sekadar ada di payload RSC / opsi dropdown):
  const shownInDetail = (html, name) => html.includes(`>${name}<`);
  const shownInList = (html, name) => new RegExp(`title="[^"]*${name} — `).test(html);
  const picNames = async (orderId) =>
    (await db`select m.full_name from order_assignments a join dtic_members m on m.id = a.member_id where a.order_id = ${orderId} order by m.full_name`).map((x) => x.full_name);
  await test("data lama tanpa PIC → label 'Belum ada PIC' (pengajuan baru selalu punya PIC)", async () => {
    await db`delete from order_assignments where order_id = ${picOrder.id}`;
    assert.equal((await db`select count(*)::int as c from order_assignments where order_id = ${picOrder.id}`)[0].c, 0);
    assert.ok((await page(`/dtic/orders/${picOrder.id}`)).html.includes("Belum ada PIC"));
  });
  await test("tugaskan satu member → nama & divisi tampil di detail, daftar order, dan Kanban", async () => {
    const nuri = M["Nuri Khusnaini"];
    const r = await internal(`/api/internal/orders/${picOrder.id}/assignees`, "PUT", { memberIds: [nuri.id], reason: "Uji penugasan PIC" });
    assert.equal(r.status, 200, await r.clone().text());
    assert.deepEqual(await picNames(picOrder.id), ["Nuri Khusnaini"]);
    const detail = (await page(`/dtic/orders/${picOrder.id}`)).html;
    assert.ok(shownInDetail(detail, "Nuri Khusnaini") && shownInDetail(detail, "Staff of Creative"), "detail");
    assert.ok(!detail.includes(">Belum ada PIC<"));
    assert.ok(shownInList((await page(`/dtic/orders?q=${picOrder.order_number}`)).html, "Nuri Khusnaini"), "daftar order");
    assert.ok(shownInList((await page(`/dtic/workboard?q=${picOrder.order_number}`)).html, "Nuri Khusnaini"), "Kanban");
  });
  await test("multi-PIC: beberapa member, duplikat diabaikan, tersimpan sebagai relasi unik", async () => {
    const outside = await internal(`/api/internal/orders/${picOrder.id}/assignees`, "PUT", { memberIds: [M["Nuri Khusnaini"].id, M["Gilar Dwi Rahayu"].id], reason: "Uji penugasan PIC" });
    assert.equal(outside.status, 422, "anggota dari tim lain (Graphic Design) ditolak");
    assert.deepEqual(await picNames(picOrder.id), ["Nuri Khusnaini"], "penolakan tidak mengubah PIC");
    const ids = [M["Nuri Khusnaini"].id, M["Stevan Hary Laksono"].id, M["Hikmatud Diyana"].id, M["Hikmatud Diyana"].id];
    const r = await internal(`/api/internal/orders/${picOrder.id}/assignees`, "PUT", { memberIds: ids, reason: "Uji penugasan PIC" });
    assert.equal(r.status, 200);
    const rows = await db`select member_id from order_assignments where order_id = ${picOrder.id}`;
    assert.equal(rows.length, 3);
    const html = (await page(`/dtic/orders/${picOrder.id}`)).html;
    for (const n of ["Stevan Hary Laksono", "Staff of Video Production", "Hikmatud Diyana", "Nuri Khusnaini"]) assert.ok(shownInDetail(html, n), n);
    await assert.rejects(db`insert into order_assignments (order_id, member_id) values (${picOrder.id}, ${M["Nuri Khusnaini"].id})`, /duplicate key|order_assignments_pkey/);
  });
  await test("filter daftar order & Workboard berdasarkan PIC (termasuk 'Belum ada PIC')", async () => {
    const stevan = M["Stevan Hary Laksono"].id;
    assert.ok((await page(`/dtic/orders?pic=${stevan}`)).html.includes(picOrder.order_number));
    assert.ok(!(await page(`/dtic/orders?pic=none`)).html.includes(picOrder.order_number));
    assert.ok(!(await page(`/dtic/orders?pic=${M["Muhammad Reza Alamsyah"].id}`)).html.includes(picOrder.order_number));
    assert.ok((await page(`/dtic/workboard?pic=${stevan}`)).html.includes(picOrder.order_number));
    await db`delete from order_assignments where order_id = ${picOrder.id}`; // data lama tanpa PIC untuk filter "Belum ada PIC"
    assert.ok((await page(`/dtic/orders?pic=none`)).html.includes(picOrder.order_number), "filter 'Belum ada PIC' menemukan data lama");
    await db`insert into order_assignments (order_id, member_id) values (${picOrder.id}, ${stevan}) on conflict do nothing`;
  });
  await test("ubah penugasan → tersimpan setelah dimuat ulang", async () => {
    let r = await internal(`/api/internal/orders/${picOrder.id}/assignees`, "PUT", { memberIds: [M["Hikmatud Diyana"].id], reason: "Uji penugasan PIC" });
    assert.equal(r.status, 200);
    assert.deepEqual(await picNames(picOrder.id), ["Hikmatud Diyana"]);
    let html = (await page(`/dtic/orders/${picOrder.id}`)).html;
    assert.ok(shownInDetail(html, "Hikmatud Diyana") && !shownInDetail(html, "Stevan Hary Laksono"));
    r = await internal(`/api/internal/orders/${picOrder.id}/assignees`, "PUT", { memberIds: [], reason: "Uji penugasan PIC" });
    assert.equal(r.status, 422, "PIC tidak boleh dikosongkan: minimal satu PIC");
    assert.deepEqual(await picNames(picOrder.id), ["Hikmatud Diyana"], "penugasan tidak berubah");
  });
  await test("validasi penugasan: id tidak valid / tidak ada / member nonaktif baru → 422; tanpa auth → 401", async () => {
    let r = await internal(`/api/internal/orders/${picOrder.id}/assignees`, "PUT", { memberIds: ["bukan-uuid"], reason: "Uji penugasan PIC" });
    assert.equal(r.status, 422);
    r = await internal(`/api/internal/orders/${picOrder.id}/assignees`, "PUT", { memberIds: [randomUUID()], reason: "Uji penugasan PIC" });
    assert.equal(r.status, 422);
    r = await internal(`/api/internal/orders/${picOrder.id}/assignees`, "PUT", { memberIds: [], extra: 1, reason: "Uji penugasan PIC" });
    assert.equal(r.status, 422);
    const fetchNoAuth = await fetch(`${BASE}/api/internal/orders/${picOrder.id}/assignees`, { method: "PUT", headers: { "Content-Type": "application/json", "X-DTIC-Request": "1" }, body: JSON.stringify({ memberIds: [], reason: "Uji penugasan PIC" }) });
    assert.equal(fetchNoAuth.status, 401);
  });
  await test("member dinonaktifkan: riwayat penugasan tetap; tidak bisa ditugaskan ke order lain", async () => {
    const reza = M["Muhammad Reza Alamsyah"];
    // Reza tidak tergabung dalam tim mana pun sehingga API tidak boleh menugaskannya; penugasan lama disiapkan sebagai data historis.
    assert.equal((await internal(`/api/internal/orders/${picOrder.id}/assignees`, "PUT", { memberIds: [reza.id], reason: "Uji penugasan PIC" })).status, 422, "pengguna yang dikecualikan tidak bisa ditugaskan");
    await db`insert into order_assignments (order_id, member_id) values (${picOrder.id}, ${reza.id}) on conflict do nothing`;
    const [dept] = await db`select department_id from dtic_members where id = ${reza.id}`;
    let r = await internal(`/api/internal/settings/members/${reza.id}`, "PATCH", { fullName: reza.full_name, departmentId: dept.department_id, position: "Staff", email: "", isActive: false });
    assert.equal(r.status, 200);
    assert.equal((await db`select count(*)::int as c from order_assignments where member_id = ${reza.id}`)[0].c, 1, "penugasan lama tetap");
    assert.ok(shownInDetail((await page(`/dtic/orders/${picOrder.id}`)).html, "Muhammad Reza Alamsyah"));
    const [other] = await db`select id from orders where id <> ${picOrder.id} and status not in ('completed','cancelled') limit 1`;
    r = await internal(`/api/internal/orders/${other.id}/assignees`, "PUT", { memberIds: [reza.id], reason: "Uji penugasan PIC" });
    assert.equal(r.status, 422);
    r = await internal(`/api/internal/orders/${picOrder.id}/assignees`, "PUT", { memberIds: [reza.id, M["Nuri Khusnaini"].id], reason: "Uji penugasan PIC" });
    assert.equal(r.status, 200, "member nonaktif yang sudah ditugaskan boleh tetap tercatat");
    await internal(`/api/internal/settings/members/${reza.id}`, "PATCH", { fullName: reza.full_name, departmentId: dept.department_id, position: "Staff", email: "", isActive: true });
  });
  await test("form edit internal menyimpan PIC bersama detail order", async () => {
    const [o] = await db`select o.*, (select id from design_order_types t where t.id = o.design_order_type_id) as tid from orders o where id = ${picOrder.id}`;
    const r = await internal(`/api/internal/orders/${picOrder.id}`, "PATCH", {
      requesterName: o.requester_name, company: o.company ?? "", department: o.department, brandId: o.brand_id, designTypeId: o.tid,
      designTypeOther: o.design_type, designSize: o.design_size, title: o.title, briefDoc: o.brief_rich ?? richDoc(o.brief), driveUrl: o.drive_url ?? "",
      briefYear: "", briefReference: "", designRequirements: "", deadline: "2026-12-01T10:00", priority: o.priority,
      assigneeIds: [M["Hikmatud Diyana"].id, M["Stevan Hary Laksono"].id],
      assigneeReason: "Uji perubahan PIC lewat form edit",
    });
    assert.equal(r.status, 200, await r.clone().text());
    const names = (await db`select m.full_name from order_assignments a join dtic_members m on m.id = a.member_id where a.order_id = ${picOrder.id} order by m.full_name`).map((x) => x.full_name);
    assert.deepEqual(names, ["Hikmatud Diyana", "Stevan Hary Laksono"]);
    const [audit] = await db`select detail from auth_audit_log where action = 'order_pic_changed' and detail->>'orderId' = ${picOrder.id} order by id desc limit 1`;
    assert.equal(audit.detail.source, "order_edit", "perubahan lewat form edit tercatat di audit");
    assert.equal(audit.detail.reason, "Uji perubahan PIC lewat form edit");
  });

  console.log("\nInteraksi browser (Chrome)");
  const chromePath = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
  let chromium = null;
  try {
    ({ chromium } = await import("playwright-core"));
  } catch {}
  if (!chromium || !existsSync(chromePath)) {
    results.push({ name: "uji browser", ok: false, error: new Error(`Chrome/playwright-core tidak tersedia (${chromePath})`) });
    console.log(`  ✗ uji browser dilewati: Chrome/playwright-core tidak tersedia (${chromePath})`);
  } else {
    const browser = await chromium.launch({ executablePath: chromePath, headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    // Login sungguhan lewat halaman /dtic/login; sesi (cookie) lalu dipakai semua halaman uji.
    const loginPage = await ctx.newPage();
    await loginPage.goto(`${BASE}/dtic/login`);
    await loginPage.fill("#login-email", ADMIN_EMAIL);
    await loginPage.fill("#login-password", ADMIN_PW);
    await loginPage.getByRole("button", { name: "Masuk", exact: true }).click();
    await loginPage.waitForURL(/\/dtic\/dashboard/, { timeout: 60000 });
    await loginPage.close();
    const pageErrors = [];
    ctx.on("weberror", (e) => pageErrors.push(e.error().message));
    let browserOrder;
    try {
      // Langkah form: kategori dipilih dari kartu; lanjut dengan tombol "Lanjutkan" (validasi per langkah).
      const pickTeam = (p, name) => p.getByRole("button", { name: new RegExp(`^${name}`) }).click();
      const nextStep = (p) => p.getByRole("button", { name: "Lanjutkan", exact: true }).click();
      await test("form client: Brand Pemohon + bullet/numbered list + format teks via tombol editor → tersimpan", async () => {
        const p = await ctx.newPage();
        await p.goto(`${BASE}/`);
        assert.match((await p.locator('label[for="brandId"]').textContent()) ?? "", /^Brand Pemohon/);
        await pickTeam(p, "IT System Management");
        await pickTeam(p, "Graphic Design"); // kategori berganti → pilihan jenis dikosongkan
        assert.equal(await p.locator("#designTypeId option", { hasText: "Poster" }).count(), 1, "jenis pekerjaan mengikuti kategori");
        await p.selectOption("#designTypeId", { label: "Poster" });
        await nextStep(p);
        await p.fill("#requesterName", "Uji Browser");
        await p.fill("#title", "Judul Uji Browser");
        await p.selectOption("#brandId", { label: "LSP PLI" });
        await p.fill("#department", "Sertifikasi");
        await p.fill("#requesterWhatsapp", "0812-3456-7890");
        await p.selectOption("#sizePreset", "A3");
        const ed = p.locator("#brief");
        await ed.waitFor();
        await ed.click();
        await p.getByRole("button", { name: "Tebal (Ctrl+B)", exact: true }).click();
        await p.keyboard.type("Judul Brief Uji");
        await p.getByRole("button", { name: "Tebal (Ctrl+B)", exact: true }).click();
        await p.getByRole("button", { name: "Rata tengah", exact: true }).click();
        await p.keyboard.press("Enter");
        await p.getByRole("button", { name: "Rata kiri", exact: true }).click();
        // Bullet list di baris kosong → item berikutnya ikut jadi daftar
        await p.getByRole("button", { name: "Daftar berpoin", exact: true }).click();
        assert.equal(await p.getByRole("button", { name: "Daftar berpoin", exact: true }).getAttribute("aria-pressed"), "true", "tombol bullet aktif");
        for (const [i, t] of ["Logo wajib", "Warna hijau", "Ukuran A3"].entries()) {
          if (i) await p.keyboard.press("Enter");
          await p.keyboard.type(t);
        }
        await p.keyboard.press("Enter");
        await p.keyboard.press("Enter"); // Enter dua kali → keluar dari daftar
        assert.equal(await p.getByRole("button", { name: "Daftar berpoin", exact: true }).getAttribute("aria-pressed"), "false", "keluar dari bullet list");
        await p.getByRole("button", { name: "Daftar bernomor", exact: true }).click();
        await p.getByRole("button", { name: "Miring (Ctrl+I)", exact: true }).click(); // format lain aktif
        await p.keyboard.type("Langkah satu");
        await p.keyboard.press("Enter");
        await p.keyboard.type("Langkah dua");
        assert.equal(await p.getByRole("button", { name: "Daftar bernomor", exact: true }).getAttribute("aria-pressed"), "true");
        assert.equal(await ed.locator("ul > li").count(), 3);
        assert.equal(await ed.locator("ol > li").count(), 2);
        const css = await ed.evaluate((el) => [getComputedStyle(el.querySelector("ul")).listStyleType, getComputedStyle(el.querySelector("ol")).listStyleType]);
        assert.deepEqual(css, ["disc", "decimal"], "penanda daftar terlihat");
        // Keluar dari daftar, uji rata kanan & justify
        await p.keyboard.press("Enter");
        await p.keyboard.press("Enter");
        await p.getByRole("button", { name: "Miring (Ctrl+I)", exact: true }).click();
        await p.keyboard.type("Paragraf kanan");
        await p.getByRole("button", { name: "Rata kanan", exact: true }).click();
        assert.equal(await p.getByRole("button", { name: "Rata kanan", exact: true }).getAttribute("aria-pressed"), "true");
        await p.keyboard.press("Enter");
        await p.keyboard.type("Paragraf rata penuh");
        await p.getByRole("button", { name: "Rata kiri-kanan (justify)", exact: true }).click();
        await p.getByRole("button", { name: "Garis bawah (Ctrl+U)", exact: true }).click();
        await p.keyboard.type(" bergaris");
        await p.getByRole("button", { name: "Garis bawah (Ctrl+U)", exact: true }).click();
        await p.keyboard.press("Enter");
        await p.getByRole("button", { name: "Rata kiri", exact: true }).click();
        // Pilih baris yang sudah ditulis lalu ubah jadi bullet
        await p.keyboard.type("Catatan A");
        await p.keyboard.press("Enter");
        await p.keyboard.type("Catatan B");
        await p.keyboard.press("Shift+ArrowUp");
        await p.keyboard.press("Shift+Home");
        await p.getByRole("button", { name: "Daftar berpoin", exact: true }).click();
        assert.equal(await ed.locator("ul > li").count(), 5, "baris terpilih menjadi bullet");
        await nextStep(p); // langkah Tim & deadline
        const panel = p.getByTestId("team-panel");
        await panel.waitFor();
        assert.equal(await panel.getByRole("checkbox", { checked: true }).count(), 0, "PIC tidak dicentang otomatis");
        await panel.getByRole("checkbox", { name: "Gilar Dwi Rahayu" }).check();
        await panel.getByRole("checkbox", { name: "Fathin Maqbulloh Sawiji" }).check();
        assert.match(await p.getByTestId("pic-summary").innerText(), /Dipilih: Gilar Dwi Rahayu, Fathin Maqbulloh Sawiji/, "ringkasan anggota terpilih");
        await p.fill("#deadline", wibDate(10));
        assert.equal(await p.locator("#picId").count(), 0, "tidak ada pilihan PIC manual");
        await nextStep(p); // langkah Tinjau
        await p.getByRole("button", { name: "Kirim Pengajuan", exact: true }).click();
        const confirmDlg = p.getByRole("dialog", { name: "Konfirmasi Pengajuan" });
        await confirmDlg.waitFor({ state: "visible", timeout: 10000 });
        await confirmDlg.getByRole("button", { name: "Ya, Kirim Pengajuan", exact: true }).click();
        await p.getByText("Request berhasil diajukan").waitFor({ timeout: 30000 });
        const num = (await p.locator(".font-mono").first().textContent()).trim();
        const [o] = await db`select o.id, o.brief_rich, o.brief, b.name as brand from orders o join brands b on b.id = o.brand_id where order_number = ${num}`;
        browserOrder = o;
        assert.equal(o.brand, "LSP PLI", "Brand Pemohon tersimpan sebagai relasi");
        assert.deepEqual(await picNames(o.id), ["Fathin Maqbulloh Sawiji", "Gilar Dwi Rahayu"], "PIC yang dipilih pemohon");
        // Tes panel PIC berikutnya mulai dari satu PIC (Fathin, anggota tim Graphic Design), diatur lewat API resmi Super Admin.
        const reset = await internal(`/api/internal/orders/${o.id}/assignees`, "PUT", { memberIds: [M["Fathin Maqbulloh Sawiji"].id], reason: "Uji penugasan PIC" });
        assert.equal(reset.status, 200, await reset.clone().text());
        const types = o.brief_rich.content.map((n) => n.type);
        assert.deepEqual(types.filter((t) => t !== "paragraph"), ["bulletList", "orderedList", "bulletList"]);
        assert.equal(o.brief_rich.content.find((n) => n.type === "orderedList").content.length, 2);
        assert.deepEqual(o.brief_rich.content[0], { type: "paragraph", attrs: { textAlign: "center" }, content: [{ type: "text", text: "Judul Brief Uji", marks: [{ type: "bold" }] }] });
        const docJson = JSON.stringify(o.brief_rich);
        assert.match(docJson, /"italic"/);
        assert.match(docJson, /"underline"/);
        assert.match(docJson, /"textAlign":"right"/);
        assert.match(docJson, /"textAlign":"justify"/);
        await p.close();
      });
      // ---- konfirmasi "Kirim pengajuan" (browser)
      const fillMinimalForm = async (p, requester) => {
        await p.goto(`${BASE}/`);
        await pickTeam(p, "Graphic Design");
        await p.selectOption("#designTypeId", { label: "Poster" });
        await nextStep(p);
        await p.fill("#requesterName", requester);
        await p.fill("#title", `Judul ${requester}`);
        await p.selectOption("#brandId", { label: "LSP PLI" });
        await p.fill("#department", "Sertifikasi");
        await p.fill("#requesterWhatsapp", "0812-3456-7890");
        await p.selectOption("#sizePreset", "A3");
        await p.locator("#brief").click();
        await p.keyboard.type("Brief konfirmasi uji");
        await nextStep(p);
        await p.getByTestId("team-panel").getByRole("checkbox", { name: "Gilar Dwi Rahayu" }).check();
        await p.fill("#deadline", wibDate(10));
        await nextStep(p); // langkah Tinjau: tombol "Kirim pengajuan" tersedia
      };
      // Bukti visual langkah form (screenshot dari aplikasi yang berjalan, data uji).
      await test("form langkah: screenshot tiap langkah (desktop & mobile) tersimpan untuk pemeriksaan visual", async () => {
        const dir = process.env.E2E_SHOT_DIR ?? path.join(os.tmpdir(), "dtic-form-shots");
        await mkdir(dir, { recursive: true });
        const p = await ctx.newPage();
        await p.setViewportSize({ width: 1280, height: 900 });
        await p.goto(`${BASE}/`);
        await pickTeam(p, "Graphic Design");
        await p.screenshot({ path: path.join(dir, "1-kategori.png"), fullPage: true });
        await p.selectOption("#designTypeId", { label: "Poster" });
        await nextStep(p);
        await p.fill("#requesterName", "Ani Lestari");
        await p.fill("#title", "Desain Poster Seminar Lingkungan 2026");
        await p.selectOption("#brandId", { label: "LSP PLI" });
        await p.fill("#department", "Marketing");
        await p.fill("#requesterWhatsapp", "081234567890");
        await p.selectOption("#sizePreset", "A3");
        await p.locator("#brief").click();
        await p.keyboard.type("Poster seminar lingkungan, tema hijau, logo wajib.");
        await p.fill("#driveUrl", "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-panjang-sekali?usp=sharing");
        await p.screenshot({ path: path.join(dir, "2-detail.png"), fullPage: true });
        await nextStep(p);
        await p.getByTestId("team-panel").getByRole("checkbox", { name: "Gilar Dwi Rahayu" }).check();
        await p.getByTestId("team-panel").getByRole("checkbox", { name: "Fathin Maqbulloh Sawiji" }).check();
        await p.fill("#deadline", wibDate(10));
        await p.screenshot({ path: path.join(dir, "3-tim-deadline.png"), fullPage: true });
        await nextStep(p);
        await p.getByTestId("review-hero").waitFor();
        assert.ok((await p.getByTestId("review-hero").innerText()).includes("Desain Poster Seminar Lingkungan 2026"), "judul di kartu ringkasan");
        assert.equal(await p.getByRole("list", { name: "PIC terpilih" }).getByRole("listitem").count(), 2, "dua PIC sebagai item terpisah");
        assert.match(await p.getByTestId("review-brief").innerText(), /Poster seminar lingkungan/, "brief terpisah dari judul");
        assert.match(await p.getByTestId("review-completeness").innerText(), /5 dari 5 kelompok wajib terisi/);
        await p.waitForTimeout(600); // animasi masuk kartu selesai sebelum screenshot
        await p.screenshot({ path: path.join(dir, "4-tinjau.png"), fullPage: true });
        await p.getByRole("button", { name: "Kembali untuk Mengedit", exact: true }).click();
        assert.equal(await p.inputValue("#deadline"), wibDate(10), "kembali tanpa kehilangan isian");
        await nextStep(p);
        await p.setViewportSize({ width: 390, height: 844 });
        await p.waitForTimeout(300);
        const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        await p.waitForTimeout(600);
        await p.screenshot({ path: path.join(dir, "5-mobile-tinjau.png"), fullPage: true });
        assert.equal(overflow, 0, "tidak ada overflow horizontal di mobile");
        await p.close();
      });

      const ordersNamed = async (requester) => (await db`select count(*)::int as c from orders where requester_name = ${requester}`)[0].c;
      const submitBtn = (p) => p.getByRole("button", { name: "Kirim Pengajuan", exact: true });
      const confirmBtn = (p) => p.getByRole("dialog", { name: "Konfirmasi Pengajuan" }).getByRole("button", { name: "Ya, Kirim Pengajuan", exact: true });

      await test("judul pekerjaan (browser): kosong atau hanya spasi → pesan error di field, konfirmasi tidak terbuka", async () => {
        const p = await ctx.newPage();
        await p.goto(`${BASE}/`);
        await pickTeam(p, "Graphic Design");
        await p.selectOption("#designTypeId", { label: "Poster" });
        await nextStep(p);
        await p.fill("#requesterName", "Judul Kosong");
        await p.fill("#title", "   ");
        await p.selectOption("#brandId", { label: "LSP PLI" });
        await p.fill("#department", "Sertifikasi");
        await p.fill("#requesterWhatsapp", "0812-3456-7890");
        await p.selectOption("#sizePreset", "A3");
        await p.locator("#brief").click();
        await p.keyboard.type("Brief uji judul");
        await nextStep(p);
        await p.getByText("Judul pekerjaan wajib diisi.").waitFor();
        assert.equal(await p.getByRole("dialog", { name: "Konfirmasi Pengajuan" }).count(), 0, "modal tidak terbuka");
        assert.equal(await p.inputValue("#title"), "   ", "isian tetap");
        await p.close();
      });

      await test("konfirmasi pengajuan: 'Belum, Kembali Edit' menutup modal, tidak mengirim, isian tetap utuh", async () => {
        const p = await ctx.newPage();
        await fillMinimalForm(p, "Konfirmasi Batal");
        await submitBtn(p).click();
        const dlg = p.getByRole("dialog", { name: "Konfirmasi Pengajuan" });
        await dlg.waitFor({ state: "visible" });
        await dlg.getByRole("button", { name: "Belum, Kembali Edit", exact: true }).click();
        await dlg.waitFor({ state: "hidden", timeout: 5000 });
        assert.equal(await p.inputValue("#requesterName"), "Konfirmasi Batal", "isian tetap");
        await p.waitForTimeout(300);
        assert.equal(await ordersNamed("Konfirmasi Batal"), 0, "tidak ada pengiriman");
        await p.close();
      });

      await test("konfirmasi pengajuan: Esc menutup modal tanpa mengirim", async () => {
        const p = await ctx.newPage();
        await fillMinimalForm(p, "Konfirmasi Esc");
        await submitBtn(p).click();
        await p.getByRole("dialog", { name: "Konfirmasi Pengajuan" }).waitFor({ state: "visible" });
        await p.keyboard.press("Escape");
        await p.getByRole("dialog", { name: "Konfirmasi Pengajuan" }).waitFor({ state: "hidden", timeout: 5000 });
        await p.waitForTimeout(300);
        assert.equal(await ordersNamed("Konfirmasi Esc"), 0, "Esc tidak mengirim");
        assert.equal(await p.inputValue("#requesterName"), "Konfirmasi Esc");
        await p.close();
      });

      await test("konfirmasi pengajuan: klik ganda 'Ya' menghasilkan tepat satu order", async () => {
        const p = await ctx.newPage();
        await fillMinimalForm(p, "Konfirmasi Ganda");
        await submitBtn(p).click();
        await p.getByRole("dialog", { name: "Konfirmasi Pengajuan" }).waitFor({ state: "visible" });
        await confirmBtn(p).dblclick();
        await p.getByText("Request berhasil diajukan").waitFor({ timeout: 30000 });
        await p.waitForTimeout(300);
        assert.equal(await ordersNamed("Konfirmasi Ganda"), 1, "tepat satu order");
        await p.close();
      });

      await test("konfirmasi pengajuan: gagal kirim → pesan error, isian tetap; kirim ulang tidak membuat order ganda", async () => {
        const p = await ctx.newPage();
        await fillMinimalForm(p, "Konfirmasi Gagal");
        await p.route("**/api/public/orders", (route) => route.abort());
        await submitBtn(p).click();
        await p.getByRole("dialog", { name: "Konfirmasi Pengajuan" }).waitFor({ state: "visible" });
        await confirmBtn(p).click();
        // Koneksi putus: status belum pasti (bukan "belum tersimpan"). Permintaan tidak sampai ke server.
        await p.getByText("Status pengajuan belum dapat dipastikan").waitFor({ timeout: 15000 });
        assert.equal(await p.inputValue("#requesterName"), "Konfirmasi Gagal", "isian tidak hilang");
        assert.equal(await ordersNamed("Konfirmasi Gagal"), 0, "server tidak menerima permintaan");
        await p.unroute("**/api/public/orders");
        // Rekonsiliasi: belum ada pengajuan dengan kunci ini → boleh kirim ulang.
        await p.getByRole("button", { name: "Periksa status pengajuan" }).click();
        await p.getByText("Pengajuan belum ditemukan").waitFor({ timeout: 15000 });
        assert.equal(await p.inputValue("#requesterName"), "Konfirmasi Gagal", "isian tidak hilang setelah pemeriksaan");
        await submitBtn(p).click();
        await p.getByRole("dialog", { name: "Konfirmasi Pengajuan" }).waitFor({ state: "visible" });
        await confirmBtn(p).click();
        await p.getByText("Request berhasil diajukan").waitFor({ timeout: 30000 });
        assert.equal(await ordersNamed("Konfirmasi Gagal"), 1, "kirim ulang tidak menduplikasi");
        await p.close();
      });

      await test("order dibuka kembali: daftar tetap tampil sebagai daftar (detail & editor edit)", async () => {
        const p = await ctx.newPage();
        await p.goto(`${BASE}/orders/${browserOrder.id}`);
        const view = p.locator(".dtic-rich").first();
        await view.waitFor();
        assert.equal(await view.locator("ul > li").count(), 5);
        assert.equal(await view.locator("ol > li").count(), 2);
        assert.equal(await view.locator("ul").first().evaluate((el) => getComputedStyle(el).listStyleType), "disc");
        assert.equal(await view.locator("strong").first().textContent(), "Judul Brief Uji");
        await p.goto(`${BASE}/orders/${browserOrder.id}/edit`);
        const ed = p.locator("#brief");
        await ed.waitFor();
        await p.waitForFunction(() => document.querySelector("#brief ol"));
        assert.equal(await ed.locator("ul > li").count(), 5);
        assert.equal(await ed.locator("ol > li").count(), 2);
        await p.close();
      });
      const picPanel = (p) => p.getByRole("dialog", { name: "Kelola PIC" });
      await test("PIC (browser): Kelola PIC → pilih anggota tim, ringkasan & alasan wajib, konfirmasi menyimpan; daftar, Kanban, dan setelah refresh", async () => {
        const p = await ctx.newPage();
        await p.goto(`${BASE}/orders/${browserOrder.id}`);
        assert.deepEqual(await picNames(browserOrder.id), ["Fathin Maqbulloh Sawiji"], "mulai dari satu PIC");
        await p.getByRole("button", { name: "Kelola PIC", exact: true }).click();
        const dlg = picPanel(p);
        await dlg.waitFor();
        assert.equal(await dlg.getByRole("checkbox", { name: /Gilar Dwi Rahayu/ }).isChecked(), false, "anggota tidak dicentang otomatis");
        assert.equal(await dlg.getByRole("checkbox").count(), 2, "hanya anggota tim Graphic Design");
        await dlg.getByRole("checkbox", { name: /Gilar Dwi Rahayu/ }).check();
        assert.match(await dlg.getByTestId("pic-diff").innerText(), /Operasi:\s*Tambah[\s\S]*Ditambahkan: Gilar Dwi Rahayu/, "ringkasan perubahan");
        const confirm = dlg.getByRole("button", { name: "Konfirmasi perubahan PIC", exact: true });
        assert.ok(await confirm.isDisabled(), "konfirmasi nonaktif sebelum alasan diisi");
        await dlg.getByLabel(/Alasan perubahan/).fill("Gilar bantu desain tambahan");
        assert.ok(await confirm.isEnabled(), "konfirmasi aktif setelah alasan");
        await confirm.click();
        await dlg.waitFor({ state: "hidden" });
        await p.getByText("Tersimpan — Tambah PIC. Sekarang 2 PIC.").waitFor();
        assert.deepEqual(await picNames(browserOrder.id), ["Fathin Maqbulloh Sawiji", "Gilar Dwi Rahayu"], "tersimpan di database");
        const [audit] = await db`select detail from auth_audit_log where action = 'order_pic_changed' and detail->>'orderId' = ${browserOrder.id} order by created_at desc limit 1`;
        assert.equal(audit.detail.reason, "Gilar bantu desain tambahan", "alasan di audit");
        assert.equal(audit.detail.operation, "add");
        await p.reload();
        await p.waitForFunction(() => document.querySelector('[aria-label="Member yang ditugaskan"]')?.textContent?.includes("Gilar Dwi Rahayu"), null, { timeout: 15000 });
        await p.goto(`${BASE}/orders?pic=${M["Gilar Dwi Rahayu"].id}`);
        await p.getByLabel(/^PIC: .*Gilar Dwi Rahayu/).first().waitFor({ timeout: 15000 });
        await p.goto(`${BASE}/workboard`);
        await p.locator("li", { hasText: "Judul Uji Browser" }).getByLabel(/^PIC: .*Gilar Dwi Rahayu/).waitFor({ timeout: 15000 });
        await p.close();
      });
      await test("PIC (browser): konflik edit ditolak; panel tetap terbuka dan tidak menimpa perubahan orang lain", async () => {
        const p = await ctx.newPage();
        await p.goto(`${BASE}/orders/${browserOrder.id}`);
        // Pengguna lain mengubah PIC setelah halaman ini dibuka.
        const other = await internal(`/api/internal/orders/${browserOrder.id}/assignees`, "PUT", { memberIds: [M["Fathin Maqbulloh Sawiji"].id], reason: "Perubahan oleh rekan lain" });
        assert.equal(other.status, 200, await other.clone().text());
        await p.getByRole("button", { name: "Kelola PIC", exact: true }).click();
        const dlg = picPanel(p);
        await dlg.waitFor();
        // Layar ini masih memuat [Fathin, Gilar]; server sudah [Fathin]. Melepas Fathin = perubahan yang diuji konfliknya.
        await dlg.getByRole("checkbox", { name: /Fathin Maqbulloh Sawiji/ }).uncheck();
        await dlg.getByLabel(/Alasan perubahan/).fill("Lepas Fathin dari layar lama");
        await dlg.getByRole("button", { name: "Konfirmasi perubahan PIC", exact: true }).click();
        await dlg.getByText(/sudah berubah/).waitFor();
        assert.ok(await dlg.isVisible(), "panel tetap terbuka");
        assert.deepEqual(await picNames(browserOrder.id), ["Fathin Maqbulloh Sawiji"], "perubahan rekan tidak tertimpa");
        await p.close();
      });
      await test("PIC (browser): minimal satu PIC; ganti PIC; gagal simpan → pesan error, panel tetap, database tidak berubah", async () => {
        const p = await ctx.newPage();
        await p.goto(`${BASE}/orders/${browserOrder.id}`);
        await p.getByRole("button", { name: "Kelola PIC", exact: true }).click();
        const dlg = picPanel(p);
        await dlg.waitFor();
        await dlg.getByRole("checkbox", { name: /Fathin Maqbulloh Sawiji/ }).uncheck();
        await dlg.getByText("Pilih minimal satu PIC.").waitFor();
        assert.ok(await dlg.getByRole("button", { name: "Konfirmasi perubahan PIC", exact: true }).isDisabled(), "tanpa PIC tidak bisa disimpan");
        await dlg.getByRole("checkbox", { name: /Gilar Dwi Rahayu/ }).check();
        await dlg.getByLabel(/Alasan perubahan/).fill("Ganti Fathin ke Gilar");
        await dlg.getByRole("button", { name: "Konfirmasi perubahan PIC", exact: true }).click();
        await p.getByText(/Tersimpan — Pindah PIC/).waitFor(); // tidak ada PIC lama yang dipertahankan = pemindahan
        assert.deepEqual(await picNames(browserOrder.id), ["Gilar Dwi Rahayu"], "PIC diganti");
        await p.getByRole("button", { name: "Kelola PIC", exact: true }).click();
        await dlg.waitFor();
        await p.route("**/assignees", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Simulasi gangguan server" }) }));
        await dlg.getByRole("checkbox", { name: /Fathin Maqbulloh Sawiji/ }).check();
        await dlg.getByLabel(/Alasan perubahan/).fill("Tambah Fathin lagi");
        await dlg.getByRole("button", { name: "Konfirmasi perubahan PIC", exact: true }).click();
        await dlg.getByText("Simulasi gangguan server").waitFor();
        assert.ok(await dlg.isVisible(), "panel tetap terbuka");
        assert.deepEqual(await picNames(browserOrder.id), ["Gilar Dwi Rahayu"], "database tidak berubah");
        await p.unroute("**/assignees");
        await p.goto(`${BASE}/orders/${browserOrder.id}/edit`);
        await p.getByLabel(/Member DTIC yang Ditugaskan \(PIC\)/).waitFor({ timeout: 15000 }); // field PIC di form edit
        await p.close();
      });
      const HYDRATION_RE = /hydrat|did not match|#418|#423|#425/;
      const watchConsole = (p, issues) => p.on("console", (m) => m.type() === "error" && HYDRATION_RE.test(m.text()) && issues.push(m.text()));
      await test("sidebar desktop: ciutkan/perluas, tooltip, preferensi tersimpan setelah muat ulang, submenu & panah keyboard", async () => {
        const p = await ctx.newPage();
        const issues = [];
        watchConsole(p, issues);
        await p.setViewportSize({ width: 1280, height: 900 });
        await p.goto(`${BASE}/dtic/dashboard`);
        const aside = p.locator("aside");
        await aside.waitFor();
        const width = async () => (await aside.boundingBox()).width;
        // Transisi lebar 200ms: tunggu sampai lebar stabil, bukan membaca nilai di tengah animasi.
        const settled = (target) => p.waitForFunction((t) => Math.abs(document.querySelector("aside").getBoundingClientRect().width - t) < 2, target);
        await settled(256);
        assert.ok(Math.abs((await width()) - 256) < 2, "lebar awal 256px");
        await p.getByRole("button", { name: "Ciutkan sidebar" }).click();
        await settled(76);
        assert.ok(Math.abs((await width()) - 76) < 2, "diciutkan 76px");
        assert.equal(await p.evaluate(() => localStorage.getItem("dtic.sidebar.collapsed")), "1");
        assert.ok((await p.locator('aside [role="tooltip"]').count()) >= 5, "tooltip tersedia saat diciutkan");
        await p.waitForFunction(() => getComputedStyle(document.querySelector("main")).paddingLeft === "76px");
        assert.equal(await p.locator("main").evaluate((el) => getComputedStyle(el).paddingLeft), "76px", "konten ikut melebar");
        await p.reload();
        await p.getByRole("button", { name: "Perluas sidebar" }).waitFor();
        await settled(76);
        assert.ok(Math.abs((await width()) - 76) < 2, "preferensi dimuat ulang setelah refresh");
        await p.getByRole("button", { name: "Perluas sidebar" }).click();
        await settled(256);
        assert.ok(Math.abs((await width()) - 256) < 2, "kembali 256px");
        await p.getByRole("button", { name: "Buka submenu Pengaturan" }).click();
        await aside.getByRole("link", { name: "Pengaturan Website" }).waitFor();
        await aside.getByRole("link", { name: "Dashboard", exact: true }).focus();
        await p.keyboard.press("ArrowDown");
        assert.match(await p.evaluate(() => document.activeElement?.textContent ?? ""), /Pengelolaan Pekerjaan/, "panah bawah pindah fokus");
        await p.evaluate(() => localStorage.removeItem("dtic.sidebar.collapsed"));
        assert.deepEqual(issues, [], "tidak ada peringatan hidrasi");
        await p.close();
      });
      await test("sidebar mobile: drawer, tutup dengan Escape/latar, dan tertutup setelah pindah halaman", async () => {
        const p = await ctx.newPage();
        const issues = [];
        watchConsole(p, issues);
        await p.setViewportSize({ width: 390, height: 844 });
        await p.goto(`${BASE}/dtic/dashboard`);
        const drawer = p.getByRole("dialog", { name: "Menu" });
        await p.getByRole("button", { name: "Buka menu" }).click();
        await drawer.waitFor();
        await drawer.getByRole("link", { name: "Pengelolaan Pekerjaan", exact: true }).click();
        await p.waitForURL(/\/dtic\/orders/);
        assert.equal(await p.getByRole("dialog", { name: "Menu" }).count(), 0, "drawer tertutup setelah navigasi");
        await p.getByRole("button", { name: "Buka menu" }).click();
        await drawer.waitFor();
        await p.keyboard.press("Escape");
        assert.equal(await p.getByRole("dialog", { name: "Menu" }).count(), 0, "Escape menutup drawer");
        await p.getByRole("button", { name: "Buka menu" }).click();
        await drawer.waitFor();
        await p.mouse.click(370, 400);
        assert.equal(await p.getByRole("dialog", { name: "Menu" }).count(), 0, "klik latar menutup drawer");
        const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        const culprits = await p.evaluate(() => [...document.querySelectorAll("body *")].filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1).slice(0, 4).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`));
        assert.ok(overflow <= 0, `tidak ada scroll horizontal (${overflow}px) di ${p.url()}: ${culprits.join(" | ")}`);
        assert.deepEqual(issues, [], "tidak ada peringatan hidrasi");
        await p.close();
      });
      await test("Member DTIC: cari nama/Telegram, filter status Telegram, dan detail identitas di browser", async () => {
        // Data uji sendiri (bagian browser berjalan sebelum bagian Telegram).
        const deptBrowser = (await db`select id from dtic_departments where is_active order by sort_order limit 1`)[0].id;
        const mk = (fullName, extra) => internal("/api/internal/settings/members", "POST", { fullName, departmentId: deptBrowser, position: "Staff", email: "", sortOrder: 60, isActive: true, telegramDisplayName: "", telegramUsername: "", telegramUserId: "", ...extra });
        assert.equal((await mk("Budi Browser", { telegramDisplayName: "Budi P" })).status, 201);
        assert.equal((await mk("Siti Browser")).status, 201);
        const p = await ctx.newPage();
        await p.setViewportSize({ width: 1280, height: 1000 });
        await p.goto(`${BASE}/dtic/settings/members`);
        const rowFor = (name) => p.locator("tbody tr", { hasText: name });
        await rowFor("Budi Browser").waitFor({ timeout: 15000 });
        await p.getByRole("searchbox", { name: "Cari anggota" }).fill("budi p");
        assert.equal(await p.locator("tbody tr").filter({ hasText: "Anggota" }).count(), 0, "pencarian menyaring");
        assert.equal(await rowFor("Budi Browser").count(), 1, "cari berdasarkan nama Telegram");
        await p.getByRole("searchbox", { name: "Cari anggota" }).fill("");
        await p.getByLabel("Status Telegram").selectOption("not_linked");
        assert.equal(await rowFor("Siti Browser").count(), 1, "filter 'Belum dihubungkan' menampilkan Siti");
        assert.equal(await rowFor("Budi Browser").count(), 0, "filter menyembunyikan yang terdata");
        await p.getByLabel("Status Telegram").selectOption("");
        await rowFor("Budi Browser").getByRole("button", { name: "Detail Budi Browser" }).click();
        await p.getByText("Telegram User ID").first().waitFor();
        await p.getByRole("button", { name: "Lepas identitas Telegram" }).first().waitFor();
        await p.close();
      });
      await test("display (browser): baseline tanpa suara; popup pengajuan baru; suara setelah diaktifkan; bunyi berbeda untuk perubahan status", async () => {
        const d = await ctx.newPage();
        const consoleErrors = [];
        d.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
        await d.setViewportSize({ width: 1920, height: 1080 });
        await d.goto(`${BASE}/dtic/display`);
        await d.getByText(/Diperbarui/).first().waitFor({ timeout: 20000 });
        const root = d.locator("[data-theme]").first();
        assert.equal(await root.getAttribute("data-chimes"), "0", "data awal tidak memutar bunyi");
        assert.equal(await root.getAttribute("data-sound"), "off", "suara nonaktif secara default");
        const first = await submit(orderForm(brand1).fd);
        const { orderNumber: n1 } = await first.json();
        await d.getByRole("status").filter({ hasText: "PENGAJUAN BARU" }).first().waitFor({ timeout: 25000 });
        assert.ok(await d.getByText(n1).first().isVisible(), "pengajuan muncul di popup & layar");
        assert.equal(await root.getAttribute("data-chimes"), "0", "tanpa aktivasi suara tidak ada bunyi");
        await d.getByRole("button", { name: "Aktifkan Suara" }).click();
        await d.waitForFunction(() => document.querySelector("[data-theme]")?.getAttribute("data-sound") === "on", null, { timeout: 10000 });
        const second = await submit(orderForm(brand1).fd);
        const { orderNumber: n2 } = await second.json();
        await d.waitForFunction(() => document.querySelector("[data-theme]")?.getAttribute("data-chimes") === "1", null, { timeout: 25000 });
        assert.equal(await root.getAttribute("data-last-event"), "new", "bunyi order baru");
        await d.getByText(n2).first().waitFor({ timeout: 25000 });
        const row = (await db`select id from orders where order_number = ${n2}`)[0];
        assert.equal((await internal(`/api/internal/orders/${row.id}/status`, "POST", { status: "in_progress" })).status, 200);
        await d.waitForFunction(() => document.querySelector("[data-theme]")?.getAttribute("data-chimes") === "2", null, { timeout: 25000 });
        assert.equal(await root.getAttribute("data-last-event"), "status", "perubahan status memakai bunyi berbeda");
        assert.deepEqual(consoleErrors.filter((e) => !/favicon/i.test(e)), [], "tidak ada error konsol/hidrasi");
        await d.close();
      });
      await test("layar display: running text bergerak, tinggi footer 40–55px, reduced motion mematikan animasi", async () => {
        const c2 = await ctx.browser().newContext({ viewport: { width: 1366, height: 768 } });
        await c2.addCookies(await ctx.cookies());
        const t = await c2.newPage();
        await t.goto(`${BASE}/dtic/display`);
        await t.getByText(/Diperbarui/).first().waitFor({ timeout: 20000 });
        const read = () => t.evaluate(() => {
          const f = document.querySelector('footer[aria-label="Running text"]');
          const d = f.firstElementChild;
          const cs = getComputedStyle(d);
          return { anim: cs.animationName, iter: cs.animationIterationCount, tx: cs.transform, h: f.getBoundingClientRect().height };
        });
        const a = await read();
        await t.waitForTimeout(1500);
        const b = await read();
        assert.equal(a.anim, "display-ticker", "animasi running text terpasang");
        assert.equal(a.iter, "infinite", "animasi berulang");
        assert.ok(a.h >= 40 && a.h <= 55, `tinggi footer ${a.h}px`);
        assert.notEqual(a.tx, b.tx, "posisi running text berubah dari waktu ke waktu");
        await t.emulateMedia({ reducedMotion: "reduce" });
        await t.reload();
        await t.getByText(/Diperbarui/).first().waitFor({ timeout: 20000 });
        assert.equal((await read()).anim, "none", "reduced motion: animasi dimatikan");
        await c2.close();
      });

      await test("layar display: slider volume, Tes Suara tanpa membuat order, indikator memutar", async () => {
        const c2 = await ctx.browser().newContext({ viewport: { width: 1366, height: 768 } });
        await c2.addCookies(await ctx.cookies());
        const t = await c2.newPage();
        await t.goto(`${BASE}/dtic/display`);
        await t.getByText(/Diperbarui/).first().waitFor({ timeout: 20000 });
        const slider = t.getByRole("slider", { name: "Volume notifikasi suara" });
        assert.equal(await slider.inputValue(), "80", "volume default 80%");
        await slider.fill("40");
        assert.equal(await t.evaluate(() => localStorage.getItem("dtic.display.volume")), "40", "volume tersimpan");
        await slider.fill("80");
        const chimesBefore = await t.getAttribute("[data-theme]", "data-chimes");
        await t.getByRole("button", { name: "Tes Suara" }).click();
        await t.locator('[data-playing="new"]').waitFor({ timeout: 5000 });
        assert.equal(await t.getAttribute("[data-theme]", "data-sound"), "on", "Tes Suara mengaktifkan suara");
        assert.equal(await t.getAttribute("[data-theme]", "data-chimes"), chimesBefore, "tes suara tidak dihitung sebagai bunyi order");
        await t.getByRole("button", { name: "Tes Suara" }).click();
        await t.locator('[data-playing="new"]').waitFor({ timeout: 5000 });
        await t.getByRole("button", { name: "Nonaktifkan Suara" }).click();
        assert.equal(await t.locator("[data-playing]").count(), 0, "indikator hilang saat suara dinonaktifkan");
        await c2.close();
      });

      await test("tidak ada error JavaScript di browser selama uji", async () => {
        assert.deepEqual(pageErrors, []);
      });
    } finally {
      await browser.close();
    }
  }

  console.log("\nDTIC Connect — riwayat request (cari dengan nomor order)");
  let trackOrder;
  await test("pengajuan menghasilkan nomor order unik; tidak ada kode pelacakan tambahan", async () => {
    const r = await submit(orderForm(brand1).fd);
    assert.equal(r.status, 201, await r.clone().text());
    const body = await r.json();
    assert.match(body.orderNumber, /^DTIC-\d{4}-\d{5,}$/);
    assert.ok(!("trackingCode" in body), "tidak ada kode pelacakan");
    const [row] = await db`select id from orders where order_number = ${body.orderNumber}`;
    trackOrder = { orderNumber: body.orderNumber, id: row.id };
  });
  const search = (orderNumber) =>
    fetch(`${BASE}/api/public/tracking`, { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": freshIp() }, body: JSON.stringify({ orderNumber }) });
  await test("cari dengan nomor order → status awal 'Request Diterima' dari database", async () => {
    const r = await search(trackOrder.orderNumber);
    assert.equal(r.status, 200, await r.clone().text());
    const v = await r.json();
    assert.equal(v.orderNumber, trackOrder.orderNumber);
    assert.equal(v.status, "assigned");
    assert.equal(v.history.length, 1);
    assert.equal(v.history[0].note, null, "catatan internal default tidak tampil");
    assert.ok(!("internalNotes" in v) && !("attachments" in v) && !("assignees" in v) && !("brief" in v), "tidak ada data internal/brief");
  });
  await test("nomor order dalam huruf kecil / berspasi tetap ditemukan (normalisasi)", async () => {
    assert.equal((await search(`  ${trackOrder.orderNumber.toLowerCase()} `)).status, 200);
  });
  await test("nomor tidak ada → pesan jelas (404); format salah → 422", async () => {
    const miss = await search("DTIC-2099-00001");
    assert.equal(miss.status, 404);
    assert.match((await miss.json()).error, /tidak ditemukan/);
    assert.equal((await search("bukan-nomor")).status, 422);
  });
  await test("pencarian dibatasi per IP (mencegah enumerasi)", async () => {
    const ip = "198.51.100.77";
    const codes = [];
    for (let i = 0; i < 35; i++) {
      const r = await fetch(`${BASE}/api/public/tracking`, { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ orderNumber: "DTIC-2099-00001" }) });
      codes.push(r.status);
    }
    assert.ok(codes.includes(429), "rate limit aktif");
  });
  await test("tim internal mengubah status (catatan publik & internal) → riwayat publik menampilkan status baru dan waktunya", async () => {
    const r = await internal(`/api/internal/orders/${trackOrder.id}/status`, "POST", { status: "in_progress", note: "Desain mulai dikerjakan.", noteForClient: true });
    assert.equal(r.status, 200);
    const r2 = await workflow(trackOrder.id, { action: "submit_qc", note: "Catatan internal: cek warna dengan PIC" });
    assert.equal(r2.status, 200);
    const tr = await search(trackOrder.orderNumber);
    assert.equal(tr.status, 200, "pencarian berhasil setelah perubahan");
    const v = await tr.json();
    assert.equal(v.status, "pending_confirmation");
    assert.deepEqual(v.history.map((h) => h.status), ["assigned", "in_progress", "pending_confirmation"]);
    assert.equal(v.history[1].note, "Desain mulai dikerjakan.");
    assert.equal(v.history[2].note, null, "catatan internal tidak tampil");
    assert.ok(!JSON.stringify(v).includes("Catatan internal"), "teks catatan internal tidak bocor");
  });
  await test("tim DTIC mengatur pesan & hasil untuk pemohon; tautan hasil wajib https", async () => {
    let r = await internal(`/api/internal/orders/${trackOrder.id}/client-info`, "PUT", { requesterMessage: "Mohon kirim logo versi vektor (SVG/AI).", resultUrl: "" });
    assert.equal(r.status, 200);
    let v = await (await search(trackOrder.orderNumber)).json();
    assert.equal(v.requesterMessage, "Mohon kirim logo versi vektor (SVG/AI).");
    r = await internal(`/api/internal/orders/${trackOrder.id}/client-info`, "PUT", { requesterMessage: "", resultUrl: "http://insecure.example/x" });
    assert.equal(r.status, 422);
    r = await internal(`/api/internal/orders/${trackOrder.id}/client-info`, "PUT", { requesterMessage: "", resultUrl: "https://drive.google.com/drive/folders/hasil" });
    assert.equal(r.status, 200);
    v = await (await search(trackOrder.orderNumber)).json();
    assert.equal(v.requesterMessage, null);
    assert.equal(v.resultUrl, "https://drive.google.com/drive/folders/hasil");
  });
  await test("halaman publik /riwayat & konfirmasi dapat diakses tanpa login; dashboard tetap terkunci", async () => {
    assert.equal((await page("/riwayat", false)).status, 200);
    assert.ok(await redirectsToLogin(await pageRaw("/dtic/dashboard")), "dashboard tanpa sesi → login");
  });

  console.log("\nLogin internal & role-based access control");
  const memberId = async (name) => (await db`select id from dtic_members where full_name = ${name}`)[0].id;
  const nuriId = await memberId("Nuri Khusnaini");
  const created = await internal("/api/internal/users", "POST", { fullName: "Staff Uji", email: "staff@dtic.example", role: "staff", memberId: nuriId, password: "StaffUji2026" });
  const createdMgr = await internal("/api/internal/users", "POST", { fullName: "Manager Uji", email: "manager@dtic.example", role: "manager", memberId: null, password: "ManagerUji2026" });
  const staffUser = await created.json();
  const mgrUser = await createdMgr.json();
  let STAFF = "";
  let MGR = "";
  // Dua order: satu ditugaskan ke Nuri (Staff), satu tidak ditugaskan siapa pun.
  // Order kategori Dokumentasi & Event: anggota staff (Nuri) berada di tim yang sama, sehingga penugasannya valid.
  const rA = await submit(orderForm(brand1, { designTypeId: TYPES["Dokumentasi Event"], picIds: [nuriId] }).fd);
  const orderAssigned = await rA.json();
  const rB = await submit(orderForm(brand1).fd);
  const orderOther = await rB.json();
  const idOf = async (num) => (await db`select id from orders where order_number = ${num}`)[0].id;
  const assignedId = await idOf(orderAssigned.orderNumber);
  const otherId = await idOf(orderOther.orderNumber);
  await internal(`/api/internal/orders/${assignedId}/assignees`, "PUT", { memberIds: [nuriId], reason: "Uji penugasan PIC" });

  await test("akun dibuat Super Admin; Staff & Manager dapat login dengan kata sandi awal", async () => {
    assert.equal(created.status, 201, `status ${created.status}`);
    assert.equal(createdMgr.status, 201, `status ${createdMgr.status}`);
    STAFF = await login("staff@dtic.example", "StaffUji2026");
    MGR = await login("manager@dtic.example", "ManagerUji2026");
    assert.ok(STAFF.startsWith("dtic_session=") && MGR.startsWith("dtic_session="));
  });
  await test("Staff: daftar order hanya memuat order yang ditugaskan kepadanya", async () => {
    const r = await fetch(`${BASE}/dtic/orders`, { headers: { Cookie: STAFF } });
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.ok(html.includes(orderAssigned.orderNumber), "order ditugaskan terlihat");
    assert.ok(!html.includes(orderOther.orderNumber), "order orang lain tidak terlihat");
  });
  await test("Staff: detail order yang tidak ditugaskan → 404 (tidak mengungkap keberadaannya)", async () => {
    const other = await pageRaw(`/dtic/orders/${otherId}`, STAFF);
    const otherHtml = await other.text();
    assert.ok(otherHtml.includes("Pekerjaan tidak ditemukan"), "tampilan tidak ditemukan");
    assert.ok(!otherHtml.includes(orderOther.orderNumber), "tidak ada data order yang bocor");
    const mine = await pageRaw(`/dtic/orders/${assignedId}`, STAFF);
    assert.equal(mine.status, 200);
    assert.ok((await mine.text()).includes(orderAssigned.orderNumber), "order ditugaskan tampil");
  });
  await test("Staff: tidak bisa mengedit, menghapus, menugaskan, atau menutup order (server menolak)", async () => {
    assert.equal((await internal(`/api/internal/orders/${assignedId}`, "PATCH", editBody, {}, STAFF)).status, 403);
    assert.equal((await internal(`/api/internal/orders/${assignedId}`, "DELETE", undefined, {}, STAFF)).status, 403);
    assert.equal((await internal(`/api/internal/orders/${assignedId}/assignees`, "PUT", { memberIds: [], reason: "Uji penugasan PIC" }, {}, STAFF)).status, 403);
    assert.equal((await internal(`/api/internal/orders/${assignedId}/status`, "POST", { status: "cancelled", note: "Staff tidak boleh membatalkan" }, {}, STAFF)).status, 403, "staff tidak boleh membatalkan");
  });
  await test("Staff: status order yang ditugaskan boleh diubah; order orang lain → 404", async () => {
    const ok = await internal(`/api/internal/orders/${assignedId}/status`, "POST", { status: "in_progress", note: "Mulai dikerjakan" }, {}, STAFF);
    assert.equal(ok.status, 200, await ok.clone().text());
    const other = await internal(`/api/internal/orders/${otherId}/status`, "POST", { status: "in_progress" }, {}, STAFF);
    assert.equal(other.status, 404);
  });
  await test("Staff: dokumen order orang lain tidak bisa diunduh; Manager bisa", async () => {
    const withFile = await submit(orderForm(brand1, {}, [{ name: "rahasia.pdf", data: PDF, type: "application/pdf" }]).fd);
    const { orderNumber } = await withFile.json();
    const attId = (await db`select a.id from order_attachments a join orders o on o.id = a.order_id where o.order_number = ${orderNumber}`)[0].id;
    assert.equal((await fetch(`${BASE}/api/internal/attachments/${attId}`, { headers: { Cookie: STAFF } })).status, 404);
    assert.equal((await fetch(`${BASE}/api/internal/attachments/${attId}`, { headers: { Cookie: MGR } })).status, 200);
  });
  await test("Staff tidak bisa membuka pengaturan master atau pengguna; dialihkan ke halaman tidak berizin", async () => {
    for (const url of ["/dtic/settings/brands", "/dtic/settings/members", "/dtic/settings/users"]) {
      const r = await pageRaw(url, STAFF);
      // Diarahkan ke halaman tidak berizin (307 atau redirect streaming di body).
      const location = r.status === 307 ? new URL(r.headers.get("location"), BASE).pathname : "";
      const body = r.status === 200 ? await r.text() : "";
      assert.ok(location === "/dtic/unauthorized" || body.includes("/dtic/unauthorized"), `${url} → ${r.status}`);
    }
    assert.equal((await fetch(`${BASE}/api/internal/users`, { headers: { Cookie: STAFF } })).status, 403);
    assert.equal((await internal("/api/internal/settings/order-types", "POST", { name: "Bocoran", requiresDetail: false, isActive: true }, {}, STAFF)).status, 403);
  });
  await test("Manager: melihat semua order, mengubah status, tetapi TIDAK bisa mengelola akun atau membuat Super Admin", async () => {
    const list = await (await fetch(`${BASE}/dtic/orders`, { headers: { Cookie: MGR } })).text();
    assert.ok(list.includes(orderOther.orderNumber), "manager melihat order lain");
    const st = await internal(`/api/internal/orders/${otherId}/status`, "POST", { status: "in_progress" }, {}, MGR);
    assert.equal(st.status, 403, "manager memantau saja: tidak bisa mengubah status");
    assert.equal((await internal("/api/internal/users", "GET", undefined, {}, MGR)).status, 403);
    const escalate = await internal("/api/internal/users", "POST", { fullName: "Naik Pangkat", email: "naik@dtic.example", role: "super_admin", password: "NaikPangkat2026" }, {}, MGR);
    assert.equal(escalate.status, 403, "manager tidak bisa membuat Super Admin");
    assert.equal((await internal(`/api/internal/users/${staffUser.id}`, "PATCH", { role: "super_admin" }, {}, MGR)).status, 403, "manager tidak bisa mengubah role");
    assert.equal((await internal(`/api/internal/settings/brands/${brands[0].id}`, "PATCH", { name: "Tidak Boleh", slug: "tidak-boleh", isActive: true }, {}, MGR)).status, 403);
  });
  await test("Manager: menambah, mengganti, dan menghapus PIC dari tim order; wajib alasan; tim lain & ID palsu ditolak; audit tercatat", async () => {
    const [team] = await db`select t.id, t.name from orders o join dtic_teams t on t.id = o.team_id where o.id = ${otherId}`;
    assert.ok(team, "order punya tim kategori");
    const teamIds = (await db`select m.id from dtic_team_members tm join dtic_members m on m.id = tm.member_id where tm.team_id = ${team.id} and m.is_active order by m.full_name`).map((r) => r.id);
    const [outsider] = await db`select m.id from dtic_members m where m.is_active and not exists (select 1 from dtic_team_members tm where tm.member_id = m.id and tm.team_id = ${team.id}) and m.id in (select member_id from dtic_team_members) limit 1`;
    const ids = async () => (await db`select member_id from order_assignments where order_id = ${otherId} order by member_id`).map((r) => r.member_id);
    const before = await ids();
    const statusBefore = (await db`select status from orders where id = ${otherId}`)[0].status;
    const put = (body) => internal(`/api/internal/orders/${otherId}/assignees`, "PUT", { expectedMemberIds: before, ...body }, {}, MGR);
    const auditCount = async () => (await db`select count(*)::int as c from auth_audit_log where action = 'order_pic_changed'`)[0].c;

    let r = await put({ memberIds: [teamIds[0]] });
    assert.equal(r.status, 422, "alasan wajib");
    assert.ok((await r.json()).fieldErrors?.reason, "fieldErrors.reason");
    r = await put({ memberIds: [outsider.id], reason: "Tambah pendukung" });
    assert.equal(r.status, 422, "anggota dari tim lain ditolak");
    r = await put({ memberIds: [randomUUID()], reason: "Tambah pendukung" });
    assert.equal(r.status, 422, "ID palsu ditolak");
    r = await put({ memberIds: [teamIds[0]], reason: "Konflik uji", expectedMemberIds: [randomUUID()] });
    assert.equal(r.status, 409, "PIC yang sudah berubah ditolak (konflik edit)");
    assert.deepEqual(await ids(), before, "tidak ada perubahan setelah ditolak");

    const countBefore = await auditCount();
    r = await put({ memberIds: before, reason: "Tidak ada perubahan" });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).changed, false, "tanpa perubahan");
    assert.equal(await auditCount(), countBefore, "tanpa perubahan tidak ada audit palsu");

    r = await put({ memberIds: teamIds, reason: "Redistribusi beban kerja tim" });
    assert.equal(r.status, 200, await r.clone().text());
    assert.deepEqual(await ids(), [...teamIds].sort(), "semua anggota tim dapat dipilih");
    const [added] = await db`select detail from auth_audit_log where action = 'order_pic_changed' order by created_at desc limit 1`;
    assert.equal(added.detail.orderId, otherId);
    assert.equal(added.detail.reason, "Redistribusi beban kerja tim");
    assert.equal(added.detail.source, "pic_panel");
    assert.ok(["add", "replace"].includes(added.detail.operation), "operasi tambah/ganti tercatat");

    r = await put({ memberIds: [teamIds[0]], reason: "Redistribusi: sisakan satu PIC", expectedMemberIds: teamIds });
    assert.equal(r.status, 200, await r.clone().text());
    assert.deepEqual(await ids(), [teamIds[0]]);
    const [removed] = await db`select detail from auth_audit_log where action = 'order_pic_changed' order by created_at desc limit 1`;
    assert.equal(removed.detail.operation, "remove", "operasi hapus tercatat");
    assert.equal((await db`select status from orders where id = ${otherId}`)[0].status, statusBefore, "perubahan PIC tidak mengubah status order");
    r = await put({ memberIds: [], reason: "Kosongkan PIC" });
    assert.equal(r.status, 422, "minimal satu PIC tetap ditetapkan");
  });
  await test("Manager: detail & edit menampilkan aksi Kelola PIC; dashboard tanpa aksi penugasan", async () => {
    const detail = await (await fetch(`${BASE}/dtic/orders/${otherId}`, { headers: { Cookie: MGR } })).text();
    assert.ok(detail.includes("Kelola PIC"), "Manager punya aksi Kelola PIC");
    assert.doesNotMatch(detail, /Penetapan PIC dilakukan oleh Super Admin/, "teks lama sudah diganti");
    const edit = await (await fetch(`${BASE}/dtic/orders/${otherId}/edit`, { headers: { Cookie: MGR } })).text();
    assert.match(edit, /id="assigneeIds"/, "Manager melihat pilihan PIC di form edit");
    const dash = await (await fetch(`${BASE}/dtic/dashboard`, { headers: { Cookie: MGR } })).text();
    assert.doesNotMatch(dash, /Tugaskan|Assign PIC|Pindahkan Tugas/, "dashboard Manager tanpa aksi penugasan");
    const adminDetail = (await page(`/dtic/orders/${otherId}`)).html;
    assert.ok(adminDetail.includes("Kelola PIC"), "Super Admin tetap bisa menetapkan PIC");
  });
  await test("Manager: pengaturan anggota read-only (tanpa tombol ubah)", async () => {
    const r = await pageRaw("/dtic/settings/members", MGR);
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.ok(html.includes("Nuri Khusnaini"));
    assert.ok(!html.includes("Tambah member"), "tidak ada tombol tambah");
    assert.ok(await redirectsToUnauthorized(await pageRaw("/dtic/settings/brands", MGR)), "manager tidak membuka master data");
  });
  await test("perubahan role berlaku pada permintaan berikutnya: manager → staff", async () => {
    const r = await internal(`/api/internal/users/${mgrUser.id}`, "PATCH", { role: "staff" });
    assert.equal(r.status, 200);
    const list = await (await fetch(`${BASE}/dtic/orders`, { headers: { Cookie: MGR } })).text();
    assert.ok(!list.includes(orderOther.orderNumber), "sekarang staff: order lain tidak terlihat");
    assert.equal((await internal(`/api/internal/orders/${otherId}`, "PATCH", editBody, {}, MGR)).status, 403);
    await internal(`/api/internal/users/${mgrUser.id}`, "PATCH", { role: "manager" });
  });
  await test("nonaktifkan akun: sesi langsung tidak berlaku & login ditolak", async () => {
    assert.equal((await pageRaw("/dtic/dashboard", STAFF)).status, 200, "sesi aktif sebelum dinonaktifkan");
    const r = await internal(`/api/internal/users/${staffUser.id}`, "PATCH", { isActive: false });
    assert.equal(r.status, 200);
    assert.ok(await redirectsToLogin(await pageRaw("/dtic/dashboard", STAFF)), "sesi dicabut");
    const denied = await login("staff@dtic.example", "StaffUji2026").catch((e) => e);
    assert.equal(denied.status, 401);
    assert.equal(denied.body.error, "Email atau kata sandi salah.");
    await internal(`/api/internal/users/${staffUser.id}`, "PATCH", { isActive: true });
  });
  await test("logout mencabut sesi di server: cookie lama tidak dapat dipakai lagi", async () => {
    const tmp = await login("manager@dtic.example", "ManagerUji2026");
    assert.equal((await fetch(`${BASE}/api/internal/users`, { headers: { Cookie: tmp } })).status, 403);
    const out = await fetch(`${BASE}/api/dtic/auth/logout`, { method: "POST", headers: { Cookie: tmp, "X-DTIC-Request": "1", Origin: BASE } });
    assert.equal(out.status, 200);
    assert.match(out.headers.getSetCookie().join(" "), /dtic_session=;.*Max-Age=0/);
    assert.ok(await redirectsToLogin(await pageRaw("/dtic/dashboard", tmp)), "cookie lama ditolak");
  });
  await test("akun terkunci setelah 5 kali salah kata sandi; kata sandi benar pun ditolak sementara", async () => {
    await internal("/api/internal/users", "POST", { fullName: "Kunci Uji", email: "kunci@dtic.example", role: "staff", memberId: null, password: "KunciUji2026" });
    for (let i = 0; i < 5; i++) await login("kunci@dtic.example", "SalahSekali2026").catch(() => {});
    const benar = await login("kunci@dtic.example", "KunciUji2026").catch((e) => e);
    assert.equal(benar.status, 401, "terkunci");
    assert.equal(benar.body.error, "Email atau kata sandi salah.");
  });
  await test("Super Admin tidak dapat menonaktifkan / menurunkan dirinya sendiri (API)", async () => {
    const adminId = (await db`select id from app_users where email = ${ADMIN_EMAIL}`)[0].id;
    assert.equal((await internal(`/api/internal/users/${adminId}`, "PATCH", { isActive: false })).status, 422);
    assert.equal((await internal(`/api/internal/users/${adminId}`, "PATCH", { role: "staff" })).status, 422);
  });
  await test("trigger database: Super Admin aktif terakhir tidak bisa diturunkan langsung via SQL", async () => {
    let threw = null;
    try {
      await db`update app_users set role = 'staff' where email = ${ADMIN_EMAIL}`;
    } catch (e) {
      threw = e;
    }
    assert.ok(threw && /terakhir/.test(threw.message), `diharapkan galat trigger, didapat: ${threw?.message}`);
    assert.equal((await db`select role from app_users where email = ${ADMIN_EMAIL}`)[0].role, "super_admin");
  });
  await test("bootstrap idempotent: menjalankan ulang tidak mengubah akun yang sudah ada", async () => {
    const again = await runNode("scripts/bootstrap-admin.mjs", { ...process.env, DATABASE_URL, BOOTSTRAP_ADMIN_EMAIL: ADMIN_EMAIL, BOOTSTRAP_ADMIN_NAME: "Lain", BOOTSTRAP_ADMIN_PASSWORD: "PasswordLain2026" });
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /sudah ada/);
    assert.equal((await db`select count(*)::int as c from app_users where role = 'super_admin'`)[0].c, 1);
    const stillWorks = await login(ADMIN_EMAIL, ADMIN_PW).catch((e) => e);
    assert.ok(typeof stillWorks === "string", "kata sandi lama masih berlaku (tidak diambil alih)");
    ADMIN = stillWorks;
  });
  await test("halaman login & pengajuan publik tetap tanpa sesi", async () => {
    assert.equal((await pageRaw("/dtic/login")).status, 200);
    assert.equal((await pageRaw("/")).status, 200);
    assert.equal((await pageRaw("/riwayat")).status, 200);
  });

  console.log("\nMenu, pengaturan website & audit");
  // Akun khusus blok ini: akun STAFF2/MGR2 sebelumnya sudah dinonaktifkan oleh skenario RBAC.
  await internal("/api/internal/users", "POST", { fullName: "Staff Menu", email: "staff2@dtic.example", role: "staff", memberId: null, password: "StaffMenu2026" });
  await internal("/api/internal/users", "POST", { fullName: "Manager Menu", email: "manager2@dtic.example", role: "manager", memberId: null, password: "ManagerMenu2026" });
  const STAFF2 = await login("staff2@dtic.example", "StaffMenu2026");
  const MGR2 = await login("manager2@dtic.example", "ManagerMenu2026");
  const sidebarHtml = async (cookie) => (await pageRaw("/dtic/dashboard", cookie)).text();
  await test("Super Admin: menu & pengaturan website dapat dibaca; Manager & Staff tidak bisa", async () => {
    const adminMenu = await fetch(`${BASE}/api/internal/menu`, { headers: { Cookie: ADMIN } });
    assert.equal(adminMenu.status, 200);
    const items = (await adminMenu.json()).items;
    assert.ok(items.some((i) => i.key === "menu" && i.isCore), "menu inti ada");
    assert.equal((await fetch(`${BASE}/api/internal/menu`, { headers: { Cookie: MGR2 } })).status, 403);
    assert.equal((await fetch(`${BASE}/api/internal/menu`, { headers: { Cookie: STAFF2 } })).status, 403);
    assert.equal((await internal("/api/internal/site", "PUT", { systemName: "Bocoran", tagline: "", sidebarDefaultCollapsed: false }, {}, MGR2)).status, 403);
    assert.equal((await internal("/api/internal/menu/intake", "PATCH", { isVisible: false }, {}, STAFF2)).status, 403);
    assert.equal((await fetch(`${BASE}/api/internal/audit`, { headers: { Cookie: MGR2 } })).status, 403);
    assert.ok(await redirectsToUnauthorized(await pageRaw("/dtic/settings/menu", MGR2)), "manager tidak bisa membuka halaman menu");
    assert.ok(await redirectsToUnauthorized(await pageRaw("/dtic/settings/audit", STAFF2)), "staff tidak bisa membuka audit");
  });
  await test("aturan menu ditegakkan server: menu inti tidak bisa disembunyikan atau dicabut dari Super Admin", async () => {
    assert.equal((await internal("/api/internal/menu/users", "PATCH", { isVisible: false })).status, 422);
    assert.equal((await internal("/api/internal/menu/users", "PATCH", { allowedRoles: ["manager"] })).status, 422);
    assert.equal((await internal("/api/internal/menu/users", "PATCH", { allowedRoles: ["super_admin", "manager"] })).status, 422, "users.manage hanya untuk super_admin");
    assert.equal((await internal("/api/internal/menu/audit", "PATCH", { allowedRoles: ["super_admin", "staff"] })).status, 422);
    assert.equal((await internal("/api/internal/menu/tidak-ada", "PATCH", { label: "X" })).status, 404);
    assert.equal((await internal("/api/internal/menu/orders", "PATCH", { href: "https://evil.example" })).status, 422, "kolom di luar daftar tidak diterima");
    assert.equal((await internal("/api/internal/menu/orders", "PATCH", {})).status, 422);
  });
  await test("perubahan menu tampil di sidebar (dari database), tersimpan, dan tercatat audit", async () => {
    const r = await internal("/api/internal/menu/orders", "PATCH", { label: "Daftar Order Uji", sortOrder: 25 });
    assert.equal(r.status, 200, await r.clone().text());
    assert.match(await sidebarHtml(ADMIN), /Daftar Order Uji/);
    assert.match(await sidebarHtml(MGR2), /Daftar Order Uji/, "perubahan label berlaku untuk semua role yang melihat menu");
    const row = (await db`select label, sort_order from sidebar_menu_items where key = 'orders'`)[0];
    assert.deepEqual({ label: row.label, sortOrder: row.sort_order }, { label: "Daftar Order Uji", sortOrder: 25 });
    assert.equal((await db`select count(*)::int as c from auth_audit_log where action = 'menu_updated'`)[0].c >= 1, true);
  });
  await test("menu disembunyikan hilang dari sidebar role lain; menu yang diberi role baru muncul", async () => {
    assert.match(await sidebarHtml(STAFF2), /href="\/dtic\/workboard"/, "workboard tampil awal untuk staff");
    assert.equal((await internal("/api/internal/menu/workboard", "PATCH", { isVisible: false })).status, 200);
    assert.doesNotMatch(await sidebarHtml(STAFF2), /href="\/dtic\/workboard"/, "workboard disembunyikan");
    assert.doesNotMatch(await sidebarHtml(ADMIN), /href="\/dtic\/workboard"/, "berlaku juga untuk Super Admin");
    assert.equal((await internal("/api/internal/menu/intake", "PATCH", { allowedRoles: ["super_admin", "manager", "staff"] })).status, 422, "Form Pengajuan bukan menu Super Admin");
    assert.equal((await internal("/api/internal/menu/intake", "PATCH", { allowedRoles: ["manager", "staff"] })).status, 200);
    assert.match(await sidebarHtml(STAFF2), /Form Pengajuan/, "Form Pengajuan diberikan ke staff");
    assert.equal((await internal("/api/internal/menu/intake", "PATCH", { allowedRoles: ["manager"] })).status, 200);
    assert.doesNotMatch(await sidebarHtml(STAFF2), /Form Pengajuan/, "dikembalikan");
  });
  await test("reset menu mengembalikan label, visibilitas, dan role awal", async () => {
    const r = await internal("/api/internal/menu/reset", "POST");
    assert.equal(r.status, 200);
    const html = await sidebarHtml(ADMIN);
    assert.match(html, /Pengelolaan Pekerjaan/);
    assert.doesNotMatch(html, /Daftar Order Uji/);
    assert.match(await sidebarHtml(STAFF2), /href="\/dtic\/workboard"/, "workboard kembali tampil");
  });
  await test("pengaturan website: nama tampil di sidebar, logo ditolak, nilai kosong ditolak", async () => {
    assert.equal((await internal("/api/internal/site", "PUT", { systemName: "Portal Uji", tagline: "Uji", sidebarDefaultCollapsed: false, logoUrl: "https://x.example/a.png" })).status, 422);
    assert.equal((await internal("/api/internal/site", "PUT", { systemName: "X", tagline: "", sidebarDefaultCollapsed: false })).status, 422);
    const ok = await internal("/api/internal/site", "PUT", { systemName: "Portal Uji", tagline: "Uji", sidebarDefaultCollapsed: true });
    assert.equal(ok.status, 200, await ok.clone().text());
    const got = await (await internal("/api/internal/site", "GET")).json();
    assert.deepEqual(got.site, { systemName: "Portal Uji", tagline: "Uji", sidebarDefaultCollapsed: true });
    const html = await sidebarHtml(STAFF2);
    assert.match(html, /Portal Uji/);
    assert.match(html, /aria-label="Perluas sidebar"/);
    assert.match(html, /lg:pl-\[76px\]/, "default sidebar dari database: diciutkan");
    await internal("/api/internal/site", "PUT", { systemName: "DTIC Connect", tagline: "One Portal for Creative & IT Requests", sidebarDefaultCollapsed: false });
  });
  await test("audit: Super Admin melihat log tanpa rahasia; Manager & Staff tidak", async () => {
    const r = await internal("/api/internal/audit?limit=50", "GET");
    assert.equal(r.status, 200);
    const text = await r.text();
    assert.match(text, /menu_updated|site_updated/);
    assert.doesNotMatch(text, /password_hash|scrypt\$|token_hash|KataSandiUji|StaffUji2026|ManagerUji2026/);
    assert.equal((await fetch(`${BASE}/api/internal/audit`, { headers: { Cookie: MGR2 } })).status, 403);
    assert.equal((await page("/dtic/settings/audit")).status, 200);
  });
  await test("pengaturan menu & website hanya tampil untuk Super Admin (halaman)", async () => {
    assert.match((await page("/dtic/settings/menu")).html, /Pengaturan Menu/);
    assert.match((await page("/dtic/settings/website")).html, /Pengaturan Website/);
    assert.ok(await redirectsToUnauthorized(await pageRaw("/dtic/settings/website", MGR2)));
  });

  console.log("\nNotifikasi Telegram");
  const waitFor = async (fn, what, ms = 15000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await fn()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`timeout: ${what}`);
  };
  const outboxOf = async (orderNumber) =>
    (await db`select n.status, n.attempts, n.last_error from notification_outbox n join orders o on o.id = n.order_id where o.order_number = ${orderNumber}`)[0];
  const adminTg = () => fetch(`${BASE}/api/internal/integrations/telegram`, { headers: { Cookie: ADMIN } });

  await test("pengajuan valid → Telegram menerima satu pesan dengan isi dari database; HTML disaring", async () => {
    tg.mode = "ok";
    const before = tg.calls.length;
    const r = await submit(orderForm(brand1, { requesterName: "Uji <i>Tag</i> & Co" }).fd);
    assert.equal(r.status, 201);
    const { orderNumber } = await r.json();
    await waitFor(() => tg.calls.length > before, "pesan Telegram");
    const call = tg.calls.at(-1);
    assert.equal(call.token, TG_TOKEN, "token hanya dipakai di URL server");
    assert.equal(call.body.chat_id, TG_CHAT);
    assert.equal(call.body.parse_mode, "HTML");
    const text = call.body.text;
    assert.ok(text.includes(orderNumber), "nomor order");
    assert.ok(text.includes("Uji &lt;i&gt;Tag&lt;/i&gt; &amp; Co"), "nama pemohon di-escape");
    assert.ok(!text.includes("<i>Tag"), "tidak ada HTML pemohon yang lolos");
    assert.ok(text.includes("\nStatus: SIAP DIKERJAKAN\n"), "status template");
    assert.ok(text.includes("🔔 <b>REQUEST PEKERJAAN BARU</b>"), "judul template");
    assert.ok(text.includes(orderNumber), "nomor order di template");
    assert.ok(/👨‍💻 <b>PIC<\/b>\n• .+/.test(text), "PIC terpilih dari database");
    assert.ok(!/WhatsApp|62812/.test(text), "nomor WhatsApp tidak tampil di grup");
    assert.ok(!/localhost|127\.0\.0\.1/.test(text), "localhost tidak dikirim sebagai tautan di production");
    assert.ok(text.includes("📎 Lampiran: Tidak ada"), "lampiran dari database (nol)");
    assert.ok(!text.includes(TG_TOKEN), "token tidak ada di pesan");
    await waitFor(async () => (await outboxOf(orderNumber))?.status === "sent", "outbox sent");
    assert.equal((await outboxOf(orderNumber)).attempts, 1);
  });

  await test("kirim ulang dengan submissionKey sama → 200 duplicate, TIDAK ada notifikasi ganda", async () => {
    tg.mode = "ok";
    const key = randomUUID();
    const beforeFirst = tg.calls.length;
    const first = await submit(orderForm(brand1, { submissionKey: key }).fd);
    assert.equal(first.status, 201);
    await waitFor(() => tg.calls.length > beforeFirst, "pesan pertama");
    const before = tg.calls.length;
    const again = await submit(orderForm(brand1, { submissionKey: key }).fd);
    assert.equal(again.status, 200);
    assert.equal((await again.json()).duplicate, true);
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(tg.calls.length, before, "tidak ada pesan tambahan");
  });


  // --- Retry otomatis (worker/tick) ---
  const tickUntil = async (cond, what, ms = 20000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await cond()) return;
      await internal("/api/internal/telegram/worker/tick", "POST");
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error(`timeout: ${what}`);
  };
  const rowOf = async (orderNumber) =>
    (await db`select n.status, n.attempts, n.max_attempts, n.error_kind, n.last_error, extract(epoch from (n.next_attempt_at - now())) as secs_until
      from notification_outbox n join orders o on o.id = n.order_id where o.order_number = ${orderNumber} and n.kind = 'order_created' and n.event_ref = ''`)[0];
  const okSends = (orderNumber) => tg.calls.filter((c) => c.mode === "ok" && c.body.text.includes(orderNumber)).length;
  const failedSends = (orderNumber) => tg.calls.filter((c) => c.mode !== "ok" && c.body.text.includes(orderNumber)).length;
  const drainOld = async () => {
    tg.mode = "ok";
    tg.queue.length = 0;
    await tickUntil(async () => (await db`select count(*)::int as c from notification_outbox where status in ('pending', 'retrying')`)[0].c === 0, "antrean lama terkirim");
  };

  await test("Telegram gagal (HTTP 500) → pengajuan TETAP tersimpan; retry otomatis sampai 5 percobaan, lalu FAILED", async () => {
    await drainOld();
    tg.mode = "500";
    const r = await submit(orderForm(brand1).fd);
    assert.equal(r.status, 201, "tersimpan (201); status Telegram dibaca terpisah");
    const { orderNumber, notification } = await r.json();
    assert.notEqual(notification?.state, "sent", "belum dianggap terkirim selama Telegram belum mengonfirmasi");
    await waitFor(async () => (await rowOf(orderNumber))?.status === "retrying", "dijadwalkan ulang");
    assert.equal((await rowOf(orderNumber)).error_kind, "transient");
    await tickUntil(async () => (await rowOf(orderNumber))?.status === "failed", "habis 5 percobaan");
    const row = await rowOf(orderNumber);
    assert.equal(row.attempts, 5, "tepat lima percobaan");
    assert.equal(row.error_kind, "transient");
    assert.match(row.last_error, /Percobaan habis \(5 dari 5\)/);
    assert.ok(!/123456|AAHtest|api\.telegram|127\.0\.0\.1/.test(row.last_error), "pesan galat tidak membocorkan token/URL");
    assert.equal(failedSends(orderNumber), 5, "tidak ada percobaan ke-6");
    assert.equal((await db`select count(*)::int as c from orders where order_number = ${orderNumber}`)[0].c, 1);
    tg.mode = "ok";
  });
  await test("status Super Admin: 'Bermasalah', tanpa nilai token; Manager & Staff tidak bisa melihat", async () => {
    const r = await adminTg();
    assert.equal(r.status, 200);
    const text = await r.text();
    const body = JSON.parse(text);
    assert.equal(body.state, "problem");
    assert.equal(body.stateLabel, "Bermasalah");
    assert.ok(!text.includes("AAHtest") && !text.includes("123456:"), "token tidak dikembalikan");
    assert.deepEqual(body.configured, { token: true, chatId: true });
    assert.equal(body.diagnosis.globalGroup, "active", "grup global terdeteksi dari database");
    assert.equal((await fetch(`${BASE}/api/internal/integrations/telegram`, { headers: { Cookie: MGR2 } })).status, 403);
    assert.ok(await redirectsToUnauthorized(await pageRaw("/dtic/settings/integrations", MGR2)));
    assert.match((await page("/dtic/settings/integrations")).html, /Integrasi Telegram/);
  });

  await test("token salah (HTTP 401) → permanen: gagal langsung tanpa retry; setelah diperbaiki, kirim ulang → terkirim", async () => {
    await drainOld();
    tg.mode = "401";
    const r = await submit(orderForm(brand1).fd);
    const { orderNumber } = await r.json();
    await waitFor(async () => (await rowOf(orderNumber))?.status === "failed", "gagal permanen");
    const row = await rowOf(orderNumber);
    assert.equal(row.attempts, 1, "tidak diulang");
    assert.equal(row.error_kind, "permanent");
    assert.match(row.last_error, /^Gagal permanen, tidak diulang\. .*Token bot ditolak \(401 Unauthorized\)/);
    await internal("/api/internal/telegram/worker/tick", "POST");
    assert.equal(failedSends(orderNumber), 1, "tidak ada percobaan tambahan dari worker");
    tg.mode = "ok";
    const again = await internal("/api/internal/integrations/telegram/retry", "POST");
    assert.equal(again.status, 200);
    assert.equal((await rowOf(orderNumber)).status, "sent", "setelah diperbaiki, dikirim ulang");
  });
  await test("chat tidak ditemukan (HTTP 400) → permanen: tidak diulang; pesan menunjuk TELEGRAM_CHAT_ID", async () => {
    await drainOld();
    tg.mode = "badchat";
    const r = await submit(orderForm(brand1).fd);
    const { orderNumber } = await r.json();
    await waitFor(async () => (await rowOf(orderNumber))?.status === "failed", "gagal permanen (chat)");
    const row = await rowOf(orderNumber);
    assert.equal(row.attempts, 1);
    assert.equal(row.error_kind, "permanent");
    assert.match(row.last_error, /^Gagal permanen, tidak diulang\. .*Chat tujuan tidak ditemukan \(400 chat not found\)\..*Integrasi Telegram/);
    tg.mode = "ok";
    await internal("/api/internal/integrations/telegram/retry", "POST");
    assert.equal((await rowOf(orderNumber)).status, "sent", "dipulihkan setelah chat benar");
  });

  await test("gagal sementara dua kali lalu berhasil pada percobaan ketiga → Terkirim, tepat satu pesan sukses", async () => {
    await drainOld();
    tg.queue = ["500", "500"];
    const r = await submit(orderForm(brand1).fd);
    const { orderNumber } = await r.json();
    await tickUntil(async () => (await rowOf(orderNumber))?.status === "sent", "terkirim pada percobaan ketiga");
    const row = await rowOf(orderNumber);
    assert.equal(row.attempts, 3);
    assert.equal(row.last_error, null, "galat dibersihkan setelah berhasil");
    assert.equal(failedSends(orderNumber), 2);
    assert.equal(okSends(orderNumber), 1, "tidak ada pesan ganda");
  });

  await test("429 mengikuti retry_after dari Telegram (jadwal tidak lebih cepat dari retry_after)", async () => {
    await drainOld();
    tg.queue = ["429"];
    const r = await submit(orderForm(brand1).fd);
    const { orderNumber } = await r.json();
    await waitFor(async () => (await rowOf(orderNumber))?.status === "retrying", "dijadwalkan ulang (429)");
    const row = await rowOf(orderNumber);
    assert.ok(row.secs_until >= 0.8, `jeda mengikuti retry_after=1 (sisa ${row.secs_until} dtk)`);
    await tickUntil(async () => (await rowOf(orderNumber))?.status === "sent", "terkirim setelah 429");
  });

  await test("koneksi putus (tanpa respons) diperlakukan sementara dan diulang", async () => {
    await drainOld();
    tg.queue = ["drop"];
    const r = await submit(orderForm(brand1).fd);
    const { orderNumber } = await r.json();
    await waitFor(async () => (await rowOf(orderNumber))?.status === "retrying", "dijadwalkan ulang (jaringan)");
    assert.equal((await rowOf(orderNumber)).error_kind, "transient");
    await tickUntil(async () => (await rowOf(orderNumber))?.status === "sent", "terkirim setelah jaringan pulih");
  });

  await test("dua worker bersamaan (tick paralel) tidak memproses baris yang sama; tiap pesan terkirim sekali", async () => {
    await drainOld();
    tg.mode = "500";
    const numbers = [];
    for (let i = 0; i < 3; i++) numbers.push((await (await submit(orderForm(brand1).fd)).json()).orderNumber);
    await waitFor(async () => (await Promise.all(numbers.map(rowOf))).every((x) => x?.status === "retrying"), "tiga baris dijadwalkan ulang");
    await db`update notification_outbox set next_attempt_at = now() - interval '1 second' where status = 'retrying'`;
    tg.mode = "ok";
    await Promise.all([internal("/api/internal/telegram/worker/tick", "POST"), internal("/api/internal/telegram/worker/tick", "POST")]);
    await tickUntil(async () => (await Promise.all(numbers.map(rowOf))).every((x) => x?.status === "sent"), "ketiganya terkirim");
    for (const n of numbers) {
      assert.equal(okSends(n), 1, `${n} terkirim tepat sekali`);
      assert.equal((await rowOf(n)).attempts, 2, `${n}: satu gagal + satu berhasil`);
    }
  });
  await test("perubahan status → notifikasi Telegram berisi data database (mulai kerjakan & ditunda); outbox terkirim", async () => {
    tg.mode = "ok";
    const r = await submit(orderForm(brand1).fd);
    const { orderNumber } = await r.json();
    const id = (await db`select id from orders where order_number = ${orderNumber}`)[0].id;
    await waitFor(() => tg.calls.some((c) => c.body.text.includes(orderNumber) && c.body.text.includes("REQUEST PEKERJAAN BARU")), "pesan pengajuan");
    const before = tg.calls.length;
    assert.equal((await internal(`/api/internal/orders/${id}/status`, "POST", { status: "in_progress" })).status, 200);
    await waitFor(() => tg.calls.length > before, "notifikasi mulai kerjakan");
    assert.ok(tg.calls.at(-1).body.text.includes("Status baru: <b>SEDANG DIKERJAKAN</b>"), "status baru");
    const mid = tg.calls.length;
    assert.equal((await internal(`/api/internal/orders/${id}/status`, "POST", { status: "on_hold", note: "Menunggu aset logo" })).status, 200);
    await waitFor(() => tg.calls.length > mid, "notifikasi ditunda");
    const text = tg.calls.at(-1).body.text;
    assert.ok(text.includes("PEMBARUAN STATUS PEKERJAAN") && text.includes(orderNumber), "judul & nomor order");
    assert.ok(text.includes("Status baru: <b>DITUNDA</b>") && text.includes("Status sebelumnya: Sedang Dikerjakan"), "status sebelum & sesudah");
    assert.ok(text.includes("Catatan: Menunggu aset logo"), "catatan");
    assert.ok(!text.includes(TG_TOKEN), "token tidak bocor");
    await waitFor(async () => (await db`select count(*)::int as c from notification_outbox where order_id = ${id} and kind = 'status_changed' and status = 'sent'`)[0].c === 2, "dua outbox status terkirim");
  });
  console.log("\nKirim ulang Telegram & hapus order (Super Admin)");
  console.log("\nPIC pilihan pemohon berbasis tim");
  {
    const mid = async (name) => (await db`select id from dtic_members where full_name = ${name}`)[0].id;
    const teamOf = async (orderNumber) => ({
      names: (await db`select m.full_name from order_assignments a join dtic_members m on m.id = a.member_id join orders o on o.id = a.order_id where o.order_number = ${orderNumber} order by m.full_name`).map((x) => x.full_name),
      team: (await db`select t.slug from orders o join dtic_teams t on t.id = o.team_id where o.order_number = ${orderNumber}`)[0]?.slug,
      orders: (await db`select count(*)::int as c from orders where order_number = ${orderNumber}`)[0].c,
    });
    const poster = (picIds, extra = {}) => orderForm(brand1, { designTypeId: TYPES["Poster"], picIds, ...extra }).fd;
    const [gilar, fathin, luthfi, dolly, nuri, hikmah, stevan, zizi] = await Promise.all(
      ["Gilar Dwi Rahayu", "Fathin Maqbulloh Sawiji", "Luthfi Imam Tauchid Faried Akbar", "Dolly Ilham saputra Huta Julu", "Nuri Khusnaini", "Hikmatud Diyana", "Stevan Hary Laksono", "Hibatul Azizi Aminullah"].map(mid),
    );

    await test("PIC: satu anggota dipilih → hanya dia yang ditugaskan; satu order; status Siap Dikerjakan", async () => {
      const r = await submit(poster([gilar]));
      assert.equal(r.status, 201, await r.clone().text());
      const { orderNumber } = await r.json();
      const t = await teamOf(orderNumber);
      assert.deepEqual(t.names, ["Gilar Dwi Rahayu"], "tidak otomatis seluruh tim");
      assert.equal(t.team, "graphic-design");
      assert.equal(t.orders, 1);
      assert.equal((await db`select status from orders where order_number = ${orderNumber}`)[0].status, "assigned");
    });

    await test("PIC: dua anggota dipilih → keduanya pada order yang sama; Telegram satu pesan memuat keduanya", async () => {
      tg.mode = "ok";
      const before = (await db`select count(*)::int as c from orders`)[0].c;
      const r = await submit(poster([gilar, fathin]));
      assert.equal(r.status, 201, await r.clone().text());
      const { orderNumber } = await r.json();
      assert.deepEqual((await teamOf(orderNumber)).names, ["Fathin Maqbulloh Sawiji", "Gilar Dwi Rahayu"]);
      assert.equal((await db`select count(*)::int as c from orders`)[0].c, before + 1, "tidak ada order per PIC");
      const msgs = tg.calls.filter((c) => c.body.text.includes(orderNumber));
      assert.equal(msgs.length, 1, "satu notifikasi per order");
      assert.ok(msgs[0].body.text.includes("Gilar Dwi Rahayu") && msgs[0].body.text.includes("Fathin Maqbulloh Sawiji"), "semua PIC di pesan");
      assert.ok(msgs[0].body.text.includes("Kategori / Tim: Graphic Design"));
    });

    await test("PIC: seluruh anggota tim dipilih (IT: Luthfi & Dolly; Dokumentasi: Nuri, Hikmatud, Stevan)", async () => {
      const it = await submit(orderForm(brand1, { designTypeId: TYPES["Website"], sizePreset: "na", picIds: [luthfi, dolly] }).fd);
      assert.equal(it.status, 201, await it.clone().text());
      assert.deepEqual((await teamOf((await it.json()).orderNumber)).names, ["Dolly Ilham saputra Huta Julu", "Luthfi Imam Tauchid Faried Akbar"]);
      const doc = await submit(orderForm(brand1, { designTypeId: TYPES["Fotografi"], sizePreset: "na", picIds: [nuri, hikmah, stevan] }).fd);
      assert.equal(doc.status, 201, await doc.clone().text());
      assert.deepEqual((await teamOf((await doc.json()).orderNumber)).names, ["Hikmatud Diyana", "Nuri Khusnaini", "Stevan Hary Laksono"]);
    });

    await test("PIC ditolak: kosong, dari tim lain, ID palsu, duplikat, nonaktif, pengguna yang dikeluarkan → 422 tanpa order", async () => {
      const before = (await db`select count(*)::int as c from orders`)[0].c;
      const cases = [
        ["kosong", poster([])],
        ["tim lain", poster([luthfi])],
        ["campuran tim", poster([gilar, nuri])],
        ["ID palsu", poster([randomUUID()])],
        ["duplikat", poster([gilar, gilar])],
        ["pengguna dikeluarkan", poster([zizi])],
      ];
      for (const [label, fd] of cases) {
        const r = await submit(fd);
        assert.equal(r.status, 422, label);
        assert.ok((await r.json()).fieldErrors?.picIds, `${label}: pesan pada field PIC`);
      }
      await db`update dtic_members set is_active = false where id = ${fathin}`;
      const inactive = await submit(poster([fathin]));
      assert.equal(inactive.status, 422, "anggota nonaktif");
      await db`update dtic_members set is_active = true where id = ${fathin}`;
      assert.equal((await db`select count(*)::int as c from orders`)[0].c, before, "tidak ada order tersimpan");
    });

    await test("kategori tidak valid / jenis bukan milik kategori → 422; picId/assigneeIds dari klien diabaikan", async () => {
      let r = await submit(orderForm(brand1, { teamId: randomUUID(), picIds: [gilar] }).fd);
      assert.equal(r.status, 422);
      assert.ok((await r.json()).fieldErrors.teamId);
      r = await submit(orderForm(brand1, { designTypeId: TYPES["Poster"], teamId: TEAMS["it-system-management"], picIds: [luthfi] }).fd);
      assert.equal(r.status, 422);
      assert.ok((await r.json()).fieldErrors.designTypeId, "jenis harus milik kategori");
      const fd = poster([gilar]);
      fd.set("picId", zizi);
      fd.append("assigneeIds", zizi);
      r = await submit(fd);
      assert.equal(r.status, 201, await r.clone().text());
      assert.deepEqual((await teamOf((await r.json()).orderNumber)).names, ["Gilar Dwi Rahayu"], "hanya PIC yang dipilih & valid");
      const dup = await db`select order_id, member_id from order_assignments group by order_id, member_id having count(*) > 1`;
      assert.equal(dup.length, 0, "tidak ada relasi PIC duplikat");
    });

    await test("pengguna yang dikeluarkan (Reza, Zizi) tidak ada di pilihan form; akun & riwayat tetap", async () => {
      const { html } = await page("/", false);
      assert.ok(html.includes("Gilar Dwi Rahayu") && html.includes("Luthfi Imam Tauchid Faried Akbar"), "anggota tim tampil di data form");
      for (const n of ["Muhammad Reza Alamsyah", "Hibatul Azizi Aminullah"]) assert.ok(!html.includes(n), `${n} tidak muncul di form publik`);
      const kept = await db`select full_name, is_active from dtic_members where full_name in ('Muhammad Reza Alamsyah', 'Hibatul Azizi Aminullah') order by full_name`;
      assert.deepEqual(kept.map((k) => [k.full_name, k.is_active]), [["Hibatul Azizi Aminullah", true], ["Muhammad Reza Alamsyah", true]], "akun tidak dihapus/dinonaktifkan");
    });

    await test("migrasi: anggota tim terhubung ke Member DTIC yang sudah ada; order lama tetap terbaca", async () => {
      const rows = await db`select t.slug, m.full_name from dtic_team_members tm join dtic_teams t on t.id = tm.team_id join dtic_members m on m.id = tm.member_id order by t.slug, m.full_name`;
      const by = (slug) => rows.filter((r) => r.slug === slug).map((r) => r.full_name);
      assert.deepEqual(by("graphic-design"), ["Fathin Maqbulloh Sawiji", "Gilar Dwi Rahayu"]);
      assert.deepEqual(by("it-system-management"), ["Dolly Ilham saputra Huta Julu", "Luthfi Imam Tauchid Faried Akbar"]);
      assert.deepEqual(by("dokumentasi-event"), ["Hikmatud Diyana", "Nuri Khusnaini", "Stevan Hary Laksono"]);
      const [legacy] = await db`select id from orders order by created_at limit 1`;
      assert.equal((await page(`/dtic/orders/${legacy.id}`)).status, 200, "order paling lama tetap bisa dibuka");
    });

    await test("judul pekerjaan (API): wajib & 3–160 karakter, disimpan apa adanya, tampil di detail, daftar & Telegram", async () => {
      const before = (await db`select count(*)::int as c from orders`)[0].c;
      for (const title of [undefined, "", "   ", "ab", "x".repeat(161)]) {
        const fd = orderForm(brand1, { designTypeId: TYPES["Poster"], picIds: [gilar] }).fd;
        fd.delete("title");
        if (title !== undefined) fd.set("title", title);
        const r = await submit(fd);
        assert.equal(r.status, 422, `judul ${JSON.stringify(title?.slice(0, 5))}`);
        assert.ok((await r.json()).fieldErrors.title, "fieldErrors.title");
      }
      assert.equal((await db`select count(*)::int as c from orders`)[0].c, before, "tidak ada order tersimpan");
      tg.mode = "ok";
      const title = "Judul Uji Seminar Lingkungan 2026";
      const r = await submit(orderForm(brand1, { designTypeId: TYPES["Poster"], picIds: [gilar], title }).fd);
      assert.equal(r.status, 201, await r.clone().text());
      const { orderNumber } = await r.json();
      const [row] = await db`select id, title, brief from orders where order_number = ${orderNumber}`;
      assert.equal(row.title, title, "judul dari field, bukan dari deskripsi");
      assert.ok(row.brief.startsWith("Poster Promo Akhir Tahun"), "deskripsi tidak berubah");
      assert.ok(tg.calls.some((c) => c.body.text.includes(orderNumber) && c.body.text.includes(`Judul: <b>${title}</b>`)), "Telegram memuat judul");
      assert.ok((await page(`/dtic/orders/${row.id}`)).html.includes(title), "tampil di detail order");
      assert.ok((await page("/dtic/orders")).html.includes(title), "tampil di daftar order");
    });
  }

  // ---------------------------------------------------------------- Telegram global (satu grup untuk semua brand)
  {
    const bRows = await db`select id, name from brands order by sort_order`;
    const chatsFor = (orderNumber) => tg.calls.filter((c) => c.body.text.includes(orderNumber)).map((c) => c.body.chat_id);
    const ALL_EVENTS = { new_order: true, status_changed: true, waiting_confirmation: true, completed: true, on_hold: true, cancelled: true, pic_changed: true };
    const G = "/api/internal/telegram-brands/default";
    const putGlobal = (patch = {}, cookie = ADMIN) => internal(G, "PUT", { isActive: true, events: ALL_EVENTS, ...patch }, {}, cookie);
    const verifyGlobal = (link, replace = false, cookie = ADMIN) => internal(`${G}/verify`, "POST", { link, replace }, {}, cookie);
    const globalRow = async () => (await db`select * from telegram_brand_channels where brand_id is null`)[0];
    const countOrders = async () => (await db`select count(*)::int as c from orders`)[0].c;
    const rowFor = async (orderNumber) =>
      (await db`select n.status, n.attempts, n.last_error from notification_outbox n join orders o on o.id = n.order_id where o.order_number = ${orderNumber} and n.kind = 'order_created' and n.event_ref = ''`)[0];

    await test("semua brand → satu grup global: Brand A dan Brand B masuk ke grup yang sama; nama brand ada di pesan", async () => {
      tg.mode = "ok";
      const numbers = [];
      for (const b of [bRows[0], bRows[1]]) {
        const r = await submit(orderForm(b.id).fd);
        assert.equal(r.status, 201, await r.clone().text());
        numbers.push([b, (await r.json()).orderNumber]);
      }
      for (const [b, n] of numbers) {
        await waitFor(async () => (await rowFor(n))?.status === "sent", "terkirim");
        assert.deepEqual(chatsFor(n), [TG_CHAT], `${b.name} → grup global`);
        assert.ok(tg.calls.find((c) => c.body.text.includes(n)).body.text.includes(b.name), "brand dicantumkan di pesan");
      }
    });

    await test("brand yang tidak pernah punya grup tetap terkirim ke grup global (brand tidak menentukan tujuan)", async () => {
      const r = await submit(orderForm(bRows[4].id).fd);
      assert.equal(r.status, 201, await r.clone().text());
      const { orderNumber } = await r.json();
      await waitFor(async () => (await rowFor(orderNumber))?.status === "sent", "terkirim");
      assert.deepEqual(chatsFor(orderNumber), [TG_CHAT]);
    });

    await test("konfigurasi per brand lama tidak dipakai: tidak ada pengiriman ganda; API per brand ditolak (404)", async () => {
      await db`insert into telegram_brand_channels (brand_id, chat_id, chat_title, verification_status, verified_at, is_active)
               values (${bRows[0].id}, ${TG_CHAT_2}, 'Grup brand lama', 'verified', now(), true)`;
      const r = await submit(orderForm(bRows[0].id).fd);
      const { orderNumber } = await r.json();
      await waitFor(async () => (await rowFor(orderNumber))?.status === "sent", "terkirim");
      assert.deepEqual(chatsFor(orderNumber), [TG_CHAT], "hanya grup global; grup brand lama tidak menerima");
      assert.equal((await internal(`/api/internal/telegram-brands/${bRows[0].id}`, "PUT", { isActive: true, events: ALL_EVENTS })).status, 404);
      assert.equal((await internal(`/api/internal/telegram-brands/${bRows[0].id}/verify`, "POST", { link: "https://t.me/c/1234567891/1" })).status, 404);
      await db`delete from telegram_brand_channels where brand_id = ${bRows[0].id}`;
    });

    await test("grup global nonaktif: pengajuan tersimpan & Menunggu Tujuan; diaktifkan → terkirim tepat sekali tanpa order baru", async () => {
      assert.equal((await putGlobal({ isActive: false })).status, 200);
      const before = await countOrders();
      const r = await submit(orderForm(bRows[2].id).fd);
      assert.equal(r.status, 201, await r.clone().text());
      const body = await r.json();
      assert.equal(body.notification?.state, "no_destination");
      assert.equal((await rowFor(body.orderNumber)).status, "awaiting_destination");
      assert.equal(chatsFor(body.orderNumber).length, 0, "tidak ada klaim terkirim");
      const on = await putGlobal();
      assert.equal(on.status, 200);
      assert.ok((await on.json()).recovered >= 1, "aktivasi memulihkan yang menunggu");
      await waitFor(async () => (await rowFor(body.orderNumber))?.status === "sent", "terkirim setelah aktif");
      assert.deepEqual(chatsFor(body.orderNumber), [TG_CHAT], "tepat satu pesan");
      assert.equal(await countOrders(), before + 1, "tidak ada order baru");
    });

    await test("worker: tanpa tujuan tick tidak mencoba (0 percobaan); grup diaktifkan langsung di database → tick mengirim sekali", async () => {
      assert.equal((await putGlobal({ isActive: false })).status, 200);
      const { orderNumber } = await (await submit(orderForm(bRows[1].id).fd)).json();
      const callsBefore = tg.calls.length;
      for (let i = 0; i < 3; i++) await internal("/api/internal/telegram/worker/tick", "POST");
      const waiting = await rowFor(orderNumber);
      assert.equal(waiting.status, "awaiting_destination");
      assert.equal(waiting.attempts, 0, "tidak ada retry selama belum ada tujuan");
      assert.equal(tg.calls.length, callsBefore);
      await db`update telegram_brand_channels set is_active = true where brand_id is null`; // tanpa pemicu API
      await tickUntil(async () => (await rowFor(orderNumber))?.status === "sent", "terkirim oleh worker");
      for (let i = 0; i < 2; i++) await internal("/api/internal/telegram/worker/tick", "POST");
      assert.deepEqual(chatsFor(orderNumber), [TG_CHAT], "tick berikutnya tidak mengirim ulang");
      assert.ok(appLog.includes("[telegram-worker] menunggu tujuan:") && appLog.includes("dipindahkan ke antrean kirim"), "log worker");
      assert.ok(!appLog.includes(TG_TOKEN), "token tidak dicatat");
    });

    await test("jenis 'pengajuan baru' dimatikan: pengajuan tersimpan (201) dan dilewati dengan alasan", async () => {
      assert.equal((await putGlobal({ events: { ...ALL_EVENTS, new_order: false } })).status, 200);
      const r = await submit(orderForm(bRows[0].id).fd);
      assert.equal(r.status, 201);
      const body = await r.json();
      assert.equal((await rowFor(body.orderNumber)).status, "skipped");
      assert.match((await rowFor(body.orderNumber)).last_error, /dinonaktifkan/);
      assert.equal((await putGlobal()).status, 200);
    });

    await test("perubahan status → grup global, satu pesan per transisi", async () => {
      tg.mode = "ok";
      const { orderNumber } = await (await submit(orderForm(bRows[3].id).fd)).json();
      const id = (await db`select id from orders where order_number = ${orderNumber}`)[0].id;
      await waitFor(async () => (await rowFor(orderNumber))?.status === "sent", "pengajuan terkirim");
      const before = tg.calls.length;
      assert.equal((await internal(`/api/internal/orders/${id}/status`, "POST", { status: "in_progress", note: "Mulai" })).status, 200);
      await tickUntil(async () => tg.calls.length > before, "notifikasi status");
      await new Promise((resolve) => setTimeout(resolve, 200));
      const calls = tg.calls.slice(before).filter((c) => c.body.text.includes(orderNumber));
      assert.equal(calls.length, 1);
      assert.equal(calls[0].body.chat_id, TG_CHAT);
    });

    await test("Kirim Pesan Uji ke grup global: tidak membuat antrean; hasil tercatat; klik ganda dikunci (429)", async () => {
      const outboxBefore = (await db`select count(*)::int as c from notification_outbox`)[0].c;
      const r = await internal(`${G}/test`, "POST");
      assert.equal(r.status, 200, await r.clone().text());
      assert.equal(tg.calls.at(-1).body.chat_id, TG_CHAT);
      assert.ok(tg.calls.at(-1).body.text.includes("Tes koneksi DTIC Connect berhasil"));
      assert.equal((await globalRow()).last_test_result, "ok");
      assert.equal((await db`select count(*)::int as c from notification_outbox`)[0].c, outboxBefore, "tidak membuat antrean");
      await db`update telegram_brand_channels set test_locked_until = now() + interval '1 minute' where brand_id is null`;
      const calls = tg.calls.length;
      assert.equal((await internal(`${G}/test`, "POST")).status, 429);
      assert.equal(tg.calls.length, calls);
      await db`update telegram_brand_channels set test_locked_until = null where brand_id is null`;
    });

    await test("riwayat grup global & daftar konfigurasi tidak memuat chat ID utuh", async () => {
      const h = await internal(`${G}/history`, "GET");
      assert.equal(h.status, 200);
      const ht = await h.text();
      assert.ok(JSON.parse(ht).rows.length > 0);
      assert.ok(!ht.includes(TG_CHAT) && !ht.includes(TG_TOKEN));
      const l = await internal("/api/internal/telegram-brands", "GET");
      assert.ok(!(await l.text()).includes(TG_CHAT), "chat ID utuh tidak pernah dikirim");
    });

    await test("izin: Manager & Staff tidak bisa membaca, mengubah, memverifikasi, menguji, atau memutus grup global", async () => {
      const MGR_G = await login("manager@dtic.example", "ManagerUji2026");
      const STF_G = await login("staff@dtic.example", "StaffUji2026");
      for (const cookie of [MGR_G, STF_G]) {
        assert.equal((await internal("/api/internal/telegram-brands", "GET", undefined, {}, cookie)).status, 403);
        assert.equal((await putGlobal({}, cookie)).status, 403);
        assert.equal((await verifyGlobal("https://t.me/c/1234567890/1", true, cookie)).status, 403);
        assert.equal((await internal(`${G}/test`, "POST", undefined, {}, cookie)).status, 403);
        assert.equal((await internal(`${G}/history`, "GET", undefined, {}, cookie)).status, 403);
        assert.equal((await internal(G, "DELETE", undefined, {}, cookie)).status, 403);
      }
      assert.equal((await globalRow()).chat_id, TG_CHAT, "konfigurasi tidak berubah");
    });

    await test("verifikasi link: tidak didukung, bot tanpa akses, identitas tidak cocok, galat transport (tanpa label '(0)'); grup tetap", async () => {
      const before = tg.calls.length;
      for (const link of ["https://t.me.evil.example/c/1234567890/1", "https://t.me/+AbCdEf123", "http://t.me/c/1234567890/1", "https://user:pw@t.me/c/1234567890/1", "javascript:alert(1)"]) {
        const r = await verifyGlobal(link);
        assert.equal(r.status, 422, link);
        assert.equal((await r.json()).status, "unsupported_link", link);
      }
      assert.equal((await (await verifyGlobal("https://t.me/c/1234566666/7")).json()).status, "bot_no_access", "bot bukan anggota");
      assert.equal((await (await verifyGlobal("https://t.me/c/1234500000/7")).json()).status, "bot_no_access", "grup tidak terlihat bot");
      assert.equal((await (await verifyGlobal("https://t.me/c/1234567988/3")).json()).status, "target_mismatch");
      for (const [method, mode, re] of [["getChat", "drop", /terputus|Tidak dapat terhubung/], ["getChat", "429", /7 detik/], ["getChat", "html", /tidak valid \(HTTP 200\)/], ["getChat", "500", /bermasalah/], ["getMe", "401", /Token bot ditolak/]]) {
        tg.lookup = { [method]: mode };
        const body = await (await verifyGlobal("https://t.me/c/1234567891/1")).json();
        assert.equal(body.status, "failed", `${method}/${mode}`);
        assert.match(body.message, re);
        assert.doesNotMatch(body.message, /\(0\)|Respons Telegram: 0/);
      }
      tg.lookup = {};
      assert.equal(tg.calls.length, before, "tidak ada pesan terkirim");
      assert.equal((await globalRow()).chat_id, TG_CHAT, "kegagalan tidak mengubah grup global");
    });

    await test("ganti grup global: tanpa konfirmasi 409; grup forum → topik disimpan & dipakai (message_thread_id); grup biasa didukung", async () => {
      const ask = await verifyGlobal("https://t.me/c/1234567333/52942");
      assert.equal(ask.status, 409);
      assert.equal((await ask.json()).status, "replace_required");
      const yes = await verifyGlobal("https://t.me/c/1234567333/52942", true);
      assert.equal(yes.status, 200, await yes.clone().text());
      assert.match((await yes.json()).message, /topik #52942/);
      assert.equal((await globalRow()).message_thread_id, 52942);
      assert.equal((await globalRow()).is_active, false, "ganti grup menonaktifkan sampai diaktifkan lagi");
      assert.equal((await putGlobal()).status, 200);
      const r = await submit(orderForm(bRows[2].id).fd);
      assert.equal(r.status, 201, await r.clone().text());
      const forumOrder = (await r.json()).orderNumber;
      const sent = tg.calls.filter((c) => c.body.text.includes(forumOrder));
      assert.equal(sent.length, 1);
      assert.equal(sent[0].body.chat_id, "-1001234567333");
      assert.equal(sent[0].body.message_thread_id, 52942, "masuk ke topik, bukan General");
      const basic = await verifyGlobal("https://t.me/c/1234567444", true);
      assert.equal(basic.status, 200, await basic.clone().text());
      assert.equal((await globalRow()).chat_id, "-1234567444", "grup biasa memakai ID tanpa -100");
      assert.equal((await verifyGlobal("https://t.me/c/1234567890/1", true)).status, 200, "kembali ke grup uji utama");
      assert.equal((await globalRow()).message_thread_id, null);
      assert.equal((await putGlobal()).status, 200);
    });

    await test("putuskan grup global: notifikasi tertunda kembali Menunggu Tujuan; disambung & diaktifkan → terkirim sekali", async () => {
      tg.mode = "500";
      const r = await submit(orderForm(bRows[1].id).fd);
      assert.equal(r.status, 201);
      const { orderNumber } = await r.json();
      tg.mode = "ok";
      const d = await internal(G, "DELETE");
      assert.equal(d.status, 200, await d.clone().text());
      assert.equal((await d.json()).requeued, 1);
      assert.equal(await globalRow(), undefined);
      assert.equal((await rowFor(orderNumber)).status, "awaiting_destination");
      assert.equal((await verifyGlobal("https://t.me/c/1234567890/1")).status, 200);
      assert.equal((await putGlobal()).status, 200);
      await tickUntil(async () => (await rowFor(orderNumber))?.status === "sent", "terkirim setelah disambung");
      assert.equal(tg.calls.filter((c) => c.mode === "ok" && c.body.text.includes(orderNumber)).length, 1, "tepat satu pesan sukses");
    });

    await test("kirim ulang tanpa tujuan: Menunggu Tujuan, klik lagi tidak menggandakan; setelah aktif → satu pesan, tanpa order baru", async () => {
      assert.equal((await putGlobal({ isActive: false })).status, 200);
      const [o] = await db`select id, order_number from orders order by created_at desc limit 1`;
      const callsBefore = tg.calls.length;
      const before = await countOrders();
      const r1 = await internal(`/api/internal/orders/${o.id}/telegram`, "POST", { key: randomUUID() });
      assert.equal(r1.status, 422);
      const b1 = await r1.json();
      assert.equal(b1.code, "no_destination");
      assert.match(b1.message, /Belum ada tujuan Telegram yang aktif/);
      const r2 = await internal(`/api/internal/orders/${o.id}/telegram`, "POST", { key: randomUUID() });
      assert.equal((await r2.json()).code, "awaiting_destination");
      assert.equal((await db`select count(*)::int as c from notification_outbox where order_id = ${o.id} and status = 'awaiting_destination'`)[0].c, 1, "tidak ada antrean ganda");
      assert.equal(tg.calls.length, callsBefore);
      assert.equal((await putGlobal()).status, 200);
      await waitFor(() => tg.calls.slice(callsBefore).some((c) => c.body.text.includes(o.order_number)), "terkirim setelah aktif");
      assert.equal(tg.calls.slice(callsBefore).filter((c) => c.body.text.includes(o.order_number)).length, 1);
      assert.equal(await countOrders(), before, "tidak ada order baru");
    });

    await test("diagnostik: pratinjau menunjukkan tujuan global; cek token valid/invalid tanpa membocorkan token", async () => {
      const [o] = await db`select id from orders order by created_at desc limit 1`;
      const p = await (await internal(`/api/internal/orders/${o.id}/telegram/preview`, "GET")).json();
      assert.equal(p.tokenConfigured, true);
      assert.equal(p.destination.kind, "global");
      const ok = await (await internal("/api/internal/integrations/telegram/check", "POST")).text();
      assert.match(ok, /"state":"valid"/);
      tg.lookup = { getMe: "401" };
      const bad = await (await internal("/api/internal/integrations/telegram/check", "POST")).text();
      tg.lookup = {};
      assert.match(bad, /"state":"invalid"/);
      assert.ok(!ok.includes(TG_TOKEN) && !bad.includes(TG_TOKEN));
    });
  }

  const telegramSent = (orderNumber) => tg.calls.filter((c) => c.body.text.includes(orderNumber)).length;
  const newOrderSent = async () => {
    const r = await submit(orderForm(brand1).fd);
    const { orderNumber } = await r.json();
    const id = (await db`select id from orders where order_number = ${orderNumber}`)[0].id;
    await waitFor(async () => (await outboxOf(orderNumber))?.status === "sent", "pesan awal terkirim");
    return { orderNumber, id };
  };
  await test("izin: Manager & Staff ditolak untuk pratinjau, kirim ulang, tes order, dan hapus (403/404 di server)", async () => {
    // Akun Staff baru: akun STAFF sebelumnya sudah dinonaktifkan oleh skenario RBAC.
    await internal("/api/internal/users", "POST", { fullName: "Staff Aksi", email: "staff-aksi@dtic.example", role: "staff", memberId: null, password: "StaffAksi2026" });
    const STAFF_AKSI = await login("staff-aksi@dtic.example", "StaffAksi2026");
    const { id } = await newOrderSent();
    const preview = await fetch(`${BASE}/api/internal/orders/${id}/telegram/preview`, { headers: { Cookie: MGR2 } });
    assert.equal(preview.status, 403);
    assert.equal((await internal(`/api/internal/orders/${id}/telegram`, "POST", { key: randomUUID() }, {}, MGR2)).status, 403);
    assert.equal((await internal("/api/internal/integrations/telegram/test-order", "POST", { orderId: id }, {}, MGR2)).status, 403);
    assert.equal((await internal(`/api/internal/orders/${id}`, "DELETE", undefined, {}, MGR2)).status, 403);
    assert.equal((await internal(`/api/internal/orders/${id}/telegram`, "POST", { key: randomUUID() }, {}, STAFF_AKSI)).status, 403);
    assert.equal((await internal(`/api/internal/orders/${id}`, "DELETE", undefined, {}, STAFF_AKSI)).status, 403);
  });
  await test("Halaman internal tanpa tombol buat pekerjaan; pengajuan hanya lewat halaman awal", async () => {
    for (const url of ["/dtic/dashboard", "/dtic/orders"]) {
      const html = (await page(url, true)).html;
      assert.doesNotMatch(html, /Buat order|Buat pekerjaan|Buat Pekerjaan/i, `${url} tanpa tombol pengajuan`);
    }
    assert.match((await page("/dtic/orders", true)).html, /Pengelolaan Pekerjaan/);
  });

  await test("Distribusi Pekerjaan: Manager & Super Admin melihat daftar + Atur PIC; Staff tidak", async () => {
    const mgr = await pageRaw("/dtic/distribusi", MGR);
    assert.equal(mgr.status, 200);
    const mgrHtml = await mgr.text();
    assert.ok(mgrHtml.includes("Distribusi Pekerjaan") && mgrHtml.includes("Atur PIC"), "Manager melihat menu & aksi");
    const adminHtml = (await page("/dtic/distribusi", true)).html;
    assert.ok(adminHtml.includes("Atur PIC"), "Super Admin melihat aksi");
    const staffHtml = await (await pageRaw("/dtic/distribusi", STAFF)).text();
    assert.ok(!staffHtml.includes("Atur PIC"), "Staff tidak melihat aksi PIC");
    assert.ok(!staffHtml.includes("Distribusi Pekerjaan</h1>"), "Staff tidak melihat halaman distribusi");
  });

  await test("Distribusi Pekerjaan: PIC diubah dari daftar lewat API yang sama (alasan, audit, satu notifikasi)", async () => {
    const [team] = await db`select t.id from dtic_teams t where t.slug = 'dokumentasi-event'`;
    const [o] = await db`select o.id, o.order_number from orders o where o.team_id = ${team.id} and o.status not in ('completed','cancelled') order by o.order_number limit 1`;
    assert.ok(o, "ada pekerjaan terbuka kategori Dokumentasi");
    const before = (await db`select member_id from order_assignments where order_id = ${o.id}`).map((r) => r.member_id);
    const target = M["Nuri Khusnaini"].id;
    const r = await internal(`/api/internal/orders/${o.id}/assignees`, "PUT", { memberIds: [target], reason: "Distribusi uji", expectedMemberIds: before }, {}, MGR);
    assert.equal(r.status, 200, await r.clone().text());
    assert.deepEqual((await db`select member_id from order_assignments where order_id = ${o.id}`).map((x) => x.member_id), [target]);
    const [audit] = await db`select detail from auth_audit_log where action = 'order_pic_changed' and detail->>'orderId' = ${o.id} order by id desc limit 1`;
    assert.equal(audit.detail.reason, "Distribusi uji");
    assert.equal(audit.detail.source, "pic_panel");
  });

  await test("Manager: pekerjaan lama tanpa tim dapat diatur PIC-nya (tim diambil dari jenis pekerjaan)", async () => {
    await db`update orders set team_id = null where id = ${otherId}`;
    const [team] = await db`select t.id from orders o join design_order_types dot on dot.id = o.design_order_type_id join dtic_teams t on t.id = dot.team_id where o.id = ${otherId}`;
    assert.ok(team, "jenis pekerjaan punya tim");
    const html = await (await pageRaw(`/dtic/orders/${otherId}`, MGR)).text();
    assert.ok(html.includes("Kelola PIC"), "tombol Kelola PIC tersedia untuk pekerjaan lama");
    const member = (await db`select m.id from dtic_team_members tm join dtic_members m on m.id = tm.member_id where tm.team_id = ${team.id} and m.is_active order by m.full_name limit 1`)[0];
    const before = (await db`select member_id from order_assignments where order_id = ${otherId}`).map((r) => r.member_id);
    const r = await internal(`/api/internal/orders/${otherId}/assignees`, "PUT", { memberIds: [member.id], reason: "Pekerjaan lama tanpa tim", expectedMemberIds: before }, {}, MGR);
    assert.equal(r.status, 200, await r.clone().text());
  });

  await test("Dashboard & Distribusi: grafik tampil; total pekerjaan aktif sama dengan database (tanpa penggandaan multi-PIC)", async () => {
    const dash = (await page("/dtic/dashboard", true)).html;
    for (const label of ["Tren pekerjaan", "Distribusi status", "Pekerjaan per tim"]) assert.ok(dash.includes(label), label);
    // React menyisipkan <!-- --> di antara angka dan kata pada HTML server.
    for (const n of [7, 30, 90]) assert.match(dash, new RegExp(`>${n}(<!-- -->)? hari<`), `preset ${n} hari`);
    const dist = (await page("/dtic/distribusi", true)).html;
    const [{ c }] = await db`select count(*)::int as c from orders where status not in ('completed','cancelled')`;
    assert.match(dist, new RegExp(`Total pekerjaan aktif: (<!-- -->)?${c}<`), `total aktif ${c}`);
    const [{ multi }] = await db`select count(*)::int as multi from orders o where o.status not in ('completed','cancelled') and (select count(*) from order_assignments a where a.order_id = o.id) > 1`;
    assert.ok(dist.includes("Beberapa PIC"), "kategori multi-PIC tampil");
    assert.ok(multi >= 0);
  });

  await test("Pengajuan baru tetap diterima dan dinotifikasi walaupun PIC sudah banyak pekerjaan aktif", async () => {
    const gilarId = M["Gilar Dwi Rahayu"].id;
    const [{ before }] = await db`select count(*)::int as before from order_assignments a join orders o on o.id = a.order_id where a.member_id = ${gilarId} and o.status not in ('completed','cancelled')`;
    tg.mode = "ok";
    const calls = tg.calls.length;
    const r = await submit(orderForm(brand1, { designTypeId: TYPES["Poster"], picIds: [gilarId], title: "Judul Uji Beban Tinggi" }).fd);
    assert.equal(r.status, 201, await r.clone().text());
    const { orderNumber } = await r.json();
    assert.ok((await db`select count(*)::int as c from order_assignments a join orders o on o.id = a.order_id where a.member_id = ${gilarId} and o.status not in ('completed','cancelled')`)[0].c === before + 1, "pekerjaan baru menambah beban PIC");
    await new Promise((res) => setTimeout(res, 1500));
    assert.ok(tg.calls.length > calls && tg.calls.some((c) => c.body.text.includes(orderNumber)), "notifikasi Telegram terkirim");
  });

  // ---- Insiden produksi DTIC-2026-00007: tambah Gilar ke pekerjaan milik Fathin.
  const fathinId = M["Fathin Maqbulloh Sawiji"].id;
  const gilarId2 = M["Gilar Dwi Rahayu"].id;
  const managerName = (await db`select full_name from app_users where email = 'manager@dtic.example'`)[0].full_name;
  const freshPoster = async (title) => {
    const r = await submit(orderForm(brand1, { designTypeId: TYPES["Poster"], picIds: [fathinId], title }).fd);
    assert.equal(r.status, 201, await r.clone().text());
    const { orderNumber } = await r.json();
    return (await db`select id, order_number, status, deadline_at, title, brief from orders where order_number = ${orderNumber}`)[0];
  };
  const picsOf = async (orderId) => (await db`select m.full_name from order_assignments a join dtic_members m on m.id = a.member_id where a.order_id = ${orderId} order by m.full_name`).map((r) => r.full_name);
  const lastAudit = async (orderId) => (await db`select detail from auth_audit_log where action = 'order_pic_changed' and detail->>'orderId' = ${orderId} order by id desc limit 1`)[0]?.detail;

  await test("Kelola PIC (kondisi produksi): constraint lama menolak antrean → PIC tetap tersimpan, kegagalan notifikasi dilaporkan & teraudit", async () => {
    const o = await freshPoster("Insiden constraint lama");
    // Tiru produksi: constraint kind_v2 lama masih ada (NOT VALID agar baris lama tidak diperiksa).
    await pg.query("alter table notification_outbox add constraint notification_outbox_kind_v2_check check (kind in ('order_created','status_changed')) not valid");
    try {
      const r = await internal(`/api/internal/orders/${o.id}/assignees`, "PUT", { memberIds: [fathinId, gilarId2], reason: "Tambah Gilar untuk kolaborasi", expectedMemberIds: [fathinId] }, {}, MGR);
      assert.equal(r.status, 200, await r.clone().text());
      const body = await r.json();
      assert.equal(body.notification, "failed", "status notifikasi dipisah dari penyimpanan");
      assert.deepEqual(await picsOf(o.id), ["Fathin Maqbulloh Sawiji", "Gilar Dwi Rahayu"], "Fathin tetap, Gilar ditambahkan");
      const audit = await lastAudit(o.id);
      assert.equal(audit.operation, "add");
      assert.equal(audit.notification, "enqueue_failed", "kegagalan antrean tercatat di audit");
      assert.equal(audit.actorName, managerName, "nama Manager dari session");
    } finally {
      await pg.query("alter table notification_outbox drop constraint if exists notification_outbox_kind_v2_check");
    }
  });

  await test("Kelola PIC: tambah Gilar tanpa menghapus Fathin → satu notifikasi 'PERUBAHAN DISTRIBUSI PEKERJAAN' dengan nama Manager; data pekerjaan utuh", async () => {
    const o = await freshPoster("Tambah PIC kolaborasi");
    const ordersBefore = (await db`select count(*)::int as c from orders`)[0].c;
    tg.mode = "ok";
    const r = await internal(`/api/internal/orders/${o.id}/assignees`, "PUT", { memberIds: [fathinId, gilarId2], reason: "Kolaborasi desain", expectedMemberIds: [fathinId] }, {}, MGR);
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal((await r.json()).notification, "queued");
    assert.deepEqual(await picsOf(o.id), ["Fathin Maqbulloh Sawiji", "Gilar Dwi Rahayu"]);
    assert.equal((await db`select count(*)::int as c from orders`)[0].c, ordersBefore, "tidak ada pekerjaan baru");
    const [after] = await db`select status, deadline_at, title, brief from orders where id = ${o.id}`;
    assert.deepEqual([after.status, after.deadline_at.toISOString(), after.title, after.brief], [o.status, o.deadline_at.toISOString(), o.title, o.brief], "status, tenggat, judul, deskripsi utuh");
    const audit = await lastAudit(o.id);
    assert.equal(audit.actorName, managerName);
    assert.deepEqual([audit.before, audit.after], [["Fathin Maqbulloh Sawiji"], ["Fathin Maqbulloh Sawiji", "Gilar Dwi Rahayu"]]);
    const deadline = Date.now() + 8000;
    let msgs = [];
    while (Date.now() < deadline) {
      msgs = tg.calls.filter((c) => c.body.text.includes("PERUBAHAN DISTRIBUSI PEKERJAAN") && c.body.text.includes(`Nomor Pekerjaan: ${o.order_number}`));
      if (msgs.length) break;
      await internal("/api/internal/telegram/worker/tick", "POST");
      await new Promise((res) => setTimeout(res, 200));
    }
    assert.equal(msgs.length, 1, "tepat satu notifikasi perubahan");
    const text = msgs[0].body.text;
    for (const part of ["Operasi: Penambahan PIC", "PIC lama tetap ditugaskan.", `Diubah oleh: ${managerName}`, "Alasan: Kolaborasi desain", "• Gilar Dwi Rahayu"]) assert.ok(text.includes(part), part);
    assert.equal(tg.calls.filter((c) => c.body.text.includes(o.order_number) && c.body.text.includes("REQUEST PEKERJAAN BARU")).length, 1, "notifikasi pekerjaan baru tidak dikirim ulang");
  });

  await test("Kelola PIC: pindah Fathin → Gilar tercatat 'move'; Telegram gagal tidak membatalkan; retry tidak menggandakan notifikasi", async () => {
    const o = await freshPoster("Pindah pekerjaan");
    tg.mode = "500";
    const r = await internal(`/api/internal/orders/${o.id}/assignees`, "PUT", { memberIds: [gilarId2], reason: "Fathin sedang penuh", expectedMemberIds: [fathinId] }, {}, MGR);
    assert.equal(r.status, 200, await r.clone().text());
    assert.deepEqual(await picsOf(o.id), ["Gilar Dwi Rahayu"], "perubahan tetap tersimpan walau Telegram gagal");
    assert.equal((await lastAudit(o.id)).operation, "move");
    await new Promise((res) => setTimeout(res, 800));
    const [row] = await db`select n.status from notification_outbox n where n.order_id = ${o.id} and n.kind = 'pic_changed'`;
    assert.ok(["retrying", "failed", "pending"].includes(row.status), `status antrean ${row.status}`);
    tg.mode = "ok";
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const [st] = await db`select status from notification_outbox where order_id = ${o.id} and kind = 'pic_changed'`;
      if (st.status === "sent") break;
      await internal("/api/internal/telegram/worker/tick", "POST");
      await new Promise((res) => setTimeout(res, 200));
    }
    await internal("/api/internal/telegram/worker/tick", "POST");
    const sent = tg.calls.filter((c) => c.mode === "ok" && c.body.text.includes("Operasi: Pemindahan Pekerjaan") && c.body.text.includes(`Nomor Pekerjaan: ${o.order_number}`));
    assert.equal(sent.length, 1, "tepat satu notifikasi berhasil setelah retry (tanpa duplikasi)");
    assert.equal((await db`select status from notification_outbox where order_id = ${o.id} and kind = 'pic_changed'`)[0].status, "sent");
    assert.equal((await db`select count(*)::int as c from notification_outbox where order_id = ${o.id} and kind = 'pic_changed'`)[0].c, 1, "satu antrean untuk satu perubahan");
  });

  await test("Kelola PIC: alasan kurang dari 5 karakter & Staff ditolak lewat API; tidak ada perubahan", async () => {
    const o = await freshPoster("Validasi alasan");
    let r = await internal(`/api/internal/orders/${o.id}/assignees`, "PUT", { memberIds: [fathinId, gilarId2], reason: "abc" }, {}, MGR);
    assert.equal(r.status, 422);
    const staffSession = await login("staff@dtic.example", "StaffUji2026"); // sesi baru: sesi uji sebelumnya mungkin sudah dicabut
    r = await internal(`/api/internal/orders/${o.id}/assignees`, "PUT", { memberIds: [fathinId, gilarId2], reason: "Staff mencoba" }, {}, staffSession);
    assert.equal(r.status, 403);
    assert.deepEqual(await picsOf(o.id), ["Fathin Maqbulloh Sawiji"]);
    assert.equal(await lastAudit(o.id), undefined, "tidak ada audit untuk permintaan yang ditolak");
  });

  // ---- Kalender Pekerjaan: tampilan, filter, dan konsistensi dengan database.
  const calCount = (html) => Number(html.match(/data-testid="calendar-count"[\s\S]*?font-semibold text-ink">(\d+)</)?.[1] ?? -1);
  const todayKeyE2E = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  await test("Kalender Pekerjaan: empat tampilan (bulan, minggu, hari, daftar) tampil dari database", async () => {
    for (const v of ["month", "week", "day", "list"]) {
      const r = await page(`/dtic/calendar?view=${v}&date=${todayKeyE2E}`, true);
      assert.equal(r.status, 200, v);
      assert.ok(r.html.includes("pekerjaan pada periode ini"), `${v}: hitungan periode`);
    }
    const week = (await page(`/dtic/calendar?view=week&date=${todayKeyE2E}`, true)).html;
    for (const d of ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"]) assert.ok(week.includes(d + " "), d);
    assert.ok(!/Buat order|Buat pekerjaan/i.test(week), "tanpa tombol buat pekerjaan");
    assert.ok((await page(`/dtic/calendar?view=list&date=${todayKeyE2E}`, true)).html.includes("<caption"), "tabel daftar");
  });

  await test("Kalender: filter tim, terlambat, dan pencarian sama dengan hitungan database", async () => {
    const [team] = await db`select id from dtic_teams where slug = 'graphic-design'`;
    const month = todayKeyE2E.slice(0, 7);
    const from = `${month}-01`;
    const nextMonthStart = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1) - 7 * 3600_000); // awal bulan WIB
    const fromAt = new Date(`${from}T00:00:00+07:00`);
    const base = (await page(`/dtic/calendar?view=list&date=${from}`, true)).html;
    const [{ total }] = await db`select count(*)::int as total from orders o where o.deadline_at >= ${fromAt} and o.deadline_at < ${nextMonthStart}`;
    assert.equal(calCount(base), total, "total periode = database");
    const [{ teamTotal }] = await db`select count(*)::int as "teamTotal" from orders o
      where o.deadline_at >= ${fromAt} and o.deadline_at < ${nextMonthStart}
        and coalesce(o.team_id, (select dot.team_id from design_order_types dot where dot.id = o.design_order_type_id)) = ${team.id}`;
    assert.equal(calCount((await page(`/dtic/calendar?view=list&date=${from}&team=${team.id}`, true)).html), teamTotal, "filter tim");
    const [{ late }] = await db`select count(*)::int as late from orders o
      where o.deadline_at >= ${fromAt} and o.deadline_at < ${nextMonthStart} and o.deadline_at < now() and o.status not in ('completed','cancelled')`;
    assert.equal(calCount((await page(`/dtic/calendar?view=list&date=${from}&overdue=1`, true)).html), late, "terlambat saja");
    const [order] = await db`select order_number from orders o where o.deadline_at >= ${fromAt} and o.deadline_at < ${nextMonthStart} limit 1`;
    if (order) assert.equal(calCount((await page(`/dtic/calendar?view=list&date=${from}&q=${order.order_number}`, true)).html), 1, "pencarian nomor");
  });

  await test("Kalender: pekerjaan multi-PIC hanya tampil sekali per tampilan (tidak diduplikasi)", async () => {
    const [multi] = await db`select o.order_number, o.deadline_at from orders o where (select count(*) from order_assignments a where a.order_id = o.id) > 1 order by o.deadline_at desc limit 1`;
    assert.ok(multi, "ada pekerjaan multi-PIC");
    const day = new Date(multi.deadline_at.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
    const list = (await page(`/dtic/calendar?view=list&date=${day}`, true)).html;
    // Hitung di sel tabel (HTML juga memuat data RSC yang menyalin nomor yang sama).
    assert.equal(list.split(`<td class="whitespace-nowrap px-4 py-3 font-mono text-xs text-ink-3">${multi.order_number}</td>`).length - 1, 1, "satu baris daftar");
    const week = (await page(`/dtic/calendar?view=week&date=${day}`, true)).html;
    assert.equal(week.split(`>${multi.order_number}<`).length - 1, 1, "satu kartu minggu");
  });

  await test("Kalender: Staff hanya melihat pekerjaan yang ditugaskan kepadanya", async () => {
    const [staffRow] = await db`select m.id, m.full_name from app_users u join dtic_members m on m.id = u.member_id where u.email = 'staff@dtic.example'`;
    const month = todayKeyE2E.slice(0, 7);
    const from = `${month}-01`;
    const nextMonthStart = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1) - 7 * 3600_000);
    const [{ mine }] = await db`select count(distinct o.id)::int as mine from orders o join order_assignments a on a.order_id = o.id
      where a.member_id = ${staffRow.id} and o.deadline_at >= ${new Date(`${from}T00:00:00+07:00`)} and o.deadline_at < ${nextMonthStart}`;
    const staffCookie = await login("staff@dtic.example", "StaffUji2026");
    const r = await pageRaw(`/dtic/calendar?view=list&date=${from}`, staffCookie);
    assert.equal(r.status, 200);
    assert.equal(calCount(await r.text()), mine, "staff hanya melihat pekerjaan miliknya");
  });

  await test("Koneksi database: 30 request paralel ke halaman multi-query semuanya 200 (tanpa EMAXCONN / kehabisan koneksi)", async () => {
    const urls = ["/dtic/distribusi", "/dtic/workload", "/dtic/orders", "/dtic/calendar?view=list", "/dtic/dashboard", "/dtic/settings/users"];
    const jobs = Array.from({ length: 30 }, (_, i) => page(urls[i % urls.length], true));
    const results = await Promise.all(jobs);
    const bad = results.map((r, i) => [urls[i % urls.length], r.status]).filter(([, st]) => st !== 200);
    assert.deepEqual(bad, [], "semua respons 200");
    assert.equal(appLog.includes("EMAXCONN") || appLog.includes("max clients"), false, "tidak ada error batas klien di log");
  });

  // ---- Pengajuan: penyimpanan dan notifikasi dipisah; idempotensi; rekonsiliasi status.
  const countOrders = async () => (await db`select count(*)::int as c from orders`)[0].c;
  await test("pengajuan: Telegram berhasil → 201 dengan notification.sent; isi pesan memuat tautan berlabel dan langkah tindakan", async () => {
    tg.mode = "ok";
    const before = await countOrders();
    const fd = orderForm(brand1, { designTypeId: TYPES["Poster"], title: "Judul Uji Notifikasi Berhasil" }).fd;
    const r = await submit(fd);
    assert.equal(r.status, 201, await r.clone().text());
    const body = await r.json();
    assert.equal(body.notification.state, "sent");
    assert.equal(body.title, "Judul Uji Notifikasi Berhasil");
    assert.equal(await countOrders(), before + 1);
    const msg = tg.calls.find((c) => c.body.text.includes(body.orderNumber));
    assert.ok(msg, "pesan Telegram terkirim");
    // URL lokal (http, loopback) tidak pernah dijadikan tautan produksi: pesan memakai instruksi tanpa tautan.
    assert.ok(!msg.body.text.includes("<a href="), "tanpa tautan dari URL lokal");
    assert.ok(msg.body.text.includes("Buka sistem DTIC Connect lalu cari nomor order"), "instruksi pengganti tautan");
    for (const step of ["1. ", "2. Periksa brief, tenggat, dan lampiran.", "3. Mulai pengerjaan"]) assert.ok(msg.body.text.includes(step), step);
    assert.ok(!/localhost|127\.0\.0\.1/.test(msg.body.text), "tanpa URL lokal");
  });

  await test("pengajuan: Telegram gagal → pekerjaan tetap tersimpan (201), notification bukan 'sent', dan tidak membuat pekerjaan ganda", async () => {
    tg.mode = "500";
    const before = await countOrders();
    const r = await submit(orderForm(brand1, { title: "Judul Uji Telegram Gagal" }).fd);
    assert.equal(r.status, 201, await r.clone().text());
    const body = await r.json();
    assert.notEqual(body.notification.state, "sent");
    assert.equal(await countOrders(), before + 1, "tepat satu pekerjaan");
    tg.mode = "ok";
  });

  await test("pengajuan: kunci yang sama dikirim ulang → 200, nomor sama, tanpa pekerjaan baru", async () => {
    tg.mode = "ok";
    const key = randomUUID();
    const first = await submit(orderForm(brand1, { submissionKey: key, title: "Judul Uji Idempoten" }).fd);
    assert.equal(first.status, 201, await first.clone().text());
    const a = await first.json();
    const before = await countOrders();
    const again = await submit(orderForm(brand1, { submissionKey: key, title: "Judul Uji Idempoten" }).fd);
    assert.equal(again.status, 200);
    const b = await again.json();
    assert.equal(b.orderNumber, a.orderNumber);
    assert.equal(b.duplicate, true);
    assert.equal(await countOrders(), before, "tidak ada pekerjaan baru");
    assert.equal(tg.calls.filter((c) => c.body.text.includes(a.orderNumber)).length, 1, "tidak ada notifikasi ganda");
  });

  await test("pengajuan: dua permintaan identik bersamaan → tepat satu pekerjaan", async () => {
    const key = randomUUID();
    const before = await countOrders();
    const [x, y] = await Promise.all([
      submit(orderForm(brand1, { submissionKey: key, title: "Judul Uji Paralel" }).fd),
      submit(orderForm(brand1, { submissionKey: key, title: "Judul Uji Paralel" }).fd),
    ]);
    const statuses = [x.status, y.status].sort();
    assert.ok(statuses.every((st) => st === 200 || st === 201), `status ${statuses}`);
    assert.equal(await countOrders(), before + 1, "tepat satu pekerjaan dari dua permintaan");
  });

  await test("pengajuan: pemeriksaan status (rekonsiliasi) menemukan pengajuan tersimpan; kunci acak → 404; kunci rusak → 400", async () => {
    const key = randomUUID();
    const r = await submit(orderForm(brand1, { submissionKey: key, title: "Judul Uji Rekonsiliasi" }).fd);
    assert.ok(r.status === 201 || r.status === 200);
    const { orderNumber } = await r.json();
    const found = await fetch(`${BASE}/api/public/orders/status?key=${key}`);
    assert.equal(found.status, 200);
    const fb = await found.json();
    assert.equal(fb.orderNumber, orderNumber);
    assert.equal(fb.title, "Judul Uji Rekonsiliasi");
    assert.equal(fb.id, undefined, "id internal tidak dikembalikan");
    assert.equal((await fetch(`${BASE}/api/public/orders/status?key=${randomUUID()}`)).status, 404);
    assert.equal((await fetch(`${BASE}/api/public/orders/status?key=bukan-uuid`)).status, 400);
  });

  // ---- Tenggat: jam dari pemohon (WIB) dan perubahan oleh Manager dengan alasan & audit.
  await test("tenggat pemohon: tanggal + jam WIB disimpan tepat; jam kosong = 23.59 WIB", async () => {
    const withTime = await submit(orderForm(brand1, { deadline: wibDate(4), deadlineTime: "09:30", title: "Judul Uji Jam Tenggat" }).fd);
    assert.equal(withTime.status, 201, await withTime.clone().text());
    const { orderNumber } = await withTime.json();
    assert.equal((await db`select deadline_at from orders where order_number = ${orderNumber}`)[0].deadline_at.toISOString(), `${wibDate(4)}T02:30:00.000Z`, "09:30 WIB");
    const noTime = await submit(orderForm(brand1, { deadline: wibDate(4), title: "Judul Uji Tanpa Jam" }).fd);
    assert.equal(noTime.status, 201);
    const { orderNumber: n2 } = await noTime.json();
    assert.equal((await db`select deadline_at from orders where order_number = ${n2}`)[0].deadline_at.toISOString(), `${wibDate(4)}T16:59:00.000Z`, "akhir hari 23.59 WIB");
  });

  await test("Ubah tenggat: Manager → tenggat berubah, status tetap, audit mencatat lama/baru/alasan/pelaku", async () => {
    const created = await submit(orderForm(brand1, { title: "Judul Uji Ubah Tenggat" }).fd);
    const { orderNumber } = await created.json();
    const [before] = await db`select id, status, deadline_at from orders where order_number = ${orderNumber}`;
    const r = await internal(`/api/internal/orders/${before.id}/deadline`, "PUT", { deadlineDate: wibDate(10), deadlineTime: "15:00", reason: "Klien minta diundur" }, {}, MGR);
    assert.equal(r.status, 200, await r.clone().text());
    const [after] = await db`select status, deadline_at from orders where id = ${before.id}`;
    assert.equal(after.deadline_at.toISOString(), `${wibDate(10)}T08:00:00.000Z`, "15:00 WIB");
    assert.equal(after.status, before.status, "status tidak berubah");
    const [audit] = await db`select detail from auth_audit_log where action = 'order_deadline_changed' and detail->>'orderId' = ${before.id} order by id desc limit 1`;
    assert.equal(audit.detail.reason, "Klien minta diundur");
    assert.equal(audit.detail.previousDeadline, before.deadline_at.toISOString());
    assert.equal(audit.detail.newDeadline, after.deadline_at.toISOString());
    assert.equal(audit.detail.actorName, (await db`select full_name from app_users where email = 'manager@dtic.example'`)[0].full_name);
    const detail = await (await pageRaw(`/dtic/orders/${before.id}`, MGR)).text();
    assert.ok(detail.includes("Ubah tenggat"), "Manager melihat tombol ubah tenggat");
  });

  await test("Ubah tenggat: staff ditolak; alasan pendek ditolak; pekerjaan selesai ditolak; tanpa perubahan tidak ada audit", async () => {
    const created = await submit(orderForm(brand1, { title: "Judul Uji Tolak Tenggat" }).fd);
    const { orderNumber } = await created.json();
    const [o] = await db`select id, deadline_at from orders where order_number = ${orderNumber}`;
    const staffCookie = await login("staff@dtic.example", "StaffUji2026");
    assert.equal((await internal(`/api/internal/orders/${o.id}/deadline`, "PUT", { deadlineDate: wibDate(12), reason: "Staff mencoba ubah" }, {}, staffCookie)).status, 403);
    assert.equal((await internal(`/api/internal/orders/${o.id}/deadline`, "PUT", { deadlineDate: wibDate(12), reason: "abc" }, {}, MGR)).status, 422);
    const same = await internal(`/api/internal/orders/${o.id}/deadline`, "PUT", { deadlineDate: o.deadline_at.toISOString().slice(0, 10), deadlineTime: "23:59", reason: "Tanpa perubahan sama sekali" }, {}, MGR);
    assert.equal((await same.json()).changed, false);
    await db`update orders set status = 'completed', completed_at = now() where id = ${o.id}`;
    assert.equal((await internal(`/api/internal/orders/${o.id}/deadline`, "PUT", { deadlineDate: wibDate(15), reason: "Pekerjaan sudah selesai" }, {}, MGR)).status, 409);
    const detail = await (await pageRaw(`/dtic/orders/${o.id}`, MGR)).text();
    assert.ok(!detail.includes("Ubah tenggat"), "pekerjaan selesai tidak menampilkan tombol");
  });

  await test("Detail Pekerjaan (browser): Tugas Saya untuk PIC, brief, dokumen, riwayat; screenshot desktop & mobile", async () => {
    const chromePath = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({ executablePath: chromePath, headless: true });
    try {
      // Gambar lampiran nyata (PNG dari Chrome), bukan data contoh hardcoded di UI.
      const art = await browser.newPage({ viewport: { width: 480, height: 320 } });
      await art.setContent(`<body style="margin:0;background:linear-gradient(135deg,#10b981,#3b82f6);font:bold 40px sans-serif;color:#fff;display:grid;place-items:center;height:100vh">Referensi</body>`);
      const png = await art.screenshot();
      await art.close();
      const [staffRow] = await db`select m.id from app_users u join dtic_members m on m.id = u.member_id where u.email = 'staff@dtic.example'`;
      const created = await submit(orderForm(brand1, { title: "Judul Uji Detail Pekerjaan PIC", driveUrl: "https://drive.google.com/drive/folders/uji-detail" }, [
        { name: "referensi visual.png", data: png, type: "image/png" },
        { name: "brief tertulis.pdf", data: PDF, type: "application/pdf" },
      ]).fd);
      assert.equal(created.status, 201, await created.clone().text());
      const { orderNumber } = await created.json();
      const [o] = await db`select id from orders where order_number = ${orderNumber}`;
      await db`insert into order_assignments (order_id, member_id) values (${o.id}, ${staffRow.id}) on conflict do nothing`;
      const dl = await internal(`/api/internal/orders/${o.id}/deadline`, "PUT", { deadlineDate: wibDate(6), deadlineTime: "15:00", reason: "Penyesuaian jadwal acara pemohon" }, {}, MGR);
      assert.equal(dl.status, 200, await dl.clone().text());

      const dir = process.env.E2E_SHOT_DIR ?? path.join(os.tmpdir(), "dtic-form-shots");
      await mkdir(dir, { recursive: true });
      const view = async (cookie, file) => {
        const c = await browser.newContext({ viewport: { width: 1366, height: 900 } });
        const [name, value] = cookie.split("=");
        await c.addCookies([{ name, value, url: BASE }]);
        const p = await c.newPage();
        await p.goto(`${BASE}/dtic/orders/${o.id}`);
        await p.getByRole("heading", { name: "Deskripsi dari Pemohon" }).waitFor();
        await p.waitForTimeout(600);
        await p.screenshot({ path: path.join(dir, `${file}-desktop.png`), fullPage: true });
        await p.setViewportSize({ width: 390, height: 844 });
        await p.waitForTimeout(400);
        const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        await p.screenshot({ path: path.join(dir, `${file}-mobile.png`), fullPage: true });
        return { c, p, overflow };
      };

      const staff = await view(await login("staff@dtic.example", "StaffUji2026"), "6-detail-pic");
      assert.equal(staff.overflow, 0, "tanpa overflow horizontal di mobile (PIC)");
      const summary = await staff.p.getByTestId("work-summary").innerText();
      assert.match(summary, /Anda/, "PIC melihat dirinya di daftar PIC");
      assert.match(summary, /tidak mencatat pembagian tugas/, "multi-PIC tanpa pembagian tugas palsu");
      const brief = await staff.p.getByTestId("brief").innerText();
      assert.match(brief, /Diskon 20% untuk seluruh produk/, "deskripsi pemohon tampil utuh");
      const body = await staff.p.getByTestId("work-main").innerText();
      assert.equal(body.split("Diskon 20% untuk seluruh produk").length - 1, 1, "deskripsi tidak tampil berulang");
      for (const gone of ["Hasil yang diharapkan", "Catatan pengerjaan dari pemohon", "Tujuan pekerjaan", "Belum diisi pemohon"]) {
        assert.ok(!body.includes(gone), `bagian '${gone}' sudah tidak muncul`);
      }
      const firstSection = await staff.p.getByTestId("work-main").locator("section").first().getAttribute("data-testid");
      assert.equal(firstSection, "brief", "Deskripsi dari Pemohon adalah bagian pertama konten");
      const specs = await staff.p.getByTestId("specs").innerText();
      assert.match(specs, /Jenis pekerjaan[\s\S]*Poster/);
      assert.match(specs, /A4/);
      await staff.p.getByRole("button", { name: "Perbesar referensi visual.png" }).click();
      await staff.p.getByRole("dialog", { name: "referensi visual.png" }).getByRole("img", { name: "referensi visual.png" }).waitFor();
      await staff.p.keyboard.press("Escape");
      assert.ok(await staff.p.getByRole("img", { name: "Pratinjau referensi visual.png" }).isVisible(), "thumbnail gambar tampil");
      const thumbOk = await staff.p.getByRole("img", { name: "Pratinjau referensi visual.png" }).evaluate((img) => img.complete && img.naturalWidth > 0);
      assert.ok(thumbOk, "thumbnail dimuat lewat endpoint terautentikasi");
      assert.ok(await staff.p.getByText("brief tertulis.pdf").isVisible(), "PDF terdaftar");
      assert.ok(await staff.p.getByText("Hubungi via WhatsApp").isVisible());
      assert.doesNotMatch(await staff.p.getByTestId("activity").innerText(), /Penyesuaian jadwal acara pemohon/, "alasan audit tidak tampil untuk staff");
      await staff.c.close();

      const admin = await view(ADMIN, "7-detail-admin");
      assert.equal(admin.overflow, 0, "tanpa overflow horizontal di mobile (admin)");
      assert.doesNotMatch(await admin.p.getByTestId("work-summary").innerText(), /\bAnda\b/, "Super Admin bukan PIC");
      const act = await admin.p.getByTestId("activity").innerText();
      assert.match(act, /Penyesuaian jadwal acara pemohon/, "riwayat deadline beserta alasan");
      await admin.c.close();
    } finally {
      await browser.close();
    }
  });

  console.log("\nPenyerahan hasil, QC, dan penyelesaian");
  const qcOrder = async (title) => {
    const r = await submit(orderForm(brand1, { title }).fd);
    assert.equal(r.status, 201, await r.clone().text());
    const { orderNumber } = await r.json();
    const [o] = await db`select id from orders where order_number = ${orderNumber}`;
    const [st] = await db`select m.id from app_users u join dtic_members m on m.id = u.member_id where u.email = 'staff@dtic.example'`;
    await db`insert into order_assignments (order_id, member_id) values (${o.id}, ${st.id}) on conflict do nothing`;
    return { id: o.id, orderNumber };
  };
  // Satu sesi PIC dipakai ulang (login dibatasi laju per akun).
  let qcStaffCookie = null;
  const qcStaff = async () => (qcStaffCookie ??= await login("staff@dtic.example", "StaffUji2026"));
  const qcRow = async (id) => (await db`select status, qc_status from orders where id = ${id}`)[0];
  const events = async (id, kind) =>
    kind
      ? await db`select * from order_workflow_events where order_id = ${id} and kind = ${kind} order by created_at, id`
      : await db`select * from order_workflow_events where order_id = ${id} order by created_at, id`;
  const setStatusAs = (id, status, cookie) => internal(`/api/internal/orders/${id}/status`, "POST", { status }, {}, cookie);

  await test("Ke Manager: tautan wajib; menunggu pemeriksaan; PIC tidak memeriksa sendiri; persetujuan bersamaan tercatat sekali", async () => {
    const { id } = await qcOrder("Judul Uji QC ke Manager");
    const STAFFC = await qcStaff();
    assert.equal((await setStatusAs(id, "in_progress", STAFFC)).status, 200);
    assert.equal((await setStatusAs(id, "pending_confirmation", STAFFC)).status, 409, "tanpa pintasan lewat endpoint status");
    assert.equal((await workflow(id, { action: "submit_qc", method: "in_app" }, STAFFC)).status, 422, "metode file: minimal satu file");
    assert.equal((await workflow(id, { action: "submit_qc", method: "external", note: "Sudah dikirim" }, STAFFC)).status, 422, "metode luar aplikasi: media wajib");
    assert.equal((await workflow(id, { action: "submit_qc", link: "ftp://x" }, STAFFC)).status, 422, "tautan http(s)");
    let r = await workflow(id, { action: "submit_qc", link: "https://drive.example/v1", note: "Mohon dicek" }, STAFFC);
    assert.equal(r.status, 200, await r.clone().text());
    assert.deepEqual(await qcRow(id), { status: "pending_confirmation", qc_status: "pending" });
    assert.equal((await workflow(id, { action: "approve_qc" }, STAFFC)).status, 403, "PIC tidak memeriksa hasilnya sendiri");
    assert.equal((await workflow(id, { action: "record_delivery", confirmSent: true }, STAFFC)).status, 409, "tidak kirim saat menunggu Manager");
    assert.equal((await workflow(id, { action: "complete", note: "Sudah disepakati" }, STAFFC)).status, 409, "tidak selesai saat menunggu Manager");
    const [a, b] = await Promise.all([workflow(id, { action: "approve_qc" }, MGR), workflow(id, { action: "approve_qc" }, ADMIN)]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409], "satu berhasil, satu ditolak");
    assert.equal((await events(id, "qc_approved")).length, 1);
    assert.deepEqual(await qcRow(id), { status: "in_progress", qc_status: "approved" });
    const [sub] = await events(id, "qc_submitted");
    assert.equal(sub.link, "https://drive.example/v1", "versi yang diperiksa tercatat");
    assert.ok(sub.actor_name && sub.created_at, "aktor & waktu");
    // Setelah disetujui, pengiriman tercatat "setelah QC"
    assert.equal((await workflow(id, { action: "record_delivery", confirmSent: true, link: "https://drive.example/v1" }, STAFFC)).status, 200);
    const [dl] = await events(id, "delivery_recorded");
    assert.equal(dl.detail.afterQc, true);
  });

  await test("Ke Manager: revisi wajib instruksi; PIC Perbaiki Hasil lalu ajukan ulang; tarik pengajuan; retry idempoten", async () => {
    const { id } = await qcOrder("Judul Uji Revisi");
    const STAFFC = await qcStaff();
    await setStatusAs(id, "in_progress", STAFFC);
    await workflow(id, { action: "submit_qc" }, STAFFC);
    assert.equal((await workflow(id, { action: "request_revision" }, MGR)).status, 422, "instruksi wajib");
    const key = randomUUID();
    assert.equal((await workflow(id, { action: "request_revision", note: "Logo terlalu kecil", requestKey: key }, MGR)).status, 200);
    const again = await workflow(id, { action: "request_revision", note: "Logo terlalu kecil", requestKey: key }, MGR);
    assert.equal((await again.json()).duplicate, true, "retry setelah timeout tidak menggandakan");
    assert.equal((await events(id, "qc_revision_requested")).length, 1);
    assert.deepEqual(await qcRow(id), { status: "internal_revision", qc_status: "revision" });
    assert.match(await (await pageRaw(`/dtic/orders/${id}`, STAFFC)).text(), /Logo terlalu kecil/, "PIC melihat instruksi revisi");
    assert.equal((await workflow(id, { action: "submit_qc" }, STAFFC)).status, 409, "harus Perbaiki Hasil dulu");
    assert.equal((await workflow(id, { action: "complete", note: "Sudah disepakati" }, STAFFC)).status, 409, "PIC tidak menutup saat revisi diminta");
    assert.equal((await setStatusAs(id, "in_progress", STAFFC)).status, 200, "Perbaiki Hasil");
    assert.equal((await workflow(id, { action: "submit_qc" }, STAFFC)).status, 200);
    // Manager tidak merespons: PIC menarik pengajuan, tanpa persetujuan otomatis
    assert.equal((await workflow(id, { action: "withdraw_qc" }, STAFFC)).status, 200);
    assert.deepEqual(await qcRow(id), { status: "in_progress", qc_status: "none" });
    assert.equal((await events(id, "qc_approved")).length, 0, "tidak ada persetujuan palsu");
    const dup = await db`select count(*)::int as c from (select 1 from notification_outbox where order_id = ${id} group by channel, kind, event_ref having count(*) > 1) x`;
    assert.equal(dup[0].c, 0, "tidak ada notifikasi ganda");
  });

  await test("Langsung ke pemohon: konfirmasi wajib; status QC tidak berubah; masukan pemohon & revisi; Telegram diberi tahu (event berbeda dari QC)", async () => {
    tg.mode = "ok";
    const { id } = await qcOrder("Judul Uji Langsung Pemohon");
    const STAFFC = await qcStaff();
    await setStatusAs(id, "in_progress", STAFFC);
    assert.equal((await workflow(id, { action: "record_delivery", confirmSent: false }, STAFFC)).status, 422, "tanpa konfirmasi tidak tercatat");
    assert.equal((await events(id, "delivery_recorded")).length, 0);
    const outboxBefore = (await db`select count(*)::int as c from notification_outbox where order_id = ${id}`)[0].c;
    let r = await workflow(id, { action: "record_delivery", confirmSent: true, stage: "draft", link: "https://drive.example/konsep", note: "Via WA" }, STAFFC);
    assert.equal(r.status, 200, await r.clone().text());
    assert.deepEqual(await qcRow(id), { status: "awaiting_requester", qc_status: "none" }, "QC tetap Belum Diajukan");
    const [dl] = await events(id, "delivery_recorded");
    assert.equal(dl.detail.afterQc, false);
    // Notifikasi Telegram DIANTREKAN untuk penyerahan ke pemohon (sebelumnya tidak pernah diantrekan).
    const outboxRows = await db`select kind, event_type from notification_outbox where order_id = ${id} order by created_at desc limit 1`;
    assert.equal(outboxRows.length, outboxBefore + 1, "satu notifikasi baru diantrekan untuk penyerahan");
    assert.equal(outboxRows[0].kind, "status_changed");
    assert.equal(outboxRows[0].event_type, "status_changed", "event berbeda dari 'waiting_confirmation' (ajukan QC)");
    const tgBefore = tg.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.ok(tg.calls.length > tgBefore, "pesan Telegram benar-benar terkirim untuk penyerahan ke pemohon");
    const sentText = tg.calls.at(-1).body.text;
    assert.match(sentText, /MENUNGGU MASUKAN PEMOHON/, "pesan memuat status apa adanya");
    assert.doesNotMatch(sentText, /disetujui|approved/i, "tidak pernah mengklaim QC disetujui hanya karena dikirim ke pemohon");
    assert.equal((await events(id, "qc_approved")).length, 0);
    const html = await (await pageRaw(`/dtic/orders/${id}`, STAFFC)).text();
    assert.match(html, /Sudah Dikirim ke Pemohon/);
    assert.match(html, /Dikirim langsung, tanpa QC Manager/);
    assert.match(html, /Belum Diajukan/);
    assert.equal((await workflow(id, { action: "record_feedback", needsRevision: true }, STAFFC)).status, 422);
    r = await workflow(id, { action: "record_feedback", needsRevision: true, note: "Ganti warna latar jadi biru" }, STAFFC);
    assert.equal(r.status, 200);
    assert.equal((await qcRow(id)).status, "in_progress", "revisi dimulai");
    const other = await (async () => {
      await internal("/api/internal/users", "POST", { fullName: "Staff Tanpa Tugas QC", email: "staff-qc-other@dtic.example", role: "staff", memberId: null, password: "StaffQcOther2026" });
      return login("staff-qc-other@dtic.example", "StaffQcOther2026");
    })();
    assert.equal((await workflow(id, { action: "record_delivery", confirmSent: true }, other)).status, 404, "staff lain tidak bisa memanipulasi");
    assert.equal((await workflow(id, { action: "complete", note: "Coba tutup" }, other)).status, 404);
  });

  await test("Selesaikan Pekerjaan: kesepakatan di luar aplikasi wajib keterangan; tanpa pengiriman/persetujuan palsu; klik ganda tidak menggandakan", async () => {
    const { id } = await qcOrder("Judul Uji Selesai di Luar Aplikasi");
    const STAFFC = await qcStaff();
    assert.equal((await workflow(id, { action: "complete", note: "Sudah selesai" }, STAFFC)).status, 409, "belum mulai dikerjakan");
    await setStatusAs(id, "in_progress", STAFFC);
    assert.equal((await workflow(id, { action: "complete" }, STAFFC)).status, 422, "keterangan wajib bila belum ada pengiriman");
    const key = randomUUID();
    const body = { action: "complete", note: "Penyelesaian sudah disepakati langsung dengan pemohon", requestKey: key };
    const [r1, r2] = await Promise.all([workflow(id, body, STAFFC), workflow(id, body, STAFFC)]);
    assert.deepEqual([r1.status, r2.status], [200, 200]);
    assert.deepEqual([(await r1.clone().json()).duplicate, (await r2.clone().json()).duplicate].sort(), [false, true], "klik ganda → satu tersimpan");
    assert.equal((await events(id, "completed")).length, 1);
    assert.equal((await db`select count(*)::int as c from order_status_history where order_id = ${id} and new_status = 'completed'`)[0].c, 1);
    assert.equal((await events(id, "delivery_recorded")).length, 0, "tidak membuat catatan pengiriman");
    assert.equal((await events(id, "qc_approved")).length, 0, "tidak membuat persetujuan Manager");
    const row = await qcRow(id);
    assert.equal(row.status, "completed");
    assert.equal(row.qc_status, "none", "status QC tetap apa adanya");
    const [ev] = await events(id, "completed");
    assert.equal(ev.detail.deliveryRecorded, false);
    assert.equal(ev.summary, "Penyelesaian sudah disepakati langsung dengan pemohon");
    assert.ok((await db`select completed_at from orders where id = ${id}`)[0].completed_at);
    assert.equal((await workflow(id, { action: "complete", note: "lagi" }, STAFFC)).status, 409, "selesai tidak bisa diulang");
    // Setelah pengiriman tercatat: keterangan opsional
    const o2 = await qcOrder("Judul Uji Selesai Setelah Kirim");
    await setStatusAs(o2.id, "in_progress", STAFFC);
    await workflow(o2.id, { action: "record_delivery", confirmSent: true, stage: "final" }, STAFFC);
    assert.equal((await workflow(o2.id, { action: "complete" }, STAFFC)).status, 200);
    assert.equal((await events(o2.id, "completed"))[0].detail.deliveryRecorded, true);
  });

  const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]);
  const uploadResult = (id, file, cookie, uploadKey = randomUUID()) => {
    const fd = new FormData();
    fd.set("uploadKey", uploadKey);
    fd.set("file", new Blob([file.data], { type: file.type ?? "application/octet-stream" }), file.name);
    return fetch(`${BASE}/api/internal/orders/${id}/results`, { method: "POST", body: fd, headers: { Cookie: cookie, Origin: BASE, "X-DTIC-Request": "1" } });
  };
  const resultRows = async (id) => await db`select id, file_name, kind, uploaded_by, mime_type from order_attachments where order_id = ${id} and kind = 'result' order by created_at`;

  await test("File hasil: unggah gambar, PDF, PSD; validasi tipe/isi/ukuran di server; retry tanpa file ganda; hak akses", async () => {
    const { id, orderNumber } = await qcOrder("Judul Uji Upload Hasil");
    const STAFFC = await qcStaff();
    await setStatusAs(id, "in_progress", STAFFC);
    let r = await uploadResult(id, { name: "poster final.png", data: PNG_BYTES, type: "image/png" }, STAFFC);
    assert.equal(r.status, 201, await r.clone().text());
    const png = (await r.json()).file;
    r = await uploadResult(id, { name: "proof.pdf", data: PDF, type: "application/pdf" }, STAFFC);
    assert.equal(r.status, 201);
    const pdf = (await r.json()).file;
    r = await uploadResult(id, { name: "master.psd", data: Buffer.concat([Buffer.from("8BPS"), Buffer.alloc(100)]) }, STAFFC);
    assert.equal(r.status, 201, "format desain PSD diterima");
    const psd = (await r.json()).file;
    // validasi server
    assert.equal((await uploadResult(id, { name: "virus.exe", data: Buffer.from("MZ") }, STAFFC)).status, 422, "tipe tidak diizinkan");
    assert.equal((await uploadResult(id, { name: "palsu.png", data: Buffer.from("bukan gambar") }, STAFFC)).status, 422, "isi tidak cocok format");
    const big = await uploadResult(id, { name: "besar.zip", data: Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(1.2 * 1024 * 1024)]) }, STAFFC);
    assert.ok([413, 422].includes(big.status), `file terlalu besar ditolak (HTTP ${big.status})`);
    // retry setelah timeout dengan kunci sama → file yang sama
    const key = randomUUID();
    const a = await uploadResult(id, { name: "ulang.png", data: PNG_BYTES }, STAFFC, key);
    const b = await uploadResult(id, { name: "ulang.png", data: PNG_BYTES }, STAFFC, key);
    assert.deepEqual([a.status, b.status], [201, 200]);
    assert.equal((await b.json()).duplicate, true);
    assert.equal((await resultRows(id)).filter((x) => x.file_name === "ulang.png").length, 1, "tanpa file ganda");
    const rows = await resultRows(id);
    assert.ok(rows.every((x) => x.uploaded_by), "pengunggah tercatat");
    // hak akses
    assert.equal((await uploadResult(id, { name: "m.png", data: PNG_BYTES }, MGR)).status, 403, "Manager tidak mengunggah atas nama PIC");
    const other = await login("staff-qc-other@dtic.example", "StaffQcOther2026");
    assert.equal((await uploadResult(id, { name: "o.png", data: PNG_BYTES }, other)).status, 404, "staff lain tidak dapat mengunggah");
    assert.equal((await fetch(`${BASE}/api/internal/attachments/${png.id}`, { headers: { Cookie: other } })).status, 404, "staff lain tidak dapat mengunduh");
    assert.equal((await fetch(`${BASE}/api/internal/attachments/${png.id}`)).status, 401, "tanpa sesi ditolak");
    const dl = await fetch(`${BASE}/api/internal/attachments/${pdf.id}?inline=1`, { headers: { Cookie: MGR } });
    assert.equal(dl.status, 200, "Manager dapat membuka file hasil");
    assert.match(dl.headers.get("content-disposition"), /^inline/);
    const psdDl = await fetch(`${BASE}/api/internal/attachments/${psd.id}?inline=1`, { headers: { Cookie: STAFFC } });
    assert.match(psdDl.headers.get("content-disposition"), /^attachment/, "PSD tidak dipratinjau, hanya diunduh");
    // file hasil terpisah dari dokumen referensi pemohon
    const html = await (await pageRaw(`/dtic/orders/${id}`, STAFFC)).text();
    assert.match(html, /Hasil pekerjaan/);
    assert.match(html, /poster final\.png/);
    assert.match(html, /Pemohon tidak melampirkan dokumen/, "bahan referensi tetap kosong");
    const tr = await (await search(orderNumber)).json();
    assert.ok(!JSON.stringify(tr).includes("poster final"), "file hasil tidak bocor ke pelacakan publik");
  });

  await test("File hasil + QC/pengiriman/penyelesaian: file terhubung ke pengajuan; draf dapat dihapus, yang diserahkan tidak; file order lain ditolak", async () => {
    const { id } = await qcOrder("Judul Uji Hasil ke QC");
    const STAFFC = await qcStaff();
    await setStatusAs(id, "in_progress", STAFFC);
    const f1 = (await (await uploadResult(id, { name: "v1.png", data: PNG_BYTES }, STAFFC)).json()).file;
    const draft = (await (await uploadResult(id, { name: "coba.png", data: PNG_BYTES }, STAFFC)).json()).file;
    const other = await qcOrder("Judul Uji Hasil Order Lain");
    await setStatusAs(other.id, "in_progress", STAFFC);
    const foreign = (await (await uploadResult(other.id, { name: "lain.png", data: PNG_BYTES }, STAFFC)).json()).file;
    assert.equal((await workflow(id, { action: "submit_qc", method: "in_app", resultFileIds: [foreign.id] }, STAFFC)).status, 422, "file order lain ditolak");
    assert.equal((await workflow(id, { action: "submit_qc", method: "in_app" }, STAFFC)).status, 422, "metode file tanpa file ditolak");
    assert.equal((await qcRow(id)).status, "in_progress", "status tidak berubah saat pengajuan gagal");
    let r = await workflow(id, { action: "submit_qc", method: "in_app", resultFileIds: [f1.id], note: "Tanpa Google Drive" }, STAFFC);
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal((await qcRow(id)).qc_status, "pending");
    const [sub] = await events(id, "qc_submitted");
    assert.deepEqual(sub.detail.resultFileIds, [f1.id]);
    assert.equal(sub.link, null, "Google Drive tidak diwajibkan");
    assert.equal((await internal(`/api/internal/orders/${id}/results/${f1.id}`, "DELETE", undefined, {}, STAFFC)).status, 409, "file yang diserahkan tidak dapat dihapus");
    assert.equal((await internal(`/api/internal/orders/${id}/results/${draft.id}`, "DELETE", undefined, {}, MGR)).status, 403, "hanya pengunggah");
    assert.equal((await internal(`/api/internal/orders/${id}/results/${draft.id}`, "DELETE", undefined, {}, STAFFC)).status, 200, "draf dapat dihapus");
    assert.equal((await resultRows(id)).length, 1);
    await workflow(id, { action: "approve_qc" }, MGR);
    const [ap] = await events(id, "qc_approved");
    assert.deepEqual(ap.detail.resultFileIds, [f1.id], "persetujuan berlaku untuk versi yang diajukan");
    r = await workflow(id, { action: "record_delivery", confirmSent: true, resultFileIds: [f1.id] }, STAFFC);
    assert.equal(r.status, 200);
    const html = await (await pageRaw(`/dtic/orders/${id}`, STAFFC)).text();
    assert.match(html, /Sudah diserahkan ke pemohon/, "status file mengikuti peristiwa aktual");
    // penyelesaian dengan file sebagai referensi tidak membuat pengiriman/persetujuan baru
    const before = (await events(id)).length;
    r = await workflow(id, { action: "complete", resultFileIds: [f1.id] }, STAFFC);
    assert.equal(r.status, 200);
    const after = await events(id);
    assert.equal(after.length, before + 1);
    assert.equal(after.at(-1).kind, "completed");
    assert.equal((await uploadResult(id, { name: "telat.png", data: PNG_BYTES }, STAFFC)).status, 409, "pekerjaan selesai tidak menerima unggahan");
  });

  await test("Ajukan QC di luar DTIC Nexus: WhatsApp/email tanpa upload; informasi minimum; Manager minta file/akses; pilih file lama tanpa upload ulang", async () => {
    const { id } = await qcOrder("Judul Uji Penyerahan Luar Aplikasi");
    const STAFFC = await qcStaff();
    await setStatusAs(id, "in_progress", STAFFC);
    const filesBefore = (await resultRows(id)).length;
    // informasi minimum per metode
    assert.equal((await workflow(id, { action: "submit_qc", method: "external", channel: "whatsapp" }, STAFFC)).status, 422, "keterangan wajib");
    assert.equal((await workflow(id, { action: "submit_qc", method: "external", channel: "whatsapp", note: "ok" }, STAFFC)).status, 422, "keterangan terlalu singkat");
    const future = new Date(Date.now() + 2 * 3600_000).toISOString();
    assert.equal((await workflow(id, { action: "submit_qc", method: "external", channel: "whatsapp", note: "Sudah dikirim", handedAt: future }, STAFFC)).status, 422, "waktu penyerahan tidak di masa depan");
    assert.equal((await qcRow(id)).status, "in_progress", "status tidak berubah saat gagal");
    // WhatsApp, tanpa upload, tanpa tautan
    const handedAt = new Date(Date.now() - 3600_000).toISOString();
    let r = await workflow(id, { action: "submit_qc", method: "external", channel: "whatsapp", recipient: "Manager Uji", handedAt, note: "File PSD dikirim ke WhatsApp Manager" }, STAFFC);
    assert.equal(r.status, 200, await r.clone().text());
    assert.deepEqual(await qcRow(id), { status: "pending_confirmation", qc_status: "pending" }, "QC menunggu, bukan disetujui");
    const [sub] = await events(id, "qc_submitted");
    assert.equal(sub.detail.method, "external");
    assert.equal(sub.detail.channel, "whatsapp");
    assert.equal(sub.detail.recipient, "Manager Uji");
    assert.equal(sub.detail.handedAt, handedAt, "waktu penyerahan sesuai isian");
    assert.notEqual(new Date(sub.created_at).toISOString(), handedAt, "waktu pencatatan terpisah");
    assert.equal((await resultRows(id)).length, filesBefore, "tanpa upload ulang");
    assert.equal((await events(id, "qc_approved")).length, 0);
    const html = await (await pageRaw(`/dtic/orders/${id}`, MGR)).text();
    assert.match(html, /Diserahkan di luar DTIC Nexus via/);
    assert.match(html, /sistem tidak memverifikasi penerimaan/);
    // Manager belum bisa memeriksa → minta file/akses (bukan revisi hasil)
    assert.equal((await workflow(id, { action: "request_access", note: "x" }, STAFFC)).status, 403, "PIC tidak bisa");
    assert.equal((await workflow(id, { action: "request_access" }, MGR)).status, 422, "catatan wajib");
    r = await workflow(id, { action: "request_access", note: "File belum saya terima, mohon unggah di DTIC Nexus" }, MGR);
    assert.equal(r.status, 200);
    assert.deepEqual(await qcRow(id), { status: "in_progress", qc_status: "none" }, "dikembalikan ke PIC tanpa keputusan hasil");
    assert.equal((await events(id, "qc_revision_requested")).length, 0, "bukan revisi");
    assert.match(await (await pageRaw(`/dtic/orders/${id}`, STAFFC)).text(), /File belum saya terima/, "PIC melihat permintaan Manager");
    // PIC mengunggah sekali, ajukan; lalu ajukan ulang memakai file lama tanpa upload ulang
    const f = (await (await uploadResult(id, { name: "final.png", data: PNG_BYTES }, STAFFC)).json()).file;
    assert.equal((await workflow(id, { action: "submit_qc", method: "in_app", resultFileIds: [f.id] }, STAFFC)).status, 200);
    assert.equal((await workflow(id, { action: "withdraw_qc" }, STAFFC)).status, 200);
    const rowsBefore = (await resultRows(id)).length;
    assert.equal((await workflow(id, { action: "submit_qc", method: "in_app", resultFileIds: [f.id], note: "Memakai file yang sudah ada" }, STAFFC)).status, 200);
    assert.equal((await resultRows(id)).length, rowsBefore, "file lama dipakai ulang tanpa duplikasi");
    // Manager memeriksa file yang sudah ada tanpa upload ulang lalu menyetujui
    assert.equal((await fetch(`${BASE}/api/internal/attachments/${f.id}?inline=1`, { headers: { Cookie: MGR } })).status, 200);
    assert.equal((await workflow(id, { action: "approve_qc" }, MGR)).status, 200);
    assert.equal((await qcRow(id)).qc_status, "approved");
    // email
    const o2 = await qcOrder("Judul Uji Penyerahan Email");
    await setStatusAs(o2.id, "in_progress", STAFFC);
    r = await workflow(o2.id, { action: "submit_qc", method: "external", channel: "email", note: "Dikirim ke email manager@dtic.example", link: "https://mail.example/thread/1" }, STAFFC);
    assert.equal(r.status, 200);
    const [s2] = await events(o2.id, "qc_submitted");
    assert.equal(s2.detail.channel, "email");
    assert.equal(s2.detail.handedAt, null, "waktu tidak diketahui tidak dikarang");
    assert.equal((await events(o2.id, "delivery_recorded")).length, 0, "penyerahan ke Manager bukan pengiriman ke pemohon");
  });

  await test("Data lama: pending_confirmation lama → QC menunggu tanpa mengubah status; migrasi idempoten", async () => {
    const { id } = await qcOrder("Judul Uji Data Lama QC");
    await db`update orders set status = 'pending_confirmation', qc_status = 'none' where id = ${id}`;
    const sqlText = await readFile(path.join("supabase/migrations", "20261017000000_qc_workflow.sql"), "utf8");
    await pg.exec(sqlText);
    await pg.exec(sqlText);
    assert.deepEqual(await qcRow(id), { status: "pending_confirmation", qc_status: "pending" });
    assert.equal((await workflow(id, { action: "approve_qc" }, MGR)).status, 200, "Manager dapat memutuskan data lama");
  });

  await test("Konsistensi: daftar/filter, dashboard, kalender, display, dan pelacakan publik memakai status baru", async () => {
    const { id, orderNumber } = await qcOrder("Judul Uji Status Baru");
    const STAFFC = await qcStaff();
    await setStatusAs(id, "in_progress", STAFFC);
    await workflow(id, { action: "record_delivery", confirmSent: true }, STAFFC);
    const list = await page(`/dtic/orders?status=awaiting_requester`);
    assert.ok(list.html.includes(orderNumber) && list.html.includes("Menunggu Masukan Pemohon"), "filter status baru");
    const dash = await page(`/dtic/dashboard`);
    for (const label of ["Menunggu QC Manager", "Perlu Revisi Internal", "Menunggu Masukan Pemohon"]) assert.ok(dash.html.includes(label), label);
    assert.equal((await page(`/dtic/calendar`)).status, 200);
    const disp = await fetch(`${BASE}/api/internal/display/orders`, { headers: { Cookie: ADMIN } });
    assert.ok((await disp.json()).inProgress.items.some((i) => i.orderNumber === orderNumber), "tampil di layar display");
    const v = await (await search(orderNumber)).json();
    assert.equal(v.status, "awaiting_requester");
    assert.ok(!JSON.stringify(v).includes("QC"), "istilah QC internal tidak bocor ke pemohon");
  });

  await test("Penyerahan (browser): pilih tujuan Manager/pemohon, WhatsApp tidak mencatat, selesaikan; tanpa error konsol; desktop & mobile", async () => {
    const chromePath = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({ executablePath: chromePath, headless: true });
    try {
      const { id } = await qcOrder("Judul Uji Browser Penyerahan");
      const pngPage = await browser.newPage({ viewport: { width: 320, height: 200 } });
      await pngPage.setContent(`<body style="margin:0;background:linear-gradient(135deg,#0f766e,#3b82f6)"></body>`);
      const REAL_PNG = await pngPage.screenshot();
      await pngPage.close();
      const dir = process.env.E2E_SHOT_DIR ?? path.join(os.tmpdir(), "dtic-form-shots");
      await mkdir(dir, { recursive: true });
      const consoleErrors = [];
      const open = async (cookie, size = { width: 1366, height: 900 }) => {
        const c = await browser.newContext({ viewport: size });
        const [name, value] = cookie.split("=");
        await c.addCookies([{ name, value, url: BASE }]);
        const p = await c.newPage();
        p.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
        p.on("pageerror", (e) => consoleErrors.push(e.message));
        await p.goto(`${BASE}/dtic/orders/${id}`);
        await p.getByTestId("next-step").waitFor();
        return { c, p };
      };
      const STAFFC = await qcStaff();
      const pic = await open(STAFFC);
      assert.match(await pic.p.getByTestId("next-step-text").innerText(), /Pelajari brief dan bahan referensi/);
      await pic.p.getByTestId("next-step").getByRole("button", { name: "Mulai kerjakan" }).click();
      await pic.p.getByTestId("next-step").getByRole("button", { name: "Ajukan QC" }).waitFor();
      assert.equal(await pic.p.getByTestId("next-step").getByRole("button", { name: "Selesaikan Pekerjaan" }).count(), 1);
      assert.equal(await pic.p.getByText(/Mode A|Mode B|Mode C/).count(), 0, "tanpa pilihan mode");
      await pic.p.waitForTimeout(400);
      await pic.p.screenshot({ path: path.join(dir, "8-detail-pic-desktop.png"), fullPage: true });
      // Ajukan QC → Ke Manager
      await pic.p.getByRole("button", { name: "Ajukan QC" }).click();
      const dlg = pic.p.getByRole("dialog", { name: "Pilih Tujuan Penyerahan Hasil" });
      await dlg.waitFor();
      // Modal lebar di desktop (±1000px), isi bergulir di dalam modal.
      const box = await dlg.boundingBox();
      assert.ok(box.width >= 900, `modal cukup lebar (${Math.round(box.width)}px)`);
      assert.equal(await dlg.getByRole("button", { name: "Pilih tujuan" }).isDisabled(), true, "belum memilih tujuan");
      await dlg.getByText("Ke Manager", { exact: true }).click();
      assert.equal(await dlg.getByTestId("attachments-summary").innerText(), "Tidak ada file yang dilampirkan.", "lampiran opsional, default tanpa file");
      assert.equal(await dlg.locator("input[type=file]").locator("..").isVisible(), false, "dropzone tidak dominan sebelum memilih unggah");
      await dlg.getByText("Unggah file baru", { exact: true }).click();
      assert.match(await dlg.getByTestId("qc-manager-recipient").innerText(), /Manager/);
      assert.equal(await dlg.getByRole("button", { name: "Ajukan QC", exact: true }).isDisabled(), true, "butuh file atau keterangan penyerahan");
      await dlg.locator("input[type=file]").setInputFiles([
        { name: "hasil-browser.png", mimeType: "image/png", buffer: REAL_PNG },
        { name: "hasil-browser.pdf", mimeType: "application/pdf", buffer: PDF },
      ]);
      await dlg.getByText("Terunggah (draf)").nth(1).waitFor();
      assert.equal(await dlg.getByRole("list", { name: "File hasil yang diunggah" }).getByRole("listitem").count(), 2, "beberapa file sekaligus");
      await pic.p.waitForTimeout(300);
      await pic.p.screenshot({ path: path.join(dir, "9-dialog-tujuan-manager.png") });
      await dlg.getByRole("button", { name: "Ajukan QC", exact: true }).click();
      await pic.p.getByTestId("qc-status").filter({ hasText: "Menunggu Pemeriksaan Manager" }).waitFor();
      assert.match(await pic.p.getByTestId("results").innerText(), /hasil-browser\.png[\s\S]*Diajukan untuk QC/, "Hasil pekerjaan menampilkan file & statusnya");
      assert.equal(await pic.p.getByRole("button", { name: "Tarik Pengajuan QC" }).count(), 1);
      assert.equal(await pic.p.getByRole("button", { name: "Ajukan QC" }).count(), 0, "Ajukan QC tidak tampil lagi setelah berhasil diajukan");
      assert.equal(await pic.p.getByRole("button", { name: "Catat Masukan Pemohon" }).count(), 0, "aksi penyerahan ke pemohon tidak tampil saat menunggu Manager");
      assert.equal(await pic.p.getByRole("button", { name: "Selesaikan Pekerjaan" }).count(), 0, "tidak bisa menyelesaikan saat menunggu Manager");
      await pic.p.reload();
      await pic.p.getByTestId("next-step").waitFor();
      assert.equal(await pic.p.getByRole("button", { name: "Ajukan QC" }).count(), 0, "tetap tidak tampil setelah reload (bukan sekadar state klien)");
      await pic.c.close();
      // Manager meminta revisi
      const mgr = await open(MGR);
      await mgr.p.getByRole("button", { name: "Minta Revisi" }).click();
      const rev = mgr.p.getByRole("dialog", { name: "Minta revisi" });
      await rev.getByLabel(/Instruksi revisi/).fill("Perbesar logo di pojok kanan atas");
      await rev.getByRole("button", { name: "Kirim Permintaan Revisi" }).click();
      await mgr.p.getByTestId("qc-revision-note").waitFor();
      await mgr.c.close();
      // PIC memperbaiki lalu kirim langsung ke pemohon
      const pic2 = await open(STAFFC);
      assert.match(await pic2.p.getByTestId("qc-revision-note").innerText(), /Perbesar logo/);
      await pic2.p.getByRole("button", { name: "Perbaiki hasil" }).click();
      await pic2.p.getByRole("button", { name: "Ajukan QC" }).waitFor();
      await pic2.p.getByRole("button", { name: "Ajukan QC" }).click();
      const dlg2 = pic2.p.getByRole("dialog", { name: "Pilih Tujuan Penyerahan Hasil" });
      await dlg2.getByText("Langsung ke Pemohon", { exact: true }).click();
      const wa = dlg2.getByRole("link", { name: /Buka WhatsApp/ });
      assert.match(await wa.getAttribute("href"), /^https:\/\/wa\.me\/628/);
      assert.equal((await events(id, "delivery_recorded")).length, 0, "membuka WhatsApp tidak mencatat");
      assert.equal(await dlg2.getByRole("button", { name: "Konfirmasi Penyerahan" }).isDisabled(), true, "wajib centang konfirmasi");
      assert.equal(await dlg2.getByLabel("Waktu penyerahan (WIB)").inputValue(), "", "waktu penyerahan tidak diisi otomatis");
      // tablet & mobile: modal muat di layar tanpa overflow horizontal
      for (const [w, h, f] of [[820, 1180, "10b-modal-tablet.png"], [390, 844, "10c-modal-mobile.png"]]) {
        await pic2.p.setViewportSize({ width: w, height: h });
        await pic2.p.waitForTimeout(300);
        const b = await dlg2.boundingBox();
        assert.ok(b.x >= 0 && b.x + b.width <= w + 1, `modal muat di lebar ${w}px`);
        await pic2.p.screenshot({ path: path.join(dir, f) });
      }
      await pic2.p.setViewportSize({ width: 1366, height: 900 });
      await dlg2.getByLabel("Saya sudah benar-benar mengirim hasil ini kepada pemohon.").check();
      await pic2.p.waitForTimeout(300);
      await pic2.p.screenshot({ path: path.join(dir, "10-dialog-langsung-pemohon.png") });
      await dlg2.getByRole("button", { name: "Konfirmasi Penyerahan" }).click();
      await pic2.p.getByTestId("delivery-status").filter({ hasText: "Sudah Dikirim ke Pemohon" }).waitFor();
      const qcText = await pic2.p.getByTestId("qc-status").innerText();
      assert.match(qcText, /Perlu Revisi/, "status QC tetap keputusan Manager terakhir");
      assert.doesNotMatch(qcText, /Disetujui/, "pengiriman langsung tidak menjadi persetujuan");
      // Selesaikan
      await pic2.p.getByTestId("next-step").getByRole("button", { name: "Selesaikan Pekerjaan" }).click();
      const done = pic2.p.getByRole("dialog", { name: "Selesaikan Pekerjaan?" });
      await done.waitFor();
      await pic2.p.screenshot({ path: path.join(dir, "11-dialog-selesaikan.png") });
      await done.getByRole("button", { name: "Ya, Selesaikan" }).click();
      await pic2.p.getByTestId("next-step-text").filter({ hasText: "Pekerjaan telah diselesaikan." }).waitFor();
      assert.equal(await pic2.p.getByTestId("next-step").getByRole("button").count(), 0, "CTA tidak relevan dinonaktifkan");
      assert.equal((await qcRow(id)).status, "completed");
      await pic2.p.waitForTimeout(400);
      await pic2.p.screenshot({ path: path.join(dir, "12-detail-selesai-desktop.png"), fullPage: true });
      await pic2.p.setViewportSize({ width: 390, height: 844 });
      await pic2.p.waitForTimeout(400);
      const overflow = await pic2.p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await pic2.p.screenshot({ path: path.join(dir, "13-detail-selesai-mobile.png"), fullPage: true });
      assert.equal(overflow, 0, "tanpa overflow horizontal di mobile");
      await pic2.c.close();
      assert.deepEqual(consoleErrors, [], `tanpa error konsol/hydration: ${consoleErrors.join(" | ")}`);
    } finally {
      await browser.close();
    }
  });

  await test("Smart WhatsApp (browser): template sesuai kondisi, nama dari akun login, edit & reset, wa.me tidak mencatat pengiriman", async () => {
    const chromePath = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({ executablePath: chromePath, headless: true });
    try {
      const { id } = await qcOrder("Judul Uji Smart WhatsApp");
      const dir = process.env.E2E_SHOT_DIR ?? path.join(os.tmpdir(), "dtic-form-shots");
      await mkdir(dir, { recursive: true });
      const consoleErrors = [];
      const open = async (cookie, size = { width: 1366, height: 900 }) => {
        const c = await browser.newContext({ viewport: size });
        const [name, value] = cookie.split("=");
        await c.addCookies([{ name, value, url: BASE }]);
        // Tangkap window.open (wa.me) tanpa benar-benar membuka WhatsApp.
        await c.addInitScript(() => { window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; }; });
        const p = await c.newPage();
        p.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
        p.on("pageerror", (e) => consoleErrors.push(e.message));
        await p.goto(`${BASE}/dtic/orders/${id}`);
        await p.getByTestId("next-step").waitFor();
        return { c, p };
      };
      const STAFFC = await qcStaff();
      const [acct] = await db`select full_name from app_users where email = 'staff@dtic.example'`;
      const pic = await open(STAFFC);
      await pic.p.getByRole("button", { name: "Hubungi via WhatsApp" }).click();
      const dlg = pic.p.getByRole("dialog", { name: "Pesan WhatsApp" });
      await dlg.waitFor();
      assert.equal(await dlg.getByLabel("Jenis pesan").inputValue(), "intro", "PIC baru ditugaskan → perkenalan");
      const msgBox = dlg.getByLabel("Isi pesan");
      const intro = await msgBox.inputValue();
      assert.match(intro, new RegExp(`Perkenalkan, ${acct.full_name} dari Tim DTIC Environesia\\.`), "nama dari akun login");
      assert.match(intro, /^Halo Kak Ani Lestari, selamat (pagi|siang|sore|malam)!/);
      assert.doesNotMatch(intro, /\{\{|Bapak|Ibu/);
      await pic.p.waitForTimeout(300);
      await pic.p.screenshot({ path: path.join(dir, "14-pesan-whatsapp.png") });
      // edit lalu reset
      await msgBox.fill(`${intro}\n\nTambahan dari PIC 🙏`);
      await dlg.getByRole("button", { name: "Reset ke Template" }).click();
      assert.equal(await msgBox.inputValue(), intro, "reset mengembalikan template");
      await msgBox.fill(`${intro}\n\nCatatan: ukuran A3 & warna hijau — https://drive.example/a?b=1&c=2 🙏`);
      const sent = await msgBox.inputValue();
      await dlg.getByRole("button", { name: "Buka WhatsApp" }).click();
      await dlg.getByText("Pesan belum terkirim sampai Anda menekan kirim di WhatsApp.", { exact: false }).waitFor();
      const opened = await pic.p.evaluate(() => window.__opened);
      assert.equal(opened.length, 1);
      assert.match(opened[0], /^https:\/\/wa\.me\/628\d+\?text=/);
      assert.equal(decodeURIComponent(opened[0].split("?text=")[1]), sent, "karakter Indonesia, emoji, baris baru & URL terjaga");
      await pic.p.waitForTimeout(500);
      const logs = await events(id, "whatsapp_opened");
      assert.equal(logs.length, 1, "WhatsApp dibuka tercatat");
      assert.equal(logs[0].detail.template, "intro");
      assert.equal(logs[0].detail.edited, true);
      assert.ok(!JSON.stringify(logs[0]).includes("ukuran A3"), "isi pesan tidak disimpan");
      assert.equal((await events(id, "delivery_recorded")).length, 0, "membuka WhatsApp bukan pengiriman");
      assert.equal((await qcRow(id)).status, "assigned", "status tidak berubah");
      await pic.c.close();
      // Dibuka lagi: perkenalan tidak disarankan ulang
      const pic2 = await open(STAFFC);
      await pic2.p.getByRole("button", { name: "Hubungi via WhatsApp" }).click();
      const d2 = pic2.p.getByRole("dialog", { name: "Pesan WhatsApp" });
      assert.equal(await d2.getByLabel("Jenis pesan").inputValue(), "clarification");
      assert.equal(await d2.getByRole("button", { name: "Buka WhatsApp" }).isEnabled(), true);
      await d2.getByRole("button", { name: "Buka WhatsApp" }).click();
      await d2.getByText("Tulis poin yang ingin diklarifikasi terlebih dahulu.").waitFor();
      assert.deepEqual(await pic2.p.evaluate(() => window.__opened), [], "klarifikasi kosong tidak dibuka");
      await pic2.c.close();
      // Menunggu QC: pemeriksaan internal, tanpa "hasil siap"
      await setStatusAs(id, "in_progress", STAFFC);
      await workflow(id, { action: "submit_qc" }, STAFFC);
      const mgr = await open(MGR);
      await mgr.p.getByRole("button", { name: "Hubungi via WhatsApp" }).click();
      const d3 = mgr.p.getByRole("dialog", { name: "Pesan WhatsApp" });
      assert.equal(await d3.getByLabel("Jenis pesan").inputValue(), "internal_review");
      const opts = await d3.getByLabel("Jenis pesan").locator("option").allInnerTexts();
      assert.ok(!opts.includes("Hasil sudah siap") && !opts.includes("Kirim hasil pekerjaan"), "tidak menawarkan hasil saat QC menunggu");
      const [mg] = await db`select full_name from app_users where email = 'manager@dtic.example'`;
      assert.match(await d3.getByLabel("Isi pesan").inputValue(), new RegExp(`Perkenalkan, ${mg.full_name}`), "pengirim = Manager yang login, bukan PIC lain");
      assert.doesNotMatch(await d3.getByLabel("Isi pesan").inputValue(), /disetujui/i);
      await mgr.p.setViewportSize({ width: 390, height: 844 });
      await mgr.p.waitForTimeout(300);
      await mgr.p.screenshot({ path: path.join(dir, "15-pesan-whatsapp-mobile.png") });
      await mgr.c.close();
      // Tanpa nomor WhatsApp
      const o2 = await qcOrder("Judul Uji WA Tanpa Nomor");
      await db`update orders set requester_whatsapp = null where id = ${o2.id}`;
      const c4 = await browser.newContext();
      const [n4, v4] = STAFFC.split("=");
      await c4.addCookies([{ name: n4, value: v4, url: BASE }]);
      const p4 = await c4.newPage();
      await p4.goto(`${BASE}/dtic/orders/${o2.id}`);
      await p4.getByRole("button", { name: "Hubungi via WhatsApp" }).click();
      const d4 = p4.getByRole("dialog", { name: "Pesan WhatsApp" });
      assert.equal(await d4.getByRole("button", { name: "Buka WhatsApp" }).isDisabled(), true, "nomor tidak tersedia → tidak bisa dibuka");
      await d4.getByText("nomor tidak tersedia").waitFor();
      await c4.close();
      assert.deepEqual(consoleErrors, [], `tanpa error konsol: ${consoleErrors.join(" | ")}`);
    } finally {
      await browser.close();
    }
  });

  await test("Daftar Order: Super Admin melihat 'Kirim ulang' & 'Tes Telegram'; Manager tidak", async () => {

    const admin = (await page("/dtic/orders")).html;
    assert.match(admin, /Tes Telegram/);
    assert.match(admin, /Kirim ulang [^"]+ ke Telegram/);
    assert.match(admin, /Hapus order /);
    const mgr = await (await pageRaw("/dtic/orders", MGR2)).text();
    assert.doesNotMatch(mgr, /Tes Telegram|Kirim ulang [^"]+ ke Telegram|Hapus order /);
  });
  await test("pratinjau: teks dari data order (tanpa token), tanpa mengirim apa pun", async () => {
    const { orderNumber, id } = await newOrderSent();
    const before = tg.calls.length;
    const r = await fetch(`${BASE}/api/internal/orders/${id}/telegram/preview`, { headers: { Cookie: ADMIN } });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.ok(body.text.includes("REQUEST PEKERJAAN BARU") && body.text.includes(orderNumber), "isi dari database");
    assert.ok(!body.text.includes("<") && !body.text.includes(TG_TOKEN), "teks biasa tanpa tag atau token");
    assert.equal(tg.calls.length, before, "pratinjau tidak mengirim");
  });
  await test("pratinjau: order tanpa PIC, tanpa lampiran, PIC tanpa username → HTTP 200 (bukan 500)", async () => {
    const { orderNumber, id } = await newOrderSent();
    await db`delete from order_assignments where order_id = ${id}`;
    const r = await fetch(`${BASE}/api/internal/orders/${id}/telegram/preview`, { headers: { Cookie: ADMIN } });
    assert.equal(r.status, 200, await r.clone().text());
    const body = await r.json();
    assert.ok(body.text.includes("• Belum ada PIC") && body.text.includes(orderNumber), "tanpa PIC ditangani");
    assert.ok(body.text.includes("📎 Lampiran: Tidak ada"), "tanpa lampiran ditangani");
    await db`insert into order_assignments (order_id, member_id) values (${id}, ${M["Nuri Khusnaini"].id})`;
    const withPic = await (await fetch(`${BASE}/api/internal/orders/${id}/telegram/preview`, { headers: { Cookie: ADMIN } })).json();
    assert.ok(withPic.text.includes("• Nuri Khusnaini"), "PIC tanpa username tampil sebagai nama");
    assert.ok(!withPic.text.includes("tg://user"), "tanpa mention palsu");
  });
  await test("pratinjau: ID tidak ada → 404; ID tidak valid → 404; tanpa sesi → 401; Manager → 403", async () => {
    const missing = await fetch(`${BASE}/api/internal/orders/${randomUUID()}/telegram/preview`, { headers: { Cookie: ADMIN } });
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error, "Order tidak ditemukan.");
    assert.equal((await fetch(`${BASE}/api/internal/orders/bukan-uuid/telegram/preview`, { headers: { Cookie: ADMIN } })).status, 404);
    assert.equal((await fetch(`${BASE}/api/internal/orders/${randomUUID()}/telegram/preview`)).status, 401);
    assert.equal((await fetch(`${BASE}/api/internal/orders/${randomUUID()}/telegram/preview`, { headers: { Cookie: MGR2 } })).status, 403);
  });
  await test("pratinjau tidak mengubah data, tidak masuk antrean, dan tidak mengirim pesan", async () => {
    const { id } = await newOrderSent();
    const before = { orders: (await db`select count(*)::int as c from orders`)[0].c, outbox: (await db`select count(*)::int as c from notification_outbox`)[0].c, msgs: tg.calls.length, status: (await db`select status from orders where id = ${id}`)[0].status };
    for (let i = 0; i < 3; i++) await fetch(`${BASE}/api/internal/orders/${id}/telegram/preview`, { headers: { Cookie: ADMIN } });
    const after = { orders: (await db`select count(*)::int as c from orders`)[0].c, outbox: (await db`select count(*)::int as c from notification_outbox`)[0].c, msgs: tg.calls.length, status: (await db`select status from orders where id = ${id}`)[0].status };
    assert.deepEqual(after, before);
  });
  await test("kirim ulang: pesan order sebenarnya terkirim, kunci sama tidak mengirim dua kali, audit tercatat", async () => {
    tg.mode = "ok";
    const { orderNumber, id } = await newOrderSent();
    const key = randomUUID();
    const before = telegramSent(orderNumber);
    const r1 = await internal(`/api/internal/orders/${id}/telegram`, "POST", { key });
    assert.equal(r1.status, 200, await r1.clone().text());
    assert.deepEqual([(await r1.json()).ok], [true]);
    const r2 = await internal(`/api/internal/orders/${id}/telegram`, "POST", { key });
    assert.equal(r2.status, 200, "klik ganda dengan kunci sama");
    assert.equal(telegramSent(orderNumber) - before, 1, "tepat satu pengiriman ulang");
    assert.ok(!tg.calls.at(-1).body.text.includes("PESAN UJI"), "kirim ulang adalah pesan order, bukan pesan uji");
    const audit = await db`select count(*)::int as c from auth_audit_log where action = 'telegram_resent' and detail->>'orderNumber' = ${orderNumber}`;
    assert.equal(audit[0].c, 1, "aksi tercatat di audit");
    const [order] = await db`select status from orders where id = ${id}`;
    assert.equal(order.status, "assigned", "data order tidak berubah");
  });
  await test("kirim ulang saat Telegram gagal: alasan aman ditampilkan; pengajuan dan status tidak berubah", async () => {
    const { orderNumber, id } = await newOrderSent();
    tg.mode = "500";
    const r = await internal(`/api/internal/orders/${id}/telegram`, "POST", { key: randomUUID() });
    assert.equal(r.status, 422);
    const body = await r.json();
    assert.equal(body.ok, false);
    assert.match(body.message, /Layanan Telegram sedang bermasalah/);
    assert.ok(!/123456|AAHtest|api\.telegram/.test(body.message), "tidak membocorkan token/URL");
    const [order] = await db`select status from orders where order_number = ${orderNumber}`;
    assert.equal(order.status, "assigned", "status tidak berubah");
    tg.mode = "ok";
  });
  await test("kirim ulang tanpa body yang valid → 422; order tidak ditemukan → 404", async () => {
    const { id } = await newOrderSent();
    assert.equal((await internal(`/api/internal/orders/${id}/telegram`, "POST", { key: "bukan-uuid" })).status, 422);
    assert.equal((await internal(`/api/internal/orders/${randomUUID()}/telegram`, "POST", { key: randomUUID() })).status, 404);
  });
  await test("tes order: pesan diberi label PESAN UJI, tidak masuk antrean, dan tidak mengubah data", async () => {
    tg.mode = "ok";
    const { orderNumber, id } = await newOrderSent();
    const countBox = (await db`select count(*)::int as c from notification_outbox`)[0].c;
    const before = tg.calls.length;
    const r = await internal("/api/internal/integrations/telegram/test-order", "POST", { orderId: id });
    assert.equal(r.status, 200, await r.clone().text());
    await waitFor(() => tg.calls.length > before, "pesan uji terkirim");
    assert.ok(tg.calls.at(-1).body.text.startsWith("🧪 <b>PESAN UJI"), "label uji di awal pesan");
    assert.equal((await db`select count(*)::int as c from notification_outbox`)[0].c, countBox, "tidak masuk antrean");
    assert.equal((await db`select count(*)::int as c from auth_audit_log where action = 'telegram_test_sent' and detail->>'orderNumber' = ${orderNumber}`)[0].c, 1);
  });
  await test("hapus order: konfirmasi di server; lampiran & riwayat ikut; audit mencatat nomor & judul; tabel terbarui", async () => {
    const { orderNumber, id } = await newOrderSent();
    const r = await internal(`/api/internal/orders/${id}`, "DELETE");
    assert.equal(r.status, 200);
    assert.equal((await db`select count(*)::int as c from orders where id = ${id}`)[0].c, 0);
    assert.equal((await db`select count(*)::int as c from order_status_history where order_id = ${id}`)[0].c, 0);
    assert.equal((await db`select count(*)::int as c from notification_outbox where order_id = ${id}`)[0].c, 0, "antrean ikut terhapus");
    const audit = await db`select detail from auth_audit_log where action = 'order_deleted' and detail->>'orderNumber' = ${orderNumber}`;
    assert.equal(audit.length, 1, "jejak audit tetap ada");
    assert.equal((await internal(`/api/internal/orders/${id}`, "DELETE")).status, 404);
  });

  await test("tombol uji: pesan uji terkirim, tidak membuat catatan antrean", async () => {
    tg.mode = "ok";
    const before = tg.calls.length;
    const countBefore = (await db`select count(*)::int as c from notification_outbox`)[0].c;
    const r = await internal("/api/internal/integrations/telegram/test", "POST");
    assert.equal(r.status, 200);
    assert.equal((await r.json()).ok, true);
    assert.equal(tg.calls.length - before, 1);
    assert.match(tg.calls.at(-1).body.text, /Uji koneksi/);
    assert.equal((await db`select count(*)::int as c from notification_outbox`)[0].c, countBefore);
    assert.equal((await internal("/api/internal/integrations/telegram/test", "POST", undefined, {}, MGR2)).status, 403);
  });

  await test("status setelah pengiriman berhasil: 'Aktif'", async () => {
    const body = await (await adminTg()).json();
    assert.equal(body.state, "active");
  });

  await test("Form Pengajuan: tidak ada di sidebar Super Admin; Manager tetap melihat; halaman publik tetap terbuka", async () => {
    assert.doesNotMatch(await (await pageRaw("/dtic/dashboard", ADMIN)).text(), /Form Pengajuan/);
    assert.match(await (await pageRaw("/dtic/dashboard", MGR2)).text(), /Form Pengajuan/);
    assert.equal((await pageRaw("/")).status, 200);
  });

  console.log("\nNomor WhatsApp pemohon");
  await test("nomor WhatsApp salah atau kosong → 422 per field, tidak ada order tersimpan", async () => {
    const before = (await db`select count(*)::int as c from orders`)[0].c;
    const bad = await submit(orderForm(brand1, { requesterWhatsapp: "12345" }).fd);
    assert.equal(bad.status, 422);
    assert.match((await bad.json()).fieldErrors.requesterWhatsapp, /tidak valid/);
    const empty = await submit(orderForm(brand1, { requesterWhatsapp: "" }).fd);
    assert.equal(empty.status, 422);
    assert.match((await empty.json()).fieldErrors.requesterWhatsapp, /wajib/);
    assert.equal((await db`select count(*)::int as c from orders`)[0].c, before);
  });
  await test("+62 dengan spasi/tanda hubung → disimpan 628…, detail menyiapkan WhatsApp ke nomor ternormalisasi, Telegram tidak memuat nomor", async () => {
    tg.mode = "ok";
    const beforeTg = tg.calls.length;
    const r = await submit(orderForm(brand1, { requesterWhatsapp: "+62 812-3456-7890" }).fd);
    assert.equal(r.status, 201);
    const { orderNumber } = await r.json();
    const row = (await db`select id, requester_whatsapp from orders where order_number = ${orderNumber}`)[0];
    assert.equal(row.requester_whatsapp, "6281234567890");
    const html = (await page(`/dtic/orders/${row.id}`)).html;
    // Tautan wa.me disusun saat tombol diklik (Smart WhatsApp); nomor ternormalisasi dikirim ke dialog.
    assert.match(html, /6281234567890/);
    assert.match(html, /Hubungi via WhatsApp/);
    assert.match(html, /\+6281234567890/);
    await waitFor(() => tg.calls.length > beforeTg, "pesan Telegram");
    assert.doesNotMatch(tg.calls.at(-1).body.text, /WhatsApp|6281234567890/, "WhatsApp pemohon tidak dikirim ke grup");
  });
  await test("pengajuan lama tanpa nomor tetap terbaca; detail menunjukkan 'Belum tersedia'", async () => {
    const id = (await db`select id from orders where requester_whatsapp is not null limit 1`)[0].id;
    await db`update orders set requester_whatsapp = null where id = ${id}`;
    const r = await page(`/dtic/orders/${id}`);
    assert.equal(r.status, 200);
    assert.match(r.html, /Belum tersedia/);
    assert.doesNotMatch(r.html, /wa\.me\/\d/);
  });
  await test("edit order: nomor diubah dan dinormalisasi; nomor kosong tidak mengubah yang tersimpan", async () => {
    const r = await submit(orderForm(brand1, { requesterWhatsapp: "081211112222" }).fd);
    const { orderNumber } = await r.json();
    const id = (await db`select id from orders where order_number = ${orderNumber}`)[0].id;
    const body = { requesterName: "Ani Edit", company: "", department: "Marketing", brandId: brand1, designTypeId: TYPES["Poster"], designTypeOther: "", designSize: "A4", title: "Judul Uji", briefDoc: richDoc("Judul Uji\nIsi brief uji."), driveUrl: "", briefYear: "", briefReference: "", designRequirements: "", deadline: "2026-12-31T23:59", priority: "normal", requesterWhatsapp: "0813 9999 8888" };
    assert.equal((await internal(`/api/internal/orders/${id}`, "PATCH", body)).status, 200);
    assert.equal((await db`select requester_whatsapp from orders where id = ${id}`)[0].requester_whatsapp, "6281399998888");
    assert.equal((await internal(`/api/internal/orders/${id}`, "PATCH", { ...body, requesterWhatsapp: "" })).status, 200);
    assert.equal((await db`select requester_whatsapp from orders where id = ${id}`)[0].requester_whatsapp, "6281399998888", "kosong = tidak diubah");
    assert.equal((await internal(`/api/internal/orders/${id}`, "PATCH", { ...body, requesterWhatsapp: "abc" })).status, 422);
  });

  console.log("\nIdentitas Telegram anggota");
  const deptId = (await db`select id from dtic_departments where is_active order by sort_order limit 1`)[0].id;
  const memberBody = (over = {}) => ({ fullName: "Anggota Telegram Uji", departmentId: deptId, position: "Staff", email: "", sortOrder: 50, isActive: true, telegramDisplayName: "", telegramUsername: "", telegramUserId: "", ...over });
  const createMember = (body, cookie = ADMIN) => internal("/api/internal/settings/members", "POST", body, {}, cookie);
  await test("Super Admin menyimpan anggota dengan username (@ dibuang, huruf kecil) & User ID → status Terdata", async () => {
    const r = await createMember(memberBody({ fullName: "Andi Uji", telegramDisplayName: "Andi D", telegramUsername: " @Andi_Design ", telegramUserId: "123456789" }));
    assert.equal(r.status, 201, await r.clone().text());
    const [m] = await db`select telegram_display_name, telegram_username, telegram_user_id, telegram_status from dtic_members where full_name = 'Andi Uji'`;
    assert.deepEqual([m.telegram_display_name, m.telegram_username, m.telegram_user_id, m.telegram_status], ["Andi D", "andi_design", "123456789", "recorded"]);
  });
  await test("anggota hanya dengan Nama Telegram → Terdata tanpa username; tanpa data Telegram → Belum dihubungkan", async () => {
    assert.equal((await createMember(memberBody({ fullName: "Budi Uji", telegramDisplayName: "Budi P" }))).status, 201);
    assert.equal((await createMember(memberBody({ fullName: "Siti Uji" }))).status, 201, "tanpa data Telegram tetap boleh");
    const rows = await db`select full_name, telegram_username, telegram_status from dtic_members where full_name in ('Budi Uji','Siti Uji') order by full_name`;
    assert.deepEqual(rows.map((r) => [r.full_name, r.telegram_username, r.telegram_status]), [["Budi Uji", null, "recorded"], ["Siti Uji", null, "not_linked"]]);
  });
  await test("username/User ID tanpa Nama Telegram ditolak; format salah ditolak; kosong bukan error", async () => {
    const noName = await createMember(memberBody({ fullName: "Tanpa Nama Uji", telegramUsername: "tanpa_nama" }));
    assert.equal(noName.status, 422);
    assert.match((await noName.json()).fieldErrors.telegramDisplayName, /Nama Telegram/);
    const badUser = await createMember(memberBody({ fullName: "Salah Uji", telegramDisplayName: "X", telegramUsername: "1abc" }));
    assert.equal(badUser.status, 422);
    assert.ok((await badUser.json()).fieldErrors.telegramUsername);
    const zero = await createMember(memberBody({ fullName: "Nol Uji", telegramDisplayName: "X", telegramUserId: "0123" }));
    assert.equal(zero.status, 422);
    assert.ok((await zero.json()).fieldErrors.telegramUserId);
  });
  await test("User ID atau username yang sudah dipakai anggota lain ditolak (409) dengan pesan jelas", async () => {
    const dupId = await createMember(memberBody({ fullName: "Duplikat Id Uji", telegramDisplayName: "Dup", telegramUserId: "123456789" }));
    assert.equal(dupId.status, 409);
    assert.match((await dupId.json()).fieldErrors.telegramUserId, /Sudah dipakai/);
    const dupUser = await createMember(memberBody({ fullName: "Duplikat User Uji", telegramDisplayName: "Dup", telegramUsername: "ANDI_DESIGN" }));
    assert.equal(dupUser.status, 409);
    assert.ok((await dupUser.json()).fieldErrors.telegramUsername);
  });
  await test("melepas identitas Telegram tidak menghapus anggota; anggota lama tanpa Telegram tetap berfungsi", async () => {
    const id = (await db`select id from dtic_members where full_name = 'Andi Uji'`)[0].id;
    const r = await internal(`/api/internal/settings/members/${id}`, "PATCH", memberBody({ fullName: "Andi Uji", telegramDisplayName: "", telegramUsername: "", telegramUserId: "" }));
    assert.equal(r.status, 200, await r.clone().text());
    const [m] = await db`select full_name, telegram_status, telegram_user_id from dtic_members where id = ${id}`;
    assert.deepEqual([m.full_name, m.telegram_status, m.telegram_user_id], ["Andi Uji", "not_linked", null]);
    assert.equal((await db`select count(*)::int as c from dtic_members where full_name = 'Nuri Khusnaini'`)[0].c, 1, "anggota lama ada");
    assert.match((await page(`/dtic/orders?pic=${id}`)).html, /<html/, "daftar order tetap dapat dibuka");
  });
  await test("Manager & Staff: identitas Telegram tidak dikirim ke browser dan tidak bisa diubah via API", async () => {
    const page2 = await pageRaw("/dtic/settings/members", MGR2);
    const html = await page2.text();
    assert.equal(page2.status, 200);
    assert.doesNotMatch(html, /andi_design|Budi P|123456789/, "data Telegram tidak ada di HTML Manager");
    assert.doesNotMatch(html, /Status Telegram/);
    const id = (await db`select id from dtic_members where full_name = 'Budi Uji'`)[0].id;
    const r = await internal(`/api/internal/settings/members/${id}`, "PATCH", memberBody({ fullName: "Budi Uji", telegramDisplayName: "Hack" }), {}, MGR2);
    assert.equal(r.status, 403);
    assert.equal((await createMember(memberBody({ fullName: "Manager Buat" }), MGR2)).status, 403);
    assert.equal((await db`select telegram_display_name from dtic_members where id = ${id}`)[0].telegram_display_name, "Budi P", "tidak berubah");
  });
  await test("Super Admin melihat identitas Telegram di tabel anggota (Nama Telegram, status)", async () => {
    const html = (await page("/dtic/settings/members")).html;
    assert.match(html, /Budi P/, "nama Telegram tampil");
    assert.match(html, /Terdata/);
    assert.match(html, /Belum dihubungkan/);
    assert.match(html, /Status Telegram/);
    assert.doesNotMatch(html, /@andi_design/, "andi sudah dilepas (tidak tampil)");
  });

  console.log("\nLayar display (/dtic/display)");
  const displayJson = async (cookie) => {
    const r = await fetch(`${BASE}/api/internal/display/orders`, { headers: cookie ? { Cookie: cookie } : {} });
    const text = await r.text();
    return { status: r.status, text, body: r.status === 200 ? JSON.parse(text) : null };
  };
  await test("display: tanpa login → halaman dialihkan ke login; API tanpa sesi → 401", async () => {
    assert.ok(await redirectsToLogin(await pageRaw("/dtic/display")), "halaman display butuh login");
    assert.equal((await displayJson(null)).status, 401);
  });
  await test("display: halaman tanpa sidebar admin; data hanya field yang dibutuhkan (tanpa WhatsApp/brief/catatan)", async () => {
    const page3 = await page("/dtic/display");
    assert.equal(page3.status, 200);
    assert.match(page3.html, /LIVE ORDER DISPLAY/);
    assert.doesNotMatch(page3.html, /Navigasi utama/, "tanpa sidebar admin");
    const d = await displayJson(MGR2);
    assert.equal(d.status, 200, "manager (dashboard.view) boleh melihat layar");
    const sensitive = d.text.match(/requesterWhatsapp|requester_whatsapp|internalNotes|internal_notes|briefDoc|brief_rich|driveUrl|081234567890/i);
    assert.equal(sensitive, null, `tanpa data sensitif (cocok: ${sensitive && sensitive[0]})`);
    const sample = [...d.body.queue.items, ...d.body.inProgress.items, ...d.body.done.items][0];
    if (sample) assert.deepEqual(Object.keys(sample).sort(), ["brandName", "createdAt", "deadlineAt", "designType", "id", "orderNumber", "overdue", "picNames", "priorityName", "priorityTone", "requesterName", "status", "title", "updatedAt"].sort(), "field minimal");
  });
  await test("display: angka sesuai database (antrean = submitted+assigned; sedang = in_progress; selesai = siap konfirmasi + selesai terbaru), dibatalkan tidak tampil", async () => {
    const d = (await displayJson(ADMIN)).body;
    const count = async (list) => (await pg.query(`select count(*)::int as c from orders where status in (${list.map((x) => `'${x}'`).join(",")})`)).rows[0].c;
    assert.equal(d.queue.total, await count(["submitted", "assigned"]), "antrean");
    assert.equal(d.inProgress.total, await count(["in_progress", "internal_revision", "awaiting_requester"]), "sedang dikerjakan");
    const confirm = await count(["pending_confirmation"]);
    const completed = (await db`select count(*)::int as c from orders where status = 'completed'`)[0].c;
    assert.equal(d.done.total, confirm + Math.min(12, completed), "selesai/siap konfirmasi");
    assert.equal(d.onHold, await count(["on_hold"]), "ditunda dihitung terpisah");
    const named = [...d.queue.items, ...d.inProgress.items, ...d.done.items].find((i) => i.requesterName);
    assert.ok(named && named.requesterName.length > 0, "nama pemohon dari data pengajuan");
    assert.ok(![...d.queue.items, ...d.inProgress.items, ...d.done.items].some((i) => i.status === "cancelled"), "dibatalkan tidak tampil");
  });
  await test("display: Staff tanpa penugasan tidak melihat order orang lain (cakupan role)", async () => {
    await internal("/api/internal/users", "POST", { fullName: "Staff Display", email: "staff-display@dtic.example", role: "staff", memberId: null, password: "StaffDisplay2026" });
    const STAFF_DISPLAY = await login("staff-display@dtic.example", "StaffDisplay2026");
    const d = (await displayJson(STAFF_DISPLAY)).body;
    assert.equal(d.queue.total + d.inProgress.total + d.done.total, 0, "tanpa penugasan → kosong");
  });
  await test("display: order berjalan sesuai workflow; order selesai/dibatalkan keluar dari antrean aktif", async () => {
    const { id, orderNumber } = await newOrderSent();
    const inQueue = async () => (await displayJson(ADMIN)).body.queue.items.some((i) => i.orderNumber === orderNumber);
    const inProg = async () => (await displayJson(ADMIN)).body.inProgress.items.some((i) => i.orderNumber === orderNumber);
    assert.ok(await inQueue(), "order baru masuk antrean");
    assert.equal((await internal(`/api/internal/orders/${id}/status`, "POST", { status: "in_progress" })).status, 200);
    assert.ok(!(await inQueue()) && (await inProg()), "pindah ke Sedang Dikerjakan");
    await finishViaQc(id);
    assert.ok(!(await inProg()), "selesai keluar dari sedang dikerjakan");
    assert.ok((await displayJson(ADMIN)).body.done.items.some((i) => i.orderNumber === orderNumber), "selesai tampil di kolom selesai");
    const { id: id2, orderNumber: num2 } = await newOrderSent();
    assert.equal((await internal(`/api/internal/orders/${id2}/status`, "POST", { status: "cancelled", note: "Uji display" })).status, 200);
    assert.ok(!(await displayJson(ADMIN)).body.queue.items.some((i) => i.orderNumber === num2), "dibatalkan tidak di antrean");
  });

  console.log("\nHapus order");
  await test("hapus order → data, riwayat, lampiran & berkas terhapus; detail 404", async () => {
    const before = await readdir(path.join(uploadDir, "orders")).catch(() => []);
    assert.ok(before.includes(order1.id), "folder berkas ada sebelum dihapus");
    const r = await internal(`/api/internal/orders/${order1.id}`, "DELETE");
    assert.equal(r.status, 200);
    assert.equal((await db`select count(*)::int as c from orders where id = ${order1.id}`)[0].c, 0);
    assert.equal((await db`select count(*)::int as c from order_status_history where order_id = ${order1.id}`)[0].c, 0);
    assert.equal((await db`select count(*)::int as c from order_attachments where order_id = ${order1.id}`)[0].c, 0);
    const after = await readdir(path.join(uploadDir, "orders")).catch(() => []);
    assert.ok(!after.includes(order1.id), "folder berkas terhapus");
    assert.match((await page(`/dtic/orders/${order1.id}`)).html, /Pekerjaan tidak ditemukan/);
    assert.equal((await internal(`/api/internal/orders/${order1.id}`, "DELETE")).status, 404);
  });

  console.log("\nKegagalan database");
  await test("database mati → pengajuan 500 dengan pesan jelas, tidak mengklaim berhasil", async () => {
    await db.end();
    await pgServer.stop();
    const r = await submit(orderForm(brand1).fd);
    assert.ok(r.status >= 500, `status ${r.status}`);
    const body = await r.json();
    assert.ok(!body.orderNumber);
    assert.match(body.error, /tidak tersimpan/i);
    assert.ok(!/postgres|ECONNREFUSED|127\.0\.0\.1/.test(body.error), "tidak membocorkan detail internal");
  });
  await test("React #441 (produksi) = error render Server Component: halaman 'Data gagal dimuat' + digest; log server memuat penyebab asli", async () => {
    const before = appLog.length;
    const r = await pageRaw("/dtic/orders", ADMIN);
    const html = await r.text();
    // Bukti utama ada di log server: error render (⨯) dengan digest dan penyebab asli (ECONNREFUSED).
    const serverLog = appLog.slice(before);
    const block = serverLog.match(/⨯ Error:[\s\S]*?digest: '(\d+)'/);
    assert.ok(block, "log server mencatat error render dengan digest");
    assert.ok(/ECONNREFUSED|ETIMEDOUT|CONNECT/i.test(block[0]), "penyebab asli (koneksi database) tercatat pada digest yang sama");
    assert.ok(!/postgres:\/\/|password=|DATABASE_URL=/i.test(html + serverLog), "tidak membocorkan kredensial");
    void r;
  });

  } // akhir suite penuh (dilewati pada E2E_WORKER_LIVE=1)
} finally {
  app.kill("SIGTERM");
  tgServer.close();
  await db.end({ timeout: 1 }).catch(() => {});
  await pgServer.stop().catch(() => {});
  await pg.close().catch(() => {});
  await rm(uploadDir, { recursive: true, force: true });
}

if (process.env.E2E_LOG) console.log("\n--- log aplikasi ---\n" + appLog);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} skenario lulus`);
if (failed.length) {
  console.log("\n--- log aplikasi (ekor) ---\n" + appLog.split("\n").slice(-40).join("\n"));
  process.exit(1);
}
process.exit(0);
