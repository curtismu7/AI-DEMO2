# Token Validation: Introspection vs JWT

**How the Banking Demo validates OAuth tokens — choose the right strategy for your use case.**

---

## Strategy Comparison

| Strategy | How It Works | Revoked Token Detection | Latency | Offline | Best For |
|----------|-------------|------------------------|---------|---------|----------|
| **Introspection (RFC 7662)** | Calls PingOne endpoint per request | Yes ✓ | ~50ms (cached 30s) | No | User-facing APIs, high security |
| **JWT Local Validation** | Validates RSA signature locally | No ✗ | ~1ms | Yes ✓ | Internal APIs, fallback mode |

**Default:** Introspection (most secure)  
**Toggle:** Config page → Token Validation tab  

---

## 1. Introspection (Recommended for Production)

### How It Works

1. User makes API request with OAuth Bearer token
2. BFF calls PingOne introspection endpoint (RFC 7662): `POST /oauth2/introspect`
3. PingOne returns token status: `{ active: true/false, sub, scope, aud, exp, ... }`
4. BFF caches result for 30 seconds (configurable via `INTROSPECTION_CACHE_TTL`)
5. Request allowed or denied based on `active` field and required scopes

### When to Use

✓ User-facing APIs (transactions, transfers, sensitive data access)  
✓ Compliance requirements (PCI, SOX, HIPAA) requiring real-time validation  
✓ High-security operations (money transfer, account deletion, PII access)  
✓ Any operation where token revocation must be detected within 30 seconds  

### ⚠️ Introspection identity — the one rule that prevents the recurring reauth loop

PingOne binds RFC 7662 introspection to the token's **issuing client**. A client may
introspect a token ONLY if it is the token's own client (`client_id` match), its
`client_id` is in the token's `aud`, or it holds the special `am-introspect-all-tokens`
scope (not granted by default). **An unauthorized-but-authenticated client gets
`{"active":false}` — not an error.** A generic **Worker** introspecting another client's
user token therefore returns `active:false`, which the gate mis-reads as "token inactive"
→ **"Session expired" → endless reauth loop.** (A *separate* failure, `401 invalid_client`,
comes from an auth-**method** mismatch — sending `client_secret_post` creds to a `basic`
app or vice-versa.)

**So always introspect AS the token's issuing client:**

| Token | Introspect as | Auth method |
|-------|---------------|-------------|
| User access token (`aud: enduser.ping.demo`) | `PINGONE_USER_CLIENT_ID` (Demo User App) | `client_secret_post` |
| Gateway-exchanged token (`aud: mcpgateway.ping.demo`) | `GW_INTROSPECTION_CLIENT_ID` (MCP Exchanger) | `client_secret_post` |
| A Worker's own CC token | the Worker itself | `client_secret_basic` |

The Worker is **never** the introspector for user or exchanged tokens.

### Configuration

```bash
# PingOne Introspection Endpoint (required)
PINGONE_INTROSPECTION_ENDPOINT=https://auth.pingone.com/{env-id}/as/introspect

# BFF default: introspect user tokens AS the issuing Demo User App (client_secret_post).
PINGONE_USER_CLIENT_ID=your_demo_user_app_client_id
PINGONE_USER_CLIENT_SECRET=your_demo_user_app_client_secret

# Optional dedicated introspection client (overrides the User App default).
# Must itself be the issuing client / in the token aud. Auth method per app:
# PINGONE_INTROSPECTION_CLIENT_ID=...
# PINGONE_INTROSPECTION_CLIENT_SECRET=...
PINGONE_INTROSPECTION_AUTH_METHOD=post

# Gateway introspects exchanged tokens AS the MCP Exchanger (client_secret_post).
GW_INTROSPECTION_CLIENT_ID=your_mcp_exchanger_client_id
GW_INTROSPECTION_CLIENT_SECRET=your_mcp_exchanger_client_secret

# Optional: Cache TTL in seconds (default: 30). Cache key is per-(token, introspecting client).
INTROSPECTION_CACHE_TTL=30

# Optional: Token validation mode (default: introspection)
VALIDATION_MODE=introspection
```

### Testing Connectivity

Use the demo Config UI (recommended):

1. Navigate to **Config** → **🔍 Token Validation** tab
2. Click **"Test PingOne Connection"**
3. Result: `✓ Connected` + response time, or error with hint

Using curl directly:

