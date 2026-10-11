#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { summarize } from "./report.js";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "invoices.json");

const commands = {
  summary() {
    const invoices = JSON.parse(readFileSync(DATA, "utf8"));
    for (const row of summarize(invoices)) console.log(`${row.customer}\t${row.total.toFixed(2)}`);
  },
};

const [name] = process.argv.slice(2);
const command = commands[name];
if (!command) {
  console.error(`unknown command: ${name ?? "(none)"}`);
  console.error(`available: ${Object.keys(commands).join(", ")}`);
  process.exit(2);
}
command();
