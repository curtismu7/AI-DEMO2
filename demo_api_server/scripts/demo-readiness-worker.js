#!/usr/bin/env node
'use strict';
/**
 * Standalone readiness worker for ONE target/provider lane.
 *
 * Non-secret lane config is read from DEMO_READINESS_WORKER_* env. Credentials
 * (worker bearer token, identity username/password/subject) are read from the
 * encrypted vault by name; env is used only when no VAULT_PASSWORD is set.
 * Nothing secret is logged. Protocol and limits: docs/demo-readiness.md.
 */
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');

const { createReadinessWorkerHttpService } = require('../services/demoReadinessWorkerServer');
const { loadLaneSettings, createLaneSessionFactory } = require('../services/demoReadinessWorkerRuntime');

async function secretReader(env) {
  if (!env.VAULT_PASSWORD) return (name) => env[name];
  const vaultLib = require('../lib/vault');
  const vaultPath = env.VAULT_PATH || path.resolve(__dirname, '..', '..', 'secrets.vault');
  const vault = await vaultLib.openVault(vaultPath, env.VAULT_PASSWORD, { caller: 'demoReadinessWorker' });
  const values = new Map(vault.list().map((name) => [name, vault.read(name)]));
  vault.close();
  delete env.VAULT_PASSWORD;
  return (name) => values.get(name);
}

async function main(env = process.env) {
  const settings = loadLaneSettings({ env, readSecret: await secretReader(env) });
  const { app, close } = createReadinessWorkerHttpService({
    targetId: settings.targetId,
    provider: settings.provider,
    identityRef: settings.identityRef,
    workerToken: settings.workerToken,
    createSession: createLaneSessionFactory(settings),
  });
  const server = https.createServer({
    cert: fs.readFileSync(env.DEMO_READINESS_WORKER_TLS_CERT),
    key: fs.readFileSync(env.DEMO_READINESS_WORKER_TLS_KEY),
  }, app);
  const port = Number(env.DEMO_READINESS_WORKER_PORT || 4443);
  server.listen(port, () => console.log(`[readiness-worker] ${settings.targetId}/${settings.provider} lane listening on ${port}`));
  const stop = async () => { server.close(); await close?.(); process.exit(0); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (require.main === module) {
  main().catch((error) => { console.error(`[readiness-worker] ${error.message}`); process.exit(1); });
}

module.exports = { main };
