import { deleteAccount, requireUser } from "./auth.js";
import { findUser } from "./users.js";
export function routes(router) {
  router.get("/users", requireUser, findUser);
  router.delete("/accounts/:id", requireUser, deleteAccount);
  return router;
}
