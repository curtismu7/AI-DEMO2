"""
Base interfaces and abstract classes for MCP integration and agent services.
"""
from abc import ABC, abstractmethod
from typing import Dict, Any, List, Optional

from models.mcp import MCPServerConfig, AuthChallenge, MCPToolCall
from models.auth import AccessToken, AuthorizationCode
from models.chat import ChatMessage, ChatSession


class LLMProvider(ABC):
    """
    Abstract base class for pluggable LLM provider adapters.

    Implementations wrap a specific LangChain chat-model backend behind a uniform
    interface so the agent core never imports provider-specific packages
    directly.
    """

    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Human-readable provider identifier (e.g. 'helix')."""

    @property
    @abstractmethod
    def default_model(self) -> str:
        """Default model name used when none is specified by the caller."""

    @property
    @abstractmethod
    def available_models(self) -> List[str]:
        """Ordered list of model identifiers supported by this provider."""

    @abstractmethod
    def is_configured(self) -> bool:
        """Return True if required credentials / endpoints are present."""

    @abstractmethod
    def get_chat_model(
        self,
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 1000,
        streaming: bool = True,
        **kwargs: Any,
    ):
        """
        Instantiate and return a LangChain ``BaseChatModel`` for this provider.

        Args:
            model: Model name; defaults to ``default_model`` when omitted.
            temperature: Sampling temperature (0.0–1.0).
            max_tokens: Maximum tokens to generate per response.
            streaming: Whether to enable token-level streaming.
            **kwargs: Additional provider-specific keyword arguments.

        Returns:
            A configured ``BaseChatModel`` instance ready for use.
        """


class MCPClient(ABC):
    """Abstract base class for MCP server client connections."""
    
    @abstractmethod
    async def connect(self, server_config: MCPServerConfig) -> None:
        """Establish connection to MCP server."""
        pass
    
    @abstractmethod
    async def disconnect(self) -> None:
        """Close connection to MCP server."""
        pass
    
    @abstractmethod
    async def call_tool(self, tool_call: MCPToolCall) -> Dict[str, Any]:
        """Execute a tool call on the MCP server."""
        pass
    
    @abstractmethod
    async def list_tools(self) -> List[str]:
        """List available tools on the MCP server."""
        pass
    
    @abstractmethod
    async def handle_auth_challenge(self, challenge: AuthChallenge) -> Dict[str, Any]:
        """Handle authentication challenge from MCP server."""
        pass


class MCPClientManager(ABC):
    """Abstract base class for managing multiple MCP client connections."""
    
    @abstractmethod
    async def register_server(self, server_config: MCPServerConfig) -> None:
        """Register a new MCP server configuration."""
        pass
    
    @abstractmethod
    async def get_available_tools(self) -> Dict[str, List[str]]:
        """Get all available tools from registered servers."""
        pass
    
    @abstractmethod
    async def execute_tool(self, server_name: str, tool_name: str, 
                          parameters: Dict[str, Any], agent_token: AccessToken,
                          user_auth_code: Optional[AuthorizationCode] = None) -> Dict[str, Any]:
        """Execute a tool on a specific MCP server."""
        pass
    
    @abstractmethod
    async def handle_server_auth_challenge(self, server_name: str, 
                                         challenge: AuthChallenge) -> Dict[str, Any]:
        """Handle authentication challenge from a specific server."""
        pass


class AgentCore(ABC):
    """Abstract base class for the LangChain agent core."""
    
    @abstractmethod
    async def process_message(self, message: ChatMessage, session: ChatSession) -> ChatMessage:
        """Process user message and generate agent response."""
        pass
    
    @abstractmethod
    async def execute_tool_chain(self, tool_calls: List[MCPToolCall], 
                               session: ChatSession) -> List[Dict[str, Any]]:
        """Execute a chain of tool calls for complex operations."""
        pass
    
    @abstractmethod
    async def get_conversation_context(self, session_id: str) -> Dict[str, Any]:
        """Retrieve conversation context for a session."""
        pass


class SessionManager(ABC):
    """Abstract base class for managing chat sessions."""
    
    @abstractmethod
    async def create_session(self, user_id: Optional[str] = None) -> ChatSession:
        """Create a new chat session."""
        pass
    
    @abstractmethod
    async def get_session(self, session_id: str) -> Optional[ChatSession]:
        """Retrieve an existing chat session."""
        pass
    
    @abstractmethod
    async def update_session_activity(self, session_id: str) -> None:
        """Update last activity timestamp for a session."""
        pass
    
    @abstractmethod
    async def cleanup_expired_sessions(self) -> None:
        """Remove expired chat sessions."""
        pass
    
    @abstractmethod
    async def store_message(self, message: ChatMessage) -> None:
        """Store a chat message in the session history."""
        pass
    
    @abstractmethod
    async def get_session_messages(self, session_id: str, limit: Optional[int] = None) -> List[ChatMessage]:
        """Retrieve messages for a session."""
        pass