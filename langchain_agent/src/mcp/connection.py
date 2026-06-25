"""
MCP connection management with pooling and retry logic.
"""
import asyncio
import logging
import secrets
import uuid
from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta
from enum import Enum
import json
import inspect
import traceback
import httpx
import websockets
from websockets.exceptions import ConnectionClosed, WebSocketException

# Transport selection:
#   MCPConnection               — WebSocket (ws:// / wss://), default for local dev.
#                                 Maintains a persistent connection; handles reconnect.
#   StreamableHttpMCPConnection — Streamable HTTP (http:// / https://), MCP spec 2025-03-26
#                                 preferred. Stateless POST /mcp per JSON-RPC call, session
#                                 tracked via Mcp-Session-Id header. No persistent socket.
#                                 Simpler reconnect: just re-send initialize on 404.
#                                 Enable with MCP_TRANSPORT=streamable_http in .env.


# websockets renamed extra_headers -> additional_headers in v13. Detect which
# kwarg the installed version accepts so we work on both v11/12 and v13+.
def _ws_header_kwarg() -> str:
    try:
        sig = inspect.signature(websockets.connect)
        if "additional_headers" in sig.parameters:
            return "additional_headers"
    except (TypeError, ValueError):
        pass
    return "extra_headers"


_WS_HEADER_KWARG = _ws_header_kwarg()

from config.settings import get_config
from models.mcp import MCPServerConfig, MCPToolCall, AuthChallenge
from models.auth import AccessToken
from services.interfaces import MCPClient
from .local_connection import LocalMCPConnection


logger = logging.getLogger(__name__)


class ConnectionState(Enum):
    """Connection states for MCP connections"""
    DISCONNECTED = "disconnected"
    CONNECTING = "connecting"
    CONNECTED = "connected"
    RECONNECTING = "reconnecting"
    FAILED = "failed"


class MCPConnectionClosedError(Exception):
    """Raised to fail in-flight requests when the shared connection closes.

    The single per-connection reader task rejects every pending request future
    with this error on connection close/error so callers fail fast instead of
    hanging until their per-request timeout (CR-06).
    """


class MCPRequestTimeoutError(Exception):
    """Raised when a single JSON-RPC request exceeds its per-request timeout.

    The pending entry is removed before raising so the shared connection stays
    usable for other waiters (CR-06).
    """


class MCPServerCancelledError(Exception):
    """Raised when the MCP server sends notifications/cancelled for an in-flight request."""


