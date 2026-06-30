# OIDC Hybrid Flow — PingOne (reference)

> **Wired in the banking app?** ❌ **No.** The Super Banking BFF uses
> `authorization_code` + PKCE exclusively (see `SKILL.md` §4). Hybrid is
> documented here as **demo/teaching reference only** — do not introduce a
> fragment-returning response type into `routes/oauth*.js`.

The OIDC Hybrid Flow returns **some** tokens directly in the redirect (front
channel, URL fragment) and an authorization **code** that is then exchanged at
the token endpoint (back channel) for the rest. It combines Authorization Code
and Implicit characteristics.

## Response types

PingOne supports the three OIDC hybrid `response_type` combinations:

| `response_type` | Front-channel returns | Back-channel (code exchange) returns | Nonce |
|---|---|---|---|
| `code id_token` | `code`, `id_token` | `access_token`, `refresh_token`*, `id_token` | Required |
| `code token` | `code`, `access_token` | `access_token`, `refresh_token`* | N/A (no id_token) |
| `code id_token token` | `code`, `id_token`, `access_token` | `access_token`, `refresh_token`*, `id_token` | Required |

\* `refresh_token` is **not** an intrinsic property of the hybrid
`response_type`. It is issued only when the refresh-token grant is enabled on
the PingOne app and `offline_access` is granted (RFC 6749 §1.5; OIDC Core §11) —
same as plain Authorization Code. Nonce validation is defined against the
`id_token`, so it does not apply to `code token` (OIDC Core §3.3.2.11).

- The front-channel `id_token` lets the client verify user identity
  **immediately**, before the code exchange round-trip completes.
- The authorization `code` is still exchanged over the back channel; any
  refresh token (when issued) arrives there — refresh tokens never travel in
  the fragment.

## PingOne application configuration

| Setting | Value |
|---|---|
| App type | `WEB_APP` (or `SPA` / `NATIVE_APP` for public clients) |
| Grant types | `authorization_code`, `refresh_token` |
| Response type | enable `code id_token` / `code token` / `code id_token token` on the app's allowed response types |
| `responseMode` | `fragment` (default for hybrid) — `form_post` also supported by PingOne |
| PKCE enforcement | `S256_REQUIRED` (PKCE still applies to the code leg) |
| Redirect URIs | exact callback URL, same as authorization-code flow |

## Authorization request

```
GET https://auth.pingone.{tld}/{envId}/as/authorize
  ?response_type=code%20id_token
  &client_id={clientId}
  &redirect_uri={redirectUri}
  &scope=openid profile email
  &state={random-hex}
  &nonce={random-hex}                 // REQUIRED whenever id_token is in response_type
  &code_challenge={S256(verifier)}
  &code_challenge_method=S256
  &response_mode=fragment             // PingOne default for hybrid; form_post optional
```

## Callback: dual handling (fragment + code)

PingOne returns front-channel artifacts in the **URL fragment** (`#`), which
the browser never sends to the server. A hybrid client must therefore:

1. Read the fragment client-side: `id_token`, `access_token` (per response
   type), `code`, `state`.
2. Validate `state` (CSRF) and, if an `id_token` is present, validate its
   signature against `/as/jwks`, `iss`, `aud`, `exp`, and `nonce` (replay
   protection) — exactly as in `SKILL.md` §13.
3. POST the `code` to `/as/token`
   (`grant_type=authorization_code`, `code_verifier=...`) to obtain the
   `refresh_token` and a fresh `access_token` / `id_token`.
4. Reconcile: the back-channel `id_token` is authoritative; verify its `sub`
   matches the front-channel `id_token`'s `sub`.

```
// Token request for the code leg (back channel)
POST https://auth.pingone.{tld}/{envId}/as/token
  grant_type=authorization_code
  &code={code}
  &redirect_uri={redirectUri}
  &client_id={clientId}
  &code_verifier={verifier}
  Authorization: Basic base64(clientId:clientSecret)   // confidential client
```

## When to use vs plain Authorization Code + PKCE

| Use hybrid when | Use authorization code + PKCE when (this project) |
|---|---|
| The client needs the `id_token` **before** the code exchange completes (e.g. immediate identity-first UX) | A confidential BFF holds tokens server-side — there is no benefit to a front-channel token |
| Legacy OIDC RPs that expect `code id_token` | Default for all browser logins; smallest attack surface |

**Why the banking app does not use hybrid:** the BFF is a confidential client
and the browser holds only an opaque session cookie (token-custody rule). A
front-channel `access_token`/`id_token` in the URL fragment would expose token
material to the browser, violating that rule. Plain authorization code + PKCE
keeps every token server-side.

## Security notes

- Fragment-borne `access_token` is exposed to the browser, browser history,
  and any script on the page — never adopt this in a confidential-client BFF.
- `nonce` is **mandatory** for any response type containing `id_token`;
  validate it on the front channel and again after the code exchange.
- Always validate `state` even though hybrid also carries `code`.
