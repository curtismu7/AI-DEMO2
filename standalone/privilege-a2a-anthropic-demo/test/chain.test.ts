import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runChain, type ChainEvent } from '../src/main-agent/chain.js';

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const CARD = {
  name: 'langchainagent',
  description: 'Middle agent',
  protocolVersion: '0.3.0',
  version: '1.0.0',
  url: 'https://direct.example/a2a/jsonrpc',
  preferredTransport: 'JSONRPC',
  capabilities: { streaming: false, pushNotifications: true, extensions: [] },
  defaultInputModes: ['text'],
  defaultOutputModes: ['text'],
  skills: [{ id: 'banking_assistant', name: 'Banking assistant', description: 'Answers banking questions.', tags: ['banking'] }],
  securitySchemes: { customerOAuth: { oauth2: { flows: {} } } },
  securityRequirements: [{ customerOAuth: ['agent:invoke'] }],
};

/**
 * Run the chain against `callImpl`, which answers the A2A call. The card
 * request that comes first is answered by `cardImpl`. `events` are the hop
 * events; the card event is returned apart, as `cards`.
 */
async function run(
  callImpl: typeof fetch,
  cardImpl: typeof fetch = async () => jsonResponse(200, CARD),
): Promise<{ events: ChainEvent[]; cards: ChainEvent[]; answer?: string; error?: string }> {
  const all: ChainEvent[] = [];
  const fetchImpl: typeof fetch = (url, init) =>
    (String(url).endsWith('/.well-known/agent-card.json') ? cardImpl(url, init) : callImpl(url, init));
  const split = () => ({ events: all.filter(event => event.kind !== 'card'), cards: all.filter(event => event.kind === 'card') });
  try {
    const answer = await runChain({
      url: 'https://gateway.example/langchainagent/a2a/jsonrpc',
      bearer: 'primary-key',
      message: 'Refund order 7',
      specialist: 'refunds',
      emit: event => all.push(event),
      fetchImpl,
    });
    return { ...split(), answer };
  } catch (error) {
    return { ...split(), error: (error as Error).message };
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
    'delegate:main>langchainagent',
    'delegate:langchainagent>refunds',
    'result:refunds>langchainagent',
    'result:langchainagent>main',
  ]);
  assert.equal(events[1].elapsedMs, 42);
  // What crossed each hop is reported, with the agent key masked.
  assert.match(events[0].request ?? '', /^POST https:\/\/gateway\.example\/langchainagent\/a2a\/jsonrpc/);
  assert.match(events[0].request ?? '', /"text": "Refund order 7"/);
  assert.doesNotMatch(events[0].request ?? '', /Bearer primary-key\b(?!…)/);
  assert.equal(events[1].detail, 'Refund order 7');
  assert.equal(events[2].detail, 'Refund approved');
  assert.match(events[3].response ?? '', /^HTTP 200/);
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
  assert.deepEqual(path(events), ['delegate:main>langchainagent', 'error:langchainagent>refunds']);
});

test('a refusal at the first hop is attributed to the main agent call', async () => {
  const { events, error } = await run(async () => new Response('Forbidden\n', { status: 403 }));

  assert.equal(error, 'Forbidden');
  assert.deepEqual(path(events), ['delegate:main>langchainagent', 'error:main>langchainagent']);
  assert.match(events[1].detail ?? '', /^403: Forbidden/);
});

test('the main agent reads the middle agent\'s card through the gateway before calling', async () => {
  let asked: { url: string; headers: Headers } | undefined;
  const { cards, answer } = await run(
    async () => jsonResponse(200, { jsonrpc: '2.0', result: { parts: [{ kind: 'text', text: 'ok' }] } }),
    async (url, init) => {
      asked = { url: String(url), headers: new Headers(init?.headers) };
      return jsonResponse(200, CARD);
    },
  );

  assert.equal(answer, 'ok');
  assert.equal(asked?.url, 'https://gateway.example/langchainagent/a2a/.well-known/agent-card.json');
  assert.equal(asked?.headers.get('authorization'), 'Bearer primary-key');
  assert.equal(cards.length, 1);
  assert.deepEqual(cards[0].card, {
    name: 'langchainagent',
    description: 'Middle agent',
    protocolVersion: '0.3.0',
    url: 'https://direct.example/a2a/jsonrpc',
    preferredTransport: 'JSONRPC',
    skills: ['Banking assistant'],
    version: '1.0.0',
    capabilities: ['streaming: no', 'pushNotifications: yes'],
    inputModes: ['text'],
    outputModes: ['text'],
    skillDetails: [{ id: 'banking_assistant', name: 'Banking assistant', description: 'Answers banking questions.', tags: ['banking'] }],
    security: ['customerOAuth (oauth2), scopes: agent:invoke'],
  });
  assert.equal(cards[0].wire?.status, 200);
  assert.match(cards[0].credential ?? '', /masked/);
  assert.match(cards[0].response ?? '', /^HTTP 200/);
});

