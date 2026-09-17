# security-testing (minimal) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `bundles/security-testing/` as three prose agents, five skills and four small scripts (`cite.mjs`, `cases.mjs`, `verify.mjs`, `register.mjs`) that enforce only what prose cannot, replacing the 22k-line reference implementation on `feat/security-testing-bundle-spec`.

**Architecture:** Each script lives in the skill whose agent runs it and is a single-file CLI over a tiny `scripts/lib/` (normalize, redact, git, engagement, cli). JSON files under `.agents/security-testing/` are the model of record; nothing is write-once; the lead writes the Markdown report from pasted `cite.mjs check --md` tables. Reusable modules are copied from the reference branch with `git show feat/security-testing-bundle-spec:<path>`, trimmed to what the spec names.

**Tech Stack:** Node ≥ 18, stdlib ESM only, `node --test`, `child_process.execFileSync/spawn` with `shell:false`; no dependencies, no build.

**Spec:** `docs/superpowers/specs/2026-09-17-security-testing-minimal-design.md` (read it first; §2 promises, §3 decisions D1–D10, §6 result lines are binding).

## Global Constraints

- Stdlib ESM Node ≥ 18; `.mjs`; sibling `*.test.mjs`; `npm test` = `node --test` at the repo root (sweeps every `*.test.mjs`); no `package.json` under a skill; no shell scripts; no network anywhere in `scripts/`.
- Every child process: `execFileSync`/`spawnSync` with an argv array and `shell: false`; test argv comes only from `engagement.md` `execute_project_tests.argv`.
- Exit codes: `0` ok · `2` usage / bad input · `4` the check failed · `5` a record is corrupt. Every command prints exactly the result lines named in spec §6; result tokens are string constants exported from the script's own `lib/tokens.mjs`-free top section (no shared token registry).
- Redaction (`lib/redact.mjs`) runs on every string a script writes to disk or stdout. Finding id = `sha256(path + "\0" + class + "\0" + redact(normalise(snippet)).text + "\0" + firstLine)` hex (D5).
- Citations are raw line numbers (D3); `MAX_RANGE_LINES = 40`; snippet compare normalises both sides with `normalizeText`.
- Agents never write `id`, `state`, `verdict`; `check` refuses files carrying them (D10). No `confirm`; every approval payload carries `authenticated: false`; no command creates a confirmed state.
- Fixtures live under `scripts/fixtures/<area>/` — never a directory named `test`; fixture git repos are built by code into `fs.mkdtempSync` dirs, never committed.
- Frontmatter: agents per `bundles/SPEC.md` (no `tools:`, no `mcpServers`), skills per agentskills.io (`name`, `description` ≤ 1024 chars starting "Use when", `license`, `metadata.version`). Catalog text never says "exact checkout".
- Commit after every task with the trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`; files under `docs/superpowers/` need `git add -f`.
- Reference branch for copied code: `REF=feat/security-testing-bundle-spec`, `REFS=bundles/security-testing/skills/security-evidence/scripts` (paths below are relative to `REFS` unless absolute).

## File structure

```
bundles/security-testing/
  factory.json  FACTORY.md  README.md  instructions.md  CHANGELOG.md
  agents/{security-lead,threat-modeler,security-reviewer}/{AGENT.md,SOUL.md,RULES.md}
  briefings/{security-lead,threat-modeler,security-reviewer}.md
  knowledge/{engagement.md.template,finding-schema.md,report-template.md}
  skills/secure-code-review/
    SKILL.md  references/{taxonomy,refutation-criteria,do-not-flag,findings-shape}.md
    evals/**  fixtures/**  scripts/score-findings.mjs(+test)            ← copied from REF
    scripts/cite.mjs  scripts/verify.mjs  (+ .test.mjs each)
    scripts/lib/{normalize,redact,git,engagement,cli,ignore-block,coverage}.mjs (+ tests)
    scripts/lib/redaction-rules.json
    scripts/fixtures/{cite,verify}/...
  skills/security-test-planning/
    SKILL.md  references/{passive-admission,audit-branch}.md
    scripts/cases.mjs (+test)  scripts/lib/{admission,redact,engagement,cli}.mjs  scripts/lib/redaction-rules.json
  skills/risk-register/
    SKILL.md  references/{transitions,approvals}.md
    scripts/register.mjs (+test)  scripts/lib/{transitions,engagement,cli}.mjs
  skills/threat-modeling/  SKILL.md  references/{dfd-elements,stride,mitigations-as-claims,dispositions}.md
  skills/security-engagement/  SKILL.md  references/{workflow,sign-off-checklist,tracker-rules}.md
bin/security-testing-e2e.test.mjs                                        ← installed E2E, offline
bin/check-skill-dupes.mjs                                                ← 3 new groups (lib copies)
README.md  AGENTS.md  bundles/SPEC.md  .claude-plugin/marketplace.json  ← catalog rows
.cursor-plugin/ .codex-plugin/ .github/plugin/                            ← regenerated
bundles/manual-qa/agents/test-run-lead/AGENT.md                          ← Step 0 row (reworded)
bundles/feature-development/skills/code-review/SKILL.md                  ← pointer line
```

`lib/engagement.mjs`, `lib/cli.mjs` are byte-identical across the three script skills and `lib/redact.mjs` + `redaction-rules.json` across two; `bin/check-skill-dupes.mjs` pins them (Task 7).

---
### Task 1: Bundle skeleton and manifest

**Files:**
- Create: `bundles/security-testing/factory.json`, `FACTORY.md`, `README.md` (front-door stub, completed in Task 12), `instructions.md`, `CHANGELOG.md`
- Create: `bundles/security-testing/knowledge/engagement.md.template`, `knowledge/finding-schema.md`, `knowledge/report-template.md`
- Create: one placeholder `SKILL.md` per skill dir and one placeholder `AGENT.md`+`SOUL.md` per agent dir so `validate:factories` sees the roster (all replaced by Tasks 9–12)
- Test: `bin/validate-factories.mjs` (existing), `bin/frontmatter-strict.test.mjs` (existing)

**Interfaces:**
- Produces: `factory.json` roster the installer and every later task rely on; the `json engagement` block shape every script reads via `lib/engagement.mjs` (Task 2).

- [ ] **Step 1: Write `factory.json`**

```json
{
  "id": "security-testing",
  "title": "Security Testing Team",
  "description": "Threat-led, read-only security testing team: code-derived STRIDE threat model, evidence-gated secure code review with re-checkable citations, passive security cases for the manual-qa and test-automation bundles, fix verification from a validated test-start snapshot, and a residual-risk register.",
  "agents": [],
  "localAgents": ["security-lead", "threat-modeler", "security-reviewer"],
  "localSkills": ["secure-code-review", "threat-modeling", "security-test-planning", "risk-register", "security-engagement"],
  "skills": ["memory", "knowledge-curation"],
  "briefings": {
    "security-lead": "briefings/security-lead.md",
    "threat-modeler": "briefings/threat-modeler.md",
    "security-reviewer": "briefings/security-reviewer.md"
  },
  "seed": { "knowledge": ".agents/security-testing/knowledge" },
  "instructions": "instructions.md"
}
```

- [ ] **Step 2: Write `FACTORY.md`** (frontmatter per `bundles/SPEC.md`; quote the description because it contains `:`)

```markdown
---
name: Security Testing Team
description: "Threat-led, read-only security testing team: code-derived STRIDE threat model, evidence-gated secure code review with re-checkable citations, passive security cases for the manual-qa and test-automation bundles, fix verification from a validated test-start snapshot, and a residual-risk register."
owner: Applied AI
authors:
  - "Daniel Sallai <zh8wnmn8x7@privaterelay.appleid.com>"
install_script: "npx github:arozumenko/sdlc-skills init --factory security-testing"
install_script_unix: "npx github:arozumenko/sdlc-skills init --factory security-testing"
sdlc_phase: Security Testing
support_level: Best Effort Support
use_cases:
  - Code-derived STRIDE threat model with file:line citations
  - Evidence-gated secure code review whose citations anyone with the repo can re-check
  - Passive security cases in manual-qa format, proposals for active testing
  - Fix verification at the fix commit with a script-emitted verdict
  - Residual-risk register with unauthenticated acceptance records and expiry
---
See [`README.md`](README.md) for the roster, install steps, and how the team works.
```

- [ ] **Step 3: Write `knowledge/engagement.md.template`** — the one file every script reads. Keep the fenced block exactly this shape; the prose around it explains each key.

````markdown
# Security engagement

Edit the block below, then re-run `cite.mjs init`. Every script reads only this block.

```json engagement
{
  "engagement_id": "my-product-2026-09",
  "slug": "my-product",
  "scope_paths": ["src/"],
  "product_paths": ["src/", "package.json"],
  "targets": { "browser": ["staging.example.com"] },
  "base_url": "https://staging.example.com",
  "execute_project_tests": { "argv": ["npm", "test"] }
}
```

- `scope_paths` — what the reviewer and modeler may cite; citations elsewhere are `FAILED(path-not-in-scope)`.
- `product_paths` — read-only posture check at sign-off (`git status --porcelain -- <scope_paths> <product_paths>` must be empty).
- `targets.browser` — hosts a passive case may name; `{{base_url}}` is always allowed.
- `execute_project_tests.argv` — the ONLY source of a test command; omit it and `verify.mjs` reports `UNVERIFIED-NO-TEST-SURFACE`.
````

- [ ] **Step 4: Write `knowledge/finding-schema.md`** — the `findings.json` shape in prose (the reviewer's contract). Copy the field table from spec §6 `cite.mjs check`: top level `{head, scope_paths, examined:[{path, lines?}], findings:[…]}`; a finding `{title, class, priority: p0|p1|p2|p3, confidence: high|medium|low, citations:[{path, oid?, lines:[s,e], snippet}], rationale, fix}`; the 15 classes are the `taxonomy.md` ids (Task 9). State that `id`, `state`, `verdict` are written by `check` and refused if present.

- [ ] **Step 5: Write `knowledge/report-template.md`** with these headings and placeholders the lead fills: `# Security assessment — <engagement_id>` · `## Identity` (repo, head oid, engagement id, `FINGERPRINT`, `TABLES sha256`) · `## Coverage` (paste) · `## Findings` (paste) · `## Threat model` (paste elements/threats/mitigations) · `## Register delta` (paste `register.mjs status`) · `## Limitations` — the spec §2 right column, verbatim.

- [ ] **Step 6: Write `instructions.md`** (spliced into the consumer's AGENTS.md/CLAUDE.md): five lines — what the team does, the three roles, "start with `claude --agent security-lead`", where artifacts live (`.agents/security-testing/`, `reports/security/`, `tasks/security-<slug>-admitted/`), and that agents never merge, close, rotate or fix.

- [ ] **Step 7: Placeholders + validate**

For each agent dir write a minimal `AGENT.md` (`---\nname: <role>\ndescription: placeholder, replaced in Task N\nmodel: sonnet\n---`) and `SOUL.md`; for each skill dir a minimal `SKILL.md` (`name`, `description: "Use when …"`, `license: MIT`, `metadata: {version: "0.1.0"}`). Run: `npm run validate:factories` → `All 5 factory(ies) valid.` (`security-testing = 3 agents`). Run `node --test bin/frontmatter-strict.test.mjs` → pass.

- [ ] **Step 8: Commit** — `git add bundles/security-testing && git commit -m "security-testing: bundle skeleton, manifest, knowledge templates"`

---

### Task 2: Shared lib — normalize, redact, git, engagement, cli

**Files:**
- Create: `bundles/security-testing/skills/secure-code-review/scripts/lib/{normalize,redact,git,engagement,cli}.mjs`, `lib/redaction-rules.json`, and `lib/{normalize,redact,git,engagement,cli}.test.mjs`
- Fixtures: `scripts/fixtures/lib/normalize-vectors.json` (copied), `scripts/fixtures/lib/secrets.txt`

**Interfaces (Produces — every later script imports these):**
- `normalizeText(input: Buffer|string): {lines: string[], text: string}` (verbatim from REF `normalize.mjs`).
- `redactString(s: string): {text: string, hits: number}`, `loadRules(path?)`, `DEFAULT_RULES`.
- `git(root, argv, {encoding?}) → {stdout, stderr, code}`, `must(root, argv)`, `toplevel(cwd)`, `revParse(root, ref)`, `showBytes(root, oid, path): Buffer`, `statusPorcelain(root, {paths}) → string[]`, `lsFiles(root, {paths}) → string[]`, `diffNameOnly(root, base, head, {paths})`, `diffUnified(root, base, head, path): string`, `mergeBaseIsAncestor(root, a, b): boolean`, `GitError`.
- `readEngagement(root) → {record, path}` throws `EngagementError` with `EDIT-ENGAGEMENT-AND-RERUN` | `ENGAGEMENT-MISSING` | `ENGAGEMENT-INVALID(<why>)`; `stDir(root)` = `<root>/.agents/security-testing`.
- `runCli(commands, argv, {cwd, stdout, stderr}) → exitCode` — dispatcher: `commands[sub](args, ctx)`; `ctx = {root, out(line), err(line), args}`; parses `--flag value`, `--flag` (boolean when the spec lists it so), positionals; unknown sub ⇒ `USAGE(<script>: unknown command <sub>)` exit 2.

- [ ] **Step 1: Copy `normalize.mjs` verbatim and its vectors**

```bash
S=bundles/security-testing/skills/secure-code-review/scripts
git show $REF:$REFS/normalize.mjs > $S/lib/normalize.mjs
git show $REF:$REFS/../references/normalize-vectors.json > $S/fixtures/lib/normalize-vectors.json
```
Edit the header comment: drop the TASK/US/spec-§ references; keep the six rules. Write `lib/normalize.test.mjs` that replays every vector: `for (const v of vectors) assert.deepEqual(normalizeText(Buffer.from(v.input, "utf8")).lines, v.lines)` plus one `EncodingError` case (`Buffer.from([0xff])`). Run `node --test $S/lib/normalize.test.mjs` → pass.

- [ ] **Step 2: Write `redaction-rules.json` (6 rules) and the failing redact test**

```json
{ "redaction_version": 2, "rules": [
  { "class": "aws-key",  "pattern": "(?<![A-Z0-9])(AKIA|ASIA)[A-Z0-9]{16}(?![A-Z0-9])", "flags": "g", "replacement": "<REDACTED:aws-key>" },
  { "class": "jwt",      "pattern": "eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}", "flags": "g", "replacement": "<REDACTED:jwt>" },
  { "class": "pem-block","pattern": "-----BEGIN [A-Z ]*PRIVATE KEY-----[\\s\\S]*?-----END [A-Z ]*PRIVATE KEY-----", "flags": "g", "replacement": "<REDACTED:pem-block>" },
  { "class": "bearer",   "pattern": "(?<=\\bBearer\\s)[A-Za-z0-9._~+/=-]{16,}", "flags": "gi", "replacement": "<REDACTED:bearer>" },
  { "class": "key-value","pattern": "(?<=\\b(?:password|passwd|secret|token|api[_-]?key|private[_-]?key|client[_-]?secret)\\s*[:=]\\s*[\"']?)[^\\s\"']{6,}", "flags": "gi", "replacement": "<REDACTED:key-value>" },
  { "class": "high-entropy", "pattern": "(?<![A-Za-z0-9+/=])[A-Za-z0-9+/]{40,}={0,2}(?![A-Za-z0-9+/=])", "flags": "g", "replacement": "<REDACTED:high-entropy>" }
] }
```

`lib/redact.test.mjs`:
```js
import { test } from "node:test"; import assert from "node:assert/strict";
import { redactString, loadRules } from "./redact.mjs";
test("each rule class fires once on its sample and nothing else changes", () => {
  const samples = {
    "aws-key": "id=AKIAIOSFODNN7EXAMPLE end", jwt: "h eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJlc2lnbmF0dXJl x",
    "pem-block": "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----", bearer: "Authorization: Bearer abcdefghijklmnop.qrs",
    "key-value": "password = hunter22x", "high-entropy": "sha=QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU2Nzg5",
  };
  for (const [cls, s] of Object.entries(samples)) { const r = redactString(s); assert.equal(r.hits, 1, cls); assert.match(r.text, new RegExp(`<REDACTED:${cls}>`)); }
});
test("plain code is untouched", () => { const s = "const x = require('fs'); // path=/usr/bin"; assert.deepEqual(redactString(s), { text: s, hits: 0 }); });
test("an unknown flag in the rules file is a RulesError", () => { assert.throws(() => loadRules("fixtures/lib/bad-rules.json"), /RulesError|flags/); });
```
Run → FAIL (module missing).

- [ ] **Step 3: Write `lib/redact.mjs`** (~60 lines): `loadRules(path = join(HERE, "redaction-rules.json"))` — read, JSON.parse, validate `rules[]` entries have string `class`/`pattern`/`replacement` and `flags` ⊆ `gimsu`, compile `new RegExp(pattern, flags)`, throw `RulesError` otherwise; `DEFAULT_RULES = loadRules()`; `redactString(input, rules = DEFAULT_RULES)` — for each rule, `text = text.replace(rule.re, () => { hits++; return rule.replacement; })`; return `{text, hits}`. Add `fixtures/lib/bad-rules.json` with `"flags": "x"`. Run the test → pass.

- [ ] **Step 4: Copy and trim `git.mjs`**

```bash
git show $REF:$REFS/lib/git.mjs > $S/lib/git.mjs
```
Delete `worktreeAdd`, `worktreeRemove`, `blobOid`, `checkIgnore` and their helpers; keep `GitError`, `gitEnv`, `git`, `must` (export it), `toplevel`, `revParse`, `showBytes`, `statusPorcelain`, `lsFiles`, `diffNameOnly`, `diffUnified`, `mergeBaseIsAncestor`. Header: one paragraph. Write `lib/git.test.mjs` that builds a repo in `mkdtempSync` (`git init -q`, one file, one commit, second commit editing it) and asserts: `revParse(root,"HEAD")` is 40 hex; `showBytes(root, oid, "a.txt")` equals the committed bytes; `statusPorcelain` is `[]` clean and `[" M a.txt"]` after an edit; `lsFiles(root,{paths:["."]})` lists `a.txt`; `mergeBaseIsAncestor(root, c1, c2)` true and reverse false; `diffNameOnly(root,c1,c2)` = `["a.txt"]`. Run → pass.

- [ ] **Step 5: Write `lib/engagement.test.mjs` then `lib/engagement.mjs`**

Test: a root without `.agents/security-testing/engagement.md` ⇒ throws `EngagementError` whose `.token === "ENGAGEMENT-MISSING"`; a file whose block still contains `"my-product-2026-09"` (the template value) ⇒ token `EDIT-ENGAGEMENT-AND-RERUN`; a block missing `scope_paths` ⇒ `ENGAGEMENT-INVALID(scope_paths)`; a valid file ⇒ `record.slug === "acme"` and `record.execute_project_tests` is `undefined` when omitted.

Implementation (~45 lines): `stDir(root)`; `readEngagement(root)` reads the file, finds the first fenced block whose info string is `json engagement` (regex ``/```json engagement\n([\s\S]*?)\n```/``), `JSON.parse`, validates: `engagement_id`, `slug` non-empty strings, `slug` matches `/^[a-z0-9][a-z0-9-]*$/`, `scope_paths` non-empty array of relative posix paths without `..`, `product_paths` optional array, `targets.browser` optional array of hostnames, `base_url` optional string, `execute_project_tests.argv` optional non-empty string array; template sentinel `engagement_id === "my-product-2026-09"` ⇒ `EDIT-ENGAGEMENT-AND-RERUN`. Run → pass.

- [ ] **Step 6: Write `lib/cli.test.mjs` then `lib/cli.mjs`**

Test: `runCli({ hello: (args, ctx) => { ctx.out(`HELLO ${args.name} ${args.loud ? "!" : ""}`); return 0; } }, ["hello", "--name", "x", "--loud"], {cwd, stdout, stderr, booleans: ["loud"]})` writes `HELLO x !\n` and returns 0; unknown sub returns 2 and writes `USAGE(cli: unknown command nope)` to stdout; a handler that throws `EngagementError` prints its token on stdout and returns 2; a handler that throws anything else prints `INTERNAL <name>: <message>` on stderr and returns 1; `--help` prints the command list.

Implementation (~55 lines): parse argv into `{_: positionals, ...flags}` (a flag in `booleans` takes no value; otherwise consumes the next token); `ctx = {root: toplevel(cwd), out, err, cwd}`; wrap the handler in try/catch mapping `EngagementError`/`GitError` → their token (exit 2) and everything else → `INTERNAL`. Every script's `main` is `process.exit(runCli(COMMANDS, process.argv.slice(2), {...}))`. Run → pass.

- [ ] **Step 7: Commit** — `git add $S && git commit -m "security-testing: shared lib (normalize, redact, git, engagement, cli)"`

---
### Task 3: `cite.mjs init` and `cite.mjs show`

**Files:**
- Create: `scripts/cite.mjs` (skeleton + `init`, `show`), `scripts/lib/ignore-block.mjs` (+test), `scripts/cite.test.mjs`
- Fixtures: built by code (`scripts/fixtures/cite/build-repo.mjs` exporting `buildRepo() → {root, oid1, oid2}` — a temp git repo with `src/app.js` (12 lines incl. a `password = "hunter22x"` line), `src/util.js`, `README.md`, two commits)

**Interfaces:**
- Consumes: Task 2 lib.
- Produces: `cite.mjs` command table `{init, show, check, redact}` (check/redact in Tasks 4–5); `ignore-block.mjs` `upsertBlock(text) → text`, `probeTracked(root) → string[]` (tracked paths under the managed patterns), `PATTERNS = [".agents/security-testing/reviews/", ".agents/security-testing/verify/", ".agents/security-testing/register/", ".agents/security-testing/proposals/"]`; result lines `INIT ok`, `WROTE <path>`, `IGNORE-BLOCK: written|present`, `TRACKED <path>` (exit 4), `EDIT-ENGAGEMENT-AND-RERUN` (exit 2); `show` prints `<n>\t<redacted line>` per line and a header `SHOW <path> <oid7> <start>-<end>`.

- [ ] **Step 1: Copy `ignore-block.mjs` and trim**

```bash
git show $REF:$REFS/lib/ignore-block.mjs > $S/lib/ignore-block.mjs
```
Keep `GITIGNORE`, `BLOCK_BEGIN = "# security-testing:begin"`, `BLOCK_END`, `renderBlock`, `stripManagedBlock`, `upsertBlock`, `readGitignore`; replace the policy-driven `PATTERNS`/`POLICY_PATTERNS`/`activePatterns` with the fixed four-entry `PATTERNS` above and `renderBlock()` with no argument; replace `probeManagedPaths(ctx, policy)` with `probeTracked(root)` = `lsFiles(root, {paths: PATTERNS.map(p => p.replace(/\/$/, ""))})`. Test (`lib/ignore-block.test.mjs`): `upsertBlock("")` yields exactly `BLOCK_BEGIN\n<4 patterns>\nBLOCK_END\n`; applied twice is idempotent; a block with an extra line in the middle is replaced whole; `stripManagedBlock` leaves unrelated lines untouched. Run → pass.

- [ ] **Step 2: Write the failing `cite.test.mjs` for `init` and `show`**

```js
import { test } from "node:test"; import assert from "node:assert/strict";
import { spawnSync } from "node:child_process"; import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"; import { join } from "node:path";
import { buildRepo } from "./fixtures/cite/build-repo.mjs";
const CITE = new URL("./cite.mjs", import.meta.url).pathname;
const run = (root, ...args) => { const r = spawnSync(process.execPath, [CITE, ...args], { cwd: root, encoding: "utf8" }); return { code: r.status, out: r.stdout.trim().split("\n"), err: r.stderr }; };
const ENG = (root, extra = "") => { mkdirSync(join(root, ".agents/security-testing"), { recursive: true }); writeFileSync(join(root, ".agents/security-testing/engagement.md"), "```json engagement\n" + JSON.stringify({ engagement_id: "acme-2026-09", slug: "acme", scope_paths: ["src/"], ...extra }) + "\n```\n"); };
test("init without engagement.md seeds the template and asks for an edit", () => {
  const { root } = buildRepo(); const r = run(root, "init");
  assert.equal(r.code, 2); assert.ok(r.out.includes("EDIT-ENGAGEMENT-AND-RERUN")); assert.ok(existsSync(join(root, ".agents/security-testing/engagement.md")));
});
test("init with a valid engagement writes the ignore block once", () => {
  const { root } = buildRepo(); ENG(root); let r = run(root, "init");
  assert.equal(r.code, 0); assert.ok(r.out.includes("IGNORE-BLOCK: written")); assert.ok(r.out.includes("INIT ok"));
  r = run(root, "init"); assert.ok(r.out.includes("IGNORE-BLOCK: present"));
  assert.match(readFileSync(join(root, ".gitignore"), "utf8"), /# security-testing:begin\n\.agents\/security-testing\/reviews\//);
});
test("init fails closed when a private path is tracked", () => {
  const { root } = buildRepo(); ENG(root); mkdirSync(join(root, ".agents/security-testing/register"), { recursive: true });
  writeFileSync(join(root, ".agents/security-testing/register/events.jsonl"), ""); spawnSync("git", ["add", "-f", ".agents"], { cwd: root }); spawnSync("git", ["commit", "-qm", "oops"], { cwd: root });
  const r = run(root, "init"); assert.equal(r.code, 4); assert.ok(r.out.some(l => l.startsWith("TRACKED .agents/security-testing/register/events.jsonl")));
});
test("show prints numbered redacted lines at HEAD and at an older oid", () => {
  const { root, oid1 } = buildRepo(); ENG(root);
  let r = run(root, "show", "src/app.js", "3", "5"); assert.equal(r.code, 0);
  assert.match(r.out[0], /^SHOW src\/app\.js [0-9a-f]{7} 3-5$/); assert.equal(r.out.length, 4); assert.match(r.out[1], /^3\t/);
  assert.ok(r.out.some(l => l.includes("<REDACTED:key-value>")), "the password line is redacted");
  r = run(root, "show", "src/app.js", "--at", oid1); assert.match(r.out[0], new RegExp(`SHOW src/app.js ${oid1.slice(0, 7)} 1-`));
});
test("show refuses a path outside scope and a range over 40 lines", () => {
  const { root } = buildRepo(); ENG(root);
  assert.equal(run(root, "show", "README.md").code, 2); assert.ok(run(root, "show", "README.md").out[0].startsWith("USAGE(show: README.md is not under scope_paths"));
  assert.equal(run(root, "show", "src/app.js", "1", "60").code, 2);
});
```
Write `fixtures/cite/build-repo.mjs` (spawnSync `git init -q`, `git config user.email/name`, write files, `git add -A`, `git commit -qm c1`, edit `src/app.js` line 4, commit `c2`; return `{root, oid1, oid2}` via `git rev-parse HEAD~1`/`HEAD`). It also exports `APP_LINES` (the twelve lines of `src/app.js` at `c2`, as an array) so tests can build snippets: `const SNIPPET_3_5 = APP_LINES.slice(2, 5).join("\n")`. Run → FAIL (cite.mjs missing).

- [ ] **Step 3: Write `cite.mjs` skeleton with `init` and `show`** (~130 lines)

`init(args, ctx)`: `stDir` exists? else mkdir; `engagement.md` absent ⇒ copy `../../../knowledge/engagement.md.template` (resolve from the script's own dir: `join(HERE, "..", "..", "..", "knowledge", "engagement.md.template")`, falling back to `<root>/.agents/security-testing/knowledge/engagement.md.template` — the seeded copy) → `WROTE <path>`, `EDIT-ENGAGEMENT-AND-RERUN`, return 2; `readEngagement` (its errors propagate to `runCli`); `probeTracked(root)` non-empty ⇒ one `TRACKED <path>` per path, return 4; `upsertBlock` on `.gitignore` ⇒ `IGNORE-BLOCK: written|present`; `INIT ok`; return 0.

`show(args, ctx)`: positionals `path [start end]`, flag `--at` (default `HEAD`); `readEngagement`; path must be under a `scope_paths` entry (posix prefix match) else `USAGE(show: <path> is not under scope_paths)` 2; `end-start+1 > 40` ⇒ `USAGE(show: range over 40 lines)` 2; `oid = revParse(root, at)`; `showBytes(root, oid, path)` (GitError ⇒ `USAGE(show: <path> is not in the tree at <oid7>)`); split raw text on `\n` (keep raw line numbers — D3); print header then `${n}\t${redactString(line).text}` for the window (default whole file). Run → pass.

- [ ] **Step 4: Commit** — `git commit -m "security-testing: cite.mjs init + show"`

---

### Task 4: `cite.mjs check` — findings mode

**Files:**
- Modify: `scripts/cite.mjs` (add `check` findings mode), Create: `scripts/lib/coverage.mjs` (+test), `scripts/lib/citations.mjs` (+test); extend `scripts/cite.test.mjs`
- Fixtures: `scripts/fixtures/cite/findings-ok.json`, `findings-bad-snippet.json`, `findings-agent-wrote-id.json`, `second-ok.json`

**Interfaces:**
- Consumes: Task 2/3.
- Produces: `checkCitation(root, scopePaths, c) → {state: "VERIFIED"|"FAILED", why?, oid, snippet_redacted, normalised: string[]}`; `findingId({path, cls, normalisedSnippet}) → hex`; `tileCoverage(files: string[], examined: [{path, lines?}], lineCounts: Map) → {examined, partial, unexamined, rows: [{path, status, ranges}]}`; result lines `CHECK verified=<n> failed=<n>`, `COVERAGE examined=<n> partial=<n> unexamined=<n>`, `FAILED <finding-index>.<citation-index> <why>`, `DIRTY-SCOPE <path>`, `REFUSED agent-written key <key>`, `STALE-REVIEW <id>`, `SECOND <id> <assertion>`; exit 4 on any FAILED/STALE, 2 on REFUSED/DIRTY.
- `why` vocabulary: `path-not-in-scope`, `range-over-40`, `not-in-tree`, `snippet-not-found`, `bad-shape`.

- [ ] **Step 1: `lib/citations.test.mjs` then `lib/citations.mjs`** (~90 lines)

Tests (using `buildRepo`): a citation `{path:"src/app.js", lines:[3,5], snippet:<lines 3-5 with extra spaces and a blank line>}` ⇒ `VERIFIED`, `oid` = HEAD oid, `normalised` has 3 lines; a snippet that is not in the window ⇒ `FAILED snippet-not-found`; `lines:[1,80]` ⇒ `FAILED range-over-40`; `path:"README.md"` ⇒ `FAILED path-not-in-scope`; an explicit `oid` of the older commit verifies against the OLD bytes; `findingId` is 64 hex, stable across two calls, and changes when `cls` changes; the id's preimage uses the REDACTED snippet (a snippet containing `password = "hunter22x"` yields the same id as one containing `password = "<REDACTED:key-value>"`).

Implementation: `checkCitation` validates shape (`path` string, `lines` two ints `1 ≤ s ≤ e`, `snippet` non-empty string) ⇒ `bad-shape`; scope prefix ⇒ `path-not-in-scope`; range ⇒ `range-over-40`; `oid = revParse(root, c.oid ?? "HEAD")`; `showBytes` GitError ⇒ `not-in-tree`; window = raw lines `s..e` joined, `normalizeText(window).lines` vs `normalizeText(snippet).lines` — the snippet must be a contiguous sub-sequence of the window's normalised lines (use `occurrenceOf`-style loop from REF `cite-core.mjs:170` — copy the 15-line matcher) ⇒ else `snippet-not-found`; on success return the redacted normalised snippet. `findingId = sha256(path + "\0" + cls + "\0" + redact(normalised.join("\n")).text + "\0" + normalised[0])`.

- [ ] **Step 2: `lib/coverage.test.mjs` then `lib/coverage.mjs`** (~80 lines, the exactly-once tiling from REF `coverage-core.mjs:185` simplified to one status set)

Tests: files `[a (10 lines), b (10), c (10)]`, examined `[{path:a}, {path:b, lines:[1,4]}]` ⇒ `examined=1 partial=1 unexamined=1`, rows: `a examined [[1,10]]`, `b partial examined [[1,4]] unexamined [[5,10]]`, `c unexamined [[1,10]]`; overlapping ranges `[1,4],[3,6]` merge to `[1,6]`; an `examined` path not in files ⇒ throws `CoverageError("not in scope: <path>")`; every line of every file appears in exactly one range (assert by summing range lengths = total lines).

- [ ] **Step 3: Extend `cite.test.mjs` for `check` (findings)**

```js
test("check verifies citations, stamps oid/state/id, tiles coverage, prints the summary", () => {
  const { root, oid2 } = buildRepo(); ENG(root); const dir = join(root, ".agents/security-testing/reviews/r1"); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "findings.json"), JSON.stringify({ head: oid2, scope_paths: ["src/"], examined: [{ path: "src/app.js" }], findings: [{ title: "Hard-coded credential", class: "hardcoded-secret", priority: "p1", confidence: "high", citations: [{ path: "src/app.js", lines: [3, 5], snippet: SNIPPET_3_5 }], rationale: "…", fix: "…" }] }));
  const r = run(root, "check", ".agents/security-testing/reviews/r1/findings.json"); assert.equal(r.code, 0, r.err);
  assert.ok(r.out.includes("CHECK verified=1 failed=0")); assert.ok(r.out.includes("COVERAGE examined=1 partial=0 unexamined=1"));
  const f = JSON.parse(readFileSync(join(dir, "findings.json"), "utf8")); assert.match(f.findings[0].id, /^[0-9a-f]{64}$/); assert.equal(f.findings[0].citations[0].state, "VERIFIED"); assert.equal(f.findings[0].citations[0].oid, oid2);
  assert.ok(!JSON.stringify(f).includes("hunter22x"), "snippet written back is redacted");
  assert.deepEqual(f.coverage.rows.map(x => x.status), ["examined", "unexamined"]);
});
test("a wrong snippet ⇒ FAILED line and exit 4; re-running after a fix passes", () => { /* write findings with snippet "nope" ⇒ code 4, out has "FAILED 0.0 snippet-not-found"; rewrite snippet ⇒ code 0 */ });
test("agent-written id/state/verdict ⇒ REFUSED, nothing written", () => { /* findings[0].id = "x" ⇒ code 2, out[0] === "REFUSED agent-written key id"; file bytes unchanged */ });
test("dirty scope ⇒ DIRTY-SCOPE and exit 2", () => { /* writeFileSync src/util.js edit ⇒ code 2, "DIRTY-SCOPE src/util.js" */ });
test("second-<id>.json is validated; a stale one is STALE-REVIEW", () => { /* after a passing check, write second-<id>.json {finding_id:id, oid:oid2, findings_sha256: sha256 of findings.json bytes, assertion:"confirmed", note:"…", by:"s1"} ⇒ check prints "SECOND <id> confirmed"; edit findings.json rationale, run check ⇒ "STALE-REVIEW <id>", code 4 */ });
```
Fill each comment with real code (the comments are what the test does; the engineer writes the statements). Run → FAIL.

- [ ] **Step 4: Implement `check` (findings mode) in `cite.mjs`** (~140 lines)

Order: read file (`parseStrict` = `JSON.parse` + reject non-object); mode = `"findings" in doc ? "findings" : "threat-model"` (threat-model in Task 5); D10 refusal: `check` itself writes back `id`/`state`/`oid`/`snippet_redacted`/`coverage` plus a top-level `check_stamp = sha256(JSON of the file with exactly those keys removed)`. A file that carries any of those keys with a missing or mismatching `check_stamp` was hand-written ⇒ `REFUSED agent-written key <key>` (return 2, nothing written); a matching stamp means the keys are `check`'s own output and the run proceeds (so `check` re-runs freely on its own output). `readEngagement`; `statusPorcelain(root, {paths: scope_paths})` non-empty ⇒ `DIRTY-SCOPE` per path, return 2; for each finding/citation `checkCitation`; `id` when all citations verified; coverage: `lsFiles(root, {paths: scope_paths})`, line counts via `showBytes` at `doc.head ?? HEAD`, `tileCoverage`; second opinions: every `second-*.json` in the directory — shape `{finding_id, oid, findings_sha256, assertion ∈ confirmed|refuted|indeterminate, note, by}`, `finding_id` must be an id in the file, `oid` must equal that finding's first citation oid, `findings_sha256` must equal the sha256 of the findings file bytes **before this run's write-back with `check_stamp` and `coverage` removed** (document that the lead runs `check` before dispatching the second opinion, so the reviewer hashes a stamped file) ⇒ `SECOND <id> <assertion>` or `STALE-REVIEW <id>`; write the file back (`JSON.stringify(doc, null, 2) + "\n"`, redacted via `redactString` on the whole text); print `FAILED …` lines, `COVERAGE …`, `CHECK …`; exit 4 if any failed/stale. Run → pass.

- [ ] **Step 5: Commit** — `git commit -m "security-testing: cite.mjs check (findings mode, coverage, second opinions)"`

---
### Task 5: `cite.mjs check` — threat-model mode, `--md`, `redact`

**Files:**
- Modify: `scripts/cite.mjs`; Create: `scripts/lib/threat-model.mjs` (+test), `scripts/lib/md.mjs` (+test); extend `scripts/cite.test.mjs`
- Fixtures: `scripts/fixtures/cite/threat-model-ok.json`, `threat-model-dangling.json`

**Interfaces:**
- Consumes: Task 4 `checkCitation`; the register file `<st>/register/events.jsonl` (rows `R-nnnn` — read with the same fold as Task 6; until Task 6 lands, a row exists iff an `add` event line with that `row_id` exists); the suite index `tasks/security-<slug>-admitted/.admitted.json` (`[{file, sha256}]`, Task 7).
- Produces: `lintThreatModel(doc, {registerRows: Set<string>, admittedCases: Set<string>}) → {errors: [{locus, why}]}`; disposition grammar `open | accepted(R-nnnn) | mitigated(M-nnn) | planned(TC-nnn) | out-of-scope(<reason>)`; result lines `TM-INVALID <locus>: <why>`, `MODEL elements=<n> threats=<n> open=<n>`; `--md` prints tables and `TABLES sha256=<hex>`; `redact <file.md>` prints `REDACTED <file> hits=<n>`.

- [ ] **Step 1: `lib/threat-model.test.mjs` then `lib/threat-model.mjs`** (~90 lines)

Model shape: `{head, elements:[{id:"E-001", name, kind: process|datastore|external|flow|boundary, citations:[…]}], threats:[{id:"T-001", element_id, stride: S|T|R|I|D|E, title, mitigations:[{id:"M-001", claim, citations:[…]}], disposition: "<grammar>"}]}`. Tests: a valid model ⇒ no errors; a threat naming `E-009` (absent) ⇒ `{locus:"T-001", why:"element E-009 is not in the model"}`; a mitigation without citations ⇒ `M-001: no citation`; disposition `mitigated(M-002)` where `M-002` is not one of THIS threat's mitigations ⇒ error; `accepted(R-0007)` with `registerRows` lacking it ⇒ `accepted(R-0007): no such register row`; `planned(TC-003)` not in `admittedCases` ⇒ error; empty `name`/`title`/`claim` ⇒ error; `disposition: "fixed"` ⇒ `unknown disposition`. Regexes: `/^E-\d{3}$/`, `/^T-\d{3}$/`, `/^M-\d{3}$/`, `/^(open|accepted\(R-\d{4}\)|mitigated\(M-\d{3}\)|planned\(TC-\d{3}\)|out-of-scope\([^()]+\))$/`.

- [ ] **Step 2: `lib/md.test.mjs` then `lib/md.mjs`** (~70 lines)

`table(headers: string[], rows: string[][]) → string` escapes `|` as `\|` and newlines as spaces; `findingsTable(doc, {noSnippets})`, `coverageTable(doc)`, `elementsTable`, `threatsTable`, `mitigationsTable` — column sets: findings `id7 | priority | class | title | citations (path:s-e @oid7 state) | second opinion (assertion by, or "not independently reviewed")`; coverage `path | status | examined ranges | unexamined ranges`; elements `id | kind | name | citations`; threats `id | element | stride | title | disposition`; mitigations `threat | id | claim | citations`. `tablesSha256(text)`. Tests: a `|` in a title is escaped; `noSnippets` omits the snippet column; the sha256 of two renders of the same doc is equal and changes when a title changes.

- [ ] **Step 3: Extend `cite.test.mjs`**

```js
test("check on a threat model lints structure and dispositions against the register and the suite", () => {
  // buildRepo + ENG; write <st>/register/events.jsonl with one line {"seq":1,"row_id":"R-0001","event":"add",…}; write tasks/security-acme-admitted/.admitted.json [{file:"TC-001_login.md",sha256:"…"}]
  // model: E-001 cites src/app.js 1-3 (valid snippet); T-001 accepted(R-0001) ⇒ ok; T-002 planned(TC-001) ⇒ ok; T-003 planned(TC-009) ⇒ TM-INVALID
  // expect code 4, out includes "TM-INVALID T-003: planned(TC-009): not in the admitted suite" and "MODEL elements=1 threats=3 open=0"
});
test("check --md prints the tables and a TABLES sha256 line; --no-snippets drops snippets", () => { /* code 0; out includes a line starting "| id | priority |"; last line matches /^TABLES sha256=[0-9a-f]{64}$/ ; with --no-snippets no line contains "hunter" or "<REDACTED" */ });
test("redact rewrites a Markdown file in place and reports hits", () => { /* write reports/x.md with "token = abcdefghijkl1234"; run redact ⇒ "REDACTED reports/x.md hits=1"; file no longer contains the token */ });
```
Run → FAIL.

- [ ] **Step 4: Implement** in `cite.mjs`: threat-model branch (same DIRTY-SCOPE, D10 refusal via `check_stamp`, `checkCitation` on every element and mitigation citation, then `lintThreatModel` with `registerRows` read directly from `<st>/register/events.jsonl` inside `cite.mjs` (row ids of `add` events whose latest event is not `supersede`/`close-false-positive` — a 15-line reader; `cite.mjs` never imports from another skill, so the standalone install stays one directory) and `admittedCases` from `.admitted.json` files' `TC-NNN` prefixes), `--md` (after a passing or failing check, print tables + `TABLES sha256`), and `redact(args)` (read, `redactString`, write back only when `hits > 0`, print). Run all `cite.test.mjs` → pass.

- [ ] **Step 5: Commit** — `git commit -m "security-testing: cite.mjs threat-model mode, --md tables, redact"`

---

### Task 6: `register.mjs`

**Files:**
- Create: `bundles/security-testing/skills/risk-register/scripts/register.mjs` (+`register.test.mjs`), `scripts/lib/transitions.mjs` (+test), `scripts/lib/{engagement,cli}.mjs` (byte-identical copies of Task 2's)
- Fixtures: none (temp dirs)

**Interfaces:**
- Consumes: Task 2 `engagement.mjs`, `cli.mjs` (copied).
- Produces: log `<st>/register/events.jsonl`, one JSON object per line `{seq, ts, actor, row_id, event, payload}` (`ts` ISO-8601 from `new Date()` — the only clock in the bundle; `actor` from `--by` else `$USER` else `"unknown"`); `foldEvents(lines) → {rows: Map<id, Row>, seq}`; `Row = {id, finding_id, title, priority, status, owner, ticket_url, accepted_until, approvals: [...], superseded_by}`; statuses `open | fixed | regressed | accepted | false-positive | superseded`; result lines `ROW <id> <status>`, `REFUSED <why>`, `STATUS …` block, `FINGERPRINT <engagement_id>:<seq>:<sha256(events.jsonl)>`, `MATCH|ADVANCED|DIVERGED`, `RENDERED <path>`, `EXPIRED <id>`; exported `fixed(root, rowId, verifyPath)`/`regressed(...)` for `verify.mjs` (Task 8) to call in-process.

- [ ] **Step 1: Copy the transition table**

```bash
git show $REF:$REFS/lib/register-transitions.mjs > /tmp/rt.mjs   # read, then hand-port
```
Write `lib/transitions.mjs` (~110 lines) keeping: `STATUSES`, `PRIORITIES = ["p0","p1","p2","p3"]`, the `TRANSITIONS` table reduced to the ten events of spec §6 (`add` from none→open; `accept` open|regressed→accepted; `revoke` accepted→open; `acceptance-expired` accepted→open; `fixed` open|regressed|accepted→fixed; `regressed` fixed→regressed; `close-false-positive` open|regressed→false-positive; `reopen` fixed|false-positive→open; `supersede` any live→superseded; `ticket` any live, status unchanged), `APPROVAL_KEYS = ["recorded_by","approved_by","approval_ref","authenticated"]`, `applyTransition(row, event, payload) → row` throwing `TransitionError("<event> not allowed from <status>")`, `isCalendarDay`. Drop aliases, subject kinds, supersede modes, emitter lists.

`lib/transitions.test.mjs`: every `(event, from)` pair in the table applies; every pair NOT in the table throws; `accept` requires `payload.until` (calendar day) and an approval object whose `authenticated === false` — `authenticated: true` throws `TransitionError("approvals are never authenticated")`; `supersede` sets `superseded_by`. Run → pass.

- [ ] **Step 2: `register.test.mjs` (failing)**

```js
const REG = new URL("./register.mjs", import.meta.url).pathname;
// helper: tmpRepoWithEngagement(extra?) = mkdtempSync + `git init -q` + user config + one empty commit + `.agents/security-testing/engagement.md` with {engagement_id:"acme-2026-09", slug:"acme", scope_paths:["src/"], ...extra}
test("add → status → render; duplicate finding id refused", () => {
  const root = tmpRepoWithEngagement(); let r = run(root, "add", "--finding", "a".repeat(64), "--priority", "p2", "--title", "Hard-coded credential", "--by", "lead");
  assert.equal(r.code, 0); assert.equal(r.out[0], "ROW R-0001 open");
  r = run(root, "add", "--finding", "a".repeat(64), "--priority", "p2", "--title", "dup"); assert.equal(r.code, 2); assert.equal(r.out[0], "REFUSED live row R-0001 already has finding aaaaaaaa…");
  r = run(root, "status"); assert.ok(r.out.includes("OPEN-EXPOSURE p0=0 p1=0 p2=1 p3=0")); assert.match(r.out.at(-1), /^FINGERPRINT acme-2026-09:1:[0-9a-f]{64}$/);
  r = run(root, "render"); assert.equal(r.out[0], "RENDERED .agents/security-testing/risk-register.md"); assert.match(readFileSync(join(root, ".agents/security-testing/risk-register.md"), "utf8"), /\| R-0001 \| .* \| open \|/);
});
test("accept is unauthenticated and never reduces open exposure; expiry via check", () => {
  // add; accept R-0001 --until 2026-01-01 --approved-by CISO --approval-ref JIRA-1 ⇒ "ROW R-0001 accepted"; status shows OPEN-EXPOSURE p2=1 and "UNAUTHENTICATED-APPROVALS 1"; events.jsonl last line payload.authenticated === false
  // check (today > until) ⇒ "EXPIRED R-0001", status open
});
test("fixed/regressed via --verify, ticket, supersede, --expect", () => {
  // add; write verify.json {verdict:"VERIFIED", head:"deadbeef"}; fixed R-0001 --verify <path> ⇒ "ROW R-0001 fixed"; regressed ⇒ fixed→regressed ok; ticket R-0001 https://x/1 ⇒ status unchanged, row.ticket_url set; add second; supersede R-0002 --by R-0001 ⇒ "ROW R-0002 superseded"
  // status --expect <previous FINGERPRINT> ⇒ "ADVANCED"; with the current one ⇒ "MATCH"; with a fabricated one of the same seq ⇒ "DIVERGED"
});
test("a corrupt log line ⇒ exit 5 CORRUPT and no write", () => { /* append "not json\n"; add ⇒ code 5, out[0] startsWith "CORRUPT events.jsonl:3" */ });
test("a confirm verb does not exist", () => { assert.equal(run(root, "confirm", "R-0001").code, 2); });
```
Run → FAIL.

- [ ] **Step 3: Implement `register.mjs`** (~300 lines): `readLog(root)` (missing ⇒ `[]`; each line `JSON.parse` else throw `CorruptError("events.jsonl:<n>")` → exit 5 via a `runCli` mapping); `foldEvents`; `append(root, event)` = `appendFileSync` one line with `seq = last+1`; verbs per spec §6 `register.mjs` (each: fold, find row, build payload, `applyTransition`, append, print `ROW <id> <status>`); `add` refuses when any row with `status ∉ {superseded, false-positive}` has the same `finding_id`; `status`: `COUNT <status>=<n>` per status, `OPEN-EXPOSURE p0=… p3=…` counting rows in `open|regressed|accepted` (an approval never subtracts — spec §2 row 6), `UNAUTHENTICATED-APPROVALS <n>`, `FINGERPRINT`; `--expect`: same string ⇒ `MATCH`; same engagement, higher seq ⇒ `ADVANCED`; else `DIVERGED` (exit 4); `render`: Markdown with `## Rows` (`id | finding | priority | status | owner | ticket | title`), `## Superseded`, `## Open exposure`, `## Unauthenticated approvals` + the sentence "None of these records is authenticated"; `check`: for each `accepted` row with `accepted_until < today` append `acceptance-expired`. Export `fixed`/`regressed` as functions taking `(root, rowId, verifyPath, by)`. Run → pass.

