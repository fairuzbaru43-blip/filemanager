const { requireAuth } = require("../lib/auth");
const { getDrive, rootFolderId, ensureFileInApp } = require("../lib/drive");
const { sendDriveError } = require("../lib/drive-error-response");

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Metode tidak diizinkan." });
  const user = await requireAuth(req, res);
  if (!user) return;
  if (user.role !== "admin") return res.status(403).json({ error: "Hanya admin yang dapat mengatur folder privat." });

  try {
    const { id, hidden } = req.body || {};
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{10,200}$/.test(id) ||
        typeof hidden !== "boolean" || id === rootFolderId()) {
      return res.status(400).json({ error: "Folder atau pengaturan privasi tidak valid." });
    }

    const drive = getDrive();
    const folder = await ensureFileInApp(drive, id, user.role);
    if (folder.mimeType !== FOLDER_MIME_TYPE) {
      return res.status(400).json({ error: "Privasi hanya dapat diatur pada folder." });
    }
    const result = await drive.files.update({
      fileId: id,
      supportsAllDrives: true,
      requestBody: {
        appProperties: {
          ...(folder.appProperties || {}),
          hiddenFromUser: String(hidden)
        }
      },
      fields: "id,appProperties"
    });
    return res.status(200).json({ hidden: result.data.appProperties?.hiddenFromUser === "true" });
  } catch (error) {
    return sendDriveError(res, error, "Gagal mengubah privasi folder.", "Google Drive folder visibility update failed.");
  }
};
