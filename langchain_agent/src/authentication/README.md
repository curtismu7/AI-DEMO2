# OAuth Authentication Manager

This module provides OAuth authentication capabilities for the LangChain MCP OAuth Agent, specifically designed to work with PingOne AI IAM Core (ForgeRock).

## Architecture Overview

The authentication system is designed around two main flows:

1. **Agent Authentication** - Using OAuth client credentials flow for the AI agent to authenticate with MCP servers
2. **User Authorization Facilitation** - Helping users authorize MCP servers to access their resources

## Key Components

### 1. DynamicClientRegistration

Handles dynamic client registration with ForgeRock:
- Registers OAuth clients with proper ForgeRock endpoints
- Handles client credential storage and expiration
- Implements retry logic for transient failures

### 2. TokenManager

Manages agent access tokens:
- Acquires tokens using client credentials flow
- Implements automatic token refresh with configurable buffer time
- Caches tokens to avoid unnecessary API calls
- Handles token expiration and renewal

### 3. UserAuthorizationFacilitator

Facilitates user authorization between users and MCP servers:
- Generates authorization URLs when MCP servers request user authorization
- Handles OAuth redirect callbacks with state validation
- Prepares authorization codes for MCP servers
- **Does NOT exchange authorization codes for tokens** (MCP servers handle this)

### 4. OAuthAuthenticationManager

Comprehensive manager that combines all components:
- Single interface for all OAuth operations
- Manages agent authentication lifecycle
- Facilitates user authorization flows
- Provides proper async context management

## Key Design Decisions

### Simplified Authorization Code Flow

Unlike traditional OAuth implementations, this system does **not** exchange authorization codes for user tokens. Instead:

1. When an MCP server needs user authorization, it requests an authorization URL
2. The system generates the URL and redirects the user to ForgeRock
3. After user consent, ForgeRock redirects back with an authorization code
4. The system passes the authorization code to the requesting MCP server
5. **The MCP server exchanges the code for tokens directly with ForgeRock**

This approach:
- Keeps user tokens secure within MCP servers
- Reduces complexity in the agent
- Follows the principle of least privilege
- Aligns with the MCP protocol design

### ForgeRock Integration

The system is specifically designed for PingOne AI IAM Core (ForgeRock):
- Uses ForgeRock-specific endpoint patterns (`/am/oauth2/realms/{realm}/...`)
- Supports realm-based configuration
- Handles ForgeRock-specific response formats
- Implements proper retry logic for ForgeRock API characteristics

## Usage Examples

### Agent Authentication

```python
async with OAuthAuthenticationManager() as oauth_mgr:
    # Register client with ForgeRock
    credentials = await oauth_mgr.register_client()
    
    # Get agent access token
    agent_token = await oauth_mgr.get_client_credentials_token()
    
    # Use token in MCP server requests
    # Token will be automatically refreshed when needed
```

### User Authorization Facilitation

```python
async with OAuthAuthenticationManager() as oauth_mgr:
    await oauth_mgr.register_client()
    
    # When MCP server requests user authorization
    auth_url = oauth_mgr.generate_user_authorization_url(
        scope="openid profile",
        session_id="user-session-123",
        mcp_server_id="mcp-server-1"
    )
    
    # Redirect user to auth_url
    # After user consent, handle the callback
    auth_data = oauth_mgr.handle_user_authorization_callback(
        auth_code="received_auth_code",
        state="state_from_callback"
    )
    
    # Pass auth_data to the requesting MCP server
    # MCP server will exchange the code for user tokens
```

## Security Features

- **CSRF Protection**: Cryptographically secure state parameters
- **Token Encryption**: Support for encrypted token storage
- **Automatic Cleanup**: Expired states and tokens are automatically cleaned up
- **Retry Logic**: Robust error handling with exponential backoff
- **Secure Defaults**: Conservative token expiration buffers and timeouts

## Configuration

The system uses environment-based configuration:

```bash
# ForgeRock Configuration
PINGONE_BASE_URL=https://your-tenant.forgeblocks.com
PINGONE_CLIENT_REGISTRATION_ENDPOINT=https://your-tenant.forgeblocks.com/am/oauth2/realms/alpha/register
PINGONE_TOKEN_ENDPOINT=https://your-tenant.forgeblocks.com/am/oauth2/realms/alpha/access_token
PINGONE_AUTHORIZATION_ENDPOINT=https://your-tenant.forgeblocks.com/am/oauth2/realms/alpha/authorize
PINGONE_REDIRECT_URI=http://localhost:8080/auth/callback
PINGONE_REALM=alpha

# Security Configuration
TOKEN_EXPIRY_BUFFER_SECONDS=300
MAX_RETRY_ATTEMPTS=3
RETRY_BACKOFF_SECONDS=2
```

## Testing

The module includes comprehensive unit tests covering:
- Dynamic client registration with various response scenarios
- Token acquisition, caching, and refresh logic
- User authorization flow with state validation
- Error handling and retry mechanisms
- Integration scenarios with mocked ForgeRock responses

Run tests with:
```bash
python -m pytest tests/test_oauth_manager.py -v
```