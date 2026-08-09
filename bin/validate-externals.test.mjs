import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSkillMdUrl,
  checkExternalEntry,
  checkExternals,
  parseValidateArgs,
  summarizeExternalResults,
} from "./validate-bundles.mjs";
import { extractSkillMdName } from "./lib/skill-md.mjs";

// Fast retries in tests — the production default (300ms) would make this
// suite slow across the several warn/retry cases below.
const FAST = { retryDelayMs: 1 };

function fakeRes({ ok, status = 200, statusText = "OK", body = "" }) {
  return { ok, status, statusText, text: async () => body };
}

function skillMd(name) {
  return `---\nname: ${name}\ndescription: test\n---\n`;
}

// --- buildSkillMdUrl (pure) -------------------------------------------------

test("buildSkillMdUrl: subdir + explicit ref", () => {
  const url = buildSkillMdUrl({ repo: "owner/repo", ref: "main", subdir: "skills/foo" });
  assert.equal(url, "https://raw.githubusercontent.com/owner/repo/main/skills/foo/SKILL.md");
});

test("buildSkillMdUrl: subdir with a trailing slash is normalized (no double slash)", () => {
  const url = buildSkillMdUrl({ repo: "owner/repo", ref: "main", subdir: "skills/foo/" });
  assert.equal(url, "https://raw.githubusercontent.com/owner/repo/main/skills/foo/SKILL.md");
});

test("buildSkillMdUrl: missing ref defaults to main", () => {
  const url = buildSkillMdUrl({ repo: "owner/repo", subdir: "skills/foo" });
  assert.equal(url, "https://raw.githubusercontent.com/owner/repo/main/skills/foo/SKILL.md");
});

test("buildSkillMdUrl: no subdir fetches SKILL.md from the repo root", () => {
  const url = buildSkillMdUrl({ repo: "owner/repo", ref: "main" });
  assert.equal(url, "https://raw.githubusercontent.com/owner/repo/main/SKILL.md");
});

// --- checkExternalEntry: FAIL cases (registry defects) ---------------------

test("checkExternalEntry: 404 is a FAIL, not a WARN, and is not retried", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return fakeRes({ ok: false, status: 404, statusText: "Not Found" });
  };
  const r = await checkExternalEntry({ id: "foo", repo: "owner/repo" }, { fetchImpl, ...FAST });
  assert.equal(r.severity, "fail");
  assert.match(r.msg, /404/);
  assert.equal(calls, 1, "404 is a registry defect, not transient — must not be retried");
});

test("checkExternalEntry: name: mismatch between upstream and registry id is a FAIL", async () => {
  const fetchImpl = async () => fakeRes({ ok: true, body: skillMd("actual-upstream-name") });
  const r = await checkExternalEntry({ id: "registry-id", repo: "owner/repo" }, { fetchImpl, ...FAST });
  assert.equal(r.severity, "fail");
  assert.match(r.msg, /actual-upstream-name/);
  assert.match(r.msg, /registry-id/);
});

test("checkExternalEntry: absent name: frontmatter is a FAIL", async () => {
  const fetchImpl = async () => fakeRes({ ok: true, body: "---\ndescription: no name field here\n---\n" });
  const r = await checkExternalEntry({ id: "foo", repo: "owner/repo" }, { fetchImpl, ...FAST });
  assert.equal(r.severity, "fail");
  assert.match(r.msg, /no "name:" frontmatter/);
});

test("checkExternalEntry: matching name is a PASS", async () => {
  const fetchImpl = async () => fakeRes({ ok: true, body: skillMd("foo") });
  const r = await checkExternalEntry({ id: "foo", repo: "owner/repo" }, { fetchImpl, ...FAST });
  assert.equal(r.severity, "pass");
});

// --- checkExternalEntry: WARN cases (transient upstream/infra) -------------

