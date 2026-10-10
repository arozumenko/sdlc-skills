# Pricing rules

All amounts are integer cents.

1. **Subtotal** = sum of `unitPrice × qty` over the order lines.
2. **Coupon `SAVE10`** takes 10% off the subtotal, capped at 1500 cents off.
3. **Members** get 5% off the amount *after* the coupon (or off the subtotal when there is no coupon).
4. The total is rounded to the nearest cent **once**, at the end (`Math.round`).

Examples:

| subtotal | coupon | member | total |
|---|---|---|---|
| 10000 | – | no | 10000 |
| 10000 | SAVE10 | no | 9000 |
| 10000 | – | yes | 9500 |
| 20000 | SAVE10 | no | 18500 |
