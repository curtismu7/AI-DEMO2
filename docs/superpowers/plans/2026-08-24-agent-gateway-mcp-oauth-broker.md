# Agent Gateway MCP OAuth Broker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a generic RFC-compliant HTTP MCP client (LM Studio first; Cursor, VS Code-Copilot, etc. for free) connect to `demo_mcp_gateway` with zero manual configuration, the same way LM Studio already connects to the Privilege-agentless gateway.

**Architecture:** `demo_mcp_gateway` gains a second, gateway-scoped OAuth Authorization Server: RFC 8414 metadata + RFC 7591 Dynamic Client Registration (ported from `oauth-mcp/src/oauth/{ClientRegistry,TokenStore}.ts`) + a two-hop `/oauth/authorize` → real PingOne → `/oauth/callback` redirect (pattern proven live in `oauth-mcp/src/oauth/OAuthRouter.ts`'s `handleAuthorize`/`handleAuthorizeCallback`). The broker hands the external client PingOne's real, unmodified access token — no self-issued JWT, no `TokenIssuer`/`SigningKeyManager` port, no JWKS re-verification (the gateway's existing `tokenValidator.ts` already verifies every inbound token on the actual `/mcp` call).

**Tech Stack:** TypeScript 5, raw Node `http` (matches `GatewayServer.ts`'s existing dispatch — no Express), `axios` (already a `demo_mcp_gateway` dependency), Jest 29.7 + ts-jest + `supertest`.

**Spec:** `docs/superpowers/specs/2026-08-24-agent-gateway-mcp-oauth-broker-design.md`

## Global Constraints

- Zero changes to `tokenValidator.ts`, `authorizeMcpRequest.ts`, `McpTokenExchangeClient.ts` — the broker passes through the real PingOne token unmodified.
- Zero changes to `oauth-mcp`'s live `OAuthRouter`/`TokenIssuer`/`ClientRegistry` — those are read as a reference pattern only, not imported or modified.
- New DCR redirect URIs accepted from external clients: **loopback only** (`127.0.0.1`/`localhost`), any port.
- PingOne app reused: `c8392dc4-2d82-4e49-92a8-79a78401faf5` ("Claude Code - Banking Gateway", env `01d89b06-66d5-430e-9f28-65636843788b`) — public client, PKCE S256 required, `tokenEndpointAuthMethod: NONE`. No new PingOne app.
- No CIMD (Client ID Metadata Document) support — YAGNI, LM Studio does plain RFC 7591, not CIMD.
- Tests must not make real network calls to PingOne — mock `axios`.

---

### Task 1: Broker storage — `ClientRegistry` and `BrokerTokenStore`

**Files:**
- Create: `demo_mcp_gateway/src/oauth/ClientRegistry.ts`
- Create: `demo_mcp_gateway/src/oauth/BrokerTokenStore.ts`
- Test: `demo_mcp_gateway/tests/oauth-client-registry.test.ts`
- Test: `demo_mcp_gateway/tests/oauth-broker-token-store.test.ts`

**Interfaces:**
- Produces: `ClientRegistry` class — `registerClient(meta: {client_name?: string; redirect_uris: string[]; grant_types?: string[]; token_endpoint_auth_method?: 'none'|'client_secret_basic'|'client_secret_post'}): OAuthBrokerClient` (throws `InvalidRedirectUriError` if any `redirect_uris` entry isn't loopback), `getClient(clientId: string): OAuthBrokerClient | undefined`, `authenticateClient(clientId: string, clientSecret: string | undefined): OAuthBrokerClient | null`.
- Produces: `OAuthBrokerClient` interface — `{ client_id: string; client_secret?: string; client_name: string; grant_types: string[]; redirect_uris: string[]; token_endpoint_auth_method: 'none'|'client_secret_basic'|'client_secret_post'; scope: string }`.
- Produces: `BrokerTokenStore` class — `createPendingAuthorization(params: {clientId: string; redirectUri: string; scope: string; codeChallenge: string; codeChallengeMethod: string; clientState: string; pingOneCodeVerifier: string}): string` (returns relay state), `consumePendingAuthorization(state: string): PendingAuthorization | null`, `createCode(params: {clientId: string; redirectUri: string; scope: string; codeChallenge: string; codeChallengeMethod: string; pingOneAccessToken: string; pingOneExpiresIn: number}): string`, `consumeCode(code: string): IssuedCode | null`. **`codeChallenge`/`codeChallengeMethod` on `createCode` are the EXTERNAL client's own PKCE challenge (from the pending authorization it was created against) — Task 4's `/oauth/token` verifies the external client's `code_verifier` against these before releasing the token. Without this, the broker's own authorization code would have no PKCE protection.**

- [ ] **Step 1: Write failing tests for `ClientRegistry`**

```typescript
// demo_mcp_gateway/tests/oauth-client-registry.test.ts
import { ClientRegistry, InvalidRedirectUriError } from '../src/oauth/ClientRegistry';

describe('ClientRegistry', () => {
  it('registers a client with loopback redirect_uris', () => {
    const registry = new ClientRegistry();
    const client = registry.registerClient({
      client_name: 'LM Studio',
      redirect_uris: ['http://127.0.0.1:33389/mcp-oauth-callback'],
    });
    expect(client.client_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(registry.getClient(client.client_id)).toEqual(client);
  });

  it('rejects a non-loopback redirect_uri', () => {
    const registry = new ClientRegistry();
    expect(() =>
      registry.registerClient({
        client_name: 'evil',
        redirect_uris: ['https://attacker.example.com/callback'],
      }),
    ).toThrow(InvalidRedirectUriError);
  });

  it('rejects an empty redirect_uris list', () => {
    const registry = new ClientRegistry();
    expect(() =>
      registry.registerClient({ client_name: 'no-redirects', redirect_uris: [] }),
    ).toThrow(InvalidRedirectUriError);
  });

  it('authenticateClient returns the client for token_endpoint_auth_method none with no secret', () => {
    const registry = new ClientRegistry();
    const client = registry.registerClient({
      client_name: 'public client',
      redirect_uris: ['http://localhost:9999/callback'],
      token_endpoint_auth_method: 'none',
    });
    expect(registry.authenticateClient(client.client_id, undefined)).toEqual(client);
  });

  it('authenticateClient returns null for an unknown client_id', () => {
    const registry = new ClientRegistry();
    expect(registry.authenticateClient('unknown-id', undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd demo_mcp_gateway && npx jest tests/oauth-client-registry.test.ts`
Expected: FAIL — `Cannot find module '../src/oauth/ClientRegistry'`

- [ ] **Step 3: Implement `ClientRegistry`**

```typescript
// demo_mcp_gateway/src/oauth/ClientRegistry.ts
import * as crypto from 'crypto';

export interface OAuthBrokerClient {
  client_id: string;
  client_secret?: string;
  client_name: string;
  grant_types: string[];
  redirect_uris: string[];
  token_endpoint_auth_method: 'none' | 'client_secret_basic' | 'client_secret_post';
  scope: string;
}

export interface RegisterClientInput {
  client_name?: string;
  redirect_uris: string[];
  grant_types?: string[];
  token_endpoint_auth_method?: 'none' | 'client_secret_basic' | 'client_secret_post';
}

export class InvalidRedirectUriError extends Error {
  constructor(uri: string) {
    super(`redirect_uri must be a loopback address (127.0.0.1/localhost): ${uri}`);
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
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
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
      token_endpoint_auth_method: input.token_endpoint_auth_method || 'none',
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
    if (!client) return null;
    if (client.token_endpoint_auth_method === 'none') return client;
    if (!clientSecret || clientSecret !== client.client_secret) return null;
    return client;
  }
}
```

- [ ] **Step 4: Run `ClientRegistry` tests to verify they pass**

Run: `cd demo_mcp_gateway && npx jest tests/oauth-client-registry.test.ts`
Expected: PASS (5/5)

- [ ] **Step 5: Write failing tests for `BrokerTokenStore`**

```typescript
// demo_mcp_gateway/tests/oauth-broker-token-store.test.ts
import { BrokerTokenStore } from '../src/oauth/BrokerTokenStore';

describe('BrokerTokenStore', () => {
  it('round-trips a pending authorization', () => {
    const store = new BrokerTokenStore();
    const state = store.createPendingAuthorization({
      clientId: 'client-1',
      redirectUri: 'http://127.0.0.1:1234/callback',
      scope: 'mcp:invoke',
      codeChallenge: 'abc',
      codeChallengeMethod: 'S256',
      clientState: 'client-supplied-state',
      pingOneCodeVerifier: 'verifier-123',
    });
    const pending = store.consumePendingAuthorization(state);
    expect(pending).not.toBeNull();
    expect(pending?.clientId).toBe('client-1');
    expect(pending?.pingOneCodeVerifier).toBe('verifier-123');
  });

  it('a pending authorization can only be consumed once', () => {
    const store = new BrokerTokenStore();
    const state = store.createPendingAuthorization({
      clientId: 'client-1', redirectUri: 'http://127.0.0.1:1234/callback',
      scope: 'mcp:invoke', codeChallenge: 'abc', codeChallengeMethod: 'S256',
      clientState: '', pingOneCodeVerifier: 'v',
    });
    expect(store.consumePendingAuthorization(state)).not.toBeNull();
    expect(store.consumePendingAuthorization(state)).toBeNull();
  });

  it('round-trips an issued code carrying the real PingOne token', () => {
    const store = new BrokerTokenStore();
    const code = store.createCode({
      clientId: 'client-1', redirectUri: 'http://127.0.0.1:1234/callback',
      scope: 'mcp:invoke', codeChallenge: 'challenge-abc', codeChallengeMethod: 'S256',
      pingOneAccessToken: 'real-pingone-jwt', pingOneExpiresIn: 3600,
    });
    const issued = store.consumeCode(code);
    expect(issued).not.toBeNull();
    expect(issued?.pingOneAccessToken).toBe('real-pingone-jwt');
  });

  it('an issued code can only be consumed once', () => {
    const store = new BrokerTokenStore();
    const code = store.createCode({
      clientId: 'client-1', redirectUri: 'http://127.0.0.1:1234/callback',
      scope: 'mcp:invoke', codeChallenge: 'challenge-abc', codeChallengeMethod: 'S256', pingOneAccessToken: 't', pingOneExpiresIn: 3600,
    });
    expect(store.consumeCode(code)).not.toBeNull();
    expect(store.consumeCode(code)).toBeNull();
  });

  it('an expired code is not returned', () => {
    const store = new BrokerTokenStore();
    const code = store.createCode({
      clientId: 'client-1', redirectUri: 'http://127.0.0.1:1234/callback',
      scope: 'mcp:invoke', codeChallenge: 'challenge-abc', codeChallengeMethod: 'S256', pingOneAccessToken: 't', pingOneExpiresIn: 3600,
    }, -1);
    expect(store.consumeCode(code)).toBeNull();
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `cd demo_mcp_gateway && npx jest tests/oauth-broker-token-store.test.ts`
Expected: FAIL — `Cannot find module '../src/oauth/BrokerTokenStore'`

- [ ] **Step 7: Implement `BrokerTokenStore`**

```typescript
// demo_mcp_gateway/src/oauth/BrokerTokenStore.ts
import * as crypto from 'crypto';

export interface PendingAuthorization {
  state: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  /** The original external client's own `state` — relayed back once the
   *  PingOne hop completes. Never sent to PingOne itself. */
  clientState: string;
  /** PKCE verifier the BROKER generated for its own hop to PingOne —
   *  distinct from `codeChallenge`, which belongs to the external client's
   *  PKCE against this broker. */
  pingOneCodeVerifier: string;
  expiresAt: number;
}

export interface IssuedCode {
  code: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  /** The EXTERNAL client's own PKCE challenge (from /oauth/authorize) —
   *  carried through so /oauth/token can verify the external client's
   *  code_verifier before releasing the token. Without this, the broker's
   *  own authorization code would have no PKCE protection at all. */
  codeChallenge: string;
  codeChallengeMethod: string;
  /** The real, unmodified PingOne access token — this IS the artifact the
   *  external client ultimately receives from /oauth/token. */
  pingOneAccessToken: string;
  pingOneExpiresIn: number;
  expiresAt: number;
}

const PENDING_TTL_MS = 600_000; // 10 minutes — a real PingOne login takes longer than a code exchange
const CODE_TTL_MS = 60_000;

/**
 * In-memory store bridging the external client's outer OAuth leg to the
 * broker's inner PingOne leg. No self-issued tokens live here — unlike
 * oauth-mcp's TokenStore, there is no `trackToken`/`introspect`/`revoke`,
 * because this broker never mints its own bearer; it only relays PingOne's.
 */
export class BrokerTokenStore {
  private pending: Map<string, PendingAuthorization> = new Map();
  private codes: Map<string, IssuedCode> = new Map();

  createPendingAuthorization(params: Omit<PendingAuthorization, 'state' | 'expiresAt'>): string {
    const state = crypto.randomBytes(32).toString('base64url');
    this.pending.set(state, { ...params, state, expiresAt: Date.now() + PENDING_TTL_MS });
    return state;
  }

  consumePendingAuthorization(state: string): PendingAuthorization | null {
    const entry = this.pending.get(state);
    if (!entry) return null;
    this.pending.delete(state);
    if (Date.now() > entry.expiresAt) return null;
    return entry;
  }

  createCode(params: Omit<IssuedCode, 'code' | 'expiresAt'>, ttlMsOverride?: number): string {
    const code = crypto.randomBytes(32).toString('base64url');
    this.codes.set(code, {
      ...params,
      code,
      expiresAt: Date.now() + (ttlMsOverride ?? CODE_TTL_MS),
    });
    return code;
  }

  consumeCode(code: string): IssuedCode | null {
    const entry = this.codes.get(code);
    if (!entry) return null;
    this.codes.delete(code);
    if (Date.now() > entry.expiresAt) return null;
    return entry;
  }
}
```

- [ ] **Step 8: Run `BrokerTokenStore` tests to verify they pass**

Run: `cd demo_mcp_gateway && npx jest tests/oauth-broker-token-store.test.ts`
Expected: PASS (5/5)

- [ ] **Step 9: Commit**

```bash
git add demo_mcp_gateway/src/oauth/ClientRegistry.ts demo_mcp_gateway/src/oauth/BrokerTokenStore.ts demo_mcp_gateway/tests/oauth-client-registry.test.ts demo_mcp_gateway/tests/oauth-broker-token-store.test.ts
git commit -m "feat(gateway): add ClientRegistry and BrokerTokenStore for the MCP OAuth broker"
```

---

### Task 2: `OAuthBrokerRouter` — RFC 8414 metadata + RFC 7591 registration

**Files:**
- Create: `demo_mcp_gateway/src/oauth/OAuthBrokerRouter.ts`
- Test: `demo_mcp_gateway/tests/oauth-broker-router-metadata.test.ts`

**Interfaces:**
- Consumes: `ClientRegistry` (Task 1), `BrokerTokenStore` (Task 1), `selfBaseUrl(req, fallbackPort)` from `../selfBaseUrl` (existing).
- Produces: `OAuthBrokerRouter` class — `constructor(clientRegistry: ClientRegistry, tokenStore: BrokerTokenStore, gatewayResourceUri: string)`, `async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean>` (returns true if it handled the request — same contract as `GatewayServer`'s other handlers).

- [ ] **Step 1: Write failing tests for metadata + register**

```typescript
// demo_mcp_gateway/tests/oauth-broker-router-metadata.test.ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd demo_mcp_gateway && npx jest tests/oauth-broker-router-metadata.test.ts`
Expected: FAIL — `Cannot find module '../src/oauth/OAuthBrokerRouter'`

- [ ] **Step 3: Implement `OAuthBrokerRouter` (metadata + register only for this task)**

```typescript
// demo_mcp_gateway/src/oauth/OAuthBrokerRouter.ts
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
        token_endpoint_auth_method: meta.token_endpoint_auth_method as 'none' | undefined,
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd demo_mcp_gateway && npx jest tests/oauth-broker-router-metadata.test.ts`
Expected: PASS (4/4)

- [ ] **Step 5: Commit**

```bash
git add demo_mcp_gateway/src/oauth/OAuthBrokerRouter.ts demo_mcp_gateway/tests/oauth-broker-router-metadata.test.ts
git commit -m "feat(gateway): add OAuthBrokerRouter with RFC 8414 metadata + RFC 7591 register"
```

---

### Task 3: `/oauth/authorize` and `/oauth/callback` — the two-hop PingOne redirect

**Files:**
- Modify: `demo_mcp_gateway/src/oauth/OAuthBrokerRouter.ts`
- Test: `demo_mcp_gateway/tests/oauth-broker-router-authorize.test.ts`

**Interfaces:**
- Consumes: `axios` (mocked in tests via `jest.mock('axios')`), env vars `GATEWAY_OAUTH_BROKER_PINGONE_CLIENT_ID`, `PINGONE_AUTHORIZATION_ENDPOINT`, `PINGONE_TOKEN_ENDPOINT` (same names/shape `oauthEndpointResolver` in `config.ts` already derives from `PINGONE_ENVIRONMENT_ID`/`PINGONE_REGION` — reuse that resolver rather than inventing new env vars; see Step 3 note).
- Produces: nothing new consumed by later tasks — this task's deliverable is directly testable end-to-end once Task 4 adds `/oauth/token`.

**Resolved via live PingOne lookup (`mcp__pingone__getResource` + `mcp__pingone__listApplicationGrants`, 2026-08-24):** the Agent Gateway's resource is `b773bc8e-71f8-4b1f-bf99-e3465e48132f` ("Demo MCP Gateway"), audience `mcpgateway.ping.demo` — this is `MCP_GW_RESOURCE_URI`. `c8392dc4`'s grant on that resource includes scope `mcp:invoke` ("Invoke MCP tools via the gateway (RFC 8693 exchange)"), among others (`read`, `write`, `transfer`, several vertical-specific `*:read` scopes). `mcp:invoke` is the correct, minimal scope for this broker — Step 3's `scope` param is `openid profile email mcp:invoke`, matching the pattern `oauth-mcp/src/oauth/OAuthRouter.ts:178-194` documents (`resource=` alone doesn't audience the token — the scope list must include a scope the resource owns).

- [ ] **Step 1: Write failing tests for authorize + callback**

```typescript
// demo_mcp_gateway/tests/oauth-broker-router-authorize.test.ts
import { createServer, Server } from 'http';
import supertest from 'supertest';
import axios from 'axios';
import { OAuthBrokerRouter } from '../src/oauth/OAuthBrokerRouter';
import { ClientRegistry } from '../src/oauth/ClientRegistry';
import { BrokerTokenStore } from '../src/oauth/BrokerTokenStore';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd demo_mcp_gateway && npx jest tests/oauth-broker-router-authorize.test.ts`
Expected: FAIL — `/oauth/authorize` and `/oauth/callback` both 404 (not yet handled)

- [ ] **Step 3: Implement `/oauth/authorize` and `/oauth/callback`**

Add to `OAuthBrokerRouter`'s `handle()` switch:

```typescript
      case '/oauth/authorize':
        return this.handleAuthorize(req, res, url);
      case '/oauth/callback':
        return this.handleCallback(req, res, url);
```

And add these private methods (import `axios` and `crypto` at the top; `crypto` is already imported for `readBody`... actually add `import * as crypto from 'crypto';`):

```typescript
  private async handleAuthorize(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const clientId = url.searchParams.get('client_id');
    const redirectUri = url.searchParams.get('redirect_uri');
    const responseType = url.searchParams.get('response_type');
    const codeChallenge = url.searchParams.get('code_challenge');
    const codeChallengeMethod = url.searchParams.get('code_challenge_method') || 'S256';
    const state = url.searchParams.get('state') || '';
    const scope = url.searchParams.get('scope') || 'mcp:invoke';

    if (!clientId || !redirectUri || responseType !== 'code' || !codeChallenge) {
      this.json(res, 400, { error: 'invalid_request', error_description: 'Missing required parameters' });
      return true;
    }
    const client = this.clientRegistry.getClient(clientId);
    if (!client) {
      this.json(res, 400, { error: 'invalid_client', error_description: 'Unknown client_id' });
      return true;
    }
    if (!client.redirect_uris.includes(redirectUri)) {
      this.json(res, 400, { error: 'invalid_request', error_description: 'redirect_uri not registered' });
      return true;
    }

    const pingOneClientId = process.env.GATEWAY_OAUTH_BROKER_PINGONE_CLIENT_ID;
    const envId = process.env.PINGONE_ENVIRONMENT_ID;
    const region = process.env.PINGONE_REGION || 'com';
    if (!pingOneClientId || !envId) {
      this.json(res, 503, {
        error: 'temporarily_unavailable',
        error_description: 'PingOne federation is not configured (GATEWAY_OAUTH_BROKER_PINGONE_CLIENT_ID / PINGONE_ENVIRONMENT_ID)',
      });
      return true;
    }

    // Broker's own PKCE for its hop to PingOne — independent of the external
    // client's PKCE (codeChallenge above). Two separate exchanges.
    const pingOneCodeVerifier = crypto.randomBytes(32).toString('base64url');
    const pingOneCodeChallenge = crypto.createHash('sha256').update(pingOneCodeVerifier).digest('base64url');

    const relayState = this.tokenStore.createPendingAuthorization({
      clientId, redirectUri, scope, codeChallenge, codeChallengeMethod,
      clientState: state, pingOneCodeVerifier,
    });

    const issuer = this.issuer(req);
    const pingOneAuthorize = new URL(`https://auth.pingone.${region}/${envId}/as/authorize`);
    pingOneAuthorize.searchParams.set('client_id', pingOneClientId);
    pingOneAuthorize.searchParams.set('redirect_uri', `${issuer}/oauth/callback`);
    pingOneAuthorize.searchParams.set('response_type', 'code');
    pingOneAuthorize.searchParams.set('state', relayState);
    pingOneAuthorize.searchParams.set('code_challenge', pingOneCodeChallenge);
    pingOneAuthorize.searchParams.set('code_challenge_method', 'S256');
    pingOneAuthorize.searchParams.set('resource', this.gatewayResourceUri);
    // TODO(resolved at implementation time via mcp__pingone__listApplicationGrants —
    // see the plan's Task 3 preamble): the scope list must include whatever scope
    // the Agent Gateway resource actually grants c8392dc4, or PingOne will issue a
    // token audienced to its own default instead of gatewayResourceUri.
    pingOneAuthorize.searchParams.set('scope', 'openid profile email');

    res.writeHead(302, { Location: pingOneAuthorize.toString() });
    res.end();
    return true;
  }

  private async handleCallback(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const code = url.searchParams.get('code');
    const relayState = url.searchParams.get('state');
    const pingOneError = url.searchParams.get('error');

    if (pingOneError) {
      this.json(res, 400, { error: 'access_denied', error_description: `PingOne login failed: ${pingOneError}` });
      return true;
    }
    if (!code || !relayState) {
      this.json(res, 400, { error: 'invalid_request', error_description: 'Missing code or state from PingOne callback' });
      return true;
    }
    const pending = this.tokenStore.consumePendingAuthorization(relayState);
    if (!pending) {
      this.json(res, 400, { error: 'invalid_grant', error_description: 'Unknown or expired authorization request' });
      return true;
    }

    const pingOneClientId = process.env.GATEWAY_OAUTH_BROKER_PINGONE_CLIENT_ID;
    const envId = process.env.PINGONE_ENVIRONMENT_ID;
    const region = process.env.PINGONE_REGION || 'com';
    if (!pingOneClientId || !envId) {
      this.json(res, 503, { error: 'temporarily_unavailable', error_description: 'PingOne federation is not configured' });
      return true;
    }

    let pingOneAccessToken: string;
    let expiresIn: number;
    try {
      const issuer = this.issuer(req);
      const tokenParams = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${issuer}/oauth/callback`,
        client_id: pingOneClientId,
        code_verifier: pending.pingOneCodeVerifier,
        resource: this.gatewayResourceUri,
      });
      const tokenResponse = await axios.post(
        `https://auth.pingone.${region}/${envId}/as/token`,
        tokenParams.toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );
      pingOneAccessToken = tokenResponse.data.access_token as string;
      expiresIn = (tokenResponse.data.expires_in as number) || 3600;
      if (!pingOneAccessToken) throw new Error('PingOne token response had no access_token');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.json(res, 502, { error: 'server_error', error_description: `PingOne token exchange failed: ${msg}` });
      return true;
    }

    const ownCode = this.tokenStore.createCode({
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
      scope: pending.scope,
      codeChallenge: pending.codeChallenge,
      codeChallengeMethod: pending.codeChallengeMethod,
      pingOneAccessToken,
      pingOneExpiresIn: expiresIn,
    });

    const callback = new URL(pending.redirectUri);
    callback.searchParams.set('code', ownCode);
    if (pending.clientState) callback.searchParams.set('state', pending.clientState);
    res.writeHead(302, { Location: callback.toString() });
    res.end();
    return true;
  }
```

Add `import axios from 'axios';` and `import * as crypto from 'crypto';` to the top of the file alongside the existing imports.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd demo_mcp_gateway && npx jest tests/oauth-broker-router-authorize.test.ts`
Expected: PASS (6/6)

- [ ] **Step 5: Commit**

```bash
git add demo_mcp_gateway/src/oauth/OAuthBrokerRouter.ts demo_mcp_gateway/tests/oauth-broker-router-authorize.test.ts
git commit -m "feat(gateway): add /oauth/authorize and /oauth/callback two-hop PingOne redirect"
```

---

### Task 4: `/oauth/token` — real-token pass-through

**Files:**
- Modify: `demo_mcp_gateway/src/oauth/OAuthBrokerRouter.ts`
- Test: `demo_mcp_gateway/tests/oauth-broker-router-token.test.ts`

**Interfaces:**
- Consumes: `BrokerTokenStore.consumeCode` (Task 1).
- Produces: the full external round trip is now testable — register → authorize → callback → token.

- [ ] **Step 1: Write failing tests**

```typescript
// demo_mcp_gateway/tests/oauth-broker-router-token.test.ts
import { createServer, Server } from 'http';
import supertest from 'supertest';
import { OAuthBrokerRouter } from '../src/oauth/OAuthBrokerRouter';
import { ClientRegistry } from '../src/oauth/ClientRegistry';
import { BrokerTokenStore } from '../src/oauth/BrokerTokenStore';

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

// A real S256 pair — computed once via:
// node -e "const c=require('crypto');const v='test-code-verifier-1234567890abcdef';console.log(c.createHash('sha256').update(v).digest('base64url'))"
const VALID_VERIFIER = 'test-code-verifier-1234567890abcdef';
const VALID_CHALLENGE = 'eV1Pn224EN4EvJLQQwhf3obGtpz6dQJCPK_fP9UaWMw';

describe('OAuthBrokerRouter /oauth/token', () => {
  it('trades the broker\'s code for the real, unmodified PingOne access token, given the matching code_verifier', async () => {
    const { clientRegistry, tokenStore, server } = makeRouterAndServer();
    const client = clientRegistry.registerClient({
      client_name: 'LM Studio', redirect_uris: ['http://127.0.0.1:33389/mcp-oauth-callback'],
    });
    const code = tokenStore.createCode({
      clientId: client.client_id,
      redirectUri: 'http://127.0.0.1:33389/mcp-oauth-callback',
      scope: 'mcp:invoke',
      codeChallenge: VALID_CHALLENGE,
      codeChallengeMethod: 'S256',
      pingOneAccessToken: 'REAL-PINGONE-TOKEN',
      pingOneExpiresIn: 3600,
    });

    const res = await supertest(server)
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'http://127.0.0.1:33389/mcp-oauth-callback',
        client_id: client.client_id,
        code_verifier: VALID_VERIFIER,
      });

    expect(res.status).toBe(200);
    expect(res.body.access_token).toBe('REAL-PINGONE-TOKEN');
    expect(res.body.token_type).toBe('Bearer');
    expect(res.body.expires_in).toBe(3600);
  });

  it('rejects a token request with a code_verifier that does not match the original code_challenge', async () => {
    const { clientRegistry, tokenStore, server } = makeRouterAndServer();
    const client = clientRegistry.registerClient({
      client_name: 'LM Studio', redirect_uris: ['http://127.0.0.1:33389/mcp-oauth-callback'],
    });
    const code = tokenStore.createCode({
      clientId: client.client_id,
      redirectUri: 'http://127.0.0.1:33389/mcp-oauth-callback',
      scope: 'mcp:invoke',
      codeChallenge: VALID_CHALLENGE,
      codeChallengeMethod: 'S256',
      pingOneAccessToken: 'REAL-PINGONE-TOKEN',
      pingOneExpiresIn: 3600,
    });
    const res = await supertest(server)
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'http://127.0.0.1:33389/mcp-oauth-callback',
        client_id: client.client_id,
        code_verifier: 'wrong-verifier-does-not-hash-to-the-challenge',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
  });

  it('rejects a token request with no code_verifier at all', async () => {
    const { clientRegistry, tokenStore, server } = makeRouterAndServer();
    const client = clientRegistry.registerClient({
      client_name: 'LM Studio', redirect_uris: ['http://127.0.0.1:33389/mcp-oauth-callback'],
    });
    const code = tokenStore.createCode({
      clientId: client.client_id,
      redirectUri: 'http://127.0.0.1:33389/mcp-oauth-callback',
      scope: 'mcp:invoke',
      codeChallenge: VALID_CHALLENGE,
      codeChallengeMethod: 'S256',
      pingOneAccessToken: 'REAL-PINGONE-TOKEN',
      pingOneExpiresIn: 3600,
    });
    const res = await supertest(server)
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'http://127.0.0.1:33389/mcp-oauth-callback',
        client_id: client.client_id,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
  });

  it('rejects a code redeemed by a different client_id than it was issued to', async () => {
    const { clientRegistry, tokenStore, server } = makeRouterAndServer();
    const client = clientRegistry.registerClient({
      client_name: 'x', redirect_uris: ['http://127.0.0.1:1/callback'],
    });
    const otherClient = clientRegistry.registerClient({
      client_name: 'y', redirect_uris: ['http://127.0.0.1:2/callback'],
    });
    const code = tokenStore.createCode({
      clientId: client.client_id, redirectUri: 'http://127.0.0.1:1/callback',
      scope: 'mcp:invoke', codeChallenge: 'challenge-abc', codeChallengeMethod: 'S256', pingOneAccessToken: 't', pingOneExpiresIn: 3600,
    });
    const res = await supertest(server)
      .post('/oauth/token')
      .type('form')
      .send({ grant_type: 'authorization_code', code, redirect_uri: 'http://127.0.0.1:1/callback', client_id: otherClient.client_id });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
  });

  it('rejects an already-consumed code', async () => {
    const { clientRegistry, tokenStore, server } = makeRouterAndServer();
    const client = clientRegistry.registerClient({ client_name: 'x', redirect_uris: ['http://127.0.0.1:1/callback'] });
    // Needs a REAL matching verifier/challenge pair — a first redemption that
    // fails PKCE (400) would never reach the replay check this test exists to
    // verify, so this can't reuse the dummy 'challenge-abc' the other two
    // client/redirect-mismatch tests use (those return 400 before the PKCE
    // check anyway, so a dummy is fine there but not here).
    const code = tokenStore.createCode({
      clientId: client.client_id, redirectUri: 'http://127.0.0.1:1/callback',
      scope: 'mcp:invoke', codeChallenge: VALID_CHALLENGE, codeChallengeMethod: 'S256', pingOneAccessToken: 't', pingOneExpiresIn: 3600,
    });
    const body = {
      grant_type: 'authorization_code', code, redirect_uri: 'http://127.0.0.1:1/callback',
      client_id: client.client_id, code_verifier: VALID_VERIFIER,
    };
    const first = await supertest(server).post('/oauth/token').type('form').send(body);
    expect(first.status).toBe(200);
    const second = await supertest(server).post('/oauth/token').type('form').send(body);
    expect(second.status).toBe(400);
    expect(second.body.error).toBe('invalid_grant');
  });

  it('rejects an unsupported grant_type', async () => {
    const { server } = makeRouterAndServer();
    const res = await supertest(server)
      .post('/oauth/token')
      .type('form')
      .send({ grant_type: 'client_credentials' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unsupported_grant_type');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd demo_mcp_gateway && npx jest tests/oauth-broker-router-token.test.ts`
Expected: FAIL — `/oauth/token` 404s (not yet handled)

- [ ] **Step 3: Implement `/oauth/token`**

Add to the `handle()` switch:

```typescript
      case '/oauth/token':
        return this.handleToken(req, res);
```

Add the method:

```typescript
  private async handleToken(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    if (req.method !== 'POST') {
      this.json(res, 405, { error: 'method_not_allowed' });
      return true;
    }
    const body = await this.readBody(req);
    const params = new URLSearchParams(body);
    const grantType = params.get('grant_type');

    if (grantType !== 'authorization_code') {
      this.json(res, 400, { error: 'unsupported_grant_type' });
      return true;
    }

    const code = params.get('code');
    const redirectUri = params.get('redirect_uri');
    const clientId = params.get('client_id');
    const codeVerifier = params.get('code_verifier');
    if (!code || !redirectUri || !clientId) {
      this.json(res, 400, { error: 'invalid_request', error_description: 'Missing code, redirect_uri, or client_id' });
      return true;
    }

    const issued = this.tokenStore.consumeCode(code);
    if (!issued) {
      this.json(res, 400, { error: 'invalid_grant', error_description: 'Invalid or expired authorization code' });
      return true;
    }
    if (issued.clientId !== clientId || issued.redirectUri !== redirectUri) {
      this.json(res, 400, { error: 'invalid_grant', error_description: 'Code was issued to a different client/redirect' });
      return true;
    }

    // PKCE verification — this is what makes the broker's own authorization
    // code safe to hand back over a loopback redirect: without it, any other
    // local process that observed the code (e.g. via the redirect_uri) could
    // redeem it. Mirrors oauth-mcp's OAuthRouter.verifyPKCE (S256 only).
    if (!codeVerifier || !this.verifyPKCE(codeVerifier, issued.codeChallenge, issued.codeChallengeMethod)) {
      this.json(res, 400, { error: 'invalid_grant', error_description: 'PKCE verification failed' });
      return true;
    }

    // This IS the pass-through: the exact token PingOne issued, unmodified.
    this.json(res, 200, {
      access_token: issued.pingOneAccessToken,
      token_type: 'Bearer',
      expires_in: issued.pingOneExpiresIn,
      scope: issued.scope,
    });
    return true;
  }

  private verifyPKCE(verifier: string, challenge: string, method: string): boolean {
    if (method !== 'S256') return false;
    const computed = crypto.createHash('sha256').update(verifier).digest('base64url');
    return computed === challenge;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd demo_mcp_gateway && npx jest tests/oauth-broker-router-token.test.ts`
Expected: PASS (6/6)

- [ ] **Step 5: Run the full broker test suite together**

Run: `cd demo_mcp_gateway && npx jest tests/oauth-client-registry.test.ts tests/oauth-broker-token-store.test.ts tests/oauth-broker-router-metadata.test.ts tests/oauth-broker-router-authorize.test.ts tests/oauth-broker-router-token.test.ts`
Expected: PASS (all)

- [ ] **Step 6: Commit**

```bash
git add demo_mcp_gateway/src/oauth/OAuthBrokerRouter.ts demo_mcp_gateway/tests/oauth-broker-router-token.test.ts
git commit -m "feat(gateway): add /oauth/token real-PingOne-token pass-through, completing the broker"
```

---

### Task 5: Wire the broker into `GatewayServer` and point RFC 9728 metadata at it

**Files:**
- Modify: `demo_mcp_gateway/src/server/GatewayServer.ts`
- Test: `demo_mcp_gateway/tests/gateway-oauth-broker-wiring.test.ts`

**Interfaces:**
- Consumes: `OAuthBrokerRouter`, `ClientRegistry`, `BrokerTokenStore` (Tasks 1-4).

- [ ] **Step 1: Write failing tests**

```typescript
// demo_mcp_gateway/tests/gateway-oauth-broker-wiring.test.ts
import supertest from 'supertest';
import { GatewayServer } from '../src/server/GatewayServer';
import type { GatewayConfig } from '../src/config';

delete process.env.PINGONE_JWKS_ENDPOINT;
delete process.env.PINGONE_JWKS_URI;
process.env.MCP_GW_ALLOW_UNVERIFIED_TOKENS = 'true';
process.env.PINGONE_ENVIRONMENT_ID = '01d89b06-66d5-430e-9f28-65636843788b';
process.env.PINGONE_REGION = 'com';

const GATEWAY_AUDIENCE = 'https://mcp-gateway.example.com';

// Copy the stubConfig shape from gateway-server-discover.test.ts — see that
// file for the full field list this repo's GatewayConfig requires.
const stubConfig: GatewayConfig = {
  port: 0, host: '127.0.0.1', clientId: 'test-client-id', clientSecret: 'test-client-secret',
  tokenEndpointAuthMethod: 'basic', tokenEndpoint: 'https://auth.example.com/token',
  gatewayResourceUri: GATEWAY_AUDIENCE, mcpOlbWsUrl: 'ws://localhost:8080',
  mcpResourceServerWsUrl: 'ws://localhost:8081', mcpResourceServerHttpUrl: 'http://localhost:8081',
  mcpResourceServerApiKey: '', mcpOlbResourceUri: 'https://mcp-olb.example.com',
  mcpResourceServerResourceUri: 'https://mcp-resource-server.example.com',
  pingAuthorizeEndpoint: '', pingAuthorizeWorkerId: '', p1azEnabled: false,
  hitlServiceUrl: '', introspectionEndpoint: '', introspectionClientId: '',
  introspectionClientSecret: '', devBypass: false, demoApiKeyServiceKey: 'demo-api-key-0000',
  apiResourceServerBaseUrl: 'http://localhost:8082', apiResourceServerApiKey: 'demo-mortgage-key-0000',
  bffInternalIdTokenUrl: 'http://localhost:3001/internal/id-token',
} as GatewayConfig;

describe('GatewayServer OAuth broker wiring', () => {
  it('GET /.well-known/oauth-authorization-server is served by the gateway', async () => {
    const server = new GatewayServer({ config: stubConfig, upstreamMcpUrl: 'ws://localhost:9' });
    const res = await supertest(server.httpServer).get('/.well-known/oauth-authorization-server');
    expect(res.status).toBe(200);
    expect(res.body.registration_endpoint).toMatch(/\/oauth\/register$/);
  });

  it('POST /oauth/register is served by the gateway', async () => {
    const server = new GatewayServer({ config: stubConfig, upstreamMcpUrl: 'ws://localhost:9' });
    const res = await supertest(server.httpServer)
      .post('/oauth/register')
      .send({ client_name: 'LM Studio', redirect_uris: ['http://127.0.0.1:1/callback'] });
    expect(res.status).toBe(201);
  });

  it('the existing RFC 9728 protected-resource metadata now points authorization_servers at THIS gateway, not raw PingOne', async () => {
    const server = new GatewayServer({ config: stubConfig, upstreamMcpUrl: 'ws://localhost:9' });
    const res = await supertest(server.httpServer).get('/.well-known/oauth-protected-resource');
    expect(res.status).toBe(200);
    expect(res.body.authorization_servers).toEqual([GATEWAY_AUDIENCE]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd demo_mcp_gateway && npx jest tests/gateway-oauth-broker-wiring.test.ts`
Expected: FAIL — `/oauth/*` 404s; `authorization_servers` still points at `auth.pingone.com/...`

- [ ] **Step 3: Wire the broker into `GatewayServer`**

In `demo_mcp_gateway/src/server/GatewayServer.ts`, add imports near the top (alongside the existing ones):

```typescript
import { OAuthBrokerRouter } from '../oauth/OAuthBrokerRouter';
import { ClientRegistry } from '../oauth/ClientRegistry';
import { BrokerTokenStore } from '../oauth/BrokerTokenStore';
```

Add a private field and initialize it in the constructor (near where `this.config = config;` or similar is set — match the existing constructor's style):

```typescript
  private oauthBroker: OAuthBrokerRouter;
```

```typescript
    this.oauthBroker = new OAuthBrokerRouter(
      new ClientRegistry(),
      new BrokerTokenStore(),
      this.config.gatewayResourceUri,
    );
```

In `handleRequest()`, add a dispatch to the broker right after the existing `/.well-known/oauth-protected-resource` block (around line 234) and before the `/health` block:

```typescript
    if (this.isOAuthBrokerPath(url) ) {
      const parsedUrl = new URL(url, `http://${req.headers.host || 'localhost'}`);
      const handled = await this.oauthBroker.handle(req, res, parsedUrl);
      if (handled) return;
    }
```

Add the small path-matching helper near the other private helpers:

```typescript
  private isOAuthBrokerPath(url: string): boolean {
    const pathname = url.split('?')[0];
    return pathname === '/.well-known/oauth-authorization-server'
      || pathname === '/oauth/register'
      || pathname === '/oauth/authorize'
      || pathname === '/oauth/callback'
      || pathname === '/oauth/token';
  }
```

Finally, update `handleMetadata()` (the existing RFC 9728 handler, ~line 412-440) so `authorization_servers` points at this gateway's own issuer instead of raw PingOne — this is the change that actually makes generic clients try the broker instead of failing against PingOne's non-existent DCR:

```typescript
    if (pingOneEnvId) {
      metadata.authorization_servers = [this.config.gatewayResourceUri];
    }
```

(replacing the existing block that built `https://auth.pingone.${pingOneRegion}/${pingOneEnvId}/as`). Note `pingOneRegion`/`pingOneEnvId` locals in that method become unused for this purpose — leave them if `isEnterpriseManagedMcpAuthEnabled()`'s block below still needs them; if not, remove the now-dead `pingOneRegion` local only (don't touch unrelated code).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd demo_mcp_gateway && npx jest tests/gateway-oauth-broker-wiring.test.ts`
Expected: PASS (3/3)

- [ ] **Step 5: Run the full existing gateway suite to confirm no regression**

Run: `cd demo_mcp_gateway && npm test`
Expected: all previously-passing tests still pass, including the 14 `gateway-*.test.ts` files this work must not disturb (per the spec's success criteria) — pay particular attention to any existing test asserting on `authorization_servers`' old PingOne-URL value; update that assertion only if it exists and only to the new value (this is the one intentional behavior change in this task).

- [ ] **Step 6: `tsc` type-check**

Run: `cd demo_mcp_gateway && npm run build`
Expected: exits 0, no type errors.

- [ ] **Step 7: Commit**

```bash
git add demo_mcp_gateway/src/server/GatewayServer.ts demo_mcp_gateway/tests/gateway-oauth-broker-wiring.test.ts
git commit -m "feat(gateway): wire OAuth broker into GatewayServer; RFC 9728 now points authorization_servers at the broker"
```

---

### Task 6: PingOne app config + live LM Studio verification

**Files:** none (PingOne console/API + manual verification — no code)

This task has no automated test; it is the spec's "Live" verification step.

- [ ] **Step 1: Add this gateway's real callback URL to the PingOne app**

Using `mcp__pingone__updateApplication` (environment `01d89b06-66d5-430e-9f28-65636843788b`, application `c8392dc4-2d82-4e49-92a8-79a78401faf5`), add `<gateway's real base URL>/oauth/callback` to the existing `redirectUris` array (do not remove the existing `localhost:7465` entries — other things may still use them). Pick whichever deployment host you're testing against first (per the spec: don't pre-add every possible host).

- [ ] **Step 2: Set the new env vars on that deployment**

```
GATEWAY_OAUTH_BROKER_PINGONE_CLIENT_ID=c8392dc4-2d82-4e49-92a8-79a78401faf5
```

(`PINGONE_ENVIRONMENT_ID` / `PINGONE_REGION` already exist in every deployment's env per `config.ts`'s `oauthEndpointResolver` — no new var needed for those.)

- [ ] **Step 3: Point LM Studio at the gateway**

Add to `~/.lmstudio/mcp.json`:

```json
"agent-gateway": {
  "url": "https://<gateway-host>/mcp"
}
```

Restart LM Studio, toggle the server on, click through the PingOne login it should now prompt for automatically (same zero-touch experience as `agentless-mcpgw` earlier this session).

- [ ] **Step 4: Verify the resulting tool call is authorized like any other**

Tail the gateway's logs during the LM Studio tool call and confirm `authorizeMcpRequest.ts`'s P1AZ evaluate() line fires with a `PERMIT`/`DENY` decision exactly as it does for BFF-originated calls — this is the proof that passing the real PingOne token through unmodified didn't create a second, unenforced code path.

- [ ] **Step 5: Update the stale memory note**

Edit `project-external-door-mcp-client-gap-2026-08-24.md` (memory) to record that the Agent Gateway broker is now live, which PingOne app it uses, and the verified LM Studio round trip — following the same pattern as the `AGENTLESS-CONFIGURATION.md` doc for Privilege.
