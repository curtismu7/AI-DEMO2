'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const express = require('express');
const { listApplicationsRaw } = require('../services/agentBuilderService');
const { isWorkerApp } = require('../services/pingOneSecretRotation');

const router = express.Router();

const SECRETFUL = new Set(['CLIENT_SECRET_BASIC', 'CLIENT_SECRET_POST', 'CLIENT_SECRET_JWT']);

const REPO_ROOT = path.join(__dirname, '..', '..');
const RUN_DIR = path.join(__dirname, '..', 'data', 'rotation-runs');

router.get('/apps', async (_req, res) => {
  try {
    const raw = await listApplicationsRaw();
    const apps = raw
      .filter((a) => SECRETFUL.has(String(a.tokenEndpointAuthMethod || '').toUpperCase()))
      .filter((a) => !isWorkerApp(a))
      .map((a) => ({
        id: a.id, clientId: a.clientId, name: a.name,
        tokenEndpointAuthMethod: a.tokenEndpointAuthMethod,
      }));
    res.json({ apps });
  } catch (err) {
    res.status(502).json({ error: `Could not list applications: ${err.message}` });
  }
});

router.post('/start', (req, res) => {
  const { appId, vaultKey, restart, k8s } = req.body || {};
  if (!appId) return res.status(400).json({ error: 'appId is required' });
  if (!vaultKey) return res.status(400).json({ error: 'vaultKey is required' });

  fs.mkdirSync(RUN_DIR, { recursive: true });
  const runId = crypto.randomUUID();
  const logPath = path.join(RUN_DIR, `${runId}.log`);
  const out = fs.openSync(logPath, 'a');

  const argv = [path.join(REPO_ROOT, 'scripts/rotate-app-secret.js'),
    '--app-id', appId, '--vault-key', vaultKey];
  if (restart) argv.push('--restart');
  if (k8s) argv.push('--k8s');

  // Detached: a container recreate in the rotation's own restart step must not
  // orphan it. No secret is ever passed here — the CLI obtains it from PingOne.
  const child = spawn(process.execPath, argv, {
    cwd: REPO_ROOT, detached: true, stdio: ['ignore', out, out],
  });
  child.unref();

  res.status(202).json({ runId });
});

router.get('/runs/:runId', (req, res) => {
  if (!/^[0-9a-f-]{36}$/.test(req.params.runId)) {
    return res.status(400).json({ error: 'invalid runId' });
  }
  const logPath = path.join(RUN_DIR, `${req.params.runId}.log`);
  if (!fs.existsSync(logPath)) return res.status(404).json({ error: 'run not found' });
  const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
  const done = lines.some((l) => /verified|VERIFY FAILED|Error/.test(l));
  const failed = lines.some((l) => /VERIFY FAILED|Error/.test(l));
  res.json({ status: failed ? 'failed' : (done ? 'done' : 'running'), lines });
});

module.exports = router;
