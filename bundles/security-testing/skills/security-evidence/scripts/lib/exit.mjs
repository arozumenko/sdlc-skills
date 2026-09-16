// lib/exit.mjs — the one exit-code map and the one error class a command
// throws to end with a result token (TASK-006, plan §3.1 / §3.3).
//
//   0 ok · 1 internal (uncaught) · 2 usage / unknown command / bad argv /
//   EDIT-AND-RERUN class · 3 INDETERMINATE-class refusal · 4 verification
//   failure · 5 integrity mismatch
//
// A CliError is a *result*: the dispatcher prints its token on stdout (the
// result channel, G-13) and exits with its code. Anything else that escapes
// run() is an internal error (1) — except an integrity failure from
// readArtifact, which is 5:
//
//   check/exit-5 rule: both CanonError (malformed or non-canonical bytes —
//   duplicate key, float, invalid UTF-8) and IntegrityError (shape, kind or
//   self_sha256 mismatch) thrown by canon.readArtifact are integrity
//   failures. A file that cannot be read as the artifact it claims to be is
//   inconsistent, whichever layer noticed first. `isIntegrityFailure` is the
//   single home of that classification; `check`, `sign-off`, `run snapshot`
//   and the dispatcher's catch all call it rather than re-deriving it.

import { CanonError, IntegrityError } from "../canon.mjs";

export const EXIT = Object.freeze({ OK: 0, INTERNAL: 1, USAGE: 2, INDETERMINATE: 3, FAIL: 4, INTEGRITY: 5 });

/** A command result: `code` (2..5) and a one-line `token` printed on stdout. */
export class CliError extends Error {
  /**
   * @param {2|3|4|5} code
   * @param {string} token one line, exactly as the spec spells it
   * @param {{cause?: unknown}} [options]
   */
  constructor(code, token, options = {}) {
    if (!Number.isInteger(code) || code < EXIT.USAGE || code > EXIT.INTEGRITY) {
      throw new TypeError(`CliError: code must be an integer 2..5 (0 is success, 1 is reserved for uncaught errors), got ${String(code)}`);
    }
    if (typeof token !== "string" || token.length === 0 || token.includes("\n")) {
      throw new TypeError("CliError: token must be a non-empty single line");
    }
    super(token, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "CliError";
    this.code = code;
    this.token = token;
  }
}

/**
 * True for the two error classes canon.readArtifact throws when a file is not
 * the artifact it claims to be. Matched by class and by name, so an error
 * that crossed a module boundary (another copy of canon.mjs) still classifies.
 * @param {unknown} err
 * @returns {boolean}
 */
export function isIntegrityFailure(err) {
  if (err instanceof CanonError || err instanceof IntegrityError) return true;
  if (err === null || typeof err !== "object") return false;
  return err.name === "CanonError" || err.name === "IntegrityError";
}

/**
 * The process exit code for an error that escaped run().
 * @param {unknown} err
 * @returns {number}
 */
export function exitCodeFor(err) {
  if (err instanceof CliError) return err.code;
  if (isIntegrityFailure(err)) return EXIT.INTEGRITY;
  return EXIT.INTERNAL;
}

/**
 * `USAGE(<command>: <message>)`, exit 2 — bad or missing argv for a known command.
 * @param {string} command
 * @param {string} message
 * @returns {CliError}
 */
export function usageError(command, message) {
  return new CliError(EXIT.USAGE, `USAGE(${command}: ${message})`);
}

/**
 * An exit-5 result carrying the underlying integrity error as `cause`.
 * @param {string} token e.g. `INCONSISTENT(gate-result)`, `CORRUPT`
 * @param {unknown} [cause]
 * @returns {CliError}
 */
export function integrityFailure(token, cause) {
  return new CliError(EXIT.INTEGRITY, token, { cause });
}
