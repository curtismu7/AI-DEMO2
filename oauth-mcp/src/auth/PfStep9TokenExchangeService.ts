import axios, { AxiosInstance } from 'axios';
import { Logger } from '../utils/Logger';
import { AuthenticationError, AuthErrorCodes } from '../interfaces/auth';
import type { TokenExchangeClient, TokenExchangeRequest, TokenExchangeResponse } from '../interfaces/tokenExchange';

const TOKEN_EXCHANGE_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange';
const ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token';

export interface PfStep9TokenExchangeConfig {
  issuerUri: string;
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string;
  authMethod: 'basic' | 'post';
  actorScope: string;
  resourceUri: string;
}

interface DecodedJwt {
  header: Record<string, unknown>;
  claims: Record<string, unknown>;
}

function decodeJwt(token: string, label: string): DecodedJwt {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error(`PF Step 9 ${label} is not a JWT access token`);
  try {
    return {
      header: JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')),
      claims: JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')),
    };
  } catch {
    throw new Error(`PF Step 9 ${label} has unreadable claims`);
  }
}

function jwtHeaderType(token: string): unknown {
  const encodedHeader = token.split('.')[0];
  if (!encodedHeader) return undefined;
  try {
    return JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8')).typ;
  } catch {
    return undefined;
  }
}

function tokenIdentity(claims: Record<string, unknown>): string | undefined {
  for (const key of ['client_id', 'sub', 'spiffeId']) {
    if (typeof claims[key] === 'string' && claims[key]) return claims[key] as string;
  }
  return undefined;
}

function actorChain(value: unknown): string[] {
  const identities: string[] = [];
  let current = value;
  while (current && typeof current === 'object' && !Array.isArray(current)) {
    const actor = current as Record<string, unknown>;
    const identity = tokenIdentity(actor);
    if (!identity) break;
    identities.push(identity);
    current = actor.act;
  }
  return identities;
}

function scopeSet(value: unknown): Set<string> {
  if (Array.isArray(value)) return new Set(value.filter((item): item is string => typeof item === 'string'));
  return new Set(typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : []);
}

function audienceSet(value: unknown): Set<string> {
  if (Array.isArray(value)) return new Set(value.filter((item): item is string => typeof item === 'string'));
  return new Set(typeof value === 'string' ? [value] : []);
}

export class PfStep9TokenExchangeService implements TokenExchangeClient {
  private readonly http: AxiosInstance;
  private actorToken?: { value: string; expiresAt: number };
  private actorTokenRequest?: Promise<string>;

