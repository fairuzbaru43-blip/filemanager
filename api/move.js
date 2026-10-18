const { requireAuth } = require("../lib/auth");
const { getDrive, rootFolderId, ensureFileInApp, ensureFolderInApp } = require("../lib/drive");
const { InvalidInputError } = require("../lib/configuration");
const { sendDriveError } = require("../lib/drive-error-response");

async function destinationIsInsideSourceFolder(drive, sourceId, destinationId, rootId) {
  let current = destinationId;
  const visited = new Set();
  for (let depth = 0; depth < 50; depth++) {
    if (current === sourceId) return true;
    if (current === rootId || visited.has(current)) return false;
    visited.add(current);
    const result = await drive.files.get({
      fileId: current,
      supportsAllDrives: true,
      fields: "id,mimeType,parents,trashed"
    });
    if (result.data.trashed || result.data.mimeType !== "application/vnd.google-apps.folder") return false;
    current = (result.data.parents || [])[0];
    if (!current) return false;
  }
  return false;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Metode tidak diizinkan." });
  if (!await requireAuth(req, res)) return;

  try {
    const { id, parentId } = req.body || {};
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{10,200}$/.test(id) ||
        typeof parentId !== "string" || !/^[A-Za-z0-9_-]{10,200}$/.test(parentId)) {
      return res.status(400).json({ error: "ID item atau folder tujuan tidak valid." });
    }

    const rootId = rootFolderId();
    if (id === rootId) return res.status(400).json({ error: "Folder utama aplikasi tidak dapat dipindahkan." });
    const drive = getDrive();
    const item = await ensureFileInApp(drive, id);
    await ensureFolderInApp(drive, parentId);
    if ((item.parents || []).includes(parentId)) return res.status(200).json({ ok: true, unchanged: true });

    if (item.mimeType === "application/vnd.google-apps.folder" &&
        await destinationIsInsideSourceFolder(drive, id, parentId, rootId)) {
      throw new InvalidInputError("Folder tidak dapat dipindahkan ke dalam dirinya sendiri atau folder turunannya.");
    }

    await drive.files.update({
      fileId: id,
      addParents: parentId,
      removeParents: (item.parents || []).join(","),
      supportsAllDrives: true,
      fields: "id,name,mimeType,parents,modifiedTime"
    });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return sendDriveError(res, e, "Gagal memindahkan item di Google Drive.", "Google Drive item move failed.");
  }
};
