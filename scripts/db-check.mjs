// Pemeriksaan konektivitas database bertahap — aman: tidak mencetak password / connection string.
//   1. Konfigurasi  2. DNS (A/AAAA)  3. Jaringan TCP per alamat  4. Login Postgres  5. Query tabel aplikasi
// Pemakaian: npm run db:check   (membaca .env lalu .env.local, sama seperti Next.js; env proses tetap prioritas)
import dns from "node:dns/promises";
import net from "node:net";
import postgres from "postgres";

const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => console.log(`  ✗ ${m}`);
const info = (m) => console.log(`    ${m}`);
const fail = (stage, hint) => {
  console.log(`\nGAGAL di tahap: ${stage}\n→ ${hint}`);
  process.exit(1);
};

// 1. Konfigurasi -------------------------------------------------------------
console.log("1. Konfigurasi DATABASE_URL");
const raw = process.env.DATABASE_URL;
if (!raw) fail("konfigurasi", "DATABASE_URL kosong. Isi di .env / .env.local (atau environment hosting).");
let url;
try {
  url = new URL(raw);
} catch {
  fail("konfigurasi", "DATABASE_URL bukan URI yang valid. Salin ulang dari Supabase Dashboard → Connect.");
}
const host = url.hostname;
const port = Number(url.port || 5432);
const isDirect = /^db\.[a-z0-9]+\.supabase\.co$/i.test(host);
const isPooler = /\.pooler\.supabase\.com$/i.test(host);
const isLocal = ["localhost", "127.0.0.1", "::1"].includes(host);
const kind = isDirect ? "Supabase Direct connection" : isPooler ? (port === 6543 ? "Supabase Transaction pooler" : "Supabase Session pooler") : isLocal ? "lokal" : "lainnya";
ok(`host ${host}, port ${port}, jenis: ${kind}`);
info(`username: ${url.username.includes(".") ? "postgres.<project-ref>" : url.username || "(kosong)"}, password: ${url.password ? "ada" : "TIDAK ADA"}, database: ${url.pathname.slice(1) || "(default)"}`);
if (isPooler && !url.username.includes(".")) bad("Pooler Supabase memerlukan username berbentuk postgres.<project-ref>.");
let password = "";
try {
  password = decodeURIComponent(url.password);
} catch {
  fail("konfigurasi", "Password pada DATABASE_URL berisi karakter % yang tidak valid. Encode karakter khusus (mis. @ → %40, # → %23).");
}
if (/^\[?YOUR-PASSWORD\]?$/i.test(password))
  fail("konfigurasi", "Password masih berupa placeholder [YOUR-PASSWORD] dari template Supabase. Ganti dengan password database (Supabase → Project Settings → Database → Reset database password bila lupa). Hapus juga tanda [ ].");

// 2. DNS ----------------------------------------------------------------------
console.log("2. DNS");
let addrs = [];
if (net.isIP(host)) addrs = [{ address: host, family: net.isIP(host) }];
else {
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch (e) {
    fail("DNS", `Hostname tidak dapat di-resolve (${e.code}). Periksa ejaan host dan koneksi DNS.`);
  }
}
const v4 = addrs.filter((a) => a.family === 4);
const v6 = addrs.filter((a) => a.family === 6);
ok(`${v4.length} alamat IPv4, ${v6.length} alamat IPv6`);

// 3. Jaringan -----------------------------------------------------------------
console.log("3. Jaringan (TCP)");
const tcp = (address, family) =>
  new Promise((resolve) => {
    const s = net.connect({ host: address, port, family, timeout: 6000 });
    s.once("connect", () => (s.destroy(), resolve(null)));
    s.once("timeout", () => (s.destroy(), resolve("ETIMEDOUT")));
    s.once("error", (e) => resolve(e.code ?? "ERROR"));
  });
let reachable = 0;
for (const a of addrs) {
  const err = await tcp(a.address, a.family);
  if (err) {
    bad(`IPv${a.family} ${a.address}:${port} → ${err}`);
  } else {
    ok(`IPv${a.family} ${a.address}:${port} terjangkau`);
    reachable++;
  }
}
if (reachable === 0) {
  if (v4.length === 0 && v6.length > 0)
    fail(
      "jaringan",
      "Host hanya memiliki alamat IPv6 dan jaringan mesin ini tidak dapat menjangkaunya. " +
        (isDirect
          ? 'Gunakan connection string "Session pooler" dari Supabase Dashboard → Connect (mendukung IPv4), lalu jalankan ulang pemeriksaan ini.'
          : "Gunakan endpoint yang mendukung IPv4 atau aktifkan IPv6 di jaringan."),
    );
  fail("jaringan", "Port database tidak terjangkau. Periksa firewall, Network Restrictions di Supabase, dan port.");
}

// 4. Login & 5. Query -----------------------------------------------------------
console.log("4. Login Postgres");
const hasSslParam = url.searchParams.has("sslmode") || url.searchParams.has("ssl");
const db = postgres(raw, {
  max: 1,
  prepare: false,
  connect_timeout: 10,
  onnotice: () => {},
  ...(hasSslParam ? {} : { ssl: isLocal ? false : "require" }),
});
try {
  const [r] = await db`select current_user as u, current_database() as d, split_part(version(), ' ', 2) as v`;
  ok(`login berhasil (role ${r.u.replace(/\..*/, ".<ref>")}, database ${r.d}, PostgreSQL ${r.v})`);
} catch (e) {
  await db.end({ timeout: 1 }).catch(() => {});
  const code = e.code ?? "";
  if (code === "28P01" || code === "28000") fail("autentikasi", "Username/password ditolak. Salin ulang connection string beserta password database yang benar.");
  if (/tenant or user not found/i.test(e.message)) fail("autentikasi", "Pooler tidak mengenali username/proyek. Pastikan memakai connection string pooler milik proyek ini (username postgres.<project-ref>).");
  if (code === "3D000") fail("autentikasi", "Nama database tidak ada.");
  if (/ssl|tls|certificate/i.test(e.message)) fail("SSL", `Negosiasi SSL gagal (${code || "SSL"}). Coba tambahkan ?sslmode=require pada URL.`);
  fail("login", `Koneksi Postgres gagal (${code || e.name}).`);
}

console.log("5. Query tabel aplikasi");
try {
  const [b] = await db`select count(*)::int as n from public.brands`;
  const [o] = await db`select count(*)::int as n from public.orders`;
  ok(`brands: ${b.n} baris, orders: ${o.n} baris`);
} catch (e) {
  await db.end({ timeout: 1 }).catch(() => {});
  if (e.code === "42P01") fail("query", "Tabel aplikasi belum ada. Jalankan: npm run db:migrate");
  if (e.code === "42501") fail("query", "Role database tidak punya izin membaca tabel (lihat docs/SECURITY.md bagian hak database).");
  fail("query", `Query gagal (${e.code ?? e.name}).`);
}
await db.end();
console.log("\nSEMUA TAHAP BERHASIL — database siap dipakai aplikasi.");
