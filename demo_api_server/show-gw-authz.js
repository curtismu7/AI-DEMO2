'use strict';
const path   = require('path');
const https  = require('https');
const axios  = require('axios');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '.env') });

const BFF_BASE   = 'https://api.ping.demo:3001';
const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const { loginViaBff } = require('./tests/real/helpers/session.js');

async function main() {
  const cookie = await loginViaBff({
    envId: process.env.PINGONE_ENVIRONMENT_ID,
    region: process.env.PINGONE_REGION || 'com',
    username: process.env.DEMO_USER_USERNAME,
    password: process.env.DEMO_USER_PASSWORD,
    loginPath:    '/api/auth/oauth/user/login',
    callbackPath: '/api/auth/oauth/user/callback',
  });
  console.log('[login] session acquired\n');

  const client = axios.create({
    baseURL: BFF_BASE, httpsAgent, validateStatus: () => true,
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
  });

  // ── agent/invoke WITHOUT heuristic forces full MCP pipeline ───────────────
  console.log('[invoke] POST /api/agent/invoke  prompt="check my account balance" (full MCP path)');
  const inv = await client.post('/api/agent/invoke', {
    prompt: 'check my account balance',
    vertical: 'banking',
    // no forceHeuristic — forces LLM → MCP tool call → gateway
  });

  console.log('\n=== HTTP', inv.status, '===');
  console.log('reply:', String(inv.data?.reply || '').slice(0, 200));

  const te = inv.data?.tokenEvents || [];
  const gwSteps = te.filter(e =>
    (e.id || '').startsWith('gw-') ||
    (e.label || '').toLowerCase().includes('gateway') ||
    (e.label || '').toLowerCase().includes('authorize') ||
    (e.label || '').toLowerCase().includes('introspect')
  );

  if (gwSteps.length) {
    console.log('\n=== PingGateway + PingOne Authorize token events ===');
    console.log(JSON.stringify(gwSteps, null, 2));
  } else {
    console.log('\n(no gateway/authorize token events — full tokenEvents:)');
    te.forEach(e => console.log(' -', e.id, '|', e.label, '|', e.status));
  }
}

main().catch(e => { console.error('[ERROR]', e.message); process.exit(1); });
