# Keamanan DTIC System — sebelum publikasi

Langkah 1 belum memiliki login per pengguna. Dokumen ini mencatat apa yang sudah diterapkan, risiko yang tersisa, dan apa yang harus dikerjakan sebelum aplikasi dibuka ke internet.

## Sudah diterapkan

- **Publik vs internal dipisah.** Publik: halaman utama `/` (form client), `/riwayat`, `/dtic/login`, `POST /api/public/*`, dan endpoint login/logout. Sisanya di bawah `/dtic/*` dan `/api/internal/*` wajib login. Endpoint publik hanya bisa *membuat* order; tidak bisa membaca, mengubah, atau menghapus order apa pun, dan tidak mengembalikan data selain nomor order.
- **Login per pengguna & RBAC.** Area internal memakai akun (`app_users`) dengan kata sandi hash **scrypt** (16 MB, salt acak). Sesi: token acak 256-bit di cookie `httpOnly` + `SameSite=Lax` (+ `Secure` di production); database hanya menyimpan SHA-256 token. Setiap permintaan memvalidasi sesi dan role di server (`authorize()`, `canAccessOrder()`, filter SQL untuk Staff). Akun nonaktif/role berubah berlaku pada permintaan berikutnya; nonaktif juga mencabut sesi. Logout mencabut sesi. Pesan galat login seragam (tidak membocorkan email terdaftar). Akun terkunci 15 menit setelah 5 kali salah kata sandi. Tidak ada akun publik; akun pertama lewat bootstrap idempotent. Trigger database mencegah Super Admin aktif terakhir diturunkan atau dinonaktifkan.
- **Validasi server** dengan Zod untuk semua input; skema internal `.strict()` dan form publik memakai whitelist field → status, nomor order, catatan internal tidak bisa disetel dari luar (anti mass-assignment). Trigger DB juga mengunci `order_number`, `submission_key`, `created_at`.
- **Pengajuan ganda dicegah** di klien (tombol terkunci saat mengirim) dan di server (`submission_key` unik → kirim ulang mengembalikan order yang sama).
- **Rate limit** form publik per IP (default 5 / 10 menit).
- **CSRF:** mutasi menolak `Origin` lintas situs; mutasi internal wajib header `X-DTIC-Request: 1`.
- **File:** whitelist ekstensi, cek magic bytes (isi harus cocok dengan format), maks. 10 MB/file, 5 file, 25 MB total. Nama asli hanya untuk tampilan (disanitasi); path penyimpanan = `orders/<uuid>/<uuid>.<ext>`. Bucket privat; unduhan hanya lewat route internal dengan `Content-Disposition`, `nosniff`, dan CSP `sandbox`. SVG/HTML tidak diterima.
- **Secret:** `DATABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` hanya dipakai di server (tidak ada di bundle klien — diverifikasi dengan pencarian di `.next/static`).
- **Database:** RLS aktif tanpa policy dan hak `anon`/`authenticated` dicabut, sehingga anon key Supabase tidak dapat membaca tabel.
- **Error** dikembalikan sebagai pesan umum; detail (stack, host DB) hanya di log server.
- **Aksi Daftar Order**: kirim ulang Telegram, tes Telegram, dan hapus order hanya untuk Super Admin (diperiksa di server). Aksi kirim ulang dan tes dicatat di audit tanpa token atau isi pesan. Penghapusan dicatat dengan nomor dan judul order.
- **Identitas Telegram anggota**: hanya Super Admin yang dapat melihat dan mengubah (`master.manage`, diperiksa di API). Server mengosongkan data Telegram sebelum dikirim ke Manager. Username dan User ID divalidasi dan dinormalisasi; User ID dan username unik di database.
- **Alur status & PIC**: perubahan status diperiksa di server (aturan transisi, pelaku, alasan wajib, PIC aktif). Status dari klien tidak dipercaya. Manager tidak memiliki izin mengubah status atau PIC, dan endpoint edit order menolak perubahan PIC dari role tanpa izin. Riwayat mencatat pelaku.
- **Nomor WhatsApp pemohon** adalah data pribadi. Dikumpulkan hanya untuk konfirmasi request, divalidasi & dinormalisasi di server, dan tampil di dashboard internal (role yang punya akses detail order) serta notifikasi Telegram. Tidak ada pengiriman WhatsApp otomatis. Pengajuan lama tanpa nomor tetap aman dibaca.
- **Telegram** (opsional): token & chat ID hanya dari environment server; tidak pernah ke bundle, respons API, halaman, atau log. Pesan galat dipetakan ke teks aman (tanpa token/URL/isi respons mentah). Pesan dibangun dari data database dengan HTML disaring, dan deskripsi dipotong. Notifikasi dijadwalkan setelah respons, tidak pernah sebelum transaksi order berhasil. Antrean `notification_outbox` (unik per order) mencegah notifikasi ganda; RLS aktif dan hak anon/authenticated dicabut.
- **Menu & pengaturan** (`site.manage`, `audit.view`, hanya Super Admin): API menu/website diperiksa `authorize()` pada setiap permintaan, perubahan divalidasi terhadap kapabilitas (role tidak bisa dinaikkan melampaui izinnya), dan menu inti dikunci di aplikasi maupun trigger database. Log audit tidak memuat kolom hash/token dan menyaring kunci sensitif dari detail.

