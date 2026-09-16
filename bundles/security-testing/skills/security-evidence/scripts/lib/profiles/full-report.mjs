// lib/profiles/full-report.mjs — the `full-report` publication profile
// (TASK-031; spec §6.9 "full-report (explicit)"; plan §5 TASK-031 "report +
// findings JSON (explicit only)"; US-023 AC-1).
//
// Output: `report.md` = the run's rendered report byte for byte, and
// `findings.json` = the canonical bytes of the claimed set's payload
// (`findings.claimed.json` minus its envelope) + LF — every gated finding with
// its evidence as gate stored it (`snippet`, or `snippet_redacted` /
// `context_redacted` for a sensitive one: the redacted form is what is on
// disk, so full disclosure never discloses protected bytes, G-4). A run
// without a claimed set (a verify-kind run) publishes `{"findings": []}`.
//
// "Explicit only": there is no default profile — cmd-publish refuses a
// missing `--profile` — so this one is chosen by name every time.
//
// Pure (G-9): imports ../../canon.mjs (canonical). No fs, no git, no clock.

import { canonical } from "../../canon.mjs";

export const PROFILE = "full-report";
export const PROFILE_VERSION = 1;
/** The output set (relpaths under `--to`), in write order. */
export const OUTPUTS = Object.freeze(["report.md", "findings.json"]);

/**
 * @param {import("./_source.mjs").Source} source
 * @param {object | null} _register unused
 * @param {object} _opts unused
 * @returns {{relpath: string, bytes: Buffer}[]}
 */
export function apply(source, _register, _opts) {
  const payload = source.claimed === null ? { findings: [] } : source.claimed.payload;
  return [
    { relpath: OUTPUTS[0], bytes: Buffer.from(source.report) },
    { relpath: OUTPUTS[1], bytes: Buffer.concat([canonical(payload), Buffer.from("\n")]) },
  ];
}
