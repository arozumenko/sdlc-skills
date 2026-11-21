// scripts/lib/roster.mjs — STDLIB ONLY; all factory data travels with this skill.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { cliError, resolveOwnerRepo, sha256 } from './paths.mjs';
const bytes = readFileSync(new URL('../../references/factory-roles.json', import.meta.url));
const map = JSON.parse(bytes.toString('utf8'));
const digest = sha256(bytes);
const sorted = (xs) => [...new Set(xs)].sort();
/** Factories the repository ships for which this skill has no role map. Their roles are not added to
 * references/factory-roles.json: any change to that file changes `map_sha256` and makes every saved roster invalid in a
 * project that updates. A plan from one of them registers; its roster holds none of that factory's roles, so the hooks
 * record and check no dispatch of its agents. */
export const UNMAPPED_FACTORIES = ['product-management', 'security-testing'];
export const FACTORIES = [...Object.keys(map.factories), ...UNMAPPED_FACTORIES];
const rolesOf = (f) => (Object.hasOwn(map.factories, f) ? map.factories[f] : []);
/** The participating factories of a roster snapshot that have no role map. */
export const unmappedFactories = (roster) => (Array.isArray(roster?.factories) ? roster.factories.filter((f) => UNMAPPED_FACTORIES.includes(f)) : []);
export function installedAgents(repo) {
  const roles = [];
  for (const root of new Set([repo, resolveOwnerRepo(repo)])) for (const host of ['.claude', '.cursor', '.windsurf', '.github', '.codex']) {
    const dir = join(root, host, 'agents');
    if (!existsSync(dir)) continue;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory() && existsSync(join(dir, e.name, 'AGENT.md'))) roles.push(e.name);
      else if (e.isFile() && /(?:(?:\.agent)?\.md|\.toml)$/.test(e.name)) roles.push(e.name.replace(/(?:(?:\.agent)?\.md|\.toml)$/, ''));
    }
  }
  return sorted(roles);
}
export function makeRoster(repo, factories, requested = null) {
  if (!Array.isArray(factories) || !factories.length || factories.some((f) => !FACTORIES.includes(f))) throw cliError('USAGE', 'unknown participating factory');
  const fs = sorted(factories), allowed = new Set(fs.flatMap(rolesOf));
  const agents = installedAgents(repo).filter((a) => allowed.has(a));
  if (requested && JSON.stringify(sorted(requested)) !== JSON.stringify(agents)) throw cliError('USAGE', 'roster must equal installed participating-factory union');
  return { v: 1, factories: fs, agents, map_sha256: digest };
}
export function validRoster(s) {
  if (!s || s.v !== 1 || s.map_sha256 !== digest || !Array.isArray(s.factories) || !s.factories.length || !Array.isArray(s.agents)) return false;
  if (s.factories.some((f) => typeof f !== 'string' || !FACTORIES.includes(f)) || s.agents.some((a) => typeof a !== 'string')) return false;
  const allowed = new Set(s.factories.flatMap(rolesOf));
  return JSON.stringify(s.factories) === JSON.stringify(sorted(s.factories)) && JSON.stringify(s.agents) === JSON.stringify(sorted(s.agents)) && s.agents.every((a) => allowed.has(a));
}
