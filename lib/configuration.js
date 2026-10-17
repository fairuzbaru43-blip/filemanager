class ConfigurationError extends Error {}
class AccessError extends Error {}
class InvalidInputError extends Error {}

function getAuthConfigurationError() {
  const missing = ["APP_USERNAME", "APP_PASSWORD_HASH", "SESSION_SECRET", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]
    .filter(name => !process.env[name]);
  if (missing.length) {
    return new ConfigurationError(`Konfigurasi server belum lengkap: ${missing.join(", ")}.`);
  }
  if (Buffer.byteLength(process.env.SESSION_SECRET, "utf8") < 32) {
    return new ConfigurationError("SESSION_SECRET harus memiliki panjang minimal 32 byte.");
  }
  const hashMatch = process.env.APP_PASSWORD_HASH.match(/^\$2[aby]\$(\d{2})\$[./A-Za-z0-9]{53}$/);
  if (!hashMatch || Number(hashMatch[1]) < 10) {
    return new ConfigurationError("APP_PASSWORD_HASH bukan hash bcrypt yang valid.");
  }
  return null;
}

module.exports = { AccessError, ConfigurationError, InvalidInputError, getAuthConfigurationError };
