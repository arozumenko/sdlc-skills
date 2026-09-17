// TASK-053 — four-target + two-skill smoke, documented (plan §5 G28, spec §13
// M5 "smoke (four targets + two-skill)", US-047).
//
// Opt-in: `SDLC_SMOKE=1 npm test`. Without it the five installs skip with a
// message so `npm test` stays fast; the README comparison below runs on
// every `npm test` regardless, so the documented commands and the executed
// ones cannot drift apart (US-047 "README section matches the script's
// commands (test compares)").
//
// Built on the TASK-056 offline harness and the TASK-038 e2e helpers:
// nothing here runs the scripts of this checkout — every install is
// `node bin/init.mjs <args>` into an empty temp directory (holding only a
// consumer `CLAUDE.md`, so the CLAUDE.md splice path is exercised as well as
// the AGENTS.md one), with one local bare fixture remote serving both
// externals and every `https://github.com/` URL rewritten to an unreachable
// path. The five installs and what each asserts:
//
//   init --factory security-testing --target claude   directories under
//        .claude/agents/<role>/ (AGENT.md + SOUL.md), no SKILLS-INJECTED
//   init --factory security-testing --target cursor   directories under
//        .cursor/agents/<role>/, SKILLS-INJECTED block present
//   init --factory security-testing --target codex    flat TOML
//        .codex/agents/<role>.toml, no directory form
//   init --factory security-testing --target copilot  flat
//        .github/agents/<role>.agent.md, SKILLS-INJECTED block present
//   every factory install: `<!-- FACTORY:security-testing START/END -->`
//        spliced once into AGENTS.md (created) and CLAUDE.md (appended,
//        the consumer's own text kept), one briefing per role under
//        .agents/memory/<role>/project_briefing.md byte-equal to
//        bundles/security-testing/briefings/<role>.md, the six local skills
//        + the scripts under <target>/skills/, the README's expected lines
//        in the installer output, no https fetch
//   init --skills security-testing/secure-code-review,security-testing/security-evidence
//        no agents, no seed; then STANDALONE_SEQUENCE run through `check`
//        ⇒ CONSISTENT / CURRENT / ORIGIN: unauthenticated / KEY: available,
//        and the executed command names equal the sequence's prefix ending
//        at `evidence.mjs check`
//
// Every child is execFile with an argv array, shell:false, explicit cwd and
// env (G-6); fixture repos are built by code into temp dirs (G-12); nothing
// reads the network (G-14). No token added to lib/tokens.mjs by this task.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readArtifact } from "./canon.mjs";
import { KNOWLEDGE_FILES } from "./lib/engagement.mjs";
import { assertNoNetwork, createOfflineInstall, runInstaller } from "./fixtures/offline/harness.mjs";
import { BASE_FILES, CLAIM, FINDING_PATH } from "./fixtures/repo/build.mjs";
import {
  PRODUCT_EXTRA_FILES,
  PRODUCT_RECORD,
  ROSTER_EXTERNALS,
  ST,
  STANDALONE_SEQUENCE,
  TARGET_DIRS,
  buildProductRepo,
  commitAll,
  editEngagement,
  gitEnvFor,
  installedScripts,
  lines,
  makeRunner,
  parsePacketLine,
  parseRunLine,
} from "./fixtures/e2e/helpers.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLE_ROOT = resolve(HERE, "..", "..", "..");
const README = join(BUNDLE_ROOT, "README.md");
const FACTORY_ID = "security-testing";
const SKIP = process.env.SDLC_SMOKE === "1" ? false : "set SDLC_SMOKE=1 to run the four-target + two-skill smoke (five offline installs)";

/** The consumer-facing spelling of every command the README's smoke block carries; the test runs the same argv through `node bin/init.mjs`. */
export const NPX_PREFIX = "npx github:arozumenko/sdlc-skills";

/** The roles and the six local skills the final manifest installs (plan §4.8 "Final"). */
export const ROSTER = Object.freeze(["security-lead", "threat-modeler", "security-reviewer"]);
export const LOCAL_SKILLS = Object.freeze(["security-evidence", "security-engagement", "threat-modeling", "secure-code-review", "security-test-planning", "risk-register"]);

