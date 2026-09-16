// Fixture builder for the publish / check-export tests (TASK-031). Builds, in
// a temp dir, a COMMITTED review run with the bundle's own commands — `run
// init`, `scope`, `packet --kind scope`, `gate`, `coverage`, `build-report`
// — so every profile is applied to artifacts the shipped code wrote (G-12:
// fixtures are built by code into temp dirs, never committed).
//
//   committedReviewRun({repo?, claims?, withReceipt?, before?}) → {repo, run_id, dir, ids, claimed, manifest, receipt}
//   ingestTicket(repo, run_id, ticket)   → import_sha256 of a `ticket` import naming a finding
//   registerAdd(repo, finding_id, title) → the R-id of a new open row for the finding
//   evidence(repo, argv)                 → runScript("evidence", …) with the fixed clock/actor
//   register(repo, argv)                 → runScript("register", …)
//   CLAIMS                               the default claim set: three accepted (one keyed, one
//                                        secret-class), one CITATION_FAILED
//   ENV, ST                              re-exported from the ingest setup

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readArtifact } from "../../canon.mjs";
import { git, runScript } from "../cli/harness.mjs";
import { ENV, ST, initRun, readyRepo, runDir } from "../ingest/setup.mjs";
import { DB_JS } from "../sarif/index.mjs";

export { ENV, ST, runDir };

const PACKET_LINE = /^PACKET (\S+) sha256=([0-9a-f]{64}) kind=(scope|subject) files=([0-9]+)$/;
const RECEIPT_SHA = /sha256=([0-9a-f]{64})/;

const claim = (over = {}) => ({ title: "t", class: "config", priority: "p2", confidence: 5, path: "src/app.js", side: "head", lines: [1, 1], snippet: "export const a = 1;", ...over });

/** The default claim set (see the header). Titles are the lookup keys `committedReviewRun` returns ids for. */
export const CLAIMS = Object.freeze({
  injection: claim({
    title: "sql built from req.query.id",
    class: "injection",
    priority: "p1",
    path: "src/db.js",
    lines: [3, 4],
    snippet: 'const q = "SELECT * FROM users WHERE id = " + req.query.id;\nreturn pool.query(q);',
    description: "User input reaches the query string.",
    impact: "Full read of the users table.",
    remediation: "Parameterise the query.",
    cwe: "CWE-89",
  }),
  app: claim({ title: "app export", class: "config", path: "src/app.js", lines: [1, 1], snippet: "export const a = 1;" }),
  secret: claim({ title: "credential in a comment", class: "secret", priority: "p0", path: "src/db.js", lines: [6, 6], snippet: "// password=1234", description: "A credential is committed next to the query." }),
  failed: claim({ title: "not what the file says", class: "config", priority: "p3", path: "src/db.js", lines: [7, 7], snippet: "nope();" }),
});

export const evidence = (repo, argv, env = ENV) => runScript("evidence", argv, { cwd: repo, env });
export const register = (repo, argv, env = ENV) => runScript("register", argv, { cwd: repo, env });

function ok(r, what) {
  if (r.code !== 0) throw new Error(`${what} failed (${r.code}): ${r.stdout}${r.stderr}`);
  return r;
}

const dropbox = (repo, run_id) => join(repo, ST, "receipts", run_id);

function drop(repo, run_id, name, value) {
  mkdirSync(dropbox(repo, run_id), { recursive: true });
  writeFileSync(join(dropbox(repo, run_id), name), JSON.stringify(value, null, 2));
  return join(ST, "receipts", run_id, name);
}

/**
 * A COMMITTED review run over src/app.js and src/db.js, gated over `claims`
 * (default CLAIMS), covered by a declaration over src/db.js 1-4, reported
 * with the review template.
 * `before(repo, run_id, ids)` runs after gate and coverage and before
 * build-report — the place to ingest into the still-open run (a COMMITTED
 * run refuses ingest); `ids` maps the claim keys to their gated ids.
 * @param {{repo?: string, claims?: Record<string, object>, withReceipt?: boolean, before?: (repo: string, run_id: string, ids: Record<string, string>) => Promise<void>}} [options]
 * @returns {Promise<{repo: string, run_id: string, dir: string, ids: Record<string, string>, claimed: object, manifest: object, receipt: string | null}>}
 */
