#!/usr/bin/env node
// read_xlsx.js — convert .xlsx/.xls sheets to Markdown tables
// Usage: node read_xlsx.js [input.xlsx] [output.md]
//   input.xlsx  — path to the spreadsheet (default: ./input.xlsx)
//   output.md   — write Markdown here; omit to print to stdout

let XLSX;
try {
  XLSX = require('xlsx');
} catch {
  console.error(
    'Error: xlsx package not found.\n' +
    'Install it with:  npm i xlsx\n' +
    'Or run once with: npx --yes xlsx'
  );
  process.exit(1);
}

const fs = require('fs');
const path = require('path');

const inputPath  = process.argv[2] || './input.xlsx';
const outputPath = process.argv[3] || null;

if (!fs.existsSync(inputPath)) {
  console.error(`Error: file not found: ${inputPath}`);
  process.exit(1);
}

const workbook = XLSX.readFile(inputPath);
const lines = [];

workbook.SheetNames.forEach(sheetName => {
  const sheet = workbook.Sheets[sheetName];
  const rows  = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  // Skip entirely empty sheets
  if (rows.length === 0) return;

  lines.push(`## ${sheetName}\n`);

  const header = rows[0].map(c => String(c).trim());
  const sep    = header.map(() => '---');

  lines.push('| ' + header.join(' | ') + ' |');
  lines.push('| ' + sep.join(' | ')    + ' |');

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i].map(c => String(c).trim().replace(/\|/g, '\\|'));
    lines.push('| ' + row.join(' | ') + ' |');
  }

  lines.push('');
});

const output = lines.join('\n');

if (outputPath) {
  fs.writeFileSync(outputPath, output, 'utf8');
  console.error(`Written to ${outputPath}`);
} else {
  process.stdout.write(output);
}
