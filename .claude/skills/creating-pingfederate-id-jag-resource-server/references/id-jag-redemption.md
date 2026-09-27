# ID-JAG redemption at `oauth-mcp`

## Boundary and inputs

`oauth-mcp/src/oauth/IdJagGrantHandler.ts` verifies the raw PingFederate
ID-JAG. It is a grant assertion for the token endpoint, never a resource-server
bearer token. The BFF retains browser-token custody; the assertion and the
redeemed tokens stay on the server-to-server authorization path.

Treat the assertion and every token response as secret material. Do not log,
return, paste into traces, or include them in test evidence; record only
redacted identifiers and failure codes.

`oauth-mcp/src/oauth/OAuthRouter.ts` accepts the JWT bearer grant only while
native ID-JAG mode is enabled. It passes these values to the verifier:

| Input | Required alignment |
| --- | --- |
| ID-JAG issuer | `ENTERPRISE_IDP_ISSUER`, exactly equal to the assertion `iss` |
| ID-JAG JWKS | `ENTERPRISE_IDP_JWKS_URL`; PingFederate `x5t` headers use the unique matching published key |
| ID-JAG audience | `oauth-mcp`'s own issuer (`this.issuer`) |
| Accepted `resource` | `resolveAudience()`, derived from the banking MCP server's `MCP_SERVER_RESOURCE_URI` configuration |

Do not substitute `MCP_RESOURCE_SERVER_RESOURCE_URI` here. That setting belongs
to `demo_mcp_resource_server` and names that backend's accepted audience(s).
The two settings may intentionally differ.

## Required assertion checks

`verifyIdJag()` pins `RS256`, so an unsigned assertion or an algorithm change
is rejected. `jose.jwtVerify` enforces the configured issuer and audience and
checks `exp`; the handler also requires `typ: oauth-id-jag+jwt`. It permits five
seconds of clock tolerance and returns no partial claims on failure. `iat` is
carried into the returned claims, while this handler's explicit timestamp
enforcement is expiration; do not claim a separate `iat` or `nbf` policy unless
one is added. The assertion must contain an accepted `resource` and `jti`; the
router uses `sub`, with `email` only as an account-linking fallback. Compare
this limited redemption time policy with the gateway's `iat` policy and the
downstream backend's lack of one; implement any profile-required missing check
at the hop that receives the credential.

Each `jti` is single-use. The replay cache is an in-memory, process-local map
whose entries expire at the assertion expiration time. It rejects a replay in
one `oauth-mcp` process, but it is not shared across replicas or restarts. A
multi-replica deployment needs a shared replay store before it can claim global
single-use enforcement.

## Redemption result

After verification, `OAuthRouter.redeemIdJag()` calls
`TokenIssuer.issueAuthorizationCode()`. `oauth-mcp` mints the resulting access
token with its **own** signing key and issuer. The requested scope is clamped to
the registered client scope, yielding the assertion scope intersected with the
client's allowed scope. PingFederate's ID-JAG signing key does not sign this
new access token.

The gateway must therefore validate an ID-JAG-redeemed access token against
`oauth-mcp`'s issuer/JWKS (`OAUTH_MCP_ID_JAG_ISSUER` and
`OAUTH_MCP_ID_JAG_JWKS_URL`), while the raw ID-JAG was verified against the
enterprise issuer/JWKS above. Exact issuer strings are part of both trust
decisions.

## Failure posture and source tests

Failure is closed: absent assertion, disabled mode, invalid signature,
algorithm, type, issuer, audience, timestamp, resource, or replay returns an
OAuth error and mints nothing. Do not add a mock assertion, decode-only path,
or fallback token to make a resource-server request succeed.

Use `oauth-mcp/src/oauth/__tests__/IdJagGrantHandler.test.ts` for the verifier
guards and `oauth-mcp/src/oauth/__tests__/OAuthRouter.idJag.test.ts` for token
endpoint redemption, PF-style `x5t` selection, feature advertisement, and
scope behavior. These tests document the intended validation contract; they do
not make a mock token acceptable in a deployed path.
