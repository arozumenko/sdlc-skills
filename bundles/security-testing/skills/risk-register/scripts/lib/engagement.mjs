// lib/engagement.mjs — reads `<root>/.agents/security-testing/engagement.md`,
// the one file every script starts from. The file is prose plus one fenced
// block whose info string is `json engagement`; the first such block is the
// record. Validation is in code, one token per failure:
//   ENGAGEMENT-MISSING            no engagement.md under stDir(root)
//   EDIT-ENGAGEMENT-AND-RERUN     the block still carries the template's
//                                 engagement_id — `cite.mjs init` seeded it
//   ENGAGEMENT-INVALID(<why>)     block / json / <field> that failed
// Leaf module: stdlib only, no clock, no git. Byte-identical across the
// script skills; `bin/check-skill-dupes.mjs` pins the copies.

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The `engagement_id` the template ships with; a block still carrying it is unedited. */
export const TEMPLATE_ENGAGEMENT_ID = "my-product-2026-09";

const BLOCK = /```json engagement[ \t]*\r?\n([\s\S]*?)\r?\n```/;
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

/** The engagement file is missing, unedited or invalid; `.token` is the result line. */
export class EngagementError extends Error {
  /**
   * @param {string} token `ENGAGEMENT-MISSING` | `EDIT-ENGAGEMENT-AND-RERUN` | `ENGAGEMENT-INVALID(<why>)`
   * @param {string} [detail]
   */
  constructor(token, detail) {
    super(detail ? `${token}: ${detail}` : token);
    this.name = "EngagementError";
    this.token = token;
    if (detail !== undefined) this.detail = detail;
  }
}

/**
 * `<root>/.agents/security-testing` — where every script keeps its state.
 * @param {string} root
 * @returns {string}
 */
export function stDir(root) {
  return join(root, ".agents", "security-testing");
}

const invalid = (why, detail) => new EngagementError(`ENGAGEMENT-INVALID(${why})`, detail);

function isRelativePosixPath(p) {
  if (typeof p !== "string" || p.length === 0) return false;
  if (p.startsWith("/") || p.includes("\\") || p.includes("\0")) return false;
  return !p.split("/").includes("..");
}

function isStringArray(a, { nonEmpty = false } = {}) {
  return Array.isArray(a) && (!nonEmpty || a.length > 0) && a.every((s) => typeof s === "string" && s.length > 0);
}

function validate(record) {
  if (typeof record.engagement_id !== "string" || record.engagement_id.length === 0) throw invalid("engagement_id", "must be a non-empty string");
  if (typeof record.slug !== "string" || !SLUG.test(record.slug)) throw invalid("slug", "must match /^[a-z0-9][a-z0-9-]*$/");
  if (!Array.isArray(record.scope_paths) || record.scope_paths.length === 0 || !record.scope_paths.every(isRelativePosixPath)) {
    throw invalid("scope_paths", "must be a non-empty array of relative posix paths without ..");
  }
  if (record.product_paths !== undefined && !(Array.isArray(record.product_paths) && record.product_paths.every(isRelativePosixPath))) {
    throw invalid("product_paths", "must be an array of relative posix paths without ..");
  }
  if (record.targets !== undefined) {
    if (record.targets === null || typeof record.targets !== "object" || Array.isArray(record.targets)) throw invalid("targets", "must be an object");
    if (record.targets.browser !== undefined && !(isStringArray(record.targets.browser) && record.targets.browser.every((h) => /^[A-Za-z0-9.-]+(:\d+)?$/.test(h)))) {
      throw invalid("targets.browser", "must be an array of hostnames");
    }
  }
  if (record.base_url !== undefined && typeof record.base_url !== "string") throw invalid("base_url", "must be a string");
  if (record.execute_project_tests !== undefined) {
    const ept = record.execute_project_tests;
    if (ept === null || typeof ept !== "object" || Array.isArray(ept)) throw invalid("execute_project_tests", "must be an object");
    if (ept.argv !== undefined && !isStringArray(ept.argv, { nonEmpty: true })) throw invalid("execute_project_tests.argv", "must be a non-empty array of strings");
  }
  if (record.engagement_id === TEMPLATE_ENGAGEMENT_ID) throw new EngagementError("EDIT-ENGAGEMENT-AND-RERUN", "engagement.md still carries the template engagement_id");
}

/**
 * Read and validate the engagement record.
 * @param {string} root the work tree root
 * @returns {{record: object, path: string}}
 * @throws {EngagementError}
 */
export function readEngagement(root) {
  const path = join(stDir(root), "engagement.md");
  let markdown;
  try {
    markdown = readFileSync(path, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") throw new EngagementError("ENGAGEMENT-MISSING", `no ${path}`);
    throw err;
  }
  const m = BLOCK.exec(markdown);
  if (!m) throw invalid("block", "no fenced `json engagement` block");
  let record;
  try {
    record = JSON.parse(m[1]);
  } catch (err) {
    throw invalid("json", err.message);
  }
  if (record === null || typeof record !== "object" || Array.isArray(record)) throw invalid("json", "block must be a JSON object");
  validate(record);
  return { record, path };
}
