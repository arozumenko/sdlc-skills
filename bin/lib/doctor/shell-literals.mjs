import { createHash } from 'node:crypto';

export const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const NAME = '[A-Za-z_][A-Za-z0-9_]*';
const ASSIGN = new RegExp(`^(?:export\\s+)?(${NAME})=(?:"([^"$\`\\\\]*)"|'([^']*)'|([^\\s"'$\`;&|<>()]*))\\s*$`);
const DEFAULT = new RegExp(`^:\\s+"\\$\\{(${NAME}):=((?:\\$\\{${NAME}:-[^}$\`]*\\}|[^}$\`])*)\\}"\\s*$`);

export function parseShellLiterals(text) {
  const vars = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    let m = ASSIGN.exec(line);
    if (m) { vars[m[1]] = m[2] ?? m[3] ?? m[4] ?? ''; continue; }
    m = DEFAULT.exec(line);
    if (m) { if (!(m[1] in vars)) vars[m[1]] = m[2]; continue; }
    return { known: false, vars: {} };
  }
  return { known: true, vars };
}

export function literalDefaultCap(libSh) {
  const body = /default_ctx_cap\(\)\s*\{([\s\S]*?)\n\}/.exec(String(libSh));
  if (!body) {
    // Older lib.sh: one host-independent default, `local cap="${SDLC_CTX_CAP:-N}"`.
    const old = /\$\{SDLC_CTX_CAP:-(\d+)\}/.exec(String(libSh));
    return old ? { claude: Number(old[1]), copilot: Number(old[1]) } : { claude: null, copilot: null };
  }
  const m = /then\s+printf\s+'(\d+)';\s*else\s+printf\s+'(\d+)'/.exec(body[1]);
  return m ? { copilot: Number(m[1]), claude: Number(m[2]) } : { claude: null, copilot: null };
}
