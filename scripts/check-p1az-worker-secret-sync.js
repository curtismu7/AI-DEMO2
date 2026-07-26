#!/usr/bin/env node
// scripts/check-p1az-worker-secret-sync.js
'use strict';

/**
 * Fail when ping-gateway/.env P1AZ_WORKER_CLIENT_SECRET drifts from the BFF
 * worker secret. Stale gateway credentials make UC1 Incomplete at authorize
 * while the BFF Authorize path can still PERMIT.
 *
 * Never prints secret values — only lengths / mismatch.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function loadEnv(file) {
  if (!fs.existsSync(file)) return null;
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\n/)) {
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    let k = line.slice(0, i).trim();
    let v = line.slice(i + 1);
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function main() {
  const apiEnv = loadEnv(path.join(ROOT, 'demo_api_server/.env'));
  const gwEnv = loadEnv(path.join(ROOT, 'ping-gateway/.env'));
  if (!apiEnv || !gwEnv) {
    console.log('[p1az-secret-sync] skip — .env missing (api=%s gw=%s)', !!apiEnv, !!gwEnv);
    return 0;
  }

  const apiSecret =
    apiEnv.PINGONE_AUTHORIZE_WORKER_CLIENT_SECRET || apiEnv.PINGONE_WORKER_CLIENT_SECRET || '';
  const gwSecret = gwEnv.P1AZ_WORKER_CLIENT_SECRET || '';
  const apiId = apiEnv.PINGONE_AUTHORIZE_WORKER_CLIENT_ID || apiEnv.PINGONE_WORKER_CLIENT_ID || '';
  const gwId = gwEnv.P1AZ_WORKER_CLIENT_ID || '';

  if (!apiSecret || !gwSecret) {
    console.log('[p1az-secret-sync] skip — secret not set on both sides');
    return 0;
  }

  if (apiId && gwId && apiId !== gwId) {
    console.error(
      '[p1az-secret-sync] FAIL — worker client id mismatch (api …%s vs gw …%s). '
      + 'Run: cd demo_api_server && node scripts/refresh-service-envs.js',
      String(apiId).slice(-8),
      String(gwId).slice(-8),
    );
    return 1;
  }

  if (apiSecret !== gwSecret) {
    console.error(
      '[p1az-secret-sync] FAIL — P1AZ_WORKER_CLIENT_SECRET out of sync with BFF worker secret '
      + '(api_len=%d gw_len=%d). After rotating PINGONE_WORKER_CLIENT_SECRET, run '
      + '`node demo_api_server/scripts/refresh-service-envs.js` and recreate ping-gateway.',
      apiSecret.length,
      gwSecret.length,
    );
    return 1;
  }

  console.log('[p1az-secret-sync] OK — gateway P1AZ worker secret matches BFF');
  return 0;
}

process.exit(main());
