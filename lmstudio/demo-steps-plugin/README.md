# AI-DEMO2 LM Studio workflow plugin

This LM Studio plugin adds a per-chat workflow dropdown covering the 14 Demo
Steps and four OpenSearch use cases. It injects the selected workflow as
context before each user message; it does not expose a workflow-explanation
tool, so the model cannot loop on setup instructions.

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
