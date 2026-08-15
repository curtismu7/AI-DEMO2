import { HttpMCPTransport } from '../HttpMCPTransport';
import type { IncomingMessage, ServerResponse } from 'http';

/**
 * In open-access mode the transport must still carry a REAL presented bearer
 * downstream. Replacing it with the 'disabled' placeholder erased the token's
 * identity, scopes and act chain, and every scope check downstream then failed
 * to decode the placeholder.
 */
describe('HttpMCPTransport.authenticateBearer — MCP_AUTH_DISABLED', () => {
  // Bare instance: authenticateBearer only touches authDisabled + authManager.
  function transport(authDisabled: boolean, validate: (t: string) => Promise<unknown>) {
    const t = Object.create(HttpMCPTransport.prototype) as Record<string, unknown>;
    t.authDisabled = authDisabled;
    t.authManager = { validateAgentToken: (tok: string) => validate(tok) };
    return t as unknown as {
      authenticateBearer(req: IncomingMessage, res: ServerResponse): Promise<{ token: string } | null>;
    };
  }

  const req = (auth?: string) =>
    ({ headers: auth ? { authorization: auth } : {} }) as unknown as IncomingMessage;
  const res = () => ({ writeHead: () => {}, end: () => {} }) as unknown as ServerResponse;

  it('keeps the presented bearer instead of the placeholder', async () => {
    const t = transport(true, async () => ({ isValid: true, scopes: ['read', 'write'] }));
    const out = await t.authenticateBearer(req('Bearer real.jwt.token'), res());
    expect(out?.token).toBe('real.jwt.token');
  });

  it('falls back to the placeholder when no bearer is presented', async () => {
    const t = transport(true, async () => ({ isValid: true, scopes: [] }));
    const out = await t.authenticateBearer(req(), res());
    expect(out?.token).toBe('disabled');
  });

  it('falls back to the placeholder rather than 401 when the bearer will not validate', async () => {
    const t = transport(true, async () => { throw new Error('Malformed JWT'); });
    const out = await t.authenticateBearer(req('Bearer nonsense'), res());
    expect(out?.token).toBe('disabled');
  });
});
