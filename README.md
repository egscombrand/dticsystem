# DTIC System — Langkah 1

Aplikasi web Department Creative IT (DTIC) untuk menerima dan mengelola order desain dari lima brand dalam satu tempat: form pengajuan publik, dashboard, daftar & detail order, Workboard (Kanban), kalender deadline, dan pengaturan brand. Tampilan light mode.

> Cakupan: notifikasi Telegram untuk pengajuan baru (lihat [Notifikasi Telegram](#notifikasi-telegram)). Google Spreadsheet, email/WhatsApp, dan notifikasi lain **tidak** termasuk.

## Stack

- Next.js 16.4 (App Router, Cache Components, Proxy) + React 19 + TypeScript
- Tailwind CSS 4, ikon lucide-react
- PostgreSQL (Supabase) via driver `postgres` — hanya dari server
- Supabase Storage (bucket privat) atau penyimpanan lokal untuk dokumen
- Zod untuk validasi (dipakai bersama di browser dan server)
- Vitest (unit) + skrip E2E dengan PGlite (Postgres 18 in-memory)

## Menjalankan

```bash
npm install
cp .env.example .env.local      # isi DATABASE_URL, dsb.
npm run db:migrate              # menjalankan supabase/migrations/*.sql (tercatat, non-destruktif)
npm run dev                     # http://localhost:3000 (form client), /dtic/login (internal)
```

Tanpa Supabase (pengembangan lokal):

```bash
npm run db:local                # terminal 1: Postgres lokal (PGlite) di port 54329, data di .data/pglite
# .env.local:
#   DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres
#   DB_POOL_MAX=1
#   STORAGE_DRIVER=local
npm run db:migrate
npm run dev
```

Produksi: `npm run build && npm start`. Area internal memakai **login per pengguna** di `/dtic/login`. Akun Super Admin pertama dibuat sekali lewat `npm run bootstrap:admin` (lihat bagian "Login internal"). Baca [docs/SECURITY.md](docs/SECURITY.md) sebelum publikasi.

## Login internal & role

| Role | Kemampuan utama |
|---|---|
| `super_admin` | Semua order, kelola akun & role, master data, **satu-satunya yang menetapkan PIC**, status termasuk Close, hapus order |
| `manager` | Memantau semua order dan PIC yang sudah ditetapkan (termasuk "Menunggu Penugasan"), status (termasuk Close), edit detail tanpa PIC, melihat anggota (read-only). **Tidak** dapat menetapkan atau mengganti PIC |
| `staff` | Hanya order yang ditugaskan kepadanya; boleh ubah status (tidak boleh Close) |

Pembatasan dilakukan di server (`authorize()`, `canAccessOrder()`, dan filter SQL), bukan hanya menyembunyikan menu. Matriks ada di `src/lib/auth/permissions.ts`.

**Bootstrap Super Admin** (sekali, idempotent):
```bash
BOOTSTRAP_ADMIN_EMAIL=… BOOTSTRAP_ADMIN_NAME="…" BOOTSTRAP_ADMIN_PASSWORD=… npm run bootstrap:admin
```
Bila email sudah ada, skrip tidak mengubah apa pun. Kata sandi minimal 12 karakter berisi huruf dan angka. Setelah itu, akun lain dibuat Super Admin di `/dtic/settings/users`.

## Menu sidebar & pengaturan website

- Menu disimpan di tabel `sidebar_menu_items` dan dibaca server saat merender panel. Yang tampil untuk sebuah role = `allowed_roles` **∩** role yang memiliki kapabilitas `required_capability` (`src/lib/menu.ts`). Pengaturan menu tidak pernah bisa memberi akses di atas izin server.
- Menu inti (Pengaturan Website, Pengaturan Menu, Pengguna & Role, Audit Aktivitas) tidak bisa disembunyikan atau dicabut dari Super Admin; ini dijaga aplikasi **dan** trigger database. Jadi Super Admin selalu punya jalan untuk memperbaiki menu.
- Bila database tidak terbaca saat merender sidebar, dipakai menu default (`DEFAULT_MENU`) agar navigasi tetap berfungsi.
- Preferensi sidebar diciutkan/diperluas disimpan di `localStorage` per perangkat; nilai awal berasal dari `site_settings.sidebar_default_collapsed`.
- Logo website **belum didukung** (belum ada penyimpanan file untuk logo).

## Identitas Telegram anggota (Member DTIC)

Super Admin mengisi identitas Telegram setiap anggota di **Pengaturan → Member DTIC**: nama Telegram, username (tanpa `@`, disimpan huruf kecil), dan Telegram User ID (opsional, angka). Data disimpan di tabel anggota yang sama (`dtic_members`, kolom `telegram_*`, migrasi `20261013060000_member_telegram.sql`). Anggota lama tetap valid dengan status "Belum dihubungkan".

- Nama Telegram wajib hanya bila ada username atau User ID.
- Status hanya **Terdata** atau **Belum dihubungkan**. Mengisi data secara manual tidak berarti terverifikasi, dan belum ada mekanisme verifikasi, sehingga status "Terverifikasi" tidak pernah diberikan otomatis.
- Satu User ID atau username tidak bisa dipakai dua anggota (indeks unik).
- Melepas identitas Telegram menghapus data Telegram saja; anggota tetap ada.
- Manager dan Staff tidak menerima data Telegram dari server.
- Mention PIC belum aktif. Struktur `pickTelegramRef` (`src/lib/member-telegram.ts`) menyiapkan aturan: User ID hanya dipakai setelah terverifikasi, username hanya ditampilkan, dan User ID tidak pernah ditebak.

## Retry otomatis notifikasi Telegram

- Setiap notifikasi masuk antrean `notification_outbox` dalam transaksi pengajuan. Percobaan pertama langsung dijalankan setelah respons dikirim.
- Galat **sementara** (timeout, jaringan putus, 429, 5xx) dijadwalkan ulang: 3, 10, 30, lalu 60 detik. Total maksimal **5 percobaan**. Untuk 429, jeda mengikuti `retry_after` dari Telegram bila lebih lama.
- Galat **permanen** (token, chat ID, atau izin salah) berhenti pada percobaan pertama dan ditampilkan dengan alasannya. Perbaiki konfigurasi lalu gunakan **Kirim ulang**.
- Status: Menunggu pengiriman · Sedang dikirim · Akan dicoba lagi (dengan waktu percobaan berikutnya) · Terkirim · Gagal.
- **Worker** berjalan di proses server (`src/instrumentation.ts`, setiap 2 detik). Antrean ada di database, jadi baris yang tertunda tetap diproses setelah server dimulai ulang. Klaim memakai `FOR UPDATE SKIP LOCKED`, sehingga dua worker tidak mengambil baris yang sama. Nonaktifkan dengan `TELEGRAM_WORKER=off` bila memakai scheduler sendiri; scheduler itu dapat memanggil `POST /api/internal/telegram/worker/tick` (Super Admin).
- Batasan: deployment serverless tanpa proses tetap tidak menjalankan worker. Bila koneksi putus setelah Telegram menerima pesan, percobaan ulang bisa menghasilkan pesan ganda, karena Telegram tidak menyediakan idempotency key.

## Aksi Super Admin di Daftar Order

- **Kirim ulang ke Telegram** per order: menampilkan pratinjau pesan dari data order yang tersimpan, lalu mengirim lewat bot yang sudah ada. Hasil yang ditampilkan berasal dari status pengiriman di database. Klik ganda tidak menghasilkan dua pengiriman (kunci idempoten per dialog). Data order tidak berubah.
- **Tes Telegram**: pesan uji koneksi, atau pesan uji dari satu order. Pesan uji selalu diberi label "PESAN UJI — BUKAN PEKERJAAN BARU" dan tidak masuk antrean notifikasi.
- **Hapus Order**: konfirmasi dengan mengetik nomor order. Lampiran, riwayat status, dan antrean notifikasi ikut terhapus. Pesan Telegram yang sudah terkirim tidak bisa ditarik. Nomor dan judul order tetap tercatat di audit (`order_deleted`).

Semua aksi ini hanya untuk Super Admin dan diperiksa di server.

## Alur status pengerjaan

Status resmi: **Pengajuan Masuk** (`submitted`, hanya data lama tanpa PIC) · **Siap Dikerjakan** (`assigned`, status awal pengajuan baru) · **Sedang Dikerjakan** (`in_progress`) · **Menunggu Konfirmasi** (`pending_confirmation`) · **Ditunda** (`on_hold`, alasan wajib) · **Selesai** (`completed`) · **Dibatalkan** (`cancelled`, alasan wajib).

Aturan transisi ada di satu tempat (`src/lib/workflow.ts`) dan diperiksa ulang di server setiap permintaan. Pemohon memilih satu PIC saat mengajukan; PIC tersebut langsung menjadi penugasan. PIC (Staff yang ditugaskan) memulai, menunda, melanjutkan, dan menyerahkan hasil. Super Admin mengonfirmasi, meminta revisi, dan membatalkan. Manager hanya memantau. Riwayat mencatat pelaku dan catatan.

Migrasi `20261013050000_status_workflow.sql` memetakan status lama berdasarkan arti (misalnya `closed` → Selesai, `review` → Menunggu Konfirmasi). Riwayat lama tidak diubah.

## Rute

| Rute | Akses | Fungsi |
|---|---|---|
| `/` | Publik | Halaman utama: form pengajuan order untuk client/brand |
| `/ajukan` | Publik | Alamat lama, dialihkan ke `/` |
| `POST /api/public/orders` | Publik | Satu-satunya endpoint publik: membuat order |
| `/dtic/login` | Publik | Login internal |
| `/dtic/dashboard` | Internal (login) | Dashboard DTIC; isi mengikuti role |
| `/dtic/orders`, `/dtic/orders/[id]`, `/dtic/orders/[id]/edit` | Internal (login) | Daftar, detail, edit order (Staff: hanya miliknya) |
| `/dtic/settings/users` | Super Admin | Akun & role |
| `/dtic/settings/menu` | Super Admin | Label, urutan, visibilitas, dan role tiap menu sidebar |
| `/dtic/settings/website` | Super Admin | Nama sistem, tagline, default sidebar |
| `/dtic/settings/audit` | Super Admin | Log aktivitas masuk, akun, menu, dan pengaturan (tanpa rahasia) |
| `/workboard` | Internal | Kanban 8 status (drag & drop + pilihan status yang aksesibel) |
| `/calendar` | Internal | Kalender deadline (WIB) |
| `/settings/brands` | Internal | Nama, slug, status aktif brand |
| `/api/internal/*` | Internal | Ubah status, catatan, edit, hapus, unduh dokumen, brand |

## Form client & data master

Semua pilihan pada form client dibaca dari database dan dikelola di **`/settings`** (internal):
Brand · Divisi · Member DTIC · Jenis Order · Prioritas. Perubahan langsung berlaku tanpa mengubah kode.

| Field form `/` | Disimpan di |
|---|---|
| Timestamp | `orders.created_at` (otomatis) |
| Nama | `requester_name` |
| Brand | `brand_id` → `brands` |
| Departemen / Divisi | `department` (unit kerja pemohon, teks) |
| Nomor WhatsApp Aktif | `requester_whatsapp` (wajib untuk pengajuan baru; format `628…`, dinormalisasi dari `08…` / `+62…`; NULL untuk pengajuan lama). Dipakai tim DTIC untuk konfirmasi; dashboard memberi tautan `https://wa.me/…` yang dibuka manual |
| Jenis Order Desain | `design_order_type_id` → `design_order_types`; `design_type` = label/isian "Lainnya" |
| Ukuran | `design_size` (preset di `src/lib/config/order-options.ts` atau custom cm) |
| Deskripsi Desain | `brief_rich` (dokumen Tiptap JSON tersanitasi) + `brief` (teks polos) |
| Dokumen pendukung | `order_attachments` (bucket privat) + `drive_url` (tautan Google Drive, tidak diakses server) |
| Deadline | `deadline_at` (tanggal → 23.59 WIB) |
| Prioritas | `priority` → `priority_levels.code` (default: `DEFAULT_PRIORITY_CODE`) |
| Close / status | `status`, hanya tim DTIC |

`dtic_departments` dan `dtic_members` adalah data tim internal DTIC (tidak ditampilkan ke client).

## Environment variables

Lihat [.env.example](.env.example). Ringkasan:

| Variabel | Wajib | Keterangan |
|---|---|---|
| `DATABASE_URL` | Ya | Connection string Postgres Supabase (server-only). Gunakan **Session pooler** dari Dashboard → Connect bila server tidak mendukung IPv6 (host direct `db.<ref>.supabase.co` hanya IPv6) |
| `DB_POOL_MAX` | Tidak | Default 5; isi `1` untuk PGlite |
| `STORAGE_DRIVER` | Tidak | `supabase` atau `local` (otomatis `supabase` bila URL + service key ada) |
| `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` | Untuk storage Supabase | URL proyek |
| `SUPABASE_SERVICE_ROLE_KEY` | Untuk storage Supabase | Rahasia, server-only |
| `SUPABASE_STORAGE_BUCKET` | Tidak | Default `order-attachments` |
| `LOCAL_STORAGE_DIR` | Tidak | Default `.data/uploads` |
| `SESSION_TTL_HOURS`, `SESSION_COOKIE_SECURE` | Tidak | Masa berlaku sesi login internal |
| `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_PASSWORD` | Sekali | Hanya untuk `npm run bootstrap:admin` |
| `SUBMIT_RATE_LIMIT_MAX`, `SUBMIT_RATE_LIMIT_WINDOW_SECONDS` | Tidak | Default 5 pengajuan / 600 detik per IP |
| `DEFAULT_PRIORITY_CODE` | Tidak | Kode prioritas default, `normal` |
| `TELEGRAM_BOT_TOKEN` | Untuk Telegram | Token bot dari @BotFather. Rahasia, server-only, tidak pernah ke browser |
| `TELEGRAM_CHAT_ID` | Untuk Telegram | ID grup/chat tujuan (contoh `-1001234567890`) |
| `DTIC_APP_URL` | Tidak | URL publik aplikasi untuk tautan detail di pesan Telegram (`/dtic/orders/<id>`, tetap wajib login). Di production harus `https://`; `localhost`/http tidak dikirim sebagai tautan |
| `TELEGRAM_API_BASE` | Tidak | Hanya untuk pengujian. Hanya `https://…` atau `http://127.0.0.1`/`localhost` yang diterima |

## Notifikasi Telegram

Setiap pengajuan baru yang berhasil disimpan membuat satu baris di `notification_outbox` dalam transaksi yang sama dengan order. Setelah respons dikirim ke pemohon, server mengirim pesan ke `TELEGRAM_CHAT_ID` melalui Bot API resmi. Database tetap sumber data utama: kegagalan Telegram tidak membatalkan pengajuan, dan pesan selalu dibaca ulang dari database.

- **Status** (`/dtic/settings/integrations`, hanya Super Admin): Belum dikonfigurasi · Dikonfigurasi, belum diuji · Aktif · Bermasalah. Nilai token/chat ID tidak pernah ditampilkan.
- **Uji** (tombol "Kirim notifikasi uji") mengirim pesan uji tanpa data order.
- **Kirim ulang** memproses notifikasi yang `pending`/`failed`. Satu order hanya punya satu notifikasi (`unique`), dan klaim atomik mencegah pengiriman ganda.
- Tanpa konfigurasi, pengajuan tetap diterima; notifikasinya menunggu di antrean dan dikirim setelah konfigurasi diisi.
- Format pesan (bahasa Indonesia): **Request pekerjaan baru** berisi ringkasan (nomor order, status, judul, jenis, brand, prioritas, tenggat), petugas (PIC dari menu Member DTIC), brief, jumlah lampiran yang tersimpan, pengaju dan departemen, serta tautan detail (hanya bila `DTIC_APP_URL` https). **Pembaruan status** berisi status sebelum dan sesudah, petugas, waktu, dan catatan. Nomor WhatsApp pemohon dan ukuran desain **tidak** dikirim ke grup. Mention langsung hanya untuk PIC yang terverifikasi; lainnya ditampilkan sebagai nama atau username.

**Mengaktifkan:**
1. Buat bot dengan @BotFather (`/newbot`) dan simpan tokennya.
2. Tambahkan bot ke grup tujuan (jadikan admin bila berupa kanal).
3. Kirim satu pesan di grup, lalu buka `https://api.telegram.org/bot<TOKEN>/getUpdates` dan salin `chat.id`. Jangan membagikan URL berisi token.
4. Isi `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, dan (opsional) `DTIC_APP_URL` di environment server, lalu jalankan ulang server.
5. Buka Pengaturan → Integrasi Telegram dan klik "Kirim notifikasi uji".

Batasan: bila server berhenti tepat setelah Telegram menerima pesan tetapi sebelum status tercatat, notifikasi itu bisa terkirim dua kali saat dikirim ulang (pengiriman bersifat *at-least-once* pada kasus ini).

## Database

Jika koneksi gagal, log server menampilkan baris `[database] …` berisi diagnosis (IPv6 tidak terjangkau, DNS, autentikasi, tabel belum dimigrasi, dll.) tanpa menampilkan kredensial.

Migration (jalankan `npm run db:migrate`; cek dulu dengan `-- --dry-run`, diagnosis koneksi `npm run db:check`):

1. `20261009000000_dtic_init.sql` — skema inti.
2. `20261009010000_form_spreadsheet_fields.sql` — `orders.company` opsional.
3. `20261009020000_master_data.sql` — seed 5 brand DTIC, divisi & 9 member, jenis order, 3 prioritas; relasi jenis/prioritas di `orders`, `brief_rich`, `drive_url`. Seed idempoten (`ON CONFLICT DO NOTHING`).

- `brands`, `orders`, `order_attachments`, `order_status_history`, `order_number_counters`
- Nomor order `DTIC-YYYY-NNNNN` dibuat trigger database dengan penghitung per tahun (`INSERT … ON CONFLICT DO UPDATE` mengunci baris) → aman untuk pengajuan bersamaan.
- Setiap perubahan status (dan status awal) dicatat trigger ke `order_status_history`; `completed_at` diisi otomatis.
- `order_number`, `submission_key`, `created_at` tidak bisa diubah lewat UPDATE (dikunci trigger).
- Foreign key `orders.brand_id → brands` dengan `ON DELETE RESTRICT`: order lama tetap terhubung ke brand asalnya.
- RLS aktif tanpa policy + REVOKE untuk `anon`/`authenticated`: tabel tidak bisa diakses dengan anon key lewat API Supabase.
- Membuat bucket privat `order-attachments` bila skema `storage` tersedia.

Tabel tambahan di luar daftar minimal: `order_number_counters` (penomoran) dan `dtic_schema_migrations` (pencatat migration). Kolom tambahan `orders`: `submission_key` (cegah pengajuan ganda), `title`, `brief_year`, `brief_reference`, `design_requirements` (rincian brief).

## Pengujian

```bash
npm run typecheck
npm run lint
npm test             # unit: tanggal/zona waktu, validasi, file, status, akses internal
npm run build
npm run test:e2e     # 32 skenario E2E terhadap build produksi (PGlite + storage lokal)
```

## Struktur kode

```
src/app/(public)               halaman utama / (form client)
src/app/(internal)/…           dashboard, orders, workboard, calendar, settings
src/app/api/public|internal    route handler
src/proxy.ts                   gerbang publik/internal (cookie sesi)
src/lib/auth                   kata sandi (scrypt), kebijakan, matriks hak akses
src/lib/server/auth.ts        sesi, cookie, authorize()
src/components/ui              komponen reusable (button, badge, card, stat-card, form, modal, pagination…)
src/components/{orders,dashboard,workboard,calendar,brands,layout}
src/lib/server/repositories    akses data (SQL)
src/lib/server/services        logika pengajuan (validasi file → upload → transaksi DB)
src/lib/server/storage         Supabase Storage / lokal
src/lib/validation             skema Zod
src/lib/{status,dates,files}   utilitas status, zona waktu, file
src/lib/config                 opsi form & konfigurasi aplikasi
supabase/migrations            SQL schema
scripts/                       migrate, local-db, e2e
```
