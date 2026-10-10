// Totals per customer, sorted by customer name.
export function summarize(invoices) {
  const totals = new Map();
  for (const inv of invoices) totals.set(inv.customer, (totals.get(inv.customer) ?? 0) + inv.amount);
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([customer, total]) => ({ customer, total: Math.round(total * 100) / 100 }));
}
