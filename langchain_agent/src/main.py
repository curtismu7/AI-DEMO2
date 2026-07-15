#!/usr/bin/env python3
"""
Main application entry point for LangChain MCP OAuth Agent.

This module starts the complete application including:
- OAuth authentication manager
- MCP client manager
- LangChain agent
- WebSocket chat interface
- Session management
"""

import asyncio
import logging
import signal
import sys
from pathlib import Path
from typing import Optional

# Add src to Python path
sys.path.insert(0, str(Path(__file__).parent))

from config.env_validator import validate_environment
from config.settings import get_config
from authentication.oauth_manager import OAuthAuthenticationManager
from mcp.tool_registry import MCPClientManager
from agent.langchain_mcp_agent import LangChainMCPAgent
from api.websocket_handler import ChatWebSocketHandler
from api.message_processor import MessageProcessor
from api.session_manager import SessionManager
from api.health import HealthCheckServer
from log_utils.structured_logger import setup_logging


logger = logging.getLogger(__name__)


class LangChainMCPApplication:
    """Main application class that orchestrates all components."""
    
    def __init__(self):
        self.config = get_config()
        self.oauth_manager: Optional[OAuthAuthenticationManager] = None
        self.mcp_manager: Optional[MCPClientManager] = None
        self.agent: Optional[LangChainMCPAgent] = None
        self.session_manager: Optional[SessionManager] = None
        self.websocket_handler: Optional[ChatWebSocketHandler] = None
        self.message_processor: Optional[MessageProcessor] = None
        self.websocket_server = None
        self.health_server: Optional[HealthCheckServer] = None
        self._agui_server_task: Optional[asyncio.Task] = None
        self._shutdown_event = asyncio.Event()
        
    async def initialize(self):
        """Initialize all application components."""
        logger.info("Initializing LangChain MCP OAuth Agent...")
        
        try:
            # Start health check server first (port 8890 by default; override with HEALTH_HTTP_PORT).
            # 8081 is reserved for banking_mcp_invest in run-bank.sh — do not revert.
            health_port = self.config.chat.health_http_port
            logger.info("Starting health check server on port %s...", health_port)
            self.health_server = HealthCheckServer(port=health_port)
            self.health_server.start()
            
            # Initialize OAuth manager
            logger.info("Initializing OAuth authentication manager...")
            # WR-08: auto_register=False so __aenter__ does NOT call
            # register_client() with no scopes. We want exactly ONE
            # registration, and it must carry additional_scopes=["ai_agent"].
            # The prior default (auto_register=True) double-registered on every
            # startup: __aenter__'s scopeless register_client() then this
            # explicit one — under DCR that orphans the first client in
            # PingOne (no registration_access_token retained → undeletable),
            # accumulating toward the tenant client cap on every restart.
            self.oauth_manager = OAuthAuthenticationManager(
                self.config, auto_register=False
            )
            await self.oauth_manager.__aenter__()
            self.health_server.update_status("oauth_manager", "initializing")

            # Register OAuth client with ai_agent scope (the single registration)
            logger.info("Registering OAuth client with ai_agent scope...")
            await self.oauth_manager.register_client(additional_scopes=["ai_agent"])
            self.health_server.update_status("oauth_manager", "ready")
            
            # Initialize MCP client manager
            logger.info("Initializing MCP client manager...")
            self.mcp_manager = MCPClientManager()
            
            # Register MCP servers from configuration
            await self._register_mcp_servers()
            
            self.health_server.update_status("mcp_manager", "ready")
            
            # Initialize LangChain agent
            logger.info("Initializing LangChain agent...")
            self.agent = LangChainMCPAgent(
                mcp_client_manager=self.mcp_manager,
                auth_manager=self.oauth_manager,
                config=self.config
            )
            self.health_server.update_status("agent", "initializing")
            
            # Initialize agent tools
            await self.agent.initialize_tools()
            self.health_server.update_status("agent", "ready")
            
            # Initialize session manager
            logger.info("Initializing session manager...")
            self.session_manager = SessionManager(self.config)
            # CR-01: start the periodic cleanup loop. Without this, _sessions /
            # _session_messages / _user_sessions accumulate forever — the
            # session_timeout_minutes config is silently inert.
            await self.session_manager.start()

            # CR-01: same for ConversationMemory cleanup (lives on the agent).
            # Without start_cleanup_task(), _sessions / _messages /
            # _langchain_memories grow unbounded for the process lifetime.
            await self.agent.conversation_memory.start_cleanup_task()

            # Initialize WebSocket handler
            logger.info("Initializing WebSocket handler...")
            self.websocket_handler = ChatWebSocketHandler(self.config)
            
            # Initialize message processor
            logger.info("Initializing message processor...")
            self.message_processor = MessageProcessor(
                agent=self.agent,
                session_manager=self.session_manager,
                websocket_handler=self.websocket_handler,
                config=self.config
            )
            self.health_server.update_status("message_processor", "initializing")
            
            # Wire components together
            self.websocket_handler.set_message_processor(self.message_processor)
            self.websocket_handler.set_session_manager(self.session_manager)
            
            # Start message processor. WR-02 Option A: start() schedules BOTH
            # the ingress dispatcher AND the per-session-worker idle reaper.
            # CR-01-class guard: the reaper is wired but inert unless started
            # here at app init (exactly the CR-01 class of bug — a cleanup
            # loop that exists but is never started). This call sits next to
            # SessionManager.start() / ConversationMemory.start_cleanup_task()
            # above for the same reason.
            await self.message_processor.start()
            self.health_server.update_status("message_processor", "ready")

            # AG-UI /run SSE endpoint: FastAPI on port 8888 (always active).
            from api.agui_run_handler import set_message_processor as set_agui_mp
            set_agui_mp(self.message_processor)
            self._agui_server_task = asyncio.create_task(
                self.start_agui_http_server()
            )
            # Surface fire-and-forget failures: without this callback a crashed
            # AG-UI server dies silently and /run just stops responding.
            self._agui_server_task.add_done_callback(self._on_agui_server_done)
            logger.info(
                "[AG-UI] /run SSE endpoint active on port %s",
                self.config.chat.agui_http_port,
            )

            # MCP Host inspector snapshot (GET /inspector/mcp-host on health :8890
            # and on AG-UI :8888 for the BFF proxy)
            try:
                tools = await self.agent.get_available_tools()
                # WR-09: attribute is `mcp_manager` on this class. The prior
                # `self.mcp_client_manager` reference raised AttributeError,
                # which the surrounding try/except swallowed, leaving
                # /inspector/mcp-host returning 503 "inspector not ready" forever.
                registry = await self.mcp_manager.get_manager_status()
                self.health_server.app_status["mcp_host_inspector"] = {
                    "role": "mcp_host",
                    "summary": (
                        "LangChain process: LLM orchestrates user turns; MCP client executes "
                        "tools over WebSocket to MCP servers (e.g. banking). Chat WebSocket is UI transport."
                    ),
                    "chat_websocket_port": self.config.chat.websocket_port,
                    "mcp_discovery_model": "Host lists tools from MCP via MCPClientManager after connect; model chooses tools/call.",
                    "langchain_tools_exposed_to_llm": tools,
                    "mcp_client_registry": registry,
                }
            except Exception as snap_err:
                logger.warning("MCP host inspector snapshot skipped: %s", snap_err)
            
            # Mark as initialized
            self.health_server.set_initialized(True)
            
            logger.info("✅ All components initialized successfully")
            
        except Exception as e:
            logger.error(f"❌ Failed to initialize application: {e}")
            await self.cleanup()
            raise
    
    async def _register_mcp_servers(self):
        """Register MCP servers from environment configuration."""
        from config.settings import get_mcp_server_configs
        from models.mcp import MCPServerConfig, AuthRequirements, AuthRequirementType
        
        # Register the built-in user management server first
        try:
            logger.info("Registering built-in user management MCP server")
            
            # Create auth requirements for user management server
            auth_requirements = AuthRequirements(
                type=AuthRequirementType.AGENT_TOKEN,
                scopes=["ai_agent"]
            )
            
            # Create server config for local user management server
            user_mgmt_config = MCPServerConfig(
                name="user_management",
                endpoint="local://user_management",
                capabilities=["user_lookup", "account_registration"],
                auth_requirements=auth_requirements
            )
            
            # Register the server
            await self.mcp_manager.register_server(user_mgmt_config)
            logger.info("✅ Successfully registered user management MCP server")
            
        except Exception as e:
            logger.error(f"❌ Failed to register user management MCP server: {e}")
        
        # Get MCP server configurations from environment
        server_configs = get_mcp_server_configs()
        
        if not server_configs:
            logger.info("No additional MCP servers configured in environment")
            return
        
        logger.info(f"Found {len(server_configs)} additional MCP server(s) in configuration")
        
        for server_name, config in server_configs.items():
            try:
                logger.info(f"Registering MCP server: {server_name} at {config['endpoint']}")
                
                # Create auth requirements
                auth_requirements = AuthRequirements(
                    type=AuthRequirementType.AGENT_TOKEN if config.get('auth_required', False) else AuthRequirementType.NONE,
                    scopes=config.get('capabilities', ['read'])
                )
                
                # Create server config
                mcp_server_config = MCPServerConfig(
                    name=server_name,
                    endpoint=config['endpoint'],
                    capabilities=config.get('capabilities', ['read']),
                    auth_requirements=auth_requirements
                )
                
                # Register the server
                await self.mcp_manager.register_server(mcp_server_config)
                logger.info(f"✅ Successfully registered MCP server: {server_name}")
                
            except Exception as e:
                logger.error(f"❌ Failed to register MCP server {server_name}: {e}")
                # Continue with other servers even if one fails
    
    async def start_websocket_server(self):
        """Start the WebSocket server."""
        import websockets

        # Bind to loopback by default (same CR-03 discipline as
        # HEALTH_HTTP_HOST / AGUI_HTTP_HOST). CHAT_WS_HOST allows an explicit
        # override for container networking where the BFF lives in another pod.
        host = self.config.chat.chat_ws_host
        port = self.config.chat.websocket_port

        # HI-01: bound message size and check Origin to defeat 50MB-frame DoS
        # and cross-site WebSocket hijacking. Allowlist comes from
        # ALLOWED_WS_ORIGINS (comma-separated); falls back to the canonical
        # api.ping.demo origin used by run-bank.sh local dev.
        allowed_origins = [
            o.strip()
            for o in self.config.chat.allowed_ws_origins.split(",")
            if o.strip()
        ]
        max_ws_size = self.config.chat.ws_max_message_bytes  # 64KB default

        logger.info(
            f"Starting WebSocket server on {host}:{port} "
            f"(origins={allowed_origins}, max_size={max_ws_size}B)..."
        )

        try:
            self.websocket_server = await websockets.serve(
                self.websocket_handler.handle_connection,
                host,
                port,
                ping_interval=55,
                ping_timeout=10,
                close_timeout=10,
                max_size=max_ws_size,
                origins=allowed_origins,
            )
            
            self.health_server.update_status("websocket_server", "ready")
            logger.info(f"✅ WebSocket server started on ws://{host}:{port}")
            
        except Exception as e:
            self.health_server.update_status("websocket_server", "failed")
            logger.error(f"❌ Failed to start WebSocket server: {e}")
            raise
    
    async def start_agui_http_server(self) -> None:
        """Start FastAPI/uvicorn on port 8888 serving the AG-UI /run SSE endpoint.

        Runs until the application shutdown event fires.
        Binds to 127.0.0.1 only (loopback) — the BFF proxies to it.
        """
        import os as _os
        import uvicorn
        from fastapi import FastAPI
        from fastapi.responses import JSONResponse as _JSONResponse
        from api.agui_run_handler import router as agui_router
        from api.codegraph_handler import router as codegraph_router

        app = FastAPI(title="LangChain AG-UI", docs_url=None, redoc_url=None)
        app.include_router(agui_router)
        app.include_router(codegraph_router, prefix="/codegraph")

        # Heal empty /app/codegraph.db from a prior Refresh that wrote the legacy
        # repo-src path — pod restarts must not re-expose the Code Explorer 503.
        try:
            from codegraph.ensure_index import ensure_query_index
            if ensure_query_index():
                logger.info("[CodeGraph] query index ready at startup")
            else:
                logger.warning(
                    "[CodeGraph] query index missing at startup — Code Explorer "
                    "will 503 until Refresh index (or bake) succeeds"
                )
        except Exception as exc:
            logger.warning("[CodeGraph] startup index check failed: %s", exc)

        # BFF MCP Inspector proxies here (not health :8890). Health binds
        # loopback-only (CR-03); AG-UI :8888 is already reachable in Docker/K8s
        # via LANGCHAIN_AGENT_HTTP_URL and is gated by the secret below.
        health_server = self.health_server

        @app.get("/inspector/mcp-host")
        async def mcp_host_inspector():
            """Return the MCP Host inspector snapshot for the BFF demo UI."""
            payload = (
                health_server.app_status.get("mcp_host_inspector")
                if health_server
                else None
            )
            if not payload:
                return _JSONResponse(
                    {
                        "error": "inspector_not_ready",
                        "message": (
                            "Host inspector snapshot not populated yet "
                            "(agent still starting)."
                        ),
                    },
                    status_code=503,
                )
            return payload

        # Gate the ENTIRE app (AG-UI /run, /codegraph/*, /inspector/*) on the
        # shared internal secret. The BFF proxies here with
        # `x-internal-gateway-secret: <BFF_INTERNAL_SECRET>` (routes/agentRun.js,
        # routes/codegraphProxy.js, routes/mcpInspector.js) and is the only
        # legitimate caller. Docker publishes this port on 0.0.0.0, so every
        # route must require the secret — not just /run: /codegraph/query
        # drives an LLM (spends the API key + reads the source tree),
        # /codegraph/reindex spawns the CPU-heavy indexer, and
        # /inspector/mcp-host leaks the MCP tool registry. The health server
        # (port 8890, loopback-only) and the hardened WebSocket transport are
        # separate servers with their own controls.

        _DEFAULT_INTERNAL_SECRET = "dev-shared-secret-change-me"
        _env_name = str(getattr(self.config, "environment", None)
                        or _os.environ.get("ENVIRONMENT") or "development").lower()
        _is_dev = _env_name in {"development", "dev", "test", "local"}
        _gate_secret = _os.environ.get("BFF_INTERNAL_SECRET", "")
        _gate_disabled_reason = None
        if not _gate_secret or _gate_secret == _DEFAULT_INTERNAL_SECRET:
            if _is_dev:
                # Dev/test only: allow the well-known default so local runs work.
                _gate_secret = _gate_secret or _DEFAULT_INTERNAL_SECRET
                logger.warning(
                    "[AG-UI] BFF_INTERNAL_SECRET is unset/default in %s — set it "
                    "before deploying.", _env_name,
                )
            else:
                # Fail closed: never accept the public default outside dev.
                _gate_disabled_reason = (
                    "BFF_INTERNAL_SECRET is unset or the well-known default outside "
                    f"development (environment={_env_name!r})"
                )
                logger.error(
                    "[AG-UI] %s — refusing all /run and /codegraph requests "
                    "(fail-closed).", _gate_disabled_reason,
                )

        @app.middleware("http")
        async def _gate_internal(request, call_next):
            if _gate_disabled_reason is not None:
                return _JSONResponse(
                    {"detail": "internal endpoint disabled: " + _gate_disabled_reason},
                    status_code=503,
                )
            secret = request.headers.get("x-internal-gateway-secret", "")
            if not secret:
                return _JSONResponse(
                    {"detail": "Missing x-internal-gateway-secret header"}, status_code=401
                )
            if secret != _gate_secret:
                return _JSONResponse({"detail": "Invalid gateway secret"}, status_code=403)
            return await call_next(request)

        agui_port = self.config.chat.agui_http_port
        agui_host = self.config.chat.agui_http_host

        config = uvicorn.Config(
            app,
            host=agui_host,
            port=agui_port,
            log_level="warning",
            access_log=False,
        )
        server = uvicorn.Server(config)

        logger.info("[AG-UI] uvicorn starting on %s:%s", agui_host, agui_port)
        try:
            await server.serve()
        except asyncio.CancelledError:
            logger.info("[AG-UI] uvicorn server stopped")
        except Exception as e:
            logger.error(f"❌ AG-UI HTTP server failed: {e}")
            if self.health_server:
                self.health_server.update_status("agui_server", "failed")
            raise

    def _on_agui_server_done(self, task: asyncio.Task) -> None:
        """Done-callback for the fire-and-forget AG-UI server task.

        Logs the failure and records it in health status so a crashed AG-UI
        server is visible at /health instead of dying silently.
        """
        if task.cancelled():
            return
        exc = task.exception()
        if exc is not None:
            logger.error(f"❌ AG-UI HTTP server task failed: {exc}")
            if self.health_server:
                self.health_server.update_status("agui_server", "failed")

    async def run(self):
        """Run the application."""
        try:
            # Initialize components
            await self.initialize()
            
            # Start WebSocket server
            await self.start_websocket_server()
            
            # Register signal handlers
            self._setup_signal_handlers()
            
            logger.info("LangChain MCP OAuth Agent is running")
            logger.info("WebSocket endpoint: ws://localhost:%s", self.config.chat.websocket_port)
            logger.info("Frontend URL: https://api.ping.demo:4000 (if running)")
            hp = self.health_server.port if self.health_server else self.config.chat.health_http_port
            logger.info("Health check: http://localhost:%s/health", hp)
            logger.info("MCP host inspector JSON: http://localhost:%s/inspector/mcp-host", hp)
            logger.info("Press Ctrl+C to stop")
            
            # Wait for shutdown signal
            await self._shutdown_event.wait()
            
        except KeyboardInterrupt:
            logger.info("Received keyboard interrupt, shutting down...")
        except Exception as e:
            logger.error(f"Application error: {e}")
            raise
        finally:
            await self.cleanup()
    
    def _setup_signal_handlers(self):
        """Setup signal handlers for graceful shutdown."""
        def signal_handler(signum, frame):
            logger.info(f"Received signal {signum}, initiating shutdown...")
            self._shutdown_event.set()
        
        signal.signal(signal.SIGINT, signal_handler)
        signal.signal(signal.SIGTERM, signal_handler)
    
    async def cleanup(self):
        """Cleanup all resources."""
        logger.info("Cleaning up application resources...")
        
        try:
            # Stop health check server
            if self.health_server:
                self.health_server.stop()
                logger.info("✅ Health check server stopped")
            
            # Stop AG-UI uvicorn server task (if running)
            if self._agui_server_task and not self._agui_server_task.done():
                self._agui_server_task.cancel()
                try:
                    await self._agui_server_task
                except asyncio.CancelledError:
                    pass
                logger.info("✅ AG-UI HTTP server stopped")

            # Stop WebSocket server
            if self.websocket_server:
                self.websocket_server.close()
                await self.websocket_server.wait_closed()
                logger.info("✅ WebSocket server stopped")
            
            # Stop message processor
            if self.message_processor:
                await self.message_processor.stop()
                logger.info("✅ Message processor stopped")
            
            # Shutdown WebSocket handler
            if self.websocket_handler:
                await self.websocket_handler.shutdown()
                logger.info("✅ WebSocket handler shutdown")
            
            # Shutdown session manager
            if self.session_manager:
                await self.session_manager.shutdown()
                logger.info("✅ Session manager shutdown")
            
            # Shutdown agent
            if self.agent:
                await self.agent.shutdown()
                logger.info("✅ Agent shutdown")
            
            # Shutdown MCP manager
            if self.mcp_manager:
                await self.mcp_manager.shutdown()
                logger.info("✅ MCP manager shutdown")
            
            # Shutdown OAuth manager
            if self.oauth_manager:
                await self.oauth_manager.__aexit__(None, None, None)
                logger.info("✅ OAuth manager shutdown")
            
            logger.info("🏁 Application cleanup complete")
            
        except Exception as e:
            logger.error(f"Error during cleanup: {e}")


async def main():
    """Main entry point."""
    # Bootstrap logging at the default level so config errors are visible,
    # then re-apply with the configured LOG_LEVEL once config is loaded.
    setup_logging()

    logger.info("Starting LangChain MCP OAuth Agent...")

    try:
        # Validate environment variables early, before attempting to load config
        validate_environment()

        # Validate configuration
        config = get_config()
        setup_logging(level=config.log_level)
        logger.info(f"Running in {config.environment} environment")
        
        # Create and run application
        app = LangChainMCPApplication()
        await app.run()
        
    except Exception as e:
        logger.error(f"Failed to start application: {e}")
        sys.exit(1)


if __name__ == "__main__":
    # Run the application
    asyncio.run(main())