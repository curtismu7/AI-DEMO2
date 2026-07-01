'use strict';

/**
 * /api/admin/agent-gateway — view, validate, edit and reload the Agent Gateway
 * (PingGateway / IG) JSON configuration from the admin UI.
 *
 *   GET  /files            → allowlisted file list (metadata only)
 *   GET  /files/:id        → { raw, parsed, mtime, type, reloadMode }
 *   POST /files/:id/validate → { ok, errors }  (no write)
 *   POST /files/:id        → validate → backup → write → reload hint
 *   POST /reload           → one-click restart of the affected container(s)
 *
 * Security: admin-gated (same gate as /api/admin/config — open on first-run and
 * local dev, admin-only on hosted stacks). Files are referenced by opaque id;
 * paths come from the registry allowlist, never the request. Writes are audited.
 */

const express = require('express');
const fs = require('fs');
const http = require('http');
const https = require('https');
const router = express.Router();

const configStore = require('../services/configStore');
const hosting = require('../config/hosting');
const appEventService = require('../services/appEventService');
const registry = require('../services/agentGatewayConfig/fileRegistry');
const { validate } = require('../services/agentGatewayConfig/validate');
const { createBackup, writeAtomic } = require('../services/agentGatewayConfig/backup');
const { restartTargets, restartEnabled, socketAvailable } = require('../services/agentGatewayConfig/dockerRestart');

// ---------------------------------------------------------------------------
// Auth gate — mirrors requireAdminOrUnconfigured in routes/adminConfig.js.
// ---------------------------------------------------------------------------
function isAdminSession(req) {
  return !!(req.session?.user?.role === 'admin' || req.session?.isAdmin);
}
function requireAdmin(req, res, next) {
  if (!configStore.isConfigured()) return next();  // first-run: open
  if (!hosting.isReplit()) return next();           // local dev: open
  if (isAdminSession(req)) return next();
  return res.status(401).json({ error: 'unauthorized', message: 'Admin session required to edit gateway config.' });
}

// ---------------------------------------------------------------------------
// Gateway health probe (confirms auto-reload took effect).
// ---------------------------------------------------------------------------
function gatewayBaseUrl() {
  return process.env.MCP_PINGGATEWAY_URL
    || configStore.getEffective('mcp_pinggateway_url')
    || 'http://ping-gateway:8080';
}

function probeHealth(baseUrl) {
  return new Promise((resolve) => {
    let url;
    try { url = new URL(baseUrl.replace(/\/$/, '') + '/health'); }
    catch { return resolve(false); }
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request({
      hostname: url.hostname,
      port: parseInt(url.port || (url.protocol === 'https:' ? '443' : '80'), 10),
      path: url.pathname,
      method: 'GET',
      timeout: 3000,
      ...(url.protocol === 'https:' && process.env.NODE_ENV !== 'production' ? { rejectUnauthorized: false } : {}),
    }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 300);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Poll /health for up to ~15s so the UI can report the route reload landed.
async function waitForHealthy(baseUrl, { attempts = 8, intervalMs = 2000 } = {}) {
  for (let i = 0; i < attempts; i++) {
    if (await probeHealth(baseUrl)) return true;
    await sleep(intervalMs);
  }
  return false;
}

function restartTargetsForType(type) {
  if (type === 'scope-topology') return ['ping-gateway', 'bff'];
  if (type === 'ig-config' || type === 'ig-admin') return ['ping-gateway'];
  return []; // ig-route reloads automatically
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

router.get('/files', requireAdmin, (req, res) => {
  res.json({
    ok: true,
    files: registry.listFiles(),
    restart: { enabled: restartEnabled(), socket: socketAvailable() },
  });
});

router.get('/files/:id', requireAdmin, (req, res) => {
  const entry = registry.resolveEntry(req.params.id);
  if (!entry) return res.status(404).json({ error: 'not_found', message: 'Unknown gateway config file.' });
  try {
    const raw = fs.readFileSync(entry.absPath, 'utf8');
    const stat = fs.statSync(entry.absPath);
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch { /* editor still loads raw */ }
    res.json({
      ok: true,
      id: entry.id,
      label: entry.label,
      type: entry.type,
      reloadMode: entry.reloadMode,
      raw,
      parsed,
      mtime: stat.mtimeMs,
    });
  } catch (err) {
    res.status(500).json({ error: 'read_error', message: err.message });
  }
});

router.post('/files/:id/validate', requireAdmin, (req, res) => {
  const entry = registry.resolveEntry(req.params.id);
  if (!entry) return res.status(404).json({ error: 'not_found', message: 'Unknown gateway config file.' });
  const raw = typeof req.body?.raw === 'string' ? req.body.raw : '';
  const result = validate(entry.type, raw);
  res.json({ ok: result.ok, errors: result.errors });
});

router.post('/files/:id', requireAdmin, async (req, res) => {
  const entry = registry.resolveEntry(req.params.id);
  if (!entry) return res.status(404).json({ error: 'not_found', message: 'Unknown gateway config file.' });

  const raw = typeof req.body?.raw === 'string' ? req.body.raw : null;
  if (raw === null) return res.status(400).json({ error: 'invalid_body', message: 'Body must include { raw: "<json text>" }.' });

  const result = validate(entry.type, raw);
  if (!result.ok) {
    return res.status(400).json({ error: 'validation_failed', message: 'Config has errors — not saved.', errors: result.errors });
  }

  let backupPath = null;
  try {
    backupPath = createBackup(entry);
    // Normalise to pretty JSON so the file stays diff-friendly on disk.
    writeAtomic(entry, JSON.stringify(result.parsed, null, 2) + '\n');
  } catch (err) {
    return res.status(500).json({ error: 'write_error', message: err.message });
  }

  appEventService.logEvent('config', 'info', 'Agent Gateway config saved', {
    actor: req.session?.user?.sub || 'local-admin',
    id: entry.id,
    type: entry.type,
    backup: backupPath ? require('path').basename(backupPath) : null,
  });

  const reload = { mode: entry.reloadMode };
  if (entry.reloadMode === 'auto') {
    reload.reloaded = await waitForHealthy(gatewayBaseUrl());
  } else {
    reload.required = true;
    reload.targets = restartTargetsForType(entry.type);
    reload.restart = { enabled: restartEnabled(), socket: socketAvailable() };
  }

  res.json({
    ok: true,
    id: entry.id,
    backup: backupPath ? require('path').basename(backupPath) : null,
    warnings: result.errors.filter((e) => e.level === 'warn'),
    reload,
  });
});

router.post('/reload', requireAdmin, async (req, res) => {
  let targets = Array.isArray(req.body?.targets) ? req.body.targets : null;
  if (!targets && req.body?.id) {
    const entry = registry.resolveEntry(req.body.id);
    if (!entry) return res.status(404).json({ error: 'not_found', message: 'Unknown gateway config file.' });
    targets = restartTargetsForType(entry.type);
  }
  if (!targets || !targets.length) {
    return res.status(400).json({ error: 'no_targets', message: 'Nothing to restart (route files reload automatically).' });
  }

  appEventService.logEvent('config', 'warn', 'Agent Gateway restart requested', {
    actor: req.session?.user?.sub || 'local-admin',
    targets,
  });

  const result = await restartTargets(targets);
  const status = result.ok ? 200 : (socketAvailable() ? 502 : 503);
  res.status(status).json(result);
});

module.exports = router;
