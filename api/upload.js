const { requireAuth } = require("../lib/auth");
const { getDrive, driveRequest, rootFolderId, ensureFolderInApp } = require("../lib/drive");
const { sendDriveError } = require("../lib/drive-error-response");
const { Readable } = require("node:stream");

const MAX_BYTES = 1024 * 1024 * 1024;
const MAX_SINGLE_UPLOAD_BYTES = 3 * 1024 * 1024;
const MAX_CHUNK_BYTES = 3 * 1024 * 1024;
const RESUMABLE_CHUNK_ALIGNMENT = 256 * 1024;
const GOOGLE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";

function validateName(name) {
  return typeof name === "string" && !!name.trim() && name.length <= 200 &&
    !/[\u0000-\u001f\u007f]/.test(name);
}

function validateParentId(parentId) {
  return parentId === null || parentId === undefined || typeof parentId === "string";
}

function safeMimeType(mimeType) {
  return typeof mimeType === "string" && /^[\w.+-]+\/[\w.+-]+$/.test(mimeType)
    ? mimeType
    : "application/octet-stream";
}

function decodeBase64(data, maxBytes) {
  if (typeof data !== "string" || data.length > Math.ceil(maxBytes / 3) * 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
    return null;
  }
  const buffer = Buffer.from(data, "base64");
  return buffer.toString("base64") === data && buffer.length <= maxBytes ? buffer : null;
}

function validateUploadUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.origin !== "https://www.googleapis.com" ||
      url.pathname !== "/upload/drive/v3/files" ||
      url.searchParams.get("uploadType") !== "resumable" ||
      !url.searchParams.has("upload_id") ||
      url.username || url.password || url.hash) {
    return null;
  }
  return url.href;
}

function getResponseHeader(headers, name) {
  if (typeof headers?.get === "function") return headers.get(name);
  return headers?.[name] || headers?.[name.toLowerCase()];
}

async function startResumableUpload(req, res, drive) {
  const { name, mimeType, size, parentId } = req.body || {};
  if (!validateName(name) || !Number.isSafeInteger(size) || size < 1 ||
      !validateParentId(parentId)) {
    return res.status(400).json({ error: "Data upload tidak valid." });
  }
  if (size > MAX_BYTES) return res.status(413).json({ error: "Ukuran maksimal 1 GB per file." });

  const parent = typeof parentId === "string" ? parentId : rootFolderId();
  await ensureFolderInApp(drive, parent);
  const uploadUrl = new URL(GOOGLE_UPLOAD_URL);
  uploadUrl.searchParams.set("uploadType", "resumable");
  uploadUrl.searchParams.set("supportsAllDrives", "true");
  uploadUrl.searchParams.set("fields", "id,name,mimeType,size,modifiedTime,webViewLink");
  const response = await driveRequest(drive, {
    url: uploadUrl.href,
    method: "POST",
    data: { name: name.trim(), parents: [parent] },
    headers: {
      "Content-Type": "application/json",
      "X-Upload-Content-Type": safeMimeType(mimeType),
      "X-Upload-Content-Length": String(size)
    }
  });
  const sessionUrl = validateUploadUrl(getResponseHeader(response.headers, "location"));
  if (!sessionUrl) throw new Error("Google Drive tidak mengembalikan sesi upload yang valid.");
  return res.status(200).json({ uploadUrl: sessionUrl });
}

async function uploadResumableChunk(req, res, drive) {
  const { data, mimeType, offset, size, uploadUrl: rawUploadUrl } = req.body || {};
  const uploadUrl = validateUploadUrl(rawUploadUrl);
  const chunk = decodeBase64(data, MAX_CHUNK_BYTES);
  if (!uploadUrl || !chunk || chunk.length === 0 ||
      !Number.isSafeInteger(offset) || offset < 0 ||
      !Number.isSafeInteger(size) || size < 1 || size > MAX_BYTES ||
      offset + chunk.length > size || offset % RESUMABLE_CHUNK_ALIGNMENT !== 0 ||
      (offset + chunk.length < size && chunk.length % RESUMABLE_CHUNK_ALIGNMENT !== 0)) {
    return res.status(400).json({ error: "Data potongan upload tidak valid." });
  }

  const lastByte = offset + chunk.length - 1;
  const response = await driveRequest(drive, {
    url: uploadUrl,
    method: "PUT",
    data: chunk,
    headers: {
      "Content-Type": safeMimeType(mimeType),
      "Content-Length": String(chunk.length),
      "Content-Range": `bytes ${offset}-${lastByte}/${size}`
    },
    validateStatus: status => (status >= 200 && status < 300) || status === 308
  });
  if (response.status === 308) return res.status(202).json({ complete: false });
  if (offset + chunk.length !== size || !response.data?.id) {
    throw new Error("Google Drive menyelesaikan upload dengan respons yang tidak valid.");
  }
  return res.status(200).json({ complete: true, file: response.data });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Metode tidak diizinkan." });
  if (!await requireAuth(req, res)) return;
  try {
    const { action, name, mimeType, data, parentId } = req.body || {};
    const drive = getDrive();
    if (action === "start") return await startResumableUpload(req, res, drive);
    if (action === "chunk") return await uploadResumableChunk(req, res, drive);

    if (!validateName(name) || !validateParentId(parentId)) {
      return res.status(400).json({ error: "Data upload tidak valid." });
    }
    const buffer = decodeBase64(data, MAX_SINGLE_UPLOAD_BYTES);
    if (!buffer) return res.status(413).json({ error: "Upload satu request maksimal 3 MB; gunakan upload potongan untuk file lebih besar." });
    const parent = typeof parentId === "string" ? parentId : rootFolderId();
    await ensureFolderInApp(drive, parent);
    const created = await drive.files.create({
      supportsAllDrives: true,
      requestBody: { name: name.trim(), parents: [parent] },
      media: { mimeType: safeMimeType(mimeType), body: Readable.from(buffer) },
      fields: "id,name,mimeType,size,modifiedTime,webViewLink"
    });
    return res.status(201).json({ file: created.data });
  } catch (e) {
    return sendDriveError(res, e, "Upload gagal. Periksa koneksi, ukuran file, dan izin Drive.", "Google Drive file upload failed.");
  }
};
