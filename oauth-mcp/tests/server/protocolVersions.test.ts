import { isSupportedProtocolVersion, MCP_SUPPORTED_VERSIONS } from '../../src/server/protocolVersions';

describe('isSupportedProtocolVersion', () => {
  it.each(MCP_SUPPORTED_VERSIONS)('accepts %s', (version) => {
    expect(isSupportedProtocolVersion(version)).toBe(true);
  });

  // Rejecting these made initialize succeed and every later call 400, which a
  // gateway reports as a reachable server with an empty tool catalog.
  it.each(['2025-06-18', '2025-03-26'])('accepts %s, still the common client default', (version) => {
    expect(isSupportedProtocolVersion(version)).toBe(true);
  });

  it.each(['1999-01-01', '2023-12-01', 'not-a-version', ''])('rejects %s', (version) => {
    expect(isSupportedProtocolVersion(version)).toBe(false);
  });
});

// The advertised version is deliberately separable from "the newest this server
// speaks". Behind PingGateway they differ: openig-mcp-2026.6.0's own
// McpValidationFilter speaks only 2025-06-18 and 2025-11-25 (confirmed by
// extracting McpVersion.class from the shipped jar), so advertising 2026-07-28
// through it makes initialize succeed and every later call 400 AT THE PROXY.
describe('MCP_ADVERTISED_PROTOCOL_VERSION', () => {
  const load = () => {
    let mod: typeof import('../../src/server/protocolVersions');
    jest.isolateModules(() => { mod = require('../../src/server/protocolVersions'); });
    return mod!;
  };
  const original = process.env.MCP_ADVERTISED_PROTOCOL_VERSION;
  afterEach(() => {
    if (original === undefined) delete process.env.MCP_ADVERTISED_PROTOCOL_VERSION;
    else process.env.MCP_ADVERTISED_PROTOCOL_VERSION = original;
  });

  it('defaults to the latest version the server speaks', () => {
    delete process.env.MCP_ADVERTISED_PROTOCOL_VERSION;
    const m = load();
    expect(m.MCP_ADVERTISED_PROTOCOL_VERSION).toBe(m.MCP_LATEST_PROTOCOL_VERSION);
  });

  it('can be capped below the latest, for deployments behind a proxy', () => {
    process.env.MCP_ADVERTISED_PROTOCOL_VERSION = '2025-11-25';
    const m = load();
    expect(m.MCP_ADVERTISED_PROTOCOL_VERSION).toBe('2025-11-25');
    expect(m.MCP_ADVERTISED_PROTOCOL_VERSION).not.toBe(m.MCP_LATEST_PROTOCOL_VERSION);
  });

  // Fail at startup, not at request time: advertising a version the server
  // cannot honour is precisely the defect this knob exists to prevent, so a
  // typo must not reach production quietly.
  it('throws at load on a version the server does not speak', () => {
    process.env.MCP_ADVERTISED_PROTOCOL_VERSION = '2099-01-01';
    expect(() => load()).toThrow(/not a version this server speaks/);
  });

  it('names the valid values in the error, so the fix is obvious', () => {
    process.env.MCP_ADVERTISED_PROTOCOL_VERSION = 'nope';
    expect(() => load()).toThrow(/2025-11-25/);
  });
});
