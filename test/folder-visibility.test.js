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
    headers: {},
    statusCode: 200,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

async function loadHandler(t, path, auth, drive) {
  const restoreAuth = mockModule("../lib/auth", { requireAuth: async () => auth });
  const restoreDrive = mockModule("../lib/drive", drive);
  const handlerPath = require.resolve(path);
  const previousHandler = require.cache[handlerPath];
  delete require.cache[handlerPath];
  t.after(() => {
    if (previousHandler) require.cache[handlerPath] = previousHandler;
    else delete require.cache[handlerPath];
    restoreDrive();
    restoreAuth();
  });
  return require(path);
}

test("regular user listing omits folders marked private", async t => {
  let authorizedRole;
  const handler = await loadHandler(t, "../api/files", { username: "regular", role: "user" }, {
    getDrive: () => ({
      files: {
        list: async () => ({
          data: {
            files: [
              { id: "public-folder-id", name: "Public", appProperties: { hiddenFromUser: "false" } },
              { id: "private-folder-id", name: "Private", appProperties: { hiddenFromUser: "true" } },
              { id: "ordinary-file-id", name: "Notes.txt" }
            ]
          }
        })
      }
    }),
    rootFolderId: () => "root-folder-id",
    ensureFolderInApp: async (drive, id, role) => { authorizedRole = role; }
  });
  const res = response();
  await handler({ method: "GET", query: {}, headers: {}, socket: {} }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(authorizedRole, "user");
  assert.deepEqual(res.body.files.map(file => file.id), ["public-folder-id", "ordinary-file-id"]);
});

test("only admin can mark a Drive folder private", async t => {
  let updated;
  const drive = {
    getDrive: () => ({
      files: {
        update: async options => {
          updated = options;
          return { data: { appProperties: options.requestBody.appProperties } };
        }
      }
    }),
    rootFolderId: () => "root-folder-id",
    ensureFileInApp: async () => ({
      id: "private-folder-id",
      mimeType: "application/vnd.google-apps.folder",
      appProperties: { existingProperty: "keep" }
    })
  };
  const regularHandler = await loadHandler(t, "../api/visibility", { username: "regular", role: "user" }, drive);
  const deniedResponse = response();
  await regularHandler({
    method: "POST",
    body: { id: "private-folder-id", hidden: true },
    headers: {},
    socket: {}
  }, deniedResponse);
  assert.equal(deniedResponse.statusCode, 403);
  assert.equal(updated, undefined);

  const adminHandler = await loadHandler(t, "../api/visibility", { username: "admin", role: "admin" }, drive);
  const adminResponse = response();
  await adminHandler({
    method: "POST",
    body: { id: "private-folder-id", hidden: true },
    headers: {},
    socket: {}
  }, adminResponse);
  assert.equal(adminResponse.statusCode, 200);
  assert.deepEqual(updated.requestBody.appProperties, { existingProperty: "keep", hiddenFromUser: "true" });
  assert.deepEqual(adminResponse.body, { hidden: true });
});
