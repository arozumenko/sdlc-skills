import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseShellLiterals, literalDefaultCap } from './shell-literals.mjs';

test('supported literal forms', () => {
  const r = parseShellLiterals('# c\n\nSDLC_CTX_CAP=9000\nexport A="x y"\nB=\'z\'\n: "${SDLC_SHARED_DOCS:=testing profile}"\n: "${SDLC_ROLE_MEMORY_FILES_QA:=${SDLC_ROLE_MEMORY_FILES:-SOUL.md RULES.md}}"\n');
  assert.equal(r.known, true);
  assert.deepEqual(r.vars, { SDLC_CTX_CAP: '9000', A: 'x y', B: 'z', SDLC_SHARED_DOCS: 'testing profile', SDLC_ROLE_MEMORY_FILES_QA: '${SDLC_ROLE_MEMORY_FILES:-SOUL.md RULES.md}' });
});

test('anything else is unknown', () => {
  for (const t of ['if [ -n "$X" ]; then A=1; fi', 'A=$(date)', 'f() { :; }', 'source other.sh', 'A=1; B=2']) assert.equal(parseShellLiterals(t).known, false, t);
});

test('literalDefaultCap reads the printf literals', () => {
  const lib = "default_ctx_cap() {\n  if [ -n \"${COPILOT_CLI:-}\" ] || [ -n \"${SDLC_VSCODE:-}\" ]; then printf '10240'; else printf '9000'; fi\n}\n";
  assert.deepEqual(literalDefaultCap(lib), { claude: 9000, copilot: 10240 });
  assert.deepEqual(literalDefaultCap('nothing here'), { claude: null, copilot: null });
});

test('literalDefaultCap falls back to the ${SDLC_CTX_CAP:-N} default for both hosts', () => {
  const lib = 'build_ctx() {\n  local cap="${SDLC_CTX_CAP:-10240}" budget maxlist\n}\n';
  assert.deepEqual(literalDefaultCap(lib), { claude: 10240, copilot: 10240 });
});
