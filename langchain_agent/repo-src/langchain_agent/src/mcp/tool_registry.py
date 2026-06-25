"""
MCP tool registry and execution management.
"""
import logging
from typing import Dict, List, Any, Optional, Set
from dataclasses import dataclass
import asyncio

from models.mcp import MCPServerConfig, MCPToolCall
from models.auth import AccessToken, AuthorizationCode
from .connection import MCPConnectionPool


logger = logging.getLogger(__name__)


@dataclass
class ToolInfo:
    """Information about an available MCP tool"""
    name: str
    server_name: str
    description: Optional[str] = None
    parameters: Optional[Dict[str, Any]] = None
    annotations: Optional[Dict[str, Any]] = None
    
    def __post_init__(self):
        """Validate tool info after initialization"""
        if not self.name or not isinstance(self.name, str):
            raise ValueError("name must be a non-empty string")
        
        if not self.server_name or not isinstance(self.server_name, str):
            raise ValueError("server_name must be a non-empty string")
    
    @property
    def full_name(self) -> str:
        """Get the full tool name including server prefix"""
        return f"{self.server_name}.{self.name}"


class ToolRegistry:
    """Registry for managing available MCP tools across servers"""
    
    def __init__(self):
        self._tools: Dict[str, ToolInfo] = {}  # full_name -> ToolInfo
        self._server_tools: Dict[str, Set[str]] = {}  # server_name -> set of tool names
        self._registry_lock = asyncio.Lock()
        
        logger.info("Initialized MCP tool registry")
    
    async def register_server_tools(self, server_name: str, tools: List[str], 
                                  tool_descriptions: Optional[Dict[str, str]] = None,
                                  tool_schemas: Optional[Dict[str, Dict[str, Any]]] = None) -> None:
        """Register tools from a specific MCP server"""
        async with self._registry_lock:
            if server_name not in self._server_tools:
                self._server_tools[server_name] = set()
            
            # Clear existing tools for this server
            old_tools = self._server_tools[server_name].copy()
            for tool_name in old_tools:
                full_name = f"{server_name}.{tool_name}"
                if full_name in self._tools:
                    del self._tools[full_name]
            
            # Register new tools
            self._server_tools[server_name] = set()
            for tool_name in tools:
                # Get tool schema if available
                tool_schema = tool_schemas.get(tool_name) if tool_schemas else None
                parameters = None
                description = tool_descriptions.get(tool_name) if tool_descriptions else None
                
                # Extract description and parameters from schema
                annotations = None
                if tool_schema and isinstance(tool_schema, dict):
                    if not description:
                        description = tool_schema.get("description", "")

                    # Accept both full MCP tool definitions ({ inputSchema: {...} })
                    # and bare JSON schema objects ({ type, properties, required }).
                    if isinstance(tool_schema.get("inputSchema"), dict):
                        parameters = tool_schema.get("inputSchema")
                    elif isinstance(tool_schema.get("properties"), dict):
                        parameters = tool_schema
                    else:
                        parameters = {}

                    annotations = tool_schema.get("annotations")

                tool_info = ToolInfo(
                    name=tool_name,
                    server_name=server_name,
                    description=description,
                    parameters=parameters,
                    annotations=annotations
                )
                
                full_name = tool_info.full_name
                self._tools[full_name] = tool_info
                self._server_tools[server_name].add(tool_name)
            
            logger.info(f"Registered {len(tools)} tools for server {server_name}: {tools}")
            if tool_schemas:
                logger.debug(f"Tool schemas registered: {list(tool_schemas.keys())}")
    
    async def unregister_server(self, server_name: str) -> None:
        """Unregister all tools from a specific server"""
        async with self._registry_lock:
            if server_name in self._server_tools:
                # Remove all tools for this server
                for tool_name in self._server_tools[server_name]:
                    full_name = f"{server_name}.{tool_name}"
                    if full_name in self._tools:
                        del self._tools[full_name]
                
                del self._server_tools[server_name]
                logger.info(f"Unregistered all tools for server {server_name}")
    
    async def get_all_tools(self) -> Dict[str, ToolInfo]:
        """Get all registered tools"""
        async with self._registry_lock:
            return self._tools.copy()
    
    async def get_server_tools(self, server_name: str) -> List[ToolInfo]:
        """Get all tools for a specific server"""
        async with self._registry_lock:
            if server_name not in self._server_tools:
                return []
            
            tools = []
            for tool_name in self._server_tools[server_name]:
                full_name = f"{server_name}.{tool_name}"
                if full_name in self._tools:
                    tools.append(self._tools[full_name])
            
            return tools
    
    async def get_tool_info(self, full_name: str) -> Optional[ToolInfo]:
        """Get information about a specific tool"""
        async with self._registry_lock:
            return self._tools.get(full_name)
    
    async def find_tools(self, pattern: str) -> List[ToolInfo]:
        """Find tools matching a pattern"""
        async with self._registry_lock:
            matching_tools = []
            pattern_lower = pattern.lower()
            
            for tool_info in self._tools.values():
                if (pattern_lower in tool_info.name.lower() or 
                    pattern_lower in tool_info.full_name.lower() or
                    (tool_info.description and pattern_lower in tool_info.description.lower())):
                    matching_tools.append(tool_info)
            
            return matching_tools
    
    async def get_registry_stats(self) -> Dict[str, Any]:
        """Get statistics about the tool registry"""
        async with self._registry_lock:
            stats = {
                "total_tools": len(self._tools),
                "total_servers": len(self._server_tools),
                "servers": {}
            }
            
            for server_name, tool_names in self._server_tools.items():
                stats["servers"][server_name] = {
                    "tool_count": len(tool_names),
                    "tools": list(tool_names)
                }
            
            return stats


