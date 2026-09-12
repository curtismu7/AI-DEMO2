'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const express = require('express');
const { listApplicationsRaw } = require('../services/agentBuilderService');
const { isWorkerApp } = require('../services/pingOneSecretRotation');
const { getRotatableVaultKeyMap } = require('../scripts/refresh-service-envs');

const router = express.Router();

const SECRETFUL = new Set(['CLIENT_SECRET_BASIC', 'CLIENT_SECRET_POST', 'CLIENT_SECRET_JWT']);

// Routes run from /app/routes inside the BFF container, so a __dirname-relative
// repo root resolves to '/' and the spawned CLI path is wrong. The repo is
// bind-mounted at /repo — the same convention CODE_SEARCH_REPO_ROOT and
// SCOPE_TOPOLOGY_PATH already use (demo_api_server/Dockerfile sets it). Falls
// back to the on-disk layout when running natively, where the env var is unset.
const REPO_ROOT = process.env.CODE_SEARCH_REPO_ROOT || path.join(__dirname, '..', '..');
const RUN_DIR = path.join(__dirname, '..', 'data', 'rotation-runs');

// How long a run log may sit untouched, with no DONE line, before /runs/:id
// calls the child dead. Generous on purpose: this is a detached background
// process doing network round-trips, not a live request.
const STALE_RUN_MS = 30_000;

router.get('/apps', async (_req, res) => {
  try {
    // The vault key is SERVER-derived: only apps this repo actually stores a
    // secret for can be rotated, and each carries the exact key its new secret
    // must land under. The page used to invent one from the display name, which
    // could never match a real key.
    const [raw, vaultKeys] = await Promise.all([
      listApplicationsRaw(), getRotatableVaultKeyMap(),
    ]);
    const apps = raw
      .filter((a) => SECRETFUL.has(String(a.tokenEndpointAuthMethod || '').toUpperCase()))
      .filter((a) => !isWorkerApp(a))
      .filter((a) => Boolean(vaultKeys[a.clientId]))
      .map((a) => ({
        id: a.id, clientId: a.clientId, name: a.name,
        tokenEndpointAuthMethod: a.tokenEndpointAuthMethod,
        vaultKey: vaultKeys[a.clientId],
      }));
    res.json({ apps });
  } catch (err) {
    res.status(502).json({ error: `Could not list applications: ${err.message}` });
  }
});

router.post('/start', async (req, res) => {
  const { appId, vaultKey, restart, k8s, reason } = req.body || {};
  if (!appId) return res.status(400).json({ error: 'appId is required' });
  if (!vaultKey) return res.status(400).json({ error: 'vaultKey is required' });

  // Preflight the pair BEFORE spawning anything: the CLI's first irreversible
  // step is downstream of this, and a vaultKey that doesn't belong to this app
  // writes the new secret somewhere nothing reads.
  let vaultKeys;
  try {
    vaultKeys = await getRotatableVaultKeyMap();
  } catch (err) {
    return res.status(502).json({ error: `Could not resolve rotatable apps: ${err.message}` });
  }
  if (vaultKeys[appId] !== vaultKey) {
    return res.status(400).json({
      error: `vaultKey ${vaultKey} is not the rotatable vault key for application ${appId}`,
    });
  }

  fs.mkdirSync(RUN_DIR, { recursive: true });
  const runId = crypto.randomUUID();
  const logPath = path.join(RUN_DIR, `${runId}.log`);
  // The operator-typed justification is the run's audit trail — an
  // irreversible action that asks for a reason and drops it is worse than not
  // asking. Written first, before the child can append anything. It is not a
  // secret, so it is logged verbatim — but flattened to ONE line first.
  // statusFrom() scans every line of this file, so an embedded newline carrying
  // the literal '[rotate] DONE ok' would forge a terminal success status for a
  // rotation that never happened.
  const flatReason = String(reason || '(none given)').replace(/[\r\n]+/g, ' ').trim();
  fs.writeFileSync(logPath, `[rotate] reason: ${flatReason}\n`);
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

/**
 * Status comes from the CLI's single terminal sentinel, never from guessing at
 * words in the log. The old substring match ("verified", "VERIFY FAILED",
 * "Error") matched none of the preflight refusal messages, so a correctly
 * refused rotation polled as 'running' forever while the page showed a mask for
 * a secret that was never touched.
 *
 * 'aborted' is distinct from 'failed' on purpose: it means nothing changed.
 */
// startsWith, not includes: the CLI always emits its sentinel at column 0, and
// the operator-typed reason shares this file. Substring matching let a reason
// mentioning the sentinel anywhere on its line forge a terminal status — which
// flattening the reason's newlines alone does NOT fix, since the forged text
// survives on the reason line. Both guards are required.
function statusFrom(lines) {
  for (const line of lines) {
    if (line.startsWith('[rotate] DONE ok')) return 'done';
    if (line.startsWith('[rotate] DONE failed')) return 'failed';
    if (line.startsWith('[rotate] DONE aborted')) return 'aborted';
  }
  return 'running';
}

router.get('/runs/:runId', (req, res) => {
  if (!/^[0-9a-f-]{36}$/.test(req.params.runId)) {
    return res.status(400).json({ error: 'invalid runId' });
  }
  const logPath = path.join(RUN_DIR, `${req.params.runId}.log`);
  if (!fs.existsSync(logPath)) return res.status(404).json({ error: 'run not found' });
  const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
  const status = statusFrom(lines);
  // Liveness backstop. The DONE sentinel is the only terminal signal, so a child
  // that dies BEFORE it can print one — a require-time crash, an OOM kill —
  // leaves a log nothing will ever append to and the page polls 'running'
  // forever. mtime is the cheapest liveness proxy: the CLI logs a line at every
  // step, so a silent log is a dead process, not a slow one.
  // ...except while the CLI is inside its one legitimately-silent step:
  // applyRestart logs `recreating: <services>` and then BLOCKS in
  // run-docker.sh for potentially minutes with nothing to say. Crying
  // "process died" there — mid-recreate, post-rotate — is the worst possible
  // false positive. Scoped to the last line so a run that got past the
  // recreate is still covered.
  const inRestart = /^\[rotate\] recreating: /.test(lines[lines.length - 1] || '');
  if (status === 'running' && !inRestart
      && Date.now() - fs.statSync(logPath).mtimeMs > STALE_RUN_MS) {
    return res.json({
      status: 'failed',
      lines: lines.concat(
        `[rotate] no output for over ${STALE_RUN_MS / 1000}s and no DONE line — `
        + 'the rotation process appears to have died without reporting.',
      ),
    });
  }
  res.json({ status, lines });
});

module.exports = router;
