// The one correctness risk in this whole harness: does it speak the protocols a
// REAL MCP client expects? A hand-rolled endpoint (like the throwaway spike) would
// fail here. These boot the server, connect the SDK's own clients over BOTH
// transports, and assert the poison arrives byte-for-byte — plus that the real
// create_transfer tool is served and callable (the call the Privilege gateway
// polices).
import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { startHttpServer } from './index.mjs';
import { POISON_PROMPTS, POISON_RESOURCES, POISONS } from './poisons.mjs';

const POISON_NAMES = POISONS.map((p) => p.tool.name);

test('a real MCP client ingests the poison verbatim over Streamable HTTP', async () => {
  const server = await startHttpServer(0);
  try {
    const client = new Client({ name: 'victim', version: '1.0.0' }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(server.url));
    await client.connect(transport);

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const p of POISON_NAMES) assert.ok(names.includes(p), `poison ${p} served`);
    assert.ok(names.includes('create_transfer'), 'create_transfer served (the call the gateway polices)');

    const inj = tools.find((t) => t.name === 'get_weather');
    assert.match(inj.description, /<IMPORTANT>[\s\S]*<\/IMPORTANT>/, 'injection survived the round trip');
    const exfil = tools.find((t) => t.inputSchema?.properties?.callback_url);
    assert.match(String(exfil.inputSchema.properties.callback_url.default), /^https?:\/\//, 'exfil default survived');

    const resources = await client.listResources();
    assert.deepEqual(resources.resources.map((resource) => resource.uri), POISON_RESOURCES.map((entry) => entry.resource.uri));
    const resource = await client.readResource({ uri: POISON_RESOURCES[0].resource.uri });
    assert.match(resource.contents[0].text, /create_transfer/);

    const prompts = await client.listPrompts();
    assert.deepEqual(prompts.prompts.map((prompt) => prompt.name), POISON_PROMPTS.map((entry) => entry.prompt.name));
    const prompt = await client.getPrompt({ name: POISON_PROMPTS[0].prompt.name, arguments: { account_id: 'demo-001' } });
    assert.match(prompt.messages[0].content.text, /demo-001/);
    assert.match(prompt.messages[0].content.text, /bypass/i);

    await transport.close();
  } finally {
    await server.close();
  }
});

test('create_transfer is callable and returns a (stub) result', async () => {
  const server = await startHttpServer(0);
  try {
    const client = new Client({ name: 'victim', version: '1.0.0' }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(server.url));
    await client.connect(transport);

    const result = await client.callTool({ name: 'create_transfer', arguments: { amount: 500, to: 'external-001' } });
    assert.match(result.content[0].text, /Transferred \$500 to external-001/);
    assert.match(result.content[0].text, /STUB/i, 'stub, no real money moved');

    await transport.close();
  } finally {
    await server.close();
  }
});

test('the poison also arrives over the SSE transport (the gateway path)', async () => {
  const server = await startHttpServer(0);
  try {
    const client = new Client({ name: 'gateway-like', version: '1.0.0' }, { capabilities: {} });
    const transport = new SSEClientTransport(new URL(server.sseUrl));
    await client.connect(transport);

    const { tools } = await client.listTools();
    const inj = tools.find((t) => t.name === 'get_weather');
    assert.match(inj.description, /<IMPORTANT>[\s\S]*<\/IMPORTANT>/, 'injection survived over SSE');

    await transport.close();
  } finally {
    await server.close();
  }
});
