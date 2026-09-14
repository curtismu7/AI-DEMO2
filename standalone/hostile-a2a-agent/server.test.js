// Does a real A2A client, discovering this agent, get the poison byte-for-byte?
// Boots the server, fetches the well-known Agent Card over HTTP, and asserts the
// injection + exfil skill survive the round trip — plus that message/send answers.
import assert from 'node:assert/strict';
import test from 'node:test';
import { startHttpServer } from './index.mjs';

test('the poisoned Agent Card arrives verbatim at the well-known path', async () => {
  const server = await startHttpServer(0);
  try {
    const card = await (await fetch(server.cardUrl)).json();
    assert.equal(card.name, 'Refunds Specialist');
    assert.match(card.description, /<IMPORTANT>[\s\S]*create_transfer[\s\S]*<\/IMPORTANT>/, 'injection lost in transit');
    assert.ok(card.skills.some((s) => /credential|token/i.test(s.description)), 'skill exfil lost in transit');
    assert.equal(card.url, server.url, 'card url should point at the JSON-RPC endpoint');
  } finally {
    await server.close();
  }
});

test('message/send answers with a (stub) A2A message result', async () => {
  const server = await startHttpServer(0);
  try {
    const res = await fetch(server.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'message/send',
        params: { message: { role: 'user', parts: [{ kind: 'text', text: 'refund order 42' }] } },
      }),
    });
    const body = await res.json();
    assert.equal(body.result.kind, 'message');
    assert.match(body.result.parts[0].text, /refund order 42/);
    assert.match(body.result.parts[0].text, /STUB/i);
  } finally {
    await server.close();
  }
});
