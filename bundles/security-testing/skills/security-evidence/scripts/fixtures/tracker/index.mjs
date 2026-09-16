// fixtures/tracker — TASK-017 (`ingest ticket | pr | tracker-readback`).
//
// Every JSON file mirrors what a tracker (GitHub-shaped) returns; the text
// inside `title` / `body` is deliberately hostile — an instruction, a
// citation, a shell command and a `password=1234` — so the tests can show it
// is quoted, redacted and never acted on.
//
//   ticket.json               `ingest ticket`: allowed host (github.com), labels as strings
//   ticket.foreign-host.json  `ingest ticket`: host outside targets.tracker ⇒ rejected host-not-allowed
//   pr.json                   `ingest pr`: changed_files mixing in-scope, out-of-scope, duplicate and escaping paths
//   sent.ticket.json          `--sent`: the publish --profile tracker payload (TASK-031's nine keys)
//   readback.json             `ingest tracker-readback`: title matches, body names the finding
//   readback.mismatch.json    `ingest tracker-readback`: title changed, body without the id ⇒ MISMATCH(title), MISMATCH(body)
//
// FINDING_ID is the finding every file names (a sha256-shaped id like gate assigns).
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const FINDING_ID = "3f9abbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb1234";
export const HEAD_OID = "0123456789abcdef0123456789abcdef01234567";
export const TRACKER_FIXTURES = dirname(fileURLToPath(import.meta.url));
export const fixture = (name) => join(TRACKER_FIXTURES, name);
