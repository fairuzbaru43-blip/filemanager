const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const publicRoot = path.join(projectRoot, "public");
const maxBodyBytes = 4.5 * 1024 * 1024;
const publicFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/style.css", ["style.css", "text/css; charset=utf-8"]]
]);

function loadLocalEnvironment() {
  const envPath = path.join(projectRoot, ".env.local");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || match[1] in process.env) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function addResponseHelpers(res) {
  res.status = status => {
    res.statusCode = status;
    return res;
  };
  res.json = value => {
    if (!res.headersSent) res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(value));
    return res;
  };
}

function sendError(res, status, message) {
  if (!res.headersSent) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: message }));
  } else {
    res.destroy();
  }
}

function parseBody(req, res) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", chunk => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        sendError(res, 413, "Ukuran request terlalu besar.");
        reject(new Error("Request body too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (size === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Body request harus berupa JSON yang valid."));
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(pathname, res) {
  const entry = publicFiles.get(pathname);
  if (!entry) return false;
  const [fileName, contentType] = entry;
  const filePath = path.join(publicRoot, fileName);
  res.statusCode = 200;
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "no-cache");
  fs.createReadStream(filePath).pipe(res);
  return true;
}

loadLocalEnvironment();

const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  addResponseHelpers(res);

  const url = new URL(req.url, "http://localhost");
  if (req.method === "GET" && serveStatic(url.pathname, res)) return;
  if (!url.pathname.startsWith("/api/")) return sendError(res, 404, "Halaman tidak ditemukan.");

  const endpoint = path.basename(url.pathname);
  if (!/^[a-z]+$/.test(endpoint)) return sendError(res, 404, "Endpoint tidak ditemukan.");
  const endpointPath = path.join(projectRoot, "api", `${endpoint}.js`);
  if (!fs.existsSync(endpointPath)) return sendError(res, 404, "Endpoint tidak ditemukan.");
  let handler;
  try {
    handler = require(endpointPath);
  } catch {
    console.error("Failed to load a local API endpoint.");
    return sendError(res, 500, "Endpoint API tidak dapat dijalankan.");
  }

  req.query = Object.fromEntries(url.searchParams.entries());
  if (["POST", "PUT", "PATCH"].includes(req.method)) {
    try {
      req.body = await parseBody(req, res);
    } catch (error) {
      if (!res.writableEnded) sendError(res, error.message === "Request body too large." ? 413 : 400, error.message);
      return;
    }
  }

  try {
    await handler(req, res);
    if (!res.writableEnded && !res.headersSent) sendError(res, 500, "Endpoint tidak menghasilkan respons.");
  } catch {
    console.error(`Local API request failed: ${endpoint}`);
    if (!res.headersSent) sendError(res, 500, "Terjadi kesalahan server.");
    else res.destroy();
  }
});

const port = Number(process.env.PORT || 3000);
server.listen(port, "127.0.0.1", () => {
  console.log(`DriveBox local server listening on http://localhost:${port}`);
});
