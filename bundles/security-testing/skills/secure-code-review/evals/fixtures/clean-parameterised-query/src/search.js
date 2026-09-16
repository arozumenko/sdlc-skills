import { db } from "./db.js";
const NAME = /^[\p{L}\p{N} '-]{1,64}$/u;
export async function searchProducts(req, res) {
  const q = String(req.query.q || "");
  if (!NAME.test(q)) return res.status(400).json({ error: "invalid query" });
  const limit = Math.min(Number.parseInt(req.query.limit, 10) || 20, 100);
  const rows = await db.query("SELECT id, name FROM products WHERE name LIKE $1 LIMIT $2", [`%${q}%`, limit]);
  return res.json(rows);
}
