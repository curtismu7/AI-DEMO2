import assert from 'node:assert/strict';
import test from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';

import { GROQ_DIRECT_URL, fromGroqResponse, groqClient, toGroqRequest } from '../src/groq.js';

const TOOL: Anthropic.Tool = {
  name: 'list_grants',
  description: 'List grants for a user.',
  input_schema: { type: 'object', properties: { user: { type: 'string' } }, required: ['user'] },
};
const ask = { model: 'llama-test', max_tokens: 16, messages: [{ role: 'user' as const, content: 'hi' }] };
const okReply = (text = 'ok') => new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }), { status: 200 });
// A call that never answers, but honours its abort signal like a real fetch.
// A stalled request. AbortSignal.timeout timers do not keep the event loop alive on Node 22 (CI's version),
// and a fake fetch has no socket to do it either, so hold the loop open until the request is aborted.
const hangs = (signal?: AbortSignal | null) => new Promise<Response>((_resolve, reject) => {
  const keepAlive = setTimeout(() => undefined, 60_000);
  signal?.addEventListener('abort', () => { clearTimeout(keepAlive); reject(signal.reason); });
});

test('a tool call and its result round-trip through Groq in OpenAI format, with a Bearer key', async () => {
  const requests: { url: string; auth: string | null; body: any }[] = [];
  const replies = [
    { choices: [{ message: { content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'list_grants', arguments: '{"user":"carol"}' } }] }, finish_reason: 'tool_calls' }] },
    { choices: [{ message: { content: 'Carol has one grant.' }, finish_reason: 'stop' }] },
  ];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), auth: new Headers(init?.headers).get('authorization'), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(replies[requests.length - 1]), { status: 200 });
  }) as typeof fetch;
  const client = groqClient({ apiKey: 'groq-key', fetchImpl });

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: 'Who has access?' }];
  const first = await client.messages.create({ model: 'llama-test', max_tokens: 100, system: 'Be brief.', tools: [TOOL], tool_choice: { type: 'auto', disable_parallel_tool_use: true }, messages });
  assert.equal(first.stop_reason, 'tool_use');
  const call = first.content[0] as Anthropic.ToolUseBlock;
  assert.deepEqual([call.type, call.id, call.name, call.input], ['tool_use', 'call_1', 'list_grants', { user: 'carol' }]);

  messages.push({ role: 'assistant', content: first.content });
  messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'grant: prod-db' }] });
  const second = await client.messages.create({ model: 'llama-test', max_tokens: 100, system: 'Be brief.', tools: [TOOL], messages });
  assert.equal(second.stop_reason, 'end_turn');
  assert.equal((second.content[0] as Anthropic.TextBlock).text, 'Carol has one grant.');

  // The request goes direct to Groq's OpenAI-compatible endpoint with the key as a Bearer token.
  assert.equal(requests[0]!.url, `${GROQ_DIRECT_URL}/chat/completions`);
  assert.equal(requests[0]!.auth, 'Bearer groq-key');
  assert.equal(requests[0]!.body.model, 'llama-test');
  assert.deepEqual(requests[0]!.body.messages[0], { role: 'system', content: 'Be brief.' });
  assert.deepEqual(requests[0]!.body.tools[0], { type: 'function', function: { name: 'list_grants', description: 'List grants for a user.', parameters: TOOL.input_schema } });
  assert.equal(requests[0]!.body.tool_choice, 'auto');
  assert.equal(requests[0]!.body.parallel_tool_calls, false);
  // The second request carries the assistant tool call and the tool result in OpenAI shape.
  const sent = requests[1]!.body.messages;
  assert.deepEqual(sent[2], { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'list_grants', arguments: '{"user":"carol"}' } }] });
  assert.deepEqual(sent[3], { role: 'tool', tool_call_id: 'call_1', content: 'grant: prod-db' });
});

test('tool arguments that are not valid JSON become an empty input, not a crash', () => {
  const reply = fromGroqResponse({ choices: [{ message: { tool_calls: [{ id: 'c', function: { name: 'list_grants', arguments: '{not json' } }] } }] }, 'm');
  assert.deepEqual((reply.content[0] as Anthropic.ToolUseBlock).input, {});
  assert.equal(reply.stop_reason, 'tool_use');
});

test('a tool error result is passed on as an error, and no tools means no tool fields', () => {
  const request = toGroqRequest({
    model: 'm', max_tokens: 1,
    messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c', content: 'denied', is_error: true }] }],
  });
  assert.deepEqual((request.messages as any[])[0], { role: 'tool', tool_call_id: 'c', content: '{"error":"denied"}' });
  assert.equal('tools' in request, false);
});

test('a reply cut off by the token limit is reported as max_tokens', () => {
  const reply = fromGroqResponse({ choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] }, 'm');
  assert.equal(reply.stop_reason, 'max_tokens');
});

test('an error status says it came from Groq with the status, so a 429 reads as a quota problem', async () => {
  const fetchImpl = (async () => new Response('{"error":{"message":"Rate limit reached","type":"rate_limit_exceeded"}}', { status: 429 })) as typeof fetch;
  const client = groqClient({ apiKey: 'k', fetchImpl });

  await assert.rejects(client.messages.create(ask), /Groq request returned 429: .*Rate limit reached/);
});

test('a stalled call hits its deadline and the retry answers', async () => {
  let calls = 0;
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => (++calls === 1 ? hangs(init?.signal) : okReply())) as typeof fetch;
  const client = groqClient({ apiKey: 'k', fetchImpl, timeoutMs: 40, retryDelayMs: 1 });

  const reply = await client.messages.create(ask);

  assert.equal(calls, 2);
  assert.equal((reply.content[0] as Anthropic.TextBlock).text, 'ok');
});

test('two stalled calls give up with a plain message, and the caller aborting is not retried', async () => {
  let calls = 0;
  const hanging = (async (_url: unknown, init?: RequestInit) => { calls += 1; return hangs(init?.signal); }) as typeof fetch;

  await assert.rejects(
    groqClient({ apiKey: 'k', fetchImpl: hanging, timeoutMs: 40, retryDelayMs: 1 }).messages.create(ask),
    (error: Error) => /did not answer within 0\.04 s, after two tries/.test(error.message) && !/aborted/i.test(error.message),
  );
  assert.equal(calls, 2);

  calls = 0;
  const run = groqClient({ apiKey: 'k', fetchImpl: hanging, timeoutMs: 5_000, retryDelayMs: 1 }).messages.stream(ask);
  run.controller.abort();
  await assert.rejects(run.finalMessage());
  assert.equal(calls, 1);
});

test('one overloaded reply (503) is retried', async () => {
  const statuses = [503, 200];
  const fetchImpl = (async () => (statuses.shift() === 503 ? new Response('busy', { status: 503 }) : okReply())) as typeof fetch;

  const reply = await groqClient({ apiKey: 'k', fetchImpl, retryDelayMs: 1 }).messages.create(ask);

  assert.equal((reply.content[0] as Anthropic.TextBlock).text, 'ok');
  assert.equal(statuses.length, 0);
});

test('the stream form delivers the text to listeners, as the agents use it', async () => {
  const client = groqClient({ apiKey: 'k', fetchImpl: (async () => okReply('hello')) as typeof fetch });
  const heard: string[] = [];

  const run = client.messages.stream(ask);
  run.on('text', text => heard.push(text));
  await run.finalMessage();

  assert.deepEqual(heard, ['hello']);
});
