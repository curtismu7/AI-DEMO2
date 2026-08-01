export interface OAuthClient {
  client_id: string;
  client_secret?: string;
  client_name: string;
  grant_types: string[];
  redirect_uris: string[];
  token_endpoint_auth_method: 'client_secret_basic' | 'client_secret_post' | 'none';
  scope: string;
}

/**
 * In-memory client registry. Loads from OAUTH_CLIENTS env (JSON array)
 * or uses a default set for the demo.
 */
export class ClientRegistry {
  private clients: Map<string, OAuthClient> = new Map();

  initialize(): void {
    const envClients = process.env.OAUTH_CLIENTS;
    if (envClients) {
      const parsed: OAuthClient[] = JSON.parse(envClients);
      for (const c of parsed) {
        this.clients.set(c.client_id, c);
      }
      return;
    }

    // Default demo clients
    const defaults: OAuthClient[] = [
      {
        client_id: 'privilege-cloud',
        client_secret: process.env.OAUTH_PRIVILEGE_CLIENT_SECRET || 'demo-secret',
        client_name: 'PingOne Privilege Cloud',
        grant_types: ['client_credentials'],
        redirect_uris: [],
        token_endpoint_auth_method: 'client_secret_basic',
        scope: 'mcp:invoke read write',
      },
      {
        client_id: 'mcp-inspector',
        client_secret: undefined,
        client_name: 'MCP Inspector (public)',
        grant_types: ['authorization_code'],
        redirect_uris: ['http://localhost:6274/oauth/callback', 'http://127.0.0.1:6274/oauth/callback'],
        token_endpoint_auth_method: 'none',
        scope: 'mcp:invoke read write',
      },
    ];
    for (const c of defaults) {
      this.clients.set(c.client_id, c);
    }
  }

  getClient(clientId: string): OAuthClient | undefined {
    return this.clients.get(clientId);
  }

  authenticateClient(clientId: string, clientSecret: string | undefined, method: string): OAuthClient | null {
    const client = this.clients.get(clientId);
    if (!client) return null;

    if (client.token_endpoint_auth_method === 'none') {
      return client;
    }
    if (!clientSecret || clientSecret !== client.client_secret) {
      return null;
    }
    return client;
  }

  registerClient(client: OAuthClient): void {
    this.clients.set(client.client_id, client);
  }
}
