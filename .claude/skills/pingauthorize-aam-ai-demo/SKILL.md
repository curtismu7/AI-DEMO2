---
name: pingauthorize-aam-ai-demo
description: Use when configuring PingOne Authorize API Access Management (AAM), Sideband decisions, API services, operations, or the AAM route in AI-DEMO2's PingGateway integration.
---

# PingOne Authorize API Access Management (AAM)

AAM protects HTTP API operations using request context such as method and path. It is distinct from the PingOne Authorize decision-endpoint policy the demo uses to authorize MCP tools using tool names, arguments, delegated claims, and transaction attributes.

## AI-DEMO2 implementation

- The example route is `ping-gateway/config/routes/04-aam-api-access.json`.
- `PingAuthorizeFilter` sends the Sideband request to PingOne Authorize. The demo's `aam-sideband-capture.groovy` selects the real or mock backend and records safe decision evidence; the mock implements both `/sideband/request` and `/sideband/response`.
- `ff_aam` gates the demonstration `/aam` path. It does not change the `/mcp` decision-endpoint policy route.
- `GET /api/aam/probe` in the BFF exposes the demo result and audit trail.

## Workflow

1. Read `ping-gateway/README.md`'s AAM section, `docs/superpowers/specs/2026-07-27-aam-end-to-end-design.md`, and the current route, capture/trail scripts, BFF probe, and mock. Start at `https://docs.pingidentity.com/llms.txt`, then verify `PingAuthorizeFilter` and Sideband details against the PingGateway release deployed; the current project reference is the 2026.x guide.
2. Define the protected HTTP base URL and exact method/path operation, who may call it, which groups/scopes/permissions are evaluated, and whether the target backend can be reached without the gateway. Do not expect AAM to inspect MCP JSON-RPC tool names or arguments.
3. For PingOne setup, follow the current Management API schema for the dependency order: group/policy inputs, gateway and credential, resource, API service, operation/access control, then deployment. Keep newly returned credentials out of logs and source. The repo README records its verified example sequence; re-check API schemas before adapting it.
4. Keep the mock and real Sideband request/response shapes aligned. Sideband has a request leg and a response leg; a mock implementing only the decision request can make permits fail after the policy decision. Preserve the `ff_aam` boundary and do not replace the existing `/mcp` decision route.
5. Test permitted and denied HTTP requests, unmatched paths, missing/invalid gateway credentials, disabled flag, real/mock selection, Sideband response handling, and audit redaction. Check `npm run authz:verify` and relevant PingGateway/mock tests when integration code changes.
6. Provision or deploy live PingOne AAM resources only when the user requested that operation. Read the exact provisioning script or Management API calls first and verify the target environment.

## Official reference

Start from `https://docs.pingidentity.com/llms.txt`; the current PingGateway overview is [PingOne Authorize integration with PingGateway](https://docs.pingidentity.com/pinggateway/2026/pingone/aam.html). Confirm the release and follow its linked Sideband/API Service references rather than copying sample IDs or URLs.
