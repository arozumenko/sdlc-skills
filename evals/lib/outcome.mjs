// Separate failures of the task from failures to execute/measure the task.
// Budget limits remain scored failures; account/tooling failures stop the run.
export function classifyExecution(proc, metrics) {
  if (proc.timedOut) return { status: "timeout", scored: true, pass: false };
  if (metrics.stopReason === "error_max_budget_usd") return { status: "budget-exhausted", scored: true, pass: false };
  if (proc.code === 0 && !metrics.isError) return null;
  const message = `${metrics.finalText ?? ""}\n${proc.stderr ?? ""}`;
  if (/you['’]ve hit your (?:weekly|daily|usage|rate) limit|usage limit reached|rate_limit_error|insufficient_quota/i.test(message)) {
    return { status: "quota-limit", scored: false, pass: false };
  }
  if (/authentication (?:failed|required)|invalid (?:api key|authentication)|not logged in|unauthorized/i.test(message)) {
    return { status: "authentication-error", scored: false, pass: false };
  }
  return { status: "execution-error", scored: false, pass: false };
}

export function trialOutcome(proc, metrics, grade, judge) {
  const execution = classifyExecution(proc, metrics);
  if (execution) return execution;
  if (grade.checks?.some(c => c.id === "grader-crashed")) return { status: "grader-error", scored: false, pass: false };
  if (judge?.error) return { status: "judge-error", scored: false, pass: false };
  const pass = grade.pass && (judge ? judge.pass : true);
  return { status: pass ? "passed" : "failed", scored: true, pass };
}

export function shouldStopRun(record) { return record.scored === false; }
