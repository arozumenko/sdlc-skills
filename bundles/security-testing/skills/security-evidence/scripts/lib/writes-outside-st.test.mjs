// TASK-031 — "only publish --to writes outside the §4 writable paths"
// (US-023 AC-5; spec §4 body rule 2; guardrail G-5). Two halves:
//
//   static   every module under scripts/ that calls a file writer is one of a
//            closed list, and `--to` is an argv flag of cmd-publish alone
//            (`--out`, cmd-register-render's, is confined to the G-5 prefixes
//            by that command);
//   runtime  the full M1 pipeline runs IN-PROCESS under an fs spy (the
//            builtin's exports patched, then `syncBuiltinESMExports()` so
//            every module's named import sees the spy): each write, create,
//            rename, link and delete is recorded with its path, and every
//            path a non-publish command touched lies under
//            `.agents/security-testing/`, `.agents/memory/<role>/`,
//            `reports/security/` or `tasks/security-*/`, while publish's
//            paths lie under those or under its `--to`.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupAll, git } from "../fixtures/cli/harness.mjs";
import { ENV, ST, readyRepo } from "../fixtures/ingest/setup.mjs";
import { DB_JS } from "../fixtures/sarif/index.mjs";
import { main } from "./cli.mjs";

after(cleanupAll);

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = resolve(HERE, "..");

// --- static ------------------------------------------------------------------------

