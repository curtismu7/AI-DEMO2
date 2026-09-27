# Creating a PingFederate ID-JAG Resource Server

Use this repository skill when a resource server must receive access tokens
after the PingFederate ID-JAG enterprise-managed MCP flow, or when reviewing
the issuer, JWKS, audience, scope, and exchange boundaries for that path.

In Claude Code, invoke it with:

```text
/creating-pingfederate-id-jag-resource-server
```

Example request:

```text
Use /creating-pingfederate-id-jag-resource-server to add the invest resource
server path. Target resource URI: https://mcp-invest.ping.demo. Expected
audience: mcp-invest.ping.demo. Required scopes: investments:read. Do not
provision PingFederate live; document the required configuration and verify
the gateway-mediated token path.
```

For a live change, explicitly say that PingFederate provisioning is requested
and identify the authorized environment. The skill treats the raw ID-JAG as a
grant assertion redeemed by `oauth-mcp`; it does not send that assertion to a
resource server.
