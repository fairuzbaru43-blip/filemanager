const { AccessError, ConfigurationError, InvalidInputError } = require("./configuration");

const safeDriveReasons = new Set([
  "accessNotConfigured",
  "authError",
  "invalid_grant",
  "insufficientFilePermissions",
  "insufficientPermissions",
  "notFound",
  "rateLimitExceeded",
  "storageQuotaExceeded",
  "teamDriveFileNotFound",
  "userRateLimitExceeded"
]);

function getDriveStatus(error) {
  const candidates = [error?.response?.status, error?.status, error?.code];
  return candidates.find(status => Number.isInteger(status) && status >= 100 && status <= 599);
}

function getDriveReason(error) {
  if (error?.response?.data?.error === "invalid_grant") return "invalid_grant";
  const reasons = error?.response?.data?.error?.errors;
  if (!Array.isArray(reasons)) return undefined;
  return reasons.find(item => safeDriveReasons.has(item?.reason))?.reason;
}

function getDriveErrorMessage(status, reason, fallback) {
  if (reason === "accessNotConfigured") {
    return "Google Drive API belum aktif pada project Google Cloud yang dipakai kredensial aplikasi.";
  }
  if (reason === "authError" || status === 401) {
    return "Google menolak autentikasi. Periksa kredensial Google Drive di Vercel dan izinkan kembali akses akun jika diminta.";
  }
  if (reason === "invalid_grant") {
    return "Akses OAuth Google sudah kedaluwarsa atau dicabut. Buat ulang refresh token dan perbarui nilai OAuth di Vercel.";
  }
  if (reason === "insufficientFilePermissions" || reason === "insufficientPermissions") {
    return "Akun Google yang terhubung ke aplikasi belum memiliki izin untuk folder ini.";
  }
  if (reason === "notFound" || reason === "teamDriveFileNotFound" || status === 404) {
    return "Folder atau file tidak ditemukan. Periksa DRIVE_FOLDER_ID dan izin service account.";
  }
  if (reason === "rateLimitExceeded" || reason === "userRateLimitExceeded" || status === 429) {
    return "Batas permintaan Google Drive tercapai. Coba lagi beberapa saat.";
  }
  if (reason === "storageQuotaExceeded") {
    return "Kuota Drive akun Google penuh. Kosongkan ruang Drive, Gmail, atau Photos lalu coba lagi.";
  }
  if (status === 403) {
    return "Google Drive menolak akses. Periksa izin akun Google yang terhubung dan status Drive API.";
  }
  return fallback;
}

function logDriveError(event, error, status, reason) {
  const knownErrorTypes = ["Error", "TypeError", "SyntaxError", "GaxiosError", "GoogleAuthError"];
  const details = {
    errorType: knownErrorTypes.includes(error?.name) ? error.name : "OtherError"
  };
  if (status !== undefined) details.status = status;
  if (reason) details.reason = reason;
  // Do not log upstream messages, request URLs, headers, or response bodies; they may contain credentials.
  console.error(event, details);
}

function sendDriveError(res, error, genericMessage, logMessage) {
  if (error instanceof ConfigurationError) return res.status(503).json({ error: error.message });
  if (error instanceof InvalidInputError) return res.status(400).json({ error: error.message });
  if (error instanceof AccessError) return res.status(403).json({ error: error.message });
  const status = getDriveStatus(error);
  const reason = getDriveReason(error);
  logDriveError(logMessage, error, status, reason);
  return res.status(status === 429 ? 429 : status === 401 || status === 403 || status === 404 ? status : 500)
    .json({ error: getDriveErrorMessage(status, reason, genericMessage) });
}

module.exports = { sendDriveError };
