const { requireAuth } = require("../lib/auth");
const { getDrive, rootFolderId, ensureFolderInApp } = require("../lib/drive");
const { sendDriveError } = require("../lib/drive-error-response");
const { Readable } = require("node:stream");

const MAX_BYTES = 3 * 1024 * 1024;

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Metode tidak diizinkan." });
  if (!await requireAuth(req, res)) return;
  try {
    const { name, mimeType, data, parentId } = req.body || {};
    if (typeof name !== "string" || !name.trim() || name.length > 200 ||
        /[\u0000-\u001f\u007f]/.test(name) || typeof data !== "string" ||
        data.length > Math.ceil(MAX_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
      return res.status(400).json({ error: "Data upload tidak valid." });
    }
    const buffer = Buffer.from(data, "base64");
    if (buffer.toString("base64") !== data) return res.status(400).json({ error: "Data upload tidak valid." });
    if (buffer.length > MAX_BYTES) return res.status(413).json({ error: "Ukuran maksimal 3 MB untuk versi pemula ini." });
    if (parentId !== null && parentId !== undefined && typeof parentId !== "string") {
      return res.status(400).json({ error: "ID folder induk tidak valid." });
    }
    const parent = typeof parentId === "string" ? parentId : rootFolderId();
    const drive = getDrive();
    await ensureFolderInApp(drive, parent);
    const safeMimeType = typeof mimeType === "string" && /^[\w.+-]+\/[\w.+-]+$/.test(mimeType)
      ? mimeType
      : "application/octet-stream";
    const created = await drive.files.create({
      supportsAllDrives: true,
      requestBody: { name: name.trim(), parents: [parent] },
      media: { mimeType: safeMimeType, body: Readable.from(buffer) },
      fields: "id,name,mimeType,size,modifiedTime,webViewLink"
    });
    return res.status(201).json({ file: created.data });
  } catch (e) {
    return sendDriveError(res, e, "Upload gagal. Periksa koneksi, ukuran file, dan izin Drive.", "Google Drive file upload failed.");
  }
};
