# DriveBox — File Manager Online

Starter project untuk belajar HTML, CSS, JavaScript, Node.js API, login username/password, dan penyimpanan bersama melalui Google Drive API.

## Fitur
- Login username/password dengan hash bcrypt.
- Sesi JWT di cookie HttpOnly, SameSite=Lax, Secure saat production, dengan pencabutan sesi di Upstash Redis saat logout.
- Pembatasan login lintas instance dengan Upstash Redis: 20 percobaan per alamat IP dan 5 percobaan per akun/IP dalam 15 menit.
- Daftar file/folder, navigasi folder, pencarian pada folder aktif.
- Buat folder, upload file, download, dan pindahkan file ke Sampah.
- Untuk folder di Drive Saya, file diakses sebagai akun Google pemilik lewat OAuth server-side.
- Operasi file dibatasi ke folder aplikasi dan subfoldernya.

## Batasan versi pemula
- Upload dibatasi 1 GiB per file; file di atas 3 MiB dikirim bertahap agar sesuai dengan batas request fungsi serverless.
- Satu username/password bersama untuk semua anggota; belum ada akun per anggota, peran, atau audit log.
- Endpoint hapus memindahkan item yang diberikan ke Sampah; gunakan hanya untuk folder Drive khusus aplikasi dan jangan gunakan pada file penting.
- Gunakan folder Drive khusus aplikasi. Jangan masukkan dokumen sensitif sebelum melakukan tinjauan keamanan.
- Untuk penggunaan tim sebenarnya, pertimbangkan database pengguna, akun individual, audit log, dan kontrol akses folder lebih ketat.

## 1. Persiapan
1. Instal Node.js versi LTS dan Git.
2. Instal VS Code.
3. Buka folder `file-manager-drive` di VS Code.
4. Buka Terminal > New Terminal, jalankan `npm.cmd install`.

