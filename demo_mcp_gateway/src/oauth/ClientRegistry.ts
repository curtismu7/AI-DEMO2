import * as crypto from 'crypto';

export interface OAuthBrokerClient {
  client_id: string;
  client_name: string;
  grant_types: string[];
  redirect_uris: string[];
  token_endpoint_auth_method: 'none';
  scope: string;
}

export interface RegisterClientInput {
  client_name?: string;
  redirect_uris: string[];
  grant_types?: string[];
}

export class InvalidRedirectUriError extends Error {
  constructor(uri: string) {
    super(`redirect_uri must be a loopback address (127.0.0.1 or localhost): ${uri}`);
    this.name = 'InvalidRedirectUriError';
  }
}

/**
 * Scope granted to every dynamically-registered client. Pinned server-side,
 * never read from the registration request — an unauthenticated caller
 * naming its own scope would be exactly the escalation open DCR exists to
 * avoid (mirrors oauth-mcp's ClientRegistry.openRegistrationScope reasoning).
 */
function brokerRegistrationScope(): string {
  return process.env.MCP_GW_OAUTH_BROKER_SCOPE || 'mcp:invoke';
}

function assertLoopback(uri: string): void {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new InvalidRedirectUriError(uri);
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new InvalidRedirectUriError(uri);
  }
}

/**
 * In-memory client registry for the Agent Gateway's external-client OAuth
 * broker. Unlike oauth-mcp's ClientRegistry, every client here is loopback
 * (a native-app MCP client on the user's own machine) — there is no
 * multi-tenant durability requirement, so no persistence layer.
 */
export class ClientRegistry {
  private clients: Map<string, OAuthBrokerClient> = new Map();

  registerClient(input: RegisterClientInput): OAuthBrokerClient {
    if (!input.redirect_uris || input.redirect_uris.length === 0) {
      throw new InvalidRedirectUriError('(none provided)');
    }
    for (const uri of input.redirect_uris) {
      assertLoopback(uri);
    }
    const client: OAuthBrokerClient = {
      client_id: crypto.randomUUID(),
      client_name: input.client_name || 'Dynamic MCP Client',
      grant_types: input.grant_types || ['authorization_code'],
      redirect_uris: input.redirect_uris,
      token_endpoint_auth_method: 'none',
      scope: brokerRegistrationScope(),
    };
    this.clients.set(client.client_id, client);
    return client;
  }

  /**
   * Re-register a client under the id IT presents. The registry is in-memory,
   * so a gateway restart forgets every DCR client while the client keeps the
   * id it was issued and fails /oauth/authorize with invalid_client (LM Studio,
   * live 2026-08-25). Open DCR already lets any loopback client register, so
   * adopting the presented id is the same trust — same loopback check, same
   * pinned scope; only the client_name is lost.
   */
  adoptClient(input: RegisterClientInput & { client_id: string }): OAuthBrokerClient {
    if (!input.redirect_uris || input.redirect_uris.length === 0) {
      throw new InvalidRedirectUriError('(none provided)');
    }
    for (const uri of input.redirect_uris) {
      assertLoopback(uri);
    }
    const client: OAuthBrokerClient = {
      client_id: input.client_id,
      client_name: input.client_name || 'Dynamic MCP Client (adopted after restart)',
      grant_types: input.grant_types || ['authorization_code'],
      redirect_uris: input.redirect_uris,
      token_endpoint_auth_method: 'none',
      scope: brokerRegistrationScope(),
    };
    this.clients.set(client.client_id, client);
    return client;
  }

  getClient(clientId: string): OAuthBrokerClient | undefined {
    return this.clients.get(clientId);
  }

  authenticateClient(clientId: string, clientSecret: string | undefined): OAuthBrokerClient | null {
    const client = this.clients.get(clientId);
    return client || null;
  }
}