```bash
curl http://localhost:3001/api/health/introspection

# 200 response (connected):
{
  "status": "connected",
  "endpoint": "https://auth.pingone.com/...",
  "timestamp": "2026-04-08T...",
  "details": {
    "responseTime": 42,
    "mode": "introspection",
    "message": "PingOne introspection endpoint is reachable and responding"
  }
}

# 503 response (failed):
{
  "status": "failed",
  "endpoint": "https://auth.pingone.com/...",
  "details": {
    "error": "Connection timeout",
    "hint": "Check PINGONE_INTROSPECTION_ENDPOINT env var and network connectivity"
  }
}
```

### Troubleshooting

| Error | Root Cause | Fix |
|-------|-----------|-----|
| `status: not_configured` | introspection endpoint/identity not set | Set `PINGONE_INTROSPECTION_ENDPOINT` + an issuing-client identity (`PINGONE_USER_CLIENT_ID` / `GW_INTROSPECTION_CLIENT_ID`) |
| **`active:false` for a valid, unexpired token → "Session expired" loop** | **introspecting as the wrong client** — a Worker/Admin introspecting a token issued to a different client. PingOne returns `active:false` (HTTP 200), not an error. | Introspect AS the token's **issuing client**: user tokens → `PINGONE_USER_CLIENT_ID`; gateway tokens → `GW_INTROSPECTION_CLIENT_ID` (MCP Exchanger). Never the Worker. |
| `401 invalid_client` ("Unsupported authentication method") | auth-**method** mismatch — `post` creds sent to a `basic` app or vice-versa | Match `PINGONE_INTROSPECTION_AUTH_METHOD` to the app's PingOne registration (non-worker apps = `post`) |
| `401 invalid_client` ("Invalid client credentials") | wrong/stale client secret | Re-copy the secret from the PingOne console |
| `status: failed` (timeout) | Network unreachable | Check firewall / DNS to PingOne |
| PingOne 400 Bad Request | Token format invalid | Ensure token is valid JWT or opaque string |
| Slow response (>1000ms) | High latency to PingOne | Increase `INTROSPECTION_CACHE_TTL` to 60s+ |

---

## 2. JWT Local Validation (Fallback)

### How It Works

1. User makes API request with OAuth Bearer token (JWT format)
2. BFF fetches PingOne public key from JWKS endpoint (cached)
3. BFF verifies JWT signature locally using RSA RS256
4. BFF validates standard claims: `exp`, `iat`, `aud`, `iss`
5. BFF extracts scopes from `scope` claim
6. Request allowed or denied based on signature validity and required scopes

### When to Use

✓ Internal APIs where revocation latency is acceptable  
✓ Automatic fallback when PingOne is temporarily unavailable  
✓ High-throughput systems where network latency is unacceptable  
✓ Offline-capable edge deployments  
✓ Testing/development without live PingOne connectivity  

### Configuration

```bash
# Enable JWT mode
VALIDATION_MODE=jwt

# JWKS endpoint for public key verification (required)
PINGONE_JWKS_URI=https://auth.pingone.com/environments/{env-id}/oauth2/jwks

# Still configure introspection for fallback upgrades
PINGONE_INTROSPECTION_ENDPOINT=...
WORKER_CLIENT_ID=...
WORKER_CLIENT_SECRET=...
```

### Limitations

| Risk | Description | Mitigation |
|------|-------------|-----------|
| Revoked tokens accepted | JWT valid until expiry (~1h) even if PingOne revokes it | Use short token expiry (15-30 min) + introspection for sensitive ops |
| Stale authorization | Scope/attribute changes take up to 1h to take effect | Prefer introspection for permission-dependent operations |
| Signature replay | Expired tokens can't be used (exp check), but revoked non-expired tokens can | Combine with introspection for critical operations |

⚠ **Not recommended for** — Money transfers, account deletion, PII access, compliance-gated operations.

---

## 3. Automatic Fallback Behavior

The BFF implements graceful degradation:

1. **Preferred:** Try introspection first (configured mode)
2. **On failure:** Fall back to JWT validation (if JWKS endpoint available)
3. **Logging:** Records which method was used for each request

```
# Server log example (degraded mode):
[INFO] Token validation: method=introspection, cached=true, latency=2ms
[WARN] Token validation: introspection failed (timeout), falling back to jwt
[INFO] Token validation: method=jwt, latency=1ms
```

This means:
- If PingOne is down, the system stays operational in degraded mode
- Users can continue accessing APIs via JWT validation
- Once PingOne recovers, introspection automatically resumes

---

## 4. Runtime Mode Switching

### Via Demo Config UI (Recommended)

1. Navigate to **Config** page
2. Click the **🔍 Token Validation** tab
3. Select desired mode radio button
4. Mode changes take effect immediately (no restart required)
5. Click **Test PingOne Connection** to verify connectivity

### Via API (Admin Session Required)

