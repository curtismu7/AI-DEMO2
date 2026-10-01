'use strict';

// banking-openapi fronts Ping's Go `mcp/openapi` adapter, whose cross-origin
// check 403s ("Origin does not match Host") on the Origin we send every other
// door. Measured against the sidecar on 2026-09-30: no Origin -> 200, gateway
// Origin -> 403.

const { originHeader } = require('../../routes/privilegeMcpClient').__test;

describe('originHeader', () => {
  it('sends no Origin to the banking-openapi door', () => {
    const url = new URL('https://mcpgw.ai-demo.ping-devops.com/banking-openapi/mcp');
    expect(originHeader(url)).toEqual({});
  });

  it('still sends the gateway Origin to every other door', () => {
    const url = new URL('https://mcpgw.ai-demo.ping-devops.com/banking-mcp/mcp');
    expect(originHeader(url)).toEqual({ Origin: 'https://mcpgw.ai-demo.ping-devops.com' });
  });
});
