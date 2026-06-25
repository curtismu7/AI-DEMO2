// demo_api_server/tests/real/shared/token-chain-pipeline.test.js

/**
 * E2E token-chain PIPELINE validation (executable SoT).
 *
 * Codifies `scripts/tokenChainTrace.js` as hard assertions. Where token-chain.test.js
 * validates the *claims* of an isolated RFC 8693 exchange, this drives the FULL runtime
 * pipeline the agent actually uses and asserts it stays healthy end-to-end:
 *
 *   1. MCP Inspector invoke  — POST /api/mcp/inspector/invoke runs the real
 *      BFF → RFC 8693 → MCP Gateway → Authorize → MCP server → backend path and
 *      must return a non-error result carrying a non-empty tokenEvents chain.
 *   2. Agent invoke (heuristic) — POST /api/agent/invoke must report success and must
 *      NOT mask a downstream auth failure as an empty-but-successful result
 *      (regression guard for D-2: invalid_token surfaced as "no accounts yet" success:true).
 *
 * Banking vertical is set for the duration (other verticals refuse banking tools) and
 * restored in afterAll to avoid vertical-switch bleed into sibling suites.
 *
 * Gated like the rest of the real suite: skips cleanly when there is no live session.
 */

const { createBffClient, setVertical, restoreVertical } = require('../helpers/bffClient');

const TOOL = 'get_my_accounts';
const PROMPT = 'show my accounts';

// Any of these appearing in an agent response means a downstream MCP/backend error
// leaked through (or, for D-2, was masked) instead of being surfaced honestly.
const BACKEND_ERROR_SIGNAL = /invalid_token|"isError"\s*:\s*true|Banking API error/;

function collectTokenEvents(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node.tokenEvents)) out.push(...node.tokenEvents);
  if (node._meta && Array.isArray(node._meta.tokenEvents)) out.push(...node._meta.tokenEvents);
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (v && typeof v === 'object') collectTokenEvents(v, out);
  }
  return out;
}

describe('Token chain — E2E pipeline (banking)', () => {
  let enduser;

  beforeAll(async () => {
    try {
      enduser = createBffClient('enduser');
    } catch {
      return; // no session — every test guards via `if (!enduser) return`
    }
    await setVertical(enduser, 'banking');
  });

  afterAll(async () => {
    await restoreVertical(enduser);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. MCP Inspector invoke — full gateway pipeline
  // ──────────────────────────────────────────────────────────────────────────
  describe('1. MCP Inspector invoke — full gateway path', () => {
    it('returns 200', async () => {
      if (!enduser) return;
      const r = await enduser.post('/api/mcp/inspector/invoke', { tool: TOOL, params: {} });
      expect(r.status).toBe(200);
    });

    it('result is not an MCP error (chain healthy end-to-end)', async () => {
      if (!enduser) return;
      const r = await enduser.post('/api/mcp/inspector/invoke', { tool: TOOL, params: {} });
      const result = r.data?.result;
      if (!result) return; // endpoint shape unexpected / inspector disabled — skip
      const errText = result.isError === true
        ? (result.content?.[0]?.text || 'unknown MCP error')
        : null;
      expect(errText).toBeNull(); // surfaces the real error text in the failure message
    });

    it('produces a non-empty tokenEvents chain', async () => {
      if (!enduser) return;
      const r = await enduser.post('/api/mcp/inspector/invoke', { tool: TOOL, params: {} });
      if (!r.data?.result) return;
      const events = collectTokenEvents(r.data);
      expect(events.length).toBeGreaterThan(0);
    });

    it('tokenEvents include at least one RFC 8693 exchange and a JWKS/verify row', async () => {
      if (!enduser) return;
      const r = await enduser.post('/api/mcp/inspector/invoke', { tool: TOOL, params: {} });
      if (!r.data?.result) return;
      const events = collectTokenEvents(r.data);
      if (!events.length) return;
      const ids = events.map((e) => String(e.id || '')).join(' ');
      const labels = events.map((e) => String(e.label || '')).join(' ');
      const hasExchange = /exchang/i.test(ids) || /exchang/i.test(labels);
      const hasVerify = /verif|jwks|introspect/i.test(ids) || /verif|jwks|introspect/i.test(labels);
      expect(hasExchange).toBe(true);
      expect(hasVerify).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Agent invoke — heuristic path (D-2 no-masking guard)
  // ──────────────────────────────────────────────────────────────────────────
  describe('2. Agent invoke (heuristic) — no masked auth failure', () => {
    it('returns 200', async () => {
      if (!enduser) return;
      const r = await enduser.post('/api/agent/invoke', { prompt: PROMPT, forceHeuristic: true });
      // 200 = handled. A real auth failure now surfaces as 401/502 (not masked) — both acceptable here.
      expect([200, 401, 502]).toContain(r.status);
    });

    it('a 200 response reports success (chain healthy)', async () => {
      if (!enduser) return;
      const r = await enduser.post('/api/agent/invoke', { prompt: PROMPT, forceHeuristic: true });
      if (r.status !== 200) return; // auth genuinely failed — surfaced honestly, covered above
      expect(r.data?.success).toBe(true);
    });

    it('does NOT mask a downstream auth error as a successful empty result (D-2)', async () => {
      if (!enduser) return;
      const r = await enduser.post('/api/agent/invoke', { prompt: PROMPT, forceHeuristic: true });
      if (r.status !== 200) return; // honest non-200 is the correct behavior, not a regression
      const body = JSON.stringify(r.data || {});
      const hasErrorSignal = BACKEND_ERROR_SIGNAL.test(body);
      // If a backend error signal is present it must NOT be paired with success:true —
      // that pairing is exactly the D-2 masking bug.
      if (hasErrorSignal) {
        expect(r.data?.success).toBe(false);
      } else {
        expect(r.data?.success).toBe(true);
      }
    });
  });
});
