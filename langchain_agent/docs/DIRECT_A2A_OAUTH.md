# Direct LangChain A2A access

The LangChain agent exposes a direct A2A JSON-RPC endpoint. A customer
application authenticates with its own pre-registered identity provider and
sends the resulting access token to LangChain. The agent's MCP credentials
remain server-side.

## Discover the Agent Card

Fetch the public card from the deployment's configured A2A host:

```bash
curl -fsS https://langchain-a2a.example.com/.well-known/agent-card.json
```

The card advertises the direct JSON-RPC URL, `customerOAuth`, the required
`agent:invoke` scope, and `x-tenantOAuthMetadata`, which lists the configured
customer OIDC metadata URLs.

## Register a customer tenant

An operator must add the customer IdP to `A2A_TENANT_REGISTRY_JSON` before a
token from that IdP will be accepted. The registry is keyed by an internal
tenant name and is matched by the token's validated `iss` claim:

```json
{
  "customer-a": {
    "issuer": "https://idp.customer-a.example",
    "jwks_uri": "https://idp.customer-a.example/.well-known/jwks.json",
    "metadata_url": "https://idp.customer-a.example/.well-known/openid-configuration",
    "audiences": ["langchain-agent"],
    "scopes": ["agent:invoke"]
  }
}
```

The issuer, JWKS URL, and metadata URL must use HTTPS. The server rejects
unknown issuers, wrong audiences, expired or invalid signatures, and missing
scopes. A tenant or identity supplied in a JSON-RPC body or custom header is
ignored.

The customer IdP application must issue a token containing:

- `iss`: the exact configured issuer;
- `sub`: the customer subject identifier;
- `aud`: one of the configured audience values;
- `scope`: including `agent:invoke`;
- `exp`: a valid future expiry.

## Call the agent

```bash
curl -fsS \
  -H "Authorization: Bearer ${CUSTOMER_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  https://langchain-a2a.example.com/a2a/jsonrpc \
  --data '{
    "jsonrpc": "2.0",
    "id": "request-1",
    "method": "message/send",
    "params": {
      "message": {
        "role": "user",
        "messageId": "message-1",
        "parts": [{"kind": "text", "text": "Summarize my account access"}]
      }
    }
  }'
```

The response is an A2A JSON-RPC `message/send` result. A missing or invalid
bearer token returns HTTP 401. A valid token without `agent:invoke` returns
HTTP 403. Tokens and raw claims are not returned in errors.

## Privilege compatibility

The existing PingOne Privilege integration continues to call the same A2A
JSON-RPC route with its `txn-token` header. That credential is validated by the
existing Privilege transaction-token validator and is separate from customer
bearer authentication. Do not replace it with a customer bearer token or add
the Privilege issuer to the customer tenant registry.

## Public and private routes

The public Kubernetes A2A ingress exposes only the Agent Card and `/a2a`.
Health, status, metrics, MCP inspection, AG-UI `/run`, and MCP server
connections remain internal. The existing MCP gateway OAuth broker is not a
multi-IdP federation broker and is not used for this direct A2A contract.
