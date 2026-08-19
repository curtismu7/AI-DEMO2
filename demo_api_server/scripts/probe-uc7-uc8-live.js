'use strict';
/**
 * UC7 / UC8 LIVE BASELINE — capture what the running stack actually does for a
 * $600 transfer (expect step-up) and a $300 transfer (expect HITL consent),
 * BEFORE phase 4 changes the PDP.
 *
 * Read-only in intent: both amounts are expected to be BLOCKED by a challenge,
 * so no money should move. A $100 control is deliberately NOT run — that one
 * would succeed and mutate balances.
 */
const path = require('path');
const API_ROOT = '/Users/cmuir/Development/AI-DEMO2/demo_api_server';
require(path.join(API_ROOT, 'scripts/loadDemoEnv')).loadDemoEnv();

const axios = require(path.join(API_ROOT, 'node_modules/axios'));
const https = require('https');
const agent = new https.Agent({ rejectUnauthorized: false });

const BASE = process.env.E2E_BASE_URL || 'https://api.ping.demo:3001';

(async () => {
  const { resolveSession } = require(path.join(API_ROOT, 'tests/real/helpers/session'));
  const s = await resolveSession('enduser');
  // resolveSession returns the Cookie header string itself.
  const cookie = typeof s === 'string' ? s : (s && (s.cookie || s.sessionCookie));
  console.log('session:', cookie ? `acquired (${String(cookie).split('=')[0]})` : 'NONE');
  if (!cookie) { console.log(JSON.stringify(s).slice(0, 200)); process.exit(1); }

  // Find the caller's own accounts so the transfer is self-consistent.
  const accts = await axios.get(`${BASE}/api/accounts/my`, {
    headers: { Cookie: cookie }, httpsAgent: agent, validateStatus: () => true,
  });
  console.log('accounts HTTP', accts.status);
  const list = Array.isArray(accts.data) ? accts.data : (accts.data && accts.data.accounts) || [];
  console.log('accounts found:', list.length);
  if (list.length < 2) { console.log('need 2 accounts, got', list.length); process.exit(1); }
  const from = list[0].id || list[0].accountId;
  const to = list[1].id || list[1].accountId;
  console.log('from', from, '-> to', to);

  for (const amount of [600, 300]) {
    const r = await axios.post(`${BASE}/api/transactions`, {
      type: 'transfer', amount, fromAccountId: from, toAccountId: to,
      description: `UC baseline probe $${amount}`,
    }, { headers: { Cookie: cookie, 'Content-Type': 'application/json' }, httpsAgent: agent, validateStatus: () => true });

    const b = r.data || {};
    console.log(`\n=== $${amount} ===`);
    console.log('HTTP', r.status);
    console.log('error:', b.error || '(none)');
    console.log('decision:', b.decision || b.authorize?.decision || '(none)');
    console.log('reason:', b.reason || b.authorize?.reason || '(none)');
    const obl = b.obligations || b.authorize?.obligations || b.authorize?.statements;
    console.log('obligations/statements:', obl ? JSON.stringify(obl) : '(none)');
    console.log('challenge fields:', JSON.stringify({
      need_step_up: b.need_step_up, stepUpRequired: b.stepUpRequired,
      consentRequired: b.consentRequired, challengeId: b.challengeId ? 'present' : undefined,
    }));
  }
})().catch((e) => { console.log('FATAL:', e.message); process.exit(1); });
