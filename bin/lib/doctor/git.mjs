// Hardened Git for `doctor`: read-only plumbing only, never project code.
// - core.fsmonitor=false: a configured fsmonitor command is project code.
// - GIT_OPTIONAL_LOCKS=0 + core.untrackedCache=false: no opportunistic index writes.
// - GIT_NO_LAZY_FETCH=1 (Git >= 2.45): reading a missing promisor object must not
//   hit the network. Below 2.45 the variable is ignored, so object reads are skipped.
// - Routing variables from the caller (GIT_DIR, GIT_WORK_TREE, …) are dropped.
import { execFileSync } from 'node:child_process';

const DROP = /^(GIT_DIR|GIT_WORK_TREE|GIT_INDEX_FILE|GIT_OBJECT_DIRECTORY|GIT_ALTERNATE_OBJECT_DIRECTORIES|GIT_COMMON_DIR|GIT_NAMESPACE|GIT_CEILING_DIRECTORIES|GIT_DISCOVERY_ACROSS_FILESYSTEM|GIT_CONFIG.*|GIT_EXEC_PATH|GIT_SSH.*|GIT_ASKPASS|GIT_EXTERNAL_DIFF|GIT_PAGER|GIT_EDITOR)$/;
const BASE = ['-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-c', 'core.hooksPath=/dev/null', '-c', 'protocol.allow=never'];

export function parseGitVersion(text) {
  const m = /git version (\d+)\.(\d+)\.(\d+)/.exec(String(text || ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function env() {
  const out = {};
  for (const [k, v] of Object.entries(process.env)) if (!DROP.test(k)) out[k] = v;
  return { ...out, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1', GIT_NO_REPLACE_OBJECTS: '1', LC_ALL: 'C' };
}

export function createGitRunner({ cwd, versionText = null, timeoutMs = 10000 }) {
  const exec = (args) => {
    try {
      const stdout = execFileSync('git', [...BASE, ...args], { cwd, env: env(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 });
      return { ok: true, status: 0, stdout };
    } catch (e) {
      return { ok: false, status: typeof e.status === 'number' ? e.status : null, stdout: e.stdout ? String(e.stdout) : '' };
    }
  };
  const version = parseGitVersion(versionText ?? exec(['--version']).stdout);
  const objectReadsAllowed = !!version && (version[0] > 2 || (version[0] === 2 && version[1] >= 45));
  return {
    version,
    objectReadsAllowed,
    run: exec,
    showFile(rev, relPath) {
      if (!objectReadsAllowed) return { status: 'undetermined' };
      // Does the path exist at that rev? ls-tree / ls-files are object-store metadata, no blob read.
      const listed = rev === '' ? exec(['ls-files', '--', relPath]) : exec(['ls-tree', '--name-only', rev, '--', relPath]);
      if (!listed.ok) return { status: 'undetermined' };
      if (!listed.stdout.trim()) return { status: 'missing' };
      const r = exec(['show', `${rev}:${relPath}`]);
      return r.ok ? { status: 'ok', content: r.stdout } : { status: 'undetermined' };
    },
  };
}
