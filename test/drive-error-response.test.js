const test = require("node:test");
const assert = require("node:assert/strict");
const { sendDriveError } = require("../lib/drive-error-response");

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test("Drive API diagnostics explain common failures without logging response secrets", () => {
  const originalConsoleError = console.error;
  const logs = [];
  const sensitiveMessage = "private-key-and-token-must-not-appear";

  try {
    console.error = (...args) => logs.push(args);

    const permissionResponse = response();
    sendDriveError(permissionResponse, {
      name: "GaxiosError",
      message: sensitiveMessage,
      response: {
        status: 403,
        data: { error: { message: sensitiveMessage, errors: [{ reason: "insufficientFilePermissions" }] } }
      }
    }, "Generic fallback.", "Google Drive file listing failed.");
    assert.equal(permissionResponse.statusCode, 403);
    assert.match(permissionResponse.body.error, /client_email/);

    const apiResponse = response();
    sendDriveError(apiResponse, {
      name: "GaxiosError",
      response: { status: 403, data: { error: { errors: [{ reason: "accessNotConfigured" }] } } }
    }, "Generic fallback.", "Google Drive file listing failed.");
    assert.match(apiResponse.body.error, /Drive API belum aktif/);

    assert.equal(logs.length, 2);
    assert.doesNotMatch(JSON.stringify(logs), /private-key-and-token-must-not-appear/);
    assert.deepEqual(logs[0][1], { errorType: "GaxiosError", status: 403, reason: "insufficientFilePermissions" });
  } finally {
    console.error = originalConsoleError;
  }
});

test("Drive API 404 gets a folder ID hint while unknown errors keep the generic fallback", () => {
  const notFound = response();
  sendDriveError(notFound, { code: 404 }, "Fallback.", "Drive request failed.");
  assert.equal(notFound.statusCode, 404);
  assert.match(notFound.body.error, /DRIVE_FOLDER_ID/);

  const unknown = response();
  sendDriveError(unknown, { code: "ENOTFOUND" }, "Fallback.", "Drive request failed.");
  assert.equal(unknown.statusCode, 500);
  assert.deepEqual(unknown.body, { error: "Fallback." });
});
