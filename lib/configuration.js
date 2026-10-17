class ConfigurationError extends Error {}
class AccessError extends Error {}
class InvalidInputError extends Error {}

const AUTH_ENVIRONMENT_VARIABLES = [
  "APP_USERNAME",
  "APP_PASSWORD_HASH",
  "SESSION_SECRET",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN"
];

function getAuthConfigurationError() {
  const missing = AUTH_ENVIRONMENT_VARIABLES.filter(name => !process.env[name]?.trim());
  if (missing.length) {
    return new ConfigurationError(`Konfigurasi server belum lengkap: ${missing.join(", ")}.`);
  }
  if (Buffer.byteLength(process.env.SESSION_SECRET, "utf8") < 32) {
    return new ConfigurationError("SESSION_SECRET harus memiliki panjang minimal 32 byte.");
  }
  if (process.env.APP_USERNAME !== process.env.APP_USERNAME.trim() || process.env.APP_USERNAME.length > 100) {
    return new ConfigurationError("APP_USERNAME harus maksimal 100 karakter dan tanpa spasi di awal atau akhir.");
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
  const hashMatch = process.env.APP_PASSWORD_HASH.match(/^\$2[aby]\$(\d{2})\$[./A-Za-z0-9]{53}$/);
  if (!hashMatch || Number(hashMatch[1]) < 10) {
    return new ConfigurationError("APP_PASSWORD_HASH bukan hash bcrypt yang valid.");
  }
  return null;
}

module.exports = { AccessError, ConfigurationError, InvalidInputError, getAuthConfigurationError };
