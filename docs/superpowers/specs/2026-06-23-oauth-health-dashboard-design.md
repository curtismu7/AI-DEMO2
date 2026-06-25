# OAuth Health Dashboard Design

**Date:** 2026-06-23  
**Scope:** Complete OAuth configuration and health monitoring for the `/configure` admin page  
**Problem:** Admins debugging OAuth redirect URI mismatches have no visibility into: which URIs are registered vs. being sent, whether PingOne is reachable, config sources of truth, or demo credentials for testing  
**Goal:** Single dashboard showing OAuth status, URIs, test credentials, endpoint health, and recent errors

---

## Architecture

### New Backend Endpoints

#### `GET /api/admin/oauth-health`
Returns complete OAuth configuration and health state.

**Response:**
```json
{
  "demo_credentials": {
    "admin": { "username": "demoAdmin", "password": "..." },
    "user": { "username": "demoUser", "password": "..." }
  },
  "server_endpoints": {
    "bff": { "url": "https://api.ping.demo:4000", "status": "ok" },
    "pingone_auth": { "url": "https://auth.pingone.com/<env>/as", "status": "ok" },
    "gateway": { "url": "https://api.ping.demo:3036/mcp", "status": "ok" }
  },
  "environment": {
    "pingone_environment_id": "01d89b06-...",
    "pingone_region": "com",
    "deployment_mode": "local",
    "active_vertical": "banking"
  },
  "config_sources": {
    "admin_redirect_uri": { "lmdb": "...", "env": "...", "active": "lmdb" },
    "user_redirect_uri": { "lmdb": "...", "env": "...", "active": "lmdb" }
  },
  "recent_errors": [
    { "timestamp": "2026-06-23T15:40:00Z", "type": "redirect_uri_mismatch", "message": "..." }
  ]
}
```

#### `POST /api/admin/oauth-health/check`
Runs a health check: tests PingOne reachability, JWKS validity, token exchange simulation.

**Response:**
```json
{
  "checks": [
    { "name": "PingOne Reachable", "status": "pass", "detail": "" },
    { "name": "JWKS Valid", "status": "pass", "detail": "" },
    { "name": "Token Exchange", "status": "fail", "detail": "Invalid client credentials" }
  ],
  "timestamp": "2026-06-23T15:41:00Z"
}
```

### Frontend Changes

**Location:** `/configure` → Debug Info tab (already scaffolded)

**New component:** `OAuthHealthDashboard.jsx` replaces `OAuthRedirectDebugInfo.jsx`

**Sections:**

1. **Quick Status** (top)
   - Single-row badge: ✅ All systems healthy / ⚠️ X issues detected
   - Color: green / yellow / red based on health check results
   - Click to expand details or run fresh check

2. **OAuth Redirect URIs** (existing, keep as-is)
   - Admin and user redirect URIs being sent by BFF
   - Instructions for PingOne registration

3. **Demo Test Accounts**
   - Username/password table (demoAdmin, demoUser)
   - Copyable password field with visibility toggle
   - Note: "Use these to test OAuth flow end-to-end"

4. **Run Health Check**
   - Button: "Check OAuth Health"
   - Runs `/api/admin/oauth-health/check` on click
   - Shows results in-line: pass/fail indicators per test
   - Latest check timestamp

5. **Server Endpoints** (below fold)
   - BFF, PingOne Auth, Gateway URLs
   - Status indicators: reachable/unreachable (from health check)
   - Port numbers for local debugging

6. **Environment Info** (below fold)
   - PingOne environment ID, region, deployment mode, active vertical
   - Read-only display

7. **Config Source of Truth** (below fold)
   - For admin_redirect_uri and user_redirect_uri: show value in LMDB vs .env
   - Indicate which is active (LMDB wins if set)
   - Explain: "LMDB persists across restarts. .env is fallback. Scope-topology.json is master SoT for deployment URLs."

8. **Recent OAuth Errors** (below fold)
   - Last 5 login failures with timestamp, error type, message
   - Truncated to 1 line per error; click to expand
   - Refresh on demand

---

## Data Flow

1. **On Dashboard Load:** Fetch `/api/admin/oauth-health` → populate all sections
2. **On Health Check Click:** POST `/api/admin/oauth-health/check` → show results inline, update Quick Status
3. **Demo Credentials:** Pulled from configStore at `/api/admin/oauth-health` — never returned by `/redirect-info`
4. **Error Log:** Populated by existing OAuth error tracking in `appEventService`; endpoint surfaces last 5

---

## Error Handling

- **Endpoint unreachable:** "Failed to load health info" message + retry button
- **Health check timeout:** Show partial results, indicate which checks timed out
- **Invalid config:** Highlight red in config SoT section with explanation
- **Demo credentials missing:** Show "Not configured" instead of password

---

## Testing

- **Manual:** Load `/configure?tab=debug` → verify all sections populate → click "Check OAuth Health" → verify results
- **E2E:** Trigger OAuth redirect URI mismatch → dashboard shows recent error in error log
- **Integration:** Health check correctly detects unreachable PingOne, invalid JWKS, failed token exchange

---

## Out of Scope

- Editing redirect URIs from this dashboard (already in Redirect URIs tab)
- Historical analytics or trending
- Automated remediation
- Real-time WebSocket updates

---

## Success Criteria

✅ Admins can see exact redirect URIs being sent vs. registered in PingOne  
✅ Admins have demo credentials ready to test OAuth flow  
✅ Health check clearly shows which services are reachable  
✅ Config source of truth (LMDB vs .env) is visible  
✅ Recent OAuth errors are visible with timestamps  
✅ Dashboard loads in <2 seconds on typical network
