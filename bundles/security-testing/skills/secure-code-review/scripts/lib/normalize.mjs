// normalize.mjs — text normalisation shared by `cite` and `verify`.
//
// Finding identity hashes the *normalised* snippet, so these rules are part of
// the identity contract. The vectors in ../fixtures/lib/normalize-vectors.json
// are the reference; normalize.test.mjs replays every one of them. Change a
// rule ⇒ republish the vectors.
//
// Rules, applied in this order:
//   1. strict UTF-8 decode (`TextDecoder("utf-8", {fatal: true})`);
//      any invalid sequence ⇒ `EncodingError` — never a lossy fallback
//   2. strip one leading BOM (U+FEFF); U+FEFF anywhere else is content
//   3. `\r\n` | `\r` → `\n` (U+2028, U+2029, U+0085 are NOT newlines)
//   4. NFC
//   5. per line: collapse each `[\p{Zs}\t]+` run to one space, then trim
//      that same class at both ends — never `String.prototype.trim()`, which
//      would also eat U+FEFF, U+2028, `\v` and `\f`
//   6. drop empty lines — the ONLY line removal; line order is preserved
//
// Leaf module: stdlib only, no I/O, no clock, no other scripts/ import.

/** Thrown when the input bytes are not valid UTF-8. */
export class EncodingError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "EncodingError";
  }
}

const HORIZONTAL_RUN = /[\p{Zs}\t]+/gu;
const HORIZONTAL_EDGES = /^[\p{Zs}\t]+|[\p{Zs}\t]+$/gu;
const NEWLINES = /\r\n|\r/g;
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function decode(input) {
  if (typeof input === "string") return input;
  if (input instanceof Uint8Array) {
    try {
      return decoder.decode(input);
    } catch (err) {
      throw new EncodingError("input is not valid UTF-8", { cause: err });
    }
  }
  if (input instanceof ArrayBuffer) return decode(new Uint8Array(input));
  throw new TypeError("normalizeText: expected Buffer, Uint8Array, ArrayBuffer or string");
}

/**
 * Normalise text bytes (or an already-decoded string) to the canonical line
 * form used for citations and finding identity.
 *
 * @param {Buffer|Uint8Array|ArrayBuffer|string} input
 * @returns {{lines: string[], text: string}} `text` is `lines.join("\n")`.
 * @throws {EncodingError} when `input` is not valid UTF-8
 * @throws {TypeError} for any other input type
 */
export function normalizeText(input) {
  let text = decode(input);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  text = text.replace(NEWLINES, "\n").normalize("NFC");
  const lines = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(HORIZONTAL_RUN, " ").replace(HORIZONTAL_EDGES, "");
    if (line !== "") lines.push(line);
  }
  return { lines, text: lines.join("\n") };
}