- [ ] **Step 4: Commit** — `git commit -m "security-testing: register.mjs (append-only log, transitions, status, render)"`

---
### Task 7: `cases.mjs` and the lib dupes groups

**Files:**
- Create: `bundles/security-testing/skills/security-test-planning/scripts/cases.mjs` (+`cases.test.mjs`), `scripts/lib/admission.mjs` (+test), `scripts/lib/{redact,engagement,cli}.mjs` + `lib/redaction-rules.json` (byte-identical copies)
- Modify: `bin/check-skill-dupes.mjs` (three groups), extend `bin/check-skill-dupes.test.mjs` if it enumerates groups
- Fixtures: `scripts/fixtures/cases/TC-001_login-headers.md` (passive), `TC-002_delete-account.md` (mutating verb), `TC-003_other-host.md`

**Interfaces:**
- Consumes: Task 2 lib (copied); `readEngagement` for `slug`, `targets.browser`, `base_url`.
- Produces: `tasks/security-<slug>-admitted/TC-NNN_<slug>.md` + `.admitted.json = [{file, sha256}]`; `<st>/proposals/TC-NNN_<slug>.md`; result lines `ADMITTED <file>`, `PROPOSAL <file> hits=<n>` then one `HIT <rule> step <n>: <text>` per hit, `SUITE ok=<n>`, `UNADMITTED: <path>` (exit 4), the two hand-off prompts verbatim; `lintCase(text, {browser}) → {steps, hits:[{rule, step, text}]}`.

