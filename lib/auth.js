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

function logAuthError(event, error) {
  const details = {};
  const errorType = error?.name;
  details.errorType = ["Error", "TypeError", "SyntaxError", "FetchError", "RedisError", "UpstashError"].includes(errorType)
    ? errorType
    : "OtherError";
  const status = Number.isInteger(error?.status) ? error.status : error?.statusCode;
  if (Number.isInteger(status) && status >= 100 && status <= 599) details.status = status;
  console.error(event, details);
}

async function setSession(req, res, username) {
  const configError = getAuthConfigurationError();
  if (configError) throw configError;
  const role = roleForUsername(username);
  if (!role) throw new Error("Akun sesi tidak dikenal.");
  const jti = randomBytes(32).toString("base64url");
  await getSessionRedis().set(sessionKey(jti), "1", { ex: SESSION_TTL_SECONDS });
  const token = jwt.sign({ username, role, jti }, process.env.SESSION_SECRET, {
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
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`);
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

  const role = payload && typeof payload.username === "string" ? roleForUsername(payload.username) : null;
  if (!payload || !role || payload.role !== role ||
      typeof payload.jti !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(payload.jti)) {
    res.status(401).json({ error: "Data sesi tidak valid. Silakan login kembali." });
    return null;
  }

  try {
    const active = await getSessionRedis().get(sessionKey(payload.jti));
    // @upstash/redis automatically parses JSON-like strings, so Redis GET may return number 1.
    if (active !== 1 && active !== "1") {
      res.status(401).json({ error: "Sesi login tidak ditemukan di Redis. Silakan login kembali." });
      return null;
    }
    return { username: payload.username, role };
  } catch (error) {
    logAuthError("Session lookup failed.", error);
    res.status(503).json({ error: "Layanan sesi sementara tidak tersedia." });
    return null;
  }
}

function roleForUsername(username) {
  if (username === process.env.ADMIN_USERNAME) return "admin";
  if (username === process.env.USER_USERNAME) return "user";
  return null;
}

async function verifyPassword(username, password) {
  const configError = getAuthConfigurationError();
  if (configError) throw configError;
  const role = roleForUsername(username);
  const passwordHash = role === "admin" ? process.env.ADMIN_PASSWORD_HASH : process.env.USER_PASSWORD_HASH;
  const passwordValid = await bcrypt.compare(password, passwordHash || process.env.ADMIN_PASSWORD_HASH);
  return role && passwordValid ? role : null;
}

module.exports = { setSession, clearSession, requireAuth, verifyPassword, logAuthError };