class MCPConnection(MCPClient):
    """Individual MCP server connection with retry logic"""
    
    def __init__(self, server_config: MCPServerConfig, max_retries: int = 3, 
                 retry_delay: float = 1.0, connection_timeout: float = 30.0):
        self.server_config = server_config
        self.max_retries = max_retries
        self.retry_delay = retry_delay
        self.connection_timeout = connection_timeout
        
        self._websocket: Optional[websockets.WebSocketClientProtocol] = None
        self._state = ConnectionState.DISCONNECTED
        self._last_error: Optional[Exception] = None
        self._retry_count = 0
        self._available_tools: List[str] = []
        self._tool_schemas: Dict[str, Dict[str, Any]] = {}
        self._connection_lock = asyncio.Lock()
        # CR-06: JSON-RPC id correlation. There is exactly ONE consumer of
        # self._websocket.recv() per connection — the reader task started in
        # connect(). Every request registers a Future in self._pending keyed by
        # its unique JSON-RPC id BEFORE sending, then awaits that Future. The
        # reader demultiplexes incoming frames by id back to the right waiter.
        # No other code path may call self._websocket.recv() directly.
        self._pending: Dict[Any, asyncio.Future] = {}
        self._reader_task: Optional[asyncio.Task] = None
        self._agent_token: Optional[str] = None  # Used as Authorization header on (re)connect
        # WR-11: CSRF state for synthesized auth challenges. The old value was
        # the predictable f"session_{session_id}". Generate a cryptographically
        # random state per challenge and keep the state -> session_id mapping
        # here so the callback can still resolve which session a returned state
        # belongs to (and reject a forged/unknown state).
        self._auth_challenge_states: Dict[str, str] = {}
        
        logger.info(f"Initialized MCP connection for server: {server_config.name}")
    
    @property
    def state(self) -> ConnectionState:
        """Get current connection state"""
        return self._state
    
    @property
    def is_connected(self) -> bool:
        """Check if connection is active"""
        return self._state == ConnectionState.CONNECTED and self._websocket is not None
    
    @property
    def last_error(self) -> Optional[Exception]:
        """Get last connection error"""
        return self._last_error
    
    def _new_auth_challenge_state(self, session_id: str) -> str:
        """Mint a cryptographically random CSRF state for an auth challenge
        and correlate it back to the originating session (WR-11).

        secrets.token_urlsafe(32) yields ~43 unguessable URL-safe chars —
        unlike the old f"session_{session_id}" which a client could trivially
        derive. The mapping lets validate_auth_challenge_state() reject any
        returned state we did not issue (forged/replayed) and recover the
        session for a legitimate one.
        """
        state = secrets.token_urlsafe(32)
        self._auth_challenge_states[state] = session_id
        return state

    def validate_auth_challenge_state(self, state: str) -> Optional[str]:
        """Return the session_id bound to ``state`` (single-use) or None if
        the state was never issued by this connection (WR-11)."""
        return self._auth_challenge_states.pop(state, None)

    async def connect(self, server_config: MCPServerConfig) -> None:
        """Establish connection to MCP server with retry logic"""
        async with self._connection_lock:
            if self.is_connected:
                logger.debug(f"Already connected to {server_config.name}")
                return
            
            self._state = ConnectionState.CONNECTING
            self._retry_count = 0
            
            while self._retry_count <= self.max_retries:
                try:
                    logger.info(f"Connecting to MCP server {server_config.name} (attempt {self._retry_count + 1})")
                    
                    # Connect to WebSocket endpoint — pass Authorization header if agent token available
                    _ws_kwargs: Dict[str, Any] = {}
                    if self._agent_token:
                        _ws_kwargs[_WS_HEADER_KWARG] = [('Authorization', f'Bearer {self._agent_token}')]
                        logger.debug(f"Connecting to {server_config.name} with Authorization header")
                    self._websocket = await asyncio.wait_for(
                        websockets.connect(server_config.endpoint, **_ws_kwargs),
                        timeout=self.connection_timeout
                    )

                    # CR-06: enforce exactly ONE reader per connection — tear
                    # down any prior reader (e.g. from a lost socket during
                    # reconnect) before starting the new one. Start it BEFORE
                    # the handshake: _perform_handshake / _refresh_tools now go
                    # through the id-correlated request path and need a running
                    # demultiplexer.
                    await self._stop_reader()
                    self._start_reader()

                    # Perform handshake
                    await self._perform_handshake()
                    
                    # List available tools
                    await self._refresh_tools()
                    
                    self._state = ConnectionState.CONNECTED
                    self._last_error = None
                    self._retry_count = 0
                    
                    logger.info(f"Successfully connected to MCP server {server_config.name}")
                    return
                    
                except (ConnectionClosed, WebSocketException, asyncio.TimeoutError, ConnectionError,
                        MCPRequestTimeoutError, MCPConnectionClosedError) as e:
                    self._last_error = e
                    self._retry_count += 1
                    # Close the just-opened socket and stop the reader so a
                    # failed handshake never leaks either across retries.
                    await self._abort_connect_attempt()

                    if self._retry_count <= self.max_retries:
                        delay = self.retry_delay * (2 ** (self._retry_count - 1))  # Exponential backoff
                        logger.warning(f"Connection failed for {server_config.name}, retrying in {delay}s: {e}")
                        await asyncio.sleep(delay)
                    else:
                        self._state = ConnectionState.FAILED
                        logger.error(f"Failed to connect to {server_config.name} after {self.max_retries} attempts: {e}")
                        raise

                except Exception as e:
                    self._last_error = e
                    self._state = ConnectionState.FAILED
                    # Same teardown as the retryable branch — no socket/reader leak.
                    await self._abort_connect_attempt()
                    logger.error(f"Unexpected error connecting to {server_config.name}: {e}")
                    raise
    
    async def disconnect(self) -> None:
        """Close connection to MCP server"""
        async with self._connection_lock:
            if self._websocket:
                try:
                    await self._websocket.close()
                    logger.info(f"Disconnected from MCP server {self.server_config.name}")
                except Exception as e:
                    logger.warning(f"Error during disconnect from {self.server_config.name}: {e}")
                finally:
                    self._websocket = None
                    self._state = ConnectionState.DISCONNECTED
                    self._available_tools = []
                    self._tool_schemas = {}
                    self._auth_challenge_states = {}
            # CR-06: tear down the reader task and reject any stragglers so no
            # orphaned task survives and no caller hangs across a reconnect.
            await self._stop_reader()
            self._fail_all_pending(
                MCPConnectionClosedError(
                    f"MCP connection to {self.server_config.name} closed"
                )
            )

    def _start_reader(self) -> None:
        """Start the single per-connection reader task (CR-06).

        Exactly one consumer of self._websocket.recv() per connection.
        """
        if self._reader_task is not None and not self._reader_task.done():
            return
        self._reader_task = asyncio.create_task(self._read_loop())

    async def _stop_reader(self) -> None:
        """Cancel and await the reader task so there is no orphaned task."""
        task = self._reader_task
        self._reader_task = None
        if task is None:
            return
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            # Swallow only the reader task's own cancellation; re-raise if
            # this coroutine itself was cancelled externally.
            if not task.cancelled():
                raise
        except Exception:  # noqa: BLE001 - teardown
            pass

    async def _abort_connect_attempt(self) -> None:
        """Tear down a half-open connection after a failed connect attempt.

        Closes the just-opened websocket and stops the reader task (mirroring
        disconnect(), minimally) so neither leaks across retries or raises.
        """
        ws = self._websocket
        self._websocket = None
        if ws is not None:
            try:
                await ws.close()
            except Exception as e:  # noqa: BLE001 - teardown
                logger.debug(f"Error closing socket after failed connect to {self.server_config.name}: {e}")
        await self._stop_reader()

    def _fail_all_pending(self, error: Exception) -> None:
        """Reject every in-flight request future immediately (CR-06).

        Mirrors the gateway/agent-service pattern: a closed connection fails
        all pending requests now rather than letting each hang until its own
        per-request timeout.
        """
        pending = self._pending
        self._pending = {}
        for fut in pending.values():
            if not fut.done():
                fut.set_exception(error)

    async def _read_loop(self) -> None:
        """Single per-connection frame demultiplexer (CR-06).

        Loops recv() on the shared WebSocket and routes each frame to the
        waiter whose JSON-RPC id matches. id-less frames (notifications) are
        logged and dropped — never resolve a random waiter. A malformed frame
        is logged and skipped (the loop survives). On connection close/error
        every pending future is rejected with MCPConnectionClosedError and the
        loop exits cleanly.
        """
        ws = self._websocket
        try:
            while True:
                raw = await ws.recv()
                try:
                    frame = json.loads(raw)
                except (json.JSONDecodeError, TypeError, ValueError) as e:
                    logger.warning(
                        f"Discarding malformed frame from {self.server_config.name}: {e}"
                    )
                    continue

                msg_id = frame.get("id") if isinstance(frame, dict) else None
                if msg_id is None:
                    # JSON-RPC notification / id-less frame.
                    method = frame.get("method") if isinstance(frame, dict) else None
                    if method == "notifications/cancelled":
                        rid = (frame.get("params") or {}).get("requestId")
                        if rid is not None and rid in self._pending:
                            fut = self._pending.pop(rid)
                            if not fut.done():
                                reason = frame.get("params", {}).get("reason", "")
                                fut.set_exception(MCPServerCancelledError(
                                    f"MCP server cancelled requestId={rid}: {reason}"
                                ))
                                logger.info(
                                    f"Received notifications/cancelled for requestId={rid} "
                                    f"from {self.server_config.name} — cancelling pending future"
                                )
                        else:
                            logger.debug(
                                f"notifications/cancelled for unknown requestId={rid!r} from "
                                f"{self.server_config.name} — ignored"
                            )
                    else:
                        logger.debug(
                            f"Unsolicited/notification frame from "
                            f"{self.server_config.name} "
                            f"(no id, method={method!r}) — dropped"
                        )
                    continue

                fut = self._pending.pop(msg_id, None)
                if fut is None:
                    logger.debug(
                        f"Frame for unknown/expired id={msg_id} from "
                        f"{self.server_config.name} — dropped"
                    )
                    continue
                if not fut.done():
                    fut.set_result(frame)
        except asyncio.CancelledError:
            raise
        except (ConnectionClosed, WebSocketException) as e:
            logger.info(
                f"Reader loop ending for {self.server_config.name}: {e}"
            )
        except Exception as e:  # noqa: BLE001 - reader must never crash silently
            logger.error(
                f"Unexpected error in reader loop for "
                f"{self.server_config.name}: {e}"
            )
        finally:
            # Reader death means this socket is unusable: drop it and flip the
            # state so is_connected goes false. Guard on identity so a reader
            # for an old socket cannot clobber a newer connection.
            if self._websocket is ws:
                self._websocket = None
                self._state = ConnectionState.DISCONNECTED
            self._fail_all_pending(
                MCPConnectionClosedError(
                    f"MCP connection to {self.server_config.name} lost "
                    f"while requests were in flight"
                )
            )

    async def _send_request(self, message: Dict[str, Any]) -> Dict[str, Any]:
        """Send a JSON-RPC request and await its correlated response (CR-06).

        Registers a Future under message["id"] BEFORE sending, awaits it with
        the per-request timeout (reuses self.connection_timeout — the existing
        MCP_CONNECTION_TIMEOUT_SECONDS config key), and always removes the
        pending entry on completion/timeout/error so the registry never leaks.
        """
        msg_id = message["id"]
        loop = asyncio.get_running_loop()
        fut: asyncio.Future = loop.create_future()
        self._pending[msg_id] = fut
        try:
            await self._websocket.send(json.dumps(message))
            return await asyncio.wait_for(fut, timeout=self.connection_timeout)
        except asyncio.TimeoutError:
            raise MCPRequestTimeoutError(
                f"MCP request id={msg_id} to {self.server_config.name} timed "
                f"out after {self.connection_timeout}s"
            )
        finally:
            self._pending.pop(msg_id, None)
    
    async def call_tool(self, tool_call: MCPToolCall) -> Dict[str, Any]:
        """Execute a tool call on the MCP server using JSON-RPC 2.0 format"""
        if not self.is_connected:
            await self._ensure_connected()

        # Zero-trust: move agent token to Authorization header rather than JSON-RPC params.
        # Reconnect with the header when the token changes (first call, or after token refresh).
        if tool_call.agent_token:
            new_token = tool_call.agent_token.token
            if new_token != self._agent_token:
                logger.info(f"Agent token changed — reconnecting to {self.server_config.name} with Authorization header")
                self._agent_token = new_token
                if self.is_connected:
                    await self.disconnect()
                await self._ensure_connected()

        try:
            # Prepare tool call message using JSON-RPC 2.0 format
            params = {
                "name": tool_call.tool_name,
                "arguments": tool_call.parameters
            }

            # agentToken is now passed as the Authorization header at WebSocket connect time
            # (see self._agent_token / _ws_kwargs in connect()). Do not include in params.

            # Include user auth code if available
            if tool_call.user_auth_code:
                params["userAuthCode"] = tool_call.user_auth_code.code
                logger.debug(f"Including user auth code in request")
            
            message = {
                "jsonrpc": "2.0",
                # CR-06: uuid4 guarantees a unique id even for two calls in the
                # same millisecond (datetime.now().timestamp() could collide).
                "id": str(uuid.uuid4()),
                "method": "tools/call",
                "params": params
            }
            
            # BL-01: redact userAuthCode from the logged JSON-RPC envelope.
            # The full `message` dict embeds params["userAuthCode"] which is the
            # raw OAuth authorization code — never safe for stdout/file logs.
            redacted_message = {**message, "params": {**params}}
            if "userAuthCode" in redacted_message["params"]:
                redacted_message["params"] = {**redacted_message["params"], "userAuthCode": "[REDACTED]"}
            logger.info(f"Sending tools/call request to {self.server_config.name}: {redacted_message}")
            logger.debug(f"Tool call details - name: {tool_call.tool_name}, params: {tool_call.parameters}")
            logger.debug(f"Session ID: {tool_call.session_id}")
            logger.debug(f"Agent token present: {tool_call.agent_token is not None}")
            logger.debug(f"User auth code present: {tool_call.user_auth_code is not None}")
            
            # CR-06: send + await the id-correlated response. The single
            # per-connection reader task demultiplexes frames by JSON-RPC id,
            # so concurrent call_tool() invocations on this shared connection
            # can no longer receive each other's responses.
            logger.debug(f"Sending message to MCP server, awaiting correlated response...")
            response = await self._send_request(message)
            # WR-04: the response body carries balances / transactions / PII
            # (and potentially tokens). Log only non-sensitive metadata at
            # info; the full body stays at debug. Mirrors the redaction
            # contract already applied to the outbound envelope above and does
            # not change the CR-06 reader-loop logging.
            _resp_id = response.get("id") if isinstance(response, dict) else None
            _resp_keys = (
                sorted(response.keys()) if isinstance(response, dict) else "non-dict"
            )
            _resp_status = (
                "error" if isinstance(response, dict) and "error" in response else "ok"
            )
            logger.info(
                f"Received tools/call response from {self.server_config.name}: "
                f"id={_resp_id} status={_resp_status} keys={_resp_keys}"
            )
            logger.debug(
                f"Full tools/call response body from {self.server_config.name}: {response}"
            )
            
            # Check for JSON-RPC error
            if "error" in response:
                error = response["error"]
                error_code = error.get('code', 'unknown')
                error_msg = error.get('message', 'Unknown error')
                error_data = error.get('data', {})
                
                logger.info(f"Tool call JSON-RPC error from {self.server_config.name}: Code {error_code}, Message: {error_msg}")
                logger.debug(f"Error data: {error_data}")
                
                # Handle authentication errors by triggering auth challenge
                if error_code == -32001 or error_data.get('type') == 'authentication_error':
                    logger.info(f"Authentication required for {self.server_config.name}, creating auth challenge")
                    
                    # Create an authentication challenge
                    # This should trigger the user authorization flow
                    # WR-11: unpredictable, session-correlated CSRF state
                    # instead of the guessable f"session_{session_id}".
                    # Plain scopes only (repo contract): derive from the
                    # server's error payload when present, else "read write".
                    scope = error_data.get("scope") if isinstance(error_data, dict) else None
                    if isinstance(scope, (list, tuple)):
                        scope = " ".join(str(s) for s in scope)
                    if not (isinstance(scope, str) and scope.strip()):
                        scope = "read write"
                    challenge = AuthChallenge(
                        challenge_type="oauth_authorization_code",
                        # Placeholder — the real URL is generated by the auth
                        # manager downstream (which ignores this field).
                        authorization_url="https://auth-manager.invalid/authorize",
                        scope=scope,
                        state=self._new_auth_challenge_state(tool_call.session_id)
                    )
                    return {"type": "auth_challenge", "challenge": challenge}
                
                # For other errors, raise exception
                full_error_msg = f"JSON-RPC Error {error_code}: {error_msg}"
                logger.error(f"Tool call error from {self.server_config.name}: {full_error_msg}")
                raise Exception(f"MCP server error: {full_error_msg}")
            
            # Handle authentication challenges (if the server supports them)
            if "result" in response and isinstance(response["result"], dict):
                result = response["result"]
                if result.get("type") == "auth_challenge":
                    logger.info(f"Authentication challenge received from {self.server_config.name}")
                    challenge = AuthChallenge(
                        challenge_type=result["challenge_type"],
                        authorization_url=result["authorization_url"],
                        scope=result["scope"],
                        state=result["state"]
                    )
                    return {"type": "auth_challenge", "challenge": challenge}
            
            # Return successful response
            result = response.get("result", {})
            # WR-04: result bodies carry balances/PII — debug only.
            logger.debug(f"Tool call successful, returning result: {result}")
            return result
            
        except (ConnectionClosed, WebSocketException, MCPConnectionClosedError) as e:
            logger.error(f"Connection lost during tool call to {self.server_config.name}: {e}")
            await self._handle_connection_loss()
            raise

        except Exception as e:
            logger.error(f"Error executing tool call on {self.server_config.name}: {e}")
            logger.error(f"Exception type: {type(e)}")
            logger.error(f"Full traceback: {traceback.format_exc()}")
            raise

    async def list_tools(self) -> List[str]:
        """List available tools on the MCP server"""
        if not self.is_connected:
            await self._ensure_connected()
        
        return self._available_tools.copy()
    
    async def get_tool_schema(self, tool_name: str) -> Optional[Dict[str, Any]]:
        """Get schema for a specific tool"""
        if not self.is_connected:
            await self._ensure_connected()
        
        return self._tool_schemas.get(tool_name)
    
    async def handle_auth_challenge(self, challenge: AuthChallenge) -> Dict[str, Any]:
        """Handle authentication challenge from MCP server"""
        if not self.is_connected:
            await self._ensure_connected()
        
        try:
            # Send challenge response. CR-06: carry an `id` so the single
            # per-connection reader can correlate the response back to this
            # caller (the server is expected to echo the id; an id-less reply
            # would be dropped by the reader as a notification).
            message = {
                "type": "auth_challenge_response",
                "id": str(uuid.uuid4()),
                "challenge_type": challenge.challenge_type,
                "state": challenge.state
            }
            return await self._send_request(message)

        except Exception as e:
            logger.error(f"Error handling auth challenge for {self.server_config.name}: {e}")
            raise
    
    async def _perform_handshake(self) -> None:
        """Perform initial handshake with MCP server using JSON-RPC 2.0"""
        # Send initialize request according to banking MCP server specification.
        # CR-06: uuid4 id + id-correlated send so a reconnect's handshake can
        # never collide with a prior one and the reader routes the reply here.
        handshake_id = str(uuid.uuid4())
        initialize_message = {
            "jsonrpc": "2.0",
            "id": handshake_id,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "tools": {
                        "listChanged": False
                    }
                }
            }
        }

        response = await self._send_request(initialize_message)

        # Check for JSON-RPC error
        if "error" in response:
            raise Exception(f"Initialize error: {response['error']}")

        # Validate initialize response
        if response.get("id") != handshake_id or "result" not in response:
            raise Exception(f"Invalid initialize response: {response}")
        
        # Send initialized notification (if required by the server)
        # Note: Some MCP servers may not require this notification
        initialized_message = {
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        }
        
        await self._websocket.send(json.dumps(initialized_message))
        
        logger.info(f"MCP handshake completed with {self.server_config.name}")
    
    async def _refresh_tools(self) -> None:
        """Refresh list of available tools from server using MCP protocol"""
        try:
            # CR-06: uuid4 id + id-correlated send so concurrent reconnects /
            # in-flight tool calls on the shared connection cannot deliver each
            # other's frames here.
            list_tools_id = str(uuid.uuid4())
            list_tools_message = {
                "jsonrpc": "2.0",
                "id": list_tools_id,
                "method": "tools/list",
                "params": {}
            }

            logger.info(f"Sending tools/list request: {list_tools_message}")
            response = await self._send_request(list_tools_message)

            logger.info(f"Received tools/list response: {response}")
            
            # Check for JSON-RPC error
            if "error" in response:
                logger.warning(f"Error listing tools: {response['error']}")
                self._available_tools = []
                self._tool_schemas = {}
                return
            
            # Extract tools from MCP response
            if response.get("id") == list_tools_id and "result" in response:
                tools_result = response["result"]
                if "tools" in tools_result:
                    # Extract tool names and schemas from MCP tool objects
                    self._available_tools = []
                    self._tool_schemas = {}
                    
                    for tool in tools_result["tools"]:
                        if "name" in tool:
                            tool_name = tool["name"]
                            self._available_tools.append(tool_name)
                            
                            # Store the full tool schema for parameter extraction
                            self._tool_schemas[tool_name] = {
                                "name": tool_name,
                                "description": tool.get("description", ""),
                                "inputSchema": tool.get("inputSchema", {}),
                                "annotations": tool.get("annotations", {})
                            }
                    
                    logger.info(f"Successfully refreshed {len(self._available_tools)} tools for {self.server_config.name}: {self._available_tools}")
                    logger.debug(f"Tool schemas: {self._tool_schemas}")
                else:
                    self._available_tools = []
                    self._tool_schemas = {}
                    logger.warning(f"No 'tools' field in response result: {tools_result}")
            else:
                logger.warning(f"Unexpected response to tools/list: {response}")
                self._available_tools = []
                self._tool_schemas = {}
                
        except Exception as e:
            logger.error(f"Error during tools refresh: {e}")
            self._available_tools = []
            self._tool_schemas = {}
    
    async def _ensure_connected(self) -> None:
        """Ensure connection is active, reconnect if necessary"""
        if not self.is_connected:
            if self._state == ConnectionState.FAILED:
                # Reset state for retry
                self._state = ConnectionState.DISCONNECTED
                self._retry_count = 0
            
            await self.connect(self.server_config)
    
    async def _handle_connection_loss(self) -> None:
        """Handle unexpected connection loss"""
        self._state = ConnectionState.RECONNECTING
        self._websocket = None
        
        try:
            await self._ensure_connected()
        except Exception as e:
            logger.error(f"Failed to reconnect to {self.server_config.name}: {e}")
            self._state = ConnectionState.FAILED