- [ ] **Step 1: Port `admission-core.mjs`**

```bash
git show $REF:$REFS/lib/admission-core.mjs > /tmp/ac.mjs
```
Write `lib/admission.mjs` (~170 lines) keeping `ALLOWED_OPERATIONS`, `FORBIDDEN_PATTERNS`, `LINT_RULES` minus `reviewable`/`unknown-operation`-as-reviewable (unknown ⇒ a hit named `unknown-operation`, full stop), `BASE_URL_PLACEHOLDER`, `hostOf`, `parseSteps(text)` (the manual-qa `## Steps` table reader), `lintSteps(steps, {browser})` with the compound-verb regex from the reference (`/(?:^|\b(?:and|then|or)\s+|[;,]\s*)(?:submit|delete|…)/i`), `caseId(text)` (`id: TC-NNN` from frontmatter, file name must be `TC-NNN_<slug>.md`). Drop `caseSha256` keyed variants, `targetPolicy*`, `classify` (two outcomes now: hits empty ⇒ admitted). `lib/admission.test.mjs`: the three fixtures ⇒ `[]`, `[{rule:"mutating-verb", step:2}]`, `[{rule:"host-not-allowed", step:1}]`; `"Navigate to {{base_url}}/login then submit the form"` ⇒ a `mutating-verb` hit (compound); `"Inspect the response; then run \`rm -rf /\`"` ⇒ `tooling` hit. Run → pass.