```bash
# Get current mode
curl http://localhost:3001/api/config/validation-mode \
  -H "Cookie: connect.sid=..." | jq

# Response:
{
  "mode": "introspection",
  "description": "Introspection (Real-time, RFC 7662)...",
  "supported": ["introspection", "jwt"]
}

# Set mode
curl -X POST http://localhost:3001/api/config/validation-mode \
  -H "Content-Type: application/json" \
  -H "Cookie: connect.sid=..." \
  -d '{"mode": "jwt"}'
```

**Note:** Runtime mode changes are in-memory only. Set `VALIDATION_MODE=jwt` in `.env` to persist across restarts.

---

## 5. Monitoring & Debugging

### Health Check Endpoint

`GET /api/health/introspection` — Tests PingOne connectivity without a real token.  
Returns `200 connected` or appropriate error with diagnostic hints.

### Full Health Status

`GET /api/health` — Shows all component health (JWKS, introspection, MCP, session store).

### Check Validation Method in Token Inspector

In the demo UI, the Token Inspector shows:
- Active validation mode
- Cache hit/miss status
- Response time for introspection calls
- Decoded claims (sub, aud, scope, act, may_act)

---

## 6. Performance Considerations

| Metric | Introspection (cold) | Introspection (cached) | JWT |
|--------|---------------------|----------------------|-----|
| Latency | 100–200ms | 1–2ms | ~1ms |
| Network calls | 1 (to PingOne) | 0 | 0 (JWKS cached) |
| Cache hit rate | ~70–80% (active sessions) | — | — |
| Revocation detection | Immediate (within 30s TTL) | None | None |

**Optimization Tips:**
- Increase `INTROSPECTION_CACHE_TTL` (60–120s) if immediate revocation isn't required
- Reduce to 10s if compliance mandates near-instant revocation detection
- Monitor `/api/health/introspection` latency in production to detect PingOne bottlenecks

---

## 7. Security Implications

### Token Confusion Attack Prevention

Both modes validate `aud` (audience) claim via `audValidationMiddleware` (Phase 96). Tokens intended for one API cannot be used for another — independent of introspection vs JWT mode.

### Revocation Coverage

| Operation | Recommended Mode | Why |
|-----------|-----------------|-----|
| Money transfer | Introspection | Revoked token could drain account |
| View account balance | JWT (acceptable) | Low risk, speed preferred |
| Delete account | Introspection | Irreversible + high risk |
| Read transaction history | JWT (acceptable) | Read-only, low risk |
| Admin operations | Introspection | Admin tokens must be revocable |

### PingOne Outage Scenario

| Mode | Behavior | Security Impact |
|------|----------|----------------|
| Introspection fails | Falls back to JWT | Degraded: revoked tokens may be accepted until expiry |
| JWT JWKS unreachable | Validation fails | Fail-closed: no access without JWKS |

---

## 8. Demo Workflow

### Pre-Demo Verification

1. Set environment variables (`.env` or Vercel Settings):
   ```bash
   PINGONE_INTROSPECTION_ENDPOINT=https://auth.pingone.com/environments/{ENV_ID}/oauth2/introspect
   WORKER_CLIENT_ID=<worker-app-id>
   WORKER_CLIENT_SECRET=<worker-secret>
   ```
2. Start server: `npm run dev` (banking_api_server)
3. Navigate to **Config** → **Token Validation**
4. Click **Test PingOne Connection** → verify `✓ Connected`

### Demo Scenario: Show Introspection vs JWT

1. Ensure introspection mode is active (default)
2. Login as demo user → Perform a transaction
3. Show Config page → Token Validation → mode is `Introspection`
4. Click Test Connection → show response time + endpoint
5. Switch to JWT mode
6. Repeat transaction → show it still works (JWT validation)
7. Explain tradeoffs: "JWT is faster but can't detect revoked tokens"
8. Switch back to Introspection (recommended for demo)

---

## References

- **RFC 7662:** OAuth 2.0 Token Introspection — https://tools.ietf.org/html/rfc7662
- **RFC 6749:** OAuth 2.0 Authorization Framework — https://tools.ietf.org/html/rfc6749
- **Phase 91:** Token introspection service — `banking_api_server/services/tokenIntrospectionService.js`
- **Phase 96:** Audience (aud) claim validation — `banking_api_server/config/audConfigTemplate.js`
- **Phase 95:** Actor/Agent token terminology — `docs/ACTOR_TOKEN_TERMINOLOGY.md`
- **PingOne Docs:** https://docs.pingidentity.com/pingone/

---

**Last Updated:** 2026-04-08  
**Phase:** 97 (Demo Config with Introspection and JWT Validation Options)  
**Status:** ✅ Complete
