# API Reference

This document provides a comprehensive reference for the LangChain MCP OAuth Agent APIs.

## Table of Contents

- [WebSocket API](#websocket-api)
- [HTTP Endpoints](#http-endpoints)
- [Configuration API](#configuration-api)
- [MCP Integration API](#mcp-integration-api)
- [Authentication API](#authentication-api)
- [Error Codes](#error-codes)

## WebSocket API

The primary interface for real-time chat communication.

### Connection

```javascript
const ws = new WebSocket('ws://localhost:8080/ws');
```

### Message Format

All WebSocket messages use JSON format:

```json
{
  "type": "message_type",
  "data": { ... },
  "session_id": "session_identifier",
  "timestamp": "2024-01-01T00:00:00Z"
}
```

### Message Types

#### User Message

Send a message from user to agent:

```json
{
  "type": "user_message",
  "data": {
    "content": "Hello, can you help me with something?",
    "metadata": {}
  },
  "session_id": "session_123"
}
```

#### Agent Response

Response from agent to user:

```json
{
  "type": "agent_response",
  "data": {
    "content": "Hello! I'd be happy to help you. What do you need assistance with?",
    "metadata": {
      "tools_used": [],
      "processing_time": 1.23
    }
  },
  "session_id": "session_123"
}
```

#### Authorization Request

When user authorization is required:

```json
{
  "type": "authorization_request",
  "data": {
    "authorization_url": "https://auth.example.com/oauth/authorize?...",
    "scope": "api:read api:write",
    "state": "random_state_value",
    "message": "Authorization required to access your GitHub repositories"
  },
  "session_id": "session_123"
}
```

#### Authorization Response

User provides authorization code:

```json
{
  "type": "authorization_response",
  "data": {
    "authorization_code": "auth_code_from_oauth_flow",
    "state": "random_state_value"
  },
  "session_id": "session_123"
}
```

#### Error Message

Error notifications:

```json
{
  "type": "error",
  "data": {
    "code": "AUTHENTICATION_FAILED",
    "message": "Failed to authenticate with external service",
    "details": "Token expired"
  },
  "session_id": "session_123"
}
```

#### Status Update

System status updates:

```json
{
  "type": "status",
  "data": {
    "status": "processing",
    "message": "Calling external API...",
    "progress": 0.5
  },
  "session_id": "session_123"
}
```

## HTTP Endpoints

### Health Check

Check application health:

```http
GET /health
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00Z",
  "version": "1.0.0"
}
```

### Detailed Status

Get detailed system status:

```http
GET /status
```

**Response:**
```json
{
  "status": "healthy",
  "components": {
    "database": "healthy",
    "oauth_provider": "healthy",
    "mcp_servers": {
      "github": "healthy",
      "slack": "degraded"
    }
  },
  "metrics": {
    "active_sessions": 5,
    "total_requests": 1234,
    "average_response_time": 0.85
  }
}
```

### Configuration

Get current configuration (non-sensitive):

```http
GET /config
```

**Response:**
```json
{
  "environment": "production",
  "debug": false,
  "log_level": "INFO",
  "features": {
    "mcp_integration": true,
    "oauth_flows": true
  }
}
```

### Session Management

#### Create Session

```http
POST /sessions
Content-Type: application/json

{
  "user_id": "optional_user_id",
  "metadata": {}
}
```

**Response:**
```json
{
  "session_id": "session_123",
  "created_at": "2024-01-01T00:00:00Z",
  "expires_at": "2024-01-01T01:00:00Z"
}
```

#### Get Session

```http
GET /sessions/{session_id}
```

**Response:**
```json
{
  "session_id": "session_123",
  "user_id": "user_456",
  "created_at": "2024-01-01T00:00:00Z",
  "last_activity": "2024-01-01T00:30:00Z",
  "status": "active"
}
```

#### Delete Session

```http
DELETE /sessions/{session_id}
```

**Response:**
```json
{
  "message": "Session deleted successfully"
}
```

## Configuration API

### Environment Configuration

```python
from src.config.settings import ConfigManager, get_config

# Get current configuration
config = get_config()

# Create configuration manager
manager = ConfigManager()

# Load configuration for specific environment
config = manager.load_config("production")

# Export configuration template
manager.export_config_template("production", Path("prod.env"))

# Validate configuration
manager.validate_environment_config(config)
```

### MCP Server Configuration

```python
from src.config.settings import get_mcp_server_configs

# Get all MCP server configurations
servers = get_mcp_server_configs()

# Example result:
{
  "github": {
    "endpoint": "ws://localhost:3001",
    "capabilities": ["read", "write"],
    "auth_required": True
  },
  "slack": {
    "endpoint": "ws://localhost:3002", 
    "capabilities": ["read", "write", "execute"],
    "auth_required": True
  }
}
```

## MCP Integration API

### MCP Client Manager

```python
from src.mcp.connection import MCPClientManager

manager = MCPClientManager()

# Connect to MCP server
await manager.connect_to_server(server_config)

# List available tools
tools = await manager.list_tools("server_name")

# Call tool with agent authentication
result = await manager.call_tool(
    tool_name="get_repositories",
    params={"user": "octocat"},
    agent_token=agent_token
)

# Call tool with user authorization
result = await manager.call_tool(
    tool_name="create_repository", 
    params={"name": "new-repo"},
    agent_token=agent_token,
    user_auth_code="auth_code_123"
)
```

### Tool Registry

```python
from src.mcp.tool_registry import ToolRegistry

registry = ToolRegistry()

# Register MCP server tools
await registry.register_server_tools("github", github_tools)

# Get available tools
tools = registry.get_available_tools()

# Execute tool
result = await registry.execute_tool(
    tool_name="github.get_repositories",
    params={"user": "octocat"},
    context=execution_context
)
```

## Authentication API

### OAuth Manager

```python
from src.authentication.oauth_manager import OAuthAuthenticationManager

auth_manager = OAuthAuthenticationManager()

# Get agent token (client credentials flow)
agent_token = await auth_manager.get_agent_token()

# Generate authorization URL for user
auth_url = await auth_manager.generate_authorization_url(
    scope="api:read api:write",
    state="random_state"
)

# Handle authorization code
auth_code = await auth_manager.receive_authorization_code(
    code="auth_code_from_user",
    state="random_state"
)
```

### Token Management

```python
from src.storage.token_cache import TokenCache
from src.storage.secure_storage import SecureStorage

# Token caching
cache = TokenCache()
cache.store_token("key", token, expires_in=3600)
cached_token = cache.get_token("key")

# Secure storage
storage = SecureStorage()
await storage.store_credentials("client_id", credentials)
stored_creds = await storage.get_credentials("client_id")
```

## Error Codes

### Authentication Errors

| Code | Description | Resolution |
|------|-------------|------------|
| `AUTH_001` | Invalid agent token | Refresh agent token |
| `AUTH_002` | User authorization required | Initiate OAuth flow |
| `AUTH_003` | Authorization code expired | Request new authorization |
| `AUTH_004` | Invalid authorization code | Verify code and state |
| `AUTH_005` | Token refresh failed | Re-authenticate |

### MCP Integration Errors

| Code | Description | Resolution |
|------|-------------|------------|
| `MCP_001` | Server connection failed | Check server status |
| `MCP_002` | Tool not found | Verify tool name |
| `MCP_003` | Tool execution failed | Check parameters |
| `MCP_004` | Server authentication failed | Verify server credentials |
| `MCP_005` | Tool timeout | Increase timeout or retry |

### Configuration Errors

| Code | Description | Resolution |
|------|-------------|------------|
| `CFG_001` | Missing required configuration | Set required environment variables |
| `CFG_002` | Invalid configuration value | Check configuration format |
| `CFG_003` | Environment validation failed | Review environment-specific requirements |
| `CFG_004` | Configuration file not found | Create or specify config file |

### Session Errors

| Code | Description | Resolution |
|------|-------------|------------|
| `SES_001` | Session not found | Create new session |
| `SES_002` | Session expired | Create new session |
| `SES_003` | Session limit exceeded | Wait or clean up sessions |
| `SES_004` | Invalid session state | Reset session |

### General Errors

| Code | Description | Resolution |
|------|-------------|------------|
| `GEN_001` | Internal server error | Check logs and retry |
| `GEN_002` | Service unavailable | Check service status |
| `GEN_003` | Rate limit exceeded | Wait and retry |
| `GEN_004` | Invalid request format | Check request structure |
| `GEN_005` | Resource not found | Verify resource identifier |

## Response Formats

### Success Response

```json
{
  "success": true,
  "data": { ... },
  "metadata": {
    "timestamp": "2024-01-01T00:00:00Z",
    "request_id": "req_123",
    "processing_time": 0.85
  }
}
```

### Error Response

```json
{
  "success": false,
  "error": {
    "code": "AUTH_001",
    "message": "Invalid agent token",
    "details": "Token has expired",
    "timestamp": "2024-01-01T00:00:00Z"
  },
  "metadata": {
    "request_id": "req_123",
    "processing_time": 0.12
  }
}
```

## Rate Limits

- **WebSocket connections**: 10 per IP address
- **HTTP requests**: 100 per minute per IP
- **Tool executions**: 50 per minute per session
- **Authorization requests**: 10 per hour per session

## Authentication

All API requests require appropriate authentication:

- **WebSocket**: Session-based authentication
- **HTTP endpoints**: Bearer token or session cookie
- **MCP tools**: Agent token + optional user authorization

## Versioning

The API uses semantic versioning:
- Current version: `v1.0.0`
- Version header: `API-Version: 1.0`
- Backward compatibility maintained within major versions