test("checkExternalEntry: a 500 that persists through the retry is a WARN, not a FAIL", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return fakeRes({ ok: false, status: 503, statusText: "Service Unavailable" });
  };
  const r = await checkExternalEntry({ id: "foo", repo: "owner/repo" }, { fetchImpl, ...FAST });
  assert.equal(r.severity, "warn");
  assert.equal(calls, 2, "a 5xx must be retried exactly once before warning");
});

test("checkExternalEntry: 429 behaves the same as 5xx — retried once, then WARN", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return fakeRes({ ok: false, status: 429, statusText: "Too Many Requests" });
  };
  const r = await checkExternalEntry({ id: "foo", repo: "owner/repo" }, { fetchImpl, ...FAST });
  assert.equal(r.severity, "warn");
  assert.equal(calls, 2);
});

test("checkExternalEntry: a network transport error (fetch throws) is a WARN after one retry", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    throw new Error("ECONNRESET");
  };
  const r = await checkExternalEntry({ id: "foo", repo: "owner/repo" }, { fetchImpl, ...FAST });
  assert.equal(r.severity, "warn");
  assert.equal(calls, 2);
  assert.match(r.msg, /ECONNRESET/);
});

test("checkExternalEntry: recovers on retry — a transient 503 followed by a good 200 is a PASS, not a WARN", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    if (calls === 1) return fakeRes({ ok: false, status: 503, statusText: "Service Unavailable" });
    return fakeRes({ ok: true, body: skillMd("foo") });
  };
  const r = await checkExternalEntry({ id: "foo", repo: "owner/repo" }, { fetchImpl, ...FAST });
  assert.equal(r.severity, "pass");
  assert.equal(calls, 2);
});

test("checkExternalEntry: a body-read failure after a 200 is captured as a WARN, not thrown", async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => {
      throw new Error("stream reset mid-body");
    },
  });
  const r = await checkExternalEntry({ id: "foo", repo: "owner/repo" }, { fetchImpl, ...FAST });
  assert.equal(r.severity, "warn");
  assert.match(r.msg, /stream reset mid-body/);
});

test("checkExternalEntry: 403 is a WARN, not a FAIL (raw.githubusercontent.com returns 404, not 403, for private/nonexistent repos — a 403 here means abuse-detection/rate-limiting, the transient class)", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return fakeRes({ ok: false, status: 403, statusText: "Forbidden" });
  };
  const r = await checkExternalEntry({ id: "foo", repo: "owner/repo" }, { fetchImpl, ...FAST });
  assert.equal(r.severity, "warn");
  assert.equal(calls, 2, "403 is treated as transient — must be retried once, same as 429/5xx");
});

// --- summarizeExternalResults / checkExternals: aggregation + exit decision -
//
// This is the layer that was previously "correct only because a human
// probed it by hand" — the exit code and the honest-summary decision both
// live here. Assert on the exit decision (and the pass/warn/fail counts
// that drive it) directly, not on printed log text.

function severityResults(severities) {
  return severities.map((severity, i) => ({ severity, id: `entry-${i}`, msg: `entry-${i}: ${severity}` }));
}

test("summarizeExternalResults: all-PASS -> exitCode 0", () => {
  const s = summarizeExternalResults(severityResults(["pass", "pass", "pass"]));
  assert.deepEqual(s, { total: 3, passCount: 3, warnCount: 0, failCount: 0, verifiedNothing: false, exitCode: 0 });
});

// An all-WARN run verified nothing at all: not one entry was confirmed. Per
// entry a WARN is a tolerable transient and still never blocks (see the
// PASS+WARN case below), but a run with zero PASSes is the guard not having
// run — no egress, a global rate-limit, or a Node too old for global fetch.
// That must not exit 0 advertising a check that never happened.
test("summarizeExternalResults: WARN-only escalates -> verifiedNothing, exitCode 1 (the run confirmed nothing)", () => {
  const s = summarizeExternalResults(severityResults(["warn", "warn"]));
  assert.deepEqual(s, { total: 2, passCount: 0, warnCount: 2, failCount: 0, verifiedNothing: true, exitCode: 1 });
});