const WRITER_CALL = /\b(writeFileSync|writeAtomic|writeExclusive|writeArtifact|appendLine|linkSync|renameSync|appendFileSync|copyFileSync|mkdirSync)\(/;
/** Modules allowed to carry a raw or wrapped write call site (every other module writes through these or not at all). */
const KNOWN_WRITERS = Object.freeze([
  "canon.mjs",
  "lib/baseline.mjs",
  "lib/cmd-build-report.mjs",
  "lib/cmd-coverage.mjs",
  "lib/cmd-engagement.mjs",
  "lib/cmd-gate.mjs",
  "lib/cmd-ingest.mjs",
  "lib/cmd-packet.mjs",
  "lib/cmd-plan-admit.mjs", // TASK-042: <run>/admissions/<case_sha256>.json (writeArtifact) — under <st>
  "lib/cmd-plan-propose.mjs", // TASK-042: <st>/proposals/<id>.proposal.md (writeAtomic) — under <st>
  "lib/cmd-publish.mjs",
  "lib/cmd-purge.mjs",
  "lib/cmd-receipt.mjs",
  "lib/cmd-register-render.mjs",
  "lib/cmd-run-snapshot.mjs",
  "lib/cmd-run.mjs",
  "lib/cmd-scope.mjs",
  "lib/cmd-tm-lint.mjs", // TASK-039: <run>/threat-model.json + dispositions.json (writeArtifact), <run>/threat-model.md (writeExclusive) — all under <st>
  "lib/cmd-verify-all.mjs",
  "lib/ctx.mjs",
  "lib/fsx.mjs",
  "lib/imports.mjs",
  "lib/keys.mjs",
  "lib/knowledge-templates.mjs",
  "lib/ledger.mjs",
  "lib/observations.mjs", // TASK-044: <run>/observations/<id>.json (writeArtifact) — under <st>
  "lib/register-core.mjs",
  "lib/run-index.mjs",
  "lib/ta-units.mjs", // TASK-044: <run>/ta-units/<import_sha256>.json (writeExclusive) — under <st>
]);

function sources(dir, out = []) {
  for (const name of fs.readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (fs.statSync(p).isDirectory()) {
      if (name === "fixtures" || name === "node_modules") continue;
      sources(p, out);
    } else if (name.endsWith(".mjs") && !name.endsWith(".test.mjs")) out.push(p);
  }
  return out;
}

test("static: the modules with a write call site are exactly the known writers; `--to` is parsed by cmd-publish alone", () => {
  const writers = sources(SCRIPTS)
    .filter((p) => WRITER_CALL.test(fs.readFileSync(p, "utf8")))
    .map((p) => relative(SCRIPTS, p).split(sep).join("/"));
  assert.deepEqual(writers, [...KNOWN_WRITERS].sort(), "a new writer module is a review finding (G-4/G-5): add it here deliberately");
  // `--to` as a destination is cmd-publish's alone (cmd-register-transition's `alias --to <finding_id>` is an id, not a path)
  const withTo = sources(join(SCRIPTS, "lib"))
    .filter((p) => /\bto: "value"/.test(fs.readFileSync(p, "utf8")))
    .map((p) => relative(SCRIPTS, p).split(sep).join("/"));
  assert.deepEqual(withTo, ["lib/cmd-publish.mjs", "lib/cmd-register-transition.mjs"]);
  const withOut = sources(join(SCRIPTS, "lib"))
    .filter((p) => /\bout: "value"/.test(fs.readFileSync(p, "utf8")))
    .map((p) => relative(SCRIPTS, p).split(sep).join("/"));
  assert.deepEqual(withOut, ["lib/cmd-register-render.mjs"], "render's --out is confined to the G-5 prefixes by cmd-register-render");
  // a user-typed OUTPUT path is resolved (realpath + containment) in exactly two commands; ctx.mjs resolves inputs
  const resolvers = sources(SCRIPTS)
    .filter((p) => /realpathSync/.test(fs.readFileSync(p, "utf8")))
    .map((p) => relative(SCRIPTS, p).split(sep).join("/"));
  assert.deepEqual(resolvers, ["lib/cmd-publish.mjs", "lib/cmd-register-render.mjs", "lib/ctx.mjs"], "a new output-path resolver is a G-5 review finding (the ctx.output follow-up is where both belong)");
});

// --- runtime -----------------------------------------------------------------------

const WRITABLE = Object.freeze([/^\.agents\/security-testing(?:\/|$)/, /^\.agents\/memory\/[^/]+\//, /^reports\/security\//, /^tasks\/security-[^/]+\//]);
const WRITE_FLAG = /[wa+]/;

/** Patch the fs builtin so every mutating call records its target; returns {records, restore}. */
function spyFs() {
  const records = [];
  const originals = {};
  const record = (op, p) => {
    if (typeof p === "string" || Buffer.isBuffer(p) || p instanceof URL) records.push({ op, path: p instanceof URL ? fileURLToPath(p) : String(p) });
  };
  const wrap = (name, pick) => {
    originals[name] = fs[name];
    fs[name] = function (...args) {
      pick(...args);
      return originals[name].apply(this, args);
    };
  };
  wrap("writeFileSync", (p) => record("writeFileSync", p));
  wrap("appendFileSync", (p) => record("appendFileSync", p));
  wrap("mkdirSync", (p) => record("mkdirSync", p));
  wrap("mkdtempSync", (p) => record("mkdtempSync", p));
  wrap("renameSync", (a, b) => {
    record("renameSync", a);
    record("renameSync", b);
  });
  wrap("linkSync", (a, b) => {
    record("linkSync", a);
    record("linkSync", b);
  });
  wrap("symlinkSync", (a, b) => record("symlinkSync", b));
  wrap("copyFileSync", (a, b) => record("copyFileSync", b));
  wrap("rmSync", (p) => record("rmSync", p));
  wrap("rmdirSync", (p) => record("rmdirSync", p));
  wrap("unlinkSync", (p) => record("unlinkSync", p));
  wrap("openSync", (p, flags) => {
    const f = typeof flags === "string" ? flags : flags === undefined ? "r" : "w?";
    if (WRITE_FLAG.test(f)) record("openSync", p);
  });
  syncBuiltinESMExports();
  return {
    records,
    restore() {
      for (const [name, fn] of Object.entries(originals)) fs[name] = fn;
      syncBuiltinESMExports();
    },
  };
}

const USAGE = "usage: (test)\n";
const EVIDENCE = {
  run: () => import("./cmd-run.mjs"),
  scope: () => import("./cmd-scope.mjs"),
  packet: () => import("./cmd-packet.mjs"),
  gate: () => import("./cmd-gate.mjs"),
  coverage: () => import("./cmd-coverage.mjs"),
  receipt: () => import("./cmd-receipt.mjs"),
  "build-report": () => import("./cmd-build-report.mjs"),
  publish: () => import("./cmd-publish.mjs"),
  "check-export": () => import("./cmd-check-export.mjs"),
};
const REGISTER = {
  add: () => import("./cmd-register-add.mjs"),
  render: () => import("./cmd-register-render.mjs"),
};

class Sink {
  constructor() {
    this.text = "";
  }
  write(s) {
    this.text += s;
  }
}

test("runtime: a full pipeline under an fs spy — every command writes only under the §4 writable paths, publish additionally under its --to, nothing anywhere else", async () => {
  const repo = readyRepo();
  fs.writeFileSync(join(repo, "src", "db.js"), DB_JS);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "db"]);
  const env = { ...process.env, ...ENV };
  const spy = spyFs();
  const touched = []; // [{command, rel}]
  let fail = null;
  try {
    const run = async (app, argv, { cwd = repo } = {}) => {
      const stdout = new Sink();
      const stderr = new Sink();
      const before = spy.records.length;
      const code = await main({ name: app === EVIDENCE ? "evidence" : "register", usage: USAGE, commands: app }, argv, { cwd, env, stdout, stderr });
      for (const r of spy.records.slice(before)) {
        const abs = isAbsolute(r.path) ? r.path : resolve(cwd, r.path);
        const rel = relative(repo, abs).split(sep).join("/");
        touched.push({ command: argv.join(" "), op: r.op, rel });
      }
      return { code, stdout: stdout.text, stderr: stderr.text };
    };
    const ok = (r, what) => {
      if (r.code !== 0) throw new Error(`${what} failed (${r.code}): ${r.stdout}${r.stderr}`);
      return r;
    };
    const runLine = ok(await run(EVIDENCE, ["run", "init", "--kind", "review", "--base", "HEAD"]), "run init").stdout;
    const run_id = /^RUN (\S+) /.exec(runLine)[1];
    ok(await run(EVIDENCE, ["scope", "--run", run_id]), "scope");
    const packet = /sha256=([0-9a-f]{64})/.exec(ok(await run(EVIDENCE, ["packet", "--run", run_id, "--kind", "scope"]), "packet").stdout)[1];
    const { readArtifact } = await import("../canon.mjs");
    const scope = readArtifact(join(repo, ST, "runs", run_id, "scope.json"), { kind: "scope" });
    const dropbox = join(repo, ST, "receipts", run_id);
    spy.restore(); // the test's own drop-box writes are the agent's, not a command's
    fs.mkdirSync(dropbox, { recursive: true });
    fs.writeFileSync(join(dropbox, "claims-1.json"), JSON.stringify({ scope_sha256: scope.envelope.self_sha256, packet_sha256: packet, findings: [{ title: "sql", class: "injection", priority: "p1", confidence: 5, path: "src/db.js", side: "head", lines: [3, 4], snippet: 'const q = "SELECT * FROM users WHERE id = " + req.query.id;\nreturn pool.query(q);' }] }));
    fs.writeFileSync(join(dropbox, "examined-1.json"), JSON.stringify({ packet_sha256: packet, declared: [{ path: "src/db.js", ranges: [[1, 4]] }] }));
    Object.assign(spy, spyFs());
    ok(await run(EVIDENCE, ["gate", "--run", run_id, "--claims", join(ST, "receipts", run_id, "claims-1.json")]), "gate");
    ok(await run(EVIDENCE, ["coverage", "--run", run_id, "--examined", join(ST, "receipts", run_id, "examined-1.json")]), "coverage");
    ok(await run(EVIDENCE, ["build-report", "--run", run_id, "--template", "review"]), "build-report");
    const finding = readArtifact(join(repo, ST, "runs", run_id, "gate-result.json"), { kind: "gate-result" }).payload.accepted[0];
    ok(await run(REGISTER, ["add", "--subject", finding, "--priority", "p1", "--title", "sql", "--run", run_id]), "register add");
    ok(await run(REGISTER, ["render"]), "register render");
    ok(await run(EVIDENCE, ["publish", "--run", run_id, "--profile", "redacted-report", "--to", "docs/security-review"]), "publish redacted-report");
    ok(await run(EVIDENCE, ["publish", "--run", run_id, "--profile", "tracker", "--to", join(ST, "handoffs")]), "publish tracker");
    ok(await run(EVIDENCE, ["check-export", "docs/security-review/export-manifest.json", "--source", join(ST, "runs", run_id)]), "check-export");
  } catch (err) {
    fail = err;
  } finally {
    spy.restore();
  }
  if (fail) throw fail;

  assert.ok(touched.length > 20, `the spy saw the pipeline's writes (${touched.length})`);
  const outsideRepo = touched.filter((t) => t.rel === ".." || t.rel.startsWith("../") || isAbsolute(t.rel));
  assert.deepEqual(outsideRepo, [], "nothing is written outside the work tree");
  const nonPublish = touched.filter((t) => !t.command.startsWith("publish "));
  const offenders = nonPublish.filter((t) => !WRITABLE.some((re) => re.test(t.rel)));
  assert.deepEqual(offenders, [], "only publish --to writes outside the writable paths");
  const publishWrites = touched.filter((t) => t.command.startsWith("publish "));
  const publishOutside = publishWrites.filter((t) => !WRITABLE.some((re) => re.test(t.rel)));
  assert.ok(publishOutside.length > 0, "the redacted-report publish wrote under its --to (outside the writable prefixes)");
  assert.deepEqual(
    publishOutside.filter((t) => !t.rel.startsWith("docs/security-review")).map((t) => `${t.op} ${t.rel}`),
    [],
    "publish writes only under --to when it leaves the writable prefixes",
  );
  assert.ok(publishOutside.some((t) => t.rel === "docs/security-review/export-manifest.json" || t.rel.startsWith("docs/security-review/.export-manifest.json.tmp")), "the export manifest landed under --to");
  assert.deepEqual(
    touched.filter((t) => t.command.startsWith("check-export ")),
    [],
    "check-export writes nothing",
  );
  assert.ok(fs.existsSync(join(repo, "docs", "security-review", "report.md")));
});
