#!/usr/bin/env node
'use strict';

/**
 * rotateClientSecret.js — rotate a PingOne application's secret and update the
 * local configStore in one step.
 *
 * Key behaviors learned the hard way (2026-09-22 rotation):
 *   - POST /applications/{id}/secret IGNORES a posted value and returns a
 *     SERVER-GENERATED secret — capture it from the response, never assume
 *     the posted value took effect.
 *   - The old secret dies immediately; anything caching the old value 401s
 *     until updated (this script updates the local configStore for you).
 *
 * Usage:
 *   node scripts/rotateClientSecret.js <appId> [--key admin_client_secret] [--no-store]
 *
 *   <appId>        PingOne application id (or pass a clientId — resolved via list)
 *   --key          configStore key to update (default: auto-detect admin/user by appId)
 *   --no-store     do not write to the local configStore, just print the new secret
 *
 * To update the CLUSTER configStore after running this, exec the same setConfig
 * inside the pod:
 *   kubectl exec -n <ns> deploy/demo-api-server -- node -e \
 *     "const c=require('/app/services/configStore');(async()=>{await c.ensureInitialized();await c.setConfig({admin_client_secret:'NEW'});process.exit(0)})()"
 */
const axios = require('axios');
const { loadDemoEnv } = require('./loadDemoEnv');

loadDemoEnv();

(async () => {
  const args = process.argv.slice(2);
  const appIdOrClientId = args.find((a) => !a.startsWith('--'));
  const keyFlagIdx = args.indexOf('--key');
  const keyOverride = keyFlagIdx !== -1 ? args[keyFlagIdx + 1] : null;
  const noStore = args.includes('--no-store');
  if (!appIdOrClientId) {
    console.error('usage: rotateClientSecret.js <appId|clientId> [--key <configKey>] [--no-store]');
    process.exit(1);
  }

  const envId = process.env.PINGONE_ENVIRONMENT_ID;
  const clientId = process.env.PINGONE_WORKER_CLIENT_ID;
  const clientSecret = process.env.PINGONE_WORKER_CLIENT_SECRET;
  if (!envId || !clientId || !clientSecret) {
    console.error('missing PINGONE_ENVIRONMENT_ID / PINGONE_WORKER_CLIENT_ID / PINGONE_WORKER_CLIENT_SECRET');
    process.exit(1);
  }

  const token = (await axios.post(
    `https://auth.pingone.com/${envId}/as/token`,
    'grant_type=client_credentials',
    { auth: { username: clientId, password: clientSecret }, timeout: 15000 },
  )).data.access_token;
  const auth = { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 };
  const base = `https://api.pingone.com/v1/environments/${envId}`;

  // Resolve appId from clientId if needed.
  let appId = appIdOrClientId;
  if (!/^[0-9a-f-]{36}$/.test(appIdOrClientId)) {
    const list = await axios.get(`${base}/applications?filter=clientId+eq+"${appIdOrClientId}"`, auth);
    appId = list.data._embedded?.applications?.[0]?.id;
    if (!appId) { console.error(`no app with clientId ${appIdOrClientId}`); process.exit(1); }
  }

  // Rotate. The response's secret is server-generated.
  const rot = (await axios.post(`${base}/applications/${appId}/secret`, {}, auth)).data.secret;
  console.log(`rotated app ${appId} — new secret captured (${rot.length} chars). Store it now; it is shown once.`);

  if (noStore) {
    console.log(rot);
    process.exit(0);
  }

  // Auto-detect the configStore key from which login client points at this app.
  const configStore = require('../services/configStore');
  await configStore.ensureInitialized();
  let key = keyOverride;
  if (!key) {
    for (const [k, idKey] of [['admin_client_secret', 'admin_client_id'], ['user_client_secret', 'user_client_id']]) {
      if (configStore.getEffective(idKey) === appIdOrClientId) { key = k; break; }
    }
  }
  if (!key) {
    console.log('could not auto-detect configStore key (pass --key <key>). New secret:');
    console.log(rot);
    process.exit(0);
  }
  await configStore.setConfig({ [key]: rot });
  console.log(`configStore.${key} updated (len ${(configStore.getEffective(key) || '').length}).`);
  console.log('If a REMOTE stack shares this PingOne env, update its configStore too (see file header for the kubectl one-liner).');
})().catch((err) => {
  console.error(err.response ? `${err.response.status} ${JSON.stringify(err.response.data).slice(0, 200)}` : err.message);
  process.exit(1);
});
