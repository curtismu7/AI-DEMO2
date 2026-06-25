"""
Configuration management for environment-specific settings.
"""
import os
import json
from typing import Optional, Dict, Any, Type
from dataclasses import dataclass, asdict
from pathlib import Path
from abc import ABC, abstractmethod

# Load environment variables from .env file
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    # dotenv not available, skip loading
    pass


@dataclass
class PingOneConfig:
    """Configuration for PingOne AI IAM Core (ForgeRock)."""
    base_url: str
    client_registration_endpoint: str
    token_endpoint: str
    authorization_endpoint: str
    default_scope: str
    redirect_uri: str
    realm: str = "alpha"  # ForgeRock realm (default: alpha)
    # Token validation (this agent's own audience — see token_validator.py)
    jwks_uri: str = ""  # LANGCHAIN_JWKS_URI / PINGONE_JWKS_URI explicit override
    issuer: str = ""  # PINGONE_ISSUER; derived from token_endpoint when blank
    resource_langchain_agent_uri: str = ""  # PINGONE_RESOURCE_LANGCHAIN_AGENT_URI
    accepted_audiences: str = ""  # LANGCHAIN_ACCEPTED_AUDIENCES (comma-separated extras)
    # MCP resource indicators (RFC 8707 audience binding for agent tokens)
    mcp_gw_resource_uri: str = ""  # MCP_GW_RESOURCE_URI (gateway audience, Phase 243)
    mcp_server_resource_uri: str = ""  # MCP_SERVER_RESOURCE_URI (legacy fallback)
    # OAuth client provisioning (pre-provisioned creds by default; DCR opt-in)
    agent_dcr_enabled: bool = False  # AGENT_DCR_ENABLED (ForgeRock DCR only)
    user_client_id: str = ""  # PINGONE_USER_CLIENT_ID
    user_client_secret: str = ""  # PINGONE_USER_CLIENT_SECRET
    agent_client_id: str = ""  # AGENT_CLIENT_ID
    agent_client_secret: str = ""  # AGENT_CLIENT_SECRET


@dataclass
class SecurityConfig:
    """Security-related configuration."""
    token_expiry_buffer_seconds: int = 300  # 5 minutes buffer before expiry
    session_timeout_minutes: int = 60
    max_retry_attempts: int = 3
    retry_backoff_seconds: int = 2


@dataclass
class MCPConfig:
    """Configuration for MCP server connections."""
    connection_timeout_seconds: int = 30
    max_connections_per_server: int = 5
    retry_attempts: int = 3
    heartbeat_interval_seconds: int = 55
    # MCP transport protocol.
    #   "websocket"       — long-lived WebSocket connection per server (default; keeps
    #                        local dev working without changes to run.sh or .env).
    #   "streamable_http" — HTTP POST per JSON-RPC request with Mcp-Session-Id session
    #                        tracking (MCP spec 2025-03-26 preferred; use in staging/prod).
    mcp_transport: str = "websocket"


@dataclass
class LangChainConfig:
    """Configuration for LangChain agent."""
    model_name: str = "llama3.2"
    temperature: float = 0.7
    max_tokens: int = 1000
    openai_api_key: str = ""
    verbose: bool = False
    max_iterations: int = 10
    max_execution_time: int = 60  # seconds
    # WebSocket streaming: MCP tool lifecycle + optional LLM token deltas
    stream_mcp_tool_events: bool = True
    stream_llm_tokens: bool = True
    agui_enabled: bool = False  # Phase 1: dual-emit AG-UI events alongside WS (default off)
    # LLM provider — "none" (default, heuristic routing only), "helix", "lmstudio", "anthropic-lmstudio", "ollama"
    provider: str = "none"
    lmstudio_base_url: str = "http://localhost:1234/v1"
    # Ollama — local small LLM with native tool-calling. 127.0.0.1 (not localhost)
    # avoids the IPv6 (::1) bind gotcha. Pull the model first: `ollama pull qwen3:8b`.
    ollama_base_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "qwen3:8b"
    # Anthropic credentials — used by both "anthropic" (cloud) and "anthropic-lmstudio" (local).
    # When ANTHROPIC_BASE_URL is set to an LM Studio origin, the "anthropic" provider hits LM Studio
    # instead of api.anthropic.com, letting you demo "Anthropic" using a local model.
    # LM Studio accepts any non-empty API key value.
    anthropic_api_key: str = "lm-studio"
    anthropic_base_url: str = ""  # override: e.g. http://localhost:1234 → routes anthropic→LM Studio
    # Helix configuration (mirrors HELIX_* env vars used by demo_api_server).
    # Tenant-specific values (environment/prompt-field IDs) have no defaults —
    # they must be supplied via env; get_llm() fails fast when they are blank.
    helix_base_url: str = "https://openam-helix.forgeblocks.com"
    helix_api_key: str = ""
    helix_environment_id: str = ""
    helix_agent_id: str = "LLM2"
    helix_prompt_field_id: str = ""


