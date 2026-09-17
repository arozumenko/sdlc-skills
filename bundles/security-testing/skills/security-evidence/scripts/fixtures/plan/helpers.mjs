// fixtures/plan/helpers.mjs — the repo and case builders the plan.mjs tests
// share (TASK-042; cmd-plan.test.mjs, cmd-plan-admit.test.mjs,
// cmd-plan-propose.test.mjs and the case-packet tests in
// cmd-packet.test.mjs). Every repo is a temp dir from the CLI harness; every
// run is allocated by the real `run init` and scoped by the real `scope`;
// candidate cases live where the planning skill puts them,
// `<st>/cases/<slug>/TC-NNN_<slug>.md`, and are committed before the run is
// allocated so the case packet can bind them at `head_oid`.
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupAll, git, initRepo, runScript } from "../cli/harness.mjs";
import { createContext } from "../../lib/ctx.mjs";
import { TEMPLATE_PATHS } from "../../lib/engagement.mjs";
import { ensureKey } from "../../lib/keys.mjs";

export { cleanupAll, git };

export const ENV = Object.freeze({ SECURITY_EVIDENCE_NOW: "2026-09-17T10:00:00Z", SECURITY_EVIDENCE_ACTOR: "lead" });
export const ST = join(".agents", "security-testing");
/** The engagement slug of the shipped template (`my-product`) — the candidate cases' directory. */
export const SLUG = "my-product";
export const CASES_DIR = join(ST, "cases", SLUG);

const IGNORE_BLOCK = [
  "# security-testing:begin",
  ".agents/security-testing/private/",
  ".agents/security-testing/ledger/",
  ".agents/security-testing/runs/",
  ".agents/security-testing/receipts/",
  ".agents/security-testing/proposals/",
  ".agents/security-testing/handoffs/",
  ".agents/security-testing/imports/",
  ".agents/security-testing/register/",
  "reports/security/",
  "tasks/security-*/",
  "# security-testing:end",
  "",
].join("\n");

/** A committed fixture repo with the ignore block, the template engagement.md and the engagement's key. */
export function readyRepo() {
  const repo = initRepo();
  writeFileSync(join(repo, ".gitignore"), IGNORE_BLOCK);
  git(repo, ["add", ".gitignore"]);
  git(repo, ["commit", "-q", "-m", "ignore block"]);
  const st = join(repo, ST);
  mkdirSync(st, { recursive: true });
  copyFileSync(TEMPLATE_PATHS["engagement.md.template"], join(st, "engagement.md"));
  const ctx = createContext({ root: repo }, { env: { ...process.env, ...ENV } });
  ensureKey(ctx, { engagement_id: ctx.engagement().engagement_id });
  return repo;
}

/**
 * A manual-qa case whose Steps rows are `[action, expected]` pairs.
 * @param {string} id `TC-NNN`
 * @param {string[][]} rows
 * @param {{title?: string, extra?: string}} [options] `extra` is appended to the frontmatter verbatim
 */
export function caseText(id, rows, { title = "Verify security headers on the login page", extra = "" } = {}) {
  const table = rows.map(([a, e], i) => `| ${i + 1} | ${a} | ${e} |`).join("\n");
  const frontmatter = ["---", `id: ${id}`, `title: ${title}`, "priority: high", "type: regression", "module: authentication", "requirements: [SEC-REQ-004]", "tags: [security, passive]"];
  if (extra.trim() !== "") frontmatter.push(extra.trim());
  frontmatter.push("---");
  const body = [
    `# ${id}: ${title}`,
    "",
    "## Preconditions",
    "- App is accessible at `{{base_url}}`",
    "",
    "## Steps",
    "",
    "| # | Action | Expected Result |",
    "|---|---|---|",
    table,
    "",
    "## Expected Final State",
    "Unauthenticated, still on the page.",
    "",
    "## Teardown",
    "- _(nothing to clean up)_",
  ];
  return `${frontmatter.join("\n")}\n\n${body.join("\n")}\n`;
}

/** The five passive steps of the manual-qa security example (TC-SEC-001), as `[action, expected]` rows. */
export const PASSIVE_ROWS = Object.freeze([
  ["Navigate to `{{base_url}}/login`", "Login page loads, Email and Password visible"],
  ["Open the browser network panel and reload the page", "The document response for `/login` is listed"],
  ["Inspect the response headers of the `/login` document", "`Content-Security-Policy` is present"],
  ["Inspect the `Set-Cookie` headers of the `/login` document", "Every cookie carries `Secure` and `HttpOnly`"],
]);

/** Write `<st>/cases/<slug>/<name>` (creating the directory) and return its repo-relative posix path. */
export function writeCase(repo, name, text) {
  const dir = join(repo, CASES_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), text);
  return `${ST.split("\\").join("/")}/cases/${SLUG}/${name}`;
}

/** `git add -A && git commit` so the candidates are in the tree the next run's head names. */
export function commitAll(repo, message = "cases") {
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", message]);
}

export const runDir = (repo, run_id) => join(repo, ST, "runs", run_id);

export const evidence = (repo, args, env = ENV) => runScript("evidence", args, { cwd: repo, env });
export const plan = (repo, args, env = ENV) => runScript("plan", args, { cwd: repo, env });

/** `run init --kind <kind>` then `scope`; returns the run id. */
export async function scopedRun(repo, kind = "assessment") {
  const init = await evidence(repo, ["run", "init", "--kind", kind, ...(kind === "review" ? ["--base", "HEAD"] : [])]);
  if (init.code !== 0) throw new Error(`run init: ${init.stdout}${init.stderr}`);
  const run_id = /^RUN (\S+)/.exec(init.stdout)[1];
  const scope = await evidence(repo, ["scope", "--run", run_id]);
  if (scope.code !== 0) throw new Error(`scope: ${scope.stdout}${scope.stderr}`);
  return run_id;
}

/** Drop a payload-only receipt into the drop-box and admit it with `receipt validate`; returns the admitted receipt's sha256. */
export async function admitReceipt(repo, run_id, payload, name = `receipt-${payload.subject_id.slice(0, 12)}-${payload.assertion}.json`) {
  const dir = join(repo, ST, "receipts", run_id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), JSON.stringify(payload));
  const r = await evidence(repo, ["receipt", "validate", "--run", run_id, join(ST, "receipts", run_id, name)]);
  if (r.code !== 0) throw new Error(`receipt validate: ${r.stdout}${r.stderr}`);
  return /^RECEIPT admitted sha256=([0-9a-f]{64})/m.exec(r.stdout)[1];
}

/** `packet --kind subject --type case --subject <path>…`; returns `{sha256, subject_ids, path}` from the PACKET line and the artifact. */
export async function casePacket(repo, run_id, paths) {
  const r = await evidence(repo, ["packet", "--run", run_id, "--kind", "subject", "--type", "case", ...paths.flatMap((p) => ["--subject", p])]);
  if (r.code !== 0) throw new Error(`packet: ${r.stdout}${r.stderr}`);
  const m = /^PACKET (\S+) sha256=([0-9a-f]{64}) kind=subject files=([0-9]+)$/m.exec(r.stdout);
  return { path: m[1], sha256: m[2], files: Number(m[3]), stdout: r.stdout };
}
