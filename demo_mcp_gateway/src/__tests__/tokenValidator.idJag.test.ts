/**
 * tokenValidator.ts's ID-JAG filter — a native-ID-JAG-redeemed token (native
 * MCP Enterprise-Managed Authorization) is signed by oauth-mcp's own key, never
 * PingOne's, so it must be verified against oauth-mcp's own JWKS instead of
 * PingOne's. Real HTTP servers stand in for both JWKS endpoints rather than
 * mocking node:http/https internals, so this exercises the actual fetch path.
 */

import * as http from 'node:http';
import * as crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { validateInboundToken, TokenValidationError } from '../tokenValidator';

const AUD = 'mcpserver.ping.demo';

function genKeyPair(kid: string) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
  return { privateKey, jwks: { keys: [{ ...jwk, kid, use: 'sig', alg: 'RS256' }] } };
}

function serveJwks(jwks: unknown): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(jwks));
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}/jwks`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

describe('tokenValidator — ID-JAG JWKS filter', () => {
  const ORIG = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIG };
  });

  it('verifies an ID-JAG-issued token against oauth-mcp\'s own JWKS, not PingOne\'s', async () => {
    const idJag = genKeyPair('idjag-kid');
    const pingone = genKeyPair('pingone-kid');
    const idJagServer = await serveJwks(idJag.jwks);
    // PingOne's endpoint is intentionally WRONG (serves a key that cannot verify
    // the token) — if the filter picked the wrong source, this test would fail
    // with a signature error, not silently pass.
    const pingoneServer = await serveJwks(pingone.jwks);

    process.env.OAUTH_MCP_ID_JAG_ISSUER = 'https://localhost:8080';
    process.env.OAUTH_MCP_ID_JAG_JWKS_URL = idJagServer.url;
    process.env.PINGONE_JWKS_URI = pingoneServer.url;

    const token = jwt.sign(
      { sub: 'user-1', aud: AUD, scope: 'read mcp:invoke' },
      idJag.privateKey,
      { algorithm: 'RS256', keyid: 'idjag-kid', issuer: 'https://localhost:8080', expiresIn: '5m' },
    );

    try {
      const decoded = await validateInboundToken(token, AUD);
      expect(decoded.sub).toBe('user-1');
      expect(decoded.iss).toBe('https://localhost:8080');
    } finally {
      await idJagServer.close();
      await pingoneServer.close();
    }
  });

  it('a token whose iss is NOT the ID-JAG issuer still verifies against PingOne\'s JWKS, unaffected', async () => {
    const idJag = genKeyPair('idjag-kid');
    const pingone = genKeyPair('pingone-kid');
    const idJagServer = await serveJwks(idJag.jwks);
    const pingoneServer = await serveJwks(pingone.jwks);

    process.env.OAUTH_MCP_ID_JAG_ISSUER = 'https://localhost:8080';
    process.env.OAUTH_MCP_ID_JAG_JWKS_URL = idJagServer.url;
    process.env.PINGONE_JWKS_URI = pingoneServer.url;

    const token = jwt.sign(
      { sub: 'user-2', aud: AUD, scope: 'read mcp:invoke' },
      pingone.privateKey,
      { algorithm: 'RS256', keyid: 'pingone-kid', issuer: 'https://auth.pingone.com/env/as', expiresIn: '5m' },
    );

    try {
      const decoded = await validateInboundToken(token, AUD);
      expect(decoded.sub).toBe('user-2');
    } finally {
      await idJagServer.close();
      await pingoneServer.close();
    }
  });

  it('rejects a forged token that merely CLAIMS the ID-JAG issuer without a valid oauth-mcp signature', async () => {
    const idJag = genKeyPair('idjag-kid');
    const attacker = genKeyPair('attacker-kid');
    const idJagServer = await serveJwks(idJag.jwks);

    process.env.OAUTH_MCP_ID_JAG_ISSUER = 'https://localhost:8080';
    process.env.OAUTH_MCP_ID_JAG_JWKS_URL = idJagServer.url;
    // No PingOne JWKS needed — the forged token's unverified iss routes it to
    // the ID-JAG endpoint, where it must fail on signature, not fall through.
    delete process.env.PINGONE_JWKS_URI;
    delete process.env.PINGONE_JWKS_ENDPOINT;

    const forged = jwt.sign(
      { sub: 'attacker', aud: AUD, scope: 'read mcp:invoke' },
      attacker.privateKey,
      { algorithm: 'RS256', keyid: 'attacker-kid', issuer: 'https://localhost:8080', expiresIn: '5m' },
    );

    try {
      await expect(validateInboundToken(forged, AUD)).rejects.toThrow(TokenValidationError);
    } finally {
      await idJagServer.close();
    }
  });
});
