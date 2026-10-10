// RFC 4180 CSV for the invoices ledger (T-7).
const COLUMNS = ["id", "customer", "amount", "issued"];

function field(value) {
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function toCsv(invoices) {
  const lines = [COLUMNS.join(",")];
  for (const inv of invoices) lines.push(COLUMNS.map((c) => field(inv[c])).join(","));
  return lines.join("\n") + "\n";
}
