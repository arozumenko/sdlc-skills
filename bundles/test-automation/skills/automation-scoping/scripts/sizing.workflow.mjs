// Sizing mini-workflow — the verdict pass at scale (Claude Code only).
// Invoked by the lead/scout per SKILL.md § The verdict pass:
//   Workflow({ scriptPath: '<installed skill>/scripts/sizing.workflow.mjs',
//              args: { scope: '<slug>', files: ['tasks/smoke/TC-001_… .md', …] } })
//
// WHAT IT IS. Readers actually read every case body and return a structured
// verdict (schema-forced); the script only chunks and collects; a single
// writer lands the verdicts file and lets score-cases.mjs do the arithmetic.
// The output pair is the contract every consumer already reads:
//   .agents/estimation/<scope>-verdicts.json   (reader judgments, verbatim)
//   .agents/estimation/<scope>-scored.json     (score-cases --json output)
// — the tokenomics close-time sizing join, the deviation flags, and the
// hyperfactory dataset export (size_tshirt / self_size / effort) all feed
// from the scored file. Small batches don't need this workflow — the intake
// clustering+sizing pass (orchestration playbook § Intake) is one dispatch;
// this exists for the scoping-grade scopes (20+ cases, presales backlogs)
// where the doctrine says fan out the reading, never absorb it.
//
// READ-ONLY FAN-OUT. Readers write nothing and share no tree state, so
// parallel() is sanctioned here (the one exception the pipeline's
// one-at-a-time rule names). Only the final writer touches disk, once.
//
// FILES COME FROM ARGS, deterministically. The sandbox has no fs, and the
// resume cache keys on exact prompts — so the caller enumerates the case
// files (one `ls`/glob) and passes them in; chunking is by sorted order,
// never by timing (prompt-determinism contract, batch-build § top comment).

export const meta = {
  name: 'ta-scope-sizing',
  description: 'Verdict-pass sizing at scale: parallel readers judge every case body against the project (or bundled) complexity taxonomy, one writer lands <scope>-verdicts.json and runs score-cases.mjs — producing the scored file the tokenomics sizing join and the hyperfactory dataset export consume',
  whenToUse: 'Lead or scout on Claude Code when a scope of case files needs sizing — presales estimation, a backlog before batching, or refreshing sizes after case rewrites; small in-flight batches use the intake clustering+sizing pass instead',
  phases: [
    { title: 'Read', detail: 'parallel readers, one chunk of case files each — schema-forced verdicts, no writes' },
    { title: 'Score', detail: 'one writer: verdicts.json verbatim, then score-cases.mjs does the arithmetic' },
  ],
}

// ---- args ------------------------------------------------------------------
const A = typeof args === 'string' ? JSON.parse(args) : (args ?? {})
if (!A.scope || !Array.isArray(A.files) || A.files.length === 0) {
  throw new Error("args required: { scope: '<slug>', files: ['<case file path>', …], chunk?: 15, root?, readerModel?, skillDir? }")
}
const SCOPE = String(A.scope).replace(/[^A-Za-z0-9._-]/g, '-')
const ROOT = A.root ? `${String(A.root).replace(/\/+$/, '')}/` : ''
// Where this skill is installed — the writer runs its score script and the
// readers read its taxonomy. Default matches the standard install layout.
const SKILL_DIR = A.skillDir ?? '.claude/skills/automation-scoping'
const CHUNK = Math.max(1, Math.min(A.chunk ?? 15, 20))
const FILES = [...new Set(A.files.map(String))].sort()
const chunks = []
for (let i = 0; i < FILES.length; i += CHUNK) chunks.push(FILES.slice(i, i + CHUNK))

// Stall-retry exhaustion THROWS out of agent() instead of returning null
// (field 2026-08-17) — one stalled chunk must cost that chunk, not the run.
const isStall = (e) => /stall/i.test(String(e?.message ?? e))
const guarded = async (what, fn) => {
  try { return await fn() } catch (e) {
    log(`${what} ${isStall(e) ? 'infra-stalled (environment — fix the provider before retrying)' : 'threw'}: ${String(e?.message ?? e).slice(0, 120)}`)
    return null
  }
}

// ---- Phase 1: parallel readers ---------------------------------------------
const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['verdicts', 'unreadable', 'notes'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'tier', 'steps', 'size', 'confidence'],
        properties: {
          id: { type: 'string' },
          tier: { type: 'string' },
          tier_rationale: { type: 'string' },
          steps: { type: 'integer' },
          surfaces: { type: 'integer' },
          new_abstractions: { type: 'integer' },
          size: { type: 'string', enum: ['XS', 'S', 'M', 'L', 'XL'] },
          size_rationale: { type: 'string' },
          modifiers: { type: 'array', items: { type: 'string' } },
          quality_flags: { type: 'array', items: { type: 'string' } },
          risk_flags: { type: 'array', items: { type: 'string' } },
          signals: { type: 'array', items: { type: 'string' } },
          split_recommended: { type: 'boolean' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
    unreadable: { type: 'array', items: { type: 'string' } },   // paths that failed to read/parse
    notes: { type: 'string' },
  },
}