export async function committedReviewRun({ repo = readyRepo(), claims = CLAIMS, withReceipt = false, before } = {}) {
  writeFileSync(join(repo, "src", "db.js"), DB_JS);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "db"]);
  const run_id = await initRun(repo, "review");
  const dir = runDir(repo, run_id);
  ok(await evidence(repo, ["scope", "--run", run_id]), "scope");
  const scope = readArtifact(join(dir, "scope.json"), { kind: "scope" });
  const p = ok(await evidence(repo, ["packet", "--run", run_id, "--kind", "scope"]), "scope packet");
  const m = PACKET_LINE.exec(p.stdout.split("\n")[0]);
  if (!m) throw new Error(`no PACKET line: ${p.stdout}`);
  const scopePacket = m[2];
  const claimsFile = drop(repo, run_id, "claims-1.json", { scope_sha256: scope.envelope.self_sha256, packet_sha256: scopePacket, findings: Object.values(claims) });
  ok(await evidence(repo, ["gate", "--run", run_id, "--claims", claimsFile]), "gate");
  const examined = drop(repo, run_id, "examined-1.json", { packet_sha256: scopePacket, declared: [{ path: "src/db.js", ranges: [[1, 4]] }] });
  ok(await evidence(repo, ["coverage", "--run", run_id, "--examined", examined]), "coverage");
  const claimed = readArtifact(join(dir, "findings.claimed.json"), { kind: "claimed" });
  const ids = {};
  for (const [key, c] of Object.entries(claims)) {
    const f = claimed.payload.findings.find((x) => x.title === c.title);
    if (!f) throw new Error(`gated finding titled ${JSON.stringify(c.title)} not found`);
    ids[key] = f.id;
  }
  let receipt = null;
  if (withReceipt) {
    const sp = ok(await evidence(repo, ["packet", "--run", run_id, "--kind", "subject", "--subject", ids.injection]), "subject packet");
    const subject = PACKET_LINE.exec(sp.stdout.split("\n")[0])[2];
    const file = drop(repo, run_id, "receipt-1.json", { type: "vulnerability-review", subject_id: ids.injection, packet_sha256: subject, assertion: "confirmed", reviewer_run_id: run_id });
    const r = ok(await evidence(repo, ["receipt", "validate", "--run", run_id, file]), "receipt validate");
    receipt = RECEIPT_SHA.exec(r.stdout)[1];
  }
  if (before) await before(repo, run_id, ids);
  ok(await evidence(repo, ["build-report", "--run", run_id, "--template", "review"]), "build-report");
  const manifest = readArtifact(join(dir, "manifest.json"), { kind: "manifest" });
  return { repo, run_id, dir, ids, claimed, manifest, receipt };
}

/**
 * Ingest a tracker ticket into the run (before build-report: a COMMITTED run
 * refuses ingest). `ticket` is the tracker JSON; the default names nothing.
 * @returns {Promise<string>} import_sha256
 */
export async function ingestTicket(repo, run_id, ticket) {
  const importsDir = join(repo, ST, "imports");
  mkdirSync(importsDir, { recursive: true });
  const name = `ticket-${Math.random().toString(16).slice(2)}.json`;
  writeFileSync(join(importsDir, name), JSON.stringify(ticket, null, 2));
  const r = ok(await evidence(repo, ["ingest", "ticket", join(ST, "imports", name), "--run", run_id]), "ingest ticket");
  const m = /import_sha256=([0-9a-f]{64})/.exec(r.stdout);
  if (!m) throw new Error(`no IMPORT line: ${r.stdout}`);
  return m[1];
}

/** `register.mjs add` for a finding; returns the new row id. */
export async function registerAdd(repo, finding_id, title, run_id) {
  const r = ok(await register(repo, ["add", "--subject", finding_id, "--priority", "p1", "--title", title, "--run", run_id]), "register add");
  const m = /^ROW (R-\d{4}) /m.exec(r.stdout);
  if (!m) throw new Error(`no ROW line: ${r.stdout}`);
  return m[1];
}
