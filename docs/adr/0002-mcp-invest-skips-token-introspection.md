# banking_mcp_invest skips token introspection that banking_mcp_server performs

`banking_mcp_server` (OLB tools, port 8080) calls PingOne's RFC 7662 introspection endpoint on every inbound token via `TokenIntrospector`. `banking_mcp_invest` (port 8081) deliberately does NOT — it only does local JWT decode + `exp` + `aud` claim validation. The investment server therefore accepts revoked-but-unexpired tokens for the brief window between revocation and token expiry, where the OLB server would catch and reject them.

**Status:** accepted

**Trade-off:** Investment tools are all read-only (`get_investment_accounts`, `get_investment_balance`, `get_portfolio_summary`, `get_investment_transactions`). The cost of brief over-trust on a read is low, and skipping introspection removes a per-call PingOne dependency that would dominate p99 latency and create a hard runtime dependency on PingOne availability. The MCP gateway already validates tokens upstream, so this is "trust the gateway's recent introspection result" rather than "skip validation entirely."

**Guardrail — do not extend this pattern:** If a write tool is ever added to `banking_mcp_invest`, introspection MUST be added back before the write tool ships. The decision is scoped to read-only tools. The skill at `.claude/skills/banking-mcp-invest/SKILL.md` repeats this warning.
