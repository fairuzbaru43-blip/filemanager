const { requireAuth } = require("../lib/auth");
module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Metode tidak diizinkan." });
  const user = await requireAuth(req, res);
  if (!user) return;
  return res.status(200).json(user);
};
