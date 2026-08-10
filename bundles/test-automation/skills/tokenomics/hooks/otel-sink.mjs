#!/usr/bin/env node
// otel-sink.mjs — a ~100-line stdlib OTLP/HTTP receiver, because Claude Code
// has no file exporter (OTLP/Prometheus/console only) and a real collector is
// infrastructure this skill deliberately avoids. Emitters point at
// http://localhost:4318 with OTEL_EXPORTER_OTLP_PROTOCOL=http/json; every POST
// to /v1/{metrics,logs,traces} is appended verbatim (one JSON line, with the
// receive time and path) to ~/.tokenomics-otel/otel-<day>.jsonl.
//
// Lifecycle is managed by the capture hook (ensureSink): spawned detached on
// every capture moment, exits 0 IMMEDIATELY if the port is taken (that's the
// "already running" signal — no probe needed), and exits on its own after
// IDLE_MS without a request. Crash-safety matters little by design: OTel here
// is an enrichment stream; the ledger's system of record is the stores.
//
//   node otel-sink.mjs [--port 4318] [--dir ~/.tokenomics-otel] [--idle-ms N]
//
// --port 0 picks an ephemeral port and prints {"port":N} on stdout (tests).
// STDLIB ONLY.
import { createServer } from 'node:http';
import { appendFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_BODY = 32 * 1024 * 1024;
const PATHS = new Set(['/v1/metrics', '/v1/logs', '/v1/traces']);

export function startSink({ port = 4318, dir = join(homedir(), '.tokenomics-otel'), idleMs = 30 * 60 * 1000, onReady, exit = (code) => process.exit(code) } = {}) {
  mkdirSync(dir, { recursive: true });
  const day = () => new Date().toISOString().slice(0, 10);
  let idleTimer = null;
  const server = createServer((req, res) => {
    resetIdle();
    if (req.method === 'GET' && req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, pid: process.pid }));
      return;
    }
    if (req.method !== 'POST' || !PATHS.has(req.url)) {
      res.writeHead(404); res.end();
      return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body;
        try { body = JSON.parse(raw); } catch { body = { unparsed: raw.slice(0, 4096) }; }
        appendFileSync(join(dir, `otel-${day()}.jsonl`), `${JSON.stringify({ t: new Date().toISOString(), path: req.url, body })}\n`);
        // OTLP success reply: an empty partial-success object.
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      } catch {
        res.writeHead(500); res.end();
      }
    });
    req.on('error', () => { /* client went away — nothing to do */ });
  });
  const shutdown = () => {
    if (idleTimer) clearTimeout(idleTimer);
    try { rmSync(join(dir, 'sink.pid'), { force: true }); } catch { /* ignore */ }
    server.close(() => exit(0));
    setTimeout(() => exit(0), 1000).unref();
  };
  function resetIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(shutdown, idleMs);
    idleTimer.unref?.();
  }
  server.on('error', (err) => {
    // Port taken = a sink is already running. That is success, not failure.
    exit(err && err.code === 'EADDRINUSE' ? 0 : 1);
  });
  server.listen(port, '127.0.0.1', () => {
    const actual = server.address().port;
    try { writeFileSync(join(dir, 'sink.pid'), `${process.pid} ${actual}\n`); } catch { /* ignore */ }
    resetIdle();
    if (onReady) onReady(actual);
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const arg = (name, dflt) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
  };
  startSink({
    port: Number(arg('--port', 4318)),
    dir: arg('--dir', join(homedir(), '.tokenomics-otel')),
    idleMs: Number(process.env.TOKENOMICS_SINK_IDLE_MS || arg('--idle-ms', 30 * 60 * 1000)),
    onReady: (port) => process.stdout.write(`${JSON.stringify({ port })}\n`),
  });
}