test("summarizeExternalResults: a single WARN alongside PASSes does NOT escalate (per-entry WARN stays non-blocking)", () => {
  const s = summarizeExternalResults(severityResults(["pass", "warn"]));
  assert.equal(s.verifiedNothing, false);
  assert.equal(s.exitCode, 0);
});

test("summarizeExternalResults: an empty result list is not an all-WARN escalation", () => {
  const s = summarizeExternalResults([]);
  assert.deepEqual(s, { total: 0, passCount: 0, warnCount: 0, failCount: 0, verifiedNothing: false, exitCode: 0 });
});

test("summarizeExternalResults: all-FAIL is not reported as verifiedNothing (it already blocks on failCount)", () => {
  const s = summarizeExternalResults(severityResults(["fail"]));
  assert.equal(s.verifiedNothing, false);
  assert.equal(s.exitCode, 1);
});

test("summarizeExternalResults: PASS+WARN -> exitCode 0", () => {
  const s = summarizeExternalResults(severityResults(["pass", "warn", "pass"]));
  assert.deepEqual(s, { total: 3, passCount: 2, warnCount: 1, failCount: 0, verifiedNothing: false, exitCode: 0 });
});

test("summarizeExternalResults: FAIL-only -> exitCode 1", () => {
  const s = summarizeExternalResults(severityResults(["fail", "fail"]));
  assert.deepEqual(s, { total: 2, passCount: 0, warnCount: 0, failCount: 2, verifiedNothing: false, exitCode: 1 });
});

test("summarizeExternalResults: FAIL+WARN -> exitCode 1 (a single FAIL blocks regardless of any WARNs)", () => {
  const s = summarizeExternalResults(severityResults(["fail", "warn", "pass"]));
  assert.deepEqual(s, { total: 3, passCount: 1, warnCount: 1, failCount: 1, verifiedNothing: false, exitCode: 1 });
});

test("checkExternals + summarizeExternalResults end-to-end: mixed entries produce the correct exit decision with no network", async () => {
  // entry a: matches -> pass. entry b: name mismatch -> fail. entry c: 503
  // that persists through the retry -> warn. checkExternals runs entries
  // sequentially, so a call-order counter is enough to key per-entry
  // responses without needing to parse the URL.
  const entries = [
    { id: "a", repo: "owner/repo" },
    { id: "b", repo: "owner/repo" },
    { id: "c", repo: "owner/repo" },
  ];
  let call = 0;
  const orderedFetchImpl = async () => {
    call++;
    if (call === 1) return fakeRes({ ok: true, body: skillMd("a") }); // entry a: pass
    if (call === 2) return fakeRes({ ok: true, body: skillMd("mismatched-name") }); // entry b: fail
    return fakeRes({ ok: false, status: 503, statusText: "Service Unavailable" }); // entry c: warn (both attempts)
  };
  const results = await checkExternals(entries, { fetchImpl: orderedFetchImpl, ...FAST });
  assert.deepEqual(
    results.map((r) => r.severity),
    ["pass", "fail", "warn"]
  );
  const s = summarizeExternalResults(results);
  assert.deepEqual(s, { total: 3, passCount: 1, warnCount: 1, failCount: 1, verifiedNothing: false, exitCode: 1 });
});

// --- checkExternals: per-entry error containment ---------------------------
//
// One entry throwing unexpectedly must not abandon the entries after it —
// that would silently shrink coverage while the summary still read clean.