const readerPrompt = (files, i) =>
  `Sizing reader — chunk ${i + 1}/${chunks.length} of scope '${SCOPE}'. READ-ONLY: no git, no writes, no browser.\n` +
  'FIRST read your contract, in this order:\n' +
  `  a. ${ROOT}.agents/estimation/complexity-taxonomy.json — IF it exists, its tier names/definitions are THIS project's calibrated truth;\n` +
  `  b. else ${ROOT}${SKILL_DIR}/references/complexity-taxonomy.md — the bundled tier definitions and modifier list;\n` +
  `  c. ${ROOT}${SKILL_DIR}/SKILL.md § "The verdict pass" — the verdict field semantics and rules (read just that section).\n` +
  'Then read EVERY file below and return one verdict per case, judged from the case BODY against the tier DEFINITIONS — what interaction the case actually exercises, never keyword-matching. ' +
  "id = the case's own id (frontmatter/heading/filename stem). A file you cannot read or that holds no case goes in unreadable[], never an invented verdict. " +
  'Fields you could not ground (surfaces/new_abstractions unclear) you OMIT rather than guess — the scorer marks those derived-partial, which is honest. ' +
  'Files:\n' + files.map((f) => `- ${ROOT}${f}`).join('\n')
// No PREAMBLE on readers: they touch no repo state, need no git doctrine, and
// the cheap tier benefits from the lean prompt.

phase('Read')
const results = (await parallel(chunks.map((files, i) => () =>
  guarded(`reader chunk ${i + 1}`, () => agent(readerPrompt(files, i), {
    label: `size:${SCOPE}:${i + 1}/${chunks.length}`, phase: 'Read',
    model: A.readerModel ?? 'haiku', effort: 'low', schema: VERDICT_SCHEMA,
  }))
))).filter(Boolean)

const verdicts = []
const seen = new Set()
const unreadable = []
for (const r of results) {
  for (const v of r.verdicts ?? []) { if (!seen.has(v.id)) { seen.add(v.id); verdicts.push(v) } }
  unreadable.push(...(r.unreadable ?? []))
}
const deadChunks = chunks.length - results.length
if (deadChunks) log(`${deadChunks} chunk(s) died — their cases are simply missing from the verdicts (re-run with resumeFromRunId to fill)`)
log(`verdicts: ${verdicts.length} case(s) from ${results.length}/${chunks.length} chunk(s)${unreadable.length ? `, ${unreadable.length} unreadable` : ''}`)
if (!verdicts.length) {
  return { scope: SCOPE, verdicts: 0, unreadable, next: 'No verdicts — every reader died or no file held a case. Check the file list and re-run (resumeFromRunId replays finished chunks).' }
}

// ---- Phase 2: one writer, score-cases does the arithmetic ------------------
phase('Score')
const VP = `${ROOT}.agents/estimation/${SCOPE}-verdicts.json`
const SP = `${ROOT}.agents/estimation/${SCOPE}-scored.json`
const WRITE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['written', 'scored', 'notes'],
  properties: { written: { type: 'boolean' }, scored: { type: 'boolean' }, case_sp: { type: ['number', 'null'] }, by_size: { type: 'object' }, notes: { type: 'string' } },
}
const wrote = await guarded('score writer', () => agent(
  'You are the sizing writer — the only disk write of this run. NEVER price or size anything yourself; the script owns the arithmetic.\n' +
  `1. Create ${ROOT}.agents/estimation/ if needed, then Write ${VP} with EXACTLY this JSON, byte for byte:\n` +
  '`````json\n' + JSON.stringify({ scope: SCOPE, verdicts }, null, 2) + '\n`````\n' +
  `2. Run: node ${ROOT}${SKILL_DIR}/scripts/score-cases.mjs --verdicts ${VP} --json --out ${SP}\n` +
  '   (pass the case files dir as its positional arg only if the script demands one — try without first). ' +
  'If the script is missing or errors, say so in notes with the exact error — scored: false, never a hand-made scored file.\n' +
  `3. Read ${SP} back just enough to return case_sp (total SP) and by_size (size -> count). ` +
  'Leave both files on disk UNCOMMITTED — they are estimation artifacts; the lead lands them with the next batch commit or leaves them (the precise gate tolerates them).',
  { label: `score:${SCOPE}`, phase: 'Score', model: 'haiku', effort: 'low', schema: WRITE_SCHEMA }
))

return {
  scope: SCOPE,
  cases: FILES.length,
  verdicts: verdicts.length,
  by_size: wrote?.by_size ?? null,
  case_sp: wrote?.case_sp ?? null,
  unreadable,
  dead_chunks: deadChunks,
  verdicts_path: VP,
  scored_path: wrote?.scored ? SP : null,
  next: wrote?.scored
    ? `Sized: ${verdicts.length}/${FILES.length} case(s) → ${SP}. The tokenomics close join, deviation flags and dataset export read it automatically. For a quotable presales number, render the scoping report per the automation-scoping SKILL (score-cases output is sizing, not a quote) — and consider a Mode 3 live spot-check on the low-confidence verdicts.`
    : `Verdicts landed at ${VP} but scoring did not run (${wrote?.notes ?? 'writer died'}) — run score-cases.mjs --verdicts ${VP} --json --out ${SP} by hand.`,
}
