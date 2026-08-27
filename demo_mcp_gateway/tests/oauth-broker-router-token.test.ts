import { createServer, Server } from 'http';
import supertest from 'supertest';
import { OAuthBrokerRouter } from '../src/oauth/OAuthBrokerRouter';
import { ClientRegistry } from '../src/oauth/ClientRegistry';
import { BrokerTokenStore } from '../src/oauth/BrokerTokenStore';

function makeRouterAndServer() {
  const clientRegistry = new ClientRegistry();
  const tokenStore = new BrokerTokenStore();
  const router = new OAuthBrokerRouter(clientRegistry, tokenStore, 'https://mcp-gateway.example.com');
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const handled = await router.handle(req, res, url);
    if (!handled) { res.writeHead(404); res.end(); }
  });
  return { clientRegistry, tokenStore, server };
}

// A real S256 pair — computed once via:
// node -e "const c=require('crypto');const v='test-code-verifier-1234567890abcdef';console.log(c.createHash('sha256').update(v).digest('base64url'))"
const VALID_VERIFIER = 'test-code-verifier-1234567890abcdef';
const VALID_CHALLENGE = 'eV1Pn224EN4EvJLQQwhf3obGtpz6dQJCPK_fP9UaWMw';

describe('OAuthBrokerRouter /oauth/token', () => {
  it('trades the broker\'s code for the real, unmodified PingOne access token, given the matching code_verifier', async () => {
    const { clientRegistry, tokenStore, server } = makeRouterAndServer();
    const client = clientRegistry.registerClient({
      client_name: 'LM Studio', redirect_uris: ['http://127.0.0.1:33389/mcp-oauth-callback'],
    });
    const code = tokenStore.createCode({
      clientId: client.client_id,
      redirectUri: 'http://127.0.0.1:33389/mcp-oauth-callback',
      scope: 'mcp:invoke',
      codeChallenge: VALID_CHALLENGE,
      codeChallengeMethod: 'S256',
      pingOneAccessToken: 'REAL-PINGONE-TOKEN',
      pingOneExpiresIn: 3600,
    });

    const res = await supertest(server)
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'http://127.0.0.1:33389/mcp-oauth-callback',
        client_id: client.client_id,
        code_verifier: VALID_VERIFIER,
      });

    expect(res.status).toBe(200);
    expect(res.body.access_token).toBe('REAL-PINGONE-TOKEN');
    expect(res.body.token_type).toBe('Bearer');
    expect(res.body.expires_in).toBe(3600);
  });

  it('rejects a token request with a code_verifier that does not match the original code_challenge', async () => {
    const { clientRegistry, tokenStore, server } = makeRouterAndServer();
    const client = clientRegistry.registerClient({
      client_name: 'LM Studio', redirect_uris: ['http://127.0.0.1:33389/mcp-oauth-callback'],
    });
    const code = tokenStore.createCode({
      clientId: client.client_id,
      redirectUri: 'http://127.0.0.1:33389/mcp-oauth-callback',
      scope: 'mcp:invoke',
      codeChallenge: VALID_CHALLENGE,
      codeChallengeMethod: 'S256',
      pingOneAccessToken: 'REAL-PINGONE-TOKEN',
      pingOneExpiresIn: 3600,
    });
    const res = await supertest(server)
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'http://127.0.0.1:33389/mcp-oauth-callback',
        client_id: client.client_id,
        code_verifier: 'wrong-verifier-does-not-hash-to-the-challenge',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
  });

  it('rejects a token request with no code_verifier at all', async () => {
    const { clientRegistry, tokenStore, server } = makeRouterAndServer();
    const client = clientRegistry.registerClient({
      client_name: 'LM Studio', redirect_uris: ['http://127.0.0.1:33389/mcp-oauth-callback'],
    });
    const code = tokenStore.createCode({
      clientId: client.client_id,
      redirectUri: 'http://127.0.0.1:33389/mcp-oauth-callback',
      scope: 'mcp:invoke',
      codeChallenge: VALID_CHALLENGE,
      codeChallengeMethod: 'S256',
      pingOneAccessToken: 'REAL-PINGONE-TOKEN',
      pingOneExpiresIn: 3600,
    });
    const res = await supertest(server)
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'http://127.0.0.1:33389/mcp-oauth-callback',
        client_id: client.client_id,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
  });

  it('rejects a code redeemed by a different client_id than it was issued to', async () => {
    const { clientRegistry, tokenStore, server } = makeRouterAndServer();
    const client = clientRegistry.registerClient({
      client_name: 'x', redirect_uris: ['http://127.0.0.1:1/callback'],
    });
    const otherClient = clientRegistry.registerClient({
      client_name: 'y', redirect_uris: ['http://127.0.0.1:2/callback'],
    });
    const code = tokenStore.createCode({
      clientId: client.client_id, redirectUri: 'http://127.0.0.1:1/callback',
      scope: 'mcp:invoke', codeChallenge: 'challenge-abc', codeChallengeMethod: 'S256', pingOneAccessToken: 't', pingOneExpiresIn: 3600,
    });
    const res = await supertest(server)
      .post('/oauth/token')
      .type('form')
      .send({ grant_type: 'authorization_code', code, redirect_uri: 'http://127.0.0.1:1/callback', client_id: otherClient.client_id });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
  });

  it('rejects an already-consumed code', async () => {
    const { clientRegistry, tokenStore, server } = makeRouterAndServer();
    const client = clientRegistry.registerClient({ client_name: 'x', redirect_uris: ['http://127.0.0.1:1/callback'] });
    const code = tokenStore.createCode({
      clientId: client.client_id, redirectUri: 'http://127.0.0.1:1/callback',
      scope: 'mcp:invoke', codeChallenge: VALID_CHALLENGE, codeChallengeMethod: 'S256', pingOneAccessToken: 't', pingOneExpiresIn: 3600,
    });
    // NOTE: brief's literal fixture used codeChallenge: 'challenge-abc' and sent no
    // code_verifier, yet asserted the first redemption returns 200 — inconsistent
    // with the PKCE check the brief's own Step 3 implementation requires (that
    // codeChallenge isn't a valid base64url SHA-256 digest, and a missing
    // code_verifier is rejected per the "no code_verifier" test above). Swapped in
    // a real matching S256 pair here so this test can verify its actual intent
    // (single-use code consumption) without failing on PKCE first.
    const body = { grant_type: 'authorization_code', code, redirect_uri: 'http://127.0.0.1:1/callback', client_id: client.client_id, code_verifier: VALID_VERIFIER };
    const first = await supertest(server).post('/oauth/token').type('form').send(body);
    expect(first.status).toBe(200);
    const second = await supertest(server).post('/oauth/token').type('form').send(body);
    expect(second.status).toBe(400);
    expect(second.body.error).toBe('invalid_grant');
  });

  it('rejects an unsupported grant_type', async () => {
    const { server } = makeRouterAndServer();
    const res = await supertest(server)
      .post('/oauth/token')
      .type('form')
      .send({ grant_type: 'client_credentials' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unsupported_grant_type');
  });
});
