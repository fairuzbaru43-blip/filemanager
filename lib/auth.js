const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { randomBytes } = require("node:crypto");
const { Redis } = require("@upstash/redis");
const { getAuthConfigurationError } = require("./configuration");

const COOKIE_NAME = "fm_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60;
let sessionRedis;

function getSessionRedis() {
  if (!sessionRedis) sessionRedis = Redis.fromEnv();
  return sessionRedis;
}

function sessionKey(id) {
  return `drivebox:session:${id}`;
}

function isHttpsRequest(req) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  return req.socket?.encrypted === true || process.env.NODE_ENV === "production" ||
    (typeof forwardedProto === "string" && forwardedProto.split(",")[0].trim().toLowerCase() === "https");
}

function cookieOptions(req) {
  const secure = isHttpsRequest(req);
  return `HttpOnly; Path=/; SameSite=Lax; Max-Age=28800${secure ? "; Secure" : ""}`;
}

async function setSession(req, res, username) {
  const configError = getAuthConfigurationError();
  if (configError) throw configError;
  const jti = randomBytes(32).toString("base64url");
  await getSessionRedis().set(sessionKey(jti), "1", { ex: SESSION_TTL_SECONDS });
  const token = jwt.sign({ username, jti }, process.env.SESSION_SECRET, {
    algorithm: "HS256",
    expiresIn: SESSION_TTL_SECONDS,
    issuer: "drivebox",
    audience: "drivebox"
  });
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=${token}; ${cookieOptions(req)}`);
}

async function clearSession(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const secure = isHttpsRequest(req) ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0${secure}`);
  const token = getCookie(req, COOKIE_NAME);
  if (!token) return;

  let payload;
  try {
    payload = jwt.verify(token, process.env.SESSION_SECRET, {
      algorithms: ["HS256"],
      issuer: "drivebox",
      audience: "drivebox"
    });
  } catch {
    return;
  }
  if (payload && typeof payload.jti === "string" && /^[A-Za-z0-9_-]{43}$/.test(payload.jti)) {
    await getSessionRedis().del(sessionKey(payload.jti));
  }
}

function getCookie(req, name) {
  const header = req.headers.cookie || "";
  const part = header.split(";").map(v => v.trim()).find(v => v.startsWith(name + "="));
  return part ? part.slice(name.length + 1) : "";
}

async function requireAuth(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const configError = getAuthConfigurationError();
  if (configError) {
    res.status(503).json({ error: configError.message });
    return null;
  }

  const token = getCookie(req, COOKIE_NAME);
  if (!token) {
    res.status(401).json({ error: "Browser tidak mengirim cookie sesi. Silakan login kembali." });
    return null;
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.SESSION_SECRET, {
      algorithms: ["HS256"],
      issuer: "drivebox",
      audience: "drivebox"
    });
  } catch {
    res.status(401).json({ error: "Cookie sesi tidak valid atau sudah kedaluwarsa. Silakan login kembali." });
    return null;
  }

  if (!payload || payload.username !== process.env.APP_USERNAME ||
      typeof payload.jti !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(payload.jti)) {
    res.status(401).json({ error: "Data sesi tidak valid. Silakan login kembali." });
    return null;
  }

  try {
    const active = await getSessionRedis().get(sessionKey(payload.jti));
    if (active !== "1") {
      res.status(401).json({ error: "Sesi login tidak ditemukan di Redis. Silakan login kembali." });
      return null;
    }
    return payload.username;
  } catch {
    res.status(503).json({ error: "Layanan sesi sementara tidak tersedia." });
    return null;
  }
}

async function verifyPassword(password) {
  const configError = getAuthConfigurationError();
  if (configError) throw configError;
  return bcrypt.compare(password, process.env.APP_PASSWORD_HASH);
}

module.exports = { setSession, clearSession, requireAuth, verifyPassword };
