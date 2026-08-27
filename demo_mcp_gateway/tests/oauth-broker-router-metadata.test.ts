import { createServer, Server } from 'http';
import supertest from 'supertest';
import { OAuthBrokerRouter } from '../src/oauth/OAuthBrokerRouter';
import { ClientRegistry } from '../src/oauth/ClientRegistry';
import { BrokerTokenStore } from '../src/oauth/BrokerTokenStore';

function makeServer(): Server {
  const router = new OAuthBrokerRouter(new ClientRegistry(), new BrokerTokenStore(), 'https://mcp-gateway.example.com');
  return createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const handled = await router.handle(req, res, url);
    if (!handled) { res.writeHead(404); res.end(); }
  });
}

describe('OAuthBrokerRouter metadata', () => {
  it('GET /.well-known/oauth-authorization-server advertises this broker\'s own endpoints', async () => {
    const server = makeServer();
    const res = await supertest(server).get('/.well-known/oauth-authorization-server');
    expect(res.status).toBe(200);
    expect(res.body.registration_endpoint).toMatch(/\/oauth\/register$/);
    expect(res.body.authorization_endpoint).toMatch(/\/oauth\/authorize$/);
    expect(res.body.token_endpoint).toMatch(/\/oauth\/token$/);
    expect(res.body.code_challenge_methods_supported).toEqual(['S256']);
    expect(res.body.grant_types_supported).toEqual(['authorization_code']);
  });
});

describe('OAuthBrokerRouter registration', () => {
  it('POST /oauth/register with a loopback redirect_uri succeeds', async () => {
    const server = makeServer();
    const res = await supertest(server)
      .post('/oauth/register')
      .send({ client_name: 'LM Studio', redirect_uris: ['http://127.0.0.1:33389/mcp-oauth-callback'] });
    expect(res.status).toBe(201);
    expect(res.body.client_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.token_endpoint_auth_method).toBe('none');
  });

  it('POST /oauth/register with a non-loopback redirect_uri returns invalid_redirect_uri', async () => {
    const server = makeServer();
    const res = await supertest(server)
      .post('/oauth/register')
      .send({ client_name: 'evil', redirect_uris: ['https://attacker.example.com/callback'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_redirect_uri');
  });

  it('GET /oauth/register is not handled (returns false so the caller 404s)', async () => {
    const server = makeServer();
    const res = await supertest(server).get('/oauth/register');
    expect(res.status).toBe(404);
  });
});
