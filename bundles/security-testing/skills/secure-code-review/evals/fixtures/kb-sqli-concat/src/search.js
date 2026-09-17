import { db } from "./db.js";
export async function searchProducts(req, res) {
  const q = req.query.q || "";
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const sql = "SELECT id, name FROM products WHERE name LIKE '%" + q + "%' LIMIT " + limit;
  const rows = await db.query(sql);
  return res.json(rows);
}
