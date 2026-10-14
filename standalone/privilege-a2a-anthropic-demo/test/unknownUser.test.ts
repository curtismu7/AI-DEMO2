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

test('an unknown user gets an empty entitlement list, not user_not_found', async () => {
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
    const client = new Client({ name: 'unknown-user-test', version: '1' }, { capabilities: {} });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    const result = await client.callTool({ name: 'list_entitlements', arguments: { user: 'demoUser' } }) as { content: Array<{ text: string }> };
    const body = JSON.parse(result.content[0]!.text) as { error?: string; entitlements: unknown[]; note?: string };
    assert.equal(body.error, undefined);
    assert.deepEqual(body.entitlements, []);
    assert.match(body.note ?? '', /no grants/);
    await client.close();
  } finally {
    child.kill('SIGTERM');
  }
});
