class ConfigurationError extends Error {}
class AccessError extends Error {}
class InvalidInputError extends Error {}

const AUTH_ENVIRONMENT_VARIABLES = [
  "ADMIN_USERNAME",
  "ADMIN_PASSWORD_HASH",
  "USER_USERNAME",
  "USER_PASSWORD_HASH",
  "SESSION_SECRET",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN"
];

function getPasswordHashError(name, value) {
  const hashMatch = value.match(/^\$2[aby]\$(\d{2})\$[./A-Za-z0-9]{53}$/);
  if (!hashMatch || Number(hashMatch[1]) < 10) {
    return new ConfigurationError(`${name} bukan hash bcrypt yang valid.`);
  }
  return null;
}

function getAuthConfigurationError() {
  const missing = AUTH_ENVIRONMENT_VARIABLES.filter(name => !process.env[name]?.trim());
  if (missing.length) {
    return new ConfigurationError(`Konfigurasi server belum lengkap: ${missing.join(", ")}.`);
  }
  if (Buffer.byteLength(process.env.SESSION_SECRET, "utf8") < 32) {
    return new ConfigurationError("SESSION_SECRET harus memiliki panjang minimal 32 byte.");
  }
  for (const name of ["ADMIN_USERNAME", "USER_USERNAME"]) {
    const username = process.env[name];
    if (username !== username.trim() || username.length > 100) {
      return new ConfigurationError(`${name} harus maksimal 100 karakter dan tanpa spasi di awal atau akhir.`);
    }
  }
  if (process.env.ADMIN_USERNAME.toLowerCase() === process.env.USER_USERNAME.toLowerCase()) {
    return new ConfigurationError("ADMIN_USERNAME dan USER_USERNAME harus berbeda.");
  }
  let redisUrl;
  const redisUrlValue = process.env.UPSTASH_REDIS_REST_URL;
  if (redisUrlValue !== redisUrlValue.trim()) {
    return new ConfigurationError("UPSTASH_REDIS_REST_URL tidak boleh memiliki spasi di awal atau akhir.");
  }
  try {
    redisUrl = new URL(redisUrlValue);
  } catch {
    return new ConfigurationError("UPSTASH_REDIS_REST_URL harus berupa URL REST Upstash yang valid.");
  }
  if (redisUrl.protocol !== "https:" || !redisUrl.hostname || redisUrl.username || redisUrl.password) {
    return new ConfigurationError("UPSTASH_REDIS_REST_URL harus berupa URL HTTPS yang valid.");
  }
  if (process.env.UPSTASH_REDIS_REST_TOKEN !== process.env.UPSTASH_REDIS_REST_TOKEN.trim()) {
    return new ConfigurationError("UPSTASH_REDIS_REST_TOKEN tidak boleh memiliki spasi di awal atau akhir.");
  }
  return getPasswordHashError("ADMIN_PASSWORD_HASH", process.env.ADMIN_PASSWORD_HASH) ||
    getPasswordHashError("USER_PASSWORD_HASH", process.env.USER_PASSWORD_HASH);
}

module.exports = { AccessError, ConfigurationError, InvalidInputError, getAuthConfigurationError };
