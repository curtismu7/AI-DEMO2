/**
 * routes/diagrams.js — regenerate architecture diagram PNGs from .mmd sources
 *
 * Mount: app.use('/api/admin/diagrams', diagramsRoutes)  (admin-only)
 *
 * POST /regenerate
 *   Body: { name?: 'overview' | 'overview-full' | 'token-flow' | 'mcp-gateway' }
 *   Returns: text/event-stream
 *     data: {"phase":"start","names":[...]}
 *     data: {"phase":"line","stream":"stdout"|"stderr","text":"..."}
 *     data: {"phase":"end","exitCode":0,"durationMs":...}
 *
 * The script (scripts/build-diagrams.sh) shells out to mermaid-cli via npx.
 * First run on a fresh machine downloads Puppeteer + Chromium (~150 MB,
 * cached by npx after that), which can take 1-2 minutes. Subsequent runs
 * complete in ~5-10 seconds per diagram.
 *
 * Safety:
 *   - Admin-only (parent router applies requireAdmin)
 *   - Allowlist of valid diagram names — no shell-injection via body
 *   - Hard wall-clock timeout: 5 minutes
 *   - Single-flight: 429 if a regen is already running
 */

'use strict';

const express = require('express');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const { requireAdmin } = require('../middleware/auth');
const configStore = require('../services/configStore');

const router = express.Router();

// Resolve from server.js's location: routes/ is sibling of server.js, repo root is ../..
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'build-diagrams.sh');
// Canonical .mmd sources live under docs/diagrams/ (moved there in 1b9cf3ab).
const SRC_DIR = path.join(REPO_ROOT, 'docs', 'diagrams');

// Allowlist of diagram names the script supports. Keep in sync with the
// ENTRIES array in scripts/build-diagrams.sh.
const ALLOWED_NAMES = new Set(['overview', 'overview-full', 'overview-full-svg', 'token-flow', 'mcp-gateway', 'ciba-stepup']);

// Diagram name -> canonical .mmd source under SRC_DIR. Mirrors the ENTRIES
// map in scripts/build-diagrams.sh; used to back up rendered sources to LMDB.
const NAME_TO_SOURCE = {
  'overview': 'architecture-simple.mmd',
  'overview-full': 'architecture.mmd',
  'overview-full-svg': 'architecture.mmd',
  'token-flow': 'i4ai-ref-arch.mmd',
  'mcp-gateway': 'mcp-security-gateway.mmd',
  'ciba-stepup': 'ciba-stepup-sequence.mmd',
};
const ALL_SOURCES = [...new Set(Object.values(NAME_TO_SOURCE))];

// Back up .mmd source content into LMDB (configStore) under diagram_mmd:<file>
// keys, so the rendered sources survive a lost or rebuilt working tree. Best
// effort: a backup failure is reported on the stream but never fails the regen.
async function backupSourcesToLmdb(sources, send) {
  const data = {};
  const stored = [];
  for (const src of sources) {
    try {
      data[`diagram_mmd:${src}`] = fs.readFileSync(path.join(SRC_DIR, src), 'utf8');
      stored.push(src);
    } catch (err) {
      send({ phase: 'backup', stream: 'stderr', text: `[backup skip] ${src}: ${err.message}` });
    }
  }
  if (stored.length === 0) return;
  data['diagram_mmd:_backed_up_at'] = new Date().toISOString();
  try {
    await configStore.setRaw(data, { persist: true });
    send({ phase: 'backup', stored, lmdb: true });
  } catch (err) {
    send({ phase: 'backup', stored: [], lmdb: false, error: err.message });
  }
}

// Single-flight gate. If a regen is in progress, refuse to start another one.
// Concurrent mermaid-cli invocations sometimes step on each other (shared
// Chromium temp dirs), and a second regen wouldn't show anything useful in
// the UI anyway.
let inFlight = false;

