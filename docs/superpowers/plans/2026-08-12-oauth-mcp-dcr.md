# oauth-mcp Real DCR (PingOne-Backed) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make oauth-mcp's already-built RFC 7591 DCR surface (`/register`, `/authorize`, `/token`, `/.well-known/oauth-authorization-server`) actually functional — self-issued tokens authenticate real MCP requests, and `/authorize` performs a real PingOne login instead of auto-approving.

**Architecture:** A shared embedded-issuer singleton lets the signing side (`OAuthRouter`/`TokenIssuer`) and verifying side (`TokenIntrospector`, `HttpMCPTransport`) agree on one issuer string and one RSA key (Part A). `OAuthRouter.handleAuthorize` is rebuilt as a two-hop redirect through a real PingOne app, with `TokenStore` tracking the pending relay state (Part B).

**Tech Stack:** TypeScript 5, Jest 29.5 + ts-jest, `jose` v6 (real in prod, CJS-shimmed in tests — `SignJWT.sign()`/`jwtVerify()` throw by default; mock per-test), `axios` (already a dependency).

## Global Constraints

- Node >= 22, TypeScript 5 — `dist/` is build output, never edit it directly.
- Jest 29.5 + ts-jest; test files under `src/**/__tests__/` or `tests/`, matched by `**/__tests__/**/*.ts` or `*.test.ts` / `*.spec.ts`.
- `jose` is module-mapped to a CJS shim in every test (`jest.config.js` → `src/__mocks__/jose-cjs.js`). `SignJWT.sign()` and `jwtVerify()` throw by default — any test that needs real behavior from them must `jest.mock('jose', factory)` locally in that test file. `exportJWK` is genuinely real in the shim (delegates to `KeyObject.export`), so `SigningKeyManager` works in tests without mocking.
- Verify commands: `npm run build` (tsc), `npm run test:unit` (excludes `tests/integration`), `npm run test:integration`.
- Out of scope, do not touch: `demo_mcp_gateway`, `ping-mcpgw`, `MCP_AUTH_DISABLED` (stays `true` in root `.env`), any PingOne-issued-token code path's existing behavior.
- `oauth-mcp/CLAUDE.md`: tool-registry changes need `scope-topology.json` sync — not applicable here, no tools are added.

---

## Task 1: Shared embedded-issuer singleton

**Files:**
- Create: `oauth-mcp/src/oauth/embeddedIssuer.ts`
- Create: `oauth-mcp/src/oauth/__tests__/embeddedIssuer.test.ts`
- Modify: `oauth-mcp/src/oauth/index.ts`
- Modify: `oauth-mcp/src/oauth/TokenIssuer.ts:23-25`
- Modify: `oauth-mcp/src/server/DemoMCPServer.ts:25`, `:122-123`

**Interfaces:**
- Produces: `resolveEmbeddedIssuer(): string`, `getEmbeddedSigningKeyManager(): Promise<SigningKeyManager>`, `resetEmbeddedSigningKeyManagerForTests(): void` — all exported from `src/oauth/embeddedIssuer.ts` and re-exported from `src/oauth/index.ts`. Tasks 3 and 4 consume both `resolveEmbeddedIssuer` and (Task 3 only) `getEmbeddedSigningKeyManager`.

- [ ] **Step 1: Write the failing test**

```typescript
// oauth-mcp/src/oauth/__tests__/embeddedIssuer.test.ts
import {
  resolveEmbeddedIssuer,
  getEmbeddedSigningKeyManager,
  resetEmbeddedSigningKeyManagerForTests,
} from '../embeddedIssuer';

describe('embeddedIssuer', () => {
  const ORIG = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIG };
    resetEmbeddedSigningKeyManagerForTests();
  });

  describe('resolveEmbeddedIssuer', () => {
    it('defaults to https://localhost:8080 with no env set', () => {
      delete process.env.OAUTH_ISSUER;
      delete process.env.OAUTH_HOSTNAME;
      delete process.env.MCP_SERVER_PORT;
      expect(resolveEmbeddedIssuer()).toBe('https://localhost:8080');
    });

    it('respects OAUTH_ISSUER when set', () => {
      process.env.OAUTH_ISSUER = 'https://mcp.ping.demo';
      expect(resolveEmbeddedIssuer()).toBe('https://mcp.ping.demo');
    });

    it('builds from OAUTH_HOSTNAME + MCP_SERVER_PORT when OAUTH_ISSUER is unset', () => {
      delete process.env.OAUTH_ISSUER;
      process.env.OAUTH_HOSTNAME = 'mcp-server';
      process.env.MCP_SERVER_PORT = '9090';
      expect(resolveEmbeddedIssuer()).toBe('https://mcp-server:9090');
    });
  });

  describe('getEmbeddedSigningKeyManager', () => {
    it('returns the same instance on repeated calls (singleton)', async () => {
      const a = await getEmbeddedSigningKeyManager();
      const b = await getEmbeddedSigningKeyManager();
      expect(a).toBe(b);
    });

    it('returns a manager with a usable public key and kid', async () => {
      const mgr = await getEmbeddedSigningKeyManager();
      expect(mgr.getKid()).toMatch(/^[a-f0-9]{16}$/);
      expect(mgr.getPublicKey()).toBeDefined();
    });

    it('resetEmbeddedSigningKeyManagerForTests forces a fresh instance', async () => {
      const a = await getEmbeddedSigningKeyManager();
      resetEmbeddedSigningKeyManagerForTests();
      const b = await getEmbeddedSigningKeyManager();
      expect(a).not.toBe(b);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd oauth-mcp && npx jest src/oauth/__tests__/embeddedIssuer.test.ts`
Expected: FAIL — `Cannot find module '../embeddedIssuer'`

- [ ] **Step 3: Write the implementation**

```typescript
// oauth-mcp/src/oauth/embeddedIssuer.ts
import { SigningKeyManager } from './SigningKeyManager';

/**
 * Single source of truth for the embedded OAuth AS's issuer string, shared by
 * TokenIssuer (signs with it) and the token-verification path (checks against
 * it) so a self-issued token's `iss` claim and the value that authenticates
 * it never drift apart.
 */
export function resolveEmbeddedIssuer(): string {
  return (
    process.env.OAUTH_ISSUER ||
    `https://${process.env.OAUTH_HOSTNAME || 'localhost'}:${process.env.MCP_SERVER_PORT || '8080'}`
  );
}

