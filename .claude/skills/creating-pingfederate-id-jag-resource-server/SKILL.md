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
2. Before a service edit, read the repository-root `CLAUDE.md`, the nearest
   service `CLAUDE.md`, and `REGRESSION_PLAN.md` sections 0–1. Before editing
   OAuth, token exchange, sessions, authorization, or `demo_api_ui/`, invoke
   `regression-guard`; it does not replace the regression plan.
3. When current PingFederate product behavior needs confirmation, start at
   <https://docs.pingidentity.com/llms.txt> and follow its product-specific
   documentation. Do not infer current provider behavior from old examples.
4. Trace the actual hop. The BFF is the browser-token custodian. PingFederate
   issues the raw ID-JAG to the redemption path, `oauth-mcp` validates it and
   mints an access token, and the gateway may validate, exchange, or forward a
   token depending on the route. The resource server validates the token it
   actually receives for its own hop.
5. Configure audiences independently. `MCP_SERVER_RESOURCE_URI` is the banking
   MCP server setting used by `oauth-mcp`; `MCP_RESOURCE_SERVER_RESOURCE_URI`
   belongs to `demo_mcp_resource_server`. Do not copy one setting into the
   other without confirming the route and accepted audience list.
6. Configure each verifier with the exact issuer string and JWKS for its input
   token. An issuer-string mismatch is a validation failure. Do not infer that
   the gateway and backend use one issuer or one JWKS endpoint.
7. Keep signature, issuer, audience, expiry, not-before, issued-at, delegation,
   and scope checks fail-closed. A missing trust anchor or failed exchange must
   reject the request; do not introduce a mock-token fallback.
8. Never log, return, paste into evidence, or otherwise expose a raw assertion,
   access token, or secret. Use redacted identifiers and failure codes in
   diagnostics.
9. Review the relevant layer before changing it:
   - For raw assertion redemption, read
     [ID-JAG redemption](references/id-jag-redemption.md).
   - For gateway and backend verification, read
     [downstream validation](references/downstream-validation.md).
10. When resource IDs, scopes, or routes change, run the affected service's
    scoped build and tests plus `npm run topology:verify`. This documentation
    authoring task changes no runtime behavior, so keep it test-free unless a
    later task changes a service.

## Delivery checklist

- State the issuer, JWKS URI, accepted audience, and scopes for every hop.
- State whether the gateway performs RFC 8693 exchange or forwards a token.
- Confirm that the backend's verifier accepts the issuer and JWKS of the token
  delivered to that backend.
- Preserve BFF-only browser-token custody and server-to-server token handling.
- Keep production validation cryptographic and fail-closed.
- Keep assertions, access tokens, and secrets out of logs, responses, and
  execution evidence.

See [README.md](README.md) for invocation and request format.
