// scripts/journey.mjs
//
// journeyOrder(screens) — pure, ESM. Sorts a flow's screens into journey
// order by their `node` id, matching how user-flow-maps orders flow nodes
// (flowmap.js's `layout()`): whole numbers ascend as the main sequence; a
// decimal id (e.g. "2.1") is a branch off its parent whole step and sorts
// immediately after it, before the next whole step. Multiple decimals under
// the same parent sort ascending by their fractional part. Screens with no
// `node` sort last, keeping their original relative order (stable).

// A screen's `node` may be a single id or an array of ids (multiple flow
// nodes render into one screen); journey order goes by the FIRST id.
function firstNodeId(screen) {
  const n = screen && screen.node;
  if (n == null) return undefined;
  const first = Array.isArray(n) ? n[0] : n;
  return first == null ? undefined : String(first);
}

// "2" -> {whole:2, dec:0} sorts before any of its own branches.
// "2.1" -> {whole:2, dec:1}; "2.2" -> {whole:2, dec:2}.
function parseNodeKey(id) {
  const [wholePart, decPart] = id.split('.');
  return { whole: parseFloat(wholePart), dec: decPart ? parseFloat(decPart) : 0 };
}

export function journeyOrder(screens) {
  const indexed = (screens || []).map((s, i) => ({ s, i, key: firstNodeId(s) }));
  const withNode = indexed.filter(x => x.key !== undefined);
  const withoutNode = indexed.filter(x => x.key === undefined);

  withNode.sort((a, b) => {
    const ka = parseNodeKey(a.key);
    const kb = parseNodeKey(b.key);
    if (ka.whole !== kb.whole) return ka.whole - kb.whole;
    if (ka.dec !== kb.dec) return ka.dec - kb.dec;
    return a.i - b.i; // stable tie-break
  });

  return [...withNode, ...withoutNode].map(x => x.s);
}
