const { requireAuth } = require("../lib/auth");
const { getDrive, rootFolderId, ensureFolderInApp } = require("../lib/drive");
const { sendDriveError } = require("../lib/drive-error-response");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Metode tidak diizinkan." });
  if (!await requireAuth(req, res)) return;
  try {
    const { name, parentId } = req.body || {};
    if (typeof name !== "string" || !name.trim() || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) {
      return res.status(400).json({ error: "Nama folder wajib diisi (maksimal 100 karakter)." });
    }
    if (parentId !== null && parentId !== undefined && typeof parentId !== "string") {
      return res.status(400).json({ error: "ID folder induk tidak valid." });
    }
    const parent = typeof parentId === "string" ? parentId : rootFolderId();
    const drive = getDrive();
    await ensureFolderInApp(drive, parent);
    const result = await drive.files.create({
      supportsAllDrives: true,
      requestBody: { name: name.trim(), mimeType: "application/vnd.google-apps.folder", parents: [parent] },
      fields: "id,name,mimeType,modifiedTime"
    });
    return res.status(201).json({ file: result.data });
  } catch (e) {
    return sendDriveError(res, e, "Gagal membuat folder di Google Drive.", "Google Drive folder creation failed.");
  }
};
