import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (![1, 3].includes(args.length) || args[0].startsWith('--') ||
    (args.length === 3 && args[1] !== '--grep')) {
  console.error('Usage: node scripts/ui-read.mjs <dump.xml> [--grep TEXT]');
  process.exit(2);
}

let xml;
try {
  xml = readFileSync(args[0], 'utf8');
} catch {
  console.error('unreadable dump file');
  process.exit(1);
}
if (!/^\s*(?:<\?xml[^?]*\?>\s*)?<hierarchy\b[^>]*(?:\/>|>[\s\S]*<\/hierarchy>)\s*$/.test(xml)) {
  console.error('not a uiautomator dump');
  process.exit(1);
}

function decode(value) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  return value.replace(/&(amp|lt|gt|quot|apos|#\d+);/g, (entity, key) => {
    if (!key.startsWith('#')) return entities[key];
    const code = Number(key.slice(1));
    return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}

// Opening tags also capture parents with children, in document order.
const nodes = [...xml.matchAll(/<node\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g)];
if (nodes.length === 0) {
  console.error('no nodes (empty dump: wait and read again)');
  process.exit(1);
}
const grep = args[2]?.toLowerCase();
for (const [index, node] of nodes.entries()) {
  const attrs = Object.fromEntries([...node[1].matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)]
    .map((match) => [match[1], decode(match[2] ?? match[3])]));
  const text = attrs.text ?? '';
  const desc = attrs['content-desc'] ?? '';
  const id = attrs['resource-id'] ?? '';
  if (!text && !desc && !id && attrs.clickable !== 'true' && attrs.checkable !== 'true') continue;
  if (grep !== undefined && ![text, desc, id].some((value) => value.toLowerCase().includes(grep))) continue;

  const fields = [`r${index + 1}`, JSON.stringify(text || desc)];
  if (text && desc && desc !== text) fields.push(`desc=${JSON.stringify(desc)}`);
  if (id) fields.push(`id=${id.split(':id/').pop()}`);
  for (const flag of ['selected', 'checked', 'disabled', 'focused', 'clickable']) {
    if (flag === 'disabled' ? attrs.enabled === 'false' : attrs[flag] === 'true') fields.push(flag);
  }
  const bounds = attrs.bounds?.match(/^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/);
  if (bounds) {
    const [, x1, y1, x2, y2] = bounds.map(Number);
    fields.push(attrs.bounds, `c=${Math.round((x1 + x2) / 2)},${Math.round((y1 + y2) / 2)}`);
  }
  console.log(fields.join(' '));
}
