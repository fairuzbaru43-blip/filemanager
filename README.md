# DriveBox — File Manager Online

Starter project untuk belajar HTML, CSS, JavaScript, Node.js API, login username/password, dan penyimpanan bersama melalui Google Drive API.

## Fitur
- Login username/password dengan hash bcrypt.
- Sesi JWT di cookie HttpOnly, SameSite=Strict, Secure saat production.
- Pembatasan login lintas instance dengan Upstash Redis: 20 percobaan per alamat IP dan 5 percobaan per akun/IP dalam 15 menit.
- Daftar file/folder, navigasi folder, pencarian pada folder aktif.
- Buat folder, upload file, download, dan pindahkan file ke Sampah.
- File disimpan pada folder Google Drive yang dibagikan kepada service account.
- Operasi file dibatasi ke folder aplikasi dan subfoldernya.

## Batasan versi pemula
- Upload dibatasi 3 MiB karena memakai JSON/base64 dan fungsi serverless.
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
3. Login akan gagal tertutup jika layanan ini belum dikonfigurasi.

## 3. Buat folder Google Drive
1. Buat folder khusus, misalnya `DriveBox Shared`.
2. Salin ID folder dari URL: `https://drive.google.com/drive/folders/ID_FOLDER`.
3. Jangan membuat folder ini publik.
4. Setelah membuat service account (langkah berikut), bagikan folder tersebut sebagai Editor ke alamat email service account. Jangan membagikan seluruh Drive pribadi.

## 4. Aktifkan Google Drive API dan service account
1. Buka https://console.cloud.google.com/
2. Buat atau pilih Google Cloud project.
3. Buka APIs & Services > Library, cari **Google Drive API**, lalu Enable.
4. Buka IAM & Admin > Service Accounts, lalu Create Service Account.
5. Buat key JSON untuk service account hanya jika kebijakan organisasi mengizinkannya. Simpan file JSON dengan aman; jangan commit ke GitHub.
6. Bagikan folder `DriveBox Shared` ke email service account (alamat berakhiran `iam.gserviceaccount.com`) dengan akses Editor.
7. Karena aplikasi memakai service account ke folder yang dibagikan, alur ini tidak membutuhkan OAuth consent/login Google pengguna. Login website sendiri memakai username/password. Jika memakai Shared Drive Google Workspace, tambahkan service account sebagai anggota Shared Drive sesuai kebijakan organisasi.

> Catatan: Service account tidak otomatis memiliki ruang Drive pribadi seperti pengguna biasa. Cara paling sederhana adalah berbagi folder khusus dengan service account. Hindari domain-wide delegation kecuali benar-benar diperlukan dan dikelola administrator Workspace.

## 5. Siapkan variabel lingkungan
Salin `.env.example` menjadi `.env.local` di folder utama, lalu isi nilainya secara lokal. `.env.local` diabaikan Git.

```env
APP_USERNAME=REPLACE_WITH_USERNAME
APP_PASSWORD_HASH=$2a$10$GANTI_DENGAN_HASH_BCRYPT
SESSION_SECRET=GANTI_DENGAN_RANDOM_SECRET_PANJANG_MINIMAL_32_BYTE
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"...","private_key_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n","client_email":"...@...iam.gserviceaccount.com","client_id":"..."}
DRIVE_FOLDER_ID=ID_FOLDER_DRIVE_KAMU
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...
```

- `GOOGLE_SERVICE_ACCOUNT_JSON` harus berupa JSON satu baris yang valid. Pastikan karakter newline dalam `private_key` direpresentasikan sebagai `\n`.
- Jangan awali `APP_PASSWORD_HASH` dengan tanda kutip tambahan.
- Buat hash password dengan perintah berikut:

```bash
node -e "const rl=require('node:readline').createInterface({input:process.stdin,output:process.stdout}); rl.question('Password: ', p => { console.log(require('bcryptjs').hashSync(p, 12)); rl.close(); })"
```

Masukkan password pilihanmu saat diminta, lalu salin hasil hash ke `APP_PASSWORD_HASH`. Jangan simpan password asli di file proyek.
- Pilih password sepanjang maksimal 72 byte UTF-8 (batas bcrypt).
- Buat secret sesi dengan:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

- Di Windows PowerShell, buat file lokal dengan `Copy-Item .env.example .env.local`, lalu isi `.env.local` melalui VS Code.

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
3. Tambahkan Environment Variables berikut di Project Settings > Environment Variables:
   - `APP_USERNAME`
   - `APP_PASSWORD_HASH`
   - `SESSION_SECRET`
   - `GOOGLE_SERVICE_ACCOUNT_JSON`
   - `DRIVE_FOLDER_ID`
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
4. Masukkan nilai JSON service account lengkap sebagai satu nilai environment variable. Jangan memakai awalan `NEXT_PUBLIC_`.
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