class MCPConnectionPool:
    """Connection pool for managing multiple MCP server connections"""
    
    def __init__(self, max_connections_per_server: int = 5):
        self.max_connections_per_server = max_connections_per_server
        self._connections: Dict[str, List[MCPConnection]] = {}
        self._connection_lock = asyncio.Lock()
        # Per-server-key locks so a slow dial to one server (connect retries
        # can take minutes) never blocks tool calls to other servers. The lock
        # dict itself is only mutated under the global _connection_lock.
        self._server_locks: Dict[str, asyncio.Lock] = {}

        logger.info(f"Initialized MCP connection pool with max {max_connections_per_server} connections per server")

    async def _get_server_lock(self, server_name: str) -> asyncio.Lock:
        """Get (or lazily create, under the global lock) the per-server lock."""
        async with self._connection_lock:
            lock = self._server_locks.get(server_name)
            if lock is None:
                lock = asyncio.Lock()
                self._server_locks[server_name] = lock
            return lock

    async def get_connection(self, server_config: MCPServerConfig) -> MCPClient:
        """Get an available connection for the specified server"""
        server_name = server_config.name
        server_lock = await self._get_server_lock(server_name)
        async with server_lock:
            # Check if this is a local server
            if server_config.endpoint.startswith("local://"):
                # For local servers, create a single connection per server
                if server_name not in self._connections:
                    self._connections[server_name] = []

                connections = self._connections[server_name]

                # Return existing local connection if available
                for connection in connections:
                    if isinstance(connection, LocalMCPConnection) and connection.is_connected:
                        return connection

                # Reuse an existing disconnected local connection
                for connection in connections:
                    if isinstance(connection, LocalMCPConnection) and not connection.is_connected:
                        await connection.connect(server_config)
                        return connection

                # Create new local connection if under limit
                if len(connections) < self.max_connections_per_server:
                    local_connection = LocalMCPConnection(server_config)
                    await local_connection.connect(server_config)
                    connections.append(local_connection)
                    return local_connection

                # At capacity: return the first one and let it handle reconnection
                connection = connections[0]
                if isinstance(connection, LocalMCPConnection) and not connection.is_connected:
                    await connection.connect(server_config)
                return connection

            # Route to StreamableHttpMCPConnection when MCP_TRANSPORT=streamable_http
            # and the endpoint is an HTTP(S) URL. The transport comes from the
            # validated config SSOT (get_config); the endpoint check runs first
            # so non-HTTP server paths never need the full config.
            if (
                server_config.endpoint.startswith(("http://", "https://"))
                and get_config().mcp.mcp_transport == "streamable_http"
            ):
                if server_name not in self._connections:
                    self._connections[server_name] = []

                connections = self._connections[server_name]

                # Return existing connected StreamableHttpMCPConnection if available
                for connection in connections:
                    if isinstance(connection, StreamableHttpMCPConnection) and connection.is_connected:
                        return connection

                # Reuse an existing disconnected instance instead of growing
                # the pool unboundedly
                for connection in connections:
                    if isinstance(connection, StreamableHttpMCPConnection) and not connection.is_connected:
                        await connection.connect(server_config)
                        return connection

                # Create and connect a new StreamableHttpMCPConnection if under limit
                if len(connections) < self.max_connections_per_server:
                    http_conn = StreamableHttpMCPConnection(server_config)
                    await http_conn.connect(server_config)
                    connections.append(http_conn)
                    return http_conn

                # At capacity: return the first one and let it handle reconnection
                connection = connections[0]
                if isinstance(connection, StreamableHttpMCPConnection) and not connection.is_connected:
                    await connection.connect(server_config)
                return connection

            # Handle WebSocket connections (existing logic)
            # Initialize connection list for server if not exists
            if server_name not in self._connections:
                self._connections[server_name] = []
            
            connections = self._connections[server_name]
            
            # Find an available connected connection
            for connection in connections:
                if isinstance(connection, MCPConnection) and connection.is_connected:
                    return connection
            
            # Find a disconnected connection to reuse
            for connection in connections:
                if isinstance(connection, MCPConnection) and connection.state == ConnectionState.DISCONNECTED:
                    await connection.connect(server_config)
                    return connection
            
            # Create new connection if under limit
            if len(connections) < self.max_connections_per_server:
                connection = MCPConnection(server_config)
                await connection.connect(server_config)
                connections.append(connection)
                return connection
            
            # All connections are busy or failed, wait for one to become available
            # For now, just return the first one and let it handle reconnection
            if connections:
                connection = connections[0]
                if isinstance(connection, MCPConnection) and not connection.is_connected:
                    await connection.connect(server_config)
                return connection
            
            # Fallback: create new connection (shouldn't reach here normally)
            connection = MCPConnection(server_config)
            await connection.connect(server_config)
            connections.append(connection)
            return connection
    
    async def close_all_connections(self) -> None:
        """Close all connections in the pool"""
        async with self._connection_lock:
            for server_connections in self._connections.values():
                for connection in server_connections:
                    await connection.disconnect()
            
            self._connections.clear()
            logger.info("Closed all connections in MCP connection pool")
    
    async def get_pool_status(self) -> Dict[str, Dict[str, Any]]:
        """Get status of all connections in the pool"""
        status = {}
        
        for server_name, connections in self._connections.items():
            server_status = {
                "total_connections": len(connections),
                "connected": sum(1 for conn in connections if conn.is_connected),
                "failed": sum(1 for conn in connections if isinstance(conn, MCPConnection) and conn.state == ConnectionState.FAILED),
                "connecting": sum(1 for conn in connections if isinstance(conn, MCPConnection) and conn.state == ConnectionState.CONNECTING),
                "local": sum(1 for conn in connections if isinstance(conn, LocalMCPConnection))
            }
            status[server_name] = server_status

        return status


