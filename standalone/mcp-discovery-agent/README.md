# MCP Discovery Agent

Read-only local inventory agent for MCP candidates and unauthenticated HTTP
metadata probes. It is intended to feed the demo dashboard; it never invokes
MCP tools and does not accept credentials.

The agent will report host-process stdio candidates without attaching to their
stdin/stdout. HTTP-like MCP endpoints are verified with discovery/initialize and
`tools/list` only.
