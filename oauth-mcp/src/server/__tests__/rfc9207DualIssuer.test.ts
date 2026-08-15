/**
 * RFC 9207 mix-up protection must accept BOTH known-good issuers now —
 * PingOne (unchanged) and oauth-mcp's own embedded AS (new, Part A) — while
 * still rejecting a genuine third-party issuer as a mix-up attack.
 *
 * Bare-instance pattern matches authDisabledBearerPassthrough.test.ts:
 * authenticateBearer only touches the fields set here.
 */
import { HttpMCPTransport } from '../HttpMCPTransport';
import { resolveEmbeddedIssuer } from '../../oauth/embeddedIssuer';
import type { IncomingMessage, ServerResponse } from 'http';

describe('HttpMCPTransport.authenticateBearer — RFC 9207 dual-issuer', () => {
  function transport(verifiedClaims: Record<string, unknown>) {
    const t = Object.create(HttpMCPTransport.prototype) as Record<string, unknown>;
    t.authDisabled = false;
    t.config = { authServerUrl: 'https://auth.pingone.com/env/as', resourceUrl: 'https://mcp.example.com' };
    t.authManager = {
      validateAgentToken: async () => ({
        isValid: true,
        scopes: ['mcp:invoke'],
        signatureVerified: true,
        verifiedClaims,
      }),
    };
    return t as unknown as {
      authenticateBearer(req: IncomingMessage, res: ServerResponse): Promise<{ token: string } | null>;
    };
  }

  const req = () => ({ headers: { authorization: 'Bearer tok' } }) as unknown as IncomingMessage;
  let unauthorizedBody: unknown;
  const res = () =>
    ({
      writeHead: () => {},
      end: (body?: string) => { unauthorizedBody = body; },
    }) as unknown as ServerResponse;

  const ORIG = { ...process.env };
  afterEach(() => { process.env = { ...ORIG }; unauthorizedBody = undefined; });

  it('accepts a token whose iss is PingOne (unchanged behavior)', async () => {
    process.env.PINGONE_ISSUER = 'https://auth.pingone.com/env/as';
    const t = transport({ iss: 'https://auth.pingone.com/env/as' });
    const out = await t.authenticateBearer(req(), res());
    expect(out).not.toBeNull();
  });

  it('accepts a token whose iss is the embedded AS', async () => {
    process.env.PINGONE_ISSUER = 'https://auth.pingone.com/env/as';
    const t = transport({ iss: resolveEmbeddedIssuer() });
    const out = await t.authenticateBearer(req(), res());
    expect(out).not.toBeNull();
  });

  it('still rejects a genuine third-party issuer as a mix-up attack', async () => {
    process.env.PINGONE_ISSUER = 'https://auth.pingone.com/env/as';
    const t = transport({ iss: 'https://evil.example.com/as' });
    const out = await t.authenticateBearer(req(), res());
    expect(out).toBeNull();
    expect(unauthorizedBody).toContain('RFC 9207');
  });
});
