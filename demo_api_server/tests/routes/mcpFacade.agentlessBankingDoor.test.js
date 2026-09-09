'use strict';

// The `agentless` façade door is the BANKING door. It was left deliberately dark
// on 2026-09-01 when cmuir-agentless-mcpgw.ping-devops.com was torn down, and its
// own comment named the unblock condition exactly:
//
//   "Repointing needs a banking MCP server registered there as its own Agentic
//    App; only `opensearch22` exists today, and pointing this door at an
//    OpenSearch app would silently serve the wrong tools."
//
// `openapi2` is that app — the banking OpenAPI-MCP application on the one AI
// Gateway. That app is `banking-mcp` — AI-DEMO2's own mcp-resource-server,
// registered as a plain MCP Server app on .../8081/mcp — and NOT `openapi2`,
// Privilege's OpenAPI-MCP adapter image, which never shows a tool: the image is
// a bare Streamable-HTTP binary (GET /mcp -> 405, no /sse, no transport switch)
// while every working catalog image is fronted by Privilege's own mcp-shim, so
// Privilege's runtime cannot discover it. Our side was proven fine (the same
// image + config + sidecar mints 5 tools by hand). Measured 2026-09-08.
//
// mcp-resource-server discovers cleanly on /mcp: a tokenless POST initialize
// answers 200 and tools/list returns 33 tools including both banking tools,
// which is the discovery this gateway build performs (POST initialize to the
// registered path — see #2958, which killed the older "register /sse" rule).
//
// The point of these tests is that the door can never again silently address a
// torn-down host, and that it resolves its path through privilegeEntryPath so a
// console edit stays an env change rather than a code change.

jest.mock('../../services/lmdb/transactionLedger.lmdb', () => ({ appendHop: jest.fn() }));
jest.mock('../../services/transactionAssembler', () => ({ assemble: jest.fn() }));
jest.mock('../../services/configStore', () => ({ getEffective: jest.fn(() => 'true') }));
jest.mock('../../services/jwksService', () => ({ getPublicKey: jest.fn() }));

const { DOORS } = require('../../routes/mcpFacade').__test;

const door = DOORS.agentless;
const GATEWAY = 'https://mcpgw.ai-demo.ping-devops.com';

const ENV_KEYS = [
  'MCP_FACADE_AGENTLESS_URL',
  'MCP_FACADE_AGENTLESS_AS',
  'MCP_FACADE_PRIVILEGE_GATEWAY_BASE',
  'MCP_FACADE_PRIVILEGE_GATEWAY_PATHS',
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

describe('the agentless (banking) facade door', () => {
  test('points at the banking-mcp Agentic App on the current gateway, on /mcp', () => {
    expect(door.upstream()).toBe(`${GATEWAY}/banking-mcp/mcp`);
    expect(door.authorizationServer()).toBe(`${GATEWAY}/banking-mcp`);
  });

  // The regression this file exists for: a door addressing a host that was
  // deleted on 2026-09-01 fails ENOTFOUND, which used to fall through to the
  // PingOne branch and produce a bare `code: NOT_FOUND` page.
  test('never addresses the torn-down per-owner gateway', () => {
    expect(door.upstream()).not.toContain('cmuir-agentless-mcpgw');
    expect(door.authorizationServer()).not.toContain('cmuir-agentless-mcpgw');
  });

  // The value here is deliberately not `sse`: that is not a usable entry path
  // for a JSON-RPC door (POST /sse is 405 on the backends, see #2958). What this
  // pins is only that the door honours the override mechanism at all.
  test('resolves its path through privilegeEntryPath, not a hardcoded /mcp', () => {
    process.env.MCP_FACADE_PRIVILEGE_GATEWAY_PATHS = 'banking-mcp:alt';
    expect(door.upstream()).toBe(`${GATEWAY}/banking-mcp/alt`);
  });

  test('an explicit override still wins outright', () => {
    process.env.MCP_FACADE_AGENTLESS_URL = 'https://elsewhere.test/banking/mcp';
    process.env.MCP_FACADE_AGENTLESS_AS = 'https://elsewhere.test/banking';
    expect(door.upstream()).toBe('https://elsewhere.test/banking/mcp');
    expect(door.authorizationServer()).toBe('https://elsewhere.test/banking');
  });

  test('follows the gateway base, so a gateway move cannot strand it again', () => {
    process.env.MCP_FACADE_PRIVILEGE_GATEWAY_BASE = 'https://newgw.example.com';
    expect(door.upstream()).toBe('https://newgw.example.com/banking-mcp/mcp');
    expect(door.authorizationServer()).toBe('https://newgw.example.com/banking-mcp');
  });
});
