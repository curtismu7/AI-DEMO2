# MCP Demo Client for Privilige

Chat-first local MCP demo client for protected MCP demos behind a PingOne Privilege gateway.

## Features

- Claude-style chat UI for protected MCP exploration
- OAuth 2.0 PKCE login with local callback
- Auto-discovers MCP tools in real time (5-second refresh)
- Local LLM tool routing via Ollama
- Raw MCP RPC and direct tool call inspector
- Clear 401/502/OAuth error messages for demos
- PingOne remote MCP OAuth auto-discovery fallback

## Run instantly

```bash
npm start
```

Then open: **http://127.0.0.1:33418**

## Register this OAuth callback

```
http://127.0.0.1:33418/auth/callback
```

## Requirements

- Node.js 18+
- Optional: Ollama at `http://127.0.0.1:11434` with model `llama3.2:1b`

## Setup

1. Set **MCP URL** = your Privilege gateway (e.g. `https://mcpgwtarun.ping-devops.com/mcp`)
2. Set **OAuth Client ID** = your app's client ID
3. Click **Sign In**
4. Ask anything in chat — the LLM picks and explains the right tools

## LLM

| Setting | Default |
|---|---|
| LLM URL | `http://127.0.0.1:11434` |
| LLM Model | `llama3.2:1b` |

Falls back to showing all discovered tools if LLM is unavailable.

## PingOne remote MCP pattern

If protecting `https://api.pingone.com/v1/environments/<envId>/mcp`:
- Gateway backend → that URL
- Client MCP URL → `https://<gateway>/mcp`

## Files

| File | Purpose |
|---|---|
| `server.js` | OAuth, MCP relay, chat, LLM routing |
| `public/index.html` | UI layout |
| `public/app.js` | Chat, auto-refresh, tool rendering |
| `public/styles.css` | Dark chat-first theme |
| `SKILLS.md` | Fast deployment guide for AI tools |