class StreamableHttpMCPConnection(MCPClient):
    """MCP connection using Streamable HTTP transport (MCP spec 2025-03-26).

    Issues one HTTP POST /mcp per JSON-RPC call. Session is tracked via the
    Mcp-Session-Id header returned by the server's initialize response and sent
    on every subsequent request.  On a 404 (session expired) the caller must
    reconnect — just call connect() again.

    Enable by setting MCP_TRANSPORT=streamable_http in .env and providing an
    http:// or https:// endpoint in MCP_SERVER_*_ENDPOINT.
    """

    def __init__(
        self,
        server_config: MCPServerConfig,
        connection_timeout: float = 30.0,
    ):
        self.server_config = server_config
        self.connection_timeout = connection_timeout
        self._mcp_session_id: Optional[str] = None
        self._available_tools: List[str] = []
        self._tool_schemas: Dict[str, Dict[str, Any]] = {}
        self._is_connected: bool = False
        self._http_base_url: str = server_config.endpoint.rstrip("/")
        self._mcp_url: str = f"{self._http_base_url}/mcp"
        # Bearer token — set from agent_token on first call_tool()
        self._authorization_header: Optional[str] = None
        # One AsyncClient per connection instance (created on first request,
        # closed in disconnect()) instead of a fresh client per request.
        self._http_client: Optional[httpx.AsyncClient] = None

        logger.info(
            f"Initialized StreamableHttpMCPConnection for server: {server_config.name} "
            f"at {self._mcp_url}"
        )

    @property
    def is_connected(self) -> bool:
        """Return True when an active MCP session exists."""
        return self._is_connected

    async def connect(self, server_config: MCPServerConfig) -> None:
        """Send MCP initialize via POST /mcp and capture the Mcp-Session-Id header."""
        initialize_message = {
            "jsonrpc": "2.0",
            "id": str(uuid.uuid4()),
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-03-26",
                "capabilities": {"tools": {"listChanged": False}},
            },
        }
        try:
            response = await self._post_rpc(initialize_message)
        except httpx.HTTPError as exc:
            self._is_connected = False
            raise ConnectionError(
                f"HTTP error during MCP initialize for {server_config.name}: {exc}"
            ) from exc

        if response.status_code != 200:
            self._is_connected = False
            raise ConnectionError(
                f"MCP initialize returned HTTP {response.status_code} for {server_config.name}"
            )

        body = response.json()
        if "error" in body:
            self._is_connected = False
            raise ConnectionError(
                f"MCP initialize JSON-RPC error for {server_config.name}: {body['error']}"
            )

        # Capture the session id from response headers (case-insensitive lookup)
        session_id = response.headers.get("mcp-session-id")
        if session_id:
            self._mcp_session_id = session_id
        self._is_connected = True
        logger.info(
            f"Connected to {server_config.name} via streamable HTTP; "
            f"mcp-session-id={self._mcp_session_id!r}"
        )

        await self._refresh_tools()

    async def disconnect(self) -> None:
        """Send a best-effort DELETE to the MCP session endpoint and mark disconnected."""
        if self._mcp_session_id:
            try:
                headers: Dict[str, str] = {"mcp-session-id": self._mcp_session_id}
                if self._authorization_header:
                    headers["Authorization"] = f"Bearer {self._authorization_header}"
                await self._get_http_client().delete(self._mcp_url, headers=headers)
            except Exception as exc:  # noqa: BLE001 — best-effort teardown
                logger.debug(
                    f"Best-effort DELETE for {self.server_config.name} session "
                    f"{self._mcp_session_id!r} failed (ignored): {exc}"
                )
        if self._http_client is not None:
            try:
                await self._http_client.aclose()
            except Exception as exc:  # noqa: BLE001 — best-effort teardown
                logger.debug(
                    f"Error closing HTTP client for {self.server_config.name} (ignored): {exc}"
                )
            self._http_client = None
        self._is_connected = False
        self._mcp_session_id = None
        logger.info(f"Disconnected StreamableHttpMCPConnection for {self.server_config.name}")

    async def call_tool(self, tool_call: MCPToolCall) -> Dict[str, Any]:
        """Execute a tool call via POST /mcp with session header."""
        # Accept a fresh bearer token if provided
        if tool_call.agent_token:
            self._authorization_header = tool_call.agent_token.token

        if not self._is_connected:
            await self.connect(self.server_config)

        message = {
            "jsonrpc": "2.0",
            "id": str(uuid.uuid4()),
            "method": "tools/call",
            "params": {
                "name": tool_call.tool_name,
                "arguments": tool_call.parameters,
            },
        }

        response = await self._post_rpc(message)

        if response.status_code == 404:
            self._is_connected = False
            self._mcp_session_id = None
            raise MCPConnectionClosedError(
                f"MCP session expired (404) for {self.server_config.name}; reconnect required"
            )

        if response.status_code in (401, 403):
            # Auth failure: clear the stored authorization state and mark the
            # connection disconnected before raising.
            self._authorization_header = None
            self._is_connected = False
            raise ConnectionError(
                f"MCP tools/call auth failure (HTTP {response.status_code}) "
                f"for {self.server_config.name}"
            )

        if response.status_code != 200:
            raise ConnectionError(
                f"MCP tools/call returned HTTP {response.status_code} "
                f"for {self.server_config.name}"
            )

        body = response.json()
        if "error" in body:
            error = body["error"]
            raise Exception(
                f"MCP server error {error.get('code', 'unknown')}: {error.get('message', 'Unknown error')}"
            )

        return body.get("result", {})

    async def list_tools(self) -> List[str]:
        """Return the list of tool names cached during connect()."""
        if not self._is_connected:
            await self.connect(self.server_config)
        return self._available_tools.copy()

    async def get_tool_schema(self, tool_name: str) -> Optional[Dict[str, Any]]:
        """Return the cached schema for a tool, or None if not found."""
        return self._tool_schemas.get(tool_name)

    async def handle_auth_challenge(self, challenge: AuthChallenge) -> Dict[str, Any]:
        """Auth challenges are not used by the HTTP transport; raises NotImplementedError."""
        raise NotImplementedError(
            "StreamableHttpMCPConnection does not support auth challenges. "
            "Auth is handled via the Authorization header."
        )

    async def _refresh_tools(self) -> None:
        """Fetch the tools/list from the server and populate internal caches."""
        message = {
            "jsonrpc": "2.0",
            "id": str(uuid.uuid4()),
            "method": "tools/list",
            "params": {},
        }
        try:
            response = await self._post_rpc(message)
            body = response.json()
            if "error" in body:
                logger.warning(
                    f"tools/list error for {self.server_config.name}: {body['error']}"
                )
                return
            tools = body.get("result", {}).get("tools", [])
            self._available_tools = []
            self._tool_schemas = {}
            for tool in tools:
                name = tool.get("name")
                if name:
                    self._available_tools.append(name)
                    self._tool_schemas[name] = {
                        "name": name,
                        "description": tool.get("description", ""),
                        "inputSchema": tool.get("inputSchema", {}),
                    }
            logger.info(
                f"Refreshed {len(self._available_tools)} tools for "
                f"{self.server_config.name}: {self._available_tools}"
            )
        except Exception as exc:
            logger.error(
                f"Error refreshing tools for {self.server_config.name}: {exc}"
            )

    def _get_http_client(self) -> httpx.AsyncClient:
        """Return the per-connection AsyncClient, creating it on first use."""
        if self._http_client is None:
            self._http_client = httpx.AsyncClient(timeout=self.connection_timeout)
        return self._http_client

    async def _post_rpc(self, message: Dict[str, Any]) -> httpx.Response:
        """POST a JSON-RPC message to the MCP endpoint and return the raw response."""
        headers: Dict[str, str] = {
            "Content-Type": "application/json",
            "mcp-protocol-version": "2025-03-26",
        }
        if self._mcp_session_id:
            headers["mcp-session-id"] = self._mcp_session_id
        if self._authorization_header:
            headers["Authorization"] = f"Bearer {self._authorization_header}"

        return await self._get_http_client().post(
            self._mcp_url, json=message, headers=headers
        )