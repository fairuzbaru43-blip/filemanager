const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");
const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");
const { google } = require("googleapis");

const projectRoot = path.resolve(__dirname, "..");

async function main() {
  const prompt = readline.createInterface({ input: stdin, output: stdout });
  let clientFile = process.argv[2];
  if (!clientFile) clientFile = await prompt.question("Path file JSON OAuth Client: ");
  prompt.close();

  clientFile = clientFile.trim().replace(/^['"]|['"]$/g, "");
  let clientConfig;
  try {
    clientConfig = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), clientFile), "utf8"));
  } catch {
    throw new Error("File JSON OAuth tidak bisa dibaca. Pilih file JSON dari OAuth Client Desktop.");
  }

  const installed = clientConfig?.installed;
  if (!installed?.client_id || !installed?.client_secret) {
    throw new Error("File harus berasal dari OAuth Client dengan tipe Desktop app.");
  }

  const state = crypto.randomBytes(24).toString("base64url");
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const port = server.address().port;
  const redirectUri = `http://localhost:${port}/oauth2callback`;
  const oauth = new google.auth.OAuth2(installed.client_id, installed.client_secret, redirectUri);
  const authUrl = oauth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/drive"],
    state
  });

  console.log("Buka URL berikut di browser dan izinkan akses ke akun Google pemilik folder Drive:");
  console.log(authUrl);
  console.log("Setelah selesai, browser akan kembali ke komputer ini. Jangan bagikan URL atau file kredensial.");

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Waktu otorisasi habis. Jalankan skrip lagi.")), 5 * 60 * 1000);

      server.on("request", async (req, res) => {
        const callbackUrl = new URL(req.url, redirectUri);
        if (callbackUrl.pathname !== "/oauth2callback") {
          res.writeHead(404).end("Not found");
          return;
        }
        if (callbackUrl.searchParams.get("state") !== state) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("Permintaan OAuth tidak valid.");
          return;
        }
        const authorizationError = callbackUrl.searchParams.get("error");
        if (authorizationError) {
          clearTimeout(timeout);
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("Akses Google tidak diberikan. Tutup tab ini.");
          reject(new Error("Akses Google tidak diberikan."));
          return;
        }
        const code = callbackUrl.searchParams.get("code");
        if (!code) {
          clearTimeout(timeout);
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("Kode OAuth tidak ditemukan.");
          reject(new Error("Google tidak mengirim kode otorisasi."));
          return;
        }

        try {
          const { tokens } = await oauth.getToken(code);
          if (!tokens.refresh_token) {
            clearTimeout(timeout);
            res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" }).end("Refresh token tidak diterima. Tutup tab ini.");
            reject(new Error("Refresh token tidak diterima Google. Hapus akses aplikasi lama dari akun Google lalu jalankan skrip lagi."));
            return;
          }

          const output = [
            "GOOGLE_OAUTH_CLIENT_ID=" + installed.client_id,
            "GOOGLE_OAUTH_CLIENT_SECRET=" + installed.client_secret,
            "GOOGLE_OAUTH_REFRESH_TOKEN=" + tokens.refresh_token
          ].join("\n") + "\n";
          const outputPath = path.join(projectRoot, ".env.drive-oauth");
          fs.writeFileSync(outputPath, output, { encoding: "utf8", mode: 0o600 });
          clearTimeout(timeout);
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(
            "<p>Otorisasi berhasil. Kredensial disimpan lokal; tutup halaman ini.</p>"
          );
          console.log("Berhasil. Nilai OAuth disimpan di file .env.drive-oauth (diabaikan Git).");
          console.log("Salin tiga nilai dari file itu ke Environment Variables Vercel. Jangan bagikan file atau nilainya.");
          resolve();
        } catch {
          clearTimeout(timeout);
          res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" }).end("Otorisasi gagal. Tutup tab ini.");
          reject(new Error("Pertukaran kode OAuth gagal. Periksa tipe OAuth Client dan coba lagi."));
        }
      });
    });
  } finally {
    server.close();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
