#!/usr/bin/env node
/**
 * provision-private-key-jwt-exchanger.js — create/patch the dedicated PingOne
 * application that authenticates with private_key_jwt (RFC 7521/7523) and performs
 * the RFC 8693 token exchange, then register its public JWK set.
 *
 * Pairs with scripts/gen-exchanger-jwt-key.js: run that first, paste the printed
 * JWK Set below (or pass --jwks-file), then run THIS script inside the BFF
 * container (it has the management credentials):
 *   docker exec ai-demo-api-server node scripts/provision-private-key-jwt-exchanger.js \
 *     --jwks-file /tmp/exchanger-jwks.json [--apply]
 *
 * Dry run by default; --apply writes. Creates or patches only:
 *   - the application (type WEB_APP, grants TOKEN_EXCHANGE + CLIENT_CREDENTIALS,
 *     tokenEndpointAuthMethod PRIVATE_KEY_JWT, enabled)
 *   - its JWKS (the public half — never the private key)
 *
 * After --apply, store on the BFF configStore (or env):
 *   pingone_private_key_jwt_exchanger_client_id ← the app's id
 *   pingone_private_key_jwt_exchanger_private_key ← PKCS#8 PEM from the gen step
 *   pingone_private_key_jwt_exchanger_kid ← the kid from the gen step
 * Then flip ff_private_key_jwt_token_exchange = true.
 */
const fs = require('fs');
const axios = require('axios');
const configStore = require('../services/configStore');
const { getManagementToken } = require('../services/pingOneClientService');

const APP_NAME = 'Private Key JWT Exchanger';
const DESCRIPTION = 'Dedicated RFC 8693 token-exchange app authenticating with private_key_jwt (RFC 7523). Created by provision-private-key-jwt-exchanger.js.';
const GRANTS = ['TOKEN_EXCHANGE', 'CLIENT_CREDENTIALS'];

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const jwksIdx = args.indexOf('--jwks-file');

(async () => {
  if (typeof configStore.ensureInitialized === 'function') await configStore.ensureInitialized();
  const envId = configStore.getEffective('PINGONE_ENVIRONMENT_ID');
  const region = configStore.getEffective('PINGONE_REGION') || 'com';
  if (!envId) throw new Error('PINGONE_ENVIRONMENT_ID is required');

  let jwks = null;
  if (jwksIdx > -1 && args[jwksIdx + 1]) {
    jwks = JSON.parse(fs.readFileSync(args[jwksIdx + 1], 'utf8'));
    if (!jwks.keys || !Array.isArray(jwks.keys)) throw new Error('--jwks-file must hold a JWK Set ({ keys: [...] })');
  }

  const base = `https://api.pingone.${region}/v1/environments/${envId}`;
  const opts = { headers: { Authorization: `Bearer ${await getManagementToken()}`, 'Content-Type': 'application/json' }, timeout: 20000 };
  const get = async (path) => (await axios.get(`${base}${path}`, opts)).data;
  const write = async (method, path, body) => {
    console.log(`${apply ? 'APPLY' : 'WOULD'} ${method} ${path}${body?.name ? ` (${body.name})` : ''}`);
    return apply ? (await axios({ method, url: `${base}${path}`, data: body, ...opts })).data : null;
  };
  const embedded = (data, key) => data?._embedded?.[key] || [];

  const apps = embedded(await get(`/applications?limit=200`), 'applications');
  let app = apps.find((a) => a.name === APP_NAME);

  const desired = {
    name: APP_NAME,
    description: DESCRIPTION,
    enabled: true,
    // WEB_APP: WORKER apps can only hold resource grants on 'openid', and the
    // dedicated exchanger needs a grant on the MCP resource (live-learned 2026-10-10).
    type: 'WEB_APP',
    protocol: 'OPENID_CONNECT',
    grantTypes: GRANTS,
    tokenEndpointAuthMethod: 'PRIVATE_KEY_JWT',
  };

  if (app) {
    const drift = [];
    const curGrants = new Set((app.grantTypes || []).map((g) => String(g).toUpperCase()));
    if (!GRANTS.every((g) => curGrants.has(g))) drift.push('grantTypes');
    if (String(app.tokenEndpointAuthMethod || '').toUpperCase() !== 'PRIVATE_KEY_JWT') drift.push('tokenEndpointAuthMethod');
    if (app.enabled !== true) drift.push('enabled');
    if (drift.length) {
      await write('PATCH', `/applications/${app.id}`, {
        grantTypes: GRANTS,
        tokenEndpointAuthMethod: 'PRIVATE_KEY_JWT',
        enabled: true,
      });
    } else {
      console.log(`application exists, no drift: ${APP_NAME} (${app.id})`);
    }
  } else {
    // PingOne rejects a PRIVATE_KEY_JWT create without keys on the body.
    // PingOne's create API takes jwks as the SERIALIZED string, not an object
    if (jwks) desired.jwks = JSON.stringify(jwks);
    app = await write('POST', '/applications', desired);
    console.log(`${apply ? 'created' : 'WOULD create'} application${app?.id ? `: ${app.id}` : ''} — store this id as pingone_private_key_jwt_exchanger_client_id`);
  }

  if (jwks && app) {
    // PingOne stores the client's public keys as the app's JWKS resource.
    const existingJwks = await get(`/applications/${app.id}/jwks`).catch(() => null);
    const haveKeys = existingJwks?.keys || [];
    const wantedKids = jwks.keys.map((k) => k.kid);
    const missing = wantedKids.filter((kid) => !haveKeys.some((k) => k.kid === kid));
    if (missing.length === 0) {
      console.log(`jwks already registered (kids: ${haveKeys.map((k) => k.kid).join(', ')})`);
    } else {
      console.log(`${apply ? 'APPLY' : 'WOULD'} PUT /applications/${app.id}/jwks (registering kids: ${wantedKids.join(', ')})`);
      if (apply) {
        await axios.put(`${base}/applications/${app.id}/jwks`, jwks, opts);
      }
    }
  } else if (!jwks) {
    console.log('NOTE: no --jwks-file passed — the public JWK set is NOT registered. The app will reject assertions until it is.');
  }

  if (apply && app) console.log(`\ndone. client_id=${app.id}\nSet pingone_private_key_jwt_exchanger_client_id=${app.id}, the PEM + kid from gen-exchanger-jwt-key.js, then ff_private_key_jwt_token_exchange=true.`);
  else console.log('dry run: nothing was changed. Re-run with --apply.');
  process.exit(0);
})().catch((error) => {
  console.error('FAILED:', error.response?.status || '', error.response?.data?.message || error.message);
  if (error.response?.data?.details) console.error('DETAILS:', JSON.stringify(error.response.data.details, null, 2));
  process.exit(1);
});
