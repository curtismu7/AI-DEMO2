# JWT-Bearer Assertion + RAR — PingOne (reference)

> **Wired in the banking app?** ❌ **No.** The BFF uses `client_credentials`
> for the agent actor token and plain scope strings for authorization. JWT-bearer
> and RAR are documented here as **demo/teaching reference only**.

## 1. JWT-Bearer Assertion Grant

**Grant type URN:** `urn:ietf:params:oauth:grant-type:jwt-bearer` (RFC 7523)

A client presents a **signed JWT assertion** in place of (or to obtain) an
access token, rather than a client secret or an interactive user flow. The
assertion's `iss`/`sub`/`aud`/`exp` are validated by PingOne against the
registered application's signing key.

```
POST https://auth.pingone.{tld}/{envId}/as/token
  grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer
  &assertion={signed-JWT}
  &scope=openid
```

**PingOne app requirements (demo):**

| Setting | Value |
|---|---|
| Grant type | enable `jwt-bearer` on the application |
| Token endpoint auth | `PRIVATE_KEY_JWT` (the app holds the private key) |
| Signing | RS256/ES256 JWK registered in the PingOne app |

Contrast with `private_key_jwt` **client authentication** (RFC 7523 §2.2,
within the RFC 7521 assertion framework; OIDC Core §9): there the JWT
authenticates the *client* on an otherwise normal grant; here the JWT
assertion *is* the grant (RFC 7523 §2.1).

## 2. RAR — Rich Authorization Requests (RFC 9396)

RAR replaces (or augments) the flat `scope` string with a structured JSON
`authorization_details` array, letting the client request **fine-grained,
parameterized** permissions and the IdP render an exact consent screen.

```
&authorization_details=[{
  "type": "payment_initiation",
  "instructedAmount": { "currency": "USD", "amount": "250.00" },
  "creditorName": "ABC Supplies",
  "creditorAccount": { "iban": "US12345678901234567890" }
}]
```

| `scope` (today, banking) | `authorization_details` (RAR) |
|---|---|
| `banking:write` | `{ "type": "payment_initiation", "instructedAmount": {...}, "creditorName": "..." }` |
| Coarse: "can transfer" | Specific: "authorize **$250** to **ABC Supplies**" |
| Opaque to audit | Structured, auditable, compliance-friendly |

`authorization_details` is echoed in the issued token so the resource server
can enforce the exact constraint that was consented to.

## 3. Pairing with PAR

RAR payloads are large and security-sensitive, so they are normally pushed via
**PAR** (RFC 9126, `SKILL.md` §12) rather than placed in a browser URL:

```
POST /as/par   (authorization_details + scope + PKCE, server-to-server)
  → { request_uri, expires_in }
GET  /as/authorize?client_id=...&request_uri=urn:ietf:params:oauth:request_uri:...
```

This keeps the structured permission request off the front channel and within
URL length limits.

## Relevance to the banking app (why it stays reference-only)

Super Banking already enforces fine-grained, transaction-level approval
through its **HITL / step-up consent** layer (see `hitl-consent` skill, Phase
170 transfer consent + 428 enforcement) rather than RAR. RAR/PAR/jwt-bearer
are valuable teaching material for "what fine-grained authorization looks like
at the protocol layer," but adopting them would duplicate the existing consent
mechanism. Do **not** wire `authorization_details` or `jwt-bearer` into the BFF
without an explicit, separately-approved design.
