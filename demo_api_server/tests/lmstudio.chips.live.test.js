// demo_api_server/tests/lmstudio.chips.live.test.js
/**
 * Live integration tests — chips via real LM Studio (anthropic-lmstudio provider).
 *
 * Requirements:
 *   - LM Studio running at http://localhost:1234 with a model loaded
 *   - BFF running at https://api.ping.demo:3001
 *
 * Auto-skips when LM Studio is not reachable so CI doesn't fail.
 */

jest.setTimeout(30000);

const https = require('node:https');

// Use 127.0.0.1 explicitly — Node native fetch resolves "localhost" to ::1
// (IPv6) on Node 18+, but LM Studio only binds to 127.0.0.1 (IPv4).
const LMS_BASE = (process.env.LMSTUDIO_BASE_URL || 'http://127.0.0.1:1234')
  .replace(/\/v1\/?$/, '')
  .replace('localhost', '127.0.0.1');

const BFF_BASE = process.env.BFF_BASE_URL || 'https://api.ping.demo:3001';

// BFF is behind a mkcert cert. Node native `fetch` ignores NODE_TLS_REJECT_UNAUTHORIZED
// and has no dispatcher API without undici. Use https.request directly instead.
function bffFetch(path, options = {}) {
  const url = new URL(`${BFF_BASE}${path}`);
  return new Promise((resolve, reject) => {
    const reqOptions = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      rejectUnauthorized: false,
    };
    const req = https.request(reqOptions, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          json: () => Promise.resolve(JSON.parse(raw)),
        });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function lmsFetch(path, options = {}) {
  return fetch(`${LMS_BASE}${path}`, options);
}

// ── Availability probe (runs once before all suites) ──────────────────────────

let lmsAvailable = false;
let loadedModels = [];

beforeAll(async () => {
  try {
    const res = await lmsFetch('/api/v1/models');
    if (res.ok) {
      const data = await res.json();
      loadedModels = (data.models || []).filter(m => (m.loaded_instances || []).length > 0);
      lmsAvailable = loadedModels.length > 0;
    }
  } catch {
    lmsAvailable = false;
  }
  if (!lmsAvailable) {
    console.warn('[LMS Live] LM Studio not reachable or no model loaded — all tests will skip');
  } else {
    console.log('[LMS Live] Loaded models:', loadedModels.map(m => m.key).join(', '));
  }
});

// Jest-compatible conditional skip: wraps each test so it skips at definition
// time if LM Studio wasn't reachable at module load. Because beforeAll runs
// before tests execute (not before describe blocks), we use a runtime guard
// that fails with a recognisable message rather than a real assertion failure.
function liveTest(name, fn) {
  test(name, async (...args) => {
    if (!lmsAvailable) {
      console.log(`[LMS Live] SKIP (no LM Studio): ${name}`);
      return; // soft-skip: test passes but does nothing
    }
    return fn(...args);
  });
}

function liveTestEach(table) {
  return {
    test: (name, fn) =>
      test.each(table)(name, async (...args) => {
        if (!lmsAvailable) {
          console.log(`[LMS Live] SKIP (no LM Studio): ${name}`);
          return;
        }
        return fn(...args);
      }),
  };
}

// ── BFF /status ───────────────────────────────────────────────────────────────

describe('BFF /api/langchain/lmstudio/status (live)', () => {
  liveTest('returns server_running:true with loaded models', async () => {
    const res = await bffFetch('/api/langchain/lmstudio/status');
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.server_running).toBe(true);
    expect(body.models.length).toBeGreaterThan(0);
    expect(body.anthropic_endpoint).toMatch(/\/v1\/messages$/);
    const loaded = body.models.filter(m => m.loaded);
    expect(loaded.length).toBeGreaterThan(0);
    console.log('[LMS Live] BFF reports loaded:', loaded.map(m => m.key).join(', '));
  });
});

// ── Anthropic-compat endpoint ─────────────────────────────────────────────────

