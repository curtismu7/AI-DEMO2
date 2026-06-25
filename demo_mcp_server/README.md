# Banking MCP Server

A TypeScript-based Model Context Protocol (MCP) server for banking operations with PingOne AI IAM Core authentication.

## Features

- Secure authentication and session management with PingOne AIC
- Banking operations (balance inquiry, transfers, transaction history)
- MCP protocol compliance with WebSocket support
- TypeScript type safety and comprehensive testing
- Dual-token authentication (agent + user tokens)
- PKCE-enhanced OAuth 2.0 authorization code flow

## Prerequisites

- Node.js 20.x or higher
- npm 9.x or higher
- PingOne AI IAM Core account with OAuth clients configured
- Banking API server running

> **📋 OAuth Setup Required**: You need to configure OAuth clients in PingOne AI IAM Core before running the server. See [PingOne OAuth Setup Guide](./docs/pingone-oauth-setup.md) for detailed configuration instructions.

## Development

### Setup

```bash
npm install
```

### Development Mode

```bash
npm run start:dev
```

### Build

```bash
npm run build
```

### Testing

```bash
npm test
npm run test:watch
```

### Linting

```bash
npm run lint
npm run lint:fix
```

## Project Structure

```
src/
├── config/           # Configuration management
├── interfaces/       # Core interfaces for MCP, auth, and banking
├── types/           # Type definitions
└── index.ts         # Main entry point

tests/
├── config/          # Configuration tests
└── types/           # Type tests
```

## Core Interfaces

### MCP Protocol (`src/interfaces/mcp.ts`)
- MCPMessage, MCPResponse, MCPError
- HandshakeMessage, ListToolsMessage, ToolCallMessage
- ToolDefinition, ToolResult, JSONSchema

### Authentication (`src/interfaces/auth.ts`)
- AgentTokenInfo, UserTokens, Session
- PingOne configuration and token management
- AuthenticationError with error codes

### Banking (`src/interfaces/banking.ts`)
- Account, Transaction, TransactionRequest/Response
- Banking API client configuration
- BankingAPIError handling

### Configuration (`src/interfaces/config.ts`)
- BankingMCPServerConfig for complete server setup
- Environment variable definitions
- Default configuration values

## Configuration

Copy `.env.example` to `.env` and configure the required environment variables:

- **PingOne Configuration**: Authentication endpoints and credentials
- **Banking API Configuration**: Banking API server connection settings  
- **Security Configuration**: Encryption keys and token storage
- **Server Configuration**: Host, port, and connection limits


## AI Client Setup

Connect your AI client to the Super Banking MCP server for tool-assisted banking demos.

### Prerequisites
1. Start the banking demo stack: `./run-demo.sh` or `npm run start` in `banking_api_server/`
2. Start the MCP server: `npm run start` in `banking_mcp_server/`
3. The MCP server runs at `http://localhost:8080` by default.

### Server Discovery

Before connecting your AI client manually, you can inspect the server's published tool surface via the
well-known discovery endpoint:

```bash
curl http://localhost:8080/.well-known/mcp-server
```

The response lists all tools and groups them by access tier:

```json
{
  "publicAccess": {
    "readOnlyTools": [
      "get_my_accounts",
      "get_account_balance",
      "get_my_transactions",
      "sequential_think"
    ]
  },
  "restrictedAccess": {
    "authenticatedTools": [
      "get_sensitive_account_details",
      "create_deposit",
      "create_withdrawal",
      "create_transfer",
      "query_user_by_email"
    ]
  }
}
```

**Read-only tools** can be called without write scopes — useful for external agents that need to inspect
account state before requesting elevated permissions. **Restricted tools** require full OAuth authentication
and appropriate scopes.

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "bx-finance-banking": {
      "url": "http://localhost:8080/mcp",
      "transport": "http"
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your project root:
```json
{
  "mcpServers": {
    "bx-finance-banking": {
      "url": "http://localhost:8080/mcp",
      "transport": "http"
    }
  }
}
```

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:
```json
{
  "mcpServers": {
    "bx-finance-banking": {
      "serverUrl": "http://localhost:8080/mcp"
    }
  }
}
```

### Verify Connection

After adding the config, restart your AI client. The following tools should appear:
- `get_my_accounts` — list bank accounts
- `get_account_balance` — balance for a specific account
- `get_my_transactions` — transaction history
- `sequential_think` — step-by-step reasoning for complex decisions

> **Note:** Banking tools require OAuth authentication. The AI client will be prompted
> to authenticate via PingOne when it first calls a banking tool.
> See `/.well-known/mcp-server` on the running MCP server for the full tool list and auth info.


## Vercel Deployment (HTTP Streamable Transport)

The MCP server's HTTP Streamable transport can be deployed as a Vercel serverless function.
WebSocket transport is **not** supported on Vercel (stateless runtime).

### Endpoints Available on Vercel

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/mcp` | POST | MCP JSON-RPC endpoint (HTTP Streamable) |
| `/mcp` | DELETE | Session termination |
| `/.well-known/oauth-protected-resource` | GET | RFC 9728 metadata |
| `/.well-known/mcp-server` | GET | Public MCP discovery manifest |
| `/mcp/health` | GET | Health check |

### How It Works

1. `vercel.json` routes `/mcp` and `/.well-known/*` to `api/mcp-handler.js`
2. The handler initializes the MCP server's HTTP transport on cold start
3. Each request is handled statelessly (no WebSocket, no long-lived connections)
4. Sessions use the MCP-Session-Id header for continuity between requests

### Required Environment Variables (Vercel Dashboard)

```
PINGONE_BASE_URL=https://auth.pingone.com/{envId}/as
PINGONE_CLIENT_ID=your-client-id
PINGONE_CLIENT_SECRET=your-client-secret
PINGONE_INTROSPECTION_ENDPOINT=https://auth.pingone.com/{envId}/as/introspect
PINGONE_AUTHORIZATION_ENDPOINT=https://auth.pingone.com/{envId}/as/authorize
PINGONE_TOKEN_ENDPOINT=https://auth.pingone.com/{envId}/as/token
BANKING_API_BASE_URL=https://bxfinance-demo.vercel.app/api
MCP_RESOURCE_URL=https://bxfinance-demo.vercel.app
MCP_ALLOWED_ORIGINS=https://bxfinance-demo.vercel.app
ENCRYPTION_KEY=your-32-char-encryption-key
```

### Connecting External Clients

For Claude Desktop or other MCP clients, use the HTTP Streamable transport URL:

```json
{
  "mcpServers": {
    "banking": {
      "url": "https://bxfinance-demo.vercel.app/mcp",
      "transport": "streamable-http"
    }
  }
}
```

### Limitations

- **No WebSocket support** — Vercel serverless functions are request/response only
- **Cold start latency** — First request after idle ~2-5 seconds (MCP server initialization)
- **30-second timeout** — Vercel Pro Plan maximum function duration
- **Ephemeral sessions** — In-memory sessions don't persist across cold starts (use MCP-Session-Id header for continuity)

## License

MIT