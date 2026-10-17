const { clearSession } = require("../lib/auth");
module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Metode tidak diizinkan." });
  try {
    await clearSession(req, res);
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(503).json({ error: "Sesi tidak dapat dicabut saat ini. Coba lagi." });
  }
};
