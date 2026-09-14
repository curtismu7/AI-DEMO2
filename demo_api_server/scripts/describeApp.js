#!/usr/bin/env node
'use strict';

// Prints one PingOne app as JSON for the rotation CLI. Never prints a secret.
const { listApplicationsRaw } = require('../services/agentBuilderService');

(async () => {
  const appId = process.argv[2];
  if (!appId) { console.error('usage: describeApp.js <appId>'); process.exit(1); }
  const app = (await listApplicationsRaw()).find((a) => a.id === appId);
  if (!app) { console.error(`app ${appId} not found`); process.exit(1); }
  process.stdout.write(JSON.stringify({
    id: app.id,
    clientId: app.clientId,
    name: app.name,
    tokenEndpointAuthMethod: app.tokenEndpointAuthMethod || null,
  }));
})().catch((err) => { console.error(err.message); process.exit(1); });
