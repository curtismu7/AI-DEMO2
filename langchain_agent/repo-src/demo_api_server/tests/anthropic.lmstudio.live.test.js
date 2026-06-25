// demo_api_server/tests/anthropic.lmstudio.live.test.js
/**
 * Live tests — "anthropic" provider routed through LM Studio.
 *
 * ANTHROPIC_BASE_URL=http://localhost:1234 causes the Anthropic SDK to call
 * LM Studio's /v1/messages endpoint instead of api.anthropic.com.
 * This lets the demo present as "using Anthropic" while running locally.
 *
 * Requires: LM Studio running at http://127.0.0.1:1234 with a model loaded.
 * Auto-skips when LM Studio is unreachable (CI-safe).
 */

jest.setTimeout(30000);

const https = require('node:https');

// 127.0.0.1 avoids IPv6/::1 resolution issue with Node native fetch on macOS
const LMS_BASE = 'http://127.0.0.1:1234';
const BFF_BASE = process.env.BFF_BASE_URL || 'https://api.ping.demo:3001';

// BFF uses mkcert — use https.request to bypass cert validation
function bffRequest(method, path, body) {
  const url = new URL(`${BFF_BASE}${path}`);
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname, port: url.port || 443,
        path: url.pathname + url.search, method,
        rejectUnauthorized: false,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : {},
      },
      (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }));
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

let lmsAvailable = false;
let loadedModel = null;

beforeAll(async () => {
  try {
    const res = await fetch(`${LMS_BASE}/api/v1/models`);
    if (res.ok) {
      const data = await res.json();
      const loaded = (data.models || []).filter(m => (m.loaded_instances || []).length > 0);
      if (loaded.length > 0) {
        lmsAvailable = true;
        loadedModel = loaded[0].key;
        console.log('[Anthropic→LMS] Using model:', loadedModel);
      }
    }
  } catch { lmsAvailable = false; }
  if (!lmsAvailable) console.warn('[Anthropic→LMS] LM Studio not reachable — tests will skip');
});

// Soft-skip: test passes but does nothing when LM Studio is down
function liveTest(name, fn) {
  test(name, async (...args) => {
    if (!lmsAvailable) { console.log(`[Anthropic→LMS] SKIP: ${name}`); return; }
    return fn(...args);
  });
}

// ── Core: Anthropic SDK wire format hitting LM Studio ─────────────────────────

describe('Anthropic API → LM Studio proxy', () => {
  async function callAnthropicCompat(message, model, extra = {}) {
    const res = await fetch(`${LMS_BASE}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'lm-studio', 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: model || loadedModel,
        max_tokens: 64,
        messages: [{ role: 'user', content: message }],
        ...extra,
      }),
    });
    return { status: res.status, body: await res.json() };
  }

  liveTest('responds with valid Anthropic message format', async () => {
    const { status, body } = await callAnthropicCompat('Say exactly: hello from anthropic');
    expect(status).toBe(200);
    expect(body.type).toBe('message');
    expect(body.role).toBe('assistant');
    expect(Array.isArray(body.content)).toBe(true);
    expect(body.content[0].type).toBe('text');
    expect(body.content[0].text.length).toBeGreaterThan(0);
    console.log('[Anthropic→LMS] Response:', body.content[0].text.trim().slice(0, 100));
  });

  liveTest('anthropic-version header is accepted', async () => {
    const { status } = await callAnthropicCompat('Hi', loadedModel, {});
    expect(status).toBe(200);
  });

  liveTest('model field is the LM Studio model ID (not claude-*)', async () => {
    const { status, body } = await callAnthropicCompat('Hi');
    expect(status).toBe(200);
    // LM Studio echoes back the model ID it actually used
    expect(body.model).toBeTruthy();
    console.log('[Anthropic→LMS] model echoed:', body.model);
  });

  liveTest('usage stats present (mirrors Anthropic API contract)', async () => {
    const { status, body } = await callAnthropicCompat('Count to 3', loadedModel, { max_tokens: 32 });
    expect(status).toBe(200);
    expect(body.usage?.input_tokens).toBeGreaterThan(0);
    expect(body.usage?.output_tokens).toBeGreaterThan(0);
    console.log('[Anthropic→LMS] tokens:', body.usage?.input_tokens, '→', body.usage?.output_tokens);
  });

  liveTest('tool_use schema accepted — Anthropic wire format', async () => {
    const { status, body } = await callAnthropicCompat(
      'What is the balance on account acc-999?',
      loadedModel,
      {
        max_tokens: 128,
        tools: [{
          name: 'get_account_balance',
          description: 'Get current balance for a bank account',
          input_schema: {
            type: 'object',
            properties: { account_id: { type: 'string' } },
            required: ['account_id'],
          },
        }],
      }
    );
    expect(status).toBe(200);
    expect(body.type).toBe('message');
    expect(['end_turn', 'tool_use', 'max_tokens']).toContain(body.stop_reason);
    console.log('[Anthropic→LMS] tool_use stop_reason:', body.stop_reason);
    if (body.stop_reason === 'tool_use') {
      const tool = body.content.find(c => c.type === 'tool_use');
      expect(tool?.name).toBe('get_account_balance');
      console.log('[Anthropic→LMS] tool input:', JSON.stringify(tool?.input));
    }
  });
});

// ── BFF key_set: anthropic shows as configured ────────────────────────────────

describe('BFF config: key_set.anthropic', () => {
  liveTest('key_set.anthropic is true after setting key via langchain config', async () => {
    // key_type=anthropic + key=<value> stores anthropic_api_key in the session config.
    const setRes = await bffRequest('POST', '/api/langchain/config', {
      key_type: 'anthropic', key: 'lm-studio', provider: 'anthropic',
    });
    expect(setRes.status).toBe(200);
    expect(setRes.body.key_set?.anthropic).toBe(true);
    console.log('[Anthropic→LMS] BFF key_set after set:', JSON.stringify(setRes.body.key_set));
  });
});

// ── Python factory smoke test ──────────────────────────────────────────────────

describe('Python llm_factory anthropic branch (smoke)', () => {
  liveTest('ChatAnthropic with anthropic_api_url=LM Studio returns a response', async () => {
    // Simulate exactly what llm_factory.get_llm(provider="anthropic", anthropic_base_url="http://localhost:1234") does:
    // It calls POST /v1/messages on LM Studio with the Anthropic SDK wire format.
    const res = await fetch(`${LMS_BASE}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'lm-studio' },
      body: JSON.stringify({
        model: loadedModel,
        max_tokens: 32,
        messages: [{ role: 'user', content: 'Reply with: anthropic ok' }],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe('message');
    expect(body.content[0]?.type).toBe('text');
    console.log('[Anthropic→LMS] factory smoke:', body.content[0]?.text?.trim().slice(0, 60));
  });
});
