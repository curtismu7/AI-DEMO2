'use strict';

/**
 * Web Bot Auth mode behavior through the full HTTP middleware pipeline
 * (buildAuthorizeMcpRequest):
 *   - enforce: unsigned request → 401 invalid_web_bot_auth, not forwarded
 *   - enforce: correctly signed request → forwarded upstream
 *   - monitor: unsigned request → forwarded, outcome audited (wba_verified=false)
 *   - off:     verifier never consulted
 */

import * as crypto from 'crypto';
import { buildAuthorizeMcpRequest } from '../src/middleware/authorizeMcpRequest';
import { jwkThumbprint } from '../src/httpMessageSignature';
import { DIRECTORY_PATH, _resetWbaCachesForTest, _primeJwksCacheForTest } from '../src/webBotAuthVerify';
import * as gatewayAudit from '../src/gatewayAudit';
import type { GatewayConfig } from '../src/config';

const AGENT_ORIGIN = 'https://agent.ping.demo';
const AUTHORITY = 'gateway.ping.demo:3005';

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const publicJwk = publicKey.export({ format: 'jwk' }) as { kty: string; crv: string; x: string };
const KEYID = jwkThumbprint(publicJwk);

function wbaHeaders(): Record<string, string> {
  const now = Math.floor(Date.now() / 1000);
  const agentValue = `"${AGENT_ORIGIN}"`;
  const nonce = crypto.randomBytes(32).toString('base64');
  const params =
    `("@authority" "signature-agent");created=${now};expires=${now + 300}` +
    `;keyid="${KEYID}";nonce="${nonce}";tag="web-bot-auth"`;
  const base =
    `"@authority": ${AUTHORITY.toLowerCase()}\n` +
    `"signature-agent": ${agentValue}\n` +
    `"@signature-params": ${params}`;
  const sig = crypto.sign(null, Buffer.from(base, 'utf-8'), privateKey);
  return {
    'signature-agent': agentValue,
    'signature-input': `sig1=${params}`,
    signature: `sig1=:${sig.toString('base64')}:`,
  };
}

function makeConfig(wbaMode: GatewayConfig['wbaMode']): GatewayConfig {
  return {
    devBypass: false,
    gatewayResourceUri: 'https://gateway.ping.demo',
    introspectionEndpoint: '',
    wbaMode,
  } as unknown as GatewayConfig;
}

const deps = {
  introspect: async () => ({ active: true, sub: 'u1', exp: 9999999999, scope: 'read' }),
  authorize: async () => ({ decision: 'PERMIT' as const }),
  // Step 4 now performs an RFC 8693 exchange before forwarding — stub it so
  // the forward path is reachable without a real token endpoint.
  exchange: async () => ({ token: 'exchanged-tok', targetAud: 'mcpserver.ping.demo', cached: false }),
};

const body = Buffer.from(JSON.stringify({
  jsonrpc: '2.0', id: 1, method: 'tools/call',
  params: { name: 'get_my_accounts', arguments: {} },
}));

function makeReqRes(extraHeaders: Record<string, string> = {}) {
  const req = {
    method: 'POST',
    url: '/mcp',
    headers: { host: AUTHORITY, ...extraHeaders },
  } as any;
  const res = {
    writeHead: jest.fn(),
    end: jest.fn(),
    setHeader: jest.fn(),
    statusCode: 200,
  } as any;
  return { req, res };
}

let auditSpy: jest.SpyInstance;

beforeEach(() => {
  _resetWbaCachesForTest();
  _primeJwksCacheForTest(`${AGENT_ORIGIN}${DIRECTORY_PATH}`, [publicJwk]);
  auditSpy = jest.spyOn(gatewayAudit, 'recordGatewayAudit').mockImplementation(() => {});
});

afterEach(() => {
  auditSpy.mockRestore();
});

