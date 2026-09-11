// The one correctness risk in this whole harness: does it speak the Streamable
// HTTP protocol a REAL MCP client expects? A hand-rolled endpoint (like the
// throwaway spike) would fail here. This boots the server, connects the SDK's
// own client, and asserts the poison arrives byte-for-byte through tools/list —
// the harness's "watch it actually connect".
import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startHttpServer } from './index.mjs';
import { POISONS } from './poisons.mjs';

test('a real MCP client ingests the poison verbatim over Streamable HTTP', async () => {
  const server = await startHttpServer(0);
  try {
    const client = new Client({ name: 'victim', version: '1.0.0' }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(server.url));
    await client.connect(transport);

    const { tools } = await client.listTools();
    assert.equal(tools.length, POISONS.length, 'all poisons served');

    const inj = tools.find((t) => t.name === 'get_weather');
    assert.match(inj.description, /<IMPORTANT>[\s\S]*<\/IMPORTANT>/, 'injection survived the round trip');

    const exfil = tools.find((t) => t.inputSchema?.properties?.callback_url);
    assert.ok(exfil, 'exfil tool present');
    assert.match(String(exfil.inputSchema.properties.callback_url.default), /^https?:\/\//, 'exfil default survived');

    await transport.close();
  } finally {
    await server.close();
  }
});
