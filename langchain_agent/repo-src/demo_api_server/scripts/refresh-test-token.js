#!/usr/bin/env node
'use strict';
// NO SQLITE — reads sessions from the LMDB store (data/persistent/lmdb, DB
// 'sessions', entries { sess, expire }; sess already JSON-decoded).
const { open } = require('lmdb');
const path = require('path');
const fs = require('fs');

try {
  const env = open({ path: path.join(__dirname, '..', 'data', 'persistent', 'lmdb'), maxDbs: 16, encoding: 'json', readOnly: true });
  const sdb = env.openDB('sessions', { encoding: 'json' });
  const rows = [];
  for (const { value } of sdb.getRange()) {
    if (value && value.sess) rows.push({ sess: JSON.stringify(value.sess) });
  }
  env.close();
  const now = Math.floor(Date.now() / 1000);
  let best = null;
  let bestExp = 0;

  for (const row of rows) {
    try {
      const sess = JSON.parse(row.sess);
      const tok = sess.oauthTokens && sess.oauthTokens.accessToken;
      if (!tok) continue;
      const parts = tok.split('.');
      if (parts.length < 2) continue;
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
      if (payload.exp > now && payload.exp > bestExp) {
        bestExp = payload.exp;
        best = { token: tok, exp: new Date(payload.exp * 1000).toISOString(), sub: payload.sub };
      }
    } catch (_) {}
  }

  if (best) {
    console.log('Found valid token: sub=' + best.sub + ' exp=' + best.exp);
    const out = [
      '# Auto-refreshed from sessions.db',
      '# sub: ' + best.sub,
      '# exp: ' + best.exp,
      '',
      'INTEGRATION_SUBJECT_ACCESS_TOKEN=' + best.token,
      'RUN_LIVE_TESTS=true',
      'RUN_PINGONE_TOKEN_INTEGRATION=true',
      '',
    ].join('\n');
    const dest = path.join(__dirname, '..', '.env.test-tokens');
    fs.writeFileSync(dest, out);
    console.log('Written to .env.test-tokens');
  } else {
    console.log('No valid sessions found — login in the browser first, then re-run this script.');
    process.exit(1);
  }
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}
