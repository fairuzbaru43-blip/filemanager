const { requireAuth } = require("../lib/auth");
const { getDrive, rootFolderId, ensureFolderInApp } = require("../lib/drive");
const { sendDriveError } = require("../lib/drive-error-response");

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Metode tidak diizinkan." });
  const user = await requireAuth(req, res);
  if (!user) return;
  try {
    const drive = getDrive();
    if (req.query.parentId !== undefined && typeof req.query.parentId !== "string") {
      return res.status(400).json({ error: "ID folder tidak valid." });
    }
    const parentId = typeof req.query.parentId === "string" ? req.query.parentId : rootFolderId();
    await ensureFolderInApp(drive, parentId, user.role);
    const result = await drive.files.list({
      q: `'${parentId}' in parents and trashed = false`,
      pageSize: 100,
      orderBy: "folder,name",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      fields: "files(id,name,mimeType,size,modifiedTime,webViewLink,iconLink,appProperties)"
    });
    res.setHeader("Cache-Control", "no-store");
    const files = result.data.files || [];
    return res.status(200).json({
      files: user.role === "admin"
        ? files
        : files.filter(file => file.appProperties?.hiddenFromUser !== "true"),
      rootId: rootFolderId()
    });
  } catch (e) {
    return sendDriveError(res, e, "Gagal membaca Google Drive. Periksa folder dan izin service account.", "Google Drive file listing failed.");
  }
};
