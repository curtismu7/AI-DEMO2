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

  it('adopts an unknown client_id whose redirect_uri is loopback — a registry restart must not strand a client', async () => {
    // The registry is in-memory: a gateway rebuild forgets every DCR client
    // while LM Studio keeps the id it was issued (seen live 2026-08-25:
    // {"error":"invalid_client","error_description":"Unknown client_id"}).
    // Open DCR means any loopback client could register anyway, so adopting
    // the presented id is the same trust — nothing lost but the client_name.
    const { clientRegistry, server } = makeRouterAndServer();
    const res = await supertest(server)
      .get('/oauth/authorize')
      .query({ client_id: 'stale-from-before-restart', redirect_uri: 'http://127.0.0.1:41999/callback', response_type: 'code', code_challenge: 'c' });
    expect(res.status).toBe(302);
    expect(new URL(res.headers.location).hostname).toBe('auth.pingone.com');
    const adopted = clientRegistry.getClient('stale-from-before-restart');
    expect(adopted).toMatchObject({ client_id: 'stale-from-before-restart', redirect_uris: ['http://127.0.0.1:41999/callback'], token_endpoint_auth_method: 'none' });
  });

  it('still rejects an unknown client_id whose redirect_uri is not loopback', async () => {
    const { clientRegistry, server } = makeRouterAndServer();
    const res = await supertest(server)
      .get('/oauth/authorize')
      .query({ client_id: 'nope', redirect_uri: 'https://attacker.example.com/cb', response_type: 'code', code_challenge: 'c' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_client');
    expect(clientRegistry.getClient('nope')).toBeUndefined();
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

describe('OAuthBrokerRouter — Privilege gateway link', () => {
  const LINK_URL = 'https://local.ping-devops.com:4000/api/privilege-mcp/facade-link';
  const REDIRECT = 'http://127.0.0.1:33389/mcp-oauth-callback';
  const DOOR = 'http://localhost:3002/mcp-facade/privilege-gateway/opensearch/mcp';

  afterEach(() => { delete process.env.BFF_PRIVILEGE_LINK_URL; });

  function pendingFor(tokenStore: BrokerTokenStore, clientId: string, resource?: string) {
    return tokenStore.createPendingAuthorization({
      clientId, redirectUri: REDIRECT, scope: 'mcp:invoke',
      codeChallenge: 'external-challenge', codeChallengeMethod: 'S256',
      clientState: 'external-state', pingOneCodeVerifier: 'v', resource,
    });
  }

  function parked(tokenStore: BrokerTokenStore) {
    return tokenStore.createResume({
      clientId: 'c1', redirectUri: REDIRECT, scope: 'mcp:invoke',
      codeChallenge: 'external-challenge', codeChallengeMethod: 'S256',
      clientState: 'external-state', pingOneAccessToken: 'REAL-PINGONE-TOKEN', pingOneExpiresIn: 3600,
    });
  }

  async function callbackFor(resource?: string) {
    const { clientRegistry, tokenStore, server } = makeRouterAndServer();
    const client = clientRegistry.registerClient({ client_name: 'LM Studio', redirect_uris: [REDIRECT] });
    const relayState = pendingFor(tokenStore, client.client_id, resource);
    mockedAxios.post.mockResolvedValueOnce({ data: { access_token: 'REAL-PINGONE-TOKEN', expires_in: 3600 } });
    const res = await supertest(server).get('/oauth/callback').query({ code: 'pingone-code', state: relayState });
    return { res, tokenStore };
  }

  it('keeps the resource the client asked for on the pending authorization', async () => {
    const { clientRegistry, tokenStore, server } = makeRouterAndServer();
    const client = clientRegistry.registerClient({ client_name: 'LM Studio', redirect_uris: [REDIRECT] });
    const res = await supertest(server).get('/oauth/authorize').query({
      client_id: client.client_id, redirect_uri: REDIRECT, response_type: 'code',
      code_challenge: 'c', code_challenge_method: 'S256', state: 's', resource: DOOR,
    });
    const relayState = new URL(res.headers.location).searchParams.get('state')!;
    expect(tokenStore.consumePendingAuthorization(relayState)?.resource).toBe(DOOR);
  });

  it('parks the authorization and sends the browser to the BFF link for a Privilege door', async () => {
    process.env.BFF_PRIVILEGE_LINK_URL = LINK_URL;
    const { res } = await callbackFor(DOOR);

    expect(res.status).toBe(302);
    const link = new URL(res.headers.location);
    expect(link.origin + link.pathname).toBe(LINK_URL);
    expect(link.searchParams.get('app')).toBe('opensearch');
    const resume = new URL(link.searchParams.get('resume')!);
    expect(resume.pathname).toBe('/oauth/resume');
    expect(resume.searchParams.get('rs')).toBeTruthy();
  });

  it('omits app for the bare door, so the BFF uses its default app', async () => {
    process.env.BFF_PRIVILEGE_LINK_URL = LINK_URL;
    const { res } = await callbackFor('http://localhost:3002/mcp-facade/privilege-gateway/mcp');
    const link = new URL(res.headers.location);
    expect(link.origin + link.pathname).toBe(LINK_URL);
    expect(link.searchParams.has('app')).toBe(false);
  });

  it('returns to the client as before when the link URL is not configured', async () => {
    const { res } = await callbackFor(DOOR);
    const back = new URL(res.headers.location);
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(back.searchParams.get('code')).toBeTruthy();
  });

  it('returns to the client as before for any other door', async () => {
    process.env.BFF_PRIVILEGE_LINK_URL = LINK_URL;
    const { res } = await callbackFor('http://localhost:3002/mcp-facade/opensearch/mcp');
    const back = new URL(res.headers.location);
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(back.searchParams.get('code')).toBeTruthy();
  });

  it('link=ok issues the broker code carrying the PingOne token and the client state', async () => {
    const { tokenStore, server } = makeRouterAndServer();
    const rs = parked(tokenStore);

    const res = await supertest(server).get('/oauth/resume').query({ rs, link: 'ok' });

    expect(res.status).toBe(302);
    const back = new URL(res.headers.location);
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(back.searchParams.get('state')).toBe('external-state');
    const issued = tokenStore.consumeCode(back.searchParams.get('code')!);
    expect(issued?.pingOneAccessToken).toBe('REAL-PINGONE-TOKEN');
    expect(issued?.codeChallenge).toBe('external-challenge');
  });

  it('link=error tells the client access_denied instead of issuing a code', async () => {
    const { tokenStore, server } = makeRouterAndServer();
    const rs = parked(tokenStore);

    const res = await supertest(server).get('/oauth/resume').query({ rs, link: 'error', reason: 'OAuth state mismatch.' });

    const back = new URL(res.headers.location);
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(back.searchParams.get('error')).toBe('access_denied');
    expect(back.searchParams.get('error_description')).toContain('OAuth state mismatch.');
    expect(back.searchParams.get('code')).toBeNull();
    expect(back.searchParams.get('state')).toBe('external-state');
  });

  it('an unknown or already-used resume id is invalid_grant', async () => {
    const { tokenStore, server } = makeRouterAndServer();
    const rs = parked(tokenStore);
    await supertest(server).get('/oauth/resume').query({ rs, link: 'ok' }).expect(302);

    const again = await supertest(server).get('/oauth/resume').query({ rs, link: 'ok' });
    expect(again.status).toBe(400);
    expect(again.body.error).toBe('invalid_grant');

    const unknown = await supertest(server).get('/oauth/resume').query({ rs: 'never-issued', link: 'ok' });
    expect(unknown.status).toBe(400);
  });
});
