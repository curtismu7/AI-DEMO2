import { getStartupReconnectCandidates } from './McpStartupReconnect';

describe('getStartupReconnectCandidates', () => {
  test('warms no-auth servers and previously authorized OAuth servers', () => {
    expect(
      getStartupReconnectCandidates(
        [
          { serverName: 'aidemo-mcp' },
          { serverName: 'super-sports-gateway' },
          { serverName: 'privilege-opensearch22' },
          { serverName: 'unknown' },
        ],
        {
          'super-sports-gateway': { authorizationState: 'authorized', connectionState: 'disconnected' },
          'privilege-opensearch22': { authorizationState: 'unauthorized', connectionState: 'disconnected' },
          unknown: { connectionState: 'disconnected' },
        },
      ),
    ).toEqual(['aidemo-mcp', 'super-sports-gateway']);
  });

  test('does not duplicate an active connection or start request-scoped OAuth', () => {
    expect(
      getStartupReconnectCandidates(
        [
          { serverName: 'opensearch-direct' },
          { serverName: 'super-sports-gateway' },
          { serverName: 'scoped', requestScoped: true },
        ],
        {
          'opensearch-direct': { connectionState: 'connected' },
          'super-sports-gateway': { authorizationState: 'authorized', connectionState: 'connecting' },
          scoped: { authorizationState: 'authorized', connectionState: 'disconnected' },
        },
      ),
    ).toEqual([]);
  });
});