describe('LM Studio Anthropic-compat endpoint (live)', () => {
  const DEFAULT_MODEL = 'google/gemma-4-e2b';

  function callLms(message, extra = {}) {
    return lmsFetch('/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'lm-studio' },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_tokens: 64,
        messages: [{ role: 'user', content: message }],
        ...extra,
      }),
    }).then(async r => ({ status: r.status, body: await r.json() }));
  }

  liveTest('responds 200 with Anthropic wire-format', async () => {
    const { status, body } = await callLms('Reply with exactly one word: hello');
    expect(status).toBe(200);
    expect(body.type).toBe('message');
    expect(Array.isArray(body.content)).toBe(true);
    expect(body.content[0].type).toBe('text');
    expect(body.content[0].text.length).toBeGreaterThan(0);
    console.log('[LMS Live] text:', body.content[0].text.trim().slice(0, 100));
  });

  liveTest('stop_reason is present', async () => {
    const { status, body } = await callLms('Say: done', { max_tokens: 16 });
    expect(status).toBe(200);
    expect(body.stop_reason).toBeTruthy();
    console.log('[LMS Live] stop_reason:', body.stop_reason);
  });

  liveTest('usage tokens are reported', async () => {
    const { status, body } = await callLms('Hi', { max_tokens: 16 });
    expect(status).toBe(200);
    expect(body.usage?.input_tokens).toBeGreaterThan(0);
    expect(body.usage?.output_tokens).toBeGreaterThan(0);
    console.log('[LMS Live] tokens in/out:', body.usage?.input_tokens, '/', body.usage?.output_tokens);
  });

  liveTest('x-api-key value is irrelevant (LM Studio ignores it)', async () => {
    const res = await lmsFetch('/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'totally-fake-key-12345' },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    });
    expect(res.status).toBe(200);
  });
});

// ── Chip messages ─────────────────────────────────────────────────────────────

describe('Chip messages → LM Studio Anthropic-compat (live)', () => {
  const chipSamples = [
    ['balance',         "What's my account balance?"],
    ['accounts',        'Show me my accounts'],
    ['transactions',    'Show my recent transactions'],
    ['recommendations', 'What financial tips do you have for me?'],
    ['spending',        'Summarize my spending this month'],
  ];

  function sendToLms(message) {
    return lmsFetch('/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'lm-studio' },
      body: JSON.stringify({
        model: 'google/gemma-4-e2b',
        max_tokens: 128,
        messages: [{ role: 'user', content: message }],
      }),
    }).then(async r => ({ status: r.status, body: await r.json() }));
  }

  liveTestEach(chipSamples).test(
    'chip %s — returns valid Anthropic response',
    async (id, message) => {
      const { status, body } = await sendToLms(message);
      expect(status).toBe(200);
      expect(body.type).toBe('message');
      expect(Array.isArray(body.content)).toBe(true);
      expect(body.content[0]?.type).toBe('text');
      const text = body.content[0].text;
      expect(text.length).toBeGreaterThan(0);
      console.log(`[LMS Live] chip ${id}: "${text.slice(0, 80).replace(/\n/g, ' ')}"`);
    }
  );
});

// ── Tool-use capability ───────────────────────────────────────────────────────

describe('LM Studio tool_use capability (live)', () => {
  liveTest('google/gemma-4-e2b reports trained_for_tool_use', async () => {
    const res = await lmsFetch('/api/v1/models');
    const data = await res.json();
    const gemma = (data.models || []).find(m => m.key === 'google/gemma-4-e2b');
    if (!gemma) {
      console.warn('[LMS Live] google/gemma-4-e2b not in model list — skipping capability check');
      return;
    }
    expect(gemma.capabilities?.trained_for_tool_use).toBe(true);
    console.log('[LMS Live] Gemma capabilities:', JSON.stringify(gemma.capabilities));
  });

  liveTest('tool schema is accepted and returns a valid message', async () => {
    const res = await lmsFetch('/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'lm-studio' },
      body: JSON.stringify({
        model: 'google/gemma-4-e2b',
        max_tokens: 128,
        tools: [{
          name: 'get_account_balance',
          description: 'Returns the current balance of a bank account',
          input_schema: {
            type: 'object',
            properties: { account_id: { type: 'string' } },
            required: ['account_id'],
          },
        }],
        messages: [{ role: 'user', content: 'What is the balance on account acc-123?' }],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe('message');
    expect(['end_turn', 'tool_use', 'max_tokens']).toContain(body.stop_reason);
    console.log('[LMS Live] tool-use stop_reason:', body.stop_reason);
    if (body.stop_reason === 'tool_use') {
      const toolUse = body.content.find(c => c.type === 'tool_use');
      expect(toolUse?.name).toBe('get_account_balance');
      console.log('[LMS Live] tool input:', JSON.stringify(toolUse?.input));
    }
  });
});
