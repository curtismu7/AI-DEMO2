import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createDiscoveryServer } from '../src/server.mjs';

test('serves read-only inventory and queues bounded scans without tool routes', async (t) => {
  const calls = [];
  const server = createDiscoveryServer({
    store: { list: async () => [{ id: 'one', status: 'healthy' }], get: async () => ({ id: 'one' }) },
    scan: async () => { calls.push('scan'); return { scanId: 'scan-1' }; },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const inventory = await fetch(`${base}/api/inventory`).then((response) => response.json());
  assert.deepEqual(inventory.records, [{ id: 'one', status: 'healthy' }]);
  const scan = await fetch(`${base}/api/scan`, { method: 'POST', body: JSON.stringify({ credentials: 'secret', tool: 'call' }), headers: { 'content-type': 'application/json' } });
  assert.equal(scan.status, 202);
  assert.equal((await scan.json()).scanId, 'scan-1');
  assert.deepEqual(calls, ['scan']);
  assert.equal((await fetch(`${base}/api/invoke`)).status, 404);
});
