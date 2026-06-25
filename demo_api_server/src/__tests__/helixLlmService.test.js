/**
 * @file helixLlmService.test.js
 *
 * Unit tests for the Helix conversation API integration.
 * Covers the 2-step flow: createConversation → sendMessage (returns answer directly).
 * Falls back to polling if sendMessage response is not immediately complete.
 *
 * Key correctness checks:
 *   - Auth uses x-api-key header (NOT Authorization: Bearer)
 *   - URL path is /dpc/jas/helix/v1/environments/... (not /api/environments/...)
 *   - Base URL normalisation: tenant root gets /dpc/jas/helix/v1 appended
 *   - sendMessage response with message_class:"complete" resolves immediately (no poll)
 *   - Fallback poll resolves on complete envelope from agent
 *   - helix_prompt_field_id config drives the input field key
 *   - Timeout throws after deadline
 */

'use strict';

// ── fetch mock ────────────────────────────────────────────────────────────────

let _fetchMock;

beforeEach(() => {
  _fetchMock = jest.fn();
  global.fetch = _fetchMock;
});

afterEach(() => {
  delete global.fetch;
  jest.useRealTimers();
});

const { callHelixAgent } = require('../../services/helixLlmService');

// ── fixtures ──────────────────────────────────────────────────────────────────

const CFG = {
  helix_base_url: 'https://openam-helix.forgeblocks.com/dpc/jas/helix/v1',
  helix_api_key: 'test-key-abc',
  helix_environment_id: 'env-123',
  helix_agent_id: 'my-banking-agent',
  helix_prompt_field_id: 'textInputa7c39a0e8292',
};

const MSGS = [{ role: 'user', content: 'Hello, who are you?' }];

function okJson(data) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data), text: () => Promise.resolve('') });
}

function errResponse(status, body = 'Bad Request') {
  return Promise.resolve({ ok: false, status, text: () => Promise.resolve(body) });
}

const CONV = { id: 'conv-1', home_channel: 'ch-1' };

// Complete response — message_class:"complete" with content array (real Helix API shape)
const COMPLETE_RESPONSE = {
  message_class: 'complete',
  conversation_id: 'conv-1',
  channel_id: 'ch-1',
  content: [{ class: 'complete', field_id: 'endNode', value: 'I am Helix.' }],
};

// Non-complete send response — triggers fallback poll path
const PENDING_RESPONSE = { message_class: 'pending' };

// ── happy path ────────────────────────────────────────────────────────────────

