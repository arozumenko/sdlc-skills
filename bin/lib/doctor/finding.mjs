// The installer command every hint prints. npm 12 refuses a package fetched from git unless
// --allow-git=all is passed (EALLOWGIT), so the hints carry the flag; npm 11 accepts it too.
export const INIT = 'npx --allow-git=all github:arozumenko/sdlc-skills init';
export const SEVERITIES = ['error', 'warning', 'ok', 'unknown', 'skipped'];
export function finding({ check, target = null, severity, message, fix = null, data = null }) {
  if (!SEVERITIES.includes(severity)) throw new Error(`unknown severity: ${severity}`);
  return Object.freeze({ check, target, severity, message, fix, data });
}
