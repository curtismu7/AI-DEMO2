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
