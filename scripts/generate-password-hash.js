const bcrypt = require("bcryptjs");

function readHiddenPassword(role) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    if (!input.isTTY || typeof input.setRawMode !== "function") {
      reject(new Error("Jalankan perintah ini langsung dari terminal PowerShell interaktif."));
      return;
    }

    const bytes = [];
    let finished = false;

    function finish(error) {
      if (finished) return;
      finished = true;
      input.removeListener("data", onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write("\n");
      if (error) {
        bytes.fill(0);
        reject(error);
      } else {
        resolve(Buffer.from(bytes));
        bytes.fill(0);
      }
    }

    function onData(chunk) {
      for (const byte of chunk) {
        if (byte === 3) return finish(new Error("Pembuatan hash dibatalkan."));
        if (byte === 13 || byte === 10) return finish();
        if (byte === 8 || byte === 127) {
          if (bytes.length) {
            let start = bytes.length - 1;
            while (start > 0 && (bytes[start] & 0xc0) === 0x80) start--;
            bytes.splice(start);
          }
          continue;
        }
        if (byte >= 32) bytes.push(byte);
      }
    }

    process.stdout.write(`Password ${role} baru (ketikan tersembunyi): `);
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

async function main() {
  let passwordBytes;
  try {
    const role = process.argv[2] || "admin";
    if (!["admin", "user"].includes(role)) {
      throw new Error("Pilih role admin atau user.");
    }
    passwordBytes = await readHiddenPassword(role);
    const password = passwordBytes.toString("utf8");
    if (!password || !Buffer.from(password, "utf8").equals(passwordBytes)) {
      throw new Error("Password kosong atau encoding tidak valid.");
    }
    if (passwordBytes.length > 72) {
      throw new Error("Password melebihi batas bcrypt 72 byte UTF-8.");
    }
    const hash = bcrypt.hashSync(password, 12);
    const variable = role === "admin" ? "ADMIN_PASSWORD_HASH" : "USER_PASSWORD_HASH";
    process.stdout.write(`${variable}=${hash}\n`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    passwordBytes?.fill(0);
  }
}

main();
