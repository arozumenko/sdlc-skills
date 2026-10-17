// What a CLI install wires for the core hooks, per target. Used by init (to write)
// and doctor (to check), so the two cannot disagree. Pure data; no I/O.
export const CORE_HOOK_FILES = ['run-hook.cmd', 'session-start', 'agent-start', 'lib.sh'];
export const CORE_HOOK_EXE = ['run-hook.cmd', 'session-start', 'agent-start'];
export const CORE_HOOK_MARKER = 'hooks/sdlc-skills/run-hook.cmd';

function claudeShape(cmd, { async }) {
  const h = (verb) => (async === undefined ? { type: 'command', command: `${cmd} ${verb}` } : { type: 'command', command: `${cmd} ${verb}`, async });
  return {
    SessionStart: [{ matcher: 'startup|clear|compact|resume', hooks: [h('session-start')] }],
    SubagentStart: [{ matcher: '*', hooks: [h('agent-start')] }],
  };
}

export function expectedCoreHookSpec(targetId) {
  if (targetId === 'claude') {
    const scriptsDir = '.claude/hooks/sdlc-skills';
    const writeSpec = claudeShape(`"\${CLAUDE_PROJECT_DIR}/${scriptsDir}/run-hook.cmd"`, { async: false });
    return { target: 'claude', scriptsDir, configFiles: ['.claude/settings.json', '.claude/settings.local.json'], shape: 'claude', writeSpec, events: writeSpec };
  }
  if (targetId === 'cursor') {
    const scriptsDir = '.cursor/hooks/sdlc-skills';
    const writeSpec = { sessionStart: [{ command: `CURSOR_HOOK=1 ./${scriptsDir}/run-hook.cmd session-start` }] };
    return { target: 'cursor', scriptsDir, configFiles: ['.cursor/hooks.json'], shape: 'versioned', writeSpec, events: writeSpec };
  }
  if (targetId === 'copilot') {
    const scriptsDir = '.github/hooks/sdlc-skills';
    const cli = (verb) => ({ type: 'command', bash: `"./${scriptsDir}/run-hook.cmd" ${verb}`, powershell: `& "./${scriptsDir}/run-hook.cmd" ${verb}`, env: { COPILOT_CLI: '1' }, timeoutSec: 10 });
    const vscode = (verb) => ({ type: 'command', command: `"./${scriptsDir}/run-hook.cmd" ${verb}`, env: { SDLC_VSCODE: '1' }, timeout: 10 });
    const writeSpec = { version: 1, hooks: { sessionStart: [cli('session-start')], subagentStart: [cli('agent-start')], SubagentStart: [vscode('agent-start')] } };
    return { target: 'copilot', scriptsDir, configFiles: ['.github/hooks/sdlc-skills.json'], shape: 'owned', writeSpec, events: writeSpec.hooks };
  }
  if (targetId === 'codex') {
    const scriptsDir = '.codex/hooks/sdlc-skills';
    const writeSpec = claudeShape(`CODEX_HOOK=1 "./${scriptsDir}/run-hook.cmd"`, {});
    return { target: 'codex', scriptsDir, configFiles: ['.codex/hooks.json'], shape: 'claude', writeSpec, events: writeSpec };
  }
  return null;
}
