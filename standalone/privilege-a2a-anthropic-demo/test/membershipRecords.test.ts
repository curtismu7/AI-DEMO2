import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const packageDirectory = fileURLToPath(new URL('..', import.meta.url));

test("demoUser gets their own membership record; others keep the shared one", async () => {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>(resolve => probe.close(() => resolve()));

  const child = spawn(process.execPath, [join(packageDirectory, 'node_modules/tsx/dist/cli.mjs'), 'src/mcp-server/index.ts'], {
    cwd: packageDirectory,
    env: { ...process.env, MCP_SERVER_PORT: String(port), MCP_REQUIRE_BEARER: 'false', MCP_STATEFUL: 'false', MCP_JSON_RESPONSE: 'true' },
    stdio: 'ignore',
  });
  try {
    for (let i = 0; i < 150; i += 1) {
      try { if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) break; } catch { /* not up yet */ }
      await delay(100);
    }
    const client = new Client({ name: 'membership-test', version: '1' }, { capabilities: {} });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    const call = async (args: Record<string, unknown>) => {
      const r = await client.callTool({ name: 'sensitive_membership_details', arguments: args }) as { content: Array<{ text: string }> };
      return JSON.parse(r.content[0]!.text) as { data: { membershipTier: string; renewsOn: string } };
    };
    const mine = await call({ subject: 'demoUser' });
    assert.equal(mine.data.membershipTier, 'Silver');
    assert.equal(mine.data.renewsOn, '2027-02-14');
    const shared = await call({});
    assert.equal(shared.data.membershipTier, 'Gold');
    await client.close();
  } finally {
    child.kill('SIGTERM');
  }
});
