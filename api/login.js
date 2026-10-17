const { setSession, verifyPassword } = require("../lib/auth");
const { getAuthConfigurationError } = require("../lib/configuration");
const { createHash } = require("node:crypto");
const { Ratelimit } = require("@upstash/ratelimit");
const { Redis } = require("@upstash/redis");

let limiters;

function getLimiters() {
  if (!limiters) {
    const redis = Redis.fromEnv();
    limiters = [
      new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(20, "15 m"), prefix: "drivebox:login:ip" }),
      new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(5, "15 m"), prefix: "drivebox:login:account" })
    ];
  }
  return limiters;
}

function getClientAddress(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded) return forwarded.split(",")[0].trim().slice(0, 64);
  return String(req.socket?.remoteAddress || "unknown").slice(0, 64);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Metode tidak diizinkan." });
  res.setHeader("Cache-Control", "no-store");
  try {
    const configError = getAuthConfigurationError();
    if (configError) return res.status(503).json({ error: configError.message });
    const { username, password } = req.body || {};
    if (typeof username !== "string" || typeof password !== "string" ||
        !username.trim() || !password || username.length > 100 || password.length > 200 ||
        Buffer.byteLength(password, "utf8") > 72) {
      return res.status(400).json({ error: "Username atau password tidak valid." });
    }
    const address = getClientAddress(req);
    const identifier = createHash("sha256").update(`${address}\0${username.toLowerCase()}`).digest("hex");
    const [perAddressLimit, perAccountLimit] = getLimiters();
    const [addressRate, accountRate] = await Promise.all([
      perAddressLimit.limit(address),
      perAccountLimit.limit(identifier)
    ]);
    const blocked = [addressRate, accountRate].filter(result => !result.success);
    if (blocked.length) {
      const retryAfter = Math.max(1, Math.ceil((Math.max(...blocked.map(result => result.reset)) - Date.now()) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({ error: "Terlalu banyak percobaan login. Coba kembali beberapa saat lagi." });
    }
    const usernameOk = username === process.env.APP_USERNAME;
    const passwordOk = await verifyPassword(password);
    if (!usernameOk || !passwordOk) return res.status(401).json({ error: "Username atau password salah." });
    setSession(res, username);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ ok: true, username });
  } catch {
    console.error("Login failed because authentication or rate limiting is unavailable.");
    return res.status(503).json({ error: "Layanan login sementara tidak tersedia. Periksa konfigurasi autentikasi dan rate limiting." });
  }
};