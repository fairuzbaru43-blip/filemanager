const { google } = require("googleapis");
const { AccessError, ConfigurationError, InvalidInputError } = require("./configuration");

function getDrive() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new ConfigurationError("Konfigurasi server belum lengkap: GOOGLE_SERVICE_ACCOUNT_JSON.");
  let credentials;
  try { credentials = JSON.parse(raw); }
  catch { throw new ConfigurationError("GOOGLE_SERVICE_ACCOUNT_JSON harus berisi JSON service account yang valid."); }
  if (!credentials || typeof credentials.client_email !== "string" || typeof credentials.private_key !== "string") {
    throw new ConfigurationError("GOOGLE_SERVICE_ACCOUNT_JSON tidak berisi kredensial service account yang valid.");
  }
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive"]
  });
  return google.drive({ version: "v3", auth });
}

function rootFolderId() {
  const id = process.env.DRIVE_FOLDER_ID;
  if (!id) throw new ConfigurationError("Konfigurasi server belum lengkap: DRIVE_FOLDER_ID.");
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(id)) {
    throw new ConfigurationError("DRIVE_FOLDER_ID tidak valid.");
  }
  return id;
}

async function isFolderInApp(drive, folderId, root) {
  if (folderId === root) return true;
  let current = folderId;
  for (let depth = 0; depth < 50; depth++) {
    const result = await drive.files.get({ fileId: current, supportsAllDrives: true, fields: "id,mimeType,parents,trashed" });
    if (result.data.trashed || result.data.mimeType !== "application/vnd.google-apps.folder") return false;
    const parents = result.data.parents || [];
    if (parents.includes(root)) return true;
    if (!parents.length) return false;
    current = parents[0];
  }
  return false;
}

async function ensureFolderInApp(drive, folderId) {
  const root = rootFolderId();
  if (typeof folderId !== "string" || !/^[A-Za-z0-9_-]{10,200}$/.test(folderId)) {
    throw new InvalidInputError("ID folder tidak valid.");
  }
  const rootResult = await drive.files.get({ fileId: root, supportsAllDrives: true, fields: "id,mimeType,trashed" });
  if (rootResult.data.trashed || rootResult.data.mimeType !== "application/vnd.google-apps.folder") {
    throw new ConfigurationError("DRIVE_FOLDER_ID harus mengarah ke folder Google Drive yang aktif.");
  }
  if (await isFolderInApp(drive, folderId, root)) return true;
  throw new AccessError("Akses hanya diizinkan di dalam folder aplikasi.");
}

async function ensureFileInApp(drive, fileId) {
  if (typeof fileId !== "string" || !/^[A-Za-z0-9_-]{10,200}$/.test(fileId)) {
    throw new InvalidInputError("ID file tidak valid.");
  }
  const root = rootFolderId();
  const rootResult = await drive.files.get({ fileId: root, supportsAllDrives: true, fields: "id,mimeType,trashed" });
  if (rootResult.data.trashed || rootResult.data.mimeType !== "application/vnd.google-apps.folder") {
    throw new ConfigurationError("DRIVE_FOLDER_ID harus mengarah ke folder Google Drive yang aktif.");
  }
  const result = await drive.files.get({ fileId, supportsAllDrives: true, fields: "id,name,mimeType,size,parents,trashed" });
  if (result.data.trashed) throw new AccessError("Item sudah berada di Sampah.");
  const parents = result.data.parents || [];
  for (const parent of parents) {
    if (await isFolderInApp(drive, parent, root)) return result.data;
  }
  throw new AccessError("Akses hanya diizinkan untuk item di dalam folder aplikasi.");
}

module.exports = { getDrive, rootFolderId, ensureFolderInApp, ensureFileInApp };