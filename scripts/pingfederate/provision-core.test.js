'use strict';
// Unit checks for the pure guards in provision-core.js: node scripts/pingfederate/provision-core.test.js
const assert = require('node:assert');
const { insecureTlsAllowed, isLiveTarget } = require('./provision-core.js');

for (const ok of ['https://localhost:19999/x', 'https://127.0.0.1:9999/x', 'https://local.ping-devops.com:9999/x', 'https://a.b.ping.demo/x']) {
  assert.strictEqual(insecureTlsAllowed(ok), true, ok);
}
for (const bad of ['https://evil.example.com/x', 'https://ping-devops.com.evil.io/x', 'https://notping-devops.com/x', 'http://10.0.0.5:9999/x', 'not a url', '']) {
  assert.strictEqual(insecureTlsAllowed(bad), false, bad);
}
assert.strictEqual(isLiveTarget('https://localhost:9999/pf-admin-api/v1', 'pf-fresh-pingfederate'), true);
assert.strictEqual(isLiveTarget('https://localhost:19999/pf-admin-api/v1', 'ai-demo-pingfederate'), true);
assert.strictEqual(isLiveTarget('https://localhost:19999/pf-admin-api/v1', 'pf-fresh-pingfederate'), false);
console.log('ok provision-core guards');
