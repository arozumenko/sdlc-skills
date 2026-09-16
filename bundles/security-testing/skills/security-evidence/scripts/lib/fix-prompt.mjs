// lib/fix-prompt.mjs — the `fix_prompt` of a tracker ticket payload
// (TASK-045; spec §6.9 "tracker (title, class, priority, path, lines,
// context_redacted, fix_prompt)", §9.4 / P4 "proposals, feature-development,
// tracker"; plan §5 TASK-045; US-039 AC-4). Replaces TASK-031's
// `tracker.fixPromptStub` — that one function, nothing else in the payload.
//
// The prompt is what the developer follows after the lead posts the ticket
// through `issue-tracking`. It routes them to the feature-development
// `bugfix-workflow` skill and pins the three things the verify step will
// hold them to:
//
//   the finding    id, class, priority, `path:start-end` — the cited range
//                  the fix must land in (verify.mjs all resolves the range
//                  at --base and diffs base..head for that path);
//   the context    `context_redacted` verbatim — the recorded redacted
//                  context of a secret-class finding and/or the description
//                  (tracker.mjs `contextOf`), the one description the
//                  developer gets. Never a snippet: the payload never
//                  carried one (a redacted snippet is still a snippet), so
//                  the prompt cannot either;
//   the report     the exact command the developer reports back with:
//                  `verify.mjs all --finding <id> --base <oid> --head
//                  <fix-commit>` — `--base` is the run's head_oid (where
//                  the finding was observed), `--head` the fix commit they
//                  name, unknown here and left as the placeholder.
//
// Rules stated in the prompt mirror what `verify.mjs all` enforces (§6.4):
// never edit tests, ignore files or suppression config to make it pass —
// the suppression scanner reads the base..head diff for those indicators
// and a hit is a refused verdict, not a fixed finding; and never close the
// ticket — the developer's workflow closes it after the verdict reads
// VERIFIED and the lead has consumed it (tracker-rules.md "Never").
//
// Deterministic and pure: the same inputs give the same text, so the
// payload's identity (canonical bytes) is stable and `check-export` can
// re-derive it (VERIFIED-DERIVATIVE). Every input is validated because a
// prompt with a hole in it (`undefined` where the id goes) would still be
// a valid string. Lines are joined with LF; the payload is canonical JSON,
// so the newlines are escaped on disk and the tracker body shows them.
//
// G-4: the inputs arrive redacted (the gate's finding fields, the redacted
// context) and the prompt adds only its own fixed prose; tracker.payloadFor
// runs redactDeep over the whole payload afterwards, and cmd-publish
// asserts a second pass is a no-op before a byte is written.
//
// Leaf: no fs, no child process, no git, no network, no clock (G-9, G-14).

/** The skill the prompt routes the developer to (feature-development bundle). */
export const FIX_SKILL = "bugfix-workflow";
/** `<fix-commit>` — the head the developer supplies; the prompt never guesses it. */
export const FIX_COMMIT_PLACEHOLDER = "<fix-commit>";

const SHA256 = /^[0-9a-f]{64}$/;
const OID = /^[0-9a-f]{40}$/;
const PRIORITY = /^p[0-3]$/;

function requireFindingId(value) {
  if (typeof value !== "string" || !SHA256.test(value)) throw new TypeError("fix-prompt: finding_id must be a finding id (64 lowercase hex chars)");
  return value;
}

function requireBaseOid(value) {
  if (typeof value !== "string" || !OID.test(value)) throw new TypeError("fix-prompt: base_oid must be a commit oid (40 lowercase hex chars)");
  return value;
}

function requireText(value, name) {
  if (typeof value !== "string" || value.length === 0 || /[\r\n]/.test(value)) throw new TypeError(`fix-prompt: ${name} must be a non-empty one-line string`);
  return value;
}

function requireLines(value) {
  if (!Array.isArray(value) || value.length !== 2 || !value.every((n) => Number.isInteger(n) && n >= 1) || value[0] > value[1]) {
    throw new TypeError("fix-prompt: lines must be [start, end] with 1 <= start <= end");
  }
  return value;
}

/**
 * The exact command the developer reports back with (US-039 AC-4).
 * @param {{finding_id: string, base_oid: string}} input
 * @returns {string} `verify.mjs all --finding <id> --base <oid> --head <fix-commit>`
 */
export function verifyCommand({ finding_id, base_oid } = {}) {
  return `verify.mjs all --finding ${requireFindingId(finding_id)} --base ${requireBaseOid(base_oid)} --head ${FIX_COMMIT_PLACEHOLDER}`;
}

/**
 * The fix route for one gated finding (see the header).
 * @param {{finding_id: string, class: string, priority: string, path: string, lines: [number, number], context_redacted: string, base_oid: string}} input
 * @returns {string} LF-joined paragraphs, no leading or trailing newline
 * @throws {TypeError} on any malformed input
 */
export function fixPrompt(input) {
  if (input === null || typeof input !== "object") throw new TypeError("fix-prompt: input must be an object");
  const finding_id = requireFindingId(input.finding_id);
  const cls = requireText(input.class, "class");
  const priority = requireText(input.priority, "priority");
  if (!PRIORITY.test(priority)) throw new TypeError("fix-prompt: priority must be p0|p1|p2|p3");
  const path = requireText(input.path, "path");
  const [start, end] = requireLines(input.lines);
  if (typeof input.context_redacted !== "string" || input.context_redacted.length === 0) throw new TypeError("fix-prompt: context_redacted must be a non-empty string");
  const command = verifyCommand({ finding_id: input.finding_id, base_oid: input.base_oid });
  const range = `${path}:${start}-${end}`;
  return [
    `Security finding ${finding_id} (${cls}, ${priority}) at ${range}.`,
    `Load the ${FIX_SKILL} skill and follow it for this finding: reproduce it at the cited range, fix the cause, and add the regression test the workflow asks for.`,
    "Context (redacted; the only description you get):",
    input.context_redacted,
    `Rules: the fix lands in ${path} at the cited range. Never edit tests, ignore files or suppression config to make it pass; verification scans the base..head diff for suppression indicators and refuses them. Do not close the ticket; the developer workflow closes it once the verdict reads VERIFIED.`,
    `When your fix is committed, report back with this exact command, replacing ${FIX_COMMIT_PLACEHOLDER} with the oid of your fix commit (--base is the commit where the finding was observed):`,
    command,
  ].join("\n");
}