let signingKeyManagerPromise: Promise<SigningKeyManager> | null = null;

/**
 * Lazily creates and memoises the embedded AS's RSA signing key. OAuthRouter
 * (via TokenIssuer) signs with it; TokenIntrospector verifies with it — both
 * must resolve the exact same key pair, which is why this isn't just
 * `new SigningKeyManager()` at each call site.
 */
export function getEmbeddedSigningKeyManager(): Promise<SigningKeyManager> {
  if (!signingKeyManagerPromise) {
    signingKeyManagerPromise = (async () => {
      const manager = new SigningKeyManager();
      await manager.initialize();
      return manager;
    })();
  }
  return signingKeyManagerPromise;
}

/** Test-only: clears the memoised singleton so each test starts fresh. */
export function resetEmbeddedSigningKeyManagerForTests(): void {
  signingKeyManagerPromise = null;
}
```

Update `oauth-mcp/src/oauth/index.ts` — add one line:

```typescript
export { getEmbeddedSigningKeyManager, resolveEmbeddedIssuer } from './embeddedIssuer';
```

Update `oauth-mcp/src/oauth/TokenIssuer.ts` — replace the constructor's issuer resolution (currently lines 23-25):

```typescript
// Before:
    this.issuer = process.env.OAUTH_ISSUER
      || `https://${process.env.OAUTH_HOSTNAME || 'localhost'}:${process.env.MCP_SERVER_PORT || '8080'}`;

// After:
    this.issuer = resolveEmbeddedIssuer();
```

Add the import at the top of `TokenIssuer.ts`:

```typescript
import { resolveEmbeddedIssuer } from './embeddedIssuer';
```

Update `oauth-mcp/src/server/DemoMCPServer.ts` — change the import on line 25 from:

```typescript
import { SigningKeyManager, ClientRegistry, TokenStore, OAuthRouter } from '../oauth';
```

to:

```typescript
import { ClientRegistry, TokenStore, OAuthRouter, getEmbeddedSigningKeyManager } from '../oauth';
```

and change lines 122-123 from:

```typescript
      const signingKeyManager = new SigningKeyManager();
      await signingKeyManager.initialize();
```

to:

```typescript
      const signingKeyManager = await getEmbeddedSigningKeyManager();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd oauth-mcp && npx jest src/oauth/__tests__/embeddedIssuer.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Run the full unit suite to confirm no regression**

Run: `cd oauth-mcp && npm run test:unit`
Expected: PASS — `DemoMCPServer`/`OAuthRouter` construction paths still work identically; this step only changed which object instantiates the key, not its behavior.

- [ ] **Step 6: Commit**

```bash
git add oauth-mcp/src/oauth/embeddedIssuer.ts oauth-mcp/src/oauth/__tests__/embeddedIssuer.test.ts oauth-mcp/src/oauth/index.ts oauth-mcp/src/oauth/TokenIssuer.ts oauth-mcp/src/server/DemoMCPServer.ts
git commit -m "feat(oauth-mcp): share one signing key between the embedded AS and token verification"
```

---

## Task 2: Fix self-issued token audience (aud) bug

**Files:**
- Modify: `oauth-mcp/src/oauth/TokenIssuer.ts:31-61` (`issueClientCredentials`), `:63-96` (`issueAuthorizationCode`)
- Create: `oauth-mcp/src/oauth/__tests__/TokenIssuer.test.ts`

**Interfaces:**
- Consumes: nothing new from Task 1.
- Produces: `resolveAudience(): string[]`, exported from `TokenIssuer.ts` — no other task consumes it directly, but Task 6's OAuthRouter tests rely on `issueClientCredentials`/`issueAuthorizationCode` setting a matching `aud`, so this must land first.

**Why this is a bug:** `TokenIntrospector.audienceAccepted()` (`src/auth/TokenIntrospector.ts:32-36`) splits `MCP_SERVER_RESOURCE_URI` (e.g. `"mcpserver.ping.demo,mcpgateway.ping.demo,https://api.pingone.com"`) into a list and checks whether the token's `aud` is *one of* those entries. `TokenIssuer` currently does `.setAudience(process.env.MCP_SERVER_RESOURCE_URI || 'mcpserver.ping.demo')` — passing the whole comma-joined string as a single `aud` value. That single weird string never equals any individual list entry, so every self-issued token fails the mandatory audience check whenever `MCP_SERVER_RESOURCE_URI` is a list (it is, in `docker-compose.yml`).

- [ ] **Step 1: Write the failing test**

```typescript
// oauth-mcp/src/oauth/__tests__/TokenIssuer.test.ts
import { resolveAudience } from '../TokenIssuer';

describe('resolveAudience', () => {
  const ORIG = { ...process.env };
  afterEach(() => { process.env = { ...ORIG }; });

  it('splits a comma-separated MCP_SERVER_RESOURCE_URI into an array', () => {
    process.env.MCP_SERVER_RESOURCE_URI = 'mcpserver.ping.demo,mcpgateway.ping.demo,https://api.pingone.com';
    expect(resolveAudience()).toEqual([
      'mcpserver.ping.demo',
      'mcpgateway.ping.demo',
      'https://api.pingone.com',
    ]);
  });

  it('trims whitespace around entries', () => {
    process.env.MCP_SERVER_RESOURCE_URI = ' mcpserver.ping.demo , mcpgateway.ping.demo ';
    expect(resolveAudience()).toEqual(['mcpserver.ping.demo', 'mcpgateway.ping.demo']);
  });

  it('defaults to ["mcpserver.ping.demo"] when unset', () => {
    delete process.env.MCP_SERVER_RESOURCE_URI;
    expect(resolveAudience()).toEqual(['mcpserver.ping.demo']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd oauth-mcp && npx jest src/oauth/__tests__/TokenIssuer.test.ts -t resolveAudience`
Expected: FAIL — `resolveAudience is not a function` (not exported yet)

- [ ] **Step 3: Write the implementation**

Add to `oauth-mcp/src/oauth/TokenIssuer.ts`, above the `TokenIssuer` class:

