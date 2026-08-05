import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSkillMdUrl, checkExternalEntry } from "./validate-bundles.mjs";

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
