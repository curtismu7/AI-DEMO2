# Direct A2A access with federated customer IdPs

## Status

Approved design. Implementation is intentionally separate from this
specification and must follow the repository's OAuth, A2A, MCP, and Kubernetes
regression contracts.

## Goal

Make the LangChain agent directly consumable by third-party A2A applications
while allowing multiple customer identity providers through an explicit
tenant/issuer trust allowlist. Preserve access from the existing PingOne
Privilege integration.

The caller connects directly to the LangChain A2A endpoint. The LangChain
process remains the MCP host: its MCP credentials, token exchange, and tool
authorization stay server-side and are never returned to or selected by the
calling application.

## Non-goals

- Do not publish the LangChain health, status, metrics, MCP inspector, or
  internal `/run` surfaces as public application APIs.
- Do not accept an issuer, tenant, subject, audience, or privilege level from
  JSON-RPC payload fields or untrusted headers.
- Do not trust arbitrary issuers discovered from a request. Every accepted
  issuer must be configured in the deployment trust registry.
- Do not remove or weaken the existing Privilege transaction-token path.
- Do not make the A2A service a generic OAuth proxy for unrelated resources.

## Public contract

The public A2A surface is:

- `GET /.well-known/agent-card.json`
- Tenant-specific OAuth/OIDC metadata URLs are advertised in the Agent Card
  and external-client documentation.
- `POST /a2a/jsonrpc`

The Agent Card must advertise:

- the direct JSON-RPC interface and its public HTTPS URL;
- the OAuth 2.0 security scheme;
- the configured OAuth/OIDC metadata URL for each allowlisted tenant;
- the required A2A scope, `agent:invoke`;
- the supported `message/send` capability and current streaming/task limits.

The A2A JSON-RPC route accepts a standard `Authorization: Bearer` header for
federated customer access. The existing `txn-token` header remains a separate
Privilege compatibility credential and is not silently treated as a customer
OAuth bearer token.

## Federated trust model

Each deployment has an explicit tenant registry. A tenant record contains:

```json
{
  "tenant-a": {
    "issuer": "https://idp.customer-a.example",
    "jwks_uri": "https://idp.customer-a.example/.well-known/jwks.json",
    "audiences": ["langchain-agent"],
    "scopes": ["agent:invoke"]
  }
}
```

The implementation may use a file, environment-backed JSON, or secret-backed
configuration, but it must expose one validated configuration model and fail
closed on malformed or duplicate issuer records.

Validation order:

1. Parse the bearer token without treating unverified claims as identity.
2. Select the configured trust record by the token's `iss` claim.
3. Fetch/cache only that tenant's configured JWKS URI, with refresh on an
   unknown key id and bounded network timeouts.
4. Verify the signature, allowed algorithm, issuer, expiry, audience, and
   required `agent:invoke` scope.
5. Derive the caller identity from validated claims (`sub`, and an optional
   email/profile claim); never from request payload or headers.
6. Attach the tenant identifier and validated subject to the internal A2A
   request context.

Issuer matching is exact after normalizing only the explicitly permitted URI
form. The server must reject tokens whose issuer is not allowlisted, whose
JWKS host does not match its configured tenant record, whose audience is for a
different service, or whose scopes are insufficient.

This increment does not turn the existing PingOne/Privilege MCP gateway broker
into a general federation broker: that broker issues MCP/Privilege credentials
with a different audience and trust model. Customer applications obtain their
access token directly from their configured IdP using the tenant's documented
authorization-server metadata and then call LangChain. A future federation
broker may provide one stable discovery URL, but it is outside this change and
must issue a LangChain-specific audience before it can be trusted here.

## Privilege compatibility

Privilege continues to call the same direct A2A service using its existing
transaction token. The service keeps the current cryptographic validation
requirements for that path, including PingOne issuer/signature/expiry,
`PingOne Agent Gateway` audience, and required `client_id`.

The two authentication branches converge only after validation into a common
internal caller context:

- federated bearer: tenant, subject, optional email, scopes, token source;
- Privilege transaction token: Privilege client id, validated claims, token
  source, and the existing gateway identity semantics.

The agent must not infer an end-user identity from a Privilege workload token.
The compatibility branch must remain explicitly identifiable in audit data and
must not broaden the federated issuer allowlist.

## A2A request behavior

`message/send` retains the existing JSON-RPC shape and text-only behavior.
Successful calls use the validated caller context to partition conversations.
Authentication failures return an HTTP 401 with a standard bearer challenge;
scope failures return HTTP 403 with an actionable error. Invalid JSON-RPC
requests continue to use the existing JSON-RPC error conventions.

The service must not echo access tokens, transaction tokens, raw JWT claims, or
secret-bearing upstream errors in responses or logs. Existing agent execution
errors remain normalized to the current A2A error response.

## Kubernetes and deployment

Expose the LangChain service through a dedicated HTTPS host or an explicitly
scoped ingress path. The public route set must include only the Agent Card,
OAuth discovery/broker routes, and A2A JSON-RPC. Configure:

- the public A2A base URL used by the Agent Card;
- trusted tenant registry data through the approved secret/config channel;
- the internal agent audience and required scope;
- long-lived proxy timeouts appropriate for JSON-RPC execution;
- no public route to health, status, metrics, inspector, or internal MCP
  endpoints.

The ingress contract must be tested from rendered Kubernetes configuration,
not inferred from comments. Existing Privilege routing must continue to reach
the same A2A route and Agent Card URL.

## Testing and acceptance

Add focused tests covering:

1. Agent Card advertises the direct URL and OAuth security metadata.
2. OAuth discovery advertises the configured broker endpoints and scopes.
3. A valid token from tenant A succeeds.
4. A valid token from tenant B succeeds with a separate JWKS cache.
5. Unknown issuers, wrong audiences, missing scopes, expired tokens, bad
   signatures, and malformed tenant configuration fail closed.
6. A tenant header or JSON-RPC identity field cannot override token identity.
7. JWKS refresh is bounded and cannot fetch an unconfigured host.
8. Privilege `txn-token` requests still succeed through the compatibility
   branch and forged/expired/wrong-audience transaction tokens still fail.
9. Tokens and raw claims do not appear in response bodies or logs.
10. Kubernetes route checks expose only the intended public paths and preserve
    Privilege access.
11. A direct A2A client can fetch the card, obtain/attach OAuth credentials,
    send `message/send`, and receive a normal response.

Verification must include the LangChain focused pytest suite and the relevant
Kubernetes/topology checks. A live cluster probe is optional and should be run
only after local rendered-manifest and service tests pass.

## Operational decisions

- The trust registry is deployment configuration, not runtime client input.
- The default posture is deny-all until at least one tenant is configured.
- JWKS and discovery responses are cached with bounded freshness and explicit
  refresh behavior.
- Tenant and subject identifiers may be logged as non-secret audit metadata;
  access tokens, authorization codes, and raw claims may not be logged.
- Privilege remains a compatibility integration, not a second customer-IdP
  federation mechanism.
