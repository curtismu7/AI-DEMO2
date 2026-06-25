# API Change Summary

Date: 2026-04-26
Scope: PingOne test-page request/response visibility and standardized per-test API panels

## What Was Implemented

### 1) Shared API panel for test pages (UI)
- Added a reusable component to standardize API request/response display across test pages:
  - `banking_api_ui/src/components/PingOneApiPanel.jsx`
  - `banking_api_ui/src/components/PingOneApiPanel.css`
- Behavior:
  - Independent toggle for PingOne Request and PingOne Response
  - Request view supports method/url/content-type/body shape
  - Response view renders JSON payload

### 2) Authz test page API visibility
- Updated `banking_api_server/services/pingOneAuthorizeService.js`:
  - `_postDecisionEndpoint` now captures `_debug.request` and `_debug.response` for real PingOne decision endpoint calls.
- Updated `banking_api_server/routes/authorize.js`:
  - `POST /api/authorize/test-evaluate` now returns:
    - `pingoneRequest`
    - `pingoneResponse`
- Updated `banking_api_ui/src/components/AuthzTestPage.jsx`:
  - Uses `PingOneApiPanel` per scenario/custom test result
  - Request rendering shows URL/method/body for real PingOne endpoint debug data

### 3) MFA test page standardization
- Updated `banking_api_ui/src/components/MFATestPage.jsx`:
  - Replaced inline request/response blocks with shared `PingOneApiPanel`
  - Preserved per-test-card API request/response behavior

### 4) PingOne test page: per-card API request/response
- Updated `banking_api_ui/src/components/PingOneTestPage.jsx`:
  - Added per-test-card request/response state wiring for:
    - Agent token
    - Exchange user-to-MCP
    - Exchange ID-token+actor-to-MCP
    - 1-token 401 flow
    - Apps/resources/scopes/users calls
  - Passed `pingoneRequest` and `pingoneResponse` into each relevant TestCard

### 5) Backend route instrumentation for PingOne test flows
- Updated `banking_api_server/routes/pingoneTestRoutes.js`:
  - Added `_p1ReqDebug(method, url, contentType, body)` helper for safe request debug objects.
  - Added route-level `pingoneRequest`/`pingoneResponse` in responses for:
    - `/api/pingone-test/agent-token`
    - `/api/pingone-test/apps`
    - `/api/pingone-test/resources`
    - `/api/pingone-test/scopes`
    - `/api/pingone-test/users`
    - `/api/pingone-test/exchange-user-to-mcp`
    - `/api/pingone-test/exchange-idtoken-agent-to-mcp`
    - `/api/pingone-test/exchange-1token-401-flow`

## Review Notes
- Goal was minimal-diff standardization: one shared panel component, existing card flows preserved.
- Each test section now has its own request/response panel (no single page-level shared payload).
- Debug objects are synthetic/safe and intended for display; secrets are not emitted.

## Validation
- UI build completed successfully:
  - Command: `cd banking_api_ui && npm run build`
  - Result: exit code 0