test('a card that cannot be read is reported and the chain still runs', async () => {
  const { cards, events, answer } = await run(
    async () => jsonResponse(200, { jsonrpc: '2.0', result: { parts: [{ kind: 'text', text: 'ok' }] } }),
    async () => new Response('Forbidden\n', { status: 403 }),
  );

  assert.equal(answer, 'ok');
  assert.equal(cards[0].card, undefined);
  assert.match(cards[0].detail ?? '', /HTTP 403/);
  assert.deepEqual(path(events), ['delegate:main>langchainagent', 'result:langchainagent>main']);
});

test('display labels appear only with a vertical profile, and the keys never change', async () => {
  const hops = [
    { from: 'langchainagent', to: 'refunds', status: 'ok', detail: '' },
    { from: 'langchainagent', to: 'restricted', status: 'refused', detail: 'denied' },
  ];
  const reply = async () => jsonResponse(200, { jsonrpc: '2.0', result: { parts: [{ kind: 'text', text: 'ok' }], metadata: { hops } } });
  const chain = async (profile?: { vertical: string; agentName: string; specialistName: string; tools: string[]; subtaskHint: string }) => {
    const events: ChainEvent[] = [];
    await runChain({
      url: 'https://gateway.example/langchainagent/a2a/jsonrpc',
      bearer: 'k',
      message: 'm',
      specialist: 'refunds',
      emit: event => events.push(event),
      fetchImpl: (url, init) => (String(url).endsWith('/.well-known/agent-card.json') ? Promise.resolve(jsonResponse(200, CARD)) : reply()),
      profile,
    });
    return events;
  };

  const plain = await chain();
  assert.ok(plain.every(event => !('fromLabel' in event) && !('toLabel' in event)), 'no profile means no label fields');

  const labelled = await chain({ vertical: 'banking', agentName: 'Super Banking agent', specialistName: 'Investment Advisor', tools: ['get_portfolio_summary'], subtaskHint: 'x' });
  assert.deepEqual(path(labelled), path(plain), 'keys and routes are unchanged');
  const pair = (kind: string, from: string) => {
    const event = labelled.find(candidate => candidate.kind === kind && candidate.from === from)!;
    return [event.fromLabel, event.toLabel];
  };
  assert.deepEqual(pair('card', 'main'), ['Super Banking agent', 'LangChain agent']);
  assert.deepEqual(pair('delegate', 'langchainagent'), ['LangChain agent', 'Investment Advisor']);
  assert.deepEqual(pair('error', 'langchainagent'), ['LangChain agent', 'Ungranted Investment Advisor']);
  assert.deepEqual(pair('result', 'langchainagent'), ['LangChain agent', 'Super Banking agent']);
});

test('each exchange reports its protocol facts: ids, status, and who delegated to whom', async () => {
  let sentBody: { id: string; params: { message: { messageId: string } } } | undefined;
  const { events } = await run(async (_url, init) => {
    sentBody = JSON.parse(String(init?.body));
    return jsonResponse(200, {
      jsonrpc: '2.0',
      id: sentBody?.id,
      result: { kind: 'message', role: 'agent', messageId: 'reply-1', parts: [{ kind: 'text', text: 'ok' }], metadata: { delegatedTo: 'refunds', delegatedBy: 'langchainagent' } },
    });
  });

  assert.deepEqual(events[0].wire, { rpcId: sentBody?.id, messageId: sentBody?.params.message.messageId, delegateTo: 'refunds' });
  assert.match(events[0].credential ?? '', /masked/);
  assert.deepEqual(events.at(-1)?.wire, { status: 200, rpcId: sentBody?.id, messageId: 'reply-1', kind: 'message', role: 'agent', delegatedTo: 'refunds', delegatedBy: 'langchainagent' });
});

