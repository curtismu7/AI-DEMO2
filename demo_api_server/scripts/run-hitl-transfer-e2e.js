#!/usr/bin/env node
'use strict';

/**
 * Live HITL transfer E2E against a running BFF (consent challenge + OTP 123123).
 *
 * Prerequisites:
 *   - BFF listening at https://api.ping.demo:3001 (or set BFF_BASE in constants)
 *   - End-user session in demo_api_server/.test-session.json (from real test globalSetup)
 *     OR HITL_E2E_COOKIE env with a valid connect.sid value
 *
 * Usage:
 *   node scripts/run-hitl-transfer-e2e.js
 *   HITL_E2E_COOKIE='connect.sid=...' node scripts/run-hitl-transfer-e2e.js
 */

const axios = require('axios');
const {
  BFF_BASE,
  httpsAgent,
  createBffClient,
  findAccountId,
} = require('../tests/real/helpers/bffClient');

/** Run the high-value transfer HITL flow end-to-end. */
async function runHitlTransferE2e(client) {
  const acctRes = await client.get('/api/accounts/my');
  if (acctRes.status !== 200) {
    throw new Error(`/api/accounts/my returned ${acctRes.status}`);
  }

  const chkId = findAccountId(acctRes.data.accounts, 'checking');
  const savId = findAccountId(acctRes.data.accounts, 'savings');
  if (!chkId || !savId) {
    throw new Error('Need checking and savings accounts for transfer HITL E2E');
  }

  const amount = 300;
  const payload = {
    type: 'transfer',
    fromAccountId: chkId,
    toAccountId: savId,
    amount,
    description: 'HITL live E2E transfer',
  };

  const blocked = await client.post('/api/transactions', payload);
  if (blocked.status !== 428 || blocked.data?.error !== 'hitl_required') {
    throw new Error(`Expected 428 hitl_required, got ${blocked.status}`);
  }

  const created = await client.post('/api/transactions/consent-challenge', payload);
  if (created.status !== 201 || !created.data?.challengeId) {
    throw new Error(`consent-challenge create failed: ${created.status}`);
  }
  const { challengeId } = created.data;

  const confirmed = await client.post(
    `/api/transactions/consent-challenge/${encodeURIComponent(challengeId)}/confirm`,
  );
  if (confirmed.status !== 200) {
    throw new Error(`consent confirm failed: ${confirmed.status}`);
  }

  const verified = await client.post(
    `/api/transactions/consent-challenge/${encodeURIComponent(challengeId)}/verify-otp`,
    { otp: '123123', otpCode: '123123' },
  );
  if (verified.status !== 200) {
    throw new Error(`verify-otp failed: ${verified.status} ${JSON.stringify(verified.data)}`);
  }

  const completed = await client.post('/api/transactions', {
    ...payload,
    consentChallengeId: challengeId,
  });
  if (completed.status !== 201) {
    throw new Error(`transfer after consent failed: ${completed.status}`);
  }

  return {
    challengeId,
    transferId: completed.data?.id || completed.data?.transaction?.id || null,
  };
}

async function main() {
  let client;
  if (process.env.HITL_E2E_COOKIE) {
    client = axios.create({
      baseURL: BFF_BASE,
      httpsAgent,
      headers: { Cookie: process.env.HITL_E2E_COOKIE },
      validateStatus: () => true,
    });
  } else {
    client = createBffClient('enduser');
  }

  const result = await runHitlTransferE2e(client);
  console.log('[hitl-transfer-e2e] OK', result);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[hitl-transfer-e2e] FAILED:', err.message);
    process.exit(1);
  });
}

module.exports = { runHitlTransferE2e };
