---
suite: tasks/smoke
generated: 2026-06-09
generated_for_tc_ids: [TC-001, TC-002, TC-003, TC-004]
tc_count: 4
group_count: 1
groups:
  - group_id: G1
    tcs:
      - {id: TC-001, file: tasks/smoke/TC-001_login-sign-in-with-correct-user.md, inherit_state: false}
      - {id: TC-002, file: tasks/smoke/TC-002_product-list-shows-12-items.md, inherit_state: true}
      - {id: TC-003, file: tasks/smoke/TC-003_add-product-to-cart.md, inherit_state: true}  # any visible product
      - {id: TC-004, file: tasks/smoke/TC-004_view-cart-with-item.md, inherit_state: true}
---

# Session Plan — tasks/smoke

4 TCs → 1 session group. Resets saved: 3 (~150s).

| Group | TC | Title | inherit_state |
|-------|----|-------|--------------|
| G1 | TC-001 | Login via "Sign in with correct user" | false |
| G1 | TC-002 | Product List shows 12 items | true |
| G1 | TC-003 | Add first visible product to cart | true |
| G1 | TC-004 | View cart with item | true |

All TCs share compatible state — entire suite runs in a single session.
