const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { getAuthConfigurationError } = require("./configuration");

const COOKIE_NAME = "fm_session";

function cookieOptions() {
  const secure = process.env.NODE_ENV === "production";
  return `HttpOnly; Path=/; SameSite=Strict; Max-Age=28800${secure ? "; Secure" : ""}`;
}

function setSession(res, username) {
  const configError = getAuthConfigurationError();
  if (configError) throw configError;
  const token = jwt.sign({ username }, process.env.SESSION_SECRET, {
    algorithm: "HS256",
    expiresIn: "8h",
    issuer: "drivebox",
    audience: "drivebox"
  });
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=${token}; ${cookieOptions()}`);
}

function clearSession(res) {
  res.setHeader("Cache-Control", "no-store");
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0${secure}`);
}

function getCookie(req, name) {
  const header = req.headers.cookie || "";
  const part = header.split(";").map(v => v.trim()).find(v => v.startsWith(name + "="));
  return part ? part.slice(name.length + 1) : "";
}

function requireAuth(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const configError = getAuthConfigurationError();
    if (configError) throw configError;
    const token = getCookie(req, COOKIE_NAME);
    if (!token) throw new Error("missing");
    const payload = jwt.verify(token, process.env.SESSION_SECRET, {
      algorithms: ["HS256"],
      issuer: "drivebox",
      audience: "drivebox"
    });
    if (!payload || payload.username !== process.env.APP_USERNAME) throw new Error("invalid");
    return payload.username;
  } catch {
    const configError = getAuthConfigurationError();
    if (configError) {
      res.status(503).json({ error: configError.message });
      return null;
    }
    res.status(401).json({ error: "Sesi habis atau belum login. Silakan login kembali." });
    return null;
  }
}

async function verifyPassword(password) {
  const configError = getAuthConfigurationError();
  if (configError) throw configError;
  return bcrypt.compare(password, process.env.APP_PASSWORD_HASH);
}

module.exports = { setSession, clearSession, requireAuth, verifyPassword };