/** The four hosts and the native shape each must land (bin/init.mjs TARGETS; `injected` = a SKILLS-INJECTED block in the agent file). */
export const TARGET_SHAPES = Object.freeze({
  claude: Object.freeze({ shape: "directory", agentFile: (role) => `.claude/agents/${role}/AGENT.md`, injected: false }),
  cursor: Object.freeze({ shape: "directory", agentFile: (role) => `.cursor/agents/${role}/AGENT.md`, injected: true }),
  codex: Object.freeze({ shape: "toml", agentFile: (role) => `.codex/agents/${role}.toml`, injected: false }),
  copilot: Object.freeze({ shape: "flat", agentFile: (role) => `.github/agents/${role}.agent.md`, injected: true }),
});

export const TWO_SKILLS = `${FACTORY_ID}/secure-code-review,${FACTORY_ID}/security-evidence`;

/**
 * The five installs, in README order: four factory installs (one per host)
 * and the two-skill standalone install. `args` is the argv handed to
 * `bin/init.mjs`; the README spells each as `${NPX_PREFIX} ${args.join(" ")}`.
 */
export const SMOKE_INSTALLS = Object.freeze([
  ...Object.keys(TARGET_SHAPES).map((target) => Object.freeze({ kind: "factory", target, args: Object.freeze(["init", "--factory", FACTORY_ID, "--target", target, "--yes"]) })),
  Object.freeze({ kind: "skills", target: "claude", args: Object.freeze(["init", "--skills", TWO_SKILLS, "--target", "claude", "--yes"]) }),
]);

/** The fenced blocks the README's install section carries, each preceded by its `<!-- smoke:<name> -->` marker. */
export const README_BLOCKS = Object.freeze(["commands", "expected-factory", "expected-skills", "expected-check"]);

/** The lines of the fenced block that follows `<!-- smoke:<name> -->` in `text` (the fence's info string is ignored). */
export function readmeBlock(text, name) {
  const marker = `<!-- smoke:${name} -->`;
  const at = text.indexOf(marker);
  if (at < 0) throw new Error(`README: no ${marker}`);
  const m = /^```[^\n]*\n([\s\S]*?)\n```$/m.exec(text.slice(at + marker.length));
  if (!m) throw new Error(`README: no fenced block after ${marker}`);
  return m[1].split("\n");
}

const CONSUMER_CLAUDE_MD = "# CLAUDE\n\nconsumer notes that must survive the splice\n";
const PRODUCT_FILES = Object.freeze({ ...BASE_FILES, ...PRODUCT_EXTRA_FILES });
const START = `<!-- FACTORY:${FACTORY_ID} START -->`;
const END = `<!-- FACTORY:${FACTORY_ID} END -->`;
const count = (text, needle) => text.split(needle).length - 1;

const harnesses = [];
after(() => {
  for (const h of harnesses) h.cleanup();
});

// ---------------------------------------------------------------------------
// always on: the README's fenced command block is the script's command list

test("README smoke block: the fenced commands equal SMOKE_INSTALLS, in order", () => {
  const text = readFileSync(README, "utf8");
  const documented = readmeBlock(text, "commands");
  const executed = SMOKE_INSTALLS.map((i) => `${NPX_PREFIX} ${i.args.join(" ")}`);
  assert.deepEqual(documented, executed, "README <!-- smoke:commands --> block vs SMOKE_INSTALLS");
  // one install per host, then the two-skill one; every host of TARGET_SHAPES covered exactly once
  assert.deepEqual(SMOKE_INSTALLS.filter((i) => i.kind === "factory").map((i) => i.target), Object.keys(TARGET_SHAPES));
  assert.equal(SMOKE_INSTALLS.at(-1).kind, "skills");
  for (const name of README_BLOCKS) assert.ok(readmeBlock(text, name).length > 0, `README carries a non-empty <!-- smoke:${name} --> block`);
  // the two-skill install is the D12 pair, spelled with the factory qualifier
  assert.equal(TWO_SKILLS, "security-testing/secure-code-review,security-testing/security-evidence");
});

test("readmeBlock reads the fenced block after its marker and nothing else", () => {
  const text = "intro\n\n<!-- smoke:commands -->\n```bash\none\ntwo\n```\n\n<!-- smoke:expected-check -->\n```text\nCONSISTENT\n```\n";
  assert.deepEqual(readmeBlock(text, "commands"), ["one", "two"]);
  assert.deepEqual(readmeBlock(text, "expected-check"), ["CONSISTENT"]);
  assert.throws(() => readmeBlock(text, "expected-skills"), /no <!-- smoke:expected-skills -->/);
});

// ---------------------------------------------------------------------------
// opt-in: the five installs

