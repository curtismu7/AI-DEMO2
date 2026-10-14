import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLlmRequest, readLlmReply, llmPath } from './llm.js';

const msgs = [{ role: 'user', content: 'hi' }];

test('default Ollama URL keeps the native /api/chat request and no auth header', () => {
  const r = buildLlmRequest({ llmUrl: 'http://127.0.0.1:11434', llmModel: 'llama3.2:1b' }, msgs);
  assert.equal(r.url, 'http://127.0.0.1:11434/api/chat');
  assert.equal(r.init.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(r.init.body), { model: 'llama3.2:1b', stream: false, messages: msgs });
});

test('a Privilege lane URL is called OpenAI-compatibly with the bearer key', () => {
  const r = buildLlmRequest({ llmUrl: 'https://gw.example/llm/custom/v1/', llmModel: 'llama.cpp' }, msgs, 'sk-test');
  assert.equal(r.url, 'https://gw.example/llm/custom/v1/chat/completions');
  assert.equal(r.init.headers.Authorization, 'Bearer sk-test');
  assert.equal(JSON.parse(r.init.body).model, 'llama.cpp');
});

test('a lane URL without /v1 gets /v1 added', () => {
  const r = buildLlmRequest({ llmUrl: 'https://gw.example/llm/custom', llmModel: 'm' }, msgs);
  assert.equal(r.url, 'https://gw.example/llm/custom/v1/chat/completions');
});

test('readLlmReply reads Ollama, OpenAI-compatible and legacy shapes, and never throws', () => {
  assert.equal(readLlmReply({ message: { content: 'a' } }), 'a');
  assert.equal(readLlmReply({ choices: [{ message: { content: 'b' } }] }), 'b');
  assert.equal(readLlmReply({ response: 'c' }), 'c');
  assert.equal(readLlmReply({}), '');
  assert.equal(readLlmReply(null), '');
});

test('llmPath names the governed path and flags the direct one', () => {
  assert.match(llmPath('https://gw.example/llm/custom/v1'), /PRIVILEGE/);
  assert.match(llmPath('http://127.0.0.1:11434'), /NOT governed/);
});
