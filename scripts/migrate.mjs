// Menjalankan migration SQL di supabase/migrations secara berurutan dan tercatat.
// Pemakaian: npm run db:migrate   (membaca DATABASE_URL dari .env.local / environment)
//            npm run db:migrate -- --dry-run   (hanya menampilkan migration yang belum dijalankan)
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL belum diisi.");
  process.exit(1);
}
const dryRun = process.argv.includes("--dry-run");
const dir = path.resolve("supabase/migrations");
const local = /@(localhost|127\.0\.0\.1)(:|\/)/.test(url);
const hasSsl = /[?&](sslmode|ssl)=/.test(url);
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {}, ...(hasSsl ? {} : { ssl: local ? false : "require" }) });

try {
  // Dry-run tidak boleh menulis apa pun ke database — termasuk membuat tabel pencatat.
  const [{ exists }] = await sql`select to_regclass('public.dtic_schema_migrations') is not null as exists`;
  if (!exists && !dryRun) {
    await sql`create table if not exists public.dtic_schema_migrations (
      name text primary key, applied_at timestamptz not null default now())`;
    await sql`alter table public.dtic_schema_migrations enable row level security`;
  }
  const applied = new Set(
    exists || !dryRun ? (await sql`select name from public.dtic_schema_migrations`).map((r) => r.name) : [],
  );
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const pending = files.filter((f) => !applied.has(f));
  if (pending.length === 0) console.log("Tidak ada migration baru.");
  for (const file of pending) {
    if (dryRun) {
      console.log(`[dry-run] akan dijalankan: ${file}`);
      continue;
    }
    const body = await readFile(path.join(dir, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into public.dtic_schema_migrations (name) values (${file})`;
    });
    console.log(`✓ ${file}`);
  }
} catch (error) {
  console.error("Migration gagal:", error.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
