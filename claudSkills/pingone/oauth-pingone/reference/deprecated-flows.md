# Deprecated Flows — Implicit & ROPC (anti-patterns, reference)

> ⚠️ **ANTI-PATTERN DOCUMENT.** The flows below are documented so an agent can
> *recognize and reject* them — **not** to implement them.
>
> **Wired in the banking app?** ❌ **No, and never should be.** The Super
> Banking BFF uses `authorization_code` + PKCE for all user logins. Nothing in
> this file should lead anyone to add Implicit or ROPC to `routes/oauth*.js`.

---

## ⚠️ 1. Implicit Flow (deprecated — OAuth 2.0 Security BCP)

The Implicit flow returns tokens **directly in the URL fragment** with no code
exchange. It exists for legacy single-page apps from before PKCE. It is
**discouraged** by the OAuth 2.0 Security Best Current Practice and the OAuth
2.1 draft. Use Authorization Code + PKCE instead.

### OAuth 2.0 Implicit vs OIDC Implicit

| Aspect | OAuth 2.0 Implicit | OIDC Implicit |
|---|---|---|
| Purpose | Authorization (API access) only | Authentication + authorization |
| `response_type` | `token` | `id_token token` |
| Tokens returned | `access_token` only | `id_token` + `access_token` |
| `nonce` | Not used (no id_token) | **Required** (protects id_token) |
| Default scopes | custom / none | `openid profile email` |
| User identity | ❌ none | ✅ in id_token |
| UserInfo endpoint | ❌ n/a | ✅ available |
| ⚠️ Auth use | **NOT for authentication** | for authentication, but still deprecated |

Both variants return tokens in the fragment:

```
# OAuth 2.0 Implicit
#access_token=eyJ...&token_type=Bearer&expires_in=3600&state=abc

# OIDC Implicit
#id_token=eyJ...&access_token=eyJ...&token_type=Bearer&expires_in=3600&state=abc
```

### ⚠️ Why Implicit is unsafe

- `access_token` lands in the URL fragment → browser history, `Referer`,
  any script on the page, server logs if mishandled.
- No PKCE / code-exchange step → no proof-of-possession of the redirect.
- Token leakage via open redirectors and XSS is materially easier.
- OIDC Implicit's `nonce` only mitigates id_token replay — it does nothing
  for the exposed `access_token`.

---

## ⚠️ 2. Resource Owner Password Credentials (ROPC, deprecated)

**Grant type:** `password`. The client collects the user's **username and
password directly** and POSTs them to `/as/token`:

```
POST https://auth.pingone.{tld}/{envId}/as/token
  grant_type=password
  &username={user}
  &password={password}
  &scope=openid
  Authorization: Basic base64(clientId:clientSecret)
```

### ⚠️ Why ROPC is an anti-pattern

- The application **sees the raw password**, defeating the entire point of
  federated/delegated auth.
- Incompatible with MFA, step-up, DaVinci policies, risk signals, and
  passwordless — PingOne's hosted login provides all of these; ROPC bypasses
  them.
- Removed in OAuth 2.1; retained only for legacy migration edge cases.
- No way to do PKCE, no user consent screen, no SSO session.

---

## Why the banking app never uses these

1. **Token-custody rule (CLAUDE.md / REGRESSION_PLAN §1).** Tokens are *never*
   exposed to the browser. Implicit puts `access_token`/`id_token` directly in
   the browser URL — a direct violation. The BFF holds all tokens server-side;
   the SPA gets only an httpOnly `connect.sid` cookie.
2. **PingOne-hosted login is mandatory for security posture.** Admin/User
   logins go through `/as/authorize` so MFA, DaVinci step-up, CIBA, and risk
   evaluation apply. ROPC would put the password in the banking app and skip
   all of it.
3. **PKCE S256 is enforced on every authorization-code flow** (`SKILL.md`
   §17). Neither Implicit nor ROPC supports a PKCE-protected code exchange.
4. `SKILL.md` §17 already states the hard rules: **"❌ Never use implicit
   flow"**. ROPC is rejected for the same reasons.

**If you are tempted to add `grant_type=password` or `response_type=token`:
stop.** Use Authorization Code + PKCE (`SKILL.md` §4), or CIBA (§6) for
out-of-band approval.
