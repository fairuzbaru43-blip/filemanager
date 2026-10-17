const { clearSession } = require("../lib/auth");
module.exports = (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Metode tidak diizinkan." });
  clearSession(res);
  return res.status(200).json({ ok: true });
};