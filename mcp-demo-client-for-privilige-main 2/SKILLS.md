# SKILLS.md — MCP Demo Client for Privilige

AI-tool-friendly deployment guide. Follow this to get the demo running in under 2 minutes.

## Requirements

- Node.js 18+
- Optional: Ollama local LLM (`llama3.2:1b`)

## Deploy in 60 seconds

```bash
git clone https://github.com/tarunmadiraju/mcp-demo-client-for-privilige
cd mcp-demo-client-for-privilige
npm start
```

Open: `http://127.0.0.1:33418`

## Health check

```bash
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:33418
# Expected: 200
```

## What to configure in the UI

| Field | Value |
|---|---|
| MCP URL | Your Privilege gateway, e.g. `https://mcpgwtarun.ping-devops.com/mcp` |
| OAuth Client ID | Your app's client ID |
| Scopes | `openid profile email` (default) |
| LLM URL | `http://127.0.0.1:11434` (optional) |
| LLM Model | `llama3.2:1b` (optional) |

## Required redirect URI

Register this in your OAuth app:

```
http://127.0.0.1:33418/auth/callback
```

## PingOne remote MCP pattern

If upstream MCP is `https://api.pingone.com/v1/environments/<envId>/mcp`:
- Set gateway upstream → PingOne URL
- Set client MCP URL → gateway URL

## Optional: Install local LLM

```bash
brew install ollama
ollama pull llama3.2:1b
ollama serve
```

## Troubleshooting

| Error | Fix |
|---|---|
| `401 Unauthorized` | Check client ID and redirect URI in your OAuth app |
| `502 Bad Gateway` | Check gateway upstream and user policy access |
| `OAuth callback failed` | Exact redirect URI must be registered |
| No tools shown | Re-authenticate; check user admin roles |
| LLM fallback | Verify Ollama is running and model is downloaded |
