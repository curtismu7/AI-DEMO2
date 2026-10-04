import assert from 'node:assert/strict';
import test from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';

import { geminiClient } from '../src/gemini.js';

const TOOL: Anthropic.Tool = {
  name: 'list_grants',
  description: 'List grants for a user.',
  input_schema: { type: 'object', properties: { user: { type: 'string' } }, required: ['user'] },
};

test('a tool call and its result round-trip through Gemini with the key as x-goog-api-key', async () => {
  const requests: { url: string; key: string | null; body: any }[] = [];
  const replies = [
    { candidates: [{ content: { parts: [{ functionCall: { name: 'list_grants', args: { user: 'carol' } }, thoughtSignature: 'sig-1' }] } }] },
    { candidates: [{ content: { parts: [{ text: 'hidden', thought: true }, { text: 'Carol has one grant.' }] }, finishReason: 'STOP' }] },
  ];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), key: new Headers(init?.headers).get('x-goog-api-key'), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(replies[requests.length - 1]), { status: 200 });
  }) as typeof fetch;
  const client = geminiClient({ apiKey: 'agent-key', baseUrl: 'https://gateway.example/llm/google/', fetchImpl });

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: 'Who has access?' }];
  const first = await client.messages.create({ model: 'gemini-test', max_tokens: 100, system: 'Be brief.', tools: [TOOL], messages });
  assert.equal(first.stop_reason, 'tool_use');
  const call = first.content[0] as Anthropic.ToolUseBlock;
  assert.deepEqual([call.type, call.name, call.input], ['tool_use', 'list_grants', { user: 'carol' }]);

  messages.push({ role: 'assistant', content: first.content });
  messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, content: 'grant: admin' }] });
  const texts: string[] = [];
  const stream = client.messages.stream({ model: 'gemini-test', max_tokens: 100, tools: [TOOL], messages });
  stream.on('text', text => texts.push(text));
  const second = await stream.finalMessage();

  assert.equal(second.stop_reason, 'end_turn');
  assert.deepEqual(texts, ['Carol has one grant.']);
  assert.equal(requests[0].url, 'https://gateway.example/llm/google/v1beta/models/gemini-test:generateContent');
  assert.ok(requests.every(request => request.key === 'agent-key'));
  assert.deepEqual(requests[0].body.systemInstruction, { parts: [{ text: 'Be brief.' }] });
  assert.equal(requests[0].body.tools[0].functionDeclarations[0].name, 'list_grants');
  assert.deepEqual(requests[1].body.contents.map((content: { role: string }) => content.role), ['user', 'model', 'user']);
  assert.deepEqual(requests[1].body.contents[1].parts[0], { functionCall: { name: 'list_grants', args: { user: 'carol' } }, thoughtSignature: 'sig-1' });
  assert.deepEqual(requests[1].body.contents[2].parts[0], { functionResponse: { name: 'list_grants', response: { result: 'grant: admin' } } });
});

test('a refusal from the gateway surfaces its status and body', async () => {
  const fetchImpl = (async () => new Response('{"error":"policy denied"}', { status: 403 })) as typeof fetch;
  const client = geminiClient({ apiKey: 'k', fetchImpl });
  await assert.rejects(
    client.messages.create({ model: 'm', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
    /403.*policy denied/,
  );
});

test('one overloaded reply is retried', async () => {
  const statuses = [503, 200];
  const fetchImpl = (async () => new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }),
    { status: statuses.shift() },
  )) as typeof fetch;
  const client = geminiClient({ apiKey: 'k', fetchImpl, retryDelayMs: 1 });
  const reply = await client.messages.create({ model: 'm', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(reply.content.length, 1);
  assert.equal(statuses.length, 0);
});