- [ ] **Step 2: `cases.test.mjs` (failing)**

```js
test("admit copies a passive case into the suite, redacted, and records its sha256", () => {
  const root = tmpRepoWithEngagement({ slug: "acme", targets: { browser: ["staging.example.com"] } }); mkdirSync(join(root, ".agents/security-testing/cases/acme"), { recursive: true });
  // FIX(name) = join(fixtures dir, "cases", name); tmpRepoWithEngagement as in register.test.mjs (copy the helper — the two skills share no test code)
  copyFileSync(FIX("TC-001_login-headers.md"), join(root, ".agents/security-testing/cases/acme/TC-001_acme.md"));
  const r = run(root, "admit", ".agents/security-testing/cases/acme/TC-001_acme.md"); assert.equal(r.code, 0); assert.equal(r.out[0], "ADMITTED tasks/security-acme-admitted/TC-001_acme.md");
  const idx = JSON.parse(readFileSync(join(root, "tasks/security-acme-admitted/.admitted.json"), "utf8")); assert.equal(idx.length, 1); assert.match(idx[0].sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(readdirSync(join(root, "tasks/security-acme-admitted")).sort(), [".admitted.json", "TC-001_acme.md"]);
});
test("a mutating step ⇒ proposal, nothing in the suite", () => { /* TC-002 ⇒ code 0, out[0] "PROPOSAL .agents/security-testing/proposals/TC-002_acme.md hits=1", out[1] startsWith "HIT mutating-verb step 2"; suite dir absent or empty */ });
test("candidate outside <st>/cases/ or a bad id is refused", () => { /* tasks/x/TC-001_acme.md ⇒ code 2 USAGE(admit: candidates live under .agents/security-testing/cases/…); TC-1_acme.md ⇒ code 2 */ });
test("verify-suite lists a hand-added file and prints both prompts when clean", () => {
  // after one admit: writeFileSync(suite/TC-009_x.md,"…") ⇒ code 4, out includes "UNADMITTED: tasks/security-acme-admitted/TC-009_x.md"
  // remove it ⇒ code 0, out includes "SUITE ok=1", then the exact line: Run as the active agent (claude --agent test-run-lead):
  // and: "Run the suite at tasks/security-acme-admitted/ against base_url=https://staging.example.com."
  // and a test-automation prompt line containing cases=[{"id":"TC-001",…}] slug=acme
});
```
Run → FAIL.

- [ ] **Step 3: Implement `cases.mjs`** (~140 lines): `admit`: resolve the path against cwd, require it under `<st>/cases/` and `basename` matching `/^TC-\d{3}_[a-z0-9-]+\.md$/` with a frontmatter `id:` equal to the prefix; `lintCase`; hits ⇒ write the redacted text to `<st>/proposals/<basename>` and print; none ⇒ mkdir suite, write redacted text to `tasks/security-<slug>-admitted/<basename>`, sha256 of the written bytes, upsert `.admitted.json` (replace an entry with the same `file`), print. `verify-suite`: read `.admitted.json` (absent ⇒ `SUITE ok=0`), list `TC-*.md` in the suite, every file must be indexed with a matching sha256 else `UNADMITTED: <path>` (exit 4 after listing all); then print the manual-qa prompt (spec §8, two lines, `base_url` from the engagement else `<base_url>`) and `TA-PROMPT cases=<json [{id,title,path}]> slug=<slug> base=<HEAD oid7>` (title from the case's `# ` heading). Run → pass.

- [ ] **Step 4: Dupes groups** — in `bin/check-skill-dupes.mjs` add groups pairing `skills/secure-code-review/scripts/lib/{engagement,cli}.mjs` with the copies in `security-test-planning` and `risk-register`, and `secure-code-review/scripts/lib/{redact.mjs,redaction-rules.json}` with `security-test-planning`'s (follow the file's existing group shape exactly). Run `npm run validate:dupes` → all groups in sync.

