// demo_api_server/tests/mcpGatewayClient.modernRequest.test.js
'use strict';
/**
 * MCP 2026-07-28 stateless requests from the BFF (flag `mcp_modern_requests`).
 *
 * The flag is ON by default and negotiates per gateway: a call to the Node
 * gateway is tried as a stateless request (_meta + Mcp-Method/Mcp-Name, no
 * session). With the flag OFF the request is exactly what it always was.
 * PingGateway, the Privilege door and callers with their own session are never
 * sent Modern. Two Modern answers the BFF cannot use — input_required and a
 * version rejection — mean the call did not run, so it is resent once in the
 * old shape; without that, a confirmation prompt would come back as a 200 with
 * a result and be taken for a finished tool call. A rejection is remembered
 * per gateway for a few minutes so an old gateway costs one extra request, not
 * one per call. Every call reports which version it spoke (`mcpProtocol`), which
 * is what the trace panel shows.
 */

const NODE_GW = 'https://node-gw.local';
const IG = 'https://ig.local';
const META_VERSION = 'io.modelcontextprotocol/protocolVersion';

const okResult = { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'ok' }] } };
const inputRequired = {
  jsonrpc: '2.0', id: 1,
  result: { resultType: 'input_required', inputRequests: { elicitation: {} }, requestState: 'gw1.x.y' },
};
const rpcError = (code, message) => ({ jsonrpc: '2.0', id: 1, error: { code, message } });

/**
 * Load the client once with axios stubbed to answer from a queue; `call()` makes one
 * gateway call and returns what it saw. Keeping the module loaded between calls is
 * what lets the per-gateway negotiation memory be tested.
 */
function load({ flag, base = NODE_GW } = {}) {
  jest.resetModules();
  delete process.env.MCP_BFF_MODERN_REQUESTS;
  delete process.env.MCP_PINGGATEWAY_URL;
  if (flag !== undefined) process.env.MCP_BFF_MODERN_REQUESTS = String(flag);
  if (base === IG) process.env.MCP_PINGGATEWAY_URL = IG;

  const calls = [];
  const queue = [];
  jest.doMock('axios', () => ({
    post: jest.fn(async (url, body, cfg) => {
      calls.push({ url, body, headers: { ...cfg.headers } });
      const next = queue.shift();
      return { status: next.status ?? 200, headers: {}, data: next.data };
    }),
    get: jest.fn(async () => ({ status: 200, headers: {}, data: {} })),
  }));
  jest.doMock('../services/mcpToolAuthorizationService', () => ({ resolveResourceOwnerId: jest.fn() }));
  const { callToolViaGateway } = require('../services/mcpGatewayClient');
  const pin = base === IG ? { pinGatewayBase: true } : { pinNodeGateway: true };

  async function call({ replies, opts = {}, tool = 'get_account_balance' }) {
    const before = calls.length;
    queue.push(...replies);
    let out;
    let error;
    try {
      out = await callToolViaGateway(base, 'tok', tool, { account_id: 'a1' }, { ...pin, ...opts });
    } catch (e) {
      error = e;
    }
    return { calls: calls.slice(before), out, error };
  }
  return { call };
}

async function run({ flag, replies, opts, base, tool }) {
  return load({ flag, base }).call({ replies, opts, tool });
}

afterAll(() => {
  delete process.env.MCP_BFF_MODERN_REQUESTS;
  delete process.env.MCP_PINGGATEWAY_URL;
});

