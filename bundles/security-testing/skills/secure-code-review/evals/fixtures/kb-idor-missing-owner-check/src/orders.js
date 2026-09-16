import { orders } from "./store.js";
import { requireUser } from "./auth.js";
export function register(router) {
  router.get("/orders/:id", requireUser, async (req, res) => {
    const order = await orders.get(req.params.id);
    if (!order) return res.status(404).end();
    return res.json(order);
  });
  router.get("/orders", requireUser, async (req, res) => {
    const mine = await orders.listByOwner(req.session.userId);
    return res.json(mine);
  });
}
