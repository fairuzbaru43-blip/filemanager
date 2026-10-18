const { requireAuth } = require("../lib/auth");
const { getDrive, rootFolderId, ensureFileInApp, ensureNoHiddenDescendants } = require("../lib/drive");
const { sendDriveError } = require("../lib/drive-error-response");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Metode tidak diizinkan." });
  const user = await requireAuth(req, res);
  if (!user) return;
  try {
    const { id } = req.body || {};
    if (typeof id !== "string" || !id || id === rootFolderId()) return res.status(400).json({ error: "ID file tidak valid." });
    const drive = getDrive();
    const item = await ensureFileInApp(drive, id, user.role);
    if (item.mimeType === "application/vnd.google-apps.folder") {
      await ensureNoHiddenDescendants(drive, id, user.role);
    }
    await drive.files.update({ fileId: id, supportsAllDrives: true, requestBody: { trashed: true } });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return sendDriveError(res, e, "Gagal memindahkan file ke sampah.", "Google Drive item deletion failed.");
  }
};