class MCPToolExecutor:
    """Executor for MCP tool calls with agent token injection"""
    
    def __init__(self, connection_pool: MCPConnectionPool, tool_registry: ToolRegistry, server_configs: Optional[Dict[str, MCPServerConfig]] = None):
        self.connection_pool = connection_pool
        self.tool_registry = tool_registry
        self.server_configs = server_configs or {}
        self._execution_lock = asyncio.Lock()
        
        logger.info("Initialized MCP tool executor")
    
    async def execute_tool(self, server_name: str, tool_name: str, parameters: Dict[str, Any],
                          agent_token: AccessToken, session_id: str,
                          user_auth_code: Optional[AuthorizationCode] = None) -> Dict[str, Any]:
        """Execute a tool on a specific MCP server with agent token injection"""
        
        # Validate inputs
        if not server_name or not isinstance(server_name, str):
            raise ValueError("server_name must be a non-empty string")
        
        if not tool_name or not isinstance(tool_name, str):
            raise ValueError("tool_name must be a non-empty string")
        
        if not isinstance(parameters, dict):
            raise ValueError("parameters must be a dictionary")
        
        if not isinstance(agent_token, AccessToken):
            raise ValueError("agent_token must be an AccessToken instance")
        
        if not session_id or not isinstance(session_id, str):
            raise ValueError("session_id must be a non-empty string")
        
        # Check if tool exists
        full_tool_name = f"{server_name}.{tool_name}"
        tool_info = await self.tool_registry.get_tool_info(full_tool_name)
        if not tool_info:
            raise ValueError(f"Tool {full_tool_name} not found in registry")
        
        # Validate agent token is not expired
        if agent_token.is_expired():
            raise ValueError("Agent token is expired")
        
        # Validate user auth code if provided
        if user_auth_code and user_auth_code.is_expired():
            raise ValueError("User authorization code is expired")
        
        logger.info(f"Executing tool {full_tool_name} for session {session_id}")
        logger.debug(f"Tool execution parameters: {parameters}")
        # BL-01: never log the raw AccessToken — mask via fingerprint helper.
        # AccessToken.__repr__ now masks too, but logging the fingerprint is the
        # form callers should imitate when debugging token flow.
        logger.debug(f"Agent token: {agent_token.masked_fingerprint() if agent_token else 'none'}")
        logger.debug(f"User auth code present: {user_auth_code is not None}")
        
        try:
            # Get server configuration (we need this to get a connection)
            # For now, we'll assume the connection pool can handle this
            # In a real implementation, we'd need to store server configs
            
            # Create tool call
            logger.debug(f"Creating MCPToolCall for {tool_name}")
            tool_call = MCPToolCall(
                tool_name=tool_name,
                parameters=parameters,
                agent_token=agent_token,
                user_auth_code=user_auth_code,
                session_id=session_id
            )
            logger.debug(f"Created tool call: {tool_call}")
            
            # Get the real server configuration
            if server_name not in self.server_configs:
                raise ValueError(f"Server '{server_name}' not found in registered servers. Available: {list(self.server_configs.keys())}")
            
            server_config = self.server_configs[server_name]
            logger.info(f"Using registered server config for {server_name}: {server_config.endpoint}")
            logger.debug(f"Server config details: {server_config}")
            
            logger.debug(f"Getting connection from pool for server {server_name}")
            connection = await self.connection_pool.get_connection(server_config)
            logger.debug(f"Got connection: {connection}")
            
            # Execute the tool call
            logger.info(f"Calling tool on connection: {tool_call}")
            result = await connection.call_tool(tool_call)
            logger.debug(f"Tool call result: {result}")
            
            logger.info(f"Successfully executed tool {full_tool_name}")
            return result
            
        except Exception as e:
            logger.error(f"Error executing tool {full_tool_name}: {e}")
            raise
    
    async def execute_tool_by_full_name(self, full_tool_name: str, parameters: Dict[str, Any],
                                      agent_token: AccessToken, session_id: str,
                                      user_auth_code: Optional[AuthorizationCode] = None) -> Dict[str, Any]:
        """Execute a tool using its full name (server.tool)"""
        
        # Parse full tool name
        if '.' not in full_tool_name:
            raise ValueError("full_tool_name must be in format 'server.tool'")
        
        parts = full_tool_name.split('.', 1)
        server_name = parts[0]
        tool_name = parts[1]
        
        return await self.execute_tool(
            server_name=server_name,
            tool_name=tool_name,
            parameters=parameters,
            agent_token=agent_token,
            session_id=session_id,
            user_auth_code=user_auth_code
        )
    
    async def batch_execute_tools(self, tool_calls: List[Dict[str, Any]], 
                                agent_token: AccessToken, session_id: str) -> List[Dict[str, Any]]:
        """Execute multiple tools in parallel"""
        
        if not isinstance(tool_calls, list):
            raise ValueError("tool_calls must be a list")
        
        if not tool_calls:
            return []
        
        logger.info(f"Executing batch of {len(tool_calls)} tools for session {session_id}")
        
        # Create tasks for parallel execution
        tasks = []
        for call in tool_calls:
            if not isinstance(call, dict):
                raise ValueError("Each tool call must be a dictionary")
            
            required_fields = ["server_name", "tool_name", "parameters"]
            for field in required_fields:
                if field not in call:
                    raise ValueError(f"Tool call missing required field: {field}")
            
            task = self.execute_tool(
                server_name=call["server_name"],
                tool_name=call["tool_name"],
                parameters=call["parameters"],
                agent_token=agent_token,
                session_id=session_id,
                user_auth_code=call.get("user_auth_code")
            )
            tasks.append(task)
        
        # Execute all tasks in parallel
        try:
            results = await asyncio.gather(*tasks, return_exceptions=True)
            
            # Process results and convert exceptions to error dictionaries
            processed_results = []
            for i, result in enumerate(results):
                if isinstance(result, Exception):
                    processed_results.append({
                        "error": str(result),
                        "tool_call": tool_calls[i]
                    })
                else:
                    processed_results.append(result)
            
            logger.info(f"Completed batch execution of {len(tool_calls)} tools")
            return processed_results
            
        except Exception as e:
            logger.error(f"Error in batch tool execution: {e}")
            raise


