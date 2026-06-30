# PingOne Redirectless — `response_mode=pi.flow` (reference)

> **Wired in the banking app?** ❌ **No.** Super Banking always uses a browser
> redirect to PingOne (`/as/authorize` → callback). `pi.flow` is documented
> here as **demo/teaching reference only**.

`pi.flow` is a **PingOne-proprietary** response mode (not OAuth 2.0 / OIDC
standard) that removes the browser redirect entirely. Instead of a `302` to
the IdP, PingOne returns a **JSON flow object** the client drives via API
calls until authentication completes, at which point the code / access token /
ID token is returned in a JSON response rather than a redirect.

PingOne docs: <https://docs.pingidentity.com/pingone/applications/p1_response_mode_values.html>

## Key parameters

| Parameter | Value | Note |
|---|---|---|
| `response_mode` | `pi.flow` | Set on the **authorization request** (NOT `response_type`) |
| `redirect_uri` | `urn:pingidentity:redirectless` | Sent where a redirect URI is otherwise required |
| `response_type` | `code` (typical) | PKCE still applies to the code leg |
| `pkceEnforcement` | `S256_REQUIRED` | Recommended |

## Request / response shape

The initial request is the **standard authorization request** (the usual
`GET /as/authorize`, or `POST` if you push via PAR) with one extra parameter:
`response_mode=pi.flow`. It is `pi.flow` that makes PingOne return a flow object
instead of redirecting — not a different HTTP verb.

```
GET https://auth.pingone.{tld}/{envId}/as/authorize
  ?response_type=code
  &response_mode=pi.flow                       # the redirectless switch
  &client_id={clientId}
  &redirect_uri=urn:pingidentity:redirectless  # sent where a redirect_uri is otherwise required
  &scope=openid profile email
  &code_challenge={S256(verifier)}
  &code_challenge_method=S256
```

PingOne responds with a **flow object** (JSON) describing the next required
interaction (e.g. username/password, MFA) instead of a `302`. The client then
submits each subsequent *flow step* as a `POST` to the Flow API. On completion PingOne returns the
authorization `code` / tokens in a JSON body — no front-channel redirect ever
occurs.

## Use cases (demo only)

- Native mobile apps with a fully embedded login UI (no system browser).
- Desktop / thick clients with no browser context.
- SDK-driven, identity-first experiences where the app owns the auth UX.

## Trade-offs

| Benefit | Caution |
|---|---|
| No browser navigation; seamless embedded UX | ⚠️ **PingOne-specific** — not portable to other IdPs |
| No front-channel URL exposure of params/tokens | The app must reimplement the entire login/MFA UI |
| Full developer control over the auth experience | Loses the IdP-hosted login page's built-in protections |

## Why the banking app does not use `pi.flow`

The BFF deliberately delegates the login UI to PingOne's hosted page
(authorization code + PKCE redirect). That keeps credentials off the banking
surface, inherits PingOne's hosted MFA/DaVinci flows, and stays
standards-portable. Adopting `pi.flow` would move the entire authentication UI
into the banking app — out of scope and contrary to the BFF design.
