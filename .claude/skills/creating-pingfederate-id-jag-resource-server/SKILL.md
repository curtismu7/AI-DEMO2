---
name: creating-pingfederate-id-jag-resource-server
description: Use when adding, configuring, reviewing, or troubleshooting a resource server that receives access tokens after PingFederate ID-JAG enterprise-managed MCP authorization.
---

# Creating a PingFederate ID-JAG Resource Server

Use this skill when an MCP resource server must participate in the existing
PingFederate ID-JAG flow. An ID-JAG is a one-time grant assertion for
`oauth-mcp`; it is never a bearer token sent to a resource server.

## Workflow

1. Collect the target resource URI, expected audience, required scopes, target
   resource server, and whether the request includes live PingFederate
   provisioning. Do not mutate PingFederate unless that is explicitly requested.
2. Trace the actual hop. The BFF is the browser-token custodian. PingFederate
   issues the raw ID-JAG to the redemption path, `oauth-mcp` validates it and
   mints an access token, and the gateway may validate, exchange, or forward a
   token depending on the route. The resource server validates the token it
   actually receives for its own hop.
3. Configure audiences independently. `MCP_SERVER_RESOURCE_URI` is the banking
   MCP server setting used by `oauth-mcp`; `MCP_RESOURCE_SERVER_RESOURCE_URI`
   belongs to `demo_mcp_resource_server`. Do not copy one setting into the
   other without confirming the route and accepted audience list.
4. Configure each verifier with the exact issuer string and JWKS for its input
   token. An issuer-string mismatch is a validation failure. Do not infer that
   the gateway and backend use one issuer or one JWKS endpoint.
5. Keep signature, issuer, audience, expiry, not-before, issued-at, delegation,
   and scope checks fail-closed. A missing trust anchor or failed exchange must
   reject the request; do not introduce a mock-token fallback.
6. Review the relevant layer before changing it:
   - For raw assertion redemption, read
     [ID-JAG redemption](references/id-jag-redemption.md).
   - For gateway and backend verification, read
     [downstream validation](references/downstream-validation.md).
7. Verify the exact token path with focused existing tests or an approved live
   environment only when the task asks for verification. Never use a resource
   server to validate the raw ID-JAG.

## Delivery checklist

- State the issuer, JWKS URI, accepted audience, and scopes for every hop.
- State whether the gateway performs RFC 8693 exchange or forwards a token.
- Confirm that the backend's verifier accepts the issuer and JWKS of the token
  delivered to that backend.
- Preserve BFF-only browser-token custody and server-to-server token handling.
- Keep production validation cryptographic and fail-closed.

See [README.md](README.md) for invocation and request format.
