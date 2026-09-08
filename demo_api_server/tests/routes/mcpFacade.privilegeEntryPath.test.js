'use strict';

// The AI Gateway pins each Agentic App to ONE client-facing entry path, derived
// from the backend URL it was registered with, and answers a bare 404 on any
// other. From the gateway log, 2026-09-08:
//
//   [mcpgw] rejecting /mcp on app opensearch22: outside entry path "/sse"
//
// It is per app, not per gateway: `openapi2` and the catalog doors speak /mcp,
// while the two OpenSearch apps are registered with an /sse backend. The façade
// fronts every app through ONE multiApp door, so it cannot hardcode /mcp.
//
// /sse here is a PATH, not a transport. The console's own MCP Config block for
// opensearch22 reads {"transport":"http","url":"{gateway_url}/opensearch22/sse"}
// — the façade's plain JSON-RPC POST is still the right client behaviour.

jest.mock('../../services/lmdb/transactionLedger.lmdb', () => ({ appendHop: jest.fn() }));
jest.mock('../../services/transactionAssembler', () => ({ assemble: jest.fn() }));
jest.mock('../../services/configStore', () => ({ getEffective: jest.fn(() => 'true') }));
jest.mock('../../services/jwksService', () => ({ getPublicKey: jest.fn() }));

const { DOORS } = require('../../routes/mcpFacade').__test;

const door = DOORS['privilege-gateway'];
const BASE = 'https://mcpgw.ai-demo.ping-devops.com';

const ENV_KEYS = [
  'MCP_FACADE_PRIVILEGE_GATEWAY_PATHS',
  'MCP_FACADE_PRIVILEGE_GATEWAY_URL',
  'MCP_FACADE_PRIVILEGE_GATEWAY_APP',
  'MCP_FACADE_PRIVILEGE_GATEWAY_BASE',
];
let saved;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('privilege-gateway door: per-app entry path', () => {
  // Measured 2026-09-08 at the opensearch-mcp-server backend both apps front:
  // POST /sse -> 405 (Allow: HEAD, GET), POST /mcp -> accepted. /sse is the
  // legacy GET-only SSE endpoint, so a JSON-RPC POST can never default there.
  test('the OpenSearch apps get /mcp — POST is 405 on their /sse', () => {
    expect(door.upstreamFor('opensearch22')).toBe(`${BASE}/opensearch22/mcp`);
    expect(door.upstreamFor('opensearch')).toBe(`${BASE}/opensearch/mcp`);
  });

  test('every other app keeps /mcp — the console hands that out for most apps', () => {
    expect(door.upstreamFor('openapi2')).toBe(`${BASE}/openapi2/mcp`);
    expect(door.upstreamFor('mcp-grafana')).toBe(`${BASE}/mcp-grafana/mcp`);
    expect(door.upstreamFor('mcp-brave-search')).toBe(`${BASE}/mcp-brave-search/mcp`);
  });

  // The path follows a console edit, not a release — it flipped twice on
  // 2026-09-08 — so realigning has to be an env change, never a code change.
  test('MCP_FACADE_PRIVILEGE_GATEWAY_PATHS overrides any default, both ways', () => {
    process.env.MCP_FACADE_PRIVILEGE_GATEWAY_PATHS = 'openapi2:sse, opensearch22:mcp';
    expect(door.upstreamFor('openapi2')).toBe(`${BASE}/openapi2/sse`);
    expect(door.upstreamFor('opensearch22')).toBe(`${BASE}/opensearch22/mcp`);
    // Unlisted apps are untouched by a partial override.
    expect(door.upstreamFor('opensearch')).toBe(`${BASE}/opensearch/mcp`);
  });

  test('a leading slash in the override is tolerated', () => {
    process.env.MCP_FACADE_PRIVILEGE_GATEWAY_PATHS = 'openapi2:/sse';
    expect(door.upstreamFor('openapi2')).toBe(`${BASE}/openapi2/sse`);
  });

  test('the default door (no /<app> segment) uses the same table', () => {
    process.env.MCP_FACADE_PRIVILEGE_GATEWAY_APP = 'opensearch22';
    expect(door.upstream()).toBe(`${BASE}/opensearch22/mcp`);
    process.env.MCP_FACADE_PRIVILEGE_GATEWAY_APP = 'openapi2';
    expect(door.upstream()).toBe(`${BASE}/openapi2/mcp`);
  });

  test('an explicit full-URL override still wins outright', () => {
    process.env.MCP_FACADE_PRIVILEGE_GATEWAY_URL = 'https://elsewhere.test/whatever';
    expect(door.upstream()).toBe('https://elsewhere.test/whatever');
  });
});
