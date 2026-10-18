const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

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

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

async function withUploadHandler(t, drive) {
  const restoreAuth = mockModule("../lib/auth", { requireAuth: async () => true });
  const restoreDrive = mockModule("../lib/drive", {
    getDrive: () => drive,
    driveRequest: (driveClient, options) => driveClient.request(options),
    rootFolderId: () => "root-folder-id",
    ensureFolderInApp: async () => true
  });
  const handlerPath = require.resolve("../api/upload");
  const previousHandler = require.cache[handlerPath];
  delete require.cache[handlerPath];
  t.after(() => {
    if (previousHandler) require.cache[handlerPath] = previousHandler;
    else delete require.cache[handlerPath];
    restoreDrive();
    restoreAuth();
  });
  return require("../api/upload");
}

test("resumable upload enforces 1 GiB and sends aligned chunks", async t => {
  const requests = [];
  const responses = [
    {
      headers: {
        location: "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=session"
      }
    },
    { status: 308 },
    { status: 200, data: { id: "uploaded-file-id" } }
  ];
  const handler = await withUploadHandler(t, {
    request: async options => {
      requests.push(options);
      return responses.shift();
    }
  });
  const uploadUrl = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=session";

  const startResponse = response();
  await handler({
    method: "POST",
    body: {
      action: "start",
      name: "large.bin",
      mimeType: "application/octet-stream",
      size: 1024 * 1024 * 1024,
      parentId: "folder-id"
    }
  }, startResponse);
  assert.equal(startResponse.statusCode, 200);
  assert.match(startResponse.body.uploadUrl, /upload_id=session/);
  assert.ok(requests[0]?.headers, JSON.stringify(requests[0]));
  assert.equal(requests[0].headers["X-Upload-Content-Length"], String(1024 * 1024 * 1024));

  const tooLargeResponse = response();
  await handler({
    method: "POST",
    body: { action: "start", name: "too-large.bin", size: 1024 * 1024 * 1024 + 1 }
  }, tooLargeResponse);
  assert.equal(tooLargeResponse.statusCode, 413);
  assert.match(tooLargeResponse.body.error, /1 GB/);
  assert.equal(requests.length, 1);

  const firstChunk = Buffer.alloc(3 * 1024 * 1024, 1);
  const firstResponse = response();
  await handler({
    method: "POST",
    body: {
      action: "chunk",
      uploadUrl,
      mimeType: "application/octet-stream",
      offset: 0,
      size: firstChunk.length + 1,
      data: firstChunk.toString("base64")
    }
  }, firstResponse);

  const finalResponse = response();
  await handler({
    method: "POST",
    body: {
      action: "chunk",
      uploadUrl,
      mimeType: "application/octet-stream",
      offset: firstChunk.length,
      size: firstChunk.length + 1,
      data: Buffer.from([2]).toString("base64")
    }
  }, finalResponse);

  assert.equal(firstResponse.statusCode, 202);
  assert.deepEqual(firstResponse.body, { complete: false });
  assert.equal(finalResponse.statusCode, 200);
  assert.deepEqual(finalResponse.body, { complete: true, file: { id: "uploaded-file-id" } });
  assert.equal(requests[1].headers["Content-Range"], `bytes 0-${firstChunk.length - 1}/${firstChunk.length + 1}`);
  assert.equal(requests[2].headers["Content-Range"], `bytes ${firstChunk.length}-${firstChunk.length}/${firstChunk.length + 1}`);
});
