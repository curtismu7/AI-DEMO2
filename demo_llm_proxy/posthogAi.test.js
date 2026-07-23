// demo_llm_proxy/posthogAi.test.js
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseUsageFromBody, modelFromRequest } = require('./posthogAi');

describe('parseUsageFromBody', () => {
  it('reads usage from OpenAI-style JSON', () => {
    const body = JSON.stringify({
      model: 'phi-4-mini-instruct',
      usage: { prompt_tokens: 12, completion_tokens: 34 },
      choices: [{ message: { role: 'assistant', content: 'hi' } }],
    });
    const u = parseUsageFromBody(body);
    assert.equal(u.model, 'phi-4-mini-instruct');
    assert.equal(u.inputTokens, 12);
    assert.equal(u.outputTokens, 34);
    assert.equal(u.stream, false);
  });

  it('reads usage from SSE stream chunks', () => {
    const body = [
      'data: {"model":"gpt-oss-20b","choices":[{"delta":{"content":"a"}}]}',
      '',
      'data: {"model":"gpt-oss-20b","usage":{"prompt_tokens":5,"completion_tokens":7}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');
    const u = parseUsageFromBody(body);
    assert.equal(u.stream, true);
    assert.equal(u.model, 'gpt-oss-20b');
    assert.equal(u.inputTokens, 5);
    assert.equal(u.outputTokens, 7);
  });
});

describe('modelFromRequest', () => {
  it('extracts model from request JSON', () => {
    assert.equal(modelFromRequest(Buffer.from('{"model":"gpt-oss-20b","messages":[]}')), 'gpt-oss-20b');
  });

  it('returns null for non-JSON', () => {
    assert.equal(modelFromRequest(Buffer.from('not-json')), null);
  });
});
