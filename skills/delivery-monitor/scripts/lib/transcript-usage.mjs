// STDLIB ONLY. Shared Claude usage normalization, plus an append-only incremental transcript cursor.
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
export function usageRecord(r) {
  if (r.type !== 'assistant' || !r.message?.usage) return null;
  const u = r.message.usage, w1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  return { id: r.message.id ?? r.requestId ?? null, model: `${r.message.model ?? 'unknown'}${u.speed === 'fast' ? '#fast' : ''}`,
    usage: { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cache_write: Math.max(0, (u.cache_creation_input_tokens ?? 0) - w1h), cache_write_1h: w1h, cache_read: u.cache_read_input_tokens ?? 0 } };
}
/** Reads only bytes added since the previous call, retaining a partial UTF-8/JSON line until its newline arrives.
 * IDs use per-counter maxima, exactly as parseTranscript. Anonymous messages are keyed by their byte offset. */
export function incrementalUsage(path, cursor = {}) {
  const fd = openSync(path, 'r');
  try {
    const stat = fstatSync(fd), identity = `${stat.dev}:${stat.ino}`;
    if (cursor.identity !== identity || stat.size < (cursor.offset ?? 0)) cursor = { identity, offset: 0, tail: '', messages: {}, firstUserText: '' };
    const offset = cursor.offset ?? 0, len = stat.size - offset, buf = Buffer.alloc(len);
    let read = 0;
    while (read < len) { const n = readSync(fd, buf, read, len - read, offset + read); if (!n) break; read += n; }
    const tail = Buffer.from(cursor.tail ?? '', 'base64'), bytes = Buffer.concat([tail, buf.subarray(0, read)]);
    let start = 0, end;
    while ((end = bytes.indexOf(10, start)) !== -1) {
      const at = offset - tail.length + start, line = bytes.subarray(start, end).toString('utf8'); start = end + 1;
      if (!line.trim()) continue;
      const r = JSON.parse(line); // a malformed complete line is evidence unavailable, not zero cost
      if (!cursor.firstUserText && r.type === 'user') cursor.firstUserText = typeof r.message?.content === 'string' ? r.message.content : (r.message?.content ?? []).map(c => c.text ?? '').join('\n');
      const rec = usageRecord(r); if (!rec) continue;
      if (Object.values(rec.usage).some(v => !Number.isFinite(v) || v < 0)) throw new Error('invalid transcript usage');
      const key = rec.id == null ? `anonymous:${at}` : `id:${rec.id}`, prev = Object.hasOwn(cursor.messages, key) ? cursor.messages[key] : null;
      Object.defineProperty(cursor.messages, key, { value: { model: rec.model, usage: Object.fromEntries(Object.entries(rec.usage).map(([k,v]) => [k, Math.max(v, prev?.usage[k] ?? 0)])) }, enumerable: true, configurable: true, writable: true });
    }
    cursor.offset = offset + read; cursor.tail = bytes.subarray(start).toString('base64');
    const usage = {};
    for (const { model, usage: u } of Object.values(cursor.messages)) {
      if (!Object.hasOwn(usage, model)) Object.defineProperty(usage, model, { value: { input: 0, output: 0, cache_write: 0, cache_write_1h: 0, cache_read: 0 }, enumerable: true });
      for (const k of Object.keys(u)) usage[model][k] += u[k];
    }
    return { cursor, usage };
  } finally { closeSync(fd); }
}