## 2. Siapkan rate limiting
1. Buat database Redis di [Upstash](https://console.upstash.com/).
2. Salin REST URL dan REST token dari database tersebut untuk `UPSTASH_REDIS_REST_URL` dan `UPSTASH_REDIS_REST_TOKEN`.
3. Redis menyimpan penghitung pembatasan login dan penanda sesi aktif; file dan folder tetap disimpan di Google Drive.
4. Login dan operasi yang memerlukan sesi gagal tertutup jika Redis belum dikonfigurasi atau sedang tidak tersedia.

## 3. Buat folder Google Drive
1. Buat folder khusus, misalnya `DriveBox Shared`.
2. Salin ID folder dari URL: `https://drive.google.com/drive/folders/ID_FOLDER`.
3. Jangan membuat folder ini publik.

## 4. Hubungkan Drive Saya dengan OAuth
Service account tidak memiliki kuota penyimpanan Drive dan tidak dapat menjadi pemilik file. Untuk mengunggah ke folder biasa di Drive Saya, gunakan OAuth akun Google pemilik folder. Shared Drive organisasi dapat memakai service account jika organisasi mengizinkannya.

1. Buka Google Cloud Console dan pilih project yang akan dipakai.
2. Buka **APIs & Services > Library**, cari **Google Drive API**, lalu klik **Enable**.
3. Buka **Google Auth Platform** dan lengkapi Branding. Di Audience, pilih **External** dan tambahkan akun Google pemilik folder sebagai test user.
4. Di Data Access, tambahkan scope `https://www.googleapis.com/auth/drive`.
5. Di Clients, buat OAuth Client ID bertipe **Desktop app**, lalu unduh file JSON client. File ini berbeda dari JSON service account.
6. Dari terminal pada folder proyek, jalankan `node scripts/generate-drive-oauth-token.js`. Masukkan path file JSON OAuth client saat diminta, lalu buka URL yang ditampilkan. Login ke akun Google pemilik folder dan izinkan akses.
7. Skrip menyimpan tiga nilai OAuth ke `.env.drive-oauth`, yang diabaikan Git. Jangan kirim file atau nilainya kepada siapa pun.

Penting: Jika aplikasi External masih berstatus **Testing**, Google mengeluarkan refresh token yang kedaluwarsa setelah 7 hari untuk scope Drive. Untuk penggunaan yang terus aktif, atur status publikasi aplikasi sesuai panduan Google; verifikasi mungkin diperlukan jika aplikasi dibagikan ke pengguna lain.

## 5. Siapkan variabel lingkungan
Salin `.env.example` menjadi `.env.local` di folder utama, lalu isi nilainya secara lokal. `.env.local` diabaikan Git.

```env
APP_USERNAME=REPLACE_WITH_ADMIN_USERNAME
APP_PASSWORD_HASH=REPLACE_WITH_BCRYPT_HASH
SESSION_SECRET=REPLACE_WITH_AT_LEAST_32_RANDOM_BYTES
GOOGLE_OAUTH_CLIENT_ID=REPLACE_WITH_OAUTH_CLIENT_ID
GOOGLE_OAUTH_CLIENT_SECRET=REPLACE_WITH_OAUTH_CLIENT_SECRET
GOOGLE_OAUTH_REFRESH_TOKEN=REPLACE_WITH_OAUTH_REFRESH_TOKEN
DRIVE_FOLDER_ID=REPLACE_WITH_DRIVE_FOLDER_ID
UPSTASH_REDIS_REST_URL=https://REPLACE_WITH_UPSTASH_REST_URL
UPSTASH_REDIS_REST_TOKEN=REPLACE_WITH_UPSTASH_REST_TOKEN
```

- `.env.example` hanya berisi placeholder. Ganti setiap nilai setelah menyalinnya ke `.env.local`; jangan isi rahasia ke `.env.example`.
- Untuk folder di Drive Saya, isi `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, dan `GOOGLE_OAUTH_REFRESH_TOKEN` dari file `.env.drive-oauth`. Jika ketiganya ada, aplikasi memakai OAuth tersebut untuk semua operasi Drive.
- `GOOGLE_SERVICE_ACCOUNT_JSON` tetap dapat dipakai sebagai alternatif untuk Shared Drive Workspace. Jika OAuth belum diatur, aplikasi akan memakai kredensial service account yang valid.
- `UPSTASH_REDIS_REST_URL` harus berupa URL HTTPS REST Upstash. Jangan menambahkan tanda kutip atau spasi pada nilai-nilai environment.
- `APP_USERNAME` adalah username admin; `APP_PASSWORD_HASH` hanya menerima hash bcrypt yang valid dengan cost minimal 10.
- Buat hash bcrypt cost 12 dari PowerShell pada folder proyek. Ketikan password tidak ditampilkan:

Pastikan terminal berada di folder proyek `file-manager-drive` (folder yang berisi `package.json`). Jika terminal masih di folder induk workspace, jalankan `cd .\file-manager-drive` terlebih dahulu. Kemudian jalankan:

```powershell
node scripts/generate-password-hash.js
```

Masukkan password baru saat diminta, lalu salin baris `APP_PASSWORD_HASH=...` ke Vercel. Jangan kirim atau simpan password maupun hash di chat atau file proyek.
- Pilih password sepanjang maksimal 72 byte UTF-8 (batas bcrypt).
- Buat secret sesi dengan:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Pertahankan `SESSION_SECRET` tetap sama untuk semua function dan deployment instance pada environment Vercel yang sama. Jangan membuatnya ulang setiap request atau setiap deployment; mengganti nilainya akan membatalkan sesi aktif.

- Di Windows PowerShell, buat file lokal dengan `Copy-Item .env.example .env.local`, lalu isi `.env.local` melalui VS Code.
- Isi `APP_PASSWORD_HASH` dengan hasil bcrypt dan `SESSION_SECRET` dengan hasil `randomBytes` tersebut. Perubahan `SESSION_SECRET` akan membatalkan seluruh sesi yang sedang aktif.

## 6. Jalankan lokal
```bash
npm.cmd install
npm.cmd run dev
```
Buka http://localhost:3000. Server lokal meneruskan `/api/*` ke handler yang sama di `api/`; ketika di-deploy, setiap `api/*.js` tetap menjadi Vercel Serverless Function.

Jika konfigurasi belum lengkap, halaman akan menampilkan nama environment variable yang perlu diisi. Pastikan `.env.local` tidak masuk Git.

## 7. Deploy ke Vercel
1. Push proyek ke repository GitHub pribadi yang tidak berisi `.env.local` atau JSON key.
2. Di https://vercel.com/, pilih Add New > Project, lalu impor repository.
3. Buka Project Settings > Environment Variables dan tambahkan variabel berikut untuk setiap target yang dipakai: Development, Preview, dan Production. Preview dan Production harus diisi sebelum deployment ke target tersebut.
   - `APP_USERNAME`
   - `APP_PASSWORD_HASH`
   - `SESSION_SECRET`
   - `GOOGLE_OAUTH_CLIENT_ID`
   - `GOOGLE_OAUTH_CLIENT_SECRET`
   - `GOOGLE_OAUTH_REFRESH_TOKEN`
   - `DRIVE_FOLDER_ID`
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
4. Salin tiga nilai dari `.env.drive-oauth` ke environment variables Vercel. Pastikan ketiganya disetel untuk Production. Jangan memakai awalan publik seperti `NEXT_PUBLIC_` untuk variabel rahasia.
5. Deploy atau redeploy setelah mengatur variabel.
6. Uji login, buat folder, upload file kecil, download, dan hapus file uji.

Dokumentasi Vercel: https://vercel.com/docs/environment-variables

`npm run dev` tidak menjalankan CLI Vercel untuk menghindari pemanggilan Development Command secara rekursif. Jangan set **Project Settings > Build and Deployment > Development Command** menjadi `vercel dev`. Pengaturan proyek online tidak dapat diperiksa atau diubah dari workspace ini.

## 8. Keamanan penting
- Jangan pernah menyimpan password, private key, hash rahasia, atau `SESSION_SECRET` di file `public/` atau di kode frontend.
- Jika key service account bocor, cabut/hapus key tersebut di Google Cloud lalu buat key baru.
- Batasi akses ke proyek Vercel dan Google Cloud.
- Gunakan password unik yang kuat dan HTTPS.
- Rate limiting menggunakan Upstash Redis dan fail-closed jika konfigurasi Redis tidak tersedia.
- Ini starter untuk pembelajaran, bukan aplikasi produksi yang telah diaudit. Tambahkan audit log dan akun individual sebelum dipakai banyak orang.
- Penghapusan hanya memindahkan item ke Sampah Google Drive; tetap uji dengan file contoh terlebih dahulu.