@dataclass
class ChatConfig:
    """Configuration for chat interface."""
    # Default 8889 (not 8080) — 8080 is owned by banking_mcp_server in run-bank.sh.
    websocket_port: int = 8889
    max_message_length: int = 4096
    conversation_history_limit: int = 100
    session_cleanup_interval_minutes: int = 15
    # WR-02 (Option A): per-session message workers. Each chat session gets
    # its own ordered processing path so different sessions run concurrently
    # while turns within ONE session stay strictly ordered. These bound and
    # reap that pool.
    #   max_session_workers          — hard cap on concurrent per-session
    #                                  workers; cap-hit => backpressure error
    #                                  to the client (never silently dropped).
    #   session_worker_idle_ttl_seconds — a worker idle (no messages) longer
    #                                  than this is torn down + its task
    #                                  cancelled/awaited by the reaper.
    #   session_worker_reap_interval_seconds — reaper loop tick.
    max_session_workers: int = 50
    session_worker_idle_ttl_seconds: int = 900
    session_worker_reap_interval_seconds: int = 60
    # Server bind hosts / knobs (CR-03 discipline: loopback by default; override
    # only for container networking where peers live in another pod).
    chat_ws_host: str = "127.0.0.1"  # CHAT_WS_HOST
    # HI-01: WebSocket Origin allowlist (comma-separated) + max frame size.
    allowed_ws_origins: str = (
        "https://api.ping.demo:4000,http://localhost:4000,http://127.0.0.1:4000"
    )  # ALLOWED_WS_ORIGINS
    ws_max_message_bytes: int = 65536  # WS_MAX_MESSAGE_BYTES (64KB default)
    health_http_port: int = 8890  # HEALTH_HTTP_PORT (8081 reserved by run-bank.sh)
    agui_http_host: str = "127.0.0.1"  # AGUI_HTTP_HOST
    agui_http_port: int = 8888  # AGUI_HTTP_PORT
    # Stage-1 message-count cap for conversation trimming.
    # Uses len() as token_counter (each message = 1 "token") — this is a message-count
    # cap, NOT a token-budget. Stage 1 trims before the coarser max_messages_per_session
    # (Stage 2) cap. Stage 1 only fires when max_context_tokens < max_messages_per_session;
    # with the default of 4096 it is inactive (see WR-01 warning at ConversationMemory init).
    max_context_tokens: int = 4096


@dataclass
class AppConfig:
    """Main application configuration."""
    environment: str
    debug: bool
    log_level: str
    pingone: PingOneConfig
    security: SecurityConfig
    mcp: MCPConfig
    chat: ChatConfig
    langchain: LangChainConfig


class BaseEnvironmentConfig(ABC):
    """Base class for environment-specific configurations."""
    
    @abstractmethod
    def get_environment_name(self) -> str:
        """Get the environment name."""
        pass
    
    @abstractmethod
    def get_default_values(self) -> Dict[str, Any]:
        """Get default configuration values for this environment."""
        pass
    
    @abstractmethod
    def validate_config(self, config: AppConfig) -> None:
        """Validate configuration for this environment."""
        pass


