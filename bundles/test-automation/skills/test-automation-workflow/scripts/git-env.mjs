// git-env.mjs — the few facts about a checkout that a script may read for
// itself, rather than hardcode or ask an agent for.
//
// THE RULE THIS FILE EXISTS TO ENFORCE. Three kinds of thing show up in these
// scripts, and only one of them belongs in code:
//
//   FACTS      git answers deterministically in one command — the remote's
//              name, whether a ref exists, whether the tree is dirty. A script
//              that already shells out to git should just ASK. Hardcoding one
//              is not a decision, it is a bug: `origin` was assumed here for
//              months, so a fork checkout (`upstream`) or any renamed remote
//              broke fetch, gate and cleanup alike.
//   CONVENTIONS a human decided and recorded in `.agents/*` — branch naming,
//              case-id shape, the base ref, which PR host. A script cannot
//              derive these and must not guess: they come IN as arguments.
//   JUDGEMENT  reading the situation — is this conflict mechanical, is the work
//              on this branch coherent, is this red a product defect. Always an
//              agent, never here.
//
// So: read facts, take conventions as parameters, refuse everything else.
import { execFileSync } from 'node:child_process';

/**
 * The remote to push to and resolve `<remote>/<ref>` against.
 *
 * Explicit `--remote` wins. Otherwise ask git: exactly one remote is
 * unambiguous, and among several `origin` is the conventional default. A repo
 * with no remote at all returns null — callers treat that as "local only",
 * which is a legitimate state (a gate can still prove what is on disk).
 */
export function resolveRemote(repo, override = null) {
  if (override) return override;
  let names = [];
  try {
    names = execFileSync('git', ['remote'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').map((s) => s.trim()).filter(Boolean);
  } catch { return null; }
  if (names.length === 0) return null;
  if (names.length === 1) return names[0];
  return names.includes('origin') ? 'origin' : names[0];
}
