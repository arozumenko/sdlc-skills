// lib/profiles/handoff.mjs — the `handoff` publication profile (TASK-043;
// spec §9.2 "Hand-off prompt (profile `handoff`)", §6.9 "handoff (case paths
// + base_url only)", D7; plan §5 TASK-043 "exact two-line prompt of §9.2 to
// <st>/handoffs/<slug>.md and stdout"; US-035 AC-3; US-038 AC-3).
//
//   apply(source, _register, opts) → [{relpath: "<slug>.md", bytes}]
//     the §9.2 prompt, exactly two lines plus a final LF:
//       Run as the active agent (claude --agent test-run-lead):
//       "Run the suite at tasks/security-<slug>-admitted/ against base_url=<url>."
//     `slug` = opts.slug else the engagement's `slug`; `base_url` =
//     opts.base_url (`--base-url`) else the engagement's `base_url`. Nothing
//     else enters the prompt: no case path, no proposal, no run directory
//     (the manual-qa lead globs the suite directory it is given — the suite
//     is what `publish --profile case` wrote). The prompt is pure over
//     (slug, base_url), so check-export re-derives it from the manifest's
//     recorded opts (export-manifest.schema.json `opts`, the TASK-043 G-15
//     extension) without reading the run's engagement again.
//   Refusals (TypeError — argv-shaped, cmd-publish spells them 2 USAGE): no
//   base_url anywhere; a base_url that is not an absolute http(s) URL, or
//   carries whitespace, a newline or a double quote (it sits inside the
//   quoted line); a slug outside [a-z0-9-].
//
// Pure (G-9): imports ./case.mjs (suiteDir). No fs, no git, no clock.

import { suiteDir } from "./case.mjs";

export const PROFILE = "handoff";
export const PROFILE_VERSION = 1;

const ABSOLUTE_HTTP = /^https?:\/\/[^\s"'<>]+$/;

/** `<slug>.md` under `<st>/handoffs/`. */
export function promptFile(slug) {
  suiteDir(slug);
  return `${slug}.md`;
}

/**
 * The §9.2 prompt lines.
 * @param {string} slug
 * @param {string} base_url
 * @returns {[string, string]}
 */
export function promptLines(slug, base_url) {
  const dir = suiteDir(slug);
  if (typeof base_url === "string" && base_url.includes('"')) throw new TypeError("handoff: base_url must not carry a double quote (it sits inside the quoted prompt line)");
  if (typeof base_url !== "string" || !ABSOLUTE_HTTP.test(base_url)) throw new TypeError("handoff: base_url must be an absolute http(s) URL without whitespace (pass --base-url or set engagement.md base_url)");
  return ["Run as the active agent (claude --agent test-run-lead):", `"Run the suite at ${dir}/ against base_url=${base_url}."`];
}

/**
 * The hand-off prompt file (see the header).
 * @param {{engagement?: {payload: {slug?: string, base_url?: string}} | null}} source
 * @param {object | null} _register unused
 * @param {{slug?: string, base_url?: string}} opts
 * @returns {{relpath: string, bytes: Buffer}[]}
 */
export function apply(source, _register, opts = {}) {
  const slug = opts?.slug ?? source?.engagement?.payload?.slug;
  const base_url = opts?.base_url ?? source?.engagement?.payload?.base_url;
  if (base_url === undefined || base_url === null) throw new TypeError("handoff: no base_url — pass --base-url or set engagement.md base_url");
  const lines = promptLines(slug, base_url);
  return [{ relpath: promptFile(slug), bytes: Buffer.from(`${lines.join("\n")}\n`, "utf8") }];
}