describe('mcpGatewayClient — MCP 2026-07-28 stateless requests', () => {
  test('flag unset: ON by default, the Node gateway is tried with a stateless request', async () => {
    const { calls, out } = await run({ replies: [{ data: okResult }] });
    expect(calls).toHaveLength(1);
    expect(calls[0].headers['MCP-Protocol-Version']).toBe('2026-07-28');
    expect(calls[0].body.params._meta[META_VERSION]).toBe('2026-07-28');
    expect(out.mcpProtocol).toEqual({ version: '2026-07-28', stateless: true, reason: 'stateless' });
  });

  test('flag false: the request is exactly the old one (2025-11-25, no _meta, no routing headers)', async () => {
    const { calls, out } = await run({ flag: 'false', replies: [{ data: okResult }] });
    expect(calls).toHaveLength(1);
    expect(calls[0].headers['MCP-Protocol-Version']).toBe('2025-11-25');
    expect(calls[0].headers['Mcp-Method']).toBeUndefined();
    expect(calls[0].body.params._meta).toBeUndefined();
    expect(out.mcpProtocol).toEqual({ version: '2025-11-25', stateless: false, reason: 'flag-off' });
  });

  test('flag on, Node gateway: one POST with _meta and the routing headers', async () => {
    const { calls, out } = await run({ flag: 'true', replies: [{ data: okResult }] });
    expect(calls).toHaveLength(1);
    const { body, headers } = calls[0];
    expect(body.method).toBe('tools/call');
    expect(body.params.name).toBe('get_account_balance');
    expect(body.params.arguments).toEqual({ account_id: 'a1' });
    expect(body.params._meta[META_VERSION]).toBe('2026-07-28');
    expect(body.params._meta['io.modelcontextprotocol/clientCapabilities']).toEqual({});
    expect(body.params._meta['io.modelcontextprotocol/clientInfo'].name).toBe('banking-bff');
    expect(headers['MCP-Protocol-Version']).toBe('2026-07-28');
    expect(headers['Mcp-Method']).toBe('tools/call');
    expect(headers['Mcp-Name']).toBe('get_account_balance');
    expect(headers['mcp-session-id']).toBeUndefined();
    expect(headers.Authorization).toBe('Bearer tok');
    expect(out.result.content[0].text).toBe('ok');
  });

  test('flag on, tools/list discovery: _meta and Mcp-Method, no Mcp-Name', async () => {
    const { calls } = await run({
      flag: 'true',
      replies: [{ data: { jsonrpc: '2.0', id: 1, result: { tools: [] } } }],
      opts: { rpcMethod: 'tools/list' },
    });
    expect(calls[0].body.method).toBe('tools/list');
    expect(calls[0].body.params._meta[META_VERSION]).toBe('2026-07-28');
    expect(calls[0].headers['Mcp-Method']).toBe('tools/list');
    expect(calls[0].headers['Mcp-Name']).toBeUndefined();
  });

  test('flag on but PingGateway: never Modern', async () => {
    const { calls } = await run({ flag: 'true', base: IG, replies: [{ data: okResult }] });
    expect(calls[0].headers['MCP-Protocol-Version']).toBe('2025-06-18');
    expect(calls[0].headers['Mcp-Method']).toBeUndefined();
    expect(calls[0].body.params._meta).toBeUndefined();
  });

  test('the Privilege door (pinGatewayBase on a non-PingGateway base) is never sent Modern', async () => {
    const { calls, out } = await run({ flag: 'true', opts: { pinGatewayBase: true }, replies: [{ data: okResult }] });
    expect(calls[0].headers['MCP-Protocol-Version']).toBe('2025-11-25');
    expect(calls[0].body.params._meta).toBeUndefined();
    expect(out.mcpProtocol.reason).toBe('privilege-door');
  });

  test('flag on but the caller brought its own session: never Modern', async () => {
    const { calls } = await run({ flag: 'true', opts: { sessionId: 'sess-1' }, replies: [{ data: okResult }] });
    expect(calls[0].headers['mcp-session-id']).toBe('sess-1');
    expect(calls[0].headers['MCP-Protocol-Version']).toBe('2025-11-25');
    expect(calls[0].body.params._meta).toBeUndefined();
  });

  describe('a Modern answer the BFF cannot use is resent once in the old shape', () => {
    function expectResentLegacy(calls) {
      expect(calls).toHaveLength(2);
      expect(calls[0].body.params._meta[META_VERSION]).toBe('2026-07-28');
      expect(calls[1].body.params._meta).toBeUndefined();
      expect(calls[1].headers['MCP-Protocol-Version']).toBe('2025-11-25');
      expect(calls[1].headers['Mcp-Method']).toBeUndefined();
    }

    test('input_required (a confirmation) is not mistaken for a finished call', async () => {
      const { calls, out } = await run({ flag: 'true', replies: [{ data: inputRequired }, { data: okResult }] });
      expectResentLegacy(calls);
      expect(out.result.content[0].text).toBe('ok');
    });

    test('and the old-shape answer is what the caller sees, e.g. the 428 elicitation_required flow', async () => {
      const { calls, error } = await run({
        flag: 'true',
        replies: [
          { data: inputRequired },
          { status: 428, data: { error: 'elicitation_required', tool_name: 'get_account_balance', elicitation_id: 'e1' } },
        ],
      });
      expectResentLegacy(calls);
      expect(error.gatewayErrorCode).toBe('elicitation_required');
      expect(error.rpcData.elicitationId).toBe('e1');
    });

    test.each([
      ['unsupported version -32022', 400, rpcError(-32022, 'Unsupported protocol version')],
      ['header mismatch -32020', 400, rpcError(-32020, 'Header mismatch')],
      ['malformed _meta -32602', 400, rpcError(-32602, 'Invalid _meta: protocolVersion is required')],
    ])('%s', async (_name, status, data) => {
      const { calls, out } = await run({ flag: 'true', replies: [{ status, data }, { data: okResult }] });
      expectResentLegacy(calls);
      expect(out.result.content[0].text).toBe('ok');
    });

    test('it is resent only once: a legacy answer is never retried again', async () => {
      const { calls } = await run({ flag: 'true', replies: [{ data: inputRequired }, { data: inputRequired }] });
      expect(calls).toHaveLength(2);
    });
  });

  describe('negotiation is per gateway and remembered', () => {
    const rejection = { status: 400, data: rpcError(-32022, 'Unsupported protocol version') };

    test('a rejection is remembered: the next call goes straight to the old shape, no wasted request', async () => {
      const gw = load({ flag: 'true' });
      const first = await gw.call({ replies: [rejection, { data: okResult }] });
      expect(first.calls).toHaveLength(2);
      expect(first.out.mcpProtocol).toEqual({ version: '2025-11-25', stateless: false, reason: 'resent-rejected' });

      const second = await gw.call({ replies: [{ data: okResult }] });
      expect(second.calls).toHaveLength(1);
      expect(second.calls[0].body.params._meta).toBeUndefined();
      expect(second.out.mcpProtocol.reason).toBe('gateway-rejected-recently');
    });

    test('the memory expires, and a gateway that has been upgraded is tried again', async () => {
      const gw = load({ flag: 'true' });
      await gw.call({ replies: [rejection, { data: okResult }] });

      const realNow = Date.now;
      Date.now = () => realNow() + 6 * 60 * 1000;
      try {
        const later = await gw.call({ replies: [{ data: okResult }] });
        expect(later.calls).toHaveLength(1);
        expect(later.calls[0].body.params._meta[META_VERSION]).toBe('2026-07-28');
        expect(later.out.mcpProtocol.stateless).toBe(true);
      } finally {
        Date.now = realNow;
      }
    });

    test('input_required is NOT a rejection: the gateway did speak Modern, so the next call is tried Modern again', async () => {
      const gw = load({ flag: 'true' });
      const first = await gw.call({ replies: [{ data: inputRequired }, { data: okResult }] });
      expect(first.out.mcpProtocol).toEqual({ version: '2025-11-25', stateless: false, reason: 'resent-input-required' });

      const second = await gw.call({ replies: [{ data: okResult }] });
      expect(second.calls).toHaveLength(1);
      expect(second.calls[0].body.params._meta[META_VERSION]).toBe('2026-07-28');
    });

    test('an unrelated failure (403) does not mark the gateway unsupported', async () => {
      const gw = load({ flag: 'true' });
      await gw.call({ replies: [{ status: 403, data: { error: 'insufficient_scope', message: 'nope' } }] });
      const next = await gw.call({ replies: [{ data: okResult }] });
      expect(next.calls[0].body.params._meta[META_VERSION]).toBe('2026-07-28');
    });
  });

  describe('answers that are not a Modern rejection are left alone', () => {
    test('a -32602 about tool arguments is the real answer, not a reason to resend', async () => {
      const { calls } = await run({
        flag: 'true',
        replies: [{ status: 400, data: rpcError(-32602, 'Invalid params: amount must be a number') }],
      });
      expect(calls).toHaveLength(1);
    });

    test('a 403 policy denial is not resent', async () => {
      const { calls } = await run({
        flag: 'true',
        replies: [{ status: 403, data: { error: 'insufficient_scope', message: 'nope' } }],
      });
      expect(calls).toHaveLength(1);
    });

    test('a normal Modern result is returned as is', async () => {
      const complete = { jsonrpc: '2.0', id: 1, result: { resultType: 'complete', content: [{ type: 'text', text: 'ok' }] } };
      const { calls, out } = await run({ flag: 'true', replies: [{ data: complete }] });
      expect(calls).toHaveLength(1);
      expect(out.result.resultType).toBe('complete');
    });
  });
});
