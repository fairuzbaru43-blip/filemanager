const test = require("node:test");
const assert = require("node:assert/strict");
const { ensureFileInApp, ensureFolderInApp, ensureNoHiddenDescendants } = require("../lib/drive");

const rootId = "test-root-folder-id";
const folders = new Map([
  [rootId, { id: rootId, mimeType: "application/vnd.google-apps.folder", parents: [] }],
  ["public-folder-id", { id: "public-folder-id", mimeType: "application/vnd.google-apps.folder", parents: [rootId] }],
  ["private-child-id", {
    id: "private-child-id",
    mimeType: "application/vnd.google-apps.folder",
    parents: ["public-folder-id"],
    appProperties: { hiddenFromUser: "true" }
  }],
  ["private-folder-id", {
    id: "private-folder-id",
    mimeType: "application/vnd.google-apps.folder",
    parents: [rootId],
    appProperties: { hiddenFromUser: "true" }
  }],
  ["nested-folder-id", { id: "nested-folder-id", mimeType: "application/vnd.google-apps.folder", parents: ["private-folder-id"] }],
  ["visible-file-id", { id: "visible-file-id", mimeType: "text/plain", parents: ["public-folder-id"] }],
  ["private-file-id", { id: "private-file-id", mimeType: "text/plain", parents: ["private-folder-id"] }]
]);

function drive() {
  return {
    files: {
      async get({ fileId }) {
        const file = folders.get(fileId);
        if (!file) throw new Error("Unexpected file lookup.");
        return { data: { trashed: false, ...file } };
      },
      async list({ q }) {
        const parentId = q.match(/^'([^']+)' in parents/)[1];
        return {
          data: {
            files: [...folders.values()]
              .filter(file => file.parents?.includes(parentId))
              .map(({ id, mimeType, appProperties }) => ({ id, mimeType, appProperties }))
          }
        };
      }
    }
  };
}

test("private folders and their descendants are inaccessible to the regular user", async () => {
  const originalRoot = process.env.DRIVE_FOLDER_ID;
  process.env.DRIVE_FOLDER_ID = rootId;
  try {
    assert.equal(await ensureFolderInApp(drive(), "public-folder-id", "user"), true);
    assert.equal((await ensureFileInApp(drive(), "visible-file-id", "user")).id, "visible-file-id");
    await assert.rejects(ensureFolderInApp(drive(), "private-folder-id", "user"), /Akses hanya diizinkan/);
    await assert.rejects(ensureFolderInApp(drive(), "nested-folder-id", "user"), /Akses hanya diizinkan/);
    await assert.rejects(ensureFileInApp(drive(), "private-file-id", "user"), /Akses hanya diizinkan/);
    await assert.rejects(ensureNoHiddenDescendants(drive(), "public-folder-id", "user"), /berisi folder privat/);
    assert.equal(await ensureNoHiddenDescendants(drive(), "public-folder-id", "admin"), true);
    assert.equal((await ensureFolderInApp(drive(), "private-folder-id", "admin")), true);
    assert.equal((await ensureFileInApp(drive(), "private-file-id", "admin")).id, "private-file-id");
  } finally {
    if (originalRoot === undefined) delete process.env.DRIVE_FOLDER_ID;
    else process.env.DRIVE_FOLDER_ID = originalRoot;
  }
});
