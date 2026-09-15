# AI-DEMO2 LM Studio workflow plugin

This LM Studio plugin adds a per-chat workflow dropdown covering the 14 Demo
Steps and four OpenSearch use cases. It exposes `show_demo_workflow`, which
returns the selected workflow's MCP server, focused tool list, and starters.

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
