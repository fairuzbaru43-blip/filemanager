const { requireAuth } = require("../lib/auth");
const { getDrive, ensureFileInApp } = require("../lib/drive");
const { sendDriveError } = require("../lib/drive-error-response");

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

const exportsByMimeType = {
  "application/vnd.google-apps.document": { mimeType: "application/pdf", extension: ".pdf" },
  "application/vnd.google-apps.spreadsheet": {
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extension: ".xlsx"
  },
  "application/vnd.google-apps.presentation": {
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    extension: ".pptx"
  },
  "application/vnd.google-apps.drawing": { mimeType: "application/pdf", extension: ".pdf" }
};

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Metode tidak diizinkan." });
  if (!await requireAuth(req, res)) return;
  try {
    const id = req.query.id;
    if (typeof id !== "string" || !id) return res.status(400).json({ error: "ID file atau folder wajib diisi." });
    const drive = getDrive();
    const meta = await ensureFileInApp(drive, id);
    if (meta.mimeType === FOLDER_MIME_TYPE) {
      return res.status(400).json({ error: "Unduhan folder tidak tersedia. Unduh file satu per satu." });
    }
    const exportFormat = exportsByMimeType[meta.mimeType];
    if (meta.mimeType.startsWith("application/vnd.google-apps.") && !exportFormat) {
      return res.status(415).json({ error: "Jenis file Google ini harus diunduh dari Google Drive." });
    }
    const result = exportFormat
      ? await drive.files.export({ fileId: id, mimeType: exportFormat.mimeType }, { responseType: "stream" })
      : await drive.files.get({ fileId: id, supportsAllDrives: true, alt: "media" }, { responseType: "stream" });
    const originalName = String(meta.name || "download");
    const name = exportFormat && !originalName.toLowerCase().endsWith(exportFormat.extension)
      ? `${originalName}${exportFormat.extension}`
      : originalName;
    const safeName = String(name).replace(/["\r\n]/g, "_");
    res.setHeader("Content-Type", exportFormat?.mimeType || meta.mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`);
    result.data.on("error", () => {
      if (!res.headersSent) res.status(500).end("Download gagal.");
      else res.destroy();
    });
    result.data.pipe(res);
  } catch (e) {
    return sendDriveError(res, e, "Gagal mengunduh file.", "Google Drive file download failed.");
  }
};
