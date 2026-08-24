// Regression guard: a stale MCP_SERVER_RESOURCE_URI (another service's
// accepted-audience list, fanned out by refresh-service-envs) must never make
// this server reject its own canonical audience. Live failure this guards:
// get_airline_bookings -> "Audience mismatch: got [mcp-invest.ping.demo],
// expected one of [mcpserver.ping.demo, mcpgateway.ping.demo]".
import { LEGACY_RESOURCE_URI_ENV, OWN_AUDIENCE, resolveAcceptedAudiences } from '../src/server/acceptedAudiences';

describe('resolveAcceptedAudiences', () => {
  it('defaults to the server’s own audience when env is unset', () => {
    expect(resolveAcceptedAudiences(undefined)).toEqual([OWN_AUDIENCE]);
    expect(resolveAcceptedAudiences('')).toEqual([OWN_AUDIENCE]);
  });

  it('keeps a correct list unchanged (first entry stays canonical)', () => {
    const list = resolveAcceptedAudiences(
      'mcp-invest.ping.demo,mcp-resource-server.ping.demo,mcpgateway.ping.demo',
    );
    expect(list).toEqual([
      'mcp-invest.ping.demo',
      'mcp-resource-server.ping.demo',
      'mcpgateway.ping.demo',
    ]);
  });

  it('always accepts its own audience when the LEGACY var carries another server’s list', () => {
    const list = resolveAcceptedAudiences('mcpserver.ping.demo,mcpgateway.ping.demo', LEGACY_RESOURCE_URI_ENV);
    expect(list).toContain(OWN_AUDIENCE);
    // Canonical URI (first entry) still reflects the env, only acceptance is widened.
    expect(list[0]).toBe('mcpserver.ping.demo');
  });

  it('honours an explicit own-var value as-is (bring-your-own audience)', () => {
    expect(resolveAcceptedAudiences('https://mcp.acme.example', 'MCP_RESOURCE_SERVER_RESOURCE_URI'))
      .toEqual(['https://mcp.acme.example']);
  });

  it('trims whitespace and drops empty entries', () => {
    expect(resolveAcceptedAudiences(' mcp-invest.ping.demo , ,mcpgateway.ping.demo ')).toEqual([
      'mcp-invest.ping.demo',
      'mcpgateway.ping.demo',
    ]);
  });
});
