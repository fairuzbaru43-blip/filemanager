const { requireAuth } = require("../lib/auth");
const { getDrive, rootFolderId, ensureFileInApp, ensureFolderInApp } = require("../lib/drive");
const { InvalidInputError } = require("../lib/configuration");
const { sendDriveError } = require("../lib/drive-error-response");

const MAX_COPIED_ITEMS = 100;
const MAX_FOLDER_DEPTH = 20;
const COPY_BATCH_SIZE = 5;
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

async function listChildren(drive, folderId, role) {
  const children = [];
  let pageToken;
  do {
    const result = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      fields: "nextPageToken,files(id,name,mimeType,appProperties)"
    });
    const pageFiles = result.data.files || [];
    children.push(...(role === "admin"
      ? pageFiles
      : pageFiles.filter(file => file.appProperties?.hiddenFromUser !== "true")));
    pageToken = result.data.nextPageToken;
  } while (pageToken);
  return children;
}

async function copyItem(drive, source, parentId, context, role, depth = 0) {
  context.itemCount += 1;
  if (context.itemCount > MAX_COPIED_ITEMS) {
    throw new InvalidInputError(`Salin folder dibatasi maksimal ${MAX_COPIED_ITEMS} item sekaligus.`);
  }

  if (source.mimeType !== FOLDER_MIME_TYPE) {
    const result = await drive.files.copy({
      fileId: source.id,
      supportsAllDrives: true,
      requestBody: { name: source.name, parents: [parentId] },
      fields: "id,name,mimeType,modifiedTime"
    });
    context.createdIds.push(result.data.id);
    return result.data;
  }

  if (depth >= MAX_FOLDER_DEPTH) {
    throw new InvalidInputError(`Salin folder dibatasi maksimal kedalaman ${MAX_FOLDER_DEPTH} tingkat.`);
  }

  const folderResult = await drive.files.create({
    supportsAllDrives: true,
    requestBody: { name: source.name, mimeType: FOLDER_MIME_TYPE, parents: [parentId] },
    fields: "id,name,mimeType,modifiedTime"
  });
  const copiedFolder = folderResult.data;
  context.createdIds.push(copiedFolder.id);

  const children = await listChildren(drive, source.id, role);
  for (let start = 0; start < children.length; start += COPY_BATCH_SIZE) {
    const batch = children.slice(start, start + COPY_BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(child => copyItem(drive, child, copiedFolder.id, context, role, depth + 1)));
    const failed = results.find(result => result.status === "rejected");
    if (failed) throw failed.reason;
  }
  return copiedFolder;
}

async function trashPartialCopy(drive, createdIds) {
  for (let end = createdIds.length; end > 0; end -= COPY_BATCH_SIZE) {
    const start = Math.max(0, end - COPY_BATCH_SIZE);
    const batch = createdIds.slice(start, end);
    await Promise.allSettled(batch.map(fileId => drive.files.update({
      fileId,
      supportsAllDrives: true,
      requestBody: { trashed: true }
    })));
  }
}

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
    if (result.data.trashed || result.data.mimeType !== FOLDER_MIME_TYPE) return false;
    current = (result.data.parents || [])[0];
    if (!current) return false;
  }
  return false;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Metode tidak diizinkan." });
  const user = await requireAuth(req, res);
  if (!user) return;

  let drive;
  const createdIds = [];
  try {
    const { id, parentId } = req.body || {};
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{10,200}$/.test(id) ||
        typeof parentId !== "string" || !/^[A-Za-z0-9_-]{10,200}$/.test(parentId)) {
      return res.status(400).json({ error: "ID item atau folder tujuan tidak valid." });
    }

    const rootId = rootFolderId();
    if (id === rootId) return res.status(400).json({ error: "Folder utama aplikasi tidak dapat disalin." });
    drive = getDrive();
    const source = await ensureFileInApp(drive, id, user.role);
    await ensureFolderInApp(drive, parentId, user.role);
    if (source.mimeType === FOLDER_MIME_TYPE && await destinationIsInsideSourceFolder(drive, id, parentId, rootId)) {
      throw new InvalidInputError("Folder tidak dapat disalin ke dalam dirinya sendiri atau folder turunannya.");
    }

    const context = { itemCount: 0, createdIds };
    const copied = await copyItem(drive, source, parentId, context, user.role);
    return res.status(201).json({ file: copied, copiedItems: context.itemCount });
  } catch (e) {
    if (drive && createdIds.length) await trashPartialCopy(drive, createdIds);
    return sendDriveError(res, e, "Gagal menyalin item di Google Drive.", "Google Drive item copy failed.");
  }
};
