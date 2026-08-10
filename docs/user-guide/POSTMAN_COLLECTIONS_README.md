# Postman Collections - Super Banking Demo

Postman collections and environments for testing the Super Banking demo application. The files referenced below live in [`docs/`](../) (relative to this file: `../<filename>`); further collections live in [`postman/`](../../postman/) (`../../postman/<filename>`).

## Environment Files

### Localhost Development
- **`Super-Banking-Shared.postman_environment.json`** - Main shared environment with localhost defaults
  - `BANKING_API_BASE_URL` = `http://localhost:3001`
  - `MCP_SERVER_URL` = `http://localhost:8080`
  - Includes Vercel-specific variables for easy switching
  - Total: 21 variables

### Vercel Deployment (example / legacy)
> Vercel is **not** the current deploy path. This environment and the `-Vercel` collections are kept as examples only; the URLs below are illustrative placeholders.
- **`Super-Banking-Vercel.postman_environment.json`** - example Vercel environment
  - `BANKING_API_BASE_URL` = `https://banking-demo-puce.vercel.app` (example/legacy URL)
  - `MCP_SERVER_URL` = `https://banking-mcp-server.vercel.app` (example/legacy URL)

## Collections

### Core Token Exchange Collections
- **`Super-Banking-1-Exchange-Step-by-Step.postman_collection.json`** - Single RFC 8693 exchange flow, broken into individual steps (learner/workshop)
- **`Super Banking — 1-Exchange Delegated Chain — pi.flow.postman_collection.json`** - 1-exchange with pi.flow
- **`Super Banking — 2-Exchange Delegated Chain — pi.flow.postman_collection.json`** - Chained RFC 8693 exchanges
- **`Super-Banking-Advanced-Utilities.postman_collection.json`** - PAZ policy decisions and token revocation

### MCP & BFF API Collections
- **`Super-Banking-MCP-Tools.postman_collection.json`** - Direct MCP server HTTP endpoints
- **`Super-Banking-MCP-Tools-Vercel.postman_collection.json`** - Same, but uses Vercel URLs by default
- **`Super-Banking-BFF-API.postman_collection.json`** - BFF API endpoints (audit, exchange-mode, RFC 9728, inspector)
- **`Super-Banking-BFF-API-Vercel.postman_collection.json`** - Same, but uses Vercel URLs by default

### Reference Collections
- **`AI-IAM-CORE Webinar.postman_collection.json`** - Webinar reference collection

### Additional Collections (in `postman/`)
These live in [`postman/`](../../postman/), not `docs/`:
- **`../../postman/PingOne Authorization Code — pi.flow.postman_collection.json`** - Standalone PingOne Authorization Code (PKCE) flow via pi.flow
- **`../../postman/The-AI-Demo-PingOne-Test.postman_collection.json`** - PingOne connectivity / smoke-test requests
- **`../../postman/Privilege-MCP-Gateway.postman_collection.json`** - Privilege MCP gateway, with its own `-environment` file
- **`../../postman/Privilege-MCP-Simple.postman_collection.json`** - Minimal Privilege MCP relay path, with its own `-environment` file
- **`../../postman/Privilege-MCP-Debug.postman_collection.json`** - Ordered probes that separate the two Privilege MCP failure modes: a Host/routing miss (empty `200`, `Domain not found`) versus an auth or policy denial (`401`, `403`). Requests 2 and 3 are a matched pair — same URL, Host header the only difference. Variables are inline; no environment file needed

## Usage

### Local Development
1. Import `Super-Banking-Shared.postman_environment.json` into Postman
2. Set your PingOne credentials and environment variables
3. Use the standard collections (localhost URLs)

### Vercel Testing
1. Import `Super-Banking-Vercel.postman_environment.json` into Postman
2. Set your PingOne credentials (same as localhost)
3. Use the `-Vercel` suffixed collections for direct Vercel URLs
4. Or use standard collections with the Vercel environment active

### Variable Reference
- `BANKING_API_BASE_URL` / `BANKING_API_BASE_URL_VERCEL` - BFF server URL
- `MCP_SERVER_URL` / `MCP_SERVER_URL_VERCEL` - MCP server URL
- `PINGONE_ENVIRONMENT_ID` - PingOne environment UUID
- `PINGONE_CORE_USER_CLIENT_ID` - End-user OAuth client ID
- `PINGONE_CORE_CLIENT_ID` - BFF/admin OAuth client ID
- `MCP_CLIENT_ID` - MCP service OAuth client ID
- `ENDUSER_AUDIENCE` - AI agent resource URI
- `MCP_RESOURCE_URI` - MCP server resource URI
- `BANKING_SENSITIVE_SCOPE` - `sensitive:read`

## Environment Switching

You can switch between localhost and Vercel by:

1. **Method 1: Environment Switching**
   - Import both environment files
   - Switch between "Super Banking — Shared" and "Super Banking — Vercel" environments
   - Use the same collections (they'll pick up the active environment)

2. **Method 2: Collection Switching**
   - Use the standard collections with localhost environment
   - Use the `-Vercel` collections with any environment
   - Collections have hardcoded URL variables for their target deployment

## BFF Endpoint Coverage

The BFF API collections cover:

- `/api/mcp/audit` - BFF proxy to MCP audit events
- `/api/mcp/exchange-mode` - Get/set token exchange mode
- `/api/rfc9728` - RFC 9728 protected resource metadata
- `/api/mcp/inspector/invoke` - MCP tool invocation via BFF
