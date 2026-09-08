# MCP Toolkit

Installs and runs three standalone tools together:

- [**llm-gateway**](https://github.com/curtismu7/llm-gateway) — smart routing proxy for local LLMs (:8090)
- [**mcp-inspector**](https://github.com/curtismu7/mcp-inspector) — local, no-login MCP tool tester (:3900)
- [**ai-gateway-client**](https://github.com/curtismu7/ai-gateway-client) — OAuth PKCE + DCR test client for an OAuth-protected MCP gateway (:3910)

This repo doesn't contain their source — it clones/builds the three repos above. Each is independently maintained; see its own README for what it does and how to configure it.

## Option 1: Docker (fastest, no Node needed)

```bash
git clone https://github.com/curtismu7/mcp-toolkit.git
cd mcp-toolkit
docker compose up -d --build
```

Builds all three straight from their GitHub repos (`docker-compose.yml`'s `build.context` is a git URL — no local clone of the three repos involved). Then:

- llm-gateway: http://127.0.0.1:8090
- mcp-inspector: http://127.0.0.1:3900
- ai-gateway-client: http://127.0.0.1:3910

Stop with `docker compose down`. Saved config/profiles for mcp-inspector and ai-gateway-client persist in named Docker volumes across restarts.

## Option 2: Local (clone + npm, no Docker)

**Prerequisites:** Node.js 22+, npm, git.

```bash
git clone https://github.com/curtismu7/mcp-toolkit.git
cd mcp-toolkit
npm run install:all   # clones the three repos into repos/, installs each
npm start              # starts all three in the background
```

`npm start` logs to `logs/<tool>.log` and tracks PIDs in `.pids/`. Stop everything with:

```bash
npm run stop
```

To update later, re-run `npm run install:all` — it `git pull`s each repo instead of re-cloning.

## Notes

- Each tool works completely on its own — clone just the one you want if you don't need all three.
- All three default to Ping's public AI Demo infrastructure (Privilege AI Gateway, its façade, and its PingOne environment) so everything works with zero configuration; each tool's own README explains how to point it at your own environment instead.
