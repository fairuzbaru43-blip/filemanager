const $ = (id) => document.getElementById(id);
let currentParent = null;
let rootId = null;
let allFiles = [];
let crumbs = [];
let authFlowVersion = 0;

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
function showLogin() { $("loginView").classList.remove("hidden"); $("appView").classList.add("hidden"); }
function showApp(username) { $("loginView").classList.add("hidden"); $("appView").classList.remove("hidden"); $("userBadge").textContent = username; }

async function checkSession() {
  const version = authFlowVersion;
  try {
    const me = await api("me");
    if (version !== authFlowVersion) return;
    showApp(me.username); await loadFiles(null, true);
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
    showApp(data.username); await loadFiles(null, true);
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
  const file = event.target.files[0]; if (!file) return;
  if (file.size > 3 * 1024 * 1024) { showNotice("Ukuran maksimal 3 MB untuk versi pemula ini.", true); event.target.value = ""; return; }
  try {
    showNotice(`Mengunggah ${file.name}...`);
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = () => reject(new Error("Gagal membaca file."));
      reader.readAsDataURL(file);
    });
    await api("upload", { method: "POST", body: JSON.stringify({ name: file.name, mimeType: file.type || "application/octet-stream", data: base64, parentId: currentParent }) });
    showNotice("Upload berhasil disimpan ke Google Drive."); await loadFiles(currentParent);
  } catch (e) { showNotice(e.message, true); }
  finally { event.target.value = ""; }
});
$("searchInput").addEventListener("input", renderFiles);

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
    if (reset || !parentId) crumbs = [{ id: rootId, name: "Semua file" }];
    renderCrumbs(); renderFiles();
  } catch (e) {
    if (/login|sesi/i.test(e.message)) {
      showLogin(); $("loginMessage").textContent = e.message;
    }
    else showNotice(e.message, true);
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
function renderFiles() {
  const tbody = $("fileRows"); tbody.replaceChildren();
  const query = $("searchInput").value.trim().toLowerCase();
  const items = allFiles.filter(f => f.name.toLowerCase().includes(query));
  if (!items.length) { const tr = document.createElement("tr"), td = document.createElement("td"); td.colSpan = 5; td.className = "empty"; td.textContent = query ? "File tidak ditemukan." : "Folder ini masih kosong."; tr.append(td); tbody.append(tr); return; }
  for (const file of items) {
    const folder = file.mimeType === "application/vnd.google-apps.folder";
    const tr = document.createElement("tr");
    const nameCell = document.createElement("td"), wrap = document.createElement("div"), icon = document.createElement("span");
    wrap.className = "file-name"; icon.className = "file-icon"; icon.textContent = folder ? "📁" : "📄";
    wrap.append(icon);
    if (folder) {
      const btn = document.createElement("button"); btn.className = "folder-name"; btn.textContent = file.name;
      btn.addEventListener("click", () => { crumbs.push({ id: file.id, name: file.name }); loadFiles(file.id); });
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
      rename.addEventListener("click", async () => {
        const proposedName = prompt("Nama folder baru:", file.name);
        if (proposedName === null) return;
        const name = proposedName.trim();
        if (!name || name === file.name) return;
        try {
          await api("rename", { method: "POST", body: JSON.stringify({ id: file.id, name }) });
          showNotice("Nama folder berhasil diubah."); await loadFiles(currentParent);
        } catch (e) { showNotice(e.message, true); }
      });
      actions.append(rename);
    }
    const del = document.createElement("button"); del.className = "small-action delete-action"; del.textContent = "Hapus";
    del.addEventListener("click", async () => {
      if (!confirm(`Pindahkan "${file.name}" ke Sampah Google Drive?`)) return;
      try { await api("delete", { method: "POST", body: JSON.stringify({ id: file.id }) }); showNotice("File dipindahkan ke Sampah."); await loadFiles(currentParent); }
      catch (e) { showNotice(e.message, true); }
    });
    actions.append(del); tr.append(actions); tbody.append(tr);
  }
}
checkSession();
