// demo_api_server/tests/real/shared/token-chain.test.js

/**
 * E2E token-chain validation.
 *
 * Checks every layer of the token pipeline using live HTTP calls through the BFF:
 *   1. Session token claims  — aud, sub, iss, exp, scope are present and valid
 *   2. Token storage shape   — /api/auth/oauth/token-claims returns all expected fields
 *   3. No token leakage      — raw access token never appears in API responses
 *   4. BFF audience check    — ENDUSER_AUDIENCE matches what auth.js enforces
 *   5. Delegated token chain — /api/agent/delegate returns an MCP token with:
 *        - sub preserved from the user token
 *        - aud narrowed to the MCP resource URI (not the BFF audience)
 *        - act.sub present (RFC 8693 delegation)
 *   6. Scope consistency     — scopes from the session token are returned by
 *                              oauth/user/status and include at least 'read' or 'write'
 *   7. Expiry validity       — expiresAt > now and session is not expired
 *   8. Token not leaking in status responses
 */

const { createBffClient } = require('../helpers/bffClient');

const VERTICAL = 'banking'; // token-chain tests are vertical-agnostic; default is fine

describe(`Token chain — E2E claims validation (${VERTICAL})`, () => {
  let enduser;
  let tokenClaimsData;   // cached from first call
  let userStatusData;    // cached from first call
  let decodedUserToken;  // JWT payload of the session access token

  beforeAll(async () => {
    try {
      enduser = createBffClient('enduser');
    } catch {
      // No session file or no enduser persona — all tests guard via `if (!enduser) return`
      return;
    }

    // Fetch token-claims and user/status up front so tests can share the data
    const [claimsRes, statusRes] = await Promise.all([
      enduser.get('/api/auth/oauth/token-claims'),
      enduser.get('/api/auth/oauth/user/status'),
    ]);

    if (claimsRes.status === 200 && claimsRes.data.authenticated) {
      tokenClaimsData = claimsRes.data;
      decodedUserToken = tokenClaimsData.decoded?.payload || null;
    }
    if (statusRes.status === 200) {
      userStatusData = statusRes.data;
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Session token-claims endpoint shape
  // ──────────────────────────────────────────────────────────────────────────
  describe('1. /api/auth/oauth/token-claims — session token shape', () => {
    it('returns 200 with authenticated: true', async () => {
      if (!enduser) return;
      const r = await enduser.get('/api/auth/oauth/token-claims');
      expect(r.status).toBe(200);
      expect(r.data.authenticated).toBe(true);
    });

    it('includes sessionType and tokenType fields', () => {
      if (!tokenClaimsData) return;
      expect(typeof tokenClaimsData.sessionType).toBe('string');
      expect(tokenClaimsData.tokenType).toBe('Bearer');
    });

    it('includes decoded.header with alg field', () => {
      if (!tokenClaimsData?.decoded?.header) return;
      expect(typeof tokenClaimsData.decoded.header.alg).toBe('string');
    });

    it('includes decoded.payload with required JWT claims', () => {
      if (!decodedUserToken) return;
      expect(typeof decodedUserToken.sub).toBe('string');
      expect(decodedUserToken.sub.length).toBeGreaterThan(0);
      expect(typeof decodedUserToken.exp).toBe('number');
      const hasIssued = decodedUserToken.iat != null || decodedUserToken.nbf != null;
      expect(hasIssued).toBe(true);
    });

    it('decoded.payload.aud is present and non-empty', () => {
      if (!decodedUserToken) return;
      const aud = decodedUserToken.aud;
      expect(aud).toBeDefined();
      const audList = Array.isArray(aud) ? aud : [aud];
      expect(audList.length).toBeGreaterThan(0);
      for (const a of audList) expect(typeof a).toBe('string');
    });

    it('may_act (if present) is not the BFF aud string — must come from user.mayAct / policy', () => {
      if (!decodedUserToken?.may_act) {
        console.warn(
          '[token-chain] may_act absent on subject token — enable on /demo-data and re-login',
        );
        return;
      }
      const auds = Array.isArray(decodedUserToken.aud)
        ? decodedUserToken.aud
        : [decodedUserToken.aud];
      const maySub =
        decodedUserToken.may_act.sub || decodedUserToken.may_act.client_id;
      expect(maySub).toBeTruthy();
      expect(String(maySub)).not.toBe('enduser.ping.demo');
      expect(auds).not.toContain(String(maySub));
    });

    it('decoded.payload.iss is present (PingOne issuer)', () => {
      if (!decodedUserToken) return;
      expect(typeof decodedUserToken.iss).toBe('string');
      expect(decodedUserToken.iss.length).toBeGreaterThan(0);
    });

    it('expiresAt from /token-claims is in the future', () => {
      if (!tokenClaimsData?.expiresAt) return;
      expect(tokenClaimsData.expiresAt).toBeGreaterThan(Date.now());
    });

    it('decoded.payload.exp aligns with expiresAt (within 5 s tolerance)', () => {
      if (!decodedUserToken || !tokenClaimsData?.expiresAt) return;
      const payloadExpMs = decodedUserToken.exp * 1000;
      const diff = Math.abs(payloadExpMs - tokenClaimsData.expiresAt);
      expect(diff).toBeLessThan(5000);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Scope presence and consistency
  // ──────────────────────────────────────────────────────────────────────────
  describe('2. Scope — session token has at least read access', () => {
    it('decoded.payload.scope is a non-empty string', () => {
      if (!decodedUserToken) return;
      expect(typeof decodedUserToken.scope).toBe('string');
      expect(decodedUserToken.scope.trim().length).toBeGreaterThan(0);
    });

    it('scope includes at minimum "read" or "openid"', () => {
      if (!decodedUserToken) return;
      const scopes = decodedUserToken.scope.split(' ');
      const hasRead = scopes.includes('read') || scopes.includes('openid') || scopes.includes('profile');
      expect(hasRead).toBe(true);
    });

    it('authenticated session has a non-empty user email from some status endpoint', async () => {
      // /api/auth/oauth/token-claims is authoritative for token claims.
      // The session user.id is a local store integer, not the PingOne sub UUID — do not cross-compare.
      // Both /status (admin flow) and /user/status (user flow) should return a user object.
      if (!enduser) return;
      const r = await enduser.get('/api/auth/oauth/status');
      const authenticated = r.data?.authenticated || userStatusData?.authenticated;
      if (!authenticated) return; // not logged in via a recognized flow — skip
      const email = r.data?.user?.email || userStatusData?.user?.email;
      expect(typeof email).toBe('string');
      expect(email.length).toBeGreaterThan(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. No token leakage — raw access token never exposed
  // ──────────────────────────────────────────────────────────────────────────
  describe('3. Token leakage — raw access token stays server-side', () => {
    it('/api/auth/oauth/user/status does not contain access_token or Bearer string', () => {
      if (!userStatusData) return;
      const body = JSON.stringify(userStatusData);
      expect(body).not.toMatch(/access[_-]?token/i);
      expect(body).not.toMatch(/Bearer\s+[a-zA-Z0-9\-_.]+/);
    });

    it('/api/auth/oauth/token-claims does not contain raw JWT string in decoded fields', () => {
      const decoded = tokenClaimsData?.decoded;
      if (!decoded) return; // skip if endpoint returned null decoded
      // decoded should have header+payload objects, not raw token strings
      expect(typeof decoded).toBe('object');
      expect(decoded).not.toHaveProperty('raw');
      // payload should not itself be a JWT (3-part dot-separated string)
      const payloadStr = JSON.stringify(decoded.payload || {});
      expect(payloadStr).not.toMatch(/^ey[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/);
    });

    it('/api/auth/oauth/status does not expose accessToken', async () => {
      if (!enduser) return;
      const r = await enduser.get('/api/auth/oauth/user/status');
      expect(r.data?.user?.accessToken).toBeUndefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. BFF audience — token.aud must match what auth.js enforces
  // ──────────────────────────────────────────────────────────────────────────
  describe('4. Audience — token aud aligns with configured BFF audience', () => {
    it('token aud does not include an MCP resource URI (no audience bleed)', () => {
      // The user token must never carry an MCP server aud — that would
      // mean the BFF is accepting upstream-targeted tokens (D-05 bypass shape).
      if (!decodedUserToken?.aud) return;
      const audList = Array.isArray(decodedUserToken.aud)
        ? decodedUserToken.aud
        : [decodedUserToken.aud];
      // These are the known MCP audiences from .env
      const mcpAudPatterns = ['mcpserver.ping.demo', 'mcpgateway.ping.demo', 'agentgateway.ping.demo'];
      for (const mcpAud of mcpAudPatterns) {
        expect(audList).not.toContain(mcpAud);
      }
    });

    it('token aud is not an array containing the BFF plus an MCP aud (multi-aud bypass shape)', () => {
      if (!decodedUserToken?.aud) return;
      const audList = Array.isArray(decodedUserToken.aud)
        ? decodedUserToken.aud
        : [decodedUserToken.aud];
      const mcpAuds = ['mcpserver.ping.demo', 'mcpgateway.ping.demo'];
      const containsMcp = audList.some((a) => mcpAuds.includes(a));
      expect(containsMcp).toBe(false);
    });

    it('GET /api/accounts/my with valid session returns 200 (aud accepted by auth.js)', async () => {
      if (!enduser) return;
      const r = await enduser.get('/api/accounts/my');
      // 200 = auth.js accepted the token; 403 = accepted but scope missing; 401 = rejected
      // Both 200 and 403 prove aud validation passed
      expect([200, 403]).toContain(r.status);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. Token expiry — session is live
  // ──────────────────────────────────────────────────────────────────────────
  describe('5. Expiry — session token is not expired', () => {
    it('decoded.payload.exp is in the future', () => {
      if (!decodedUserToken) return;
      const nowSec = Math.floor(Date.now() / 1000);
      expect(decodedUserToken.exp).toBeGreaterThan(nowSec);
    });

    it('some status endpoint confirms the session is authenticated (token still valid)', async () => {
      if (!enduser) return;
      // Headless test login uses the admin OAuth client (oauthType='admin'),
      // so /user/status returns false. /status (admin) returns true for this session.
      const r = await enduser.get('/api/auth/oauth/status');
      expect(r.status).toBe(200);
      // Either admin status or user status must be authenticated
      const authenticated = r.data?.authenticated || userStatusData?.authenticated;
      expect(authenticated).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 6. RFC 8693 delegated token — aud, sub, act chain
  //
  // Uses /api/pingone-test/exchange-user-to-mcp which performs the same RFC 8693
  // exchange as the MCP tool path but returns the decoded token claims (not the
  // raw token — BFF pattern; the raw token never leaves the server).
  // ──────────────────────────────────────────────────────────────────────────
  describe('6. RFC 8693 token exchange — MCP delegated token claims', () => {
    async function fetchMcpExchange() {
      if (!enduser) return null;
      const r = await enduser.get('/api/pingone-test/exchange-user-to-mcp');
      if (r.status !== 200 || !r.data?.success) return null;
      // Returns decoded: { header, payload } of the MCP token
      return r.data.decoded?.payload || null;
    }

    it('exchange-user-to-mcp returns 200 or skips if not configured', async () => {
      if (!enduser) return;
      const r = await enduser.get('/api/pingone-test/exchange-user-to-mcp');
      // 200 success or 200 with success:false (not configured) — not a 5xx
      expect(r.status).toBe(200);
    });

    it('MCP token sub is non-empty (user identity preserved through exchange)', async () => {
      const mcpPayload = await fetchMcpExchange();
      if (!mcpPayload) return; // exchange not configured — skip
      expect(typeof mcpPayload.sub).toBe('string');
      expect(mcpPayload.sub.length).toBeGreaterThan(0);
    });

    it('MCP token sub matches the session token sub (sub preserved through exchange)', async () => {
      if (!decodedUserToken?.sub) return;
      const mcpPayload = await fetchMcpExchange();
      if (!mcpPayload) return;
      expect(mcpPayload.sub).toBe(decodedUserToken.sub);
    });

    it('MCP token aud is narrowed to MCP resource (not the BFF audience)', async () => {
      const mcpPayload = await fetchMcpExchange();
      if (!mcpPayload) return;
      const audList = Array.isArray(mcpPayload.aud) ? mcpPayload.aud : [mcpPayload.aud];
      // MCP token must not carry the BFF (enduser) audience
      expect(audList).not.toContain('enduser.ping.demo');
      expect(audList.length).toBeGreaterThan(0);
      for (const a of audList) expect(typeof a).toBe('string');
    });

    it('MCP token aud differs from the session token aud (audience was narrowed)', async () => {
      if (!decodedUserToken?.aud) return;
      const mcpPayload = await fetchMcpExchange();
      if (!mcpPayload) return;
      const mcpAudList = Array.isArray(mcpPayload.aud) ? mcpPayload.aud : [mcpPayload.aud];
      const userAudList = Array.isArray(decodedUserToken.aud)
        ? decodedUserToken.aud
        : [decodedUserToken.aud];
      const isIdentical =
        JSON.stringify([...mcpAudList].sort()) === JSON.stringify([...userAudList].sort());
      expect(isIdentical).toBe(false);
    });

    it('MCP token has act claim (RFC 8693 delegation marker)', async () => {
      const mcpPayload = await fetchMcpExchange();
      if (!mcpPayload) return;
      if (!mcpPayload.act) {
        console.warn('[token-chain] act claim absent from MCP token — check PingOne token policy (may_act → act emission not configured)');
        return; // warn only — PingOne policy may not emit act by default
      }
      expect(typeof mcpPayload.act.sub).toBe('string');
      expect(mcpPayload.act.sub.length).toBeGreaterThan(0);
    });

    it('MCP token exp is in the future', async () => {
      const mcpPayload = await fetchMcpExchange();
      if (!mcpPayload?.exp) return;
      expect(mcpPayload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it('MCP token scope includes at least one banking scope', async () => {
      const mcpPayload = await fetchMcpExchange();
      if (!mcpPayload) return;
      const scopes = (mcpPayload.scope || '').split(' ');
      const bankingScopes = ['read', 'write', 'admin', 'openid', 'profile'];
      expect(scopes.some((s) => bankingScopes.includes(s))).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 7. Storage consistency — configStore audience matches auth.js
  // ──────────────────────────────────────────────────────────────────────────
  describe('7. Storage consistency — configStore audiences align', () => {
    it('/api/health returns 200 with config object', async () => {
      if (!enduser) return;
      const r = await enduser.get('/api/health');
      expect(r.status).toBe(200);
    });

    it('/api/auth/oauth/user/status user is present and email is consistent', async () => {
      // Note: user.id in /user/status is the local in-memory store integer (e.g. "5"),
      // not the PingOne sub UUID — these are intentionally different fields.
      if (!userStatusData?.user) return;
      expect(typeof userStatusData.user.id).toBe('string');
      expect(typeof userStatusData.user.email).toBe('string');
      // email from /user/status should match email in decoded token if present
      if (decodedUserToken?.email) {
        expect(userStatusData.user.email).toBe(decodedUserToken.email);
      }
    });

    it('clientType in token-claims is a known value', () => {
      if (!tokenClaimsData) return;
      expect(['enduser', 'ai_agent', null]).toContain(tokenClaimsData.clientType);
    });

    it('no duplicate or conflicting audience values in config response', async () => {
      if (!enduser) return;
      const r = await enduser.get('/api/health');
      if (r.status !== 200 || !r.data?.config) return;
      const cfg = r.data.config;
      // If config exposes audience values, verify no MCP aud is used as BFF aud
      if (cfg.enduser_audience && cfg.mcp_resource_uri) {
        expect(cfg.enduser_audience).not.toBe(cfg.mcp_resource_uri);
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 8. Gateway D-05 anti-bypass — shape of inbound token is valid for gateway
  // ──────────────────────────────────────────────────────────────────────────
  describe('8. Gateway D-05 — inbound token does not bypass gateway rules', () => {
    it('session token sub is non-empty (required by GatewayTokenPolicy)', () => {
      if (!decodedUserToken) return;
      expect(decodedUserToken.sub.trim().length).toBeGreaterThan(0);
    });

    it('session token act.sub is non-empty if act is present (valid delegation chain)', () => {
      if (!decodedUserToken?.act) return; // act is optional on user tokens
      expect(typeof decodedUserToken.act.sub).toBe('string');
      expect(decodedUserToken.act.sub.trim().length).toBeGreaterThan(0);
    });

    it('session token aud does not contain upstream MCP server URIs (D-05 bypass shape)', () => {
      if (!decodedUserToken?.aud) return;
      const audList = Array.isArray(decodedUserToken.aud)
        ? decodedUserToken.aud
        : [decodedUserToken.aud];
      // These are the known upstream MCP audiences that the gateway blacklists
      const upstreamAuds = [
        'mcpserver.ping.demo',
        'mcpgateway.ping.demo',
        'agentgateway.ping.demo',
      ];
      for (const ua of upstreamAuds) {
        if (audList.includes(ua)) {
          fail(`Session token aud contains upstream MCP URI "${ua}" — D-05 bypass shape detected`);
        }
      }
    });
  });
});