/** A consumer directory (empty unless the caller built one) holding a CLAUDE.md; runs `bin/init.mjs <args>` in it offline. */
async function installInto(h, name, args) {
  const dir = join(h.tmpRoot, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "CLAUDE.md"), CONSUMER_CLAUDE_MD);
  const r = await runInstaller({ env: h.env, cwd: dir, args: [...args] });
  const out = r.stdout + r.stderr;
  assert.equal(r.code, 0, `${name}: installer exit ${r.code}\n${out}`);
  assertNoNetwork(out);
  assert.ok(!/external fetch failed|not in skills\.json|pending content|\(missing/.test(out), `${name}: every item resolved\n${out}`);
  return { dir, out, outLines: lines(out).map((l) => l.trim()) };
}

const expectLines = (outLines, expected, what) => {
  for (const line of expected) assert.ok(outLines.includes(line), `${what}: expected output line missing: ${line}`);
};

test("four targets: native shapes, FACTORY splice, briefings, README's expected lines", { skip: SKIP }, async () => {
  const h = createOfflineInstall({ externals: ROSTER_EXTERNALS });
  harnesses.push(h);
  const expected = readmeBlock(readFileSync(README, "utf8"), "expected-factory");
  const summary = [];
  for (const install of SMOKE_INSTALLS.filter((i) => i.kind === "factory")) {
    const { target } = install;
    const shape = TARGET_SHAPES[target];
    const { dir, out, outLines } = await installInto(h, `factory-${target}`, install.args);
    expectLines(outLines, expected, target);
    // the native agent shape, one file per role
    const agentsDir = join(dir, TARGET_DIRS[target], "agents");
    for (const role of ROSTER) {
      const file = join(dir, shape.agentFile(role));
      assert.ok(existsSync(file), `${target}: ${shape.agentFile(role)}`);
      const text = readFileSync(file, "utf8");
      if (shape.shape === "toml") {
        assert.match(text, new RegExp(`^name = "${role}"$`, "m"), `${target}: ${role} TOML name`);
        assert.match(text, /^developer_instructions = '''$/m, `${target}: ${role} TOML body`);
        assert.ok(!existsSync(join(agentsDir, role)), `${target}: ${role} has no directory form`);
      } else {
        assert.match(text, new RegExp(`^name: ${role}$`, "m"), `${target}: ${role} frontmatter`);
      }
      if (shape.shape === "directory") {
        for (const f of ["AGENT.md", "SOUL.md", "RULES.md"]) assert.ok(existsSync(join(agentsDir, role, f)), `${target}: ${role}/${f}`);
        assert.equal(readFileSync(join(agentsDir, role, "SOUL.md"), "utf8"), readFileSync(join(BUNDLE_ROOT, "agents", role, "SOUL.md"), "utf8"), `${target}: ${role}/SOUL.md is the bundle's copy`);
      }
      if (shape.shape === "flat") assert.ok(!existsSync(join(agentsDir, role)), `${target}: ${role} is flat, no directory`);
      assert.equal(text.includes("<!-- SKILLS-INJECTED: START -->"), shape.injected, `${target}: ${role} SKILLS-INJECTED ${shape.injected ? "present" : "absent"}`);
      if (shape.injected) assert.ok(text.includes("<!-- SKILLS-INJECTED: END -->"), `${target}: ${role} SKILLS-INJECTED closed`);
      // the briefing lands IDE-neutrally, byte-equal to the factory's file
      const briefing = join(dir, ".agents", "memory", role, "project_briefing.md");
      assert.ok(existsSync(briefing), `${target}: ${role} briefing`);
      assert.equal(readFileSync(briefing, "utf8"), readFileSync(join(BUNDLE_ROOT, "briefings", `${role}.md`), "utf8"), `${target}: ${role} briefing is briefings/${role}.md`);
    }
    const agentEntries = readdirSync(agentsDir).sort();
    assert.deepEqual(agentEntries, ROSTER.map((r) => (shape.shape === "directory" ? r : shape.agentFile(r).split("/").pop())).sort(), `${target}: exactly the three roles`);
    // the six local skills and the scripts
    const skillsDir = join(dir, TARGET_DIRS[target], "skills");
    for (const s of LOCAL_SKILLS) assert.ok(existsSync(join(skillsDir, s, "SKILL.md")), `${target}: skill ${s}`);
    for (const f of ["evidence.mjs", "verify.mjs", "register.mjs", "tm-lint.mjs", "plan.mjs", "version.json"]) assert.ok(existsSync(join(skillsDir, "security-evidence", "scripts", f)), `${target}: scripts/${f}`);
    // the FACTORY splice: AGENTS.md created, CLAUDE.md appended after the consumer's text, one block each
    const agentsMd = readFileSync(join(dir, "AGENTS.md"), "utf8");
    const claudeMd = readFileSync(join(dir, "CLAUDE.md"), "utf8");
    for (const [name, text] of [["AGENTS.md", agentsMd], ["CLAUDE.md", claudeMd]]) {
      assert.equal(count(text, START), 1, `${target}: ${name} has one ${START}`);
      assert.equal(count(text, END), 1, `${target}: ${name} has one ${END}`);
      assert.ok(text.indexOf(START) < text.indexOf(END), `${target}: ${name} START precedes END`);
      assert.ok(!text.includes(`<!-- BUNDLE:${FACTORY_ID}`), `${target}: ${name} writes the FACTORY form only`);
    }
    assert.ok(claudeMd.startsWith(CONSUMER_CLAUDE_MD), `${target}: the consumer's CLAUDE.md text leads`);
    assert.ok(agentsMd.startsWith("# AGENTS\n"), `${target}: AGENTS.md created with its title`);
    const body = readFileSync(join(BUNDLE_ROOT, "instructions.md"), "utf8").trim();
    assert.ok(agentsMd.includes(`${START}\n${body}\n${END}`), `${target}: AGENTS.md block is instructions.md verbatim`);
    // the knowledge seed
    for (const n of KNOWLEDGE_FILES) assert.ok(existsSync(join(dir, ST, "knowledge", n)), `${target}: knowledge/${n} seeded`);
    summary.push(`${target}: ${outLines.find((l) => l.startsWith("Done: "))} agents=${shape.shape} injected=${shape.injected} splice=AGENTS.md+CLAUDE.md briefings=${ROSTER.length}`);
    assert.ok(!/https:\/\//.test(out));
  }
  console.log(`SMOKE factory installs\n  ${summary.join("\n  ")}`);
});

/** Payload-only file into the agent drop-box of `run_id` (TL-4); returns the repo-relative path. */
function drop(project, run_id, name, payload) {
  const box = join(project, ST, "receipts", run_id);
  mkdirSync(box, { recursive: true });
  writeFileSync(join(box, name), `${JSON.stringify(payload, null, 2)}\n`);
  return join(ST, "receipts", run_id, name);
}

const ok = (r, what) => {
  assert.equal(r.code, 0, `${what}: exit ${r.code}\n${r.stdout}${r.stderr}`);
  return r;
};

test("two-skill install: STANDALONE_SEQUENCE through check ⇒ CONSISTENT, README's expected lines", { skip: SKIP }, async () => {
  const h = createOfflineInstall({ externals: [] });
  harnesses.push(h);
  const readme = readFileSync(README, "utf8");
  const install = SMOKE_INSTALLS.at(-1);
  // the product repo first (base commit), the install on top of it, then the install committed: a clean tree at HEAD
  const genv = gitEnvFor(h.env);
  const project = join(h.tmpRoot, "two-skill");
  buildProductRepo(project, genv, PRODUCT_FILES);
  const { dir, outLines } = await installInto(h, "two-skill", install.args);
  assert.equal(dir, project);
  expectLines(outLines, readmeBlock(readme, "expected-skills"), "two-skill");
  assert.ok(!existsSync(join(dir, ".claude", "agents")), "no roster in the two-skill shape");
  assert.ok(!existsSync(join(dir, ST)), "no seed without --factory (D12)");
  assert.ok(!existsSync(join(dir, "AGENTS.md")) && !readFileSync(join(dir, "CLAUDE.md"), "utf8").includes(START), "no FACTORY splice without --factory");
  assert.deepEqual(readdirSync(join(dir, ".claude", "skills")).sort(), ["secure-code-review", "security-evidence"], "exactly the two skills");

  commitAll(project, "install security-testing (two skills)", genv);
  const runner = makeRunner({ projectDir: project, scriptsDir: installedScripts(project, "claude"), harnessEnv: h.env });

  // 1. engagement init, twice (EDIT-ENGAGEMENT-AND-RERUN, then 0) — the templates written by step 0 itself (D12)
  const first = await runner.run("evidence", ["engagement", "init"]);
  assert.equal(first.code, 2, `first engagement init: ${first.stdout}${first.stderr}`);
  assert.equal(lines(first.stdout).at(-1), "EDIT-ENGAGEMENT-AND-RERUN");
  assert.equal(lines(first.stdout)[0], `TEMPLATES: ${KNOWLEDGE_FILES.map((n) => `${n}=written`).join(" ")}`);
  editEngagement(project, PRODUCT_RECORD);
  const second = ok(await runner.run("evidence", ["engagement", "init"]), "second engagement init");
  assert.deepEqual(lines(second.stdout).slice(1, 3), ["ENGAGEMENT: present", "IGNORE-BLOCK: written"]);
  // 2–4. run init --kind review, scope, packet --kind scope
  const review = parseRunLine(ok(await runner.run("evidence", ["run", "init", "--kind", "review", "--base", "HEAD"]), "run init").stdout);
  assert.equal(review.kind, "review");
  const s = ok(await runner.run("evidence", ["scope", "--run", review.run_id]), "scope");
  assert.match(lines(s.stdout)[0], /^SCOPE files=3 ranges=3 skipped=0 snapshot=0$/);
  const scope = readArtifact(join(project, ST, "runs", review.run_id, "scope.json"), { kind: "scope" });
  const packet = parsePacketLine(ok(await runner.run("evidence", ["packet", "--run", review.run_id, "--kind", "scope"]), "scope packet").stdout);
  assert.equal(packet.kind, "scope");
  // 5–7. the review contract's two drop-box files, gate, coverage
  const claims = drop(project, review.run_id, "claims-1.json", { scope_sha256: scope.envelope.self_sha256, packet_sha256: packet.sha256, findings: [CLAIM] });
  const g = ok(await runner.run("evidence", ["gate", "--run", review.run_id, "--claims", claims]), "gate");
  assert.equal(lines(g.stdout)[0], "GATE accepted=1 unverifiable=0 rejected=0 unlocated=0");
  const declared = scope.payload.files.filter((f) => (scope.payload.ranges[f.path] ?? []).length > 0).map((f) => ({ path: f.path, ranges: scope.payload.ranges[f.path] }));
  const examined = drop(project, review.run_id, "examined-1.json", { packet_sha256: packet.sha256, declared });
  const c = ok(await runner.run("evidence", ["coverage", "--run", review.run_id, "--examined", examined]), "coverage");
  assert.equal(lines(c.stdout)[0], "COVERAGE examined=3 skipped=0 scanner=0");
  // 8–9. a subject packet + a confirmed vulnerability-review receipt admitted through receipt validate
  const claimed = readArtifact(join(project, ST, "runs", review.run_id, "findings.claimed.json"), { kind: "claimed" });
  const finding = claimed.payload.findings.find((f) => f.path === FINDING_PATH);
  assert.ok(finding, "the injection finding was gated");
  const sp = parsePacketLine(ok(await runner.run("evidence", ["packet", "--run", review.run_id, "--kind", "subject", "--subject", finding.id]), "subject packet").stdout);
  const receipt = drop(project, review.run_id, "receipt-1.json", { type: "vulnerability-review", subject_id: finding.id, packet_sha256: sp.sha256, assertion: "confirmed", reviewer_run_id: review.run_id });
  const rv = ok(await runner.run("evidence", ["receipt", "validate", "--run", review.run_id, receipt]), "receipt validate");
  assert.match(lines(rv.stdout)[0], new RegExp(`^RECEIPT admitted sha256=[0-9a-f]{64} type=vulnerability-review subject=${finding.id}$`));
  // 10–11. build-report --template review, check --integrity --drift
  const br = ok(await runner.run("evidence", ["build-report", "--run", review.run_id, "--template", "review"]), "build-report");
  assert.deepEqual(lines(br.stdout).map((l) => l.split(" ")[0]), ["REPORT", "MANIFEST", "COMMITTED"]);
  const ck = ok(await runner.run("evidence", ["check", join(ST, "runs", review.run_id), "--integrity", "--drift"]), "check");
  const expectedCheck = readmeBlock(readme, "expected-check");
  assert.deepEqual(lines(ck.stdout), expectedCheck, "check output is the README's expected-check block");
  assert.equal(lines(ck.stdout)[0], "CONSISTENT");
  // the executed command names are exactly the sequence's prefix ending at `evidence.mjs check`
  const upToCheck = STANDALONE_SEQUENCE.slice(0, STANDALONE_SEQUENCE.indexOf("evidence.mjs check") + 1);
  assert.equal(upToCheck.length, 9);
  assert.deepEqual(runner.executedSequence(), upToCheck);
  assert.deepEqual(runner.log.map((e) => e.code).filter((c) => c !== 0), [2], "the only non-zero exit is the first engagement init");
  console.log(`SMOKE two-skill\n  ${outLines.find((l) => l.startsWith("Done: "))}; sequence=${upToCheck.length}/${STANDALONE_SEQUENCE.length} through check ⇒ ${lines(ck.stdout).join(" | ")}`);
});
