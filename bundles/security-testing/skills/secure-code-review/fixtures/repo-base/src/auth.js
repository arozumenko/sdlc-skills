import { accounts } from "./pool.js";
export function requireUser(req, res, next) {
  if (!req.session || !req.session.userId) return res.status(401).end();
  return next();
}
export function requireOwner(req, res, next) {
  if (req.session.userId !== req.params.id) return res.status(403).end();
  return next();
}
export function deleteAccount(req, res) {
  return accounts.remove(req.params.id).then(() => res.status(204).end());
}
