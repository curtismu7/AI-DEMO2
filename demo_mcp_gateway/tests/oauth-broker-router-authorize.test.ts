import { createServer, Server } from 'http';
import supertest from 'supertest';
import axios from 'axios';
import { OAuthBrokerRouter } from '../src/oauth/OAuthBrokerRouter';
import { ClientRegistry } from '../src/oauth/ClientRegistry';
import { BrokerTokenStore } from '../src/oauth/BrokerTokenStore';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

beforeEach(() => {
  mockedAxios.post.mockReset();
});

process.env.GATEWAY_OAUTH_BROKER_PINGONE_CLIENT_ID = 'c8392dc4-2d82-4e49-92a8-79a78401faf5';
process.env.PINGONE_ENVIRONMENT_ID = '01d89b06-66d5-430e-9f28-65636843788b';
process.env.PINGONE_REGION = 'com';

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

describe('OAuthBrokerRouter /oauth/authorize', () => {
  it('redirects to PingOne\'s real authorize endpoint with the broker\'s own PKCE', async () => {
    const { clientRegistry, server } = makeRouterAndServer();
    const client = clientRegistry.registerClient({
      client_name: 'LM Studio',
      redirect_uris: ['http://127.0.0.1:33389/mcp-oauth-callback'],
    });
    const res = await supertest(server)
      .get('/oauth/authorize')
      .query({
        client_id: client.client_id,
        redirect_uri: 'http://127.0.0.1:33389/mcp-oauth-callback',
        response_type: 'code',
        code_challenge: 'external-challenge',
        code_challenge_method: 'S256',
        state: 'external-state',
      });
    expect(res.status).toBe(302);
    const location = new URL(res.headers.location);
    expect(location.origin + location.pathname).toContain('auth.pingone.com/01d89b06-66d5-430e-9f28-65636843788b/as/authorize');
    expect(location.searchParams.get('client_id')).toBe('c8392dc4-2d82-4e49-92a8-79a78401faf5');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('resource')).toBe('https://mcp-gateway.example.com');
  });

  it('rejects an unknown client_id', async () => {
    const { server } = makeRouterAndServer();
    const res = await supertest(server)
      .get('/oauth/authorize')
      .query({ client_id: 'nope', redirect_uri: 'http://127.0.0.1:1/x', response_type: 'code', code_challenge: 'c' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_client');
  });

  it('rejects a redirect_uri that was not the one registered', async () => {
    const { clientRegistry, server } = makeRouterAndServer();
    const client = clientRegistry.registerClient({
      client_name: 'x', redirect_uris: ['http://127.0.0.1:1/registered'],
    });
    const res = await supertest(server)
      .get('/oauth/authorize')
      .query({ client_id: client.client_id, redirect_uri: 'http://127.0.0.1:1/different', response_type: 'code', code_challenge: 'c' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });
});

describe('OAuthBrokerRouter /oauth/callback', () => {
  it('exchanges the PingOne code, stores the real token, and redirects back to the original client with the broker\'s own code', async () => {
    const { clientRegistry, tokenStore, server } = makeRouterAndServer();
    const client = clientRegistry.registerClient({
      client_name: 'LM Studio', redirect_uris: ['http://127.0.0.1:33389/mcp-oauth-callback'],
    });
    const relayState = tokenStore.createPendingAuthorization({
      clientId: client.client_id,
      redirectUri: 'http://127.0.0.1:33389/mcp-oauth-callback',
      scope: 'mcp:invoke',
      codeChallenge: 'external-challenge',
      codeChallengeMethod: 'S256',
      clientState: 'external-state',
      pingOneCodeVerifier: 'broker-generated-verifier',
    });
    mockedAxios.post.mockResolvedValueOnce({
      data: { access_token: 'REAL-PINGONE-TOKEN', expires_in: 3600, token_type: 'Bearer' },
    });

    const res = await supertest(server)
      .get('/oauth/callback')
      .query({ code: 'pingone-code-123', state: relayState });

    expect(res.status).toBe(302);
    const location = new URL(res.headers.location);
    expect(location.origin + location.pathname).toBe('http://127.0.0.1:33389/mcp-oauth-callback');
    expect(location.searchParams.get('state')).toBe('external-state');
    expect(location.searchParams.get('code')).toBeTruthy();

    // The broker's own code, when consumed, carries the real PingOne token
    // AND the external client's original PKCE challenge unmodified — the
    // latter is what makes Task 4's /oauth/token able to verify PKCE at all.
    const brokerCode = location.searchParams.get('code')!;
    const issued = tokenStore.consumeCode(brokerCode);
    expect(issued?.pingOneAccessToken).toBe('REAL-PINGONE-TOKEN');
    expect(issued?.codeChallenge).toBe('external-challenge');
    expect(issued?.codeChallengeMethod).toBe('S256');
    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.stringContaining('/as/token'),
      expect.stringContaining('code_verifier=broker-generated-verifier'),
      expect.any(Object),
    );
  });

  it('returns invalid_grant for an unknown or expired relay state', async () => {
    const { server } = makeRouterAndServer();
    const res = await supertest(server).get('/oauth/callback').query({ code: 'x', state: 'never-issued' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
  });

  it('surfaces a PingOne-side error without calling axios', async () => {
    const { server } = makeRouterAndServer();
    const res = await supertest(server).get('/oauth/callback').query({ error: 'access_denied', state: 'irrelevant' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('access_denied');
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});
