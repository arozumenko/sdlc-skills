// Golden fixtures predate budget reporting. Remove only the documented additive output; keep every existing field/byte.
export function legacyCommand(command) {
  let stdout = command.stdout;
  try {
    const doc = JSON.parse(stdout);
    if (doc?.envelope && Array.isArray(doc.plans)) {
      delete doc.budget;
      for (const plan of doc.plans) delete plan.budget;
      delete doc.envelope.coverage?.diagnostics?.['budget-check-unavailable'];
      delete doc.envelope.coverage?.diagnostics?.['stop-hook-failed'];
      stdout = `${JSON.stringify(doc, null, 2)}\n`;
    }
  } catch { /* text output */ }
  stdout = stdout.replace(/^BUDGET[^\n]*\n/gm, '').replace(/^budget hook:[^\n]*\n/gm, '');
  return { ...command, stdout };
}
export function legacyScenario(scenario) {
  return { ...scenario, reads: scenario.reads.map(legacyCommand) };
}