class DevelopmentConfig(BaseEnvironmentConfig):
    """Development environment configuration."""
    
    def get_environment_name(self) -> str:
        return "development"
    
    def get_default_values(self) -> Dict[str, Any]:
        return {
            "DEBUG": "true",
            "LOG_LEVEL": "DEBUG",
            "WEBSOCKET_PORT": "8889",
            "LANGCHAIN_VERBOSE": "true",
            "LANGCHAIN_MODEL_NAME": "llama3.2",
            "PINGONE_REDIRECT_URI": "http://localhost:8889/auth/callback",
            "SESSION_TIMEOUT_MINUTES": "30",  # Shorter timeout for development
        }
    
    def validate_config(self, config: AppConfig) -> None:
        """Validate development configuration."""
        base = config.pingone.base_url or ""
        if base.startswith(("http://localhost", "https://localhost", "http://127.0.0.1")):
            return
        if base.endswith(".forgeblocks.com") or "auth.pingone." in base or "api.pingone." in base:
            return
        raise ValueError(
            "Development environment should use localhost, ForgeRock cloud, or PingOne auth URLs"
        )


class StagingConfig(BaseEnvironmentConfig):
    """Staging environment configuration."""
    
    def get_environment_name(self) -> str:
        return "staging"
    
    def get_default_values(self) -> Dict[str, Any]:
        return {
            "DEBUG": "false",
            "LOG_LEVEL": "INFO",
            "WEBSOCKET_PORT": "8889",
            "LANGCHAIN_VERBOSE": "false",
            "LANGCHAIN_MODEL_NAME": "llama3.2",
            "SESSION_TIMEOUT_MINUTES": "60",
            "MAX_RETRY_ATTEMPTS": "5",  # More retries in staging
        }
    
    def validate_config(self, config: AppConfig) -> None:
        """Validate staging configuration."""
        if config.debug:
            raise ValueError("Debug mode should be disabled in staging environment")
        
        if not config.pingone.base_url.startswith("https://"):
            raise ValueError("Staging environment must use HTTPS for PingOne")


class ProductionConfig(BaseEnvironmentConfig):
    """Production environment configuration."""
    
    def get_environment_name(self) -> str:
        return "production"
    
    def get_default_values(self) -> Dict[str, Any]:
        return {
            "DEBUG": "false",
            "LOG_LEVEL": "WARNING",
            "WEBSOCKET_PORT": "8889",
            "LANGCHAIN_VERBOSE": "false",
            "SESSION_TIMEOUT_MINUTES": "120",  # Longer timeout for production
            "MAX_RETRY_ATTEMPTS": "5",
            "TOKEN_EXPIRY_BUFFER_SECONDS": "600",  # 10 minutes buffer in production
        }
    
    def validate_config(self, config: AppConfig) -> None:
        """Validate production configuration."""
        if config.debug:
            raise ValueError("Debug mode must be disabled in production environment")
        
        if config.log_level not in ["WARNING", "ERROR", "CRITICAL"]:
            raise ValueError("Production log level should be WARNING or higher")
        
        if not config.pingone.base_url.startswith("https://"):
            raise ValueError("Production environment must use HTTPS for PingOne")


class TestConfig(BaseEnvironmentConfig):
    """Test environment configuration."""
    
    def get_environment_name(self) -> str:
        return "test"
    
    def get_default_values(self) -> Dict[str, Any]:
        return {
            "DEBUG": "true",
            "LOG_LEVEL": "DEBUG",
            "WEBSOCKET_PORT": "8081",  # Different port for tests
            "LANGCHAIN_VERBOSE": "false",  # Keep test output clean
            "LANGCHAIN_MODEL_NAME": "llama3.2",
            "PINGONE_BASE_URL": "https://test.forgeblocks.com",
            "SESSION_TIMEOUT_MINUTES": "5",  # Short timeout for tests
            "MCP_CONNECTION_TIMEOUT_SECONDS": "5",  # Fast timeouts for tests
        }
    
    def validate_config(self, config: AppConfig) -> None:
        """Validate test configuration."""
        # Tests can be more lenient with validation
        pass


