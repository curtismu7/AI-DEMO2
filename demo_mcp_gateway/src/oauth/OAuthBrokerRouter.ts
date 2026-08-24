import { IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import { ClientRegistry, InvalidRedirectUriError } from './ClientRegistry';
import { BrokerTokenStore } from './BrokerTokenStore';
import { selfBaseUrl } from '../selfBaseUrl';

/**
 * OAuth 2.1 Authorization Server for external MCP clients (LM Studio,
 * Cursor, etc.) reaching this gateway over HTTP. Ported pattern from
 * oauth-mcp's OAuthRouter — see the design spec for what's deliberately NOT
 * ported (TokenIssuer, SigningKeyManager, IdJagGrantHandler, CIMD): this
 * broker relays PingOne's real access token instead of self-issuing one.
 */
export class OAuthBrokerRouter {
  constructor(
    private clientRegistry: ClientRegistry,
    private tokenStore: BrokerTokenStore,
    private gatewayResourceUri: string,
  ) {}

  /** Returns true if this router handled the request. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    switch (url.pathname) {
      case '/.well-known/oauth-authorization-server':
        return this.handleMetadata(req, res);
      case '/oauth/register':
        return this.handleRegister(req, res);
      default:
        return false;
    }
  }

  private issuer(req: IncomingMessage): string {
    return selfBaseUrl(req, process.env.PORT || 3005);
  }

  // --- RFC 8414 ---
  private handleMetadata(req: IncomingMessage, res: ServerResponse): boolean {
    const issuer = this.issuer(req);
    this.json(res, 200, {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      registration_endpoint: `${issuer}/oauth/register`,
      scopes_supported: ['mcp:invoke'],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
    });
    return true;
  }

  // --- RFC 7591 (open — see ClientRegistry.brokerRegistrationScope for why) ---
  private async handleRegister(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    if (req.method !== 'POST') return false;
    const body = await this.readBody(req);
    let meta: Record<string, unknown>;
    try {
      meta = JSON.parse(body || '{}');
    } catch {
      this.json(res, 400, { error: 'invalid_request', error_description: 'Invalid JSON' });
      return true;
    }
    try {
      const client = this.clientRegistry.registerClient({
        client_name: meta.client_name as string | undefined,
        redirect_uris: (meta.redirect_uris as string[]) || [],
        grant_types: meta.grant_types as string[] | undefined,
      });
      this.json(res, 201, {
        client_id: client.client_id,
        client_name: client.client_name,
        grant_types: client.grant_types,
        redirect_uris: client.redirect_uris,
        token_endpoint_auth_method: client.token_endpoint_auth_method,
        scope: client.scope,
      });
    } catch (err) {
      if (err instanceof InvalidRedirectUriError) {
        this.json(res, 400, { error: 'invalid_redirect_uri', error_description: err.message });
        return true;
      }
      throw err;
    }
    return true;
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks).toString()));
      req.on('error', reject);
    });
  }

  private json(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  }
}
