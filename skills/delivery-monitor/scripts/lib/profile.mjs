// STDLIB ONLY. Learning-loop policies (spec: docs/superpowers/specs/2026-11-13-learning-loops-design.md, loop contract and
// implementation contract). Every policy defaults to the behaviour that shipped before it existed: an install that sets
// nothing behaves exactly as before.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { profilePath, resolveOwnerRepo } from './paths.mjs';

/** The shared publish policy for the whole `.agents/telemetry` tree (every skill that commits or pushes it reads this file). */
export const publishPolicyPath = (repo) => join(resolveOwnerRepo(repo), '.agents', 'telemetry', 'policy.json');

/** { publish: 'legacy' | 'private-remote' | 'local-only', problem }. No file (or no `publish` key) is legacy: push as before,
 * not a privacy claim. A file that cannot be read or parsed, or an unknown value, fails closed to local-only. */
export function readPublishPolicy(repo) {
  let raw;
  try { raw = JSON.parse(readFileSync(publishPolicyPath(repo), 'utf8')); }
  catch (e) { return e.code === 'ENOENT' ? { publish: 'legacy', problem: null } : { publish: 'local-only', problem: `policy.json unreadable (${e.code ?? 'invalid JSON'})` }; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { publish: 'local-only', problem: 'policy.json is not an object' };
  if (!('publish' in raw)) return { publish: 'legacy', problem: null };
  if (raw.publish === 'private-remote' || raw.publish === 'local-only') return { publish: raw.publish, problem: null };
  return { publish: 'local-only', problem: 'policy.json publish must be "private-remote" or "local-only"' };
}
export const mayPush = (repo, env = process.env) => env.DELIVERY_NO_SYNC !== '1' && readPublishPolicy(repo).publish !== 'local-only';

/** delivery-monitor's own policies in profile.json. */
export const POLICY_DEFAULTS = Object.freeze({
  storeText: true, // false: a veto over every free-text source (dispatch descriptions, commit subjects, PR titles, notes, raw)
  calibration: 'on', // 'off': calibrate computes and writes nothing; plan register fills nothing new
  calibrationSample: 'raw', // 'effective': cells need Kish n_eff ≥ min_n and a fresh newest landing
});
export const POLICY_KEYS = Object.keys(POLICY_DEFAULTS);

export function validatePolicies(obj) {
  const errs = [];
  if ('storeText' in obj && typeof obj.storeText !== 'boolean') errs.push('profile.storeText must be boolean');
  if ('calibration' in obj && !['on', 'off'].includes(obj.calibration)) errs.push('profile.calibration must be "on" or "off"');
  if ('calibrationSample' in obj && !['raw', 'effective'].includes(obj.calibrationSample)) errs.push('profile.calibrationSample must be "raw" or "effective"');
  return errs;
}

/** The profile's policies, defaults for anything unset. An unreadable profile or an invalid value: defaults, except storeText,
 * which fails closed (no text) — a broken file must never widen what is recorded. `problems` names what was ignored. */
export function readPolicies(repo) {
  let raw; const problems = [];
  try { raw = JSON.parse(readFileSync(profilePath(repo), 'utf8')); }
  catch (e) {
    if (e.code === 'ENOENT') return { ...POLICY_DEFAULTS, problems };
    return { ...POLICY_DEFAULTS, storeText: false, problems: [`profile.json unreadable (${e.code ?? 'invalid JSON'})`] };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...POLICY_DEFAULTS, storeText: false, problems: ['profile.json is not an object'] };
  const out = { ...POLICY_DEFAULTS };
  for (const k of POLICY_KEYS) {
    if (!(k in raw)) continue;
    const errs = validatePolicies({ [k]: raw[k] });
    if (errs.length) { problems.push(errs[0]); if (k === 'storeText') out.storeText = false; continue; }
    out[k] = raw[k];
  }
  return { ...out, problems };
}
