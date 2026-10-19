export const rolesCheck = {
  name: 'roles',
  run(ctx) {
    if (!(ctx.detected || []).some((t) => t.evidence)) return [];
    const dirs = ['.claude/agents', '.cursor/agents', '.windsurf/agents'];
    const roles = new Set();
    for (const d of dirs) for (const e of ctx.fs.list(d).entries) if (e.type === 'dir') roles.add(e.name);
    const list = [...roles].sort();
    const withMem = list.filter((r) => ctx.fs.list(`.agents/memory/${r}`).status === 'ok').length;
    ctx.facts.roles = list.join(', ') || 'none';
    ctx.facts.memory = `${list.length} role${list.length === 1 ? '' : 's'}, ${withMem} with ${withMem === 1 ? 'a memory directory' : 'memory directories'}`;
    return [];
  },
};
