"""
MCP (Model Context Protocol) client implementation.

This package provides a complete MCP client implementation with:
- Connection management with pooling and retry logic
- Tool registry and execution with agent token injection
- Authentication challenge handling for OAuth flows

Example usage:

```python
import asyncio
from src.mcp.tool_registry import MCPClientManager
from src.mcp.auth_handler import AuthenticationHandler
from src.models.mcp import MCPServerConfig, AuthRequirements, AuthRequirementType
from src.models.auth import AccessToken

async def main():
    # Create MCP client manager
    manager = MCPClientManager()
    
    # Create authentication handler
    async def handle_auth_request(auth_request):
        print(f"Auth required: {auth_request.authorization_url}")
        # In a real app, you'd redirect the user to this URL
    
    auth_handler = AuthenticationHandler(auth_request_callback=handle_auth_request)
    
    # Configure MCP server
    auth_requirements = AuthRequirements(
        type=AuthRequirementType.AGENT_TOKEN,
        scopes=["read", "write"]
    )
    
    server_config = MCPServerConfig(
        name="example-server",
        endpoint="ws://localhost:8080/mcp",
        capabilities=["tool_execution"],
        auth_requirements=auth_requirements
    )
    
    # Register server
    await manager.register_server(server_config)
    
    # Create agent token
    agent_token = AccessToken(
        token="agent-token-123",
        token_type="Bearer",
        expires_in=3600,
        scope="read write",
        issued_at=datetime.now(timezone.utc)
    )
    
    # Execute tool (session_id is required — execute_tool raises ValueError
    # without it)
    result = await manager.execute_tool(
        server_name="example-server",
        tool_name="example_tool",
        parameters={"param1": "value1"},
        agent_token=agent_token,
        session_id="session-123"
    )
    
    print(f"Tool result: {result}")
    
    # Cleanup
    await manager.shutdown()
    await auth_handler.shutdown()

if __name__ == "__main__":
    asyncio.run(main())
```
"""

from .connection import MCPConnection, MCPConnectionPool
from .tool_registry import ToolRegistry, MCPToolExecutor, MCPClientManager
from .auth_handler import AuthenticationHandler, AuthRequest, AuthResponse, AuthChallengeDetector

__all__ = [
    "MCPConnection",
    "MCPConnectionPool", 
    "ToolRegistry",
    "MCPToolExecutor",
    "MCPClientManager",
    "AuthenticationHandler",
    "AuthRequest",
    "AuthResponse",
    "AuthChallengeDetector"
]