test('a refusal reports its HTTP status and JSON-RPC error code', async () => {
  const { events } = await run(async () => jsonResponse(400, { jsonrpc: '2.0', error: { code: -32600, message: 'request blocked by security policy' } }));

  assert.deepEqual(events.at(-1)?.wire, { status: 400, errorCode: -32600 });
});

test('a middle agent that reports its own hop is passed through: its card, request, reply and refusal', async () => {
  const hopCard = { name: 'Refunds Specialist', description: '', protocolVersion: '0.3.0', url: '', preferredTransport: 'JSONRPC', skills: ['Refund'], version: '', capabilities: [], inputModes: [], outputModes: [], skillDetails: [], security: [] };
  const { events, cards } = await run(async () => jsonResponse(200, {
    jsonrpc: '2.0',
    result: {
      parts: [{ kind: 'text', text: 'Refund approved' }],
      metadata: { hops: [
        { kind: 'card', from: 'langchainagent', to: 'refunds', status: 'ok', detail: 'Agent Card for Refunds Specialist', card: hopCard, request: 'GET https://gw/refunds/card', response: 'HTTP 200', wire: { status: 200 }, credential: 'sk-orion-b164… (masked)' },
        { from: 'langchainagent', to: 'refunds', status: 'ok', detail: '', elapsedMs: 42, message: 'Refund order 7', reply: 'Refund approved', request: 'POST https://gw/refunds/a2a/jsonrpc', response: 'HTTP 200', credential: 'sk-orion-b164… (masked)', wire: { rpcId: 'rpc-2', messageId: 'msg-2', status: 200, replyMessageId: 'reply-2', kind: 'message', role: 'agent' } },
      ] },
    },
  }));

  // `run` returns card events apart: the main agent's own, then the middle agent's.
  assert.deepEqual(path(cards), ['card:main>langchainagent', 'card:langchainagent>refunds']);
  assert.equal(cards[1].card?.name, 'Refunds Specialist');
  assert.equal(cards[1].request, 'GET https://gw/refunds/card');
  assert.deepEqual(path(events), ['delegate:main>langchainagent', 'delegate:langchainagent>refunds', 'result:refunds>langchainagent', 'result:langchainagent>main']);
  assert.deepEqual(events[1].wire, { rpcId: 'rpc-2', messageId: 'msg-2' });
  assert.equal(events[1].request, 'POST https://gw/refunds/a2a/jsonrpc');
  assert.equal(events[1].credential, 'sk-orion-b164… (masked)');
  assert.deepEqual(events[2].wire, { status: 200, rpcId: 'rpc-2', messageId: 'reply-2', kind: 'message', role: 'agent' });
  assert.equal(events[2].response, 'HTTP 200');
});

test('a refused second hop reports the message that was sent as well as the reason', async () => {
  const { events, cards } = await run(async () => jsonResponse(502, {
    jsonrpc: '2.0',
    error: { code: -32003, message: 'Delegation failed', data: { hops: [
      { kind: 'card', from: 'langchainagent', to: 'restricted', status: 'unavailable', detail: 'No Agent Card returned (HTTP 403)', wire: { status: 403 } },
      { from: 'langchainagent', to: 'restricted', status: 'refused', detail: 'restricted refused (403): Forbidden', message: 'Refund order 7', request: 'POST https://gw/restricted', response: 'HTTP 403', wire: { rpcId: 'rpc-3', messageId: 'msg-3', status: 403 } },
    ] } },
  }));

  const card = cards.find(event => event.to === 'restricted');
  assert.equal(card?.card, undefined);
  assert.match(card?.detail ?? '', /HTTP 403/);
  const refusal = events.at(-1);
  assert.equal(refusal?.kind, 'error');
  assert.equal(refusal?.message, 'Refund order 7');
  assert.equal(refusal?.request, 'POST https://gw/restricted');
  assert.deepEqual(refusal?.wire, { status: 403, rpcId: 'rpc-3', messageId: 'msg-3' });
});
