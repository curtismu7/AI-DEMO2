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
checks `exp` and `nbf` when present; the handler also requires
`typ: oauth-id-jag+jwt`. It applies five seconds of clock tolerance and returns
no partial claims on failure. `iat` is carried into the returned claims, but
the handler has no independent future-time or maximum-age `iat` policy. The
assertion must contain an accepted `resource` and `jti`; the router uses `sub`,
with `email` only as an account-linking fallback. Compare this redemption time
policy with the gateway's `iat` policy and the downstream backend's lack of
one; implement any profile-required missing check at the hop that receives the
credential.

The assertion's `client_id` must equal the client that authenticated at the token
endpoint; a different client, or a missing claim, is refused with `invalid_grant`.
This runs before the `jti` is consumed, so a wrong-client attempt cannot burn a
valid assertion. `ENTERPRISE_IDP_ALLOW_UNBOUND_ID_JAG=true` tolerates a missing
claim for an IdP that does not emit it yet (off by default). The default
`demo-bff-mcp-client` is public (`none`); set `ENTERPRISE_MCP_AS_CLIENT_SECRET` to
register it as confidential and `ENTERPRISE_IDP_REQUIRE_CLIENT_AUTH=true` to refuse
public clients at the jwt-bearer grant.

PingFederate fills the ID-JAG `client_id` from the refresh token's client (the BFF
login client, `ai-demo-pf-user`), not from the client that redeems the assertion.
`ENTERPRISE_IDP_ID_JAG_CLIENT_MAP` (`idp-client=our-client,...`) lets that value
stand for the redeeming client; the compose `mcp-server` service maps
`ai-demo-pf-user=demo-bff-mcp-client`. A value that is not mapped must still equal
the redeeming client exactly. The cleaner long-term fix is to fulfil `client_id` in
the `aiDemoPfIdJagSp` attribute mapping with the resource-AS client id.

Each `jti` is single-use. The replay cache is mirrored into the same encrypted
store the token store uses (`TOKEN_STORAGE_PATH` + `ENCRYPTION_KEY`), so a restart
no longer reopens the window; entries expire at the assertion's expiration and
expired ones are dropped on restore. It is still one process's view: several
`oauth-mcp` replicas would need a store they all share (the k8s deployment runs
one replica). Without the storage env it is in-memory only.

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

## Agent identity on the redeemed token

The ID-JAG carries no delegation chain, so the redeemed access token has no `act`
claim. The redeeming client is recorded as `client_id` (and the user as `sub`);
that is the agent identity downstream policy can read. Adding an `act` claim would
invent a delegation the assertion does not state, and the gateway's policy rejects
actor ids that are not registered identities.

## Accepted resources

The assertion's `resource` must be one this server serves. By default that is the
whole `MCP_SERVER_RESOURCE_URI` list, which also names other servers (the gateway,
PingOne's API). `ENTERPRISE_IDP_ID_JAG_RESOURCES` narrows it to the aliases that
really name this MCP server; the docker-compose `mcp-server` service sets it, minus
`https://api.pingone.com`. The issued token's audience stays this server's own
canonical audience, because an authorization server may only assert its own.
