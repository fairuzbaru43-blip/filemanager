const $ = (id) => document.getElementById(id);
let currentParent = null;
let rootId = null;
let allFiles = [];
let crumbs = [];
let sortOrder = "name-asc";
const nameCollator = new Intl.Collator("id", { numeric: true, sensitivity: "base" });
let folderTreeCache = new Map();
let expandedFolderIds = new Set();
let authFlowVersion = 0;
let clipboardItem = null;
let currentRole = null;

async function api(path, options = {}) {
  const res = await fetch(`/api/${path}`, {
    credentials: "same-origin",
    ...options,
    headers: { ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || `Permintaan gagal (${res.status})`);
    error.status = res.status;
    throw error;
  }
  return data;
}
function showNotice(text, error = false) {
  const el = $("notice"); el.textContent = text; el.classList.remove("hidden", "error");
  if (error) el.classList.add("error");
}
function clearNotice() { $("notice").classList.add("hidden"); }
function hideContextMenu() { $("contextMenu").classList.add("hidden"); }
function addContextAction(menu, label, action) {
  const button = document.createElement("button");
  button.type = "button"; button.className = "context-menu-item"; button.textContent = label;
  button.setAttribute("role", "menuitem");
  button.addEventListener("click", async () => { hideContextMenu(); await action(); });
  menu.append(button);
}
function addContextSeparator(menu) {
  const separator = document.createElement("div"); separator.className = "context-menu-separator";
  menu.append(separator);
}
function showContextMenu(event, file = null) {
  event.preventDefault();
  const menu = $("contextMenu");
  menu.replaceChildren();
  const folder = file?.mimeType === "application/vnd.google-apps.folder";
  const destinationId = folder ? file.id : (currentParent || rootId);

  if (file) {
    addContextAction(menu, "Ganti nama", () => renameItem(file));
    addContextAction(menu, "Copy", () => {
      clipboardItem = { action: "copy", id: file.id, name: file.name };
      showNotice(`"${file.name}" disiapkan untuk disalin. Klik kanan lokasi tujuan lalu pilih Tempel.`);
    });
    addContextAction(menu, "Cut", () => {
      clipboardItem = { action: "cut", id: file.id, name: file.name };
      showNotice(`"${file.name}" disiapkan untuk dipindahkan. Klik kanan folder tujuan lalu pilih Tempel.`);
    });
    if (clipboardItem) addContextSeparator(menu);
  }
  if (clipboardItem) {
    addContextAction(menu, `Paste "${clipboardItem.name}" di sini`, () => pasteClipboard(destinationId));
  }
  if (file) {
    addContextSeparator(menu);
    addContextAction(menu, "Hapus", () => deleteItem(file));
    menu.lastElementChild.classList.add("context-menu-danger");
  }
  if (!menu.childElementCount) return;

  menu.classList.remove("hidden");
  const bounds = menu.getBoundingClientRect();
  const left = Math.max(8, Math.min(event.clientX, window.innerWidth - bounds.width - 8));
  const top = Math.max(8, Math.min(event.clientY, window.innerHeight - bounds.height - 8));
  menu.style.left = `${left}px`; menu.style.top = `${top}px`;
}
async function renameItem(file) {
  const proposedName = prompt("Nama baru:", file.name);
  if (proposedName === null) return;
  const name = proposedName.trim();
  if (!name || name === file.name) return;
  try {
    await api("rename", { method: "POST", body: JSON.stringify({ id: file.id, name }) });
    await loadFiles(currentParent);
    showNotice("Nama berhasil diubah.");
  } catch (e) { showNotice(e.message, true); }
}
async function toggleFolderVisibility(file) {
  const hidden = file.appProperties?.hiddenFromUser !== "true";
  const action = hidden ? "sembunyikan dari username biasa" : "tampilkan untuk username biasa";
  if (!confirm(`Apakah Anda ingin ${action} folder "${file.name}"?`)) return;
  try {
    await api("visibility", {
      method: "POST",
      body: JSON.stringify({ id: file.id, hidden })
    });
    await loadFiles(currentParent);
    showNotice(hidden
      ? `Folder "${file.name}" sekarang hanya dapat dilihat admin.`
      : `Folder "${file.name}" sekarang dapat dilihat username biasa.`);
  } catch (error) {
    showNotice(error.message, true);
  }
}
async function deleteItem(file) {
  if (!confirm(`Pindahkan "${file.name}" ke Sampah Google Drive?`)) return;
  try {
    await api("delete", { method: "POST", body: JSON.stringify({ id: file.id }) });
    await loadFiles(currentParent);
    showNotice("Item dipindahkan ke Sampah Google Drive.");
  } catch (e) { showNotice(e.message, true); }
}
async function pasteClipboard(parentId) {
  if (!clipboardItem || !parentId) return;
  const pending = clipboardItem;
  try {
    await api(pending.action === "cut" ? "move" : "copy", {
      method: "POST",
      body: JSON.stringify({ id: pending.id, parentId })
    });
    if (pending.action === "cut" && clipboardItem === pending) clipboardItem = null;
    await loadFiles(currentParent);
    showNotice(pending.action === "cut" ? "Item berhasil dipindahkan." : "Item berhasil disalin.");
  } catch (e) { showNotice(e.message, true); }
}
const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;
const MAX_UPLOAD_CHUNK_BYTES = 3 * 1024 * 1024;
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      if (comma < 0) reject(new Error("Gagal membaca file."));
      else resolve(result.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error("Gagal membaca file."));
    reader.readAsDataURL(file);
  });
}
async function uploadFileToDrive(file, parentId, onProgress = () => {}) {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("Ukuran maksimal 1 GB per file.");
  if (file.size <= 3 * 1024 * 1024) {
    const data = await readFileAsBase64(file);
    await api("upload", {
      method: "POST",
      body: JSON.stringify({
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        data,
        parentId
      })
    });
    return;
  }

  const { uploadUrl } = await api("upload", {
    method: "POST",
    body: JSON.stringify({
      action: "start",
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      parentId
    })
  });
  for (let offset = 0; offset < file.size;) {
    const end = Math.min(offset + MAX_UPLOAD_CHUNK_BYTES, file.size);
    onProgress(Math.floor((offset / file.size) * 100));
    const data = await readFileAsBase64(file.slice(offset, end));
    const result = await api("upload", {
      method: "POST",
      body: JSON.stringify({
        action: "chunk",
        uploadUrl,
        mimeType: file.type || "application/octet-stream",
        offset,
        size: file.size,
        data
      })
    });
    offset = end;
    onProgress(Math.floor((offset / file.size) * 100));
    if (offset === file.size && !result.complete) throw new Error("Google Drive belum menyelesaikan upload.");
  }
}
function readEntryFile(entry) {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}
function readEntryBatch(reader) {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}
async function readDroppedEntry(entry) {
  if (entry.isFile) {
    const file = await readEntryFile(entry);
    return { kind: "file", name: file.name, file };
  }
  if (!entry.isDirectory) return null;

  const reader = entry.createReader();
  const entries = [];
  while (true) {
    const batch = await readEntryBatch(reader);
    if (!batch.length) break;
    entries.push(...batch);
  }
  const children = (await Promise.all(entries.map(readDroppedEntry))).filter(Boolean);
  return { kind: "folder", name: entry.name, children };
}
function getDroppedNodes(dataTransfer) {
  const items = Array.from(dataTransfer.items || []).filter(item => item.kind === "file");
  const entries = [];
  const itemFiles = [];
  for (const item of items) {
    const entry = typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null;
    if (entry) entries.push(entry);
    else {
      const file = item.getAsFile();
      if (file) itemFiles.push({ kind: "file", name: file.name, file });
    }
  }
  const fallbackFiles = Array.from(dataTransfer.files || []).map(file => ({ kind: "file", name: file.name, file }));
  return Promise.all(entries.map(readDroppedEntry)).then(nodes => {
    const availableNodes = nodes.filter(Boolean);
    if (availableNodes.length || itemFiles.length) return [...availableNodes, ...itemFiles];
    return fallbackFiles;
  });
}
function countFiles(nodes) {
  return nodes.reduce((count, node) => count + (node.kind === "file" ? 1 : countFiles(node.children || [])), 0);
}
async function uploadNode(node, parentId, state) {
  if (node.kind === "folder") {
    showNotice(`Membuat folder: ${node.name}`);
    let folderId;
    try {
      const result = await api("folders", { method: "POST", body: JSON.stringify({ name: node.name, parentId }) });
      folderId = result.file.id;
      state.foldersUploaded += 1;
    } catch (error) {
      state.failed += 1;
      state.errors.push(`${node.name}: ${error.message}`);
      return;
    }
    for (const child of node.children) await uploadNode(child, folderId, state);
    return;
  }

  state.filesProcessed += 1;
  showNotice(`Mengunggah file ${state.filesProcessed}/${state.totalFiles}: ${node.name}`);
  try {
    await uploadFileToDrive(node.file, parentId, progress => {
      showNotice(`Mengunggah ${state.filesProcessed}/${state.totalFiles}: ${node.name} (${progress}%)`);
    });
    state.filesUploaded += 1;
  } catch (error) {
    state.failed += 1;
    state.errors.push(`${node.name}: ${error.message}`);
  }
}
async function uploadNodes(nodes, parentId) {
  if (!nodes.length) {
    showNotice("Tidak ada file atau folder yang bisa dibaca. Coba seret lagi dari File Explorer.", true);
    return;
  }
  const state = { totalFiles: countFiles(nodes), filesProcessed: 0, filesUploaded: 0, foldersUploaded: 0, failed: 0, errors: [] };
  for (const node of nodes) await uploadNode(node, parentId, state);
  const refreshed = await loadFiles(currentParent);
  if (!refreshed) return;
  let summary = `Upload selesai: ${state.filesUploaded} file dan ${state.foldersUploaded} folder berhasil.`;
  if (state.failed) {
    const details = state.errors.slice(0, 2).join("; ");
    const more = state.errors.length > 2 ? `; dan ${state.errors.length - 2} lainnya` : "";
    summary += ` Gagal ${state.failed}: ${details}${more}`;
  }
  showNotice(summary, state.failed > 0);
}
function hasDraggedFiles(event) {
  return Array.from(event.dataTransfer?.items || []).some(item => item.kind === "file") ||
    Array.from(event.dataTransfer?.types || []).includes("Files");
}
function showLogin() { $("loginView").classList.remove("hidden"); $("appView").classList.add("hidden"); }
function showApp(username, role) {
  if (currentRole !== role) {
    folderTreeCache = new Map();
    expandedFolderIds = new Set();
  }
  currentRole = role;
  $("loginView").classList.add("hidden");
  $("appView").classList.remove("hidden");
  $("userBadge").textContent = `${username} · ${role === "admin" ? "Admin" : "User"}`;
}

