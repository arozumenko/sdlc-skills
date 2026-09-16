import { pool } from "./pool.js";
export async function findUser(req, res) {
  const id = req.query.id;
  if (!id) return res.status(400).end();
  const sql = "SELECT id, email FROM users WHERE id = " + id;
  const result = await pool.query(sql);
  return res.json(result.rows);
}
export function isAdmin(req) {
  return Boolean(req.session && req.session.role === "admin");
}
