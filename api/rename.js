const { requireAuth } = require("../lib/auth");
const { getDrive, rootFolderId, ensureFileInApp } = require("../lib/drive");
const { sendDriveError } = require("../lib/drive-error-response");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Metode tidak diizinkan." });
  const user = await requireAuth(req, res);
  if (!user) return;

  try {
    const { id, name } = req.body || {};
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{10,200}$/.test(id)) {
      return res.status(400).json({ error: "ID item tidak valid." });
    }
    if (id === rootFolderId()) {
      return res.status(400).json({ error: "Folder utama aplikasi tidak dapat diganti namanya." });
    }
    if (typeof name !== "string" || !name.trim() || name.trim().length > 100 || /[\u0000-\u001f\u007f]/.test(name)) {
      return res.status(400).json({ error: "Nama wajib diisi (maksimal 100 karakter)." });
    }

    const drive = getDrive();
    await ensureFileInApp(drive, id, user.role);
    const result = await drive.files.update({
      fileId: id,
      supportsAllDrives: true,
      requestBody: { name: name.trim() },
      fields: "id,name,mimeType,modifiedTime"
    });
    return res.status(200).json({ file: result.data });
  } catch (e) {
    return sendDriveError(res, e, "Gagal mengganti nama item di Google Drive.", "Google Drive item rename failed.");
  }
};
