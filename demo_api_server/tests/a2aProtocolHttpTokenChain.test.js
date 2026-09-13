'use strict';

/**
 * TECH_DEBT.md 2026-09-11 "HTTP transport drops the specialist's token-chain
 * rows" — the fix under test.
 *
 * The in-process path (a2aProtocolClient.js#sendInProcess) shares one
 * tokenEvents array by reference between the caller and the specialist
 * executor, so the specialist's own a2a-agent2-actor / a2a-exchange2 /
 * tool-dispatch rows land on the SAME chain the UI renders. An HTTP request
 * cannot share that reference across the wire — before this fix the router
 * built the executor with a disposable `tokenEvents: []` that nothing ever
 * read back, so an HTTP-transport hop's chain was silently narrower than the
 * in-process one.
 *
 * This drives the REAL @a2a-js/sdk client and server (no mocked JSON-RPC
 * transport) over an actual loopback HTTP server, exactly the path
 * `A2A_PROTOCOL_HTTP=1` / `opts.baseUrl` selects, and proves the specialist's
 * rows now reach the caller's tokenEvents array via the JSON-RPC reply
 * metadata (a2aProtocolServer.js#publishReply -> a2aProtocolClient.js#finishHop).
 *
 * Exchange #2 (exchangeAsSpecialist) and the tool call (executeBffToolWithToken)
 * are mocked at the same seam every other A2A test in this repo mocks them at
 * (tests/a2aSpecialistRouterContext.test.js, tests/a2aSpecialistExecutor.test.js)
 * — real PingOne/MCP calls are out of scope here; what's under test is whether
 * the rows THEY push onto their shared tokenEvents array survive the HTTP hop.
 */

jest.mock('../services/tokenValidationService', () => ({ validateToken: jest.fn() }));
// The bearer gate's SERVER-side check never threads a cfg into verifyA2aBearer,
// so it falls back to this real configStore singleton (see
// tests/a2aSpecialistRouterContext.test.js for the same reasoning).
jest.mock('../services/configStore', () => ({
  getEffective: (key) => (key === 'pingone_ai_agent_client_id' ? 'generalist-agent' : ''),
}));
jest.mock('../services/a2aDelegationService', () => ({
  ...jest.requireActual('../services/a2aDelegationService'),
  exchangeAsSpecialist: jest.fn(),
}));
jest.mock('../services/bffMcpToolExecutor', () => ({ executeBffToolWithToken: jest.fn() }));

const http = require('node:http');
const express = require('express');
const { validateToken } = require('../services/tokenValidationService');
const { exchangeAsSpecialist } = require('../services/a2aDelegationService');
const { executeBffToolWithToken } = require('../services/bffMcpToolExecutor');
const { createA2aProtocolRouter } = require('../services/a2aProtocolServer');
const { sendA2aProtocolHandoff } = require('../services/a2aProtocolClient');
const { specialistForVertical } = require('../config/a2aSpecialists');

const VERTICAL = 'investment';
const TOOL = specialistForVertical(VERTICAL).tools[0];

// 'investment' → appKey 'holdings'; its intermediate audience has a real
// checked-in fallback in scope-topology.json (see a2aSpecialistRouterContext).
const CLAIMS = {
  sub: 'user-1',
  aud: ['a2a-intermediate-holdings.ping.demo'],
  scope: 'agent:invoke:holdings',
  act: { client_id: 'generalist-agent' },
};

