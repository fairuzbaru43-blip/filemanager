const { requireAuth } = require("../lib/auth");
const { getDrive, rootFolderId, ensureFileInApp } = require("../lib/drive");
const { sendDriveError } = require("../lib/drive-error-response");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Metode tidak diizinkan." });
  if (!requireAuth(req, res)) return;
  try {
    const { id } = req.body || {};
    if (typeof id !== "string" || !id || id === rootFolderId()) return res.status(400).json({ error: "ID file tidak valid." });
    const drive = getDrive();
    await ensureFileInApp(drive, id);
    await drive.files.update({ fileId: id, supportsAllDrives: true, requestBody: { trashed: true } });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return sendDriveError(res, e, "Gagal memindahkan file ke sampah.", "Google Drive item deletion failed.");
  }
};