  constructor(
    private readonly config: PfStep9TokenExchangeConfig,
    private readonly logger: Logger = Logger.getInstance(),
  ) {
    const missing = Object.entries({
      PF_ISSUER_URI: config.issuerUri,
      PF_TOKEN_ENDPOINT: config.tokenEndpoint,
      PF_MCP_SERVICE_ACTOR_CLIENT_ID: config.clientId,
      PF_MCP_SERVICE_ACTOR_CLIENT_SECRET: config.clientSecret,
      PF_STANDARD_MCP_ACTOR_SCOPE: config.actorScope,
      BANKING_API_RESOURCE_URI: config.resourceUri,
    }).filter(([, value]) => !value).map(([key]) => key);
    if (missing.length) {
      throw new Error(`PF Step 9 token exchange is not configured: ${missing.join(', ')}`);
    }
    if (!['basic', 'post'].includes(config.authMethod)) {
      throw new Error('PF Step 9 token endpoint auth method must be basic or post');
    }

    this.http = axios.create({
      timeout: 30000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  }

  async exchangeToken(request: TokenExchangeRequest): Promise<TokenExchangeResponse> {
    if (request.grant_type !== TOKEN_EXCHANGE_GRANT || request.subject_token_type !== ACCESS_TOKEN_TYPE) {
      throw new AuthenticationError('PF Step 9 only accepts access-token RFC 8693 exchanges', AuthErrorCodes.INVALID_PARAMS);
    }
    if (jwtHeaderType(request.subject_token) === 'oauth-id-jag+jwt') {
      throw new AuthenticationError('PF Step 9 cannot submit an ID-JAG as an access-token subject', AuthErrorCodes.INVALID_PARAMS);
    }
    if (request.resource || request.audience) {
      throw new AuthenticationError(
        'PF Step 9 uses its dedicated policy ATM and does not accept resource or audience selectors',
        AuthErrorCodes.INVALID_PARAMS,
      );
    }

    const actorToken = await this.getActorToken();
    const params = new URLSearchParams({
      grant_type: TOKEN_EXCHANGE_GRANT,
      subject_token: request.subject_token,
      subject_token_type: ACCESS_TOKEN_TYPE,
      actor_token: actorToken,
      actor_token_type: ACCESS_TOKEN_TYPE,
    });
    if (request.requested_token_type) params.set('requested_token_type', request.requested_token_type);
    if (request.scope) params.set('scope', request.scope);

    try {
      const auth = this.addClientAuthentication(params);
      const response = await this.http.post(
        this.config.tokenEndpoint,
        auth.body.toString(),
        { headers: auth.headers },
      );
      const tokenResponse = response.data as TokenExchangeResponse;
      this.validateTokenResponse(tokenResponse);
      this.validateExchangedToken(request, actorToken, tokenResponse.access_token);
      return tokenResponse;
    } catch (error) {
      if (error instanceof AuthenticationError) throw error;
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      const message = status
        ? `PF Step 9 token endpoint rejected the exchange (HTTP ${status})`
        : 'PF Step 9 token exchange failed';
      this.logger.error(message);
      throw new AuthenticationError(message, AuthErrorCodes.TOKEN_REFRESH_FAILED);
    }
  }

  private async getActorToken(): Promise<string> {
    if (this.actorToken && this.actorToken.expiresAt > Date.now()) return this.actorToken.value;
    if (this.actorTokenRequest) return this.actorTokenRequest;

    this.actorTokenRequest = this.requestActorToken();
    try {
      return await this.actorTokenRequest;
    } finally {
      this.actorTokenRequest = undefined;
    }
  }

  private async requestActorToken(): Promise<string> {
    const params = new URLSearchParams({ grant_type: 'client_credentials', scope: this.config.actorScope });
    try {
      const auth = this.addClientAuthentication(params);
      const response = await this.http.post(this.config.tokenEndpoint, auth.body.toString(), { headers: auth.headers });
      const tokenResponse = response.data as Partial<TokenExchangeResponse>;
      if (!tokenResponse.access_token || tokenResponse.token_type?.toLowerCase() !== 'bearer' || !(Number(tokenResponse.expires_in) > 0)) {
        throw new Error('PF Step 9 actor-token response is invalid');
      }

      const decoded = decodeJwt(tokenResponse.access_token, 'actor token');
      const identity = tokenIdentity(decoded.claims);
      if (decoded.claims.iss !== this.config.issuerUri || identity !== this.config.clientId) {
        throw new Error('PF Step 9 actor token issuer or client identity mismatch');
      }
      if (!scopeSet(decoded.claims.scope).has(this.config.actorScope)) {
        throw new Error('PF Step 9 actor token is missing its configured scope');
      }
      if (String(decoded.header.typ || '').toLowerCase().includes('id-jag')) {
        throw new Error('PF Step 9 actor token must be an access token');
      }

      const expiresIn = Number(tokenResponse.expires_in);
      const expiresAt = Date.now() + Math.max(0, expiresIn * 1000 - 30000);
      if (expiresAt > Date.now()) this.actorToken = { value: tokenResponse.access_token, expiresAt };
      return tokenResponse.access_token;
    } catch (error) {
      if (error instanceof AuthenticationError) throw error;
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      const message = status
        ? `PF Step 9 actor-token request failed (HTTP ${status})`
        : 'PF Step 9 actor-token request or validation failed';
      this.logger.error(message);
      throw new AuthenticationError(message, AuthErrorCodes.INVALID_AGENT_TOKEN);
    }
  }

  private addClientAuthentication(params: URLSearchParams): { body: URLSearchParams; headers: Record<string, string> } {
    const headers: Record<string, string> = {};
    if (this.config.authMethod === 'post') {
      params.set('client_id', this.config.clientId);
      params.set('client_secret', this.config.clientSecret);
    } else {
      const credentials = `${this.config.clientId}:${this.config.clientSecret}`;
      headers.Authorization = `Basic ${Buffer.from(credentials).toString('base64')}`;
    }
    return { body: params, headers };
  }

  private validateTokenResponse(response: TokenExchangeResponse): void {
    if (!response?.access_token || response.token_type?.toLowerCase() !== 'bearer' || !(response.expires_in > 0)) {
      throw new AuthenticationError('PF Step 9 returned an invalid bearer token response', AuthErrorCodes.INVALID_TOKEN);
    }
    if (response.issued_token_type && response.issued_token_type !== ACCESS_TOKEN_TYPE) {
      throw new AuthenticationError('PF Step 9 did not return an access token', AuthErrorCodes.INVALID_TOKEN);
    }
  }

  private validateExchangedToken(request: TokenExchangeRequest, actorToken: string, token: string): void {
    const subject = decodeJwt(request.subject_token, 'subject token').claims;
    const actor = decodeJwt(actorToken, 'actor token').claims;
    const exchanged = decodeJwt(token, 'resource token');
    if (subject.iss !== this.config.issuerUri) {
      throw new AuthenticationError('PF Step 9 subject token issuer mismatch', AuthErrorCodes.INVALID_TOKEN);
    }
    if (String(exchanged.header.typ || '').toLowerCase().includes('id-jag')) {
      throw new AuthenticationError('PF Step 9 returned an ID-JAG instead of an access token', AuthErrorCodes.INVALID_TOKEN);
    }
    if (exchanged.claims.iss !== this.config.issuerUri) {
      throw new AuthenticationError('PF Step 9 token issuer mismatch', AuthErrorCodes.INVALID_TOKEN);
    }

    const expectedSubject = subject.sub ?? subject.Username;
    const actualSubject = exchanged.claims.sub ?? exchanged.claims.Username;
    if (!expectedSubject || actualSubject !== expectedSubject) {
      throw new AuthenticationError('PF Step 9 token did not preserve the subject', AuthErrorCodes.INVALID_TOKEN);
    }
    if (!audienceSet(exchanged.claims.aud).has(this.config.resourceUri)) {
      throw new AuthenticationError('PF Step 9 token audience mismatch', AuthErrorCodes.INVALID_TOKEN);
    }

    const expectedScopes = scopeSet(request.scope);
    const actualScopes = scopeSet(exchanged.claims.scope);
    if (expectedScopes.size !== actualScopes.size || [...expectedScopes].some((scope) => !actualScopes.has(scope))) {
      throw new AuthenticationError('PF Step 9 token scope mismatch', AuthErrorCodes.INVALID_TOKEN);
    }

    const expectedChain = [tokenIdentity(actor), ...actorChain(subject.act)].filter((identity): identity is string => Boolean(identity));
    const actualChain = actorChain(exchanged.claims.act);
    if (!expectedChain.length || expectedChain.length !== actualChain.length || expectedChain.some((identity, index) => identity !== actualChain[index])) {
      throw new AuthenticationError('PF Step 9 token did not preserve the nested actor chain', AuthErrorCodes.INVALID_TOKEN);
    }
  }
}
