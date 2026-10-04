import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runChain, type ChainEvent } from '../src/main-agent/chain.js';

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function run(fetchImpl: typeof fetch): Promise<{ events: ChainEvent[]; answer?: string; error?: string }> {
  const events: ChainEvent[] = [];
  try {
    const answer = await runChain({
      url: 'https://gateway.example/langchainagent/a2a/jsonrpc',
      bearer: 'primary-key',
      message: 'Refund order 7',
      specialist: 'refunds',
      emit: event => events.push(event),
      fetchImpl,
    });
    return { events, answer };
  } catch (error) {
    return { events, error: (error as Error).message };
  }
}

const path = (events: ChainEvent[]): string[] => events.map(event => `${event.kind}:${event.from}>${event.to}`);

test('a full chain reports every hop down and back up', async () => {
  let sent: { headers: Headers; body: { params: { metadata: { delegateTo: string } } } } | undefined;
  const { events, answer } = await run(async (_url, init) => {
    sent = { headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) };
    return jsonResponse(200, {
      jsonrpc: '2.0',
      result: {
        parts: [{ kind: 'text', text: 'Refund approved' }],
        metadata: { hops: [{ from: 'langchainagent', to: 'refunds', status: 'ok', detail: '', elapsedMs: 42 }] },
      },
    });
  });

  assert.equal(answer, 'Refund approved');
  assert.equal(sent?.headers.get('authorization'), 'Bearer primary-key');
  assert.equal(sent?.body.params.metadata.delegateTo, 'refunds');
  assert.deepEqual(path(events), [
    'delegate:primary>langchainagent',
    'delegate:langchainagent>refunds',
    'result:refunds>langchainagent',
    'result:langchainagent>primary',
  ]);
  assert.equal(events[1].elapsedMs, 42);
});

test('a refusal at the second hop is attributed to the middle agent', async () => {
  const { events, error } = await run(async () => jsonResponse(502, {
    jsonrpc: '2.0',
    error: {
      code: -32003,
      message: 'Delegation failed: refunds refused (403): Forbidden: key not scoped for a2a access',
      data: { hops: [{ from: 'langchainagent', to: 'refunds', status: 'refused', detail: 'refunds refused (403): Forbidden: key not scoped for a2a access' }] },
    },
  }));

  assert.match(error ?? '', /not scoped for a2a access/);
  assert.deepEqual(path(events), ['delegate:primary>langchainagent', 'error:langchainagent>refunds']);
});

test('a refusal at the first hop is attributed to the primary agent call', async () => {
  const { events, error } = await run(async () => new Response('Forbidden\n', { status: 403 }));

  assert.equal(error, 'Forbidden');
  assert.deepEqual(path(events), ['delegate:primary>langchainagent', 'error:primary>langchainagent']);
  assert.match(events[1].detail ?? '', /^403: Forbidden/);
});
