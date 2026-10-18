const { requireAuth } = require("../lib/auth");
const { getDrive, ensureFileInApp } = require("../lib/drive");
const { InvalidInputError } = require("../lib/configuration");
const { sendDriveError } = require("../lib/drive-error-response");
const { Readable } = require("node:stream");
const { createZipStream } = require("../lib/zip-stream");

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const MAX_ZIP_ENTRIES = 60000;
const MAX_FOLDER_DEPTH = 100;

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

function safeZipSegment(name) {
  const safe = String(name || "tanpa-nama")
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "_")
    .replace(/^\.+$/, "_");
  return safe || "tanpa-nama";
}

async function collectFolderEntries(drive, folderId, prefix, context, depth = 0) {
  if (depth > MAX_FOLDER_DEPTH) throw new InvalidInputError("Struktur folder terlalu dalam untuk dibuat ZIP.");
  let pageToken;
  do {
    const result = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      fields: "nextPageToken,files(id,name,mimeType,size,capabilities(canDownload))"
    });
    for (const item of result.data.files || []) {
      const name = safeZipSegment(item.name);
      const itemPath = `${prefix}${name}`;
      if (item.mimeType === FOLDER_MIME_TYPE) {
        const directoryPath = `${itemPath}/`;
        context.entries.push({ path: directoryPath, directory: true });
        if (context.entries.length > MAX_ZIP_ENTRIES) {
          throw new InvalidInputError(`Folder berisi terlalu banyak item untuk satu ZIP (maksimal ${MAX_ZIP_ENTRIES}).`);
        }
        await collectFolderEntries(drive, item.id, directoryPath, context, depth + 1);
        continue;
      }

      const exportFormat = exportsByMimeType[item.mimeType];
      if (item.mimeType?.startsWith("application/vnd.google-apps.") && !exportFormat) {
        context.unsupported.push(itemPath);
        continue;
      }
      if (item.capabilities?.canDownload === false) {
        context.unsupported.push(itemPath);
        continue;
      }

      const path = exportFormat && !itemPath.toLowerCase().endsWith(exportFormat.extension)
        ? `${itemPath}${exportFormat.extension}`
        : itemPath;
      context.entries.push({
        path,
        id: item.id,
        mimeType: item.mimeType,
        exportFormat,
        directory: false
      });
      if (context.entries.length > MAX_ZIP_ENTRIES) {
        throw new InvalidInputError(`Folder berisi terlalu banyak item untuk satu ZIP (maksimal ${MAX_ZIP_ENTRIES}).`);
      }
    }
    pageToken = result.data.nextPageToken;
  } while (pageToken);
}

async function downloadFolderZip(drive, meta, res) {
  const rootPath = `${safeZipSegment(meta.name)}/`;
  const context = { entries: [{ path: rootPath, directory: true }], unsupported: [] };
  await collectFolderEntries(drive, meta.id, rootPath, context);
  if (context.unsupported.length) {
    const names = context.unsupported.slice(0, 3).join(", ");
    const more = context.unsupported.length > 3 ? ` dan ${context.unsupported.length - 3} item lainnya` : "";
    return res.status(415).json({ error: `Folder berisi item yang tidak dapat diunduh melalui aplikasi: ${names}${more}.` });
  }

  const zipName = `${safeZipSegment(meta.name)}.zip`;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`);

  const zipStream = Readable.from(context.entries.length
    ? createZipStream(context.entries, async entry => {
      const result = entry.exportFormat
        ? await drive.files.export({ fileId: entry.id, mimeType: entry.exportFormat.mimeType }, { responseType: "stream" })
        : await drive.files.get({ fileId: entry.id, supportsAllDrives: true, alt: "media" }, { responseType: "stream" });
      return result.data;
    })
    : []);
  zipStream.on("error", error => {
    if (res.headersSent) {
      const knownErrorTypes = ["Error", "TypeError", "GaxiosError", "GoogleAuthError"];
      console.error("Google Drive folder ZIP stream failed.", {
        errorType: knownErrorTypes.includes(error?.name) ? error.name : "OtherError"
      });
      res.destroy(error);
      return;
    }
    sendDriveError(res, error, "Gagal membuat ZIP folder Google Drive.", "Google Drive folder ZIP download failed.");
  });
  res.on("close", () => { if (!res.writableEnded && !zipStream.destroyed) zipStream.destroy(); });
  zipStream.pipe(res);
}

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Metode tidak diizinkan." });
  if (!await requireAuth(req, res)) return;
  try {
    const id = req.query.id;
    if (typeof id !== "string" || !id) return res.status(400).json({ error: "ID file atau folder wajib diisi." });
    const drive = getDrive();
    const meta = await ensureFileInApp(drive, id);
    if (meta.mimeType === FOLDER_MIME_TYPE) return await downloadFolderZip(drive, meta, res);
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
