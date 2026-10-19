export const SEVERITIES = ['error', 'warning', 'ok', 'unknown', 'skipped'];
export function finding({ check, target = null, severity, message, fix = null, data = null }) {
  if (!SEVERITIES.includes(severity)) throw new Error(`unknown severity: ${severity}`);
  return Object.freeze({ check, target, severity, message, fix, data });
}