async function checkSession() {
  const version = authFlowVersion;
  try {
    const me = await api("me");
    if (version !== authFlowVersion) return;
    showApp(me.username, me.role); await loadFiles(null, true);
  }
  catch (e) {
    if (version !== authFlowVersion) return;
    showLogin();
    if (e.status === 503) $("loginMessage").textContent = e.message;
  }
}
$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const version = ++authFlowVersion;
  $("loginMessage").textContent = "Memeriksa...";
  try {
    const data = await api("login", { method: "POST", body: JSON.stringify({ username: $("username").value.trim(), password: $("password").value }) });
    if (version !== authFlowVersion) return;
    $("password").value = ""; $("loginMessage").textContent = "";
    showApp(data.username, data.role); await loadFiles(null, true);
  } catch (e) {
    if (version === authFlowVersion) $("loginMessage").textContent = e.message;
  }
});
$("logoutBtn").addEventListener("click", async () => {
  try {
    await api("logout", { method: "POST", body: "{}" });
    showLogin();
  } catch (e) {
    showNotice(e.message, true);
  }
});
$("homeBtn").addEventListener("click", () => loadFiles(null, true));
$("newFolderBtn").addEventListener("click", async () => {
  const name = prompt("Nama folder baru:");
  if (!name || !name.trim()) return;
  try {
    await api("folders", { method: "POST", body: JSON.stringify({ name: name.trim(), parentId: currentParent }) });
    showNotice("Folder berhasil dibuat."); await loadFiles(currentParent);
  } catch (e) { showNotice(e.message, true); }
});
$("uploadInput").addEventListener("change", async (event) => {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;
  await uploadNodes(files.map(file => ({ kind: "file", name: file.name, file })), currentParent);
  event.target.value = "";
});
const appView = $("appView");
appView.addEventListener("dragenter", event => {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  appView.classList.add("drag-over");
});
appView.addEventListener("dragover", event => {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  appView.classList.add("drag-over");
});
appView.addEventListener("dragleave", event => {
  if (!appView.contains(event.relatedTarget)) appView.classList.remove("drag-over");
});
appView.addEventListener("drop", async event => {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  appView.classList.remove("drag-over");
  const destinationId = currentParent;
  showNotice("Membaca file dan folder...");
  try {
    const nodes = await getDroppedNodes(event.dataTransfer);
    await uploadNodes(nodes, destinationId);
  } catch (error) {
    showNotice(error.message || "Tidak dapat membaca file atau folder yang diseret.", true);
  }
});
document.addEventListener("dragover", event => { if (hasDraggedFiles(event)) event.preventDefault(); });
document.addEventListener("drop", event => { if (hasDraggedFiles(event)) event.preventDefault(); });
$("searchInput").addEventListener("input", renderFiles);
$("sortSelect").addEventListener("change", event => {
  sortOrder = event.target.value;
  renderFiles();
});
document.querySelector(".table-wrap").addEventListener("contextmenu", event => showContextMenu(event));
document.addEventListener("click", event => {
  if (!$("contextMenu").contains(event.target)) hideContextMenu();
});
document.addEventListener("keydown", event => { if (event.key === "Escape") hideContextMenu(); });

