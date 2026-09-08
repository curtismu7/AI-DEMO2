# MCP Inspector

A local, no-login tool for listing and calling tools on any [MCP](https://modelcontextprotocol.io) server — Streamable HTTP or stdio — plus the non-`tools/call` protocol methods (Resources, Prompts, Completion, Logging), and an optional tab for PingOne's hosted MCP server.

No account, no cloud service: it runs on your machine, talks directly to the MCP server(s) you point it at, and stores its config in `~/.mcp-inspector/`.

## Installation

**Prerequisites:** Node.js 22+ and npm. Docker is optional (a `Dockerfile` is included).

```bash
git clone https://github.com/curtismu7/mcp-inspector.git
cd mcp-inspector
npm run install:all   # installs both server/ and web/
npm start              # builds the UI, then starts the server on :3900
```

Verify it's up:

```bash
curl http://127.0.0.1:3900/health
```

Then open http://127.0.0.1:3900, click **+ Add server**, and point it at an MCP server:

- **HTTP** — a server URL (Streamable HTTP transport), plus an optional auth header/value if it needs one.
- **stdio** — a local command, e.g. `npx` with args `-y @modelcontextprotocol/server-everything stdio`.

Then pick a tool on the left, fill in its parameters, and click **Execute**.

## Development

```bash
npm run install:all
npm run dev   # server on :3900 (API), Vite dev server on :5173 (UI, proxies /api to :3900)
```

Open http://127.0.0.1:5173 while developing.

## Sources

- **Tools** — `tools/list` / `tools/call` against whichever server profile is selected.
- **Protocol** — the MCP methods that aren't `tools/call`: `resources/list`, `resources/read`, `resources/templates/list`, `prompts/list`, `prompts/get`, `completion/complete`, `logging/setLevel`. Also dispatched to the selected profile.
- **PingOne** — tools on PingOne's hosted MCP server (`mcp.pingone.<region>`), authenticated via your own browser sign-in (Authorization Code + PKCE — no client secret, no worker credentials). Defaults to the public Ping AI Demo's own PingOne environment/app, so it works with zero setup as long as you run on the default port (3900); point `PINGONE_ENVIRONMENT_ID`/`PINGONE_MCP_CLIENT_ID` at your own PingOne OIDC app (public client, PKCE required, this tool's callback URL registered as a redirect URI) to test that instead.

## Config

Copy `server/.env.example` to `server/.env` and fill in what you need. Nothing is required — Tools/Protocol work out of the box, and so does the PingOne tab as long as `PORT` stays 3900.

Saved server profiles (including any auth header/value or stdio command you add) are stored in `~/.mcp-inspector/profiles.json` on your machine — set `PROFILE_STORE_DIR` to change where.

## Docker

```bash
docker build -t mcp-inspector .
docker run -p 3900:3900 -v mcp-inspector-data:/root/.mcp-inspector mcp-inspector
```

## Notes

- This build ships **http** and **stdio** transports. `websocket` is accepted by the profile store's schema but not dispatched yet — add a transport under `server/lib/transports/` if you need it.
- Single-operator by design: PingOne sign-in and saved profiles are for one user on one machine, like a local dev tool (not a multi-tenant service).
