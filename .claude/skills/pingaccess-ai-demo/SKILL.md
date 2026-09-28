---
name: pingaccess-ai-demo
description: Use when integrating or troubleshooting PingAccess as a web or API access enforcement layer, or when distinguishing it from PingGateway in AI-DEMO2.
---

# PingAccess integration

PingAccess and PingGateway (Ping Identity Gateway / IG) are separate products with different configuration models. AI-DEMO2's Agent Gateway path is PingGateway; it does not imply a PingAccess deployment exists.

## Workflow

1. Start at `https://docs.pingidentity.com/llms.txt`, follow the PingAccess docset, and select documentation matching the deployed release and deployment model. Verify product names, endpoints, APIs, and configuration syntax against that version.
2. Map the protected resource and traffic path before editing: client, edge/load balancer, PingAccess, policy/identity provider, and backend. Decide whether the requirement is a web application, API, or an upstream service integration.
3. Define the trust contract: issuer and keys, token type, audience, required claims/scopes, client authentication, session behavior, and what identity headers (if any) the backend may trust. Strip caller-supplied identity headers at the trusted edge and set them only after validation.
4. Configure the narrowest applicable application/resource and policy. Keep authentication and authorization decisions explicit; do not turn an unavailable policy service into an allow. Preserve TLS verification and least privilege for administrative/API credentials.
5. Keep environment-specific hosts, secrets, certificates, and policy identifiers out of source control. Use a disposable or non-production environment to validate policy changes before rollout.
6. Verify allowed and denied requests, expired/wrong-audience tokens, missing claims, backend failure, and policy-service outage. Inspect PingAccess and backend logs without recording bearer tokens or personal data.

## AI-DEMO2 boundary

For an AI-DEMO2 MCP route, inspect `ping-gateway/` and `demo_mcp_gateway/` first. Do not translate PingGateway route JSON or Groovy filters into PingAccess configuration by analogy. If a separate PingAccess demo is requested, add it as a separately named component and document its own traffic path and operational checks.