```typescript
/** MCP_SERVER_RESOURCE_URI may be a comma-separated list (rollout: own backend
 *  URI + gateway URI while both token shapes are live) — jose needs an array
 *  to emit a multi-value `aud` claim, not the raw comma-joined string. */
export function resolveAudience(): string[] {
  const raw = process.env.MCP_SERVER_RESOURCE_URI || 'mcpserver.ping.demo';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}
```

Replace both occurrences of:

```typescript
      .setAudience(process.env.MCP_SERVER_RESOURCE_URI || 'mcpserver.ping.demo')
```

(one in `issueClientCredentials`, one in `issueAuthorizationCode`) with:

```typescript
      .setAudience(resolveAudience())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd oauth-mcp && npx jest src/oauth/__tests__/TokenIssuer.test.ts -t resolveAudience`
Expected: PASS (3 tests)

- [ ] **Step 5: Write a wiring test proving issueClientCredentials calls setAudience with the array**

Add to the same file, above or below the `resolveAudience` describe block:

```typescript
jest.mock('jose', () => {
  class SignJWT {
    static audienceCalls: unknown[] = [];
    constructor(_payload: unknown) {}
    setProtectedHeader() { return this; }
    setIssuer() { return this; }
    setSubject() { return this; }
    setAudience(aud: unknown) { SignJWT.audienceCalls.push(aud); return this; }
    setIssuedAt() { return this; }
    setExpirationTime() { return this; }
    setJti() { return this; }
    async sign() { return 'fake.jwt.token'; }
  }
  return { SignJWT };
});

import * as jose from 'jose';
import { TokenIssuer } from '../TokenIssuer';
import { SigningKeyManager } from '../SigningKeyManager';
import { ClientRegistry } from '../ClientRegistry';
import { TokenStore } from '../TokenStore';

describe('TokenIssuer audience wiring', () => {
  const ORIG = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIG };
    (jose.SignJWT as any).audienceCalls = [];
  });

  it('issueClientCredentials sets aud to the split array, not the raw env string', async () => {
    process.env.MCP_SERVER_RESOURCE_URI = 'mcpserver.ping.demo,mcpgateway.ping.demo';
    const keyManager = new SigningKeyManager();
    await keyManager.initialize();
    const clientRegistry = new ClientRegistry();
    clientRegistry.initialize();
    const issuer = new TokenIssuer(keyManager, clientRegistry, new TokenStore());

    await issuer.issueClientCredentials(
      { client_id: 'c1', client_name: 'Test', grant_types: ['client_credentials'], redirect_uris: [], token_endpoint_auth_method: 'client_secret_basic', scope: 'mcp:invoke' },
      'mcp:invoke',
    );

    expect((jose.SignJWT as any).audienceCalls).toEqual([['mcpserver.ping.demo', 'mcpgateway.ping.demo']]);
  });
});
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd oauth-mcp && npx jest src/oauth/__tests__/TokenIssuer.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 7: Run the full unit suite**

Run: `cd oauth-mcp && npm run test:unit`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add oauth-mcp/src/oauth/TokenIssuer.ts oauth-mcp/src/oauth/__tests__/TokenIssuer.test.ts
git commit -m "fix(oauth-mcp): self-issued tokens set aud as an array, not the raw comma-joined env string"
```

---

## Task 3: TokenIntrospector accepts self-issued tokens

**Files:**
- Modify: `oauth-mcp/src/auth/TokenIntrospector.ts:104-130` (`validateAgentToken`), `:319-404` (`verifyTokenSignature`)
- Create: `oauth-mcp/tests/auth/TokenIntrospector.embeddedIssuer.test.ts`

**Interfaces:**
- Consumes: `resolveEmbeddedIssuer()`, `getEmbeddedSigningKeyManager()` from Task 1's `../oauth/embeddedIssuer` (or `../oauth` barrel).
- Produces: no new public API — `verifyTokenSignature` stays private and single-argument (existing tests in `tests/auth/TokenIntrospector.jwksFailClosed.test.ts` call it as `(ti as any).verifyTokenSignature(tok)` with one arg; do not change that signature).

- [ ] **Step 1: Write the failing test**

```typescript
// oauth-mcp/tests/auth/TokenIntrospector.embeddedIssuer.test.ts
/**
 * A token whose `iss` matches oauth-mcp's own embedded AS must verify against
 * the embedded AS's local RSA key (no network), not PingOne's remote JWKS —
 * and must NOT be rejected just because PINGONE_JWKS_URI/PINGONE_ISSUER/
 * PINGONE_BASE_URL happen to be unset or unreachable.
 */
import axios from 'axios';
import { TokenIntrospector } from '../../src/auth/TokenIntrospector';
import { AuthenticationError } from '../../src/interfaces/auth';
import * as jwksModule from '../../src/auth/jwks';
import { getEmbeddedSigningKeyManager, resolveEmbeddedIssuer, resetEmbeddedSigningKeyManagerForTests } from '../../src/oauth/embeddedIssuer';

jest.mock('axios');
jest.mock('../../src/auth/jwks');

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedJwks = jwksModule as jest.Mocked<typeof jwksModule>;

const CONFIG = {
  baseUrl: 'https://as.example.com',
  clientId: 'cid',
  clientSecret: 'secret',
  tokenIntrospectionEndpoint: 'https://as.example.com/introspect',
  authorizationEndpoint: 'https://as.example.com/authorize',
  tokenEndpoint: 'https://as.example.com/token',
} as any;

function makeJwt(claims: Record<string, unknown>): string {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${h}.${p}.sig`;
}

