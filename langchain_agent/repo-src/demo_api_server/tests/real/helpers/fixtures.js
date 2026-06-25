// demo_api_server/tests/real/helpers/fixtures.js
'use strict';

const CHECKING_BALANCE = 10000; // $10,000 — large enough no test drains to zero
const SAVINGS_BALANCE  = 5000;  // $5,000

const VERTICAL_FIXTURES = {
  banking:          { chk: 'chk-test-real-banking',        sav: 'sav-test-real-banking',        userId: 'test-real-suite' },
  retail:           { chk: 'chk-test-real-retail',         sav: 'sav-test-real-retail',         userId: 'test-real-suite' },
  'sporting-goods': { chk: 'chk-test-real-sporting-goods', sav: 'sav-test-real-sporting-goods', userId: 'test-real-suite' },
  healthcare:       { chk: 'chk-test-real-healthcare',     sav: 'sav-test-real-healthcare',     userId: 'test-real-suite' },
  workforce:        { chk: 'chk-test-real-workforce',      sav: 'sav-test-real-workforce',      userId: 'test-real-suite' },
  admin:            { chk: 'chk-test-real-admin',          sav: 'sav-test-real-admin',          userId: 'test-real-suite' },
};

async function bootstrapFixtures(adminClient, verticalId) {
  const ids = VERTICAL_FIXTURES[verticalId];
  if (!ids) throw new Error(`Unknown verticalId: ${verticalId}`);

  // Ensure accounts exist — POST if missing, ignore 409
  const chkPayload = { id: ids.chk, userId: ids.userId, accountType: 'checking', name: `Test Checking (${verticalId})`, balance: CHECKING_BALANCE, currency: 'USD' };
  const savPayload = { id: ids.sav, userId: ids.userId, accountType: 'savings',  name: `Test Savings (${verticalId})`,  balance: SAVINGS_BALANCE,  currency: 'USD' };

  const r1 = await adminClient.post('/api/accounts', chkPayload);
  if (r1.status !== 201 && r1.status !== 409 && r1.status !== 200) {
    throw new Error(`bootstrapFixtures(${verticalId}): chk create failed ${r1.status}: ${JSON.stringify(r1.data)}`);
  }

  const r2 = await adminClient.post('/api/accounts', savPayload);
  if (r2.status !== 201 && r2.status !== 409 && r2.status !== 200) {
    throw new Error(`bootstrapFixtures(${verticalId}): sav create failed ${r2.status}: ${JSON.stringify(r2.data)}`);
  }

  return { ...ids, checkingBalance: CHECKING_BALANCE, savingsBalance: SAVINGS_BALANCE };
}

async function restoreBalances(adminClient, verticalId) {
  const ids = VERTICAL_FIXTURES[verticalId];
  if (!ids) throw new Error(`Unknown verticalId: ${verticalId}`);
  await adminClient.put(`/api/accounts/${ids.chk}`, { balance: CHECKING_BALANCE });
  await adminClient.put(`/api/accounts/${ids.sav}`, { balance: SAVINGS_BALANCE });
}

module.exports = { bootstrapFixtures, restoreBalances, VERTICAL_FIXTURES, CHECKING_BALANCE, SAVINGS_BALANCE };
