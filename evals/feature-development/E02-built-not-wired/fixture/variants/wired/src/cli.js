#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { summarize } from "./report.js";
import { toCsv } from "./export/csv.js";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "invoices.json");
const load = () => JSON.parse(readFileSync(DATA, "utf8"));

const commands = {
  summary() {
    for (const row of summarize(load())) console.log(`${row.customer}\t${row.total.toFixed(2)}`);
  },
  export(args) {
    if (!args.includes("--csv")) {
      console.error("export: only --csv is supported");
      process.exit(2);
    }
    process.stdout.write(toCsv(load()));
  },
};

const [name, ...rest] = process.argv.slice(2);
const command = commands[name];
if (!command) {
  console.error(`unknown command: ${name ?? "(none)"}`);
  console.error(`available: ${Object.keys(commands).join(", ")}`);
  process.exit(2);
}
command(rest);
