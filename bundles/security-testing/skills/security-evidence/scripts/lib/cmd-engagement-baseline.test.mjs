// TASK-010 — `engagement baseline` (plan §4.1 row `engagement baseline`):
// atomic overwrite of private/baseline.<eid>.json, `BASELINE: <n> files
// ignored=<n>` then `WROTE …`; exit 0; 2 ENGAGEMENT-MISSING.
//
// TASK-008's cmd-engagement.mjs routes the `baseline` subcommand here; the
// module is driven directly with a ctx, the way the dispatcher will.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupAll, initRepo, SCRIPTS_DIR } from "../fixtures/cli/harness.mjs";
import { readArtifact } from "../canon.mjs";
import { CliError } from "./exit.mjs";
import { createContext } from "./ctx.mjs";
import { ensureKey } from "./keys.mjs";
import { computeBaseline } from "./baseline.mjs";
import { run } from "./cmd-engagement-baseline.mjs";

after(cleanupAll);

const NOW = "2026-09-16T10:00:00Z";
const ENGAGEMENT = JSON.parse(readFileSync(join(SCRIPTS_DIR, "fixtures", "schemas", "engagement.ok.json"), "utf8"));
const REL = ".agents/security-testing/private/baseline.eng-1.json";

function capture() {
  return { text: "", write(s) { this.text += s; } };
}

function ctxIn(repo, env = { SECURITY_EVIDENCE_NOW: NOW }) {
  const out = capture();
  const err = capture();
  const ctx = createContext({}, { cwd: repo, env, stdout: out, stderr: err });
  return { ctx, out, err };
}

function writeEngagement(repo, record = ENGAGEMENT) {
  const st = join(repo, ".agents", "security-testing");
  mkdirSync(st, { recursive: true });
  writeFileSync(join(st, "engagement.md"), `# Engagement\n\n\`\`\`json engagement\n${JSON.stringify(record, null, 2)}\n\`\`\`\n`);
}

function initialised() {
  const repo = initRepo();
  writeFileSync(join(repo, ".gitignore"), "*.log\n");
  writeFileSync(join(repo, "src", "debug.log"), "ignored\n");
  writeEngagement(repo);
  const { ctx, out, err } = ctxIn(repo);
  ensureKey(ctx, { engagement_id: "eng-1" });
  return { repo, ctx, out, err };
}

// ---------------------------------------------------------------------------

test("engagement baseline: writes private/baseline.<eid>.json, prints BASELINE then WROTE, exit 0; a re-run overwrites atomically", async () => {
  const { repo, ctx, out, err } = initialised();
  const path = join(ctx.st, "private", "baseline.eng-1.json");

  const code = await run([], ctx);

  assert.equal(code, 0);
  const first = readArtifact(path, { kind: "baseline" });
  assert.deepEqual(first.payload, computeBaseline(ctx));
  assert.equal(out.text, `BASELINE: 1 files ignored=1\nWROTE ${REL} sha256=${first.envelope.self_sha256}\n`, "§3.1: result tokens, WROTE last, sha of what is on disk");
  assert.equal(err.text, "");

  // Second run after a change: the file is replaced (tmp+rename), never appended to or left stale.
  writeFileSync(join(repo, "src", "extra.js"), "added\n");
  const again = ctxIn(repo);
  assert.equal(await run([], again.ctx), 0);
  const second = readArtifact(path, { kind: "baseline" });
  assert.notEqual(second.envelope.self_sha256, first.envelope.self_sha256);
  assert.deepEqual(Object.keys(second.payload.entries).sort(), ["src/app.js", "src/extra.js"]);
  assert.equal(again.out.text, `BASELINE: 2 files ignored=1\nWROTE ${REL} sha256=${second.envelope.self_sha256}\n`);
  assert.ok(!readdirSync(join(ctx.st, "private")).some((n) => n.includes(".tmp-")), "no tmp residue");
  assert.deepEqual(readdirSync(join(ctx.st, "private")).sort(), ["baseline.eng-1.json", "keys"], "exactly the baseline beside the key dir");
});

test("no engagement.md ⇒ ENGAGEMENT-MISSING (2), nothing written", async () => {
  const repo = initRepo();
  const { ctx, out } = ctxIn(repo);
  ensureKey(ctx, { engagement_id: "eng-1" });
  await assert.rejects(run([], ctx), (e) => e instanceof CliError && e.code === 2 && e.token === "ENGAGEMENT-MISSING");
  assert.equal(out.text, "");
  assert.deepEqual(readdirSync(join(ctx.st, "private")), ["keys"]);
  assert.equal(existsSync(join(ctx.st, "private", "baseline.eng-1.json")), false);
});

test("argv: no flags, no positionals ⇒ USAGE(baseline: …) exit 2 before anything is read or written", async () => {
  const { ctx, out } = initialised();
  await assert.rejects(run(["extra"], ctx), (e) => e instanceof CliError && e.code === 2 && /^USAGE\(baseline: unexpected argument extra\)$/.test(e.token));
  await assert.rejects(run(["--rotate"], ctx), (e) => e instanceof CliError && e.code === 2 && /^USAGE\(baseline: unknown flag --rotate\)$/.test(e.token));
  assert.equal(out.text, "");
  assert.equal(existsSync(join(ctx.st, "private", "baseline.eng-1.json")), false);
});

test("the module prints only through ctx.out / ctx.wrote and writes only through baseline.mjs", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "lib", "cmd-engagement-baseline.mjs"), "utf8");
  assert.doesNotMatch(src, /console\.|process\.stdout|writeFileSync|writeAtomic|writeExclusive/, "G-4 / one writer");
  assert.match(src, /from "\.\/baseline\.mjs"/);
  assert.match(src, /baselineLine\(/, "G-13: the token comes from tokens.mjs");
  assert.doesNotMatch(src, /"BASELINE: /, "no inline token spelling");
});
