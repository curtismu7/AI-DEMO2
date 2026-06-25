# PingOne API Audit Findings

Audited against: https://apidocs.pingidentity.com/pingone/platform/v1/api/
Files checked: `agentMcpTokenService.js`, `tokenIntrospectionService.js`, `pingOneAuthorizeService.js`, `cibaService.js`, `simulatedAuthorizeService.js`

---

## ✅ Correct implementations

### POST /as/token — RFC 8693 token exchange (agentMcpTokenService.js)
- `grant_type`: `urn:ietf:params:oauth:grant-type:token-exchange` ✅
- `subject_token` + `subject_token_type: urn:ietf:params:oauth:token-type:access_token` ✅
- `actor_token` + `actor_token_type` when 2-exchange mode ✅
- `audience` narrowed to MCP resource URI per hop ✅
- `scope` passed per-exchange ✅
- Error shape: `{ error, error_description }` correctly handled ✅

### POST /as/introspect — RFC 7662 (tokenIntrospectionService.js)
- `token` sent as form body ✅
- Response `active` boolean checked ✅
- Standard RFC 7662 claims (`sub`, `exp`, `aud`, `client_id`) extracted ✅

### POST /as/bc-authorize — CIBA (cibaService.js)
- `login_hint`, `binding_message` sent as form params ✅
- `grant_type: urn:openid:params:grant-type:ciba` on token poll ✅
- `auth_req_id` passed on poll ✅

### POST /v1/environments/{envId}/decisionEndpoints/{endpointId} — PingOne Authorize
- Decision endpoint ID taken from config ✅
- Trust Framework parameters object `{ Amount, TransactionType, UserId, Timestamp }` ✅

---

## ⚠️ Minor mismatches (cosmetic / non-breaking)

### POST /as/introspect — auth method (tokenIntrospectionService.js)
- **Expected (docs):** `Authorization: Basic base64(client_id:client_secret)`
- **Actual:** `client_id` and `client_secret` sent as form body params
- **Verdict:** ⚠️ PingOne accepts both methods; form-body method works but deviates from documented curl examples. Not breaking.

### CIBA bc-authorize — missing `scope` param (cibaService.js)
- **Expected (docs):** `scope: openid` recommended
- **Actual:** `scope` not sent in bc-authorize request (only in token poll)
- **Verdict:** ⚠️ Works because PingOne defaults to configured scopes; explicit `scope: openid` is safer per docs.

---

## ❌ Incorrect implementations (fix required)

### simulatedAuthorizeService.js — response envelope does not match PingOne Authorize shape
- **Expected (PingOne docs):**
  ```json
  {
    "id": "<uuid>",
    "createdAt": "<iso8601>",
    "completedAt": "<iso8601>",
    "duration": 12,
    "status": "SUCCESS",
    "result": { "decision": "PERMIT", "weight": 1.0 },
    "statements": [],
    "obligations": []
  }
  ```
- **Actual:** Returns `{ decision, stepUpRequired, path, decisionId, raw }` — a parsed/processed form, not the PingOne response envelope.
- **Fix:** Add `evaluate()` method returning the PingOne-shaped envelope. Fixed in Plan 239-02.

---

## 🔗 Doc links added in Plan 239-03

| Endpoint | Doc URL |
|----------|---------|
| POST /as/token | https://apidocs.pingidentity.com/pingone/platform/v1/api/#post-token |
| POST /as/introspect | https://apidocs.pingidentity.com/pingone/platform/v1/api/#post-token-introspection |
| POST /as/bc-authorize | https://apidocs.pingidentity.com/pingone/platform/v1/api/#post-backchannel-authentication-request |
| POST /v1/.../decisions | https://apidocs.pingidentity.com/pingone/platform/v1/api/#post-decision |
