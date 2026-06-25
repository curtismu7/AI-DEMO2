// demo_api_server/tests/real/helpers/reset.js
'use strict';

const { restoreBalances } = require('./fixtures');

async function resetDemo(client) {
  const r = await client.post('/api/admin/reset-demo');
  if (r.status !== 200) throw new Error(`reset-demo failed: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

async function resetSuite(adminClient, verticalId) {
  await resetDemo(adminClient);
  await restoreBalances(adminClient, verticalId);
}

module.exports = { resetDemo, resetSuite };
