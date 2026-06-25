"""
Local MCP connection adapter for in-process MCP servers.
"""
import asyncio
import logging
from typing import Dict, Any, Optional, List

from models.mcp import MCPServerConfig, MCPToolCall
from services.interfaces import MCPClient
from .user_management_server import UserManagementMCPServer


logger = logging.getLogger(__name__)


class LocalMCPConnection(MCPClient):
    """Local connection adapter for in-process MCP servers."""
    
    def __init__(self, server_config: MCPServerConfig):
        self.server_config = server_config
        self._server_instance = None
        self._is_connected = False
        
        # Initialize the appropriate server based on config
        if server_config.name == "user_management":
            self._server_instance = UserManagementMCPServer()
        else:
            raise ValueError(f"Unknown local MCP server: {server_config.name}")
        
        logger.info(f"Initialized local MCP connection for server: {server_config.name}")
    
    @property
    def is_connected(self) -> bool:
        """Check if connection is active."""
        return self._is_connected
    
    async def connect(self, server_config: MCPServerConfig) -> None:
        """Establish connection to local MCP server."""
        if self._is_connected:
            logger.debug(f"Already connected to local server {server_config.name}")
            return
        
        try:
            logger.info(f"Connecting to local MCP server {server_config.name}")
            
            # For local servers, connection is just marking as connected
            self._is_connected = True
            
            logger.info(f"Successfully connected to local MCP server {server_config.name}")
            
        except Exception as e:
            logger.error(f"Error connecting to local MCP server {server_config.name}: {e}")
            raise
    
    async def disconnect(self) -> None:
        """Close connection to local MCP server."""
        if self._is_connected:
            logger.info(f"Disconnecting from local MCP server {self.server_config.name}")
            self._is_connected = False
    
    async def call_tool(self, tool_call: MCPToolCall) -> Dict[str, Any]:
        """Execute a tool call on the local MCP server."""
        if not self._is_connected:
            await self.connect(self.server_config)
        
        try:
            logger.info(f"Calling tool {tool_call.tool_name} on local server {self.server_config.name}")
            logger.debug(f"Tool call parameters: {tool_call.parameters}")
            logger.debug(f"Agent token present: {tool_call.agent_token is not None}")
            logger.debug(f"User auth code present: {tool_call.user_auth_code is not None}")
            
            # Call the server instance directly
            result = await self._server_instance.call_tool(
                tool_name=tool_call.tool_name,
                parameters=tool_call.parameters,
                agent_token=tool_call.agent_token,
                user_auth_code=tool_call.user_auth_code,
                session_id=tool_call.session_id
            )
            
            logger.info(f"Tool call successful on local server {self.server_config.name}")
            logger.debug(f"Tool call result: {result}")
            
            return result
            
        except Exception as e:
            logger.error(f"Error executing tool call on local server {self.server_config.name}: {e}")
            raise
    
    async def list_tools(self) -> List[str]:
        """List available tools on the local MCP server."""
        if not self._is_connected:
            await self.connect(self.server_config)
        
        try:
            tools = await self._server_instance.list_tools()
            logger.debug(f"Listed tools for local server {self.server_config.name}: {tools}")
            return tools
            
        except Exception as e:
            logger.error(f"Error listing tools on local server {self.server_config.name}: {e}")
            raise
    
    async def get_tool_schema(self, tool_name: str) -> Optional[Dict[str, Any]]:
        """Get schema for a specific tool on the local MCP server."""
        if not self._is_connected:
            await self.connect(self.server_config)
        
        try:
            schema = await self._server_instance.get_tool_schema(tool_name)
            logger.debug(f"Got schema for tool {tool_name} on local server {self.server_config.name}: {schema}")
            return schema
            
        except Exception as e:
            logger.error(f"Error getting tool schema for {tool_name} on local server {self.server_config.name}: {e}")
            raise
    
    async def handle_auth_challenge(self, challenge) -> Dict[str, Any]:
        """Handle authentication challenge (not applicable for local servers)."""
        logger.warning(f"Auth challenge handling not applicable for local server {self.server_config.name}")
        return {"error": "Auth challenges not supported for local servers"}
    
    def get_server_instance(self):
        """Get the underlying server instance (for testing/debugging)."""
        return self._server_instance