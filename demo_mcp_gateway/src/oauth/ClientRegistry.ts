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
  /**
   * Scope the CLIENT is requesting (RFC 7591 registration request `scope`).
   * A spec-following client sets this to whatever it discovered as required
   * for the door it's about to use (a door's oauth-protected-resource
   * advertises its own `scopes_supported` — see mcpFacade.js's DOORS). Honored
   * only where it intersects the broker's own `scopesSupported`; anything
   * outside that set is dropped, same as an omitted scope. See
   * ClientRegistry.resolveRequestedScope.
   */
  scope?: string;
}

export class InvalidRedirectUriError extends Error {
  constructor(uri: string) {
    super(`redirect_uri must be a loopback address (127.0.0.1 or localhost): ${uri}`);
    this.name = 'InvalidRedirectUriError';
  }
}

/**
 * Default scope for a dynamically-registered client that requests none, or
 * requests only scopes outside what this broker advertises.
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
  private readonly supportedScopes: Set<string>;

  /**
   * @param scopesSupported the broker's RFC 8414 `scopes_supported` list
   * (GATEWAY_SCOPES in GatewayServer.ts) — the ceiling a dynamic client's
   * requested scope is bounded to. Unrelated to `MCP_GW_OAUTH_STATIC_SCOPE`,
   * which is operator-configured and not bounded by this set at all.
   */
  constructor(scopesSupported: string[] = [brokerRegistrationScope()]) {
    this.supportedScopes = new Set(scopesSupported);
    this.seedStaticClient();
  }

  /**
   * Bound a client's requested scope to what this broker actually
   * advertises. This is what lets per-door scope narrowing (e.g. the audit
   * façade door's `audit:read`) reach a DYNAMIC client at all: a
   * spec-following client (LM Studio, the MCP SDK) sets `scope` in its
   * /oauth/register body to what it discovered a door requires, and this
   * honors that — filtered to a known set, never to an arbitrary caller-named
   * value. A token's REAL scope is still whatever PingOne actually grants the
   * signed-in user at /oauth/authorize; this only decides what the registered
   * client record reports back to the client, which is what a spec-following
   * client asks for on every later request.
   */
  private resolveRequestedScope(requested: unknown): string {
    // `requested` is `meta.scope` straight out of an unauthenticated caller's
    // JSON body (OAuthBrokerRouter.handleRegister casts it but never checks
    // it) — a non-string value (array, number, object) used to reach
    // `.split()` here and throw, turning a bad request into an unhandled 500
    // instead of falling back to the default scope like an omitted one does.
    const tokens = (typeof requested === 'string' ? requested : '')
      .split(/\s+/)
      .filter((s) => s && this.supportedScopes.has(s));
    return tokens.length ? tokens.join(' ') : brokerRegistrationScope();
  }

  /**
   * Seed one operator-configured client from env.
   *
   * The loopback rule and the pinned scope above exist because /oauth/register
   * is UNAUTHENTICATED — anyone who can reach it could otherwise name their own
   * redirect target or scope. A client configured in server env is a different
   * trust level entirely: whoever set it already controls the deployment. So a
   * static client may use a non-loopback redirect (the BFF's own callback is
   * https://local.ping-devops.com:4000/..., which assertLoopback rejects by
   * design) and may hold a scope narrower or wider than mcp:invoke.
   *
   * This is the supported way for a server-side relay to hold audit:read: the
   * audit façade door advertises that scope, but no DYNAMIC client can ever be
   * granted it, and weakening either DCR control to work around that would
   * reopen the escalation both were added to close.
   */
  private seedStaticClient(): void {
    const clientId = process.env.MCP_GW_OAUTH_STATIC_CLIENT_ID;
    const redirectUris = (process.env.MCP_GW_OAUTH_STATIC_REDIRECT_URIS || '')
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean);
    if (!clientId || redirectUris.length === 0) return;

    this.clients.set(clientId, {
      client_id: clientId,
      client_name: process.env.MCP_GW_OAUTH_STATIC_CLIENT_NAME || 'Configured server-side client',
      grant_types: ['authorization_code'],
      redirect_uris: redirectUris,
      token_endpoint_auth_method: 'none',
      scope: process.env.MCP_GW_OAUTH_STATIC_SCOPE || brokerRegistrationScope(),
    });
  }

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
      scope: this.resolveRequestedScope(input.scope),
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
   * bounded scope resolution as registerClient; only the client_name is lost.
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
      scope: this.resolveRequestedScope(input.scope),
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