class MCPClientManager:
    """High-level manager for MCP client operations"""
    
    def __init__(self, connection_pool: Optional[MCPConnectionPool] = None):
        self.connection_pool = connection_pool or MCPConnectionPool()
        self.tool_registry = ToolRegistry()
        self._server_configs: Dict[str, MCPServerConfig] = {}
        self.tool_executor = MCPToolExecutor(self.connection_pool, self.tool_registry, self._server_configs)

        # IN-03: pending per-session MCP auth challenges. Previously this was
        # monkey-patched onto the instance from MCPToolProvider tool _arun
        # paths (`if not hasattr(..., '_session_challenges'): ... = {}`),
        # making it undiscoverable and the lifetime implicit. Declare it here
        # as a real attribute. Process-scoped-singleton is correct: there is
        # one MCPClientManager per process (constructed once in
        # LangChainMCPApplication.initialize) and entries are keyed by
        # session_id and deleted on consume/expiry, so there is no
        # cross-session bleed of the WR-06 tracer class — the key IS the
        # session. The remaining hasattr() guards in mcp_tool_provider.py are
        # now always-true and harmless (kept to avoid an unrelated diff).
        self._session_challenges: Dict[str, Dict[str, Any]] = {}

        logger.info("Initialized MCP client manager")
    
    async def register_server(self, server_config: MCPServerConfig) -> None:
        """Register a new MCP server and discover its tools"""
        server_name = server_config.name
        
        # Store server config
        self._server_configs[server_name] = server_config
        # Update the executor's reference to server configs
        self.tool_executor.server_configs = self._server_configs
        
        try:
            # Get connection to discover tools
            connection = await self.connection_pool.get_connection(server_config)
            
            # List available tools
            tools = await connection.list_tools()
            
            # Get tool schemas
            tool_schemas = {}
            for tool_name in tools:
                schema = await connection.get_tool_schema(tool_name)
                if schema:
                    tool_schemas[tool_name] = schema
            
            # Register tools in registry with schemas
            await self.tool_registry.register_server_tools(
                server_name, 
                tools, 
                tool_schemas=tool_schemas
            )
            
            logger.info(f"Successfully registered MCP server {server_name} with {len(tools)} tools")
            
        except Exception as e:
            logger.error(f"Error registering MCP server {server_name}: {e}")
            raise
    
    async def unregister_server(self, server_name: str) -> None:
        """Unregister an MCP server"""
        if server_name in self._server_configs:
            del self._server_configs[server_name]
        
        await self.tool_registry.unregister_server(server_name)
        logger.info(f"Unregistered MCP server {server_name}")
    
    async def get_available_tools(self) -> Dict[str, List[str]]:
        """Get all available tools grouped by server"""
        all_tools = await self.tool_registry.get_all_tools()
        
        server_tools = {}
        for tool_info in all_tools.values():
            if tool_info.server_name not in server_tools:
                server_tools[tool_info.server_name] = []
            server_tools[tool_info.server_name].append(tool_info.name)
        
        return server_tools
    
    async def execute_tool(self, server_name: str, tool_name: str, 
                          parameters: Dict[str, Any], agent_token: AccessToken,
                          user_auth_code: Optional[AuthorizationCode] = None,
                          session_id: Optional[str] = None) -> Dict[str, Any]:
        """Execute a tool on a specific MCP server"""

        if not session_id:
            raise ValueError("session_id is required")

        return await self.tool_executor.execute_tool(
            server_name=server_name,
            tool_name=tool_name,
            parameters=parameters,
            agent_token=agent_token,
            session_id=session_id,
            user_auth_code=user_auth_code
        )
    
    async def find_and_execute_tool(self, tool_pattern: str, parameters: Dict[str, Any],
                                  agent_token: AccessToken, session_id: Optional[str] = None) -> Dict[str, Any]:
        """Find a tool by pattern and execute it"""
        
        matching_tools = await self.tool_registry.find_tools(tool_pattern)
        
        if not matching_tools:
            raise ValueError(f"No tools found matching pattern: {tool_pattern}")
        
        if len(matching_tools) > 1:
            tool_names = [tool.full_name for tool in matching_tools]
            raise ValueError(f"Multiple tools found matching pattern '{tool_pattern}': {tool_names}")
        
        tool_info = matching_tools[0]

        if not session_id:
            raise ValueError("session_id is required")

        return await self.tool_executor.execute_tool(
            server_name=tool_info.server_name,
            tool_name=tool_info.name,
            parameters=parameters,
            agent_token=agent_token,
            session_id=session_id
        )
    
    async def get_manager_status(self) -> Dict[str, Any]:
        """Get status of the MCP client manager"""
        registry_stats = await self.tool_registry.get_registry_stats()
        pool_status = await self.connection_pool.get_pool_status()
        
        return {
            "registered_servers": len(self._server_configs),
            "server_configs": list(self._server_configs.keys()),
            "tool_registry": registry_stats,
            "connection_pool": pool_status
        }
    
    async def shutdown(self) -> None:
        """Shutdown the MCP client manager and close all connections"""
        await self.connection_pool.close_all_connections()
        logger.info("MCP client manager shutdown complete")