- [ ] **Step 5: Commit** — `git commit -m "security-testing: cases.mjs admit/verify-suite; dupes groups for lib copies"`

---

### Task 8: `verify.mjs`

**Files:**
- Create: `bundles/security-testing/skills/secure-code-review/scripts/verify.mjs` (+`verify.test.mjs`), `scripts/lib/verify-steps.mjs` (+test)
- Fixtures: `scripts/fixtures/verify/build-repo.mjs` — a temp repo with `package.json` `{"scripts":{"test":"node --test"}}`, `src/app.js` with a bug line, `src/app.test.mjs` that FAILS on the bug and passes after the fix; commits `c1` (bug) and `c2` (fix); plus `c3` deleting the cited function.

**Interfaces:**
- Consumes: Task 4 findings file (a finding's first citation `oid` = `base`), Task 6 `fixed`/`regressed` (imported from `../../risk-register/scripts/register.mjs` — resolved relative to the installed skills dir: `join(HERE, "..", "..", "risk-register", "scripts", "register.mjs")`; when the module is absent (standalone one-skill install) print `REGISTER: skipped (risk-register not installed)`).
- Produces: `<st>/verify/<id8>-<head7>/{verify.json, tests.log}`; `verify.json = {finding_id, review, base, head, carried_dirt:[], tests:{argv, exit, duration_ms, log:"tests.log"} | null, diff:{deletion_only, advisories:[{path,line,kind}]}, assertion:{value, by}|null, verdict}`; verdicts `PENDING-REVIEW | VERIFIED | UNVERIFIED-REFOUND | UNVERIFIED-NOT-A-FIX | UNVERIFIED-DELETION-ONLY | UNVERIFIED-NO-TEST-SURFACE | UNVERIFIED-TESTS-FAILED`; result lines `NOT-AT-HEAD <head7> (checkout is at <oid7>)` (2), `DIRTY <path>` (2), `ADVISORY <path>:<line> <kind>`, `NEXT: dispatch security-reviewer fix-review`, `VERDICT <token> finding=<id> base=<oid> head=<oid>`.

- [ ] **Step 1: Port the pieces of `verify-steps.mjs`**

```bash
git show $REF:$REFS/lib/verify-steps.mjs > /tmp/vs.mjs
```
Write `lib/verify-steps.mjs` (~120 lines) keeping: `ALLOWED_EXECUTABLES`, `DENIED_TOKENS`, `DEFAULT_TIMEOUT_S`, `OUTPUT_LIMIT`, `INLINE_SUPPRESS_RE`, `TEST_SKIP_RE`, `checkArgv(argv)` (executable ∈ allowed, no denied token), `boundOutput`, `parseUnifiedDiff(text)` (added/removed line counts + added lines with numbers), `runTests({root, argv, timeout_s}) → {exit, duration_ms, output}` (`spawnSync(argv[0], argv.slice(1), {cwd: root, shell:false, env: minimalEnv(process.env), timeout: timeout_s*1000, maxBuffer: 64<<20})`). Drop `worktreeStep`, `removeWorktree`, `installStep`, `testedTreeHmac`, `argvHash`, `indicatorId`. Test: `checkArgv(["npm","test"])` ok, `["bash","-c","x"]` throws, `["node","-e","x"]` throws; `parseUnifiedDiff` on a 3-line fixture diff; `runTests` with argv `["node", join(fixtures, "exit3.mjs")]` (a one-line script `process.exit(3)`; `-e` is a denied token, so a script file is the fixture) ⇒ `exit === 3`. Run → pass.

- [ ] **Step 2: `verify.test.mjs` (failing)** — each test builds the fixture repo, writes an engagement with `execute_project_tests.argv = ["npm","test"]`, writes a `findings.json` whose finding cites `src/app.js` at `c1` (run `cite.mjs check` first so it is stamped), then:

```js
test("not at head / dirty cited path are refused", () => { /* checkout c1 (HEAD≠c2) ⇒ code 2 "NOT-AT-HEAD"; checkout c2, edit src/app.js ⇒ code 2 "DIRTY src/app.js" */ });
test("first invocation runs the tests, records the diff, asks for the fix-review", () => {
  // checkout c2; run verify --finding <id> --review <dir> --head <c2>
  // code 0; out includes "NEXT: dispatch security-reviewer fix-review"; verify.json.verdict === "PENDING-REVIEW"; tests.exit === 0; tests.log exists and is ≤ 64 KiB; diff.deletion_only === false
});
test("second invocation with not-refound ⇒ VERIFIED and the register row is fixed", () => { /* add a register row first; … --assertion not-refound --by s1 ⇒ out last line /^VERDICT VERIFIED finding=/ ; register status shows fixed */ });
test("refound ⇒ UNVERIFIED-REFOUND and the row is regressed only if it was fixed", () => {});
test("head not touching the cited path ⇒ UNVERIFIED-NOT-A-FIX; deletion-only ⇒ UNVERIFIED-DELETION-ONLY (c3)", () => {});
test("no argv in the engagement ⇒ UNVERIFIED-NO-TEST-SURFACE; failing tests ⇒ UNVERIFIED-TESTS-FAILED", () => {});
test("unrelated dirt is carried, not refused", () => { /* edit README.md ⇒ code 0, verify.json.carried_dirt == ["README.md"] */ });
```
Run → FAIL.

- [ ] **Step 3: Implement `verify.mjs`** (~230 lines) in the spec §6 order: parse flags; `readEngagement`; load `findings.json` from `--review`, locate the finding by `id` (prefix ≥ 8 chars accepted), `base = citations[0].oid`, cited paths = unique citation paths; `revParse(root,"HEAD") !== revParse(root, head)` ⇒ `NOT-AT-HEAD`; `statusPorcelain(root,{paths: cited})` ⇒ `DIRTY`; `statusPorcelain(root)` minus cited ⇒ `carried_dirt`; `mergeBaseIsAncestor(base, head)` and `diffNameOnly(base, head, {paths: cited})` non-empty else verdict `UNVERIFIED-NOT-A-FIX` (written, printed, exit 0 — a verdict is a result, not an error); run dir `<st>/verify/<id.slice(0,8)>-<head.slice(0,7)>/`; first invocation: tests (argv absent ⇒ `tests: null`), `diffUnified` per cited path → `parseUnifiedDiff` → `deletion_only` + advisories (`INLINE_SUPPRESS_RE`/`TEST_SKIP_RE` on added lines), write `verify.json` with `PENDING-REVIEW` (or an early `UNVERIFIED-*`), print advisories and `NEXT`. Second invocation (`--assertion`): read `verify.json` (must exist and be `PENDING-REVIEW`), compute verdict: `deletion_only` ⇒ `UNVERIFIED-DELETION-ONLY`; `tests === null` ⇒ `UNVERIFIED-NO-TEST-SURFACE`; `tests.exit !== 0` ⇒ `UNVERIFIED-TESTS-FAILED`; assertion `refound` ⇒ `UNVERIFIED-REFOUND`; else `VERIFIED`; write; call `fixed`/`regressed` when the register module resolves and a row with that `finding_id` exists (`VERIFIED` ⇒ `fixed`; `UNVERIFIED-REFOUND` on a `fixed` row ⇒ `regressed`); print `VERDICT`. Run → pass.

- [ ] **Step 4: Commit** — `git commit -m "security-testing: verify.mjs (checkout-based fix verification, two invocations)"`

---
### Task 9: `secure-code-review` skill + `security-reviewer` agent

**Files:**
- Create/replace: `skills/secure-code-review/SKILL.md`, `references/{taxonomy,refutation-criteria,do-not-flag}.md` (copied from REF, edited), `references/findings-shape.md` (new), `evals/**` + `fixtures/**` + `scripts/score-findings.mjs` + `scripts/score-findings.test.mjs` (copied verbatim from REF `bundles/security-testing/skills/secure-code-review/`)
- Create/replace: `agents/security-reviewer/{AGENT.md,SOUL.md,RULES.md}`, `briefings/security-reviewer.md`
- Test: `bundles/security-testing/prose.test.mjs` (new; one file for every prose assertion in Tasks 9–12)

**Interfaces:**
- Consumes: the real command spellings of Tasks 3–5 and 8 — quote them from the scripts' `--help` output, never from memory.
- Produces: the four reviewer contracts named exactly `review`, `vulnerability-review`, `mitigation-review`, `fix-review`; the `findings.json` and `second-<id>.json` shapes (spec §6) that every other prose file references.

- [ ] **Step 1: Copy the reusable prose and eval harness**

```bash
D=bundles/security-testing/skills/secure-code-review; RD=$REF:$D
for f in references/taxonomy.md references/refutation-criteria.md references/do-not-flag.md; do git show $RD/$f > $D/$f; done
git archive $REF $D/evals $D/fixtures $D/scripts/score-findings.mjs $D/scripts/score-findings.test.mjs | tar -x
node --test $D/scripts/score-findings.test.mjs   # must pass unchanged
```
Edit the three references: remove every mention of packets, receipts, `gate`, `claims`, `security-evidence`, normalised line numbers; a citation is `path`, raw `lines:[s,e]` (≤ 40), `snippet`. If `score-findings.mjs` reads a prompt or fixture path that moved, fix the path; re-freeze `evals/harness.json` `prompt_sha256` per `evals/README.md` only if `evals/prompt.md` changed.

- [ ] **Step 2: Write `prose.test.mjs` (failing) — the assertions for this task**

```js
import { test } from "node:test"; import assert from "node:assert/strict"; import { readFileSync } from "node:fs"; import { join } from "node:path";
const B = new URL("./", import.meta.url).pathname; const read = (p) => readFileSync(join(B, p), "utf8");
const fm = (text) => Object.fromEntries(text.split("\n---")[0].split("\n").slice(1).filter(l => /^[a-z-]+:/.test(l)).map(l => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trim()]));
test("security-reviewer frontmatter and contracts", () => {
  const a = read("agents/security-reviewer/AGENT.md"); const f = fm(a);
  assert.equal(f.model, "sonnet"); assert.equal(f.skills, "[memory, secure-code-review]"); assert.equal(f["skills-on-demand"], "[systematic-debugging]");
  assert.ok(!("tools" in f) && !("mcpServers" in f));
  for (const c of ["review", "vulnerability-review", "mitigation-review", "fix-review"]) assert.match(a, new RegExp(`### \`${c}\``));
  for (const cmd of ["cite.mjs show", "cite.mjs check", "second-<id>.json", "findings.json"]) assert.ok(a.includes(cmd), cmd);
  for (const banned of ["packet", "receipt", "security-evidence", "gate --claims", "normalised line"]) assert.ok(!a.toLowerCase().includes(banned), banned);
  assert.match(a, /never writes? .*`id`.*`state`.*`verdict`/i); assert.match(a, /fresh dispatch/i);
});
test("secure-code-review SKILL.md names the shapes and the result lines", () => {
  const s = read("skills/secure-code-review/SKILL.md"); assert.match(s, /^description: "Use when /m);
  for (const t of ["CHECK verified=", "FAILED", "COVERAGE examined=", "SECOND", "STALE-REVIEW", "VERDICT", "PENDING-REVIEW"]) assert.ok(s.includes(t), t);
  assert.ok(s.length < 12000, "SKILL.md stays under ~250 lines");
});
```
Run → FAIL.

- [ ] **Step 3: Write `SKILL.md`** (≤ 250 lines): frontmatter (`name: secure-code-review`, `description: "Use when reviewing code for security defects with citations anyone can re-check, giving a second opinion on one finding, or verifying a fix at a commit; provides cite.mjs and verify.mjs."`, `license: MIT`, `metadata: {authors, version: "1.0.0"}`); sections: *What you produce* (the `findings.json` shape — copy the field list from `knowledge/finding-schema.md` — and `second-<id>.json`); *How to read* (investigate-then-refute loop, `cite.mjs show <path> [start end]` while reading, cite ≤ 40 raw lines, snippet copied from `show` output); *The classes* (pointer to `references/taxonomy.md`); *Refutation before writing* (pointer); *Do not flag* (pointer); *Commands and result lines* — paste `node scripts/cite.mjs --help` and `node scripts/verify.mjs --help` output verbatim in fenced blocks and list every result token from spec §6 with one line each; *Standalone use* (`--skills security-testing/secure-code-review`: init → review → check → verify). Write `references/findings-shape.md` = the same shapes with one full example each.

- [ ] **Step 4: Write the agent** — `AGENT.md` (≤ 200 lines): frontmatter `name, description ("Use when a security-lead dispatches a review over the scope paths at HEAD, or a vulnerability-review, mitigation-review or fix-review on one finding or mitigation; writes findings.json or second-<id>.json, never ids, states or verdicts."), model: sonnet, color: red, group: security, theme: {color: colour160, icon: "🛡️", short_name: rev}, aliases: [security-reviewer, secrev], context-docs: security-testing/engagement.md security-testing/knowledge/finding-schema.md, skills: [memory, secure-code-review], skills-on-demand: [systematic-debugging], metadata.authors`; body: the four rules (external text proposes; writable paths; assertions never states; never merge/close/rotate/fix), then one `### \`<contract>\`` section each with *input* (what the lead hands you), *procedure* (numbered, naming `cite.mjs show`), *output* (the file you write and its shape), *return line* (`REVIEW_WRITTEN findings=<n>` / `SECOND_WRITTEN <id> <assertion>` / `FIX_REVIEW_WRITTEN <id> <not-refound|refound>`); *Fresh dispatch* rule: a second opinion or fix-review never runs in the context that wrote the findings; *Session end* (memory skill). `SOUL.md`: copy from REF and cut anything naming packets/receipts. `RULES.md`: the four rules as bullets. `briefings/security-reviewer.md`: 30 lines in the format of `bundles/feature-development/briefings/*.md`. Run `node --test bundles/security-testing/prose.test.mjs` → pass; `npm run validate:factories` → pass.

- [ ] **Step 5: Commit** — `git commit -m "security-testing: secure-code-review skill, security-reviewer agent"`

---

### Task 10: `threat-modeling` skill + `threat-modeler` agent

**Files:**
- Create/replace: `skills/threat-modeling/SKILL.md`, `references/{dfd-elements,stride,mitigations-as-claims,dispositions}.md` (copied from REF, edited); `agents/threat-modeler/{AGENT.md,SOUL.md,RULES.md}`, `briefings/threat-modeler.md`; extend `prose.test.mjs`

**Interfaces:**
- Consumes: Task 5 threat-model mode (`cite.mjs check <st>/threat-model.json`, `TM-INVALID`, `MODEL elements= threats= open=`), Task 7 candidate-case location `<st>/cases/<slug>/TC-NNN_<slug>.md`.
- Produces: the `threat-model.json` shape and the disposition grammar every other prose file quotes; return line `MODEL_WRITTEN elements=<n> threats=<n> open=<n>` only after `cite.mjs check` exits 0, else the `TM-INVALID` lines verbatim.

- [ ] **Step 1: Copy and edit the four references** (`git show $REF:bundles/security-testing/skills/threat-modeling/references/<f>`): keep DFD element kinds, STRIDE per element kind, "mitigations are claims until a `mitigation-review` confirms them", and the sentence from the dogfood: *"cite a mitigation so the range holds both the check and where it is applied, in one ≤ 40-line range"*. Rewrite `dispositions.md` to the five-value grammar of spec §6 and the one-run sequence: write the model with the disposition you can justify now; `check`; a `mitigated(M-nnn)` claim stands in the model and the lead may ask for a `mitigation-review` recorded as `second-M-nnn.json`. Delete `tm-lint`, `run`, `snapshot`, `dispositions.json`, `resolved_via`.

- [ ] **Step 2: Extend `prose.test.mjs`** — `threat-modeler` frontmatter `model: opus`, `skills: [memory, threat-modeling]`, `skills-on-demand: [secure-code-review, gathering-context]`; body matches `/MODEL_WRITTEN elements=<n> threats=<n> open=<n>/`, includes `cite.mjs check`, `.agents/security-testing/cases/`, the five disposition spellings, and none of `tm-lint`, `packet`, `receipt`, `dispositions.json`; SKILL.md description starts "Use when". Run → FAIL.

- [ ] **Step 3: Write `SKILL.md`** (≤ 200 lines: the `threat-model.json` shape with one full example — two elements, one threat, one mitigation; the procedure: enumerate entry points → elements with a citation each → STRIDE per element → mitigations as cited claims → dispositions → `cite.mjs check` → fix `TM-INVALID` → candidate passive cases; pointers to the four references) and the agent (`AGENT.md` ≤ 180 lines with frontmatter `name: threat-modeler, model: opus, color: purple, group: security, theme: {color: colour93, icon: "🕸️", short_name: tm}, aliases: [threat-modeler, tm], context-docs: security-testing/engagement.md security-testing/knowledge/finding-schema.md, skills, skills-on-demand` as above; body: four rules, procedure, the return-line rule, session end). `SOUL.md`/`RULES.md`/briefing as in Task 9. Run the prose test → pass.

- [ ] **Step 4: Commit** — `git commit -m "security-testing: threat-modeling skill, threat-modeler agent"`

---

### Task 11: `security-test-planning`, `risk-register`, `security-engagement` skills

**Files:**
- Create/replace: `skills/security-test-planning/SKILL.md`, `references/{passive-admission,audit-branch}.md` (copied from REF, edited); `skills/risk-register/SKILL.md`, `references/{transitions,approvals}.md` (copied, edited; `anchor.md` dropped); `skills/security-engagement/SKILL.md`, `references/{workflow,sign-off-checklist,tracker-rules}.md` (rewritten; `disclosure-profiles.md` dropped); extend `prose.test.mjs`

**Interfaces:**
- Consumes: Task 6 verbs and lines, Task 7 lines and prompts, Task 3–5 lines, Task 8 verdicts.
- Produces: `references/workflow.md` = spec §7 as the lead's canonical 11-step procedure with the exact commands (Task 12's AGENT.md points at it instead of restating it — one spelling, one place); `sign-off-checklist.md` = spec §7 step 11.