describe('callHelixAgent — happy path', () => {
  it('returns the agent response value on success', async () => {
    _fetchMock
      .mockResolvedValueOnce(okJson(CONV))              // createConversation
      .mockResolvedValueOnce(okJson(COMPLETE_RESPONSE)); // sendMessage → answer immediately

    const result = await callHelixAgent(CFG, MSGS);
    expect(result).toBe('I am Helix.');
  });

  it('makes exactly 2 fetch calls when sendMessage returns a complete response', async () => {
    _fetchMock
      .mockResolvedValueOnce(okJson(CONV))
      .mockResolvedValueOnce(okJson(COMPLETE_RESPONSE));

    await callHelixAgent(CFG, MSGS);
    expect(_fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ── auth header ───────────────────────────────────────────────────────────────

describe('callHelixAgent — authentication', () => {
  it('uses x-api-key header, not Authorization Bearer', async () => {
    _fetchMock
      .mockResolvedValueOnce(okJson(CONV))
      .mockResolvedValueOnce(okJson(COMPLETE_RESPONSE));

    await callHelixAgent(CFG, MSGS);

    const [, createOpts] = _fetchMock.mock.calls[0];
    expect(createOpts.headers['x-api-key']).toBe('test-key-abc');
    expect(createOpts.headers['Authorization']).toBeUndefined();
  });

  it('poll request also uses x-api-key header (fallback poll path)', async () => {
    _fetchMock
      .mockResolvedValueOnce(okJson(CONV))
      .mockResolvedValueOnce(okJson(PENDING_RESPONSE))  // sendMessage not complete → poll
      .mockResolvedValueOnce(okJson(COMPLETE_RESPONSE)); // poll returns complete

    await callHelixAgent(CFG, MSGS);

    const [, pollOpts] = _fetchMock.mock.calls[2];
    expect(pollOpts.headers['x-api-key']).toBe('test-key-abc');
  });
});

// ── URL structure ─────────────────────────────────────────────────────────────

describe('callHelixAgent — URL structure', () => {
  it('createConversation hits /dpc/jas/helix/v1/environments/{env}/agents/{agent}/conversations', async () => {
    _fetchMock
      .mockResolvedValueOnce(okJson(CONV))
      .mockResolvedValueOnce(okJson(COMPLETE_RESPONSE));

    await callHelixAgent(CFG, MSGS);

    const [createUrl] = _fetchMock.mock.calls[0];
    expect(createUrl).toBe(
      'https://openam-helix.forgeblocks.com/dpc/jas/helix/v1/environments/env-123/agents/my-banking-agent/conversations',
    );
  });

  it('sendMessage hits /conversations/{conv}/channels/{ch}/messages', async () => {
    _fetchMock
      .mockResolvedValueOnce(okJson(CONV))
      .mockResolvedValueOnce(okJson(COMPLETE_RESPONSE));

    await callHelixAgent(CFG, MSGS);

    const [sendUrl] = _fetchMock.mock.calls[1];
    expect(sendUrl).toContain('/conversations/conv-1/channels/ch-1/messages');
  });

  it('normalises tenant-root base URL by appending /dpc/jas/helix/v1', async () => {
    const cfgTenantRoot = { ...CFG, helix_base_url: 'https://openam-helix.forgeblocks.com' };
    _fetchMock
      .mockResolvedValueOnce(okJson(CONV))
      .mockResolvedValueOnce(okJson(COMPLETE_RESPONSE));

    await callHelixAgent(cfgTenantRoot, MSGS);

    const [createUrl] = _fetchMock.mock.calls[0];
    expect(createUrl).toContain('/dpc/jas/helix/v1/environments/');
  });

  it('does not double-append /dpc/jas/helix/v1 when already present', async () => {
    _fetchMock
      .mockResolvedValueOnce(okJson(CONV))
      .mockResolvedValueOnce(okJson(COMPLETE_RESPONSE));

    await callHelixAgent(CFG, MSGS);

    const [createUrl] = _fetchMock.mock.calls[0];
    expect(createUrl).not.toContain('/dpc/jas/helix/v1/dpc/jas/helix/v1');
  });
});

// ── request body ──────────────────────────────────────────────────────────────

describe('callHelixAgent — request body', () => {
  it('sendMessage body has class=start and uses helix_prompt_field_id as the content key', async () => {
    _fetchMock
      .mockResolvedValueOnce(okJson(CONV))
      .mockResolvedValueOnce(okJson(COMPLETE_RESPONSE));

    await callHelixAgent(CFG, [{ role: 'user', content: 'Test prompt' }]);

    const [, sendOpts] = _fetchMock.mock.calls[1];
    const body = JSON.parse(sendOpts.body);
    expect(body.class).toBe('start');
    expect(body.content[CFG.helix_prompt_field_id]).toBe('Test prompt');
  });

  it('uses helix_prompt_field_id as the content key when configured', async () => {
    _fetchMock
      .mockResolvedValueOnce(okJson(CONV))
      .mockResolvedValueOnce(okJson(COMPLETE_RESPONSE));

    await callHelixAgent(
      { ...CFG, helix_prompt_field_id: 'textInputa7c39a0e8292' },
      [{ role: 'user', content: 'My balance?' }],
    );

    const [, sendOpts] = _fetchMock.mock.calls[1];
    const body = JSON.parse(sendOpts.body);
    expect(body.content.textInputa7c39a0e8292).toBe('My balance?');
    expect(body.content.textInputUserQuery).toBeUndefined();
  });

  it('prepends system message before user text when both are present', async () => {
    _fetchMock
      .mockResolvedValueOnce(okJson(CONV))
      .mockResolvedValueOnce(okJson(COMPLETE_RESPONSE));

    await callHelixAgent(CFG, [
      { role: 'system', content: 'You are a banking assistant.' },
      { role: 'user', content: 'What is my balance?' },
    ]);

    const [, sendOpts] = _fetchMock.mock.calls[1];
    const body = JSON.parse(sendOpts.body);
    // System message is prepended to user text (Helix directive field is not always active)
    expect(body.content[CFG.helix_prompt_field_id]).toBe(
      'You are a banking assistant.\n\nWhat is my balance?'
    );
  });
});

// ── polling fallback ──────────────────────────────────────────────────────────

describe('callHelixAgent — polling fallback', () => {
  it('retries poll when sendMessage response is not complete', async () => {
    _fetchMock
      .mockResolvedValueOnce(okJson(CONV))
      .mockResolvedValueOnce(okJson(PENDING_RESPONSE))   // sendMessage not complete
      .mockResolvedValueOnce(okJson(PENDING_RESPONSE))   // first poll — not done
      .mockResolvedValueOnce(okJson(COMPLETE_RESPONSE)); // second poll — done

    const result = await callHelixAgent(CFG, MSGS);

    expect(result).toBe('I am Helix.');
    expect(_fetchMock).toHaveBeenCalledTimes(4);
  });

  it('unwraps JSON-string value when agent returns {response: "..."}', async () => {
    const jsonValueResponse = {
      message_class: 'complete',
      content: [{ class: 'complete', value: JSON.stringify({ response: 'Unwrapped answer' }) }],
    };
    _fetchMock
      .mockResolvedValueOnce(okJson(CONV))
      .mockResolvedValueOnce(okJson(jsonValueResponse));

    const result = await callHelixAgent(CFG, MSGS);
    expect(result).toBe('Unwrapped answer');
  });
});

// ── error handling ────────────────────────────────────────────────────────────

describe('callHelixAgent — error handling', () => {
  it('throws when config fields are missing', async () => {
    await expect(callHelixAgent({ helix_base_url: 'https://x.com' }, MSGS))
      .rejects.toThrow('Helix config incomplete');
  });

  it('throws when helix_prompt_field_id is missing', async () => {
    const { helix_prompt_field_id: _, ...cfgNoField } = CFG;
    await expect(callHelixAgent(cfgNoField, MSGS))
      .rejects.toThrow('helix_prompt_field_id');
  });

  it('throws when no messages provided', async () => {
    await expect(callHelixAgent(CFG, []))
      .rejects.toThrow('No messages provided');
  });

  it('throws on createConversation HTTP error', async () => {
    _fetchMock.mockResolvedValueOnce(errResponse(401, 'Unauthorized'));
    await expect(callHelixAgent(CFG, MSGS)).rejects.toThrow('createConversation failed: 401');
  });

  it('throws on sendMessage HTTP error', async () => {
    _fetchMock
      .mockResolvedValueOnce(okJson(CONV))
      .mockResolvedValueOnce(errResponse(400, 'Bad Request'));
    await expect(callHelixAgent(CFG, MSGS)).rejects.toThrow('sendMessage failed: 400');
  });

  it('throws on poll HTTP error', async () => {
    _fetchMock
      .mockResolvedValueOnce(okJson(CONV))
      .mockResolvedValueOnce(okJson(PENDING_RESPONSE))  // sendMessage not complete → triggers poll
      .mockResolvedValueOnce(errResponse(500, 'Internal Server Error'));
    await expect(callHelixAgent(CFG, MSGS)).rejects.toThrow('poll failed: 500');
  });
});
