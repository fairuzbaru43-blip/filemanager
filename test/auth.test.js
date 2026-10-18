const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const { Redis } = require("@upstash/redis");
const { getAuthConfigurationError } = require("../lib/configuration");
const { clearSession, requireAuth, setSession, verifyPassword } = require("../lib/auth");

const authEnvironmentVariables = [
  "ADMIN_USERNAME",
  "ADMIN_PASSWORD_HASH",
  "USER_USERNAME",
  "USER_PASSWORD_HASH",
  "SESSION_SECRET",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN"
];

function response() {
  return {
    headers: {},
    statusCode: 200,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test("auth configuration reports missing names and Redis sessions revoke logout tokens", async () => {
  const modifiedEnvironmentVariables = [...authEnvironmentVariables, "NODE_ENV"];
  const originalEnvironment = Object.fromEntries(modifiedEnvironmentVariables.map(name => [name, process.env[name]]));
  const originalFromEnv = Redis.fromEnv;
  const sessions = new Map();

  try {
    for (const name of authEnvironmentVariables) delete process.env[name];
    const missingError = getAuthConfigurationError();
    assert.ok(missingError);
    for (const name of authEnvironmentVariables) assert.match(missingError.message, new RegExp(name));

    const password = "test-only-password";
    process.env.ADMIN_USERNAME = "test-admin";
    process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync(password, 10);
    process.env.USER_USERNAME = "test-user";
    process.env.USER_PASSWORD_HASH = bcrypt.hashSync("test-only-user-password", 10);
    process.env.SESSION_SECRET = "test-only-session-secret-with-at-least-32-bytes";
    process.env.UPSTASH_REDIS_REST_URL = "https://test-session-db.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-only-token";
    process.env.NODE_ENV = "development";

    process.env.USER_USERNAME = "TEST-ADMIN";
    assert.match(getAuthConfigurationError().message, /harus berbeda/);
    process.env.USER_USERNAME = "test-user";

    process.env.UPSTASH_REDIS_REST_URL = "http://do-not-echo-this.invalid";
    const invalidUrlError = getAuthConfigurationError();
    assert.match(invalidUrlError.message, /UPSTASH_REDIS_REST_URL/);
    assert.doesNotMatch(invalidUrlError.message, /do-not-echo-this/);
    process.env.UPSTASH_REDIS_REST_URL = "https://test-session-db.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = " test-only-token";
    assert.match(getAuthConfigurationError().message, /UPSTASH_REDIS_REST_TOKEN/);
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-only-token";

    Redis.fromEnv = () => ({
      async set(key, value) { sessions.set(key, value); return "OK"; },
      async get(key) {
        const value = sessions.get(key);
        if (value === undefined) return null;
        // Match @upstash/redis default JSON response parsing (GET "1" => number 1).
        try { return JSON.parse(value); } catch { return value; }
      },
      async del(key) { return sessions.delete(key) ? 1 : 0; }
    });

    assert.equal(getAuthConfigurationError(), null);
    assert.equal(await verifyPassword("test-admin", password), "admin");
    assert.equal(await verifyPassword("test-user", "test-only-user-password"), "user");
    assert.equal(await verifyPassword("test-admin", "wrong-test-password"), null);
    assert.equal(await verifyPassword("unknown-user", password), null);

    const unauthorized = response();
    assert.equal(await requireAuth({ headers: {}, socket: {} }, unauthorized), null);
    assert.equal(unauthorized.statusCode, 401);

    const filesHandler = require("../api/files");
    const apiUnauthorized = response();
    await filesHandler({ method: "GET", headers: {}, socket: {}, query: {} }, apiUnauthorized);
    assert.equal(apiUnauthorized.statusCode, 401);

    const loginResponse = response();
    const secureRequest = { headers: { "x-forwarded-proto": "https" }, socket: {} };
    await setSession(secureRequest, loginResponse, process.env.ADMIN_USERNAME);
    assert.match(loginResponse.headers["Set-Cookie"], /HttpOnly/);
    assert.match(loginResponse.headers["Set-Cookie"], /SameSite=Lax/);
    assert.match(loginResponse.headers["Set-Cookie"], /Max-Age=28800/);
    assert.match(loginResponse.headers["Set-Cookie"], /; Secure/);

    const token = loginResponse.headers["Set-Cookie"].split(";", 1)[0].slice("fm_session=".length);
    const authenticated = response();
    assert.deepEqual(
      await requireAuth({ headers: { cookie: `fm_session=${token}` }, socket: {} }, authenticated),
      { username: "test-admin", role: "admin" }
    );

    const userLoginResponse = response();
    await setSession(secureRequest, userLoginResponse, process.env.USER_USERNAME);
    const userToken = userLoginResponse.headers["Set-Cookie"].split(";", 1)[0].slice("fm_session=".length);
    const authenticatedUser = response();
    assert.deepEqual(
      await requireAuth({ headers: { cookie: `fm_session=${userToken}` }, socket: {} }, authenticatedUser),
      { username: "test-user", role: "user" }
    );
    await clearSession(
      { headers: { cookie: `fm_session=${userToken}` }, socket: {} },
      response()
    );

    const logoutResponse = response();
    await clearSession({ headers: { cookie: `fm_session=${token}`, "x-forwarded-proto": "https" }, socket: {} }, logoutResponse);
    assert.match(logoutResponse.headers["Set-Cookie"], /SameSite=Lax/);
    assert.match(logoutResponse.headers["Set-Cookie"], /Max-Age=0/);
    assert.match(logoutResponse.headers["Set-Cookie"], /; Secure/);
    assert.equal(sessions.size, 0);

    const revoked = response();
    assert.equal(await requireAuth({ headers: { cookie: `fm_session=${token}` }, socket: {} }, revoked), null);
    assert.equal(revoked.statusCode, 401);

    const localLoginResponse = response();
    await setSession({ headers: {}, socket: {} }, localLoginResponse, process.env.ADMIN_USERNAME);
    assert.match(localLoginResponse.headers["Set-Cookie"], /SameSite=Lax/);
    assert.doesNotMatch(localLoginResponse.headers["Set-Cookie"], /; Secure/);
  } finally {
    Redis.fromEnv = originalFromEnv;
    for (const [name, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