- [ ] **Step 1: Extend `prose.test.mjs`**: `risk-register/SKILL.md` names every event of `transitions.mjs` `TRANSITIONS` (import the module and iterate its keys), contains "authenticated: false" and "there is no confirmed state", names `register.mjs render`; `security-test-planning/SKILL.md` mandates `TC-NNN_<slug>.md` under `.agents/security-testing/cases/<slug>/`, names `cases.mjs admit`, `verify-suite`, the words "admitted by lint" and never the word "safe" as a claim (assert `!/\bsafe\b/i` outside the phrase "never says safe"); `security-engagement/references/workflow.md` lists the commands in spec §7 order (assert the index of each of `cite.mjs init`, `cite.mjs check`, `register.mjs add`, `cases.mjs admit`, `cases.mjs verify-suite`, `verify.mjs`, `register.mjs accept`, `register.mjs status` is increasing) and contains no `evidence.mjs`, `run init`, `packet`, `publish`, `COMMITTED`, `M2`, `M3`. Run → FAIL.

- [ ] **Step 2: Write the three skills** — `security-test-planning/SKILL.md` (≤ 150 lines: the manual-qa `TC-NNN_<slug>.md` format pointer to `bundles/manual-qa/knowledge/test-case-format.md` fields incl. `size:`, candidate location, `passive-admission.md` grammar summary, `cases.mjs admit` outcomes, the audit-branch form for header/cookie checks, `verify-suite` and the two prompts); `risk-register/SKILL.md` (≤ 150 lines: a row, the ten events as `from → to` prose generated from the table, approvals shape, open exposure never reduced, `FINGERPRINT` and `--expect`, `render`); `security-engagement/SKILL.md` (≤ 100 lines: the lead's role, pointers to the three references, standalone vs factory install); `references/workflow.md` = the 11 steps with fenced command lines and expected result lines; `sign-off-checklist.md`; `tracker-rules.md` (post via `issue-tracking`, search by title before posting, `register.mjs ticket`, threats are not ticketed in v1). Run the prose test → pass.

- [ ] **Step 3: Commit** — `git commit -m "security-testing: planning, register and engagement skills"`

---
### Task 12: `security-lead` agent, bundle README, CHANGELOG

**Files:**
- Create/replace: `agents/security-lead/{AGENT.md,SOUL.md,RULES.md}`, `briefings/security-lead.md`, `bundles/security-testing/README.md` (full), `CHANGELOG.md`; extend `prose.test.mjs`

**Interfaces:**
- Consumes: Task 11 `references/workflow.md` (the lead's procedure lives there; AGENT.md links to it and restates only the phase names and the stop rule).
- Produces: README "Guarantees" table = spec §2 left column with `enforced by: script` per row and the right column as "Not guaranteed"; the standalone section; the install smoke block (a fenced block of the exact commands Task 14's E2E runs, compared by the test).

- [ ] **Step 1: Extend `prose.test.mjs`**: lead frontmatter `model: sonnet`, `skills: [memory, security-engagement]`, `skills-on-demand: [secure-code-review, risk-register, security-test-planning, issue-tracking, verifying-outcomes]`, `context-docs` = `security-testing/engagement.md security-testing/knowledge/finding-schema.md security-testing/risk-register.md`; body: names the phases *Init · Review · Register · Model · Cases · Hand-off (stop) · Report · Fix · Acceptances · Sign-off*, contains "proposes" and never "approves" as a lead action (assert `!/lead approves/i`), contains `references/workflow.md`, and is ≤ 250 lines; README contains the Guarantees table with six `script` rows and the phrase "Not guaranteed", never "exact checkout", and a fenced block starting with `npx github:arozumenko/sdlc-skills init --factory security-testing`. Run → FAIL.

- [ ] **Step 2: Write the lead agent** — frontmatter `name: security-lead, description: "Use when starting or running a security engagement: initialises the engagement, dispatches the reviewer and modeler, checks their citations, admits passive cases, prints the hand-off prompts and stops, writes the report, verifies fixes and proposes acceptances. The only human-facing security role.", model: sonnet, color: blue, group: security, theme: {color: colour27, icon: "🔐", short_name: lead}, aliases: [security-lead, seclead]`; body: the four rules; *Phases* (ten bullets, each one sentence and the command it runs, then "Full procedure: `references/workflow.md`"); *Dispatch rules* (fresh context per contract; what you hand each role; what return line you expect); *Stop rule* (after `verify-suite` prints the prompts, paste them to the user and end the turn); *Report* (template + `cite.mjs redact`); *Acceptances* (propose with `--approved-by`/`--approval-ref` the human supplies; never call anything approved); *Tracker* (pointer); *Self-check before every write* (path allowlist); *Session end*. `SOUL.md`/`RULES.md`/briefing as before.

- [ ] **Step 3: Write `README.md`** (≤ 300 lines): what it is (spec §1), roster table, the five skills table, install (factory + standalone one-skill), the fenced smoke block (Task 14 fixes its exact lines — write it now as: `npx … init --factory security-testing --target claude --yes`, `node .claude/skills/secure-code-review/scripts/cite.mjs init`, `node … cite.mjs check .agents/security-testing/reviews/<dir>/findings.json`, `node .claude/skills/risk-register/scripts/register.mjs status`), how an assessment runs (the ten phases, one line each), artifacts and where they live, Guarantees / Not guaranteed, hand-offs, v2 list (spec §12). `CHANGELOG.md`: one `1.0.0` entry naming the four scripts and the design supersession. Run the prose test → pass; `npm run validate:factories` → pass.

- [ ] **Step 4: Commit** — `git commit -m "security-testing: security-lead agent, README, CHANGELOG"`

---

### Task 13: Catalog wiring and sibling-bundle edits

**Files:**
- Modify: `README.md` (catalog row + install line), `AGENTS.md` (row), `bundles/SPEC.md` (Current factories row), `.claude-plugin/marketplace.json` (three agent entries, five skill entries — follow the file's existing `./factories/<id>/…` source shape verbatim, it is what every entry uses today), `bundles/manual-qa/agents/test-run-lead/AGENT.md` (Step 0 row + Step 2 clause), `bundles/feature-development/skills/code-review/SKILL.md` (one line)
- Regenerate: `.cursor-plugin/`, `.codex-plugin/`, `.github/plugin/` via `npm run gen:marketplaces`
- Test: `bin/gen-marketplaces.test.mjs`, `bin/validate-factories.test.mjs` (existing); one grep test added to `prose.test.mjs`

**Interfaces:**
- Consumes: the reference branch's wording for the two sibling edits — `git show $REF:bundles/manual-qa/agents/test-run-lead/AGENT.md | sed -n '49,51p;108p'` and `git show $REF:bundles/feature-development/skills/code-review/SKILL.md | sed -n 49p` — reworded from `evidence.mjs publish --profile case` to `cases.mjs admit` / `.admitted.json`, and from `verify.mjs all --finding <id> --base <oid> --head <oid>` to `verify.mjs --finding <id> --review <dir> --head <oid>`; the standalone flag becomes `--skills security-testing/secure-code-review`.

- [ ] **Step 1: Add a test to `prose.test.mjs`**: `README.md` (repo root), `AGENTS.md`, `bundles/SPEC.md` each contain a line with `security-testing` naming `security-lead`, `threat-modeler`, `security-reviewer`; `grep -r "exact checkout"` over those files, the four marketplaces and `bundles/security-testing` is empty (implement with `execFileSync("grep", ["-rl", "exact checkout", …])` expecting exit 1); `.claude-plugin/marketplace.json` parses and contains `security-lead`; `bundles/manual-qa/agents/test-run-lead/AGENT.md` contains `tasks/security-<slug>-admitted/` and `never Edit those files`; `bundles/feature-development/skills/code-review/SKILL.md` contains `secure-code-review` and `verify.mjs --finding`. Run → FAIL.

- [ ] **Step 2: Make the edits**, then `npm run gen:marketplaces && npm run validate:marketplaces` → up to date; `npm run validate:factories`; `node --test bin/` → pass; the new prose test → pass. `git diff --stat` must show exactly: the three catalog docs, the four marketplace files, the two sibling files, `prose.test.mjs`.

- [ ] **Step 3: Commit** — `git commit -m "security-testing: catalog rows, marketplaces, manual-qa and feature-development pointers"`

---

### Task 14: Installed end-to-end test (offline) and final verification

**Files:**
- Create: `bin/security-testing-e2e.test.mjs`, `bin/fixtures/security-testing-e2e/` (helpers only; repos built by code)
- Modify: `bundles/security-testing/README.md` smoke block if the commands differ from what the test runs (the test compares them)

**Interfaces:**
- Consumes: the installer (`node bin/init.mjs init --factory security-testing --target claude --yes` and `--skills security-testing/secure-code-review --target claude --yes`) into a temp consumer repo; every script's result lines.
- Produces: the proof that an install works offline on Claude and that the one-skill standalone path runs init → check → verify; a file-count assertion that keeps the bundle small.

- [ ] **Step 1: Write the test (failing until the whole bundle exists)**

```js
import { test } from "node:test"; import assert from "node:assert/strict";
import { spawnSync } from "node:child_process"; import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, readdirSync, statSync, existsSync } from "node:fs"; import { join } from "node:path"; import { tmpdir } from "node:os";
const REPO = new URL("..", import.meta.url).pathname; const INIT = join(REPO, "bin/init.mjs");
const sh = (cwd, cmd, args, env = {}) => spawnSync(cmd, args, { cwd, encoding: "utf8", env: { ...process.env, ...env, HOME: cwd, SDLC_SKILLS_CACHE: join(cwd, ".cache") } });
function consumerRepo() { const root = mkdtempSync(join(tmpdir(), "st-e2e-")); sh(root, "git", ["init", "-q"]); sh(root, "git", ["config", "user.email", "t@t"]); sh(root, "git", ["config", "user.name", "t"]);
  mkdirSync(join(root, "src")); writeFileSync(join(root, "src/app.js"), "export function q(db, id) {\n  return db.query('SELECT * FROM t WHERE id = ' + id);\n}\n"); writeFileSync(join(root, "package.json"), '{"name":"c","type":"module","scripts":{"test":"node --test"}}\n');
  sh(root, "git", ["add", "-A"]); sh(root, "git", ["commit", "-qm", "c1"]); return root; }
const walk = (d) => readdirSync(d).flatMap((n) => statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]);
test("factory install on claude: three agents, five skills, briefings, splice; no network", () => {
  const root = consumerRepo(); const r = sh(root, process.execPath, [INIT, "init", "--factory", "security-testing", "--target", "claude", "--yes"], { GIT_CONFIG_GLOBAL: join(REPO, "bin/fixtures/security-testing-e2e/no-network.gitconfig") });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  for (const a of ["security-lead", "threat-modeler", "security-reviewer"]) { assert.ok(existsSync(join(root, ".claude/agents", a, "AGENT.md")), a); assert.ok(existsSync(join(root, ".agents/memory", a, "project_briefing.md")), a + " briefing"); }
  for (const s of ["secure-code-review", "threat-modeling", "security-test-planning", "risk-register", "security-engagement"]) assert.ok(existsSync(join(root, ".claude/skills", s, "SKILL.md")), s);
  assert.match(readFileSync(join(root, "CLAUDE.md"), "utf8"), /<!-- FACTORY:security-testing START -->/);
  const installed = walk(join(root, ".claude/skills")).filter((p) => /security-testing|secure-code-review|threat-modeling|security-test-planning|risk-register|security-engagement/.test(p));
  assert.ok(installed.length <= 90, `installed files ${installed.length} > 90 — the bundle is growing again`);
});
test("standalone one-skill path: init → review → check → register → verify", () => {
  const root = consumerRepo(); assert.equal(sh(root, process.execPath, [INIT, "init", "--skills", "security-testing/secure-code-review", "--target", "claude", "--yes"]).status, 0);
  const cite = join(root, ".claude/skills/secure-code-review/scripts/cite.mjs");
  let r = sh(root, process.execPath, [cite, "init"]); assert.equal(r.status, 2); assert.match(r.stdout, /EDIT-ENGAGEMENT-AND-RERUN/);
  writeFileSync(join(root, ".agents/security-testing/engagement.md"), "```json engagement\n" + JSON.stringify({ engagement_id: "c-2026", slug: "c", scope_paths: ["src/"], execute_project_tests: { argv: ["npm", "test"] } }) + "\n```\n");
  r = sh(root, process.execPath, [cite, "init"]); assert.equal(r.status, 0, r.stdout); assert.match(r.stdout, /INIT ok/);
  const head = sh(root, "git", ["rev-parse", "HEAD"]).stdout.trim(); const dir = join(root, ".agents/security-testing/reviews/r1"); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "findings.json"), JSON.stringify({ head, scope_paths: ["src/"], examined: [{ path: "src/app.js" }], findings: [{ title: "SQL built by concatenation", class: "injection", priority: "p1", confidence: "high", citations: [{ path: "src/app.js", lines: [2, 2], snippet: "return db.query('SELECT * FROM t WHERE id = ' + id);" }], rationale: "id reaches the query string", fix: "parameterise" }] }));
  r = sh(root, process.execPath, [cite, "check", ".agents/security-testing/reviews/r1/findings.json"]); assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /CHECK verified=1 failed=0/); assert.match(r.stdout, /COVERAGE examined=1 partial=0 unexamined=0/);
  const id = JSON.parse(readFileSync(join(dir, "findings.json"), "utf8")).findings[0].id;
  // fix commit
  writeFileSync(join(root, "src/app.js"), "export function q(db, id) {\n  return db.query('SELECT * FROM t WHERE id = ?', [id]);\n}\n"); writeFileSync(join(root, "src/app.test.mjs"), "import { test } from 'node:test'; test('ok', () => {});\n"); sh(root, "git", ["add", "-A"]); sh(root, "git", ["commit", "-qm", "fix"]);
  const verify = join(root, ".claude/skills/secure-code-review/scripts/verify.mjs"); const head2 = sh(root, "git", ["rev-parse", "HEAD"]).stdout.trim();
  r = sh(root, process.execPath, [verify, "--finding", id, "--review", ".agents/security-testing/reviews/r1", "--head", head2]); assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /NEXT: dispatch security-reviewer fix-review/);
  r = sh(root, process.execPath, [verify, "--finding", id, "--review", ".agents/security-testing/reviews/r1", "--head", head2, "--assertion", "not-refound", "--by", "e2e"]); assert.match(r.stdout, /VERDICT VERIFIED finding=/); assert.match(r.stdout, /REGISTER: skipped/);
});
test("README smoke block matches the commands this test runs", () => {
  const readme = readFileSync(join(REPO, "bundles/security-testing/README.md"), "utf8"); const block = readme.split("```bash")[1].split("```")[0];
  for (const cmd of ["init --factory security-testing --target claude --yes", "cite.mjs init", "cite.mjs check", "register.mjs status"]) assert.ok(block.includes(cmd), cmd);
});
```
`no-network.gitconfig`: `[url "/nonexistent/"]\n\tinsteadOf = https://github.com/\n` — the factory install must resolve `memory`/`knowledge-curation` from the monorepo and must not fetch anything (the roster declares no external skills; if the installer still tries, the test fails loudly). Run → FAIL until Tasks 1–13 are in.

- [ ] **Step 2: Run it** — `node --test bin/security-testing-e2e.test.mjs` → pass. If the installed-file count exceeds 90, cut (fixtures that can be generated, references that duplicate SKILL.md) before raising the bound.

- [ ] **Step 3: Full verification** — `npm test` (expect the whole suite green in well under a minute for this bundle's files: `time node --test bundles/security-testing`), `npm run validate` (includes the network externals check — allowed here, once), `git status --porcelain` empty.

- [ ] **Step 4: Commit** — `git add bin/security-testing-e2e.test.mjs bin/fixtures && git commit -m "security-testing: installed end-to-end test (offline), final verification"`

---

## Self-review (done while writing)

- Spec coverage: §1/§2 → Tasks 12 README + every script; §3 D1 → Task 1 manifest; D2 → Task 4 (re-runnable check, `check_stamp`); D3 → Task 3/4 raw lines; D4 → Task 8; D5 → Task 4 `findingId`; D6 → Task 5 `--md`, Task 12 template; D7 → Task 6; D8 → Global constraints; D9 → Task 3 `init`; D10 → Task 4 refusal; §4 roster → Tasks 9/10/12; §5 skills → Tasks 9–11; §6 each script → Tasks 3–8; §7 flow → Task 11 `workflow.md`; §8 hand-offs → Tasks 7 (prompts) and 13 (sibling edits); §9 files → Tasks 1, 14 (count bound); §10 tests → every task + Task 14; §11 migration → the `git show` steps; §12 → Task 12 README v2 list.
- Names used consistently: `readEngagement`, `stDir`, `runCli`, `redactString`, `normalizeText`, `checkCitation`, `findingId`, `tileCoverage`, `lintThreatModel`, `foldEvents`, `applyTransition`, `lintCase`, `runTests`, `parseUnifiedDiff`, `fixed`/`regressed`; result tokens as in spec §6.
- No placeholders: every code step carries the code or the exact copy command and the trimming list; prose steps carry the section list and the assertions that pin them.

### PM log additions (after G1)

Reviewer nits from Rio's PASS reviews of Tasks 1 and 2, recorded verbatim. Owner = the task that must act on the nit.

| Owner | Source | Nit |
|---|---|---|
| Task 13 | Task 1 | Task 13: the three generated marketplaces (.cursor-plugin/, .codex-plugin/, .github/plugin/) are stale on this branch because gen-marketplaces now discovers the new bundle; `node bin/gen-marketplaces.mjs --check` prints three '! stale' lines (exit 0, and no *.test.mjs fails). Task 13 regenerates them as the plan sequences it — do not regenerate in Task 1. |
| Task 9 | Task 1 | Task 9: knowledge/finding-schema.md defers the 15 class ids to `secure-code-review/references/taxonomy.md` instead of listing them; Task 9 must ship that file with exactly 15 ids or the schema doc dangles. Acceptable per plan Step 4 ('the 15 classes are the taxonomy.md ids (Task 9)'). |
| Task 4 | Task 1 | Task 4: finding-schema.md states 'the first citation is the finding's identity anchor' — Task 4's `findingId` must therefore hash `citations[0]` (Task 8 already uses `citations[0].oid` as `base`, so keep that consistent). |
| Task 7 | Task 1 | Task 7: engagement.md.template claims `base_url` is 'substituted for {{base_url}} in the hand-off prompts' — cases.mjs verify-suite must actually do that substitution, or trim the sentence when Task 7 lands. |
| Task 12/14 | Task 1 | Task 12/14: placeholder AGENT.md/SOUL.md/SKILL.md/briefing bodies say 'Placeholder … replaced in Task N'; the prose.test.mjs added in Tasks 9–12 should assert no 'Placeholder' / 'replaced in Task' text remains anywhere under bundles/security-testing so a missed replacement cannot ship. |
| CI owner (pre-existing) | Task 1 | Pre-existing, not this task: .github/workflows/validate.yml's skills-ref loop globs `factories/*/skills/*/` while the tree uses `bundles/`, so the new SKILL.md files are not spec-validated in CI. Route to whoever owns CI; the five placeholders satisfy the agentskills.io shape (name = dir, 'Use when' description ≤ 1024, license, metadata.version) by inspection. |
| Task 2 (before Task 7) | Task 2 | [cli.mjs:102 → owner Task 2, must land before Task 7 pins byte-identical copies] `cite show --help` parses `--help` as a value-taking flag and prints `USAGE(cli: --help needs a value)`; treat `--help`/`-h` anywhere in argv as help (or add them to `booleans`). |
| Task 6 | Task 2 | [cli.mjs:112-118 → owner Task 6] Every error carrying a string `.token` exits 2; Task 6 plans `CorruptError → exit 5 via a runCli mapping`. Add `if (typeof e.exitCode === "number") return e.exitCode` (default 2) to cli.mjs before the dupes group pins it, so Task 6 does not have to fork three byte-identical copies. |
| Task 2 | Task 2 | [cli.mjs:65-72 → owner Task 2] `discoverRoot` inherits `process.env` (a consumer's `GIT_DIR`/`GIT_WORK_TREE` is honoured) while every git.mjs call strips them via `gitEnv()`; the root cli discovers and the tree git.mjs operates on can disagree. Pass a minimal env (`PATH`, `HOME`) to the rev-parse call, or document the asymmetry. |
| Task 4 / Task 6 / Task 8 | Task 2 | [cli.mjs:120 → owners Task 4 (parseStrict), Task 6 (readLog), Task 8 (verify.json read)] The `INTERNAL <name>: <message>` path prints `e.message` unredacted on stderr, and V8 `JSON.parse` SyntaxErrors echo ~10 bytes of the source (`Unexpected token 'h', "hunter22x "... is not valid JSON`). engagement.mjs already keeps that detail out of the printed token; every later script must wrap `JSON.parse` of agent-written files so file bytes never reach a thrown message. |
| Task 4 / Task 8 | Task 2 | [git.mjs:190-191 → owners Task 4 (`DIRTY-SCOPE <path>`), Task 8 (`DIRTY <path>` / carried_dirt)] `statusPorcelain` renders a rename as `"R  old -> new"`; consumers taking `line.slice(3)` must split on ` -> ` and use the last segment, or a rename prints `DIRTY old -> new`. |
| Task 2 (pinned by Task 7) | Task 2 | [redaction-rules.json:7 → owner Task 2, pinned by Task 7] The bearer rule is the plan's `(?<=\bBearer\s)` — a single whitespace — so `Bearer  <token>` (two spaces) is not redacted (verified). `\s+` is the safer lookbehind; a plan-as-written rule, so not blocking. |
| Task 3 | Task 2 | [git.test.mjs:18 → owner Task 3] The fixture repo sets `commit.gpgsign false` because `HOME` passes through `gitEnv()`; `fixtures/cite/build-repo.mjs` must do the same or a signing user gitconfig breaks every cite test. |
| Task 12 | Task 2 | [cli.mjs:116-118 → owner Task 12 docs] `GIT-ERROR <message>` is a result line spec §6 does not name (the dev flagged it). Acceptable as the git failure path; the skill README / SKILL.md must list it with exit 2 so operators recognise it. |
| Task 4 | Task 2 | [Global Constraints line 19 → owner Task 4] `MAX_RANGE_LINES = 40` is not exported from this lib; Task 4's `checkCitation` and Task 3's `show` both need it — export it from `cite.mjs`'s top section (per the plan's 'no shared token registry' rule), not from lib. |

### PM log additions (after G2)

Reviewer nits from Rio's PASS review of Task 3, recorded verbatim. Owner = the task that must act on the nit.

| Owner | Source | Nit |
|---|---|---|
| Task 3 / Task 12 (docs) | Task 3 | Task 3: [cite.mjs:94-102 → owner Task 3, docs Task 12] The `.gitignore` write bypasses `redactString` (latin1 round-trip of the consumer's own lines + our ASCII block). Not a leak — the same bytes go back to the same file, and redacting a consumer's ignore file would corrupt it — but it is a documented exception to the Global Constraint 'every string a script writes to disk'; keep it, and have the skill README/SKILL.md name `.gitignore` as the one unredacted write so the next reviewer does not re-flag it. |
| Task 4 | Task 3 | Task 3: [cite.mjs:116-127 `underScope` → owner Task 4] `./src/app.js` passes the scope check and is then used raw: `show` prints `SHOW ./src/app.js <oid7> 1-2` (verified) and git resolves `<oid>:./src/app.js` relative to cwd. Harmless for `show`, but Task 4 reuses `underScope` for citation paths and tiles coverage against `git ls-files` output — a `./`-prefixed citation path would pass scope yet never match a tiled path. Task 4's `checkCitation` must canonicalise (strip leading `./`, reject `.`/`` segments) or refuse non-canonical paths with `FAILED(path-not-canonical)`; `show` could do the same for the header for consistency. |
| Task 9 / Task 12 | Task 3 | Task 3: [cite.mjs:70-74 `templatePath` → owner Task 9/12] Standalone install (spec D1: `--skills security-testing/secure-code-review`) seeds no `knowledge/` and has no `<skill>/../../../knowledge/`, so `cite.mjs init` on a fresh standalone consumer prints `USAGE(init: engagement template not found (looked in ...))` exit 2. Plan-as-written (Task 3 Step 3 names exactly these two candidates), so not blocking; Task 12's README/SKILL.md must tell standalone users to write `engagement.md` by hand (the fenced `json engagement` block), or Task 9 ships the template under the skill's own `references/` and adds it as a third candidate. |
| Task 2 (already logged after G1) | Task 3 | Task 3: [cli.mjs:102 → owner Task 2, already in the PM log] `cite show --help` prints `USAGE(cite: --help needs a value)`; the dev observed it and correctly did not fix it here. No action for Task 3. |
| Task 12 (docs) | Task 3 | Task 3: [cite.mjs:141 → owner Task 12 docs] `USAGE(show: <path> is not under scope_paths (<scope list>))` appends the scope list in parentheses, extending the plan's message; the tests use `startsWith` so it is compatible. Docs should quote the actual line. |
| Task 3 (optional) | Task 3 | Task 3: [cite.test.mjs:147 → owner Task 3, optional] The test titled 'importing does not run main' asserts that only implicitly (a `process.exit` inside `await import(CITE)` would kill the runner). The blocking fix's symlink test makes the entry-guard behaviour explicit; if the dev wants the import side explicit too, assert `typeof mod.underScope === 'function'` after the import so the test body documents what it proves. |
| Task 2 (before Task 4 and Task 7) | Task 3 | Task 3: [redaction-rules.json:9 → owner Task 2, MUST land before Task 4 stamps oid/id and before Task 7 pins the byte-identical copies] The `high-entropy` rule `[A-Za-z0-9+/]{40,}` matches every 40-hex commit oid and 64-hex sha256: verified `redactString("base=<40hex>")` → `base=<REDACTED:high-entropy>`, `JSON.stringify({oid})` → `{"oid":"<REDACTED:high-entropy>"}`, a 64-hex id likewise. Task 3 is unaffected (it prints `oid7` only; the one cosmetic hit is `USAGE(show: unknown ref <40hex>)`), but spec §6 requires full oids/hashes in `check`'s written `oid`/`id` (Task 4), `FINGERPRINT <eng>:<seq>:<sha256>` (Task 6), `TABLES sha256=<h>` (Task 5) and `VERDICT … base=<oid> head=<oid>` (Task 8). Fix in the rule (e.g. negative lookahead `(?![0-9a-f]{40}(?![A-Za-z0-9+/=]))` / exclude pure-hex 40 and 64), or every later task redacts field-wise (snippets/notes) rather than the serialized line/file — one or the other must be decided now. |
| Task 4 | Task 3 | Task 3: [cite.mjs:143,174 → owner Task 4] `show ./src/app.js` passes `underScope` and git resolves `./` from root, but the header prints `SHOW ./src/app.js …` uncanonicalised; Task 4's `checkCitation` must canonicalise `path` (strip `./`, collapse `.` segments) before the D5 hash and the scope test, or the same file yields two ids. Dev already routed this. |
| Task 12 (docs) | Task 3 | Task 3: [cite.mjs:93-105 → owner Task 3, documentation only] The `.gitignore` latin1 round-trip is the one write that bypasses `redactString`; sanctioned by the plan (readGitignore copied as-is from the reference) and now commented. Task 12's SKILL.md/README should state the same one-line exception so the §2 'nothing a script writes' promise is read accurately. |
| Task 14 (and Task 9/12) | Task 3 | Task 3: [cite.mjs:69-74 → owner Task 14] The `<root>/.agents/security-testing/knowledge/engagement.md.template` fallback is never exercised: in-repo the skill-relative candidate always exists. The installed E2E must run `cite.mjs init` from an installed location (`.claude/skills/secure-code-review/scripts/`) so the `seed.knowledge` copy is the one found, otherwise a standalone `--skills security-testing/secure-code-review` install (no seeded knowledge/) fails with `USAGE(init: engagement template not found …)` — Task 9/12 must also decide whether the standalone install ships the template. |
| Task 12 | Task 3 | Task 3: [cite.test.mjs:30 → owner Task 12] The seeded-file byte-equality assertion implicitly pins 'the template has zero redaction hits'; a future template edit that adds a sample `Bearer …`/JWT/40+-char value will fail this test with a misleading message. Keep the template free of rule-matching bytes, or assert `redactString(template).hits === 0` explicitly beside it. |
| Task 3 (cosmetic) / Task 4 (note) | Task 3 | Task 3: [cite.mjs:170 → owner Task 3, cosmetic] `bytes.toString("utf8")` on a non-UTF-8 blob prints U+FFFD lines rather than refusing; `normalize.mjs` already has `EncodingError` for Task 4's compare path, so `show` stays a display helper. Acceptable; noting so Task 4 does not reuse this split for the snippet compare. |

### PM log additions (after G3)

Reviewer nits from Rio's PASS review of Task 4, recorded verbatim. Owner = the task that must act on the nit.

| Owner | Source | Nit |
|---|---|---|
| Task 4 (optional) / Task 9 (docs) | Task 4 | Task 4: [cite.mjs:365 → owner Task 4 (optional) / Task 9 docs] `check` ignores the document's own `scope_paths` and uses `engagement.md`'s; a findings file whose `scope_paths` disagrees with the engagement is silently checked against the engagement's list. Either print `USAGE(check: scope_paths differs from engagement.md)` or have finding-schema.md say the field is informational. |
| Task 5 / Task 9 (docs) | Task 4 | Task 4: [cite.mjs:397-398 → owner Task 5/9 docs] Coverage tiles `git ls-files` (the index at run time) against line counts at `doc.head`; when `head` is an older commit a file added since counts 0 lines and rows as unexamined, and a file deleted since is absent from the rows. Plan-as-written; docs should state coverage is 'index files, lines at head'. |
| Task 4 (optional) | Task 4 | Task 4: [cite.mjs:326 → owner Task 4 (optional)] A `second-<x>.json` whose `finding_id` differs from `<x>` in its filename is reported under `finding_id`; the filename is never checked against it. Spec §6 names the file `second-<id>.json`; refusing a mismatch (STALE-REVIEW by filename id) would keep the directory listing trustworthy. |
| Task 5 | Task 4 | Task 4: [cite.mjs:131 + lib/citations.mjs:52-72 → owner Task 5] `underScope` is now implemented twice (exported from cite.mjs for `show`, private in citations.mjs after `canonicalPath`); `show` still prints the uncanonical path in its header. Task 5, which touches cite.mjs anyway, can route `show` through `canonicalPath` + the lib's scope test and delete the cite.mjs copy. |
| Task 5 | Task 4 | Task 4: [cite.test.mjs:407 → owner Task 5] `assert.ok(r.code === 2 \|\| r.code === 0, "--md belongs to the next task")` is a placeholder that proves nothing; Task 5 must replace it with the real `--md` assertions (and add `--md`/`--no-snippets` to `booleans`). |
| Task 9 / Task 12 (docs), PM decision | Task 4 | Task 4: [cite.mjs:410-411 → owner Task 9/12 docs, D2/D10 tension already flagged by the dev] With the plan's stamp rule, a FAILED citation cannot be edited in place inside the stamped file (stamp mismatch ⇒ `REFUSED agent-written key id`); the working fix flow is 'reviewer rewrites its assertion file without check's keys, lead re-runs check'. finding-schema.md line 47 currently says 'A FAILED citation is fixed in place and re-checked' — Task 9 must reword it to match, or the PM decides the stamp rule should relax on mismatch (it cannot without weakening D10). |
| Task 2 (already in the PM log) | Task 4 | Task 4: [redaction-rules.json:7 → owner Task 2, already in the PM log] Verified again here: a rationale containing `Bearer  <36 chars>` (two spaces) is written back unredacted — the single-`\s` bearer lookbehind; not a §2 leak by the rule list's own definition, but the rule fix should land before Task 7 pins the copies. |
| PM (before Task 6) | Task 4 | Task 4: [lib/citations.mjs:187-195 → owner PM, dev flagged] D5 'first line' read as the first redacted normalised snippet line: two findings with identical path/class/snippet at two locations collide on one id (the reference used `occurrence`). Not a Task 4 defect; the PM should decide before Task 6's `register add` treats the id as the live-row key. |
| Task 9 (docs) | Task 4 | Task 4: [cite.mjs:407 → owner Task 9 docs] `findings_sha256` is the sha256 of findings.json bytes as read at the start of the run, i.e. the STAMPED file the lead already checked (the plan's 'with check_stamp and coverage removed' was correctly dropped — it reproduces no hashable state). finding-schema.md line 59 'sha256 of findings.json as read' matches; the security-reviewer contract in Task 9 must say 'hash the file exactly as it is on disk after the lead's check'. |
| Task 9 (SKILL.md) / Task 12 (README) | Task 4 | Task 4: [cite.mjs:288-303 `secondOpinions` → owner Task 9 (SKILL.md) / Task 12 (README)] `findings_sha256` is the sha256 of the findings.json bytes AS ON DISK after the lead's `check` run — the plan's 'with check_stamp and coverage removed' variant was not implemented literally; the two are equivalent because a re-run is byte-idempotent (verified for all six redaction rules, not only the fixture's key-value hit). Docs must say exactly: run `check`, then hash the stamped file; `oid` in the second-opinion file must be the FULL 40-hex first-citation oid (a short oid is STALE-REVIEW). |
| Task 9 (SKILL.md), note for PM | Task 4 | Task 4: [cite.mjs:203-214 D10 stamp + Task 4 test 'a wrong snippet …' → owner Task 9 (SKILL.md), note for PM] The D2 'fix a FAILED citation in place' loop only works if the agent's edit removes check's keys (`state`, `snippet_redacted`, `id`, `coverage`, `check_stamp`; `oid` may stay) — an edit under a valid stamp is `REFUSED agent-written key id\|state` (verified: fixing the snippet in a stamped file exits 2). Plan-as-written, not a D2 violation, but the reviewer prose must spell out the loop: keep your own unstamped findings.json as the source, or strip check's keys before re-running. |
| PM (binding on Tasks 5/6/8 and Task 2/7) | Task 4 | Task 4: [cite.mjs:207,216-236 `token`/`redactDeep`/HEX_KEYS → owner PM, binding on Tasks 5/6/8 and Task 2/7] The G2 'fix the high-entropy rule OR redact field-wise' decision is now made: field-wise, with a HEX_KEYS whitelist (`head`,`oid`,`id`,`check_stamp`,`finding_id`,`findings_sha256`) and `token()` for result lines; `SECOND`/`STALE-REVIEW` go through `ctx.out` (token-redacted) not `say`. `redaction-rules.json` is unchanged, so Task 5 (`TABLES sha256=<h>`), Task 6 (`FINGERPRINT …:<sha256>`) and Task 8 (`VERDICT … base=<oid>`) must each use the same token-wise print or every full hash they emit will be eaten by `say`; Task 7's dupes group can pin the rules file as-is. |
| Task 9 (docs) / Task 5 (optional) | Task 4 | Task 4: [cite.mjs:398-399, 421 → owner Task 9 docs (agents always write `head`); optional Task 5] `head` is not stamped when absent, so a re-run after a new commit recomputes coverage at the new HEAD while citations keep the old oid; and `lsFiles` lists the index, so with `doc.head` older than HEAD, files added since show as 0-line `unexamined` rows (showBytes fails → 0). Both plan-as-written (`doc.head ?? HEAD`, `git ls-files`); docs should require `head` = the tip under review, or Task 5 stamps `head` on first write. |
| Task 5 | Task 4 | Task 4: [cite.mjs:460, cli.mjs runCli call → owner Task 5] `check <file> --md` prints `USAGE(cite: --md needs a value)` exit 2 because cite.mjs passes no `booleans` to runCli; Task 5 must add `booleans: ["md", "no-snippets"]` (the Task 4 test deliberately tolerates 0 or 2 here). |
| Task 5 | Task 4 | Task 4: [coverage.mjs:100-103 → owner Task 5 (`--md` coverage table)] An `unexamined` row carries `ranges: [[1,n]]` (the whole file, so the row still tiles) while an `examined` row carries the same span — the two are distinguishable only by `status`; render the table by `status` and treat `ranges` as 'examined ranges' only on partial rows (`unexamined` holes are on the row). |
| Task 4 (optional) / Task 12 (docs) | Task 4 | Task 4: [cite.mjs:447 `writeFileSync(abs, …)` → owner Task 4 (optional) / Task 12 docs] The write-back is not atomic; a crash mid-write leaves a truncated findings.json that the next run reports as `USAGE(check: … not valid JSON)`. Optional: write to a sibling temp file and rename. Same class applies to Task 6's events.jsonl append. |
| Task 12 (docs) | Task 4 | Task 4: [cite.mjs:329 REFUSED message → owner Task 12 docs] On a hand-edited stamped file the message names check's own key (`REFUSED agent-written key id`) even though the agent edited `rationale`; correct per plan, but the docs should explain 'any key of check's present + stamp mismatch ⇒ refused' so an operator does not hunt for an `id` they never wrote. |