## Risiko tersisa & wajib sebelum publikasi

1. **Sesi di database, bukan JWT.** Pencabutan langsung, tetapi setiap permintaan membaca database. Untuk skala besar, pertimbangkan cache sesi singkat. Belum ada **MFA** dan **pemulihan kata sandi mandiri** (reset dilakukan Super Admin). Pertimbangkan SSO/MFA sebelum publikasi luas.
2. **Rate limit di memori** hanya berlaku per instance. Pada serverless/multi-instance, gunakan penyimpanan bersama (Redis/Upstash) atau rate limit di WAF/CDN.
3. **IP klien dari `X-Forwarded-For`.** Aman hanya bila aplikasi berada di belakang proxy tepercaya yang menimpa header tersebut (Vercel, Nginx dengan `proxy_set_header`). Jika server diekspos langsung, penyerang bisa memalsukan header untuk melewati rate limit.
4. **Form publik tanpa CAPTCHA.** Pertimbangkan Cloudflare Turnstile/hCaptcha bila ada spam.
5. **Hak database.** `DATABASE_URL` default Supabase memakai role `postgres` (hak penuh). Disarankan membuat role khusus aplikasi (migration tetap dijalankan dengan role pemilik):
   ```sql
   create role dtic_app login password '<acak-panjang>';
   grant usage on schema public to dtic_app;
   grant select, insert, update, delete on public.brands, public.orders, public.order_attachments,
     public.order_status_history, public.order_number_counters to dtic_app;
   -- RLS aktif: izinkan hanya role aplikasi (anon/authenticated tetap tanpa akses)
   create policy dtic_app_all on public.brands               for all to dtic_app using (true) with check (true);
   create policy dtic_app_all on public.orders               for all to dtic_app using (true) with check (true);
   create policy dtic_app_all on public.order_attachments    for all to dtic_app using (true) with check (true);
   create policy dtic_app_all on public.order_status_history for all to dtic_app using (true) with check (true);
   create policy dtic_app_all on public.order_number_counters for all to dtic_app using (true) with check (true);
   ```
6. **Pemindaian malware** dokumen belum ada. Cek magic bytes mencegah penyamaran format, tetapi tidak mendeteksi dokumen Office/PDF berbahaya. Pertimbangkan pemindaian (ClamAV/layanan) sebelum dokumen dibuka.
7. **Hapus order bersifat permanen** (termasuk berkas). Pertimbangkan soft-delete + audit log setelah ada login.
8. **Header keamanan** (HSTS, CSP global, `X-Frame-Options`) sebaiknya ditambahkan di level hosting/`next.config.ts` saat domain produksi ditetapkan.

## Checklist publikasi

- [ ] Akun Super Admin dibuat via `npm run bootstrap:admin`, lalu variabel `BOOTSTRAP_ADMIN_*` dihapus dari `.env`
- [ ] `SESSION_COOKIE_SECURE` tidak dimatikan di production
- [ ] HTTPS aktif
- [ ] `DATABASE_URL` memakai role hak minimum
- [ ] Bucket `order-attachments` berstatus privat
- [ ] Rate limit bersama / WAF untuk deployment multi-instance
- [ ] Service-role key tidak pernah diberi prefix `NEXT_PUBLIC_`
