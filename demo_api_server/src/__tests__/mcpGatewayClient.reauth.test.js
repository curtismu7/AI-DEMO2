'use strict';

// A 401 from the gateway means the bearer was not accepted — regardless of
// whether the gateway tagged it `login_required`. The client must map
// invalid/expired-token 401s to code TOKEN_INACTIVE + login_required:true so the
// pipeline surfaces the friendly "Session expired — sign in again" re-auth path
// instead of the raw "Gateway authentication failed — Invalid or expired token".

jest.mock('axios');
jest.mock('../../services/configStore', () => ({
  get: jest.fn(() => null),
  getEffective: jest.fn(() => null),
}));
jest.mock('../../services/mcpToolAuthorizationService', () => ({
  resolveExpectedMcpResourceUri: jest.fn(() => process.env.MCP_GW_RESOURCE_URI || null),
}));

const axios = require('axios');
const { callToolViaGateway } = require('../../services/mcpGatewayClient');

function mock401(data) {
  axios.post = jest.fn().mockResolvedValue({ status: 401, headers: {}, data });
}

const call = () => callToolViaGateway('https://api.ping.demo:3005', 'bearer-tok', 'get_my_accounts', {}, {});

test('maps an invalid_token 401 to TOKEN_INACTIVE + login_required (friendly re-auth)', async () => {
  mock401({ error: 'invalid_token', message: 'Invalid or expired token' });
  await expect(call()).rejects.toMatchObject({ code: 'TOKEN_INACTIVE', login_required: true, httpStatus: 401 });
});

test('still maps an explicit login_required 401 to TOKEN_INACTIVE', async () => {
  mock401({ error: 'login_required', message: 'Please sign in' });
  await expect(call()).rejects.toMatchObject({ code: 'TOKEN_INACTIVE', login_required: true });
});

test('maps an unauthorized / expired-message 401 to TOKEN_INACTIVE', async () => {
  mock401({ error: 'unauthorized', error_description: 'agent token has expired' });
  await expect(call()).rejects.toMatchObject({ code: 'TOKEN_INACTIVE', login_required: true });
});

// Wrong audience — a decodable token whose aud doesn't match the gateway's. This is
// a config drift (NOT expiry); re-login won't help, so it must NOT be TOKEN_INACTIVE,
// and the message must say "wrong audience" + how to fix it.
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwtWithAud = (aud) => `${b64u({ alg: 'none', typ: 'JWT' })}.${b64u({ aud, sub: 'user1', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;

test('classifies an aud-mismatch 401 as GATEWAY_AUDIENCE_MISMATCH with an actionable, no-relogin message', async () => {
  const prev = process.env.MCP_GW_RESOURCE_URI;
  process.env.MCP_GW_RESOURCE_URI = 'mcpgateway.ping.demo'; // gateway expects this aud
  try {
    axios.post = jest.fn().mockResolvedValue({ status: 401, headers: {}, data: { error: 'invalid_token', message: 'Invalid or expired token' } });
    // Token carries the WRONG aud (the MCP-server aud), reproducing the real drift.
    const badAudToken = jwtWithAud('mcpserver.ping.demo');
    const p = callToolViaGateway('https://api.ping.demo:3005', badAudToken, 'get_my_accounts', {}, {});
    await expect(p).rejects.toMatchObject({ code: 'GATEWAY_AUDIENCE_MISMATCH', login_required: false, httpStatus: 401 });
    await expect(p).rejects.toThrow(/Wrong audience/i);
    await expect(p).rejects.toThrow(/MCP_SERVER_RESOURCE_URI/);
  } finally {
    if (prev === undefined) delete process.env.MCP_GW_RESOURCE_URI;
    else process.env.MCP_GW_RESOURCE_URI = prev;
  }
});

// Downstream rejection — a decodable token with the CORRECT gateway aud that is NOT
// expired, yet the gateway/MCP server rejects it (e.g. the MCP server could not
// verify the signature against PingOne's JWKS). A fresh login mints the SAME token
// the server still can't accept, so this must NOT be TOKEN_INACTIVE / login_required.
// It must be GATEWAY_TOKEN_REJECTED with httpStatus 502 so the SPA surfaces it inline
// instead of logging the user out on a server-side problem.
test('classifies a valid-aud, non-expired token rejected downstream as GATEWAY_TOKEN_REJECTED (no forced re-login)', async () => {
  const prev = process.env.MCP_GW_RESOURCE_URI;
  process.env.MCP_GW_RESOURCE_URI = 'mcpgateway.ping.demo';
  try {
    axios.post = jest.fn().mockResolvedValue({ status: 401, headers: {}, data: { error: 'unauthorized', message: 'Invalid or expired token' } });
    const goodAudToken = jwtWithAud('mcpgateway.ping.demo'); // correct aud, exp +1h
    const p = callToolViaGateway('https://api.ping.demo:3005', goodAudToken, 'get_my_accounts', {}, {});
    await expect(p).rejects.toMatchObject({ code: 'GATEWAY_TOKEN_REJECTED', login_required: false, httpStatus: 502 });
    await expect(p).rejects.toThrow(/still valid/i);
    await expect(p).rejects.toThrow(/PINGONE_JWKS_URI/);
  } finally {
    if (prev === undefined) delete process.env.MCP_GW_RESOURCE_URI;
    else process.env.MCP_GW_RESOURCE_URI = prev;
  }
});
