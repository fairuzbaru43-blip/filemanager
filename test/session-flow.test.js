const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const bcrypt = require("bcryptjs");
const { Redis } = require("@upstash/redis");

function response() {
  return {
    headers: {},
    statusCode: 200,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function clearModule(path) {
  const resolved = require.resolve(path);
  delete require.cache[resolved];
}

test("login session survives page loads and is revoked by logout", async () => {
  const environmentNames = [
    "APP_USERNAME", "APP_PASSWORD_HASH", "SESSION_SECRET",
    "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "NODE_ENV"
  ];
  const originalEnvironment = Object.fromEntries(environmentNames.map(name => [name, process.env[name]]));
  const originalFromEnv = Redis.fromEnv;
  const sessionStore = new Map();
  const redis = {
    async set(key, value) { sessionStore.set(key, value); return "OK"; },
    async get(key) {
      const value = sessionStore.get(key);
      if (value === undefined) return null;
      // Upstash's default response parser turns the stored string "1" into number 1.
      try { return JSON.parse(value); } catch { return value; }
    },
    async del(key) { return sessionStore.delete(key) ? 1 : 0; }
  };

  const driveModule = require("../lib/drive");
  const originalDrive = {
    getDrive: driveModule.getDrive,
    rootFolderId: driveModule.rootFolderId,
    ensureFolderInApp: driveModule.ensureFolderInApp
  };

  try {
    process.env.APP_USERNAME = "test-admin";
    process.env.APP_PASSWORD_HASH = bcrypt.hashSync("test-only-password", 10);
    process.env.SESSION_SECRET = "test-only-secret-at-least-32-bytes-long";
    process.env.UPSTASH_REDIS_REST_URL = "https://test-session-db.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-only-token";
    process.env.NODE_ENV = "production";
    Redis.fromEnv = () => redis;

    class SuccessfulRatelimit {
      static slidingWindow() { return {}; }
      async limit() { return { success: true, reset: Date.now() + 60_000 }; }
    }
    const originalLoad = Module._load;
    let loginHandler;
    try {
      Module._load = function (request, parent, isMain) {
        if (request === "@upstash/ratelimit") return { Ratelimit: SuccessfulRatelimit };
        return originalLoad.call(this, request, parent, isMain);
      };
      clearModule("../lib/auth");
      clearModule("../api/login");
      loginHandler = require("../api/login");
    } finally {
      Module._load = originalLoad;
    }

    const rootId = "test-root-folder-123";
    driveModule.getDrive = () => ({
      files: {
        get: async () => ({ data: { id: rootId, mimeType: "application/vnd.google-apps.folder", trashed: false } }),
        list: async () => ({ data: { files: [{ id: "test-file-123", name: "Catatan.txt", mimeType: "text/plain", size: "12" }] } })
      }
    });
    driveModule.rootFolderId = () => rootId;
    driveModule.ensureFolderInApp = async () => true;
    for (const path of ["../api/me", "../api/files", "../api/logout"]) clearModule(path);
    const meHandler = require("../api/me");
    const filesHandler = require("../api/files");
    const logoutHandler = require("../api/logout");

    const loginResponse = response();
    await loginHandler({
      method: "POST",
      headers: { "x-forwarded-proto": "https", "x-forwarded-for": "203.0.113.10" },
      socket: {},
      body: { username: "test-admin", password: "test-only-password" }
    }, loginResponse);

    assert.equal(loginResponse.statusCode, 200);
    assert.deepEqual(loginResponse.body, { ok: true, username: "test-admin" });
    assert.equal(loginResponse.headers["Cache-Control"], "no-store");
    const cookie = loginResponse.headers["Set-Cookie"];
    assert.match(cookie, /^fm_session=[^;]+;/);
    assert.match(cookie, /; HttpOnly/);
    assert.match(cookie, /; Path=\//);
    assert.match(cookie, /; SameSite=Lax/);
    assert.match(cookie, /; Max-Age=28800/);
    assert.match(cookie, /; Secure/);
    const cookiePair = cookie.split(";", 1)[0];

    // Initial session check, browser refresh, and a newly opened same-origin page.
    for (let pageLoad = 0; pageLoad < 3; pageLoad++) {
      const meResponse = response();
      await meHandler({ method: "GET", headers: { cookie: cookiePair }, socket: {} }, meResponse);
      assert.equal(meResponse.statusCode, 200);
      assert.deepEqual(meResponse.body, { username: "test-admin" });
      assert.equal(meResponse.headers["Cache-Control"], "no-store");
    }

    const dashboardResponse = response();
    await filesHandler({ method: "GET", headers: { cookie: cookiePair }, socket: {}, query: {} }, dashboardResponse);
    assert.equal(dashboardResponse.statusCode, 200);
    assert.equal(dashboardResponse.body.rootId, rootId);
    assert.equal(dashboardResponse.body.files[0].name, "Catatan.txt");

    // A Redis error must be diagnosable without logging its potentially sensitive message.
    const originalGet = redis.get;
    const originalConsoleError = console.error;
    const capturedLogs = [];
    try {
      redis.get = async () => { throw new Error("sensitive-test-value-must-not-be-logged"); };
      console.error = (...args) => capturedLogs.push(args);
      const unavailableResponse = response();
      await meHandler({ method: "GET", headers: { cookie: cookiePair }, socket: {} }, unavailableResponse);
      assert.equal(unavailableResponse.statusCode, 503);
      assert.equal(capturedLogs.length, 1);
      assert.doesNotMatch(JSON.stringify(capturedLogs), /sensitive-test-value-must-not-be-logged/);
    } finally {
      redis.get = originalGet;
      console.error = originalConsoleError;
    }

    const logoutResponse = response();
    await logoutHandler({
      method: "POST",
      headers: { cookie: cookiePair, "x-forwarded-proto": "https" },
      socket: {},
      body: {}
    }, logoutResponse);
    assert.equal(logoutResponse.statusCode, 200);
    assert.match(logoutResponse.headers["Set-Cookie"], /^fm_session=;/);
    assert.match(logoutResponse.headers["Set-Cookie"], /; HttpOnly/);
    assert.match(logoutResponse.headers["Set-Cookie"], /; Path=\//);
    assert.match(logoutResponse.headers["Set-Cookie"], /; SameSite=Lax/);
    assert.match(logoutResponse.headers["Set-Cookie"], /; Max-Age=0/);
    assert.match(logoutResponse.headers["Set-Cookie"], /; Secure/);
    assert.equal(sessionStore.size, 0);

    const revokedResponse = response();
    await meHandler({ method: "GET", headers: { cookie: cookiePair }, socket: {} }, revokedResponse);
    assert.equal(revokedResponse.statusCode, 401);
  } finally {
    Redis.fromEnv = originalFromEnv;
    driveModule.getDrive = originalDrive.getDrive;
    driveModule.rootFolderId = originalDrive.rootFolderId;
    driveModule.ensureFolderInApp = originalDrive.ensureFolderInApp;
    for (const [name, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
