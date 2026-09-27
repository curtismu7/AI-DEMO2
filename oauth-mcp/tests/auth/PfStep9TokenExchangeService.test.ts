import axios from 'axios';
import { PfStep9TokenExchangeService } from '../../src/auth/PfStep9TokenExchangeService';
import { Logger, createDefaultLoggerConfig } from '../../src/utils/Logger';
import type { TokenExchangeRequest } from '../../src/interfaces/tokenExchange';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

function makeJwt(claims: Record<string, unknown>, header: Record<string, unknown> = { alg: 'RS256', typ: 'JWT' }): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode(header)}.${encode(claims)}.signature`;
}

const config = {
  issuerUri: 'https://pf.example.test',
  tokenEndpoint: 'https://pf.example.test/as/token.oauth2',
  clientId: 'pf-mcp-actor',
  clientSecret: 'pf-client-secret',
  authMethod: 'basic' as const,
  actorScope: 'mcp:invoke',
  resourceUri: 'enduser.ping.demo',
};

describe('PfStep9TokenExchangeService', () => {
  let http: { post: jest.Mock };
  let logger: Logger;
  let service: PfStep9TokenExchangeService;
  let subjectToken: string;
  let actorToken: string;
  let resourceToken: string;

  beforeEach(() => {
    http = { post: jest.fn() };
    mockedAxios.create.mockReturnValue(http as any);
    logger = Logger.getInstance(createDefaultLoggerConfig());
    service = new PfStep9TokenExchangeService(config, logger);

    subjectToken = makeJwt({
      iss: config.issuerUri,
      sub: 'demoUser',
      aud: 'https://api.ping.demo:3036/mcp',
      scope: 'mcp:invoke',
      act: { sub: 'gateway-actor', act: { sub: 'bff-actor' } },
    });
    actorToken = makeJwt({
      iss: config.issuerUri,
      sub: config.clientId,
      client_id: config.clientId,
      scope: config.actorScope,
      aud: config.resourceUri,
    });
    resourceToken = makeJwt({
      iss: config.issuerUri,
      sub: 'demoUser',
      aud: config.resourceUri,
      scope: 'read',
      act: { sub: config.clientId, act: { sub: 'gateway-actor', act: { sub: 'bff-actor' } } },
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('mints and validates the PF actor token, then exchanges without a resource selector and preserves nested act', async () => {
    http.post
      .mockResolvedValueOnce({ data: { access_token: actorToken, token_type: 'Bearer', expires_in: 3600 } })
      .mockResolvedValueOnce({ data: { access_token: resourceToken, token_type: 'Bearer', expires_in: 300 } });
    const request: TokenExchangeRequest = {
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: subjectToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      scope: 'read',
    };

    const response = await service.exchangeToken(request);

    expect(response.access_token).toBe(resourceToken);
    const actorBody = new URLSearchParams(http.post.mock.calls[0][1]);
    expect(http.post.mock.calls[0][0]).toBe(config.tokenEndpoint);
    expect(actorBody.get('grant_type')).toBe('client_credentials');
    expect(actorBody.get('scope')).toBe(config.actorScope);
    expect(http.post.mock.calls[0][2].headers.Authorization).toMatch(/^Basic /);

    const exchangeBody = new URLSearchParams(http.post.mock.calls[1][1]);
    expect(http.post.mock.calls[1][0]).toBe(config.tokenEndpoint);
    expect(exchangeBody.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:token-exchange');
    expect(exchangeBody.get('subject_token')).toBe(subjectToken);
    expect(exchangeBody.get('actor_token')).toBe(actorToken);
    expect(exchangeBody.get('actor_token_type')).toBe('urn:ietf:params:oauth:token-type:access_token');
    expect(exchangeBody.get('requested_token_type')).toBe('urn:ietf:params:oauth:token-type:access_token');
    expect(exchangeBody.get('scope')).toBe('read');
    expect(exchangeBody.has('resource')).toBe(false);
    expect(exchangeBody.has('audience')).toBe(false);
  });

  it('reuses the PF actor token while independently exchanging the requested subject token', async () => {
    http.post
      .mockResolvedValueOnce({ data: { access_token: actorToken, token_type: 'Bearer', expires_in: 3600 } })
      .mockResolvedValueOnce({ data: { access_token: resourceToken, token_type: 'Bearer', expires_in: 300 } })
      .mockResolvedValueOnce({ data: { access_token: resourceToken, token_type: 'Bearer', expires_in: 300 } });

    await service.exchangeToken({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: subjectToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      scope: 'read',
    });
    await service.exchangeToken({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: subjectToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      scope: 'read',
    });

    expect(http.post).toHaveBeenCalledTimes(3);
  });

  it('rejects a PF exchange result with a mismatched Banking API audience', async () => {
    const wrongAudience = makeJwt({
      iss: config.issuerUri,
      sub: 'demoUser',
      aud: 'https://api.ping.demo:3036/mcp',
      scope: 'read',
      act: { sub: config.clientId, act: { sub: 'gateway-actor', act: { sub: 'bff-actor' } } },
    });
    http.post
      .mockResolvedValueOnce({ data: { access_token: actorToken, token_type: 'Bearer', expires_in: 3600 } })
      .mockResolvedValueOnce({ data: { access_token: wrongAudience, token_type: 'Bearer', expires_in: 300 } });

    await expect(service.exchangeToken({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: subjectToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      scope: 'read',
    })).rejects.toThrow(/audience/);
  });
});