describe('TokenIntrospector — embedded-issuer tokens verify locally', () => {
  const ORIG = { ...process.env };
  let ti: TokenIntrospector;
  let jwtVerify: jest.Mock;

  beforeEach(() => {
    mockedAxios.create.mockReturnValue({ post: jest.fn(), get: jest.fn() } as any);
    jwtVerify = jest.fn();
    mockedJwks.getJose.mockResolvedValue({ jwtVerify } as any);
    // No PingOne JWKS configured — proves the embedded path doesn't need it.
    mockedJwks.createJwksKeySet.mockResolvedValue(null);
    delete process.env.STRICT_AUTH;
    delete process.env.MCP_SERVER_RESOURCE_URI;
    resetEmbeddedSigningKeyManagerForTests();
    ti = new TokenIntrospector(CONFIG);
  });
  afterEach(() => {
    process.env = { ...ORIG };
    jest.clearAllMocks();
    resetEmbeddedSigningKeyManagerForTests();
  });

  it('verifies a self-issued token against the embedded key, not PingOne JWKS', async () => {
    const issuer = resolveEmbeddedIssuer();
    jwtVerify.mockResolvedValue(undefined);
    const token = makeJwt({ sub: 'c1', client_id: 'c1', iss: issuer, exp: Math.floor(Date.now() / 1000) + 3600 });

    const result = await ti.validateAgentToken(token);

    expect(result.isValid).toBe(true);
    // Verified against the embedded manager's real public key, not a remote JWKS resolver.
    const embedded = await getEmbeddedSigningKeyManager();
    expect(jwtVerify).toHaveBeenCalledWith(token, embedded.getPublicKey());
  });

  it('rejects a self-issued-shaped token with a bad signature', async () => {
    const issuer = resolveEmbeddedIssuer();
    jwtVerify.mockRejectedValue(new Error('signature verification failed'));
    const token = makeJwt({ sub: 'c1', client_id: 'c1', iss: issuer, exp: Math.floor(Date.now() / 1000) + 3600 });

    await expect(ti.validateAgentToken(token)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('a token whose iss does NOT match the embedded issuer still goes through the PingOne path unchanged', async () => {
    const token = makeJwt({ sub: 'u1', client_id: 'other', iss: 'https://auth.pingone.com/env/as', exp: Math.floor(Date.now() / 1000) + 3600 });

    // No JWKS configured (createJwksKeySet → null) → existing decode-only warn+accept fallback.
    const result = await ti.validateAgentToken(token);
    expect(result.isValid).toBe(true);
    expect(jwtVerify).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd oauth-mcp && npx jest tests/auth/TokenIntrospector.embeddedIssuer.test.ts`
Expected: FAIL — first test times out/rejects because `verifyTokenSignature` has no embedded-issuer branch yet, so it falls into the PingOne `createJwksKeySet()` → `null` → warn+accept path, meaning `jwtVerify` is never called and the `toHaveBeenCalledWith` assertion fails.

- [ ] **Step 3: Write the implementation**

In `oauth-mcp/src/auth/TokenIntrospector.ts`, add the import at the top:

```typescript
import { getEmbeddedSigningKeyManager, resolveEmbeddedIssuer } from '../oauth/embeddedIssuer';
```

Change the call site in `validateAgentToken` (currently line 130) from:

```typescript
    const signatureVerified = await this.verifyTokenSignature(token);
```

to (unchanged — `decoded` is already in scope, `verifyTokenSignature` will re-peek `iss` from the raw token itself, see below):

```typescript
    const signatureVerified = await this.verifyTokenSignature(token);
```

(No change needed here — kept for clarity that this call site is untouched.)

Replace the start of `verifyTokenSignature` (currently lines 319-333) — insert an embedded-issuer branch before the existing PingOne logic:

```typescript
  private async verifyTokenSignature(token: string): Promise<boolean> {
    const skip = process.env.SKIP_TOKEN_SIGNATURE_VALIDATION === 'true';

    // Peek `iss` (unverified — just routing which key to check against, not
    // trusting the claim yet). A self-issued token from oauth-mcp's own
    // embedded AS verifies against its local RSA key, no network involved.
    let peekedIss: unknown;
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        peekedIss = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8')).iss;
      }
    } catch { /* malformed — fall through to the existing PingOne path, which will reject it */ }

    if (peekedIss && peekedIss === resolveEmbeddedIssuer()) {
      const { jwtVerify } = await getJose();
      try {
        const embedded = await getEmbeddedSigningKeyManager();
        await jwtVerify(token, embedded.getPublicKey());
        teachLog.info('agent token signature verified (embedded issuer, local key)');
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (skip) {
          teachLog.warn(`embedded-issuer token signature verification FAILED but SKIP_TOKEN_SIGNATURE_VALIDATION=true — accepting: ${msg}`);
          return false;
        }
        teachLog.error('embedded-issuer token signature verification failed', undefined, { operation: 'jwks_verify', detail: msg });
        throw new AuthenticationError('Agent token signature verification failed', AuthErrorCodes.INVALID_AGENT_TOKEN);
      }
    }

    const jwks = await this.getJwksKeySet();
```

(The `const jwks = await this.getJwksKeySet();` line is the original first line of the PingOne path — everything after it in the existing method body is unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd oauth-mcp && npx jest tests/auth/TokenIntrospector.embeddedIssuer.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the existing TokenIntrospector suites to confirm no regression**

Run: `cd oauth-mcp && npx jest tests/auth/TokenIntrospector.test.ts tests/auth/TokenIntrospector.jwksFailClosed.test.ts`
Expected: PASS — every existing `makeJwt()` call in those files omits `iss`, so `peekedIss` is `undefined`, which never equals `resolveEmbeddedIssuer()`'s string — the new branch never fires for them, and `verifyTokenSignature(tok)` (1-arg call site in `jwksFailClosed.test.ts`) still compiles and behaves identically.

- [ ] **Step 6: Run the full unit suite**

Run: `cd oauth-mcp && npm run test:unit`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add oauth-mcp/src/auth/TokenIntrospector.ts oauth-mcp/tests/auth/TokenIntrospector.embeddedIssuer.test.ts
git commit -m "feat(oauth-mcp): TokenIntrospector verifies self-issued tokens against the embedded AS's local key"
```

---

## Task 4: Widen the RFC 9207 issuer check

**Files:**
- Modify: `oauth-mcp/src/server/HttpMCPTransport.ts:21-38` (imports), `:900-913` (issuer check)
- Create: `oauth-mcp/src/server/__tests__/rfc9207DualIssuer.test.ts`

**Interfaces:**
- Consumes: `resolveEmbeddedIssuer()` from Task 1.

- [ ] **Step 1: Write the failing test**

```typescript
// oauth-mcp/src/server/__tests__/rfc9207DualIssuer.test.ts
/**
 * RFC 9207 mix-up protection must accept BOTH known-good issuers now —
 * PingOne (unchanged) and oauth-mcp's own embedded AS (new, Part A) — while
 * still rejecting a genuine third-party issuer as a mix-up attack.
 *
 * Bare-instance pattern matches authDisabledBearerPassthrough.test.ts:
 * authenticateBearer only touches the fields set here.
 */
import { HttpMCPTransport } from '../HttpMCPTransport';
import { resolveEmbeddedIssuer } from '../../oauth/embeddedIssuer';
import type { IncomingMessage, ServerResponse } from 'http';

describe('HttpMCPTransport.authenticateBearer — RFC 9207 dual-issuer', () => {
  function transport(verifiedClaims: Record<string, unknown>) {
    const t = Object.create(HttpMCPTransport.prototype) as Record<string, unknown>;
    t.authDisabled = false;
    t.config = { authServerUrl: 'https://auth.pingone.com/env/as' };
    t.authManager = {
      validateAgentToken: async () => ({
        isValid: true,
        scopes: ['mcp:invoke'],
        signatureVerified: true,
        verifiedClaims,
      }),
    };
    return t as unknown as {
      authenticateBearer(req: IncomingMessage, res: ServerResponse): Promise<{ token: string } | null>;
    };
  }

  const req = () => ({ headers: { authorization: 'Bearer tok' } }) as unknown as IncomingMessage;
  let unauthorizedBody: unknown;
  const res = () =>
    ({
      writeHead: () => {},
      end: (body?: string) => { unauthorizedBody = body; },
    }) as unknown as ServerResponse;

  const ORIG = { ...process.env };
  afterEach(() => { process.env = { ...ORIG }; unauthorizedBody = undefined; });

  it('accepts a token whose iss is PingOne (unchanged behavior)', async () => {
    process.env.PINGONE_ISSUER = 'https://auth.pingone.com/env/as';
    const t = transport({ iss: 'https://auth.pingone.com/env/as' });
    const out = await t.authenticateBearer(req(), res());
    expect(out).not.toBeNull();
  });

  it('accepts a token whose iss is the embedded AS', async () => {
    process.env.PINGONE_ISSUER = 'https://auth.pingone.com/env/as';
    const t = transport({ iss: resolveEmbeddedIssuer() });
    const out = await t.authenticateBearer(req(), res());
    expect(out).not.toBeNull();
  });

  it('still rejects a genuine third-party issuer as a mix-up attack', async () => {
    process.env.PINGONE_ISSUER = 'https://auth.pingone.com/env/as';
    const t = transport({ iss: 'https://evil.example.com/as' });
    const out = await t.authenticateBearer(req(), res());
    expect(out).toBeNull();
    expect(unauthorizedBody).toContain('RFC 9207');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd oauth-mcp && npx jest src/server/__tests__/rfc9207DualIssuer.test.ts`
Expected: FAIL — second test ("accepts a token whose iss is the embedded AS") gets rejected, since only `PINGONE_ISSUER` is currently accepted.

- [ ] **Step 3: Write the implementation**

Add the import to `oauth-mcp/src/server/HttpMCPTransport.ts` (near the other `../auth/*` and `../oauth/*`-style imports, after line 38):

```typescript
import { resolveEmbeddedIssuer } from '../oauth/embeddedIssuer';
```

Replace the RFC 9207 block (currently lines 900-913):

```typescript
    // Before:
    if (tokenInfo.signatureVerified && tokenInfo.verifiedClaims) {
      const issFromToken = (tokenInfo.verifiedClaims as any)?.iss;
      const expectedIssuer = process.env.PINGONE_ISSUER || this.config.authServerUrl;
      if (issFromToken && expectedIssuer && issFromToken !== expectedIssuer) {
        console.warn(
          `[HttpMCPTransport][RFC9207] Issuer mismatch: token iss="${issFromToken}" ` +
          `does not match PINGONE_ISSUER="${expectedIssuer}" — rejecting token as potential mix-up attack`
        );
        this.sendUnauthorized(res, 'Invalid token issuer (RFC 9207 check failed)');
        return null;
      }
    }
```

with:

```typescript
    // RFC 9207 / SEP-2468: Validate 'iss' claim to prevent authorization server
    // mix-up attacks. Only check if signature was verified (claims are untrustworthy otherwise).
    // Two issuers are legitimate here: PingOne (delegated/exchanged tokens) and
    // oauth-mcp's own embedded AS (self-issued via /register + /token, Part A/B
    // of the DCR work). Anything else is still rejected as a mix-up attack.
    if (tokenInfo.signatureVerified && tokenInfo.verifiedClaims) {
      const issFromToken = (tokenInfo.verifiedClaims as any)?.iss;
      const pingOneIssuer = process.env.PINGONE_ISSUER || this.config.authServerUrl;
      const acceptedIssuers = [pingOneIssuer, resolveEmbeddedIssuer()].filter(Boolean);
      if (issFromToken && acceptedIssuers.length > 0 && !acceptedIssuers.includes(issFromToken)) {
        console.warn(
          `[HttpMCPTransport][RFC9207] Issuer mismatch: token iss="${issFromToken}" ` +
          `is not one of the accepted issuers (${acceptedIssuers.join(', ')}) — rejecting token as potential mix-up attack`
        );
        this.sendUnauthorized(res, 'Invalid token issuer (RFC 9207 check failed)');
        return null;
      }
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd oauth-mcp && npx jest src/server/__tests__/rfc9207DualIssuer.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the full unit suite**

Run: `cd oauth-mcp && npm run test:unit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add oauth-mcp/src/server/HttpMCPTransport.ts oauth-mcp/src/server/__tests__/rfc9207DualIssuer.test.ts
git commit -m "feat(oauth-mcp): RFC 9207 issuer check accepts the embedded AS alongside PingOne"
```

---

## Task 5: TokenStore tracks pending PingOne-relay authorizations

**Files:**
- Modify: `oauth-mcp/src/oauth/TokenStore.ts`
- Create: `oauth-mcp/src/oauth/__tests__/TokenStore.test.ts`

**Interfaces:**
- Produces: `TokenStore.createPendingAuthorization(params): string`, `TokenStore.consumePendingAuthorization(state): PendingAuthorization | null`, exported `PendingAuthorization` interface. Task 6 consumes both methods.

- [ ] **Step 1: Write the failing test**

```typescript
// oauth-mcp/src/oauth/__tests__/TokenStore.test.ts
import { TokenStore } from '../TokenStore';

describe('TokenStore — pending PingOne-relay authorizations', () => {
  const baseParams = {
    clientId: 'client-1',
    redirectUri: 'http://localhost:6274/oauth/callback',
    scope: 'mcp:invoke',
    codeChallenge: 'challenge',
    codeChallengeMethod: 'S256',
    clientState: 'client-supplied-state',
  };

  it('creates a pending authorization and consumes it exactly once', () => {
    const store = new TokenStore();
    const relayState = store.createPendingAuthorization(baseParams);
    expect(typeof relayState).toBe('string');
    expect(relayState.length).toBeGreaterThan(20);

    const consumed = store.consumePendingAuthorization(relayState);
    expect(consumed).toMatchObject(baseParams);

    // Second consume must fail — one-time use, like authorization codes.
    expect(store.consumePendingAuthorization(relayState)).toBeNull();
  });

  it('returns null for an unknown state', () => {
    const store = new TokenStore();
    expect(store.consumePendingAuthorization('never-issued')).toBeNull();
  });

  it('expires after 10 minutes', () => {
    jest.useFakeTimers();
    try {
      const store = new TokenStore();
      const relayState = store.createPendingAuthorization(baseParams);
      jest.advanceTimersByTime(10 * 60_000 + 1);
      expect(store.consumePendingAuthorization(relayState)).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('cleanup() purges expired pending authorizations', () => {
    jest.useFakeTimers();
    try {
      const store = new TokenStore();
      const relayState = store.createPendingAuthorization(baseParams);
      jest.advanceTimersByTime(10 * 60_000 + 1);
      store.cleanup();
      // Consuming after cleanup still returns null either way, but this proves
      // cleanup() doesn't throw on the new map and does visit it.
      expect(store.consumePendingAuthorization(relayState)).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd oauth-mcp && npx jest src/oauth/__tests__/TokenStore.test.ts`
Expected: FAIL — `store.createPendingAuthorization is not a function`

- [ ] **Step 3: Write the implementation**

In `oauth-mcp/src/oauth/TokenStore.ts`, add after the `IssuedToken` interface:

```typescript
export interface PendingAuthorization {
  state: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  /** The ORIGINAL client's own `state` param — relayed back to it once the
   *  PingOne hop completes. Never sent to PingOne itself (see OAuthRouter). */
  clientState: string;
  expiresAt: number;
}
```

Add a `pending` map field alongside `codes`/`tokens`:

```typescript
  private pending: Map<string, PendingAuthorization> = new Map();
```

Add the two methods (anywhere inside the class, e.g. after `consumeCode`):

```typescript
  createPendingAuthorization(params: Omit<PendingAuthorization, 'state' | 'expiresAt'>): string {
    const state = crypto.randomBytes(32).toString('base64url');
    this.pending.set(state, {
      ...params,
      state,
      expiresAt: Date.now() + 600_000, // 10 minutes — a real PingOne login takes longer than a code exchange
    });
    return state;
  }

  consumePendingAuthorization(state: string): PendingAuthorization | null {
    const entry = this.pending.get(state);
    if (!entry) return null;
    this.pending.delete(state);
    if (Date.now() > entry.expiresAt) return null;
    return entry;
  }
```

Update `cleanup()` to also purge expired pending entries:

```typescript
  /** Purge expired codes and pending authorizations periodically */
  cleanup(): void {
    const now = Date.now();
    for (const [k, v] of this.codes) {
      if (now > v.expiresAt) this.codes.delete(k);
    }
    for (const [k, v] of this.pending) {
      if (now > v.expiresAt) this.pending.delete(k);
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd oauth-mcp && npx jest src/oauth/__tests__/TokenStore.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the full unit suite**

Run: `cd oauth-mcp && npm run test:unit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add oauth-mcp/src/oauth/TokenStore.ts oauth-mcp/src/oauth/__tests__/TokenStore.test.ts
git commit -m "feat(oauth-mcp): TokenStore tracks pending PingOne-relay authorization state"
```

---

## Task 6: Real PingOne-backed /authorize + /authorize/callback

**Files:**
- Modify: `oauth-mcp/src/oauth/OAuthRouter.ts`
- Create: `oauth-mcp/src/oauth/__tests__/OAuthRouter.authorize.test.ts`
- Modify: `oauth-mcp/.env.example`

**Interfaces:**
- Consumes: `TokenStore.createPendingAuthorization`/`consumePendingAuthorization` (Task 5), `createJwksKeySet`/`getJose` from `../auth/jwks` (existing, PingOne verification reused as-is).
- Requires new env vars at runtime (not yet creatable in this session — see plan header and spec): `OAUTH_MCP_PINGONE_CLIENT_ID`, `OAUTH_MCP_PINGONE_CLIENT_SECRET`. Reuses existing `PINGONE_AUTHORIZATION_ENDPOINT`, `PINGONE_TOKEN_ENDPOINT`. Until those two new vars are set, `/authorize` responds `503 temporarily_unavailable` instead of silently misbehaving — this is intentional and covered by a test below.

- [ ] **Step 1: Write the failing tests**

```typescript
// oauth-mcp/src/oauth/__tests__/OAuthRouter.authorize.test.ts
import axios from 'axios';
import { IncomingMessage, ServerResponse } from 'http';
import { OAuthRouter } from '../OAuthRouter';
import { SigningKeyManager } from '../SigningKeyManager';
import { ClientRegistry } from '../ClientRegistry';
import { TokenStore } from '../TokenStore';
import * as jwksModule from '../../auth/jwks';

jest.mock('axios');
jest.mock('../../auth/jwks');

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedJwks = jwksModule as jest.Mocked<typeof jwksModule>;

function fakeReqRes(method: string, urlPath: string) {
  const req = { method, url: urlPath, headers: { host: 'localhost:8080' } } as unknown as IncomingMessage;
  let statusCode = 0;
  let headers: Record<string, string> = {};
  let body = '';
  const res = {
    writeHead: (code: number, h?: Record<string, string>) => { statusCode = code; headers = h || {}; },
    end: (b?: string) => { body = b || ''; },
  } as unknown as ServerResponse;
  return { req, res, get statusCode() { return statusCode; }, get headers() { return headers; }, get body() { return body; } };
}

describe('OAuthRouter — real PingOne-backed /authorize', () => {
  const ORIG = { ...process.env };
  let router: OAuthRouter;
  let clientRegistry: ClientRegistry;

  beforeEach(async () => {
    process.env.OAUTH_MCP_PINGONE_CLIENT_ID = 'rp-client-id';
    process.env.OAUTH_MCP_PINGONE_CLIENT_SECRET = 'rp-client-secret';
    process.env.PINGONE_AUTHORIZATION_ENDPOINT = 'https://auth.pingone.com/env/as/authorize';
    process.env.PINGONE_TOKEN_ENDPOINT = 'https://auth.pingone.com/env/as/token';

    const keyManager = new SigningKeyManager();
    await keyManager.initialize();
    clientRegistry = new ClientRegistry();
    clientRegistry.initialize(); // seeds 'mcp-inspector' with redirect_uris incl. localhost:6274
    router = new OAuthRouter(keyManager, clientRegistry, new TokenStore());
  });
  afterEach(() => { process.env = { ...ORIG }; jest.clearAllMocks(); });

  it('GET /authorize redirects (302) to PingOne, not to the client redirect_uri', async () => {
    const { req, res } = fakeReqRes('GET',
      '/authorize?client_id=mcp-inspector&redirect_uri=http://localhost:6274/oauth/callback&response_type=code&code_challenge=abc&state=client-state-1');

    const handled = await router.handle(req, res);
    const ctx = res as any;

    expect(handled).toBe(true);
    expect(ctx.statusCode).toBe(302);
    const location = new URL(ctx.headers.Location);
    expect(location.origin + location.pathname).toBe('https://auth.pingone.com/env/as/authorize');
    expect(location.searchParams.get('client_id')).toBe('rp-client-id');
    expect(location.searchParams.get('redirect_uri')).toBe(`${(router as any).issuer}/authorize/callback`);
  });

  it('full round trip: /authorize -> capture relay state -> /authorize/callback mints a code for the ORIGINAL client', async () => {
    const authorizeCall = fakeReqRes('GET',
      '/authorize?client_id=mcp-inspector&redirect_uri=http://localhost:6274/oauth/callback&response_type=code&code_challenge=abc&state=client-state-1');
    await router.handle(authorizeCall.req, authorizeCall.res);
    const location = new URL((authorizeCall as any).headers.Location);
    expect(location.origin + location.pathname).toBe('https://auth.pingone.com/env/as/authorize');
    const relayState = location.searchParams.get('state')!;
    expect(relayState).toBeTruthy();
    expect(relayState).not.toBe('client-state-1'); // never leaks the client's own state to PingOne

    mockedAxios.post.mockResolvedValue({ data: { access_token: 'pingone.access.token' } });
    const jwtVerify = jest.fn().mockResolvedValue({ payload: { sub: 'real-pingone-user' } });
    mockedJwks.getJose.mockResolvedValue({ jwtVerify } as any);
    mockedJwks.createJwksKeySet.mockResolvedValue((() => {}) as any);

    const callbackCall = fakeReqRes('GET', `/authorize/callback?code=pingone-auth-code&state=${relayState}`);
    const handled = await router.handle(callbackCall.req, callbackCall.res);

    expect(handled).toBe(true);
    const callbackLocation = new URL((callbackCall as any).headers.Location);
    expect(callbackLocation.origin + callbackLocation.pathname).toBe('http://localhost:6274/oauth/callback');
    expect(callbackLocation.searchParams.get('code')).toBeTruthy();
    expect(callbackLocation.searchParams.get('state')).toBe('client-state-1'); // original client's state, relayed back
  });

  it('/authorize/callback rejects an unknown/expired relay state', async () => {
    const { req, res } = fakeReqRes('GET', '/authorize/callback?code=abc&state=never-issued');
    await router.handle(req, res);
    const ctx = res as any;
    expect(ctx.statusCode).toBe(400);
    expect(JSON.parse(ctx.body).error).toBe('invalid_grant');
  });

  it('/authorize returns 503 when PingOne federation env vars are not configured', async () => {
    delete process.env.OAUTH_MCP_PINGONE_CLIENT_ID;
    const { req, res } = fakeReqRes('GET',
      '/authorize?client_id=mcp-inspector&redirect_uri=http://localhost:6274/oauth/callback&response_type=code&code_challenge=abc');
    await router.handle(req, res);
    const ctx = res as any;
    expect(ctx.statusCode).toBe(503);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd oauth-mcp && npx jest src/oauth/__tests__/OAuthRouter.authorize.test.ts`
Expected: FAIL — current `handleAuthorize` auto-approves and 302s straight to the client's own `redirect_uri`, never to PingOne; `/authorize/callback` isn't a recognized path (`handle()` returns `false`).

- [ ] **Step 3: Write the implementation**

In `oauth-mcp/src/oauth/OAuthRouter.ts`, add imports at the top:

```typescript
import axios from 'axios';
import { createJwksKeySet, getJose } from '../auth/jwks';
```

Add the new case to the `switch` in `handle()` (after the existing `case '/authorize':`):

```typescript
      case '/authorize/callback':
        return this.handleAuthorizeCallback(req, res, url);
```

Replace the entire body of `handleAuthorize` (the "Auto-approve for demo" section — currently the last ~20 lines of the method, from the `client_id`/`redirect_uri` validation through the 302) — keep all the existing validation (`clientId`/`redirectUri`/`responseType`/client lookup/redirect_uri registration/PKCE presence check) exactly as-is, and replace only the auto-approve tail:

```typescript
    // Before (delete this block):
    // Auto-approve for demo — in production this would render a consent page
    const subject = url.searchParams.get('login_hint') || 'demo-user';
    const code = this.tokenStore.createCode({
      clientId,
      redirectUri,
      scope,
      codeChallenge,
      codeChallengeMethod,
      subject,
    });

    const callback = new URL(redirectUri);
    callback.searchParams.set('code', code);
    if (state) callback.searchParams.set('state', state);

    res.writeHead(302, { Location: callback.toString() });
    res.end();
    return true;
  }
```

```typescript
    // After:
    const pingOneClientId = process.env.OAUTH_MCP_PINGONE_CLIENT_ID;
    const pingOneAuthEndpoint = process.env.PINGONE_AUTHORIZATION_ENDPOINT;
    if (!pingOneClientId || !pingOneAuthEndpoint) {
      this.json(res, 503, {
        error: 'temporarily_unavailable',
        error_description: 'PingOne federation is not configured (OAUTH_MCP_PINGONE_CLIENT_ID / PINGONE_AUTHORIZATION_ENDPOINT)',
      });
      return true;
    }

    // Bind this pending request to a state WE generate. The client's own
    // `state` travels with it in TokenStore but is never sent to PingOne as
    // the outbound state — a malicious redirect_uri must not be able to
    // observe or replay it against PingOne.
    const relayState = this.tokenStore.createPendingAuthorization({
      clientId, redirectUri, scope, codeChallenge, codeChallengeMethod, clientState: state,
    });

    const callbackUri = `${this.issuer}/authorize/callback`;
    const pingOneAuthorize = new URL(pingOneAuthEndpoint);
    pingOneAuthorize.searchParams.set('client_id', pingOneClientId);
    pingOneAuthorize.searchParams.set('redirect_uri', callbackUri);
    pingOneAuthorize.searchParams.set('response_type', 'code');
    pingOneAuthorize.searchParams.set('scope', 'openid profile email');
    pingOneAuthorize.searchParams.set('state', relayState);

    res.writeHead(302, { Location: pingOneAuthorize.toString() });
    res.end();
    return true;
  }
```

Add the new `handleAuthorizeCallback` method (e.g. directly after `handleAuthorize`):

```typescript
  // --- PingOne redirect-federation callback: exchanges PingOne's code, then
  // mints THIS AS's own code for the original DCR-registered client. ---
  private async handleAuthorizeCallback(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
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

    const pingOneClientId = process.env.OAUTH_MCP_PINGONE_CLIENT_ID;
    const pingOneClientSecret = process.env.OAUTH_MCP_PINGONE_CLIENT_SECRET;
    const pingOneTokenEndpoint = process.env.PINGONE_TOKEN_ENDPOINT;
    if (!pingOneClientId || !pingOneClientSecret || !pingOneTokenEndpoint) {
      this.json(res, 503, { error: 'temporarily_unavailable', error_description: 'PingOne federation is not configured' });
      return true;
    }

    let subject: string;
    try {
      const callbackUri = `${this.issuer}/authorize/callback`;
      const tokenResponse = await axios.post(
        pingOneTokenEndpoint,
        new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: callbackUri,
          client_id: pingOneClientId,
          client_secret: pingOneClientSecret,
        }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );

      const pingOneAccessToken = tokenResponse.data.access_token as string;
      const jwks = await createJwksKeySet();
      if (!jwks) {
        throw new Error('PingOne JWKS not configured (PINGONE_JWKS_URI / PINGONE_ISSUER / PINGONE_BASE_URL)');
      }
      const { jwtVerify } = await getJose();
      const { payload } = await jwtVerify(pingOneAccessToken, jwks);
      subject = (payload.sub as string) || 'unknown-pingone-user';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.json(res, 502, { error: 'server_error', error_description: `PingOne login verification failed: ${msg}` });
      return true;
    }

    const ownCode = this.tokenStore.createCode({
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
      scope: pending.scope,
      codeChallenge: pending.codeChallenge,
      codeChallengeMethod: pending.codeChallengeMethod,
      subject,
    });

    const callback = new URL(pending.redirectUri);
    callback.searchParams.set('code', ownCode);
    if (pending.clientState) callback.searchParams.set('state', pending.clientState);

    res.writeHead(302, { Location: callback.toString() });
    res.end();
    return true;
  }
```

Update `oauth-mcp/.env.example` — add near the existing `PINGONE_*` entries:

```bash
# PingOne app used ONLY for oauth-mcp's own /authorize redirect-federation hop
# (RP role — oauth-mcp logs a real user into PingOne, then mints its own
# downstream token). Distinct from every other PINGONE_* app in this file.
# Create via PingOne console/pingcli: authorization_code grant, PKCE, single
# redirect_uri = <OAUTH_ISSUER or derived https://<host>:<MCP_SERVER_PORT>>/authorize/callback
OAUTH_MCP_PINGONE_CLIENT_ID=
OAUTH_MCP_PINGONE_CLIENT_SECRET=
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd oauth-mcp && npx jest src/oauth/__tests__/OAuthRouter.authorize.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Run the full unit and build checks**

Run: `cd oauth-mcp && npm run build && npm run test:unit`
Expected: both PASS

- [ ] **Step 6: Commit**

```bash
git add oauth-mcp/src/oauth/OAuthRouter.ts oauth-mcp/src/oauth/__tests__/OAuthRouter.authorize.test.ts oauth-mcp/.env.example
git commit -m "feat(oauth-mcp): /authorize performs a real PingOne login via redirect federation"
```

---

## Manual Verification (not automated — needs the new PingOne app)

`jose` is CJS-shimmed in every Jest run (see Global Constraints), so no automated test in this repo exercises real RSA signing end-to-end. Tasks 1-5 are provable now, live, without any new PingOne app:

1. `cd oauth-mcp && npm run dev` (or `docker compose up mcp-server` from repo root).
2. `curl -X POST http://localhost:8080/register -d '{"client_name":"manual-test","grant_types":["client_credentials"]}'` — capture `client_id`/`client_secret`.
3. `curl -u '<client_id>:<client_secret>' -X POST http://localhost:8080/token -d 'grant_type=client_credentials&scope=mcp:invoke'` — capture `access_token`.
4. `curl -H "Authorization: Bearer <access_token>" -X POST http://localhost:8080/mcp -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'` — expect a 200 with a tool list, not 401. This is Part A's actual success criterion.

Task 6 (`/authorize` → PingOne → `/authorize/callback`) additionally needs, before it can be verified live:
1. A new PingOne app created (console, `pingcli`, or the PingOne MCP connector once authorized interactively) — authorization_code grant, PKCE, env `01d89b06-66d5-430e-9f28-65636843788b`, redirect_uri `http://localhost:8080/authorize/callback`.
2. `OAUTH_MCP_PINGONE_CLIENT_ID`/`OAUTH_MCP_PINGONE_CLIENT_SECRET` set in `oauth-mcp/.env` from that app.
3. Then: open `http://localhost:8080/authorize?client_id=mcp-inspector&redirect_uri=http://localhost:6274/oauth/callback&response_type=code&code_challenge=<S256 of a verifier>&state=test` in a browser, log into PingOne for real, confirm the final redirect lands back on `localhost:6274` with a `code` — and that the subject on the resulting token (after exchanging it at `/token`) is the real PingOne user's `sub`, not `demo-user`.
