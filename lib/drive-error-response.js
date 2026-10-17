const { AccessError, ConfigurationError, InvalidInputError } = require("./configuration");

const safeDriveReasons = new Set([
  "accessNotConfigured",
  "authError",
  "insufficientFilePermissions",
  "insufficientPermissions",
  "notFound",
  "rateLimitExceeded",
  "teamDriveFileNotFound",
  "userRateLimitExceeded"
]);

function getDriveStatus(error) {
  const candidates = [error?.response?.status, error?.status, error?.code];
  return candidates.find(status => Number.isInteger(status) && status >= 100 && status <= 599);
}

function getDriveReason(error) {
  const reasons = error?.response?.data?.error?.errors;
  if (!Array.isArray(reasons)) return undefined;
  return reasons.find(item => safeDriveReasons.has(item?.reason))?.reason;
}

function getDriveErrorMessage(status, reason, fallback) {
  if (reason === "accessNotConfigured") {
    return "Google Drive API belum aktif pada project Google Cloud service account.";
  }
  if (reason === "authError" || status === 401) {
    return "Google menolak autentikasi. Periksa GOOGLE_SERVICE_ACCOUNT_JSON dan pastikan key masih aktif.";
  }
  if (reason === "insufficientFilePermissions" || reason === "insufficientPermissions") {
    return "Service account belum memiliki akses ke folder Drive. Bagikan folder ke email client_email dari JSON yang dipasang.";
  }
  if (reason === "notFound" || reason === "teamDriveFileNotFound" || status === 404) {
    return "Folder atau file tidak ditemukan. Periksa DRIVE_FOLDER_ID dan izin service account.";
  }
  if (reason === "rateLimitExceeded" || reason === "userRateLimitExceeded" || status === 429) {
    return "Batas permintaan Google Drive tercapai. Coba lagi beberapa saat.";
  }
  if (status === 403) {
    return "Google Drive menolak akses. Pastikan Drive API aktif dan folder dibagikan ke service account.";
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