function fakeJwt(payload) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.sig`;
}

describe('A2A HTTP transport threads a real token chain (TECH_DEBT 2026-09-11)', () => {
  let server;
  let cfg;

  beforeAll(async () => {
    // Listen FIRST: createA2aProtocolRouter probes every vertical's card at
    // construction time (buildSpecialistAgentCard -> cfg.getEffective), so cfg
    // must already be able to resolve a real port before the router mounts.
    const app = express();
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    // Doubles as the router's construction-time configStore AND the value
    // sendA2aProtocolHandoff's own client-side pre-flight verifyA2aBearer
    // call receives as cfgArg (a2aProtocolClient.js passes { vertical, cfg }
    // through) — cfgArg wins over the separately jest.mock'd configStore
    // module in verifyA2aBearer's `cfgArg || deps.configStore ||
    // defaultConfigStore()` fallback, so it must answer
    // pingone_ai_agent_client_id itself too, matching the jest.mock('../services/configStore', ...)
    // above, or the actor check fails with "is not the generalist (unset)".
    cfg = {
      getEffective: (key) => {
        if (key === 'PUBLIC_APP_URL') return `http://127.0.0.1:${server.address().port}`;
        if (key === 'pingone_ai_agent_client_id') return 'generalist-agent';
        return '';
      },
    };
    app.use('/a2a/specialists', createA2aProtocolRouter({ configStore: cfg }));
  });

  afterAll((done) => { server.close(done); });

  beforeEach(() => {
    jest.clearAllMocks();
    validateToken.mockResolvedValue(CLAIMS);
  });

  function baseUrl() {
    return `http://127.0.0.1:${server.address().port}/a2a/specialists/${VERTICAL}/`;
  }

  function driveOneHop() {
    exchangeAsSpecialist.mockImplementationOnce(async (subjectToken, opts) => {
      const events = opts.tokenEvents || [];
      events.push({ id: 'a2a-agent2-actor', status: 'acquired' });
      events.push({ id: 'a2a-exchange2', status: 'exchanged', actChainDepth: 2 });
      return { token: 'T.NESTED', claims: { sub: 'user-1' }, actChainDepth: 2, scopes: ['holdings:read'] };
    });
    executeBffToolWithToken.mockImplementationOnce(async (opts) => {
      (opts.tokenEvents || []).push({ id: 'a2a-tool-dispatch', status: 'dispatched', tool: opts.name });
      return JSON.stringify({ holdings: [{ symbol: 'VTI' }] });
    });

    const tokenEvents = [];
    return sendA2aProtocolHandoff({
      vertical: VERTICAL,
      subtask: 'review my holdings',
      tool: TOOL,
      toolArgs: {},
      subjectToken: fakeJwt(CLAIMS),
      tokenEvents,
      cfg,
      baseUrl: baseUrl(),
    }).then((out) => ({ out, tokenEvents }));
  }

  test('the specialist rows (a2a-agent2-actor, a2a-exchange2, tool dispatch) reach the caller, not an empty array', async () => {
    const { out, tokenEvents } = await driveOneHop();

    expect(out.ok).toBe(true);
    expect(out.result).toEqual({ holdings: [{ symbol: 'VTI' }] });

    // THE BUG: before the fix, tokenEvents only ever gained the client-side
    // a2a-protocol-bearer / a2a-agent-card / a2a-protocol-message rows — the
    // specialist's own rows were pushed onto a disposable per-request array in
    // the router and never made it back here.
    const ids = tokenEvents.map((e) => e.id);
    expect(ids).toContain('a2a-agent2-actor');
    expect(ids).toContain('a2a-exchange2');
    expect(ids).toContain('a2a-tool-dispatch');
    expect(tokenEvents.length).toBeGreaterThan(0);
  });

  test('two sequential HTTP requests each start fresh — no leak between chains', async () => {
    const first = await driveOneHop();
    const second = await driveOneHop();

    const countOf = (events, id) => events.filter((e) => e.id === id).length;
    for (const events of [first.tokenEvents, second.tokenEvents]) {
      expect(countOf(events, 'a2a-agent2-actor')).toBe(1);
      expect(countOf(events, 'a2a-exchange2')).toBe(1);
      expect(countOf(events, 'a2a-tool-dispatch')).toBe(1);
    }
    // Not merely "each caller array is separate" (true by construction) — the
    // per-request specialist rows are equal in count, not accumulating across
    // requests on the SERVER side.
    expect(second.tokenEvents.length).toBe(first.tokenEvents.length);
  });

  // The in-process path is the flag-off default and must be provably untouched
  // by this fix: it never sets exposeTokenEvents, so publishReply's metadata
  // never gains the new field, and finishHop's merge is a no-op there.
  test('the in-process path (flag off) is unaffected — no tokenEvents field leaks into its metadata', async () => {
    exchangeAsSpecialist.mockImplementationOnce(async (subjectToken, opts) => {
      const events = opts.tokenEvents || [];
      events.push({ id: 'a2a-agent2-actor', status: 'acquired' });
      events.push({ id: 'a2a-exchange2', status: 'exchanged', actChainDepth: 2 });
      return { token: 'T.NESTED', claims: { sub: 'user-1' }, actChainDepth: 2, scopes: ['holdings:read'] };
    });
    executeBffToolWithToken.mockResolvedValueOnce(JSON.stringify({ holdings: [{ symbol: 'VTI' }] }));

    const tokenEvents = [];
    const out = await sendA2aProtocolHandoff({
      vertical: VERTICAL,
      subtask: 'review my holdings',
      tool: TOOL,
      toolArgs: {},
      subjectToken: fakeJwt(CLAIMS),
      tokenEvents,
      cfg,
      req: { sessionID: 's1' },
      sessionId: 's1',
      // no baseUrl, no A2A_PROTOCOL_HTTP — in-process by default
    });

    expect(out.ok).toBe(true);
    // Same rows land the SAME way as before this fix: by shared reference, not
    // via any new metadata field.
    expect(tokenEvents.map((e) => e.id)).toEqual(
      expect.arrayContaining(['a2a-agent2-actor', 'a2a-exchange2', 'a2a-protocol-message']),
    );
  });
});
