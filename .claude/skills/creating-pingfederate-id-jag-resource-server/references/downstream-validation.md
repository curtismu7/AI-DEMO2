# Gateway and downstream validation

## Treat each hop independently

The raw PingFederate ID-JAG stops at `oauth-mcp`. It is redeemed there into an
access token. The gateway and a resource server validate access tokens that
arrive at their respective hops; they must not accept the raw assertion and
must not assume one issuer or JWKS works everywhere. The BFF remains the only
browser-token custodian, with server-to-server calls carrying tokens between
services.

Do not log or expose assertions, access tokens, JWKS credentials, or other
secrets while tracing a hop. Use redacted identifiers and error codes in logs,
responses, and evidence.

| Receiver | Received-token condition used for JWKS selection | JWKS trust source |
| --- | --- | --- |
| `oauth-mcp` redemption endpoint | PingFederate raw ID-JAG | `ENTERPRISE_IDP_JWKS_URL` |
| `demo_mcp_gateway` | Unverified `iss` equals `OAUTH_MCP_ID_JAG_ISSUER` | `OAUTH_MCP_ID_JAG_JWKS_URL` |
| `demo_mcp_gateway` | Unverified `iss` equals `PF_ISSUER_URI` or `PF_ISSUER` | `PF_JWKS_URI` |
| `demo_mcp_gateway` | Any other token | `PINGONE_JWKS_ENDPOINT` or `PINGONE_JWKS_URI` |
| `demo_mcp_resource_server` | Token whose unverified `iss` equals configured `PF_ISSUER_URI` or `PF_ISSUER` | `PF_JWKS_URI` selected as a verification source |
| `demo_mcp_resource_server` | Any other token | `PINGONE_JWKS_URI`, or its PingOne issuer/base URL-derived JWKS, selected as a verification source |

The resource server currently has PingFederate and PingOne JWKS-selection
branches; it does not gain `oauth-mcp`'s JWKS merely because the gateway has
one. Before forwarding or exchanging a redeemed token, confirm that the backend
is configured to verify the issuer/JWKS of the token that will actually arrive.

## Gateway checks and exchange

`demo_mcp_gateway/src/tokenValidator.ts` chooses a JWKS only as a hint from the
unverified `iss`; signature verification against the selected published key is
what establishes trust. It checks expiry, `nbf` when present, and `iat` when
present (future time and maximum age); it has a separate `PINGONE_ISSUER_URI`
comparison for non-ID-JAG tokens when that setting is configured. Treat this as
distinct from JWKS selection and confirm the configured expected issuer covers
the route being changed. It checks accepted audience and scopes; unknown keys
refresh once and then fail closed. `demo_mcp_gateway/src/auth/GatewayTokenPolicy.ts`
additionally requires `sub`, validates any delegation `act` claim, and blocks
audiences that would bypass a downstream hop. Its narrow native-ID-JAG exception
still depends on a token already verified using `oauth-mcp`'s JWKS and leaves all
other policy checks in force.

For normal gateway-mediated routes, the gateway uses RFC 8693 to obtain a
token for the selected backend audience before forwarding it. That downstream
token may be PingFederate-issued. A hardened backend must verify its signature
against PF JWKS and enforce the exact PF issuer with an explicit issuer check;
the current backend lacks that issuer check. The exchange is a hard boundary:
if it fails, nothing is forwarded. Some native-ID-JAG routes can forward the
redeemed token only when its audience already equals the resolved backend
resource URI; audit that backend's issuer/JWKS compatibility explicitly.

## Resource-server checks

`demo_mcp_resource_server/src/server/tokenValidator.ts` verifies the received
signature before trusting claims when a JWKS is configured. It rejects malformed
or expired tokens and requires an audience in its accepted list. That list is
from `MCP_RESOURCE_SERVER_RESOURCE_URI` and may be comma-separated. It is not
the banking MCP server's `MCP_SERVER_RESOURCE_URI`; the legacy fallback exists
only for rollout compatibility and adds the resource server's own canonical
audience. Scope extraction accepts a PingFederate array or PingOne's
space-delimited string, and the caller enforces tool scopes.

Its pre-decode `iss` is only a JWKS selector: a value equal to `PF_ISSUER`
selects PF JWKS, otherwise it selects PingOne JWKS. `jwtVerify(token, jwks)` is
called without an issuer option, so the current backend has no explicit expected
issuer allowlist. `STRICT_AUTH=true` requires a JWKS but does not add issuer
validation. Treat this as a current security gap, not as evidence that a
mismatched issuer is denied.

In a new or hardened backend, retain pre-decode issuer use only for key-source
selection, then require an explicit expected issuer or allowlist during or
after cryptographic verification and reject missing or mismatched values. Also
document time-claim behavior per hop: this backend explicitly checks `exp` but
has no `iat` policy. Add any profile-required `iat` or other missing time check
with focused tests; do not claim it is currently enforced. For a secure
deployment, configure the required JWKS and strict signature validation. An
invalid signature, wrong audience, insufficient scope, failed gateway exchange,
or a hardened issuer/time check must deny the call. Do not add mock-token,
unsigned-token, or downstream fallback behavior.

## Focused source tests

Read `demo_mcp_gateway/src/__tests__/tokenValidator.idJag.test.ts` for the
oauth-mcp-JWKS selection and forged-issuer rejection, and
`demo_mcp_gateway/src/__tests__/GatewayTokenPolicy.idJag.test.ts` for the
narrow anti-bypass exemption. `demo_mcp_gateway/tests/tokenValidator-claims.test.ts`
covers issuer, timestamp, and fail-closed JWKS behavior. On the resource-server
side, `demo_mcp_resource_server/tests/acceptedAudiences.test.ts`,
`resourceUriEnv.test.ts`, and `httpMcp.test.ts` cover accepted-audience and
scope gates. There is no focused resource-server PF-JWKS test today; add one
when changing that PF branch, together with expected-issuer and required-time
claim cases, so it remains separate from ID-JAG redemption.
