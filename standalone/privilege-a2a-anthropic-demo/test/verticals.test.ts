import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { createServer, type AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { VERTICALS, VERTICAL_ALIASES, resolveVertical } from '../src/mcp-server/verticals.js';
import { labelFor, parseProfile, withLabels } from '../src/profile.js';

const require = createRequire(import.meta.url);
const { A2A_SPECIALISTS, specialistDirectory } = require('../../../demo_api_server/config/a2aSpecialists.js') as {
  A2A_SPECIALISTS: Record<string, { specialistName: string; subtaskHint: string; tools: string[] }>;
  specialistDirectory: () => Array<{ vertical: string; canonicalVertical: string }>;
};
const packageDirectory = dirname(dirname(fileURLToPath(import.meta.url)));

test('white-label aliases mirror the registry, and a white-label vertical gets its domain\'s specialist', () => {
  const registryAliases = Object.fromEntries(
    specialistDirectory().filter(entry => entry.vertical !== entry.canonicalVertical).map(entry => [entry.vertical, entry.canonicalVertical]),
  );
  assert.deepEqual(VERTICAL_ALIASES, registryAliases);
  // The worker looks the persona up by resolveVertical(); A&F is retail, so it is the Purchase History Specialist.
  assert.equal(VERTICALS[resolveVertical('abercrombie-fitch')]?.specialistName, 'Purchase History Specialist');
  assert.equal(resolveVertical('banking'), 'banking');
});

test('verticals table mirrors demo_api_server/config/a2aSpecialists.js exactly (all 11)', () => {
  assert.deepEqual(Object.keys(VERTICALS).sort(), Object.keys(A2A_SPECIALISTS).sort());
  assert.equal(Object.keys(VERTICALS).length, 11);
  for (const [vertical, specialist] of Object.entries(A2A_SPECIALISTS)) {
    const mine = VERTICALS[vertical]!;
    assert.equal(mine.specialistName, specialist.specialistName, `${vertical} specialistName`);
    assert.equal(mine.subtaskHint, specialist.subtaskHint, `${vertical} subtaskHint`);
    assert.deepEqual(Object.keys(mine.tools), specialist.tools, `${vertical} tools`);
  }
});

test('the running MCP server registers and serves every vertical tool', async () => {
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
    const client = new Client({ name: 'verticals-test', version: '1' }, { capabilities: {} });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    const names = (await client.listTools()).tools.map(tool => tool.name);
    for (const specialist of Object.values(A2A_SPECIALISTS)) {
      for (const tool of specialist.tools) assert.ok(names.includes(tool), `${tool} registered`);
    }
    const result = await client.callTool({ name: 'sensitive_patient_records', arguments: {} }) as { content: Array<{ text: string }> };
    const body = JSON.parse(result.content[0]!.text) as { sensitiveDataAccessed: boolean; data: { records: Array<{ type: string }> } };
    assert.equal(body.sensitiveDataAccessed, true);
    assert.deepEqual(body.data.records.map(record => record.type), ['diagnosis', 'prescription']);
    await client.close();
  } finally {
    child.kill('SIGTERM');
  }
});

test('profile parsing treats invalid input as absent and labels only with a profile', () => {
  const good = { vertical: 'banking', agentName: 'Super Banking agent', specialistName: 'Investment Advisor', tools: ['get_portfolio_summary'], subtaskHint: 'review positions' };
  const profile = parseProfile(good)!;
  assert.ok(profile);
  assert.equal(parseProfile({}), null);
  assert.equal(parseProfile({ ...good, vertical: 'Bad Vertical' }), null);
  assert.equal(parseProfile({ ...good, tools: ['BAD-TOOL'] }), null);
  assert.equal(parseProfile({ ...good, tools: Array(9).fill('a') }), null);
  assert.equal(parseProfile({ ...good, agentName: 'x'.repeat(121) }), null);
  assert.equal(labelFor(profile, 'mcp'), 'Investment Advisor data tools');
  const event = { from: 'main', to: 'analyst' };
  assert.equal(withLabels(event, null), event);
  assert.deepEqual(withLabels(event, profile), { ...event, fromLabel: 'Super Banking agent', toLabel: 'Investment Advisor' });
});
