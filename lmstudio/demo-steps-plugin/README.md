# AI-DEMO2 LM Studio workflow plugin

This LM Studio plugin adds a per-chat workflow dropdown covering the 14 core
Demo Steps, two Local model paths, three Handoff paths, and four OpenSearch use
cases. It injects the selected workflow as
context before each user message. Ordinary workflows expose no helper tools, so
the model calls the selected MCP tool directly without setup loops.

The default `Fast demo` response mode limits narration to three short sentences
and rejects raw XML/JSON tool-call markup. `Guided demo` adds a brief route
explanation for presentations.

Handoff paths expose a `route_demo_request` coordinator only while a handoff
workflow is selected. It deterministically chooses the next workflow and
returns the exact MCP tools to use; the model then calls that MCP tool in the
same chat. This provides the useful behavior of a handoff without requiring
LM Studio's plugin API to create LibreChat-style agent-to-agent graph edges.

For handoff workflows, enable the MCP integrations that contain the destination
tools (normally `MCP AgentGateway-Banking`) in the chat MCP picker.

The plugin does not replace the authenticated MCP servers. Select the matching
server from `lmstudio/mcp.json` in the chat MCP picker; the plugin supplies the
workflow context and the preset supplies the system prompt. LM Studio's API
supports `allowed_tools` for programmatic requests, but the desktop plugin API
does not currently let a tool provider change another MCP integration's tool
allowlist.

## Install locally

From this directory:

```bash
npm install
npm run install-plugin
```

LM Studio plugins are currently beta. `lms dev --install` installs the local
plugin; `lms dev` runs it in reloadable development mode.