async function loadFiles(parentId = null, reset = false) {
  clearNotice();
  const tbody = $("fileRows");
  tbody.replaceChildren();
  const loading = document.createElement("tr"), loadingCell = document.createElement("td");
  loadingCell.colSpan = 5; loadingCell.className = "empty"; loadingCell.textContent = "Memuat file...";
  loading.append(loadingCell); tbody.append(loading);
  try {
    const data = await api("files" + (parentId ? `?parentId=${encodeURIComponent(parentId)}` : ""));
    rootId = data.rootId; currentParent = parentId || rootId; allFiles = data.files || [];
    folderTreeCache.set(currentParent, allFiles.filter(file => file.mimeType === "application/vnd.google-apps.folder"));
    if (reset || !parentId) crumbs = [{ id: rootId, name: "Semua file" }];
    renderCrumbs(); renderFiles(); renderFolderTree();
    return true;
  } catch (e) {
    if (/login|sesi/i.test(e.message)) {
      showLogin(); $("loginMessage").textContent = e.message;
    }
    else showNotice(e.message, true);
    return false;
  }
}
function renderFolderTree() {
  const tree = $("folderTree");
  tree.replaceChildren();
  $("homeBtn").classList.toggle("active", currentParent === rootId);
  if (!rootId) return;
  const rootFolders = folderTreeCache.get(rootId) || [];
  if (!rootFolders.length) {
    const empty = document.createElement("div");
    empty.className = "folder-tree-empty";
    empty.textContent = "Belum ada folder";
    tree.append(empty);
    return;
  }
  renderFolderBranch(rootId, [], 0, tree);
}
function renderFolderBranch(parentId, ancestors, depth, container) {
  const folders = (folderTreeCache.get(parentId) || []).slice().sort((a, b) => nameCollator.compare(a.name, b.name));
  for (const folder of folders) {
    const row = document.createElement("div");
    row.className = "folder-tree-row";
    row.style.paddingLeft = `${depth * 14}px`;

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "folder-tree-toggle";
    toggle.textContent = expandedFolderIds.has(folder.id) ? "▾" : "▸";
    toggle.setAttribute("aria-label", `${expandedFolderIds.has(folder.id) ? "Tutup" : "Buka"} folder ${folder.name}`);
    toggle.addEventListener("click", () => toggleFolderBranch(folder));
    row.append(toggle);

    const name = document.createElement("button");
    name.type = "button";
    name.className = "folder-tree-name";
    if (currentParent === folder.id) name.classList.add("selected");
    name.textContent = folder.name;
    name.title = folder.name;
    name.addEventListener("click", () => {
      expandedFolderIds.add(folder.id);
      crumbs = [{ id: rootId, name: "Semua file" }, ...ancestors, { id: folder.id, name: folder.name }];
      loadFiles(folder.id);
    });
    row.append(name);
    container.append(row);

    if (expandedFolderIds.has(folder.id)) {
      const children = document.createElement("div");
      children.className = "folder-tree-children";
      container.append(children);
      renderFolderBranch(folder.id, [...ancestors, { id: folder.id, name: folder.name }], depth + 1, children);
    }
  }
}
async function toggleFolderBranch(folder) {
  if (expandedFolderIds.has(folder.id)) {
    expandedFolderIds.delete(folder.id);
    renderFolderTree();
    return;
  }
  try {
    if (!folderTreeCache.has(folder.id)) {
      const data = await api(`files?parentId=${encodeURIComponent(folder.id)}`);
      folderTreeCache.set(folder.id, (data.files || []).filter(file => file.mimeType === "application/vnd.google-apps.folder"));
    }
    expandedFolderIds.add(folder.id);
    renderFolderTree();
  } catch (e) {
    if (/login|sesi/i.test(e.message)) {
      showLogin();
      $("loginMessage").textContent = e.message;
    } else showNotice(e.message, true);
  }
}
function renderCrumbs() {
  $("breadcrumbs").replaceChildren();
  crumbs.forEach((crumb, index) => {
    const btn = document.createElement("button"); btn.className = "crumb"; btn.textContent = crumb.name;
    btn.addEventListener("click", () => { crumbs = crumbs.slice(0, index + 1); loadFiles(crumb.id, index === 0); });
    $("breadcrumbs").append(btn);
    if (index < crumbs.length - 1) { const sep = document.createElement("span"); sep.textContent = "›"; $("breadcrumbs").append(sep); }
  });
}
function formatSize(bytes) {
  if (bytes == null || bytes === "") return "—";
  const n = Number(bytes); if (!Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`; if (n < 1024*1024) return `${(n/1024).toFixed(1)} KB`;
  return `${(n/(1024*1024)).toFixed(1)} MB`;
}
function addCell(row, text) { const td = document.createElement("td"); td.textContent = text; row.append(td); return td; }
function compareFiles(a, b) {
  const aFolder = a.mimeType === "application/vnd.google-apps.folder";
  const bFolder = b.mimeType === "application/vnd.google-apps.folder";
  if (aFolder !== bFolder) return aFolder ? -1 : 1;

  let result = 0;
  if (sortOrder === "size-asc" || sortOrder === "size-desc") {
    const aSize = Number(a.size), bSize = Number(b.size);
    const aHasSize = !aFolder && a.size != null && a.size !== "" && Number.isFinite(aSize);
    const bHasSize = !bFolder && b.size != null && b.size !== "" && Number.isFinite(bSize);
    if (aHasSize !== bHasSize) return aHasSize ? -1 : 1;
    if (aHasSize) result = sortOrder === "size-asc" ? aSize - bSize : bSize - aSize;
  } else if (sortOrder === "newest" || sortOrder === "oldest") {
    const aTime = Date.parse(a.modifiedTime);
    const bTime = Date.parse(b.modifiedTime);
    const aHasTime = Number.isFinite(aTime);
    const bHasTime = Number.isFinite(bTime);
    if (aHasTime !== bHasTime) return aHasTime ? -1 : 1;
    if (aHasTime) result = sortOrder === "newest" ? bTime - aTime : aTime - bTime;
  } else {
    result = nameCollator.compare(a.name, b.name);
    if (sortOrder === "name-desc") result *= -1;
  }
  return result || nameCollator.compare(a.name, b.name);
}
function renderFiles() {
  const tbody = $("fileRows"); tbody.replaceChildren();
  const query = $("searchInput").value.trim().toLowerCase();
  const items = allFiles.filter(f => f.name.toLowerCase().includes(query)).sort(compareFiles);
  if (!items.length) { const tr = document.createElement("tr"), td = document.createElement("td"); td.colSpan = 5; td.className = "empty"; td.textContent = query ? "File tidak ditemukan." : "Folder ini masih kosong."; tr.append(td); tbody.append(tr); return; }
  for (const file of items) {
    const folder = file.mimeType === "application/vnd.google-apps.folder";
    const tr = document.createElement("tr");
    tr.addEventListener("contextmenu", event => {
      event.stopPropagation(); showContextMenu(event, file);
    });
    const nameCell = document.createElement("td"), wrap = document.createElement("div"), icon = document.createElement("span");
    wrap.className = "file-name"; icon.className = "file-icon"; icon.textContent = folder ? "📁" : "📄";
    wrap.append(icon);
    if (folder) {
      const btn = document.createElement("button"); btn.className = "folder-name"; btn.textContent = file.name;
      btn.addEventListener("click", () => {
        expandedFolderIds.add(file.id);
        crumbs.push({ id: file.id, name: file.name });
        loadFiles(file.id);
      });
      wrap.append(btn);
    } else { const span = document.createElement("span"); span.textContent = file.name; wrap.append(span); }
    nameCell.append(wrap); tr.append(nameCell);
    addCell(tr, folder ? "Folder" : (file.mimeType || "File").split("/").pop());
    addCell(tr, folder ? "—" : formatSize(file.size));
    addCell(tr, file.modifiedTime ? new Date(file.modifiedTime).toLocaleString("id-ID") : "—");
    const actions = document.createElement("td");
    if (!folder) {
      const nativeGoogleFile = file.mimeType.startsWith("application/vnd.google-apps.");
      const canExport = [
        "application/vnd.google-apps.document",
        "application/vnd.google-apps.spreadsheet",
        "application/vnd.google-apps.presentation",
        "application/vnd.google-apps.drawing"
      ].includes(file.mimeType);
      if (!nativeGoogleFile || canExport) {
        const dl = document.createElement("button"); dl.className = "small-action"; dl.textContent = "Unduh";
        dl.addEventListener("click", () => { window.location.href = `/api/download?id=${encodeURIComponent(file.id)}`; });
        actions.append(dl);
      }
      if (file.webViewLink) { const open = document.createElement("button"); open.className = "small-action"; open.textContent = "Drive"; open.addEventListener("click", () => window.open(file.webViewLink, "_blank", "noopener,noreferrer")); actions.append(open); }
    } else {
      const rename = document.createElement("button"); rename.className = "small-action"; rename.textContent = "Ganti nama";
      rename.addEventListener("click", () => renameItem(file));
      actions.append(rename);
      if (currentRole === "admin") {
        const hidden = file.appProperties?.hiddenFromUser === "true";
        const visibility = document.createElement("button");
        visibility.className = "small-action";
        visibility.textContent = hidden ? "Tampilkan ke user" : "Privatkan";
        visibility.title = hidden ? "Izinkan username biasa melihat folder" : "Hanya admin yang dapat melihat folder";
        visibility.addEventListener("click", () => toggleFolderVisibility(file));
        actions.append(visibility);
      }
    }
    const del = document.createElement("button"); del.className = "small-action delete-action"; del.textContent = "Hapus";
    del.addEventListener("click", () => deleteItem(file));
    actions.append(del); tr.append(actions); tbody.append(tr);
  }
}
checkSession();
