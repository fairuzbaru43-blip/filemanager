const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { Readable, Writable } = require("node:stream");

function mockModule(request, exports) {
  const filename = require.resolve(request);
  const previous = require.cache[filename];
  const mocked = new Module(filename, module);
  mocked.filename = filename;
  mocked.loaded = true;
  mocked.exports = exports;
  require.cache[filename] = mocked;
  return () => {
    if (previous) require.cache[filename] = previous;
    else delete require.cache[filename];
  };
}

class DelayedResponse extends Writable {
  constructor() {
    super();
    this.headers = {};
    this.chunks = [];
    this.headersSent = false;
  }

  _write(chunk, encoding, callback) {
    this.headersSent = true;
    this.chunks.push(Buffer.from(chunk));
    setTimeout(callback, 5);
  }

  setHeader(name, value) {
    this.headers[name] = value;
  }

  status(code) {
    this.statusCode = code;
    return this;
  }

  json(body) {
    this.setHeader("Content-Type", "application/json");
    this.end(JSON.stringify(body));
    return this;
  }
}

test("folder download waits until the complete ZIP response is written", async () => {
  const restoreAuth = mockModule("../lib/auth", { requireAuth: async () => true });
  const restoreDrive = mockModule("../lib/drive", {
    getDrive: () => ({
      files: {
        list: async () => ({
          data: {
            files: [{
              id: "file-id",
              name: "sample.txt",
              mimeType: "text/plain",
              capabilities: { canDownload: true }
            }]
          }
        }),
        get: async () => ({ data: Readable.from([Buffer.from("sample content")]) })
      }
    }),
    ensureFileInApp: async () => ({
      id: "folder-id",
      name: "folder",
      mimeType: "application/vnd.google-apps.folder"
    })
  });
  const handlerPath = require.resolve("../api/download");
  const previousHandler = require.cache[handlerPath];
  delete require.cache[handlerPath];

  try {
    const handler = require("../api/download");
    const response = new DelayedResponse();
    await handler({ method: "GET", query: { id: "folder-id" } }, response);

    const archive = Buffer.concat(response.chunks);
    assert.equal(response.writableFinished, true);
    assert.equal(response.headers["Content-Type"], "application/zip");
    assert.equal(archive.readUInt32LE(archive.length - 22), 0x06054b50);
  } finally {
    if (previousHandler) require.cache[handlerPath] = previousHandler;
    else delete require.cache[handlerPath];
    restoreDrive();
    restoreAuth();
  }
});
