---
name: xlsx-reader
description: Read .xlsx/.xls spreadsheets (test cases, checklists, requirement matrices) into Markdown tables so an agent can ingest them. Use when the user provides an Excel file of test cases or requirements, or asks to import a spreadsheet.
license: Apache-2.0
compatibility: Requires Node.js 18+ and the `xlsx` npm package (install on demand via `npm i xlsx` or `npx`).
metadata:
  author: octobots
  version: "0.1.0"
---

# xlsx-reader

Converts every sheet in an `.xlsx` or `.xls` workbook into a Markdown table (first row = header) so that an LLM agent can read and reason over spreadsheet content without needing a binary parser.

## When to use

- The user drops an Excel file of test cases, a requirements matrix, or a QA checklist into the conversation.
- A task requires reading structured tabular data from a `.xlsx` / `.xls` source (e.g. "import these test cases", "summarise this checklist").
- You need machine-readable rows from a spreadsheet before feeding them to another skill (e.g. `xray-testing`, `test-case-analysis`).

## Usage

```bash
node scripts/read_xlsx.js <input.xlsx> [output.md]
```

- **Sheet → table** — each sheet becomes an `## SheetName` section followed by a GitHub-Flavoured Markdown table; the first row is used as the header row.
- **Stdout vs file** — omit `output.md` to print the Markdown to stdout (pipe-friendly); supply a path to write to a file instead.
- **Missing package** — if the `xlsx` npm package is not installed the script exits with a clear message: `Install it with: npm i xlsx`.

## Notes

- After writing to a file, read the produced Markdown back with the `Read` tool to bring the content into the agent's context.
- For large workbooks with many sheets, convert only the relevant sheet by trimming the output or adjusting the script's `SheetNames` filter — avoid overwhelming the context window.
