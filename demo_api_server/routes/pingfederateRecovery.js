'use strict';

// Recovery actions for the "PingFederate is not responding" sign-in modal.
// Deliberately callable without a session: a visitor who hit a dead PingFederate
// cannot sign in, so cannot be an admin. Each action is therefore narrowed to what
// is harmless on its own:
//   - start: only ever the one fixed container below, never a name from the request;
//     404 anywhere there is no docker socket (k8s / SE AWS).
//   - use-pingone: only ever sets the provider to pingone, and only while PF is
//     actually unreachable (a state in which PF logins are already broken for everyone).
const express = require('express');
const fs = require('fs');
const http = require('http');
const configStore = require('../services/configStore');
const appEventService = require('../services/appEventService');
const { isPingFederateDown } = require('../services/pingfederateReachability');

const router = express.Router();

const DOCKER_SOCKET = '/var/run/docker.sock';
const PF_CONTAINER = 'ai-demo-pingfederate';

function startContainer(name) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { socketPath: DOCKER_SOCKET, path: `/containers/${name}/start`, method: 'POST', timeout: 15000 },
      (res) => { res.resume(); resolve(res.statusCode); },
    );
    req.once('timeout', () => req.destroy(new Error('docker socket timeout')));
    req.once('error', reject);
    req.end();
  });
}

router.get('/status', async (_req, res) => {
  res.json({ down: await isPingFederateDown() });
});

router.post('/start', async (_req, res) => {
  if (!fs.existsSync(DOCKER_SOCKET)) {
    return res.status(404).json({ error: 'not_available', message: 'This deployment cannot start PingFederate. Start it manually.' });
  }
  try {
    const status = await startContainer(PF_CONTAINER);
    // 204 = started, 304 = already running.
    if (status === 204 || status === 304) return res.json({ ok: true });
    if (status === 404) {
      return res.status(404).json({
        error: 'container_missing',
        message: 'The PingFederate container does not exist. Recreate it with scripts/pingfederate/docker-compose.local.yml.',
      });
    }
    return res.status(502).json({ error: 'start_failed', message: `Docker refused to start PingFederate (HTTP ${status}).` });
  } catch (err) {
    console.error('[pingfederateRecovery] start failed:', err.message);
    return res.status(502).json({ error: 'start_failed', message: 'Could not reach Docker to start PingFederate.' });
  }
});

router.post('/use-pingone', async (_req, res) => {
  if (!(await isPingFederateDown())) {
    return res.status(409).json({
      error: 'pf_is_up',
      message: 'PingFederate is reachable. Switching the login provider needs an administrator.',
    });
  }
  try {
    await configStore.setConfig({ OAUTH_PROVIDER: 'pingone' });
    try {
      appEventService.logEvent('config', 'warn', 'Login provider switched to PingOne because PingFederate is unreachable', {
        actor: 'unauthenticated-pf-recovery',
        keys: ['OAUTH_PROVIDER'],
      });
    } catch (_e) { /* audit is best-effort */ }
    return res.json({ ok: true });
  } catch (err) {
    console.error('[pingfederateRecovery] use-pingone failed:', err.message);
    return res.status(500).json({ error: 'config_save_error', message: 'Could not switch the login provider.' });
  }
});

module.exports = router;
