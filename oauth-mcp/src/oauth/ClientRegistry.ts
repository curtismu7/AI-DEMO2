export interface OAuthClient {
  client_id: string;
  client_secret?: string;
  client_name: string;
  grant_types: string[];
  redirect_uris: string[];
  token_endpoint_auth_method: 'client_secret_basic' | 'client_secret_post' | 'none';
  scope: string;
}

const CIMD_TIMEOUT_MS = 5_000;
const CIMD_MAX_BYTES = 64 * 1024;

/**
 * One switch admits clients this server has never seen before, by either of the
 * two mechanisms unknown MCP clients actually use: RFC 7591 open registration
 * and Client ID Metadata Documents. They solve the same problem (ChatGPT/Claude
 * cannot be pre-registered), so they share a flag rather than needing two.
 */
export function openClientRegistrationEnabled(): boolean {
  return process.env.MCP_OPEN_CLIENT_REGISTRATION === 'true';
}

/**
 * Scope granted to a self-admitted client. Pinned server-side and never read
 * from the client's request: letting a caller name its own `scope` on an
 * unauthenticated registration is precisely the escalation the initial-access-
 * token gate existed to prevent, so open registration must not reintroduce it.
 */
export function openRegistrationScope(): string {
  return process.env.DCR_OPEN_REGISTRATION_SCOPE || 'mcp:invoke read';
}

/**
 * Reject hosts that would let a CIMD fetch reach the cluster's own network.
 * ponytail: literal-address check only — a hostname that DNS-resolves to a
 * private address still passes. Set CIMD_ALLOWED_HOSTS for a real allowlist.
 */
function isBlockedCimdHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h === '::1' || h.endsWith('.localhost')) return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  return false;
}

/**
 * Fetch and validate a Client ID Metadata Document
 * (draft-ietf-oauth-client-id-metadata-document): the client_id IS an https URL
 * serving the client's own metadata, so the domain vouches for the identity and
 * no registration step is needed.
 */
export async function fetchClientIdMetadataDocument(clientId: string): Promise<OAuthClient | undefined> {
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:') return undefined;

  const allowed = (process.env.CIMD_ALLOWED_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length > 0) {
    if (!allowed.includes(url.hostname.toLowerCase())) return undefined;
  } else if (isBlockedCimdHost(url.hostname)) {
    return undefined;
  }

  let doc: Record<string, unknown>;
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(CIMD_TIMEOUT_MS),
    });
    if (!response.ok) return undefined;
    const text = await response.text();
    if (text.length > CIMD_MAX_BYTES) return undefined;
    doc = JSON.parse(text);
  } catch {
    return undefined;
  }

  // The document must claim the very URL it was served from, or any site could
  // publish a document impersonating another client.
  if (doc.client_id !== clientId) return undefined;

  const redirectUris = Array.isArray(doc.redirect_uris) ? (doc.redirect_uris as string[]) : [];
  const grantTypes = Array.isArray(doc.grant_types) ? (doc.grant_types as string[]) : ['authorization_code'];

  return {
    client_id: clientId,
    client_name: typeof doc.client_name === 'string' ? doc.client_name : clientId,
    grant_types: grantTypes,
    redirect_uris: redirectUris,
    // A CIMD client holds no secret — the document's origin is the credential.
    token_endpoint_auth_method: 'none',
    scope: openRegistrationScope(),
  };
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

  /**
   * getClient, widened to admit a client identified by a Client ID Metadata
   * Document. Call this before getClient/authenticateClient on any request
   * that carries a client_id from outside; a CIMD-resolved client is cached so
   * the rest of the request path treats it like any other registered client.
   */
  async resolveClient(clientId: string): Promise<OAuthClient | undefined> {
    const known = this.clients.get(clientId);
    if (known) return known;
    if (!openClientRegistrationEnabled()) return undefined;
    const resolved = await fetchClientIdMetadataDocument(clientId);
    if (resolved) this.clients.set(clientId, resolved);
    return resolved;
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
