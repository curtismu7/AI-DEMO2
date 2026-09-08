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
// Gateway (Privilege's mcp/openapi adapter -> our mcp-banking-rest sidecar ->
// AI-DEMO2's mcp-resource-server). Verified live 2026-09-08: its spec serves 200
// with two operations, and its door answers a well-formed 401 challenge with
// metadata on /openapi2/mcp, identical to the working mcp-grafana catalog door.
//
// The point of these tests is that the door can never again silently address a
// torn-down host, and that it resolves its path through privilegeEntryPath
// rather than hardcoding one — openapi2 is a /mcp door while the OpenSearch apps
// are /sse, and that mapping follows a console edit rather than a release.

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
  test('points at the openapi2 Agentic App on the current gateway', () => {
    expect(door.upstream()).toBe(`${GATEWAY}/openapi2/mcp`);
    expect(door.authorizationServer()).toBe(`${GATEWAY}/openapi2`);
  });

  // The regression this file exists for: a door addressing a host that was
  // deleted on 2026-09-01 fails ENOTFOUND, which used to fall through to the
  // PingOne branch and produce a bare `code: NOT_FOUND` page.
  test('never addresses the torn-down per-owner gateway', () => {
    expect(door.upstream()).not.toContain('cmuir-agentless-mcpgw');
    expect(door.authorizationServer()).not.toContain('cmuir-agentless-mcpgw');
  });

  test('resolves its path through privilegeEntryPath, not a hardcoded /mcp', () => {
    process.env.MCP_FACADE_PRIVILEGE_GATEWAY_PATHS = 'openapi2:sse';
    expect(door.upstream()).toBe(`${GATEWAY}/openapi2/sse`);
  });

  test('an explicit override still wins outright', () => {
    process.env.MCP_FACADE_AGENTLESS_URL = 'https://elsewhere.test/banking/mcp';
    process.env.MCP_FACADE_AGENTLESS_AS = 'https://elsewhere.test/banking';
    expect(door.upstream()).toBe('https://elsewhere.test/banking/mcp');
    expect(door.authorizationServer()).toBe('https://elsewhere.test/banking');
  });

  test('follows the gateway base, so a gateway move cannot strand it again', () => {
    process.env.MCP_FACADE_PRIVILEGE_GATEWAY_BASE = 'https://newgw.example.com';
    expect(door.upstream()).toBe('https://newgw.example.com/openapi2/mcp');
    expect(door.authorizationServer()).toBe('https://newgw.example.com/openapi2');
  });
});
