const { requireAuth } = require("../lib/auth");
module.exports = (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Metode tidak diizinkan." });
  const username = requireAuth(req, res);
  if (!username) return;
  return res.status(200).json({ username });
};