test("checkExternals: an unexpected throw on one entry is contained as a FAIL and the remaining entries still run", async () => {
  const entries = [
    { id: "a", repo: "owner/repo", subdir: "a" },
    { id: "boom", repo: "owner/repo", subdir: "boom" },
    { id: "c", repo: "owner/repo", subdir: "c" },
  ];
  // A fetchImpl that resolves to null (a malformed impl, or a stub that
  // forgot to return) makes checkExternalEntry throw a TypeError at
  // `res.ok` — precisely the unforeseen class its own try/catch does NOT
  // cover, and the reason checkExternals wraps each call.
  const fetchImpl = async (url) => {
    if (url.includes("/boom/")) return null;
    return fakeRes({ ok: true, body: skillMd(url.includes("/a/") ? "a" : "c") });
  };
  const results = await checkExternals(entries, { fetchImpl, ...FAST });
  assert.equal(results.length, 3, "every entry must produce a result, even after one throws");
  assert.deepEqual(
    results.map((r) => r.severity),
    ["pass", "fail", "pass"],
    "the throw must not abandon the entries queued behind it"
  );
  assert.equal(results[1].id, "boom");
  assert.match(results[1].msg, /unexpected error/);
});

// --- parseValidateArgs: unknown-flag rejection -----------------------------
//
// A typo like `--check-external` used to fall through to bundle validation
// and exit 0 under a CI step named "Validate external skill registry
// entries", having fetched nothing.

test("parseValidateArgs: no args -> bundle validation", () => {
  assert.deepEqual(parseValidateArgs([]), { mode: "bundles", unknown: [] });
});

test("parseValidateArgs: --check-externals -> the externals check", () => {
  assert.deepEqual(parseValidateArgs(["--check-externals"]), { mode: "check-externals", unknown: [] });
});

test("parseValidateArgs: a mistyped flag is rejected, never silently downgraded to bundle validation", () => {
  const p = parseValidateArgs(["--check-external"]);
  assert.equal(p.mode, "error");
  assert.deepEqual(p.unknown, ["--check-external"]);
  assert.ok(p.knownFlags.includes("--check-externals"), "the error must name the flags that do exist");
});

test("parseValidateArgs: an unknown flag alongside a valid one is still rejected", () => {
  const p = parseValidateArgs(["--check-externals", "--yolo"]);
  assert.equal(p.mode, "error");
  assert.deepEqual(p.unknown, ["--yolo"]);
});

test("parseValidateArgs: a bare positional argument is rejected too", () => {
  const p = parseValidateArgs(["externals"]);
  assert.equal(p.mode, "error");
  assert.deepEqual(p.unknown, ["externals"]);
});

// --- extractSkillMdName: the contract both callers depend on ---------------
//
// init.mjs tests the result for truthiness; validate-bundles.mjs tests it for
// `=== null`. A "" return would make them disagree about the same document
// (installer falls back to the id, guard FAILs), so empty must be null.

test("extractSkillMdName: an empty name: value is null, not \"\" (both callers must agree)", () => {
  for (const body of ["---\nname:\ndescription: d\n---\n", '---\nname: ""\n---\n', "---\nname: '   '\n---\n", "---\nname:    \n---\n"]) {
    assert.equal(extractSkillMdName(body), null, `expected null for ${JSON.stringify(body)}`);
  }
});

test("extractSkillMdName: a normal frontmatter name is returned trimmed and unquoted", () => {
  assert.equal(extractSkillMdName('---\nname: "foo-skill"\ndescription: d\n---\n'), "foo-skill");
  assert.equal(extractSkillMdName("---\nname:   foo-skill  \n---\n"), "foo-skill");
});

test("extractSkillMdName: a name: outside the leading frontmatter block is ignored", () => {
  // No frontmatter at all — a `name:` in a fenced code block is documentation,
  // not this skill's name, and must not become the install directory.
  const body = "# Docs\n\n```yaml\nname: not-the-skill-name\n```\n";
  assert.equal(extractSkillMdName(body), null);
});

test("extractSkillMdName: frontmatter wins over a later body occurrence", () => {
  const body = "---\nname: real-name\n---\n\n```yaml\nname: decoy\n```\n";
  assert.equal(extractSkillMdName(body), "real-name");
});