router.post('/regenerate', requireAdmin, async (req, res) => {
  if (inFlight) {
    return res.status(429).json({
      error: 'regeneration_in_progress',
      message: 'Another diagram regeneration is already running. Wait for it to finish, then retry.',
    });
  }

  // Filter argument — optional. If absent, render all. If present, must match
  // the allowlist; otherwise reject before spawning anything.
  const name = req.body && typeof req.body.name === 'string' ? req.body.name : '';
  if (name && !ALLOWED_NAMES.has(name)) {
    return res.status(400).json({
      error: 'unknown_diagram',
      message: `Unknown diagram name '${name}'. Valid names: ${[...ALLOWED_NAMES].join(', ')}.`,
    });
  }

  // Set SSE headers.
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // disable nginx buffering
  });

  const send = (obj) => {
    try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch (_e) { /* client gone */ }
  };

  inFlight = true;
  const startedAt = Date.now();
  send({ phase: 'start', name: name || 'all', script: 'scripts/build-diagrams.sh' });

  const args = name ? [SCRIPT_PATH, name] : [SCRIPT_PATH];

  // Spawn the script with the repo root as cwd so npx caches + relative
  // paths resolve correctly. stdio is piped so we can stream each line.
  const child = spawn('bash', args, {
    cwd: REPO_ROOT,
    env: { ...process.env, FORCE_COLOR: '0' }, // strip ANSI for cleaner UI output
  });

  // Wall-clock timeout — mermaid-cli download + render usually takes <2 min
  // on a fresh machine. 5 min covers slow downloads. After this, kill the
  // child and surface a timeout exit code.
  const KILL_AFTER_MS = 5 * 60 * 1000;
  const killTimer = setTimeout(() => {
    send({ phase: 'line', stream: 'stderr', text: `[timeout] Killing after ${KILL_AFTER_MS / 1000}s` });
    try { child.kill('SIGTERM'); } catch (_e) {}
  }, KILL_AFTER_MS);

  // Stream stdout/stderr line-by-line so the UI can show progress as it
  // happens. Both streams use the same { phase: 'line' } shape with a
  // 'stream' discriminator so the UI can colour stderr differently.
  const streamLines = (chunk, which) => {
    const text = chunk.toString('utf8');
    // Split on \n but keep trailing partials buffered if any. For our use
    // case (line-flushed bash output), splitting and emitting each non-empty
    // line is good enough.
    for (const line of text.split('\n')) {
      if (line.length === 0) continue;
      send({ phase: 'line', stream: which, text: line });
    }
  };
  child.stdout.on('data', (c) => streamLines(c, 'stdout'));
  child.stderr.on('data', (c) => streamLines(c, 'stderr'));

  child.on('error', (err) => {
    clearTimeout(killTimer);
    inFlight = false;
    send({ phase: 'end', error: err.message, exitCode: -1, durationMs: Date.now() - startedAt });
    res.end();
  });

  child.on('close', async (code, signal) => {
    clearTimeout(killTimer);
    // On a successful render, snapshot the rendered .mmd source(s) to LMDB
    // as a backup before releasing the single-flight gate.
    if (code === 0) {
      const sources = name ? [NAME_TO_SOURCE[name]].filter(Boolean) : ALL_SOURCES;
      await backupSourcesToLmdb(sources, send);
    }
    inFlight = false;
    send({
      phase: 'end',
      exitCode: code,
      signal: signal || null,
      durationMs: Date.now() - startedAt,
    });
    res.end();
  });

  // If the client disconnects mid-run, kill the child so we don't leak
  // a long-running mermaid-cli + Chromium process.
  req.on('close', () => {
    try { child.kill('SIGTERM'); } catch (_e) {}
  });
});

// GET /status — quick "is a regen running?" probe for the UI button state.
router.get('/status', requireAdmin, (req, res) => {
  res.json({ running: inFlight });
});

// GET /list — diagram names + the source/target file mappings. Lets the UI
// render a row per diagram with mtime + size so the user knows which is
// stale.
router.get('/list', requireAdmin, (req, res) => {
  const out = path.join(REPO_ROOT, 'demo_api_ui', 'public', 'architecture');
  // Must match scripts/build-diagrams.sh ENTRIES.
  const entries = [
    { name: 'overview',       source: 'architecture-simple.mmd',  png: 'overview.png' },
    { name: 'overview-full',  source: 'architecture.mmd',         png: 'overview2.png' },
    { name: 'token-flow',     source: 'i4ai-ref-arch.mmd',        png: 'token-flow.png' },
    { name: 'mcp-gateway',    source: 'mcp-security-gateway.mmd', png: 'token-flow2.png' },
  ];
  const result = entries.map((e) => {
    const srcAbs = path.join(SRC_DIR, e.source);
    const pngAbs = path.join(out, e.png);
    const stat = (p) => {
      try { const s = fs.statSync(p); return { mtime: s.mtimeMs, size: s.size }; } catch { return null; }
    };
    const srcStat = stat(srcAbs);
    const pngStat = stat(pngAbs);
    return {
      ...e,
      sourceExists: !!srcStat,
      pngExists: !!pngStat,
      pngMtime: pngStat?.mtime || null,
      pngSizeBytes: pngStat?.size || null,
      // Stale = source newer than rendered PNG.
      stale: srcStat && pngStat ? srcStat.mtime > pngStat.mtime : false,
    };
  });
  res.json({ diagrams: result });
});

module.exports = router;