describe('WBA mode=enforce', () => {
  it('denies an unsigned request with 401 invalid_web_bot_auth and does not forward', async () => {
    const middleware = buildAuthorizeMcpRequest(makeConfig('enforce'), deps);
    const { req, res } = makeReqRes();
    const origEnd = res.end; // middleware wraps res.end — keep the mock reference
    const forward = jest.fn(async () => {});

    await middleware('tx-token', body, req, res, forward);

    expect(forward).not.toHaveBeenCalled();
    expect(res.writeHead).toHaveBeenCalledWith(401, expect.objectContaining({
      'WWW-Authenticate': expect.stringContaining('HTTP-Message-Signatures'),
    }));
    const responseBody = JSON.parse(origEnd.mock.calls[0][0]);
    expect(responseBody.error).toBe('invalid_web_bot_auth');
    // Outcome audited as a failure with WBA posture
    const evt = auditSpy.mock.calls[0][0];
    expect(evt.details.wba_mode).toBe('enforce');
    expect(evt.details.wba_verified).toBe(false);
  });

  it('forwards a correctly signed request', async () => {
    const middleware = buildAuthorizeMcpRequest(makeConfig('enforce'), deps);
    const { req, res } = makeReqRes(wbaHeaders());
    const forward = jest.fn(async () => { res.end('{}'); });

    await middleware('tx-token', body, req, res, forward);

    expect(res.writeHead).not.toHaveBeenCalled();
    expect(forward).toHaveBeenCalledTimes(1);
    const evt = auditSpy.mock.calls[0][0];
    expect(evt.details.wba_mode).toBe('enforce');
    expect(evt.details.wba_verified).toBe(true);
    expect(evt.details.wba_agent).toBe(AGENT_ORIGIN);
  });

  it('denies a signed request whose signature does not match this request (tampered)', async () => {
    const middleware = buildAuthorizeMcpRequest(makeConfig('enforce'), deps);
    const h = wbaHeaders();
    const { req, res } = makeReqRes(h);
    req.headers.host = 'evil.example'; // authority differs from what was signed
    const forward = jest.fn(async () => {});

    await middleware('tx-token', body, req, res, forward);

    expect(forward).not.toHaveBeenCalled();
    expect(res.writeHead).toHaveBeenCalledWith(401, expect.anything());
  });
});

describe('WBA mode=monitor (default)', () => {
  it('forwards an unsigned request but audits wba_verified=false with the reason', async () => {
    const middleware = buildAuthorizeMcpRequest(makeConfig('monitor'), deps);
    const { req, res } = makeReqRes();
    const forward = jest.fn(async () => { res.end('{}'); });

    await middleware('tx-token', body, req, res, forward);

    expect(forward).toHaveBeenCalledTimes(1);
    expect(res.writeHead).not.toHaveBeenCalled();
    const evt = auditSpy.mock.calls[0][0];
    expect(evt.operation).toBe('get_my_accounts');
    expect(evt.details.wba_mode).toBe('monitor');
    expect(evt.details.wba_verified).toBe(false);
    expect(evt.details.wba_reason).toMatch(/signature-agent/i);
  });

  it('verifies and audits a signed request', async () => {
    const middleware = buildAuthorizeMcpRequest(makeConfig('monitor'), deps);
    const { req, res } = makeReqRes(wbaHeaders());
    const forward = jest.fn(async () => { res.end('{}'); });

    await middleware('tx-token', body, req, res, forward);

    expect(forward).toHaveBeenCalledTimes(1);
    const evt = auditSpy.mock.calls[0][0];
    expect(evt.details.wba_verified).toBe(true);
  });
});

describe('WBA mode=off', () => {
  it('records no WBA posture and forwards', async () => {
    const middleware = buildAuthorizeMcpRequest(makeConfig('off'), deps);
    const { req, res } = makeReqRes();
    const forward = jest.fn(async () => { res.end('{}'); });

    await middleware('tx-token', body, req, res, forward);

    expect(forward).toHaveBeenCalledTimes(1);
    const evt = auditSpy.mock.calls[0][0];
    expect(evt.details.wba_mode).toBeUndefined();
    expect(evt.details.wba_verified).toBeUndefined();
  });
});