class ConfigManager:
    """Manages application configuration from environment variables and files."""
    
    def __init__(self, config_file: Optional[Path] = None):
        self.config_file = config_file
        self._config: Optional[AppConfig] = None
        self._environment_configs = {
            "development": DevelopmentConfig(),
            "staging": StagingConfig(),
            "production": ProductionConfig(),
            "test": TestConfig(),
        }
    
    def load_config(self, environment: Optional[str] = None) -> AppConfig:
        """Load configuration from environment variables and optional config file."""
        if self._config is None or environment is not None:
            self._config = self._build_config(environment)
        return self._config
    
    def reload_config(self, environment: Optional[str] = None) -> AppConfig:
        """Force reload configuration."""
        self._config = None
        return self.load_config(environment)
    
    def export_config_template(self, environment: str, output_path: Path) -> None:
        """Export configuration template for specified environment."""
        if environment not in self._environment_configs:
            raise ValueError(f"Unknown environment: {environment}")
        
        env_config = self._environment_configs[environment]
        defaults = env_config.get_default_values()
        
        template_lines = [
            f"# Configuration template for {environment} environment",
            f"# Generated automatically - customize as needed",
            "",
            f"ENVIRONMENT={environment}",
        ]
        
        for key, value in defaults.items():
            template_lines.append(f"{key}={value}")
        
        # Add required variables that don't have defaults
        required_vars = [
            "PINGONE_BASE_URL=https://your-tenant.forgeblocks.com",
            "PINGONE_CLIENT_REGISTRATION_ENDPOINT=https://your-tenant.forgeblocks.com/am/oauth2/realms/alpha/register",
            "PINGONE_TOKEN_ENDPOINT=https://your-tenant.forgeblocks.com/am/oauth2/realms/alpha/access_token",
            "PINGONE_AUTHORIZATION_ENDPOINT=https://your-tenant.forgeblocks.com/am/oauth2/realms/alpha/authorize",
        ]
        
        template_lines.extend(["", "# Required variables - must be set"])
        template_lines.extend(required_vars)
        
        output_path.write_text("\n".join(template_lines))
    
    def validate_environment_config(self, config: AppConfig) -> None:
        """Validate configuration for the current environment."""
        env_config = self._environment_configs.get(config.environment)
        if env_config:
            skip_sig = os.environ.get("SKIP_TOKEN_SIGNATURE_VALIDATION", "").lower() == "true"
            if skip_sig and config.environment not in {"development", "test"}:
                raise RuntimeError(
                    "SKIP_TOKEN_SIGNATURE_VALIDATION=true is not permitted outside development "
                    f"environments (current environment: {config.environment!r}). "
                    "Unset this variable before starting in staging or production."
                )
            env_config.validate_config(config)
    
    def _build_config(self, environment: Optional[str] = None) -> AppConfig:
        """Build configuration from environment variables with environment-specific defaults."""
        # Load environment from parameter or environment variable
        env_name = environment or os.getenv("ENVIRONMENT", "development")
        
        # Get environment-specific defaults
        env_config = self._environment_configs.get(env_name)
        if not env_config:
            raise ValueError(f"Unknown environment: {env_name}")
        
        defaults = env_config.get_default_values()
        
        # Load configuration file if specified
        file_config = {}
        if self.config_file and self.config_file.exists():
            file_config = self._load_config_file()
        
        # Helper function to get value with environment-specific defaults
        def get_env_value(key: str, default: Optional[str] = None) -> str:
            # Priority: environment variable > config file > environment defaults > provided default
            return (os.getenv(key) or 
                   file_config.get(key) or 
                   defaults.get(key) or 
                   default or "")
        
        # PingOne AI IAM Core (ForgeRock) configuration
        pingone_config = PingOneConfig(
            base_url=self._get_required_env("PINGONE_BASE_URL", file_config, defaults),
            client_registration_endpoint=self._get_required_env("PINGONE_CLIENT_REGISTRATION_ENDPOINT", file_config, defaults),
            token_endpoint=self._get_required_env("PINGONE_TOKEN_ENDPOINT", file_config, defaults),
            authorization_endpoint=self._get_required_env("PINGONE_AUTHORIZATION_ENDPOINT", file_config, defaults),
            default_scope=get_env_value("PINGONE_DEFAULT_SCOPE", "openid profile"),
            redirect_uri=self._get_required_env("PINGONE_REDIRECT_URI", file_config, defaults),
            realm=get_env_value("PINGONE_REALM", "alpha"),
            # Token validation (LANGCHAIN_JWKS_URI takes priority over PINGONE_JWKS_URI)
            jwks_uri=get_env_value("LANGCHAIN_JWKS_URI") or get_env_value("PINGONE_JWKS_URI", ""),
            issuer=get_env_value("PINGONE_ISSUER", ""),
            resource_langchain_agent_uri=get_env_value("PINGONE_RESOURCE_LANGCHAIN_AGENT_URI", ""),
            accepted_audiences=get_env_value("LANGCHAIN_ACCEPTED_AUDIENCES", ""),
            # MCP resource indicators
            mcp_gw_resource_uri=get_env_value("MCP_GW_RESOURCE_URI", ""),
            mcp_server_resource_uri=get_env_value("MCP_SERVER_RESOURCE_URI", ""),
            # OAuth client provisioning
            agent_dcr_enabled=get_env_value("AGENT_DCR_ENABLED", "false").lower() == "true",
            user_client_id=get_env_value("PINGONE_USER_CLIENT_ID", ""),
            user_client_secret=get_env_value("PINGONE_USER_CLIENT_SECRET", ""),
            agent_client_id=get_env_value("AGENT_CLIENT_ID", ""),
            agent_client_secret=get_env_value("AGENT_CLIENT_SECRET", ""),
        )

        # Security configuration
        security_config = SecurityConfig(
            token_expiry_buffer_seconds=int(get_env_value("TOKEN_EXPIRY_BUFFER_SECONDS", "300")),
            session_timeout_minutes=int(get_env_value("SESSION_TIMEOUT_MINUTES", "60")),
            max_retry_attempts=int(get_env_value("MAX_RETRY_ATTEMPTS", "3")),
            retry_backoff_seconds=int(get_env_value("RETRY_BACKOFF_SECONDS", "2"))
        )
        
        # MCP configuration
        mcp_config = MCPConfig(
            connection_timeout_seconds=int(get_env_value("MCP_CONNECTION_TIMEOUT_SECONDS", "30")),
            max_connections_per_server=int(get_env_value("MCP_MAX_CONNECTIONS_PER_SERVER", "5")),
            retry_attempts=int(get_env_value("MCP_RETRY_ATTEMPTS", "3")),
            heartbeat_interval_seconds=int(get_env_value("MCP_HEARTBEAT_INTERVAL_SECONDS", "30")),
            mcp_transport=get_env_value("MCP_TRANSPORT", "websocket"),
        )
        _valid_transports = {"websocket", "streamable_http"}
        if mcp_config.mcp_transport not in _valid_transports:
            raise ValueError(
                f"MCP_TRANSPORT must be one of {_valid_transports}, got {mcp_config.mcp_transport!r}"
            )
        
        # LangChain configuration
        langchain_config = LangChainConfig(
            model_name=get_env_value("LANGCHAIN_MODEL_NAME", "llama3.2"),
            temperature=float(get_env_value("LANGCHAIN_TEMPERATURE", "0.7")),
            max_tokens=int(get_env_value("LANGCHAIN_MAX_TOKENS", "1000")),
            openai_api_key=get_env_value("OPENAI_API_KEY", ""),
            verbose=get_env_value("LANGCHAIN_VERBOSE", "false").lower() == "true",
            max_iterations=int(get_env_value("LANGCHAIN_MAX_ITERATIONS", "10")),
            max_execution_time=int(get_env_value("LANGCHAIN_MAX_EXECUTION_TIME", "60")),
            stream_mcp_tool_events=get_env_value("LANGCHAIN_STREAM_MCP_TOOL_EVENTS", "true").lower() == "true",
            stream_llm_tokens=get_env_value("LANGCHAIN_STREAM_LLM_TOKENS", "true").lower() == "true",
            agui_enabled=get_env_value("LANGCHAIN_AGUI_ENABLED", "false").lower() == "true",
            # LLM provider — defaults to "none" (heuristic-only, no LLM required)
            provider=get_env_value("LANGCHAIN_LLM_PROVIDER", "none"),
            lmstudio_base_url=get_env_value("LMSTUDIO_BASE_URL", "http://localhost:1234/v1"),
            ollama_base_url=get_env_value("OLLAMA_BASE_URL", "http://127.0.0.1:11434"),
            ollama_model=get_env_value("OLLAMA_MODEL", "qwen3:8b"),
            # Anthropic credentials — cloud or LM Studio proxy depending on ANTHROPIC_BASE_URL
            anthropic_api_key=get_env_value("ANTHROPIC_API_KEY", "lm-studio"),
            anthropic_base_url=get_env_value("ANTHROPIC_BASE_URL", ""),
            # Helix — mirrors HELIX_* env vars from demo_api_server
            helix_base_url=get_env_value("HELIX_BASE_URL", "https://openam-helix.forgeblocks.com"),
            helix_api_key=get_env_value("HELIX_API_KEY", ""),
            helix_environment_id=get_env_value("HELIX_ENVIRONMENT_ID", ""),
            helix_agent_id=get_env_value("HELIX_AGENT_ID", "LLM2"),
            helix_prompt_field_id=get_env_value("HELIX_PROMPT_FIELD_ID", ""),
        )
        
        # Chat configuration
        _max_context_tokens = int(get_env_value("LANGCHAIN_MAX_CONTEXT_TOKENS", "4096"))
        if _max_context_tokens <= 0:
            raise ValueError(
                f"LANGCHAIN_MAX_CONTEXT_TOKENS must be a positive integer, got {_max_context_tokens}. "
                "A value of 0 or negative causes trim_messages() to return an empty list, "
                "which would silently discard all conversation history."
            )
        chat_config = ChatConfig(
            websocket_port=int(get_env_value("WEBSOCKET_PORT", "8889")),
            max_message_length=int(get_env_value("MAX_MESSAGE_LENGTH", "4096")),
            conversation_history_limit=int(get_env_value("CONVERSATION_HISTORY_LIMIT", "100")),
            session_cleanup_interval_minutes=int(get_env_value("SESSION_CLEANUP_INTERVAL_MINUTES", "15")),
            max_session_workers=int(get_env_value("MAX_SESSION_WORKERS", "50")),
            session_worker_idle_ttl_seconds=int(get_env_value("SESSION_WORKER_IDLE_TTL_SECONDS", "900")),
            session_worker_reap_interval_seconds=int(get_env_value("SESSION_WORKER_REAP_INTERVAL_SECONDS", "60")),
            chat_ws_host=get_env_value("CHAT_WS_HOST", "127.0.0.1"),
            allowed_ws_origins=get_env_value(
                "ALLOWED_WS_ORIGINS",
                "https://api.ping.demo:4000,http://localhost:4000,http://127.0.0.1:4000",
            ),
            ws_max_message_bytes=int(get_env_value("WS_MAX_MESSAGE_BYTES", str(64 * 1024))),
            health_http_port=int(get_env_value("HEALTH_HTTP_PORT", "8890")),
            agui_http_host=get_env_value("AGUI_HTTP_HOST", "127.0.0.1"),
            agui_http_port=int(get_env_value("AGUI_HTTP_PORT", "8888")),
            max_context_tokens=_max_context_tokens,
        )
        
        config = AppConfig(
            environment=env_name,
            debug=get_env_value("DEBUG", "false").lower() == "true",
            log_level=get_env_value("LOG_LEVEL", "INFO"),
            pingone=pingone_config,
            security=security_config,
            mcp=mcp_config,
            chat=chat_config,
            langchain=langchain_config
        )
        
        # Validate configuration for the environment
        self.validate_environment_config(config)
        
        return config
    
    def _load_config_file(self) -> Dict[str, str]:
        """Load configuration from JSON file."""
        try:
            with open(self.config_file, 'r') as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError) as e:
            raise ValueError(f"Failed to load configuration file {self.config_file}: {e}")
    
    def save_config_to_file(self, config: AppConfig, output_path: Path) -> None:
        """Save current configuration to JSON file (excluding sensitive data)."""
        config_dict = asdict(config)
        
        # Remove sensitive information
        if 'pingone' in config_dict:
            if config_dict['pingone'].get('user_client_secret'):
                config_dict['pingone']['user_client_secret'] = "[REDACTED]"
            if config_dict['pingone'].get('agent_client_secret'):
                config_dict['pingone']['agent_client_secret'] = "[REDACTED]"

        if 'langchain' in config_dict:
            config_dict['langchain']['openai_api_key'] = "[REDACTED]"
        
        with open(output_path, 'w') as f:
            json.dump(config_dict, f, indent=2, default=str)
    
    def _get_required_env(self, key: str, file_config: Dict[str, str], defaults: Dict[str, Any]) -> str:
        """Get required environment variable from multiple sources or raise error."""
        value = (os.getenv(key) or 
                file_config.get(key) or 
                defaults.get(key))
        
        if not value:
            raise ValueError(f"Required configuration value {key} is not set in environment variables, config file, or defaults")
        return value
    
    def get_mcp_server_configs(self) -> Dict[str, Dict[str, Any]]:
        """Load MCP server configurations from environment variables."""
        configs = {}

        # HI-04: in production, agent bearer tokens travel via Authorization
        # header over WebSocket. Plain ws:// puts them on the wire in clear
        # text. Reject anything that isn't wss:// or local:// at startup so
        # the misconfiguration is loud, not silent.
        environment = (os.getenv("ENVIRONMENT") or "development").lower()
        is_production = environment == "production"

        # Look for MCP server configurations in format: MCP_SERVER_{NAME}_ENDPOINT
        for key, value in os.environ.items():
            if key.startswith("MCP_SERVER_") and key.endswith("_ENDPOINT"):
                # Extract server name from environment variable
                server_name = key.replace("MCP_SERVER_", "").replace("_ENDPOINT", "").lower()

                if is_production and not (value.startswith("wss://") or value.startswith("local://")):
                    raise ValueError(
                        f"MCP server '{server_name}' endpoint must use wss:// or local:// "
                        f"in production (got {value.split('://')[0]}://...)"
                    )

                # IN-05: "".split(",") yields [""] (one empty element), not
                # []. Downstream treats this as a list of capabilities, so an
                # unset env var leaked a phantom "" capability. Filter empties.
                capabilities = [
                    c.strip()
                    for c in os.getenv(
                        f"MCP_SERVER_{server_name.upper()}_CAPABILITIES", ""
                    ).split(",")
                    if c.strip()
                ]

                configs[server_name] = {
                    "endpoint": value,
                    "capabilities": capabilities,
                    "auth_required": os.getenv(f"MCP_SERVER_{server_name.upper()}_AUTH_REQUIRED", "false").lower() == "true"
                }

        return configs


# Global configuration instance
config_manager = ConfigManager()


def get_config() -> AppConfig:
    """Get the application configuration."""
    return config_manager.load_config()


def get_mcp_server_configs() -> Dict[str, Dict[str, Any]]:
    """Get MCP server configurations."""
    return config_manager.get_mcp_server_configs()