# Gateway and downstream validation

## Treat each hop independently

The raw PingFederate ID-JAG stops at `oauth-mcp`. It is redeemed there into an
access token. The gateway and a resource server validate access tokens that
arrive at their respective hops; they must not accept the raw assertion and
must not assume one issuer or JWKS works everywhere. The BFF remains the only
browser-token custodian, with server-to-server calls carrying tokens between
services.

| Receiver | Token issuer selected by the received token | JWKS trust source |
| --- | --- | --- |
| `oauth-mcp` redemption endpoint | PingFederate raw ID-JAG | `ENTERPRISE_IDP_JWKS_URL` |
| `demo_mcp_gateway` | `oauth-mcp`-issued redeemed token | `OAUTH_MCP_ID_JAG_JWKS_URL` when `iss` exactly equals `OAUTH_MCP_ID_JAG_ISSUER` |
| `demo_mcp_gateway` | PingFederate-issued access token | `PF_JWKS_URI` when `iss` exactly equals `PF_ISSUER_URI` or `PF_ISSUER` |
| `demo_mcp_gateway` | Other configured authorization-server token | `PINGONE_JWKS_ENDPOINT` or `PINGONE_JWKS_URI` |
| `demo_mcp_resource_server` | PingFederate-issued access token | `PF_JWKS_URI` when `iss` exactly equals `PF_ISSUER_URI` or `PF_ISSUER` |
| `demo_mcp_resource_server` | Other configured authorization-server token | `PINGONE_JWKS_URI`, or its PingOne issuer/base URL-derived JWKS |

The resource server currently has PingFederate and PingOne trust branches; it
does not gain `oauth-mcp`'s JWKS merely because the gateway has one. Before
forwarding or exchanging a redeemed token, confirm that the backend is
configured to verify the issuer/JWKS of the token that will actually arrive.

## Gateway checks and exchange

`demo_mcp_gateway/src/tokenValidator.ts` chooses a JWKS only as a hint from the
unverified `iss`; signature verification against the selected published key is
what establishes trust. It checks expiry, not-before, issued-at age, exact
issuer alignment, accepted audience, and scopes. Unknown keys refresh once and
then fail closed. `demo_mcp_gateway/src/auth/GatewayTokenPolicy.ts` additionally
requires `sub`, validates any delegation `act` claim, and blocks audiences that
would bypass a downstream hop. Its narrow native-ID-JAG exception still depends
on a token already verified using `oauth-mcp`'s JWKS and leaves all other policy
checks in force.

For normal gateway-mediated routes, the gateway uses RFC 8693 to obtain a
token for the selected backend audience before forwarding it. That downstream
token may be PingFederate-issued, in which case the backend verifies the exact
PF issuer string against PF JWKS. The exchange is a hard boundary: if it fails,
nothing is forwarded. Some native-ID-JAG routes can forward the redeemed token
only when its audience already equals the resolved backend resource URI; audit
that backend's issuer/JWKS compatibility explicitly.

## Resource-server checks

`demo_mcp_resource_server/src/server/tokenValidator.ts` verifies the received
signature before trusting claims when a JWKS is configured. It rejects malformed
or expired tokens and requires an audience in its accepted list. That list is
from `MCP_RESOURCE_SERVER_RESOURCE_URI` and may be comma-separated. It is not
the banking MCP server's `MCP_SERVER_RESOURCE_URI`; the legacy fallback exists
only for rollout compatibility and adds the resource server's own canonical
audience. Scope extraction accepts a PingFederate array or PingOne's
space-delimited string, and the caller enforces tool scopes.

For a secure deployment, configure the required JWKS and use strict signature
validation. Missing JWKS, a mismatched issuer, an invalid signature, wrong
audience, insufficient scope, or failed gateway exchange must deny the call.
Do not add mock-token, unsigned-token, or downstream fallback behavior.

## Focused source tests

Read `demo_mcp_gateway/src/__tests__/tokenValidator.idJag.test.ts` for the
oauth-mcp-JWKS selection and forged-issuer rejection, and
`demo_mcp_gateway/src/__tests__/GatewayTokenPolicy.idJag.test.ts` for the
narrow anti-bypass exemption. `demo_mcp_gateway/tests/tokenValidator-claims.test.ts`
covers issuer, timestamp, and fail-closed JWKS behavior. On the resource-server
side, `demo_mcp_resource_server/tests/acceptedAudiences.test.ts`,
`resourceUriEnv.test.ts`, and `httpMcp.test.ts` cover accepted-audience and
scope gates. There is no focused resource-server PF-JWKS test today; add one
when changing that PF branch so it remains separate from ID-JAG redemption.
