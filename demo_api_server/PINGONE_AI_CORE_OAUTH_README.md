# PingOne Core OAuth Integration with MCP

This guide explains how to configure and use PingOne AI IAM Core as the OAuth provider for the MCP server and client.

## 🔐 Overview

The MCP server and client have been modified to use PingOne Core instead of the demo OAuth server. This provides enterprise-grade authentication and authorization capabilities.

## 🚀 Quick Setup

### 1. Run the Setup Script

```bash
./setup-pingone_ai_core-env.sh
```

This interactive script will:
- Prompt for your PingOne Core tenant name, client ID, and client secret
- Create a `.env` file with your configuration
- Display the PingOne Core OAuth endpoints
- Show you what to configure in your PingOne Core tenant

### 2. Configure PingOne Core Tenant

In your PingOne Core tenant, create an OAuth client with these settings:

- **Client ID**: (the one you provided in setup)
- **Redirect URI**: `http://localhost:8090/callback`
- **Grant Types**: `authorization_code`, `refresh_token`
- **Response Types**: `code`
- **Token Endpoint Auth Method**: `client_secret_post`
- **Scopes**: `mcp:tools openid profile email`

### 3. Run the MCP Server with PingOne Core OAuth

```bash
source .env && npx tsx src/examples/server/simpleStreamableHttp.ts --oauth
```

### 4. Run the MCP Client with PingOne Core OAuth

```bash
source .env && npx tsx src/examples/client/simpleOAuthClient.ts
```

## 🔧 Manual Configuration

If you prefer to configure manually, create a `.env` file with:

```bash
# PingOne Core OAuth Configuration
PINGONE_CORE_TENANT_NAME=your-tenant-name
PINGONE_CORE_CLIENT_ID=your-client-id
PINGONE_CORE_CLIENT_SECRET=your-client-secret

# MCP Server Configuration
MCP_SERVER_URL=http://localhost:3000/mcp
```

## 🌐 PingOne Core OAuth Endpoints

The following endpoints will be used automatically:

- **Authorization**: `https://openam-{tenant}.forgeblocks.com/am/oauth2/realms/root/realms/alpha/authorize`
- **Token**: `https://openam-{tenant}.forgeblocks.com/am/oauth2/realms/root/realms/alpha/access_token`
- **Registration**: `https://openam-{tenant}.forgeblocks.com/am/oauth2/realms/root/realms/alpha/connect/register`
- **User Info**: `https://openam-{tenant}.forgeblocks.com/am/oauth2/realms/root/realms/alpha/userinfo`

## 🔄 OAuth Flow

1. **Client Initialization**: MCP client connects to server
2. **OAuth Discovery**: Server returns PingOne Core issuer in `serverInfo.auth`
3. **Dynamic Client Registration**: Client registers with PingOne Core
4. **Authorization**: Browser opens PingOne Core login page
5. **Callback**: User authorizes, returns to client
6. **Token Exchange**: Client exchanges code for access token
7. **Authenticated Requests**: Client uses token for MCP requests

## 🛠️ Troubleshooting

### Common Issues

1. **"Please set PINGONE_CORE_TENANT_NAME environment variable"**
   - Run `./setup-pingone_ai_core-env.sh` or set the environment variable manually

2. **"OAuth authorization failed"**
   - Check that your PingOne Core client is configured correctly
   - Verify redirect URI matches exactly: `http://localhost:8090/callback`
   - Ensure scopes include `mcp:tools openid profile email`

3. **"Connection refused"**
   - Make sure the MCP server is running with `--oauth` flag
   - Check that port 3000 is available

4. **"Invalid client"**
   - Verify client ID and secret in `.env` file
   - Check that client is active in PingOne Core tenant

### Debug Mode

To see detailed OAuth flow logs, the server includes comprehensive debug logging that shows:
- All HTTP requests and responses
- OAuth redirect URLs
- Token exchange details
- Authentication headers

## 🔒 Security Considerations

- Store client secrets securely (use environment variables)
- Use HTTPS in production
- Implement proper token storage and refresh logic
- Consider implementing PKCE for additional security
- Regularly rotate client secrets

## 📋 Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PINGONE_CORE_TENANT_NAME` | Your PingOne Core tenant name | Yes |
| `PINGONE_CORE_CLIENT_ID` | OAuth client ID from PingOne Core | Yes |
| `PINGONE_CORE_CLIENT_SECRET` | OAuth client secret from PingOne Core | Yes |
| `MCP_SERVER_URL` | MCP server URL | No (defaults to localhost:3000) |

## 🎯 Example Usage

```bash
# 1. Setup configuration
./setup-pingone_ai_core-env.sh

# 2. Start server (in one terminal)
source .env && npx tsx src/examples/server/simpleStreamableHttp.ts --oauth

# 3. Start client (in another terminal)
source .env && npx tsx src/examples/client/simpleOAuthClient.ts

# 4. Follow the OAuth flow in your browser
# 5. Use the interactive client to call MCP tools
```

## 🔗 Related Files

- `src/examples/server/simpleStreamableHttp.ts` - MCP server with PingOne Core OAuth
- `src/examples/client/simpleOAuthClient.ts` - MCP client with PingOne Core OAuth
- `setup-pingone_ai_core-env.sh` - Configuration setup script
- `.env` - Environment configuration (created by setup script)

