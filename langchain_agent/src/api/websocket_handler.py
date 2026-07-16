"""
WebSocket handler for real-time chat communication.
"""
import asyncio
import json
import logging
import os
from typing import Dict, Any, Optional, Set
from datetime import datetime, timezone
import uuid

import websockets
from websockets.server import WebSocketServerProtocol
from websockets.exceptions import ConnectionClosed, WebSocketException

from models.chat import ChatMessage, ChatSession, MessageRole
from config.settings import get_config


logger = logging.getLogger(__name__)

# Generic client-facing error text — internal exception details are logged
# server-side only and never sent over the wire.
GENERIC_PROCESSING_ERROR = "Failed to process message"


class ChatWebSocketHandler:
    """
    WebSocket handler for browser-backend real-time communication.
    
    Manages WebSocket connections, message routing, and session management
    for the chat interface.
    """
    
    def __init__(self, config=None):
        """
        Initialize the WebSocket handler.
        
        Args:
            config: Optional configuration object
        """
        self.config = config or get_config()
        
        # Active connections: session_id -> websocket
        self._connections: Dict[str, WebSocketServerProtocol] = {}
        
        # Session to connection mapping: session_id -> connection_id
        self._session_connections: Dict[str, str] = {}

        # Session ownership: session_id -> token-derived sub of the user the
        # session was first bound to. A later session_init for the same
        # session_id must present a token for the SAME sub before the session
        # is rebound to a new connection (anti-hijack).
        self._session_owners: Dict[str, str] = {}
        
        # Connection metadata: connection_id -> metadata
        self._connection_metadata: Dict[str, Dict[str, Any]] = {}
        
        # Session manager reference (will be set by message processor)
        self._session_manager = None
        
        # Message handlers
        self._message_handlers: Dict[str, callable] = {
            "chat_message": self._handle_chat_message,
            "session_init": self._handle_session_init,
            "session_close": self._handle_session_close,
            "ping": self._handle_ping,
            "auth_response": self._handle_auth_response
        }
        
        logger.info("Initialized ChatWebSocketHandler")
    
    async def handle_connection(self, websocket: WebSocketServerProtocol) -> None:
        """
        Handle a new WebSocket connection.
        
        Args:
            websocket: The WebSocket connection
        """
        connection_id = str(uuid.uuid4())

        # Security: do NOT extract auth tokens from the URL query string.
        # URL query params are recorded in server access logs, browser history,
        # and referrer headers — all of which can leak the token.
        # Tokens must be passed in the first session_init message over the
        # encrypted WebSocket channel instead.
        # F13: websockets>=14/15 (new asyncio server) moved the request path to
        # websocket.request.path; the legacy protocol exposed websocket.path.
        # Read both so the token-in-URL security check keeps working across
        # versions instead of silently no-opping on v15.
        raw_path = getattr(websocket, 'path', None)
        if raw_path is None:
            _req = getattr(websocket, 'request', None)
            raw_path = getattr(_req, 'path', '') if _req is not None else ''
        raw_path = raw_path or ''
        if '?token=' in raw_path or '&token=' in raw_path:
            logger.warning(
                f"Connection {connection_id} attempted to pass auth token in URL query string "
                f"(insecure). Token in URL is ignored; send it via session_init message instead."
            )
        user_token = None  # resolved via session_init message

        try:
            # Per-user connection limit: prevent resource exhaustion from a single user
            # opening many WebSocket connections (DoS vector).
            MAX_CONNECTIONS_PER_USER = int(os.environ.get("WS_MAX_CONNECTIONS_PER_USER", "10"))
            user_connections = sum(
                1 for meta in self._connection_metadata.values()
                if meta.get("ip") == (getattr(websocket, 'remote_address', (None,))[0])
            )
            if user_connections >= MAX_CONNECTIONS_PER_USER:
                logger.warning(
                    f"Connection limit reached for IP {getattr(websocket, 'remote_address', ('?',))[0]} "
                    f"({user_connections}/{MAX_CONNECTIONS_PER_USER})"
                )
                await websocket.close(4029, "Too many connections")
                return

            # Register connection
            self._connections[connection_id] = websocket
            self._connection_metadata[connection_id] = {
                "connected_at": datetime.now(timezone.utc),
                "path": raw_path or '/',
                "session_id": None,
                "user_id": None,
                "user_token": user_token,
                "ip": getattr(websocket, 'remote_address', (None,))[0],
            }
            
            logger.info(f"New WebSocket connection: {connection_id}")
            
            # Send connection acknowledgment
            await self._send_message(websocket, {
                "type": "connection_ack",
                "connection_id": connection_id,
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
            
            # Handle messages
            async for message in websocket:
                try:
                    await self._process_message(connection_id, message)
                except Exception as e:
                    # Full exception stays server-side only; the client gets a
                    # generic message (no internal details leak over the wire).
                    logger.error(f"Error processing message from {connection_id}: {e}")
                    await self._send_error(
                        websocket, "message_processing_error", GENERIC_PROCESSING_ERROR
                    )
        
        except ConnectionClosed:
            logger.info(f"WebSocket connection closed: {connection_id}")
        except WebSocketException as e:
            logger.error(f"WebSocket error for connection {connection_id}: {e}")
        except Exception as e:
            logger.error(f"Unexpected error for connection {connection_id}: {e}")
        finally:
            # Clean up connection
            await self._cleanup_connection(connection_id)
    
    async def _process_message(self, connection_id: str, raw_message: str) -> None:
        """
        Process an incoming WebSocket message.
        
        Args:
            connection_id: The connection ID
            raw_message: The raw message string
        """
        try:
            # Parse message
            message = json.loads(raw_message)
            
            if not isinstance(message, dict):
                raise ValueError("Message must be a JSON object")
            
            message_type = message.get("type")
            if not message_type:
                raise ValueError("Message must have a 'type' field")
            
            # Get handler
            handler = self._message_handlers.get(message_type)
            if not handler:
                raise ValueError(f"Unknown message type: {message_type}")
            
            # Add connection context
            message["_connection_id"] = connection_id
            message["_timestamp"] = datetime.now(timezone.utc).isoformat()
            
            # Handle message
            await handler(message)
            
        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON from connection {connection_id}: {e}")
            websocket = self._connections.get(connection_id)
            if websocket:
                await self._send_error(websocket, "invalid_json", "Message must be valid JSON")
        
        except ValueError as e:
            logger.error(f"Invalid message from connection {connection_id}: {e}")
            websocket = self._connections.get(connection_id)
            if websocket:
                await self._send_error(websocket, "invalid_message", str(e))
        
        except Exception as e:
            logger.error(f"Error processing message from connection {connection_id}: {e}")
            websocket = self._connections.get(connection_id)
            if websocket:
                await self._send_error(websocket, "processing_error", "Failed to process message")
    
    async def _handle_chat_message(self, message: Dict[str, Any]) -> None:
        """
        Handle a chat message from the user.
        
        Args:
            message: The message data
        """
        connection_id = message["_connection_id"]
        websocket = self._connections.get(connection_id)
        
        if not websocket:
            logger.error(f"No websocket found for connection {connection_id}")
            return
        
        try:
            # Validate required fields
            content = message.get("content")

            if not content or not isinstance(content, str):
                await self._send_error(websocket, "invalid_content", "Message content is required")
                return

            # WR-01: the authenticated session for this connection comes ONLY
            # from the connection metadata bound during _handle_session_init.
            # NEVER trust the session_id field carried in the message body —
            # a client could put any session_id in a chat_message body and
            # hijack/redirect session routing (poisoning the metadata that
            # BL-04's _handle_auth_response then reads). This mirrors the exact
            # BL-04 guard already applied to _handle_auth_response.
            connection_session_id = None
            if connection_id in self._connection_metadata:
                connection_session_id = self._connection_metadata[connection_id].get("session_id")

            if not connection_session_id:
                logger.warning(
                    f"Chat message received on connection {connection_id} "
                    f"with no bound session_id — rejecting"
                )
                await self._send_error(
                    websocket,
                    "invalid_session",
                    "WebSocket has no authenticated session — call session_init first",
                )
                return

            # If the client carried a session_id in the body, it MUST match the
            # connection-bound one. Mismatch is a tampering signal — refuse.
            body_session_id = message.get("session_id")
            if body_session_id is not None and body_session_id != connection_session_id:
                logger.warning(
                    f"Chat message session_id mismatch on connection {connection_id}: "
                    f"body={body_session_id!r} bound={connection_session_id!r}"
                )
                await self._send_error(
                    websocket,
                    "session_id_mismatch",
                    "session_id in message body does not match the WebSocket's authenticated session",
                )
                return

            session_id = connection_session_id

            # Validate message length. WR-12: measure UTF-8 BYTES, not code
            # points. The WS server caps frames at a byte limit; a multi-byte
            # payload (e.g. 4-byte emoji) under the char count can still blow
            # past the byte frame cap, so a char-based check let oversize
            # payloads through. Byte length is consistent with the wire limit.
            if len(content.encode("utf-8")) > self.config.chat.max_message_length:
                await self._send_error(websocket, "message_too_long",
                                     f"Message exceeds maximum length of {self.config.chat.max_message_length}")
                return
            
            # Create chat message
            chat_message = ChatMessage.create_user_message(
                session_id=session_id,
                content=content.strip(),
                metadata={
                    "connection_id": connection_id,
                    "message_id": message.get("message_id", str(uuid.uuid4()))
                }
            )
            
            # Send acknowledgment
            await self._send_message(websocket, {
                "type": "message_received",
                "message_id": chat_message.id,
                "session_id": session_id,
                "timestamp": chat_message.timestamp.isoformat()
            })
            
            # Notify message processor (this will be implemented in task 7.3)
            await self._notify_message_processor(chat_message)
            
            logger.info(f"Processed chat message from session {session_id}")
            
        except Exception as e:
            logger.error(f"Error handling chat message: {e}")
            await self._send_error(websocket, "chat_error", "Failed to process chat message")
    
    async def _handle_session_init(self, message: Dict[str, Any]) -> None:
        """
        Handle session initialization request.
        
        Args:
            message: The message data
        """
        connection_id = message["_connection_id"]
        websocket = self._connections.get(connection_id)
        
        if not websocket:
            return
        
        try:
            # Get or create session ID.
            #
            # Path A (CR-02/CR-04): identity is derived ONLY from a validated,
            # PingOne-issued access token delivered by the BFF proxy in this
            # message. Client-supplied `user_id` / `userEmail` are NO LONGER
            # trusted for identity — the spoof primitive has been removed.
            # `user_id` is still accepted purely as a non-privileged session
            # label (it grants nothing; identity comes from the token).
            session_id = message.get("session_id")
            session_label = message.get("user_id")
            user_token = message.get("auth_token") or message.get("authToken")

            # Token-derived identity (Path A). The BFF proxy is the ONLY
            # supported source of this token; the browser never holds one.
            # No token / invalid token / rejected aud => refuse the session.
            #
            # Ordering matters (anti-hijack): the token is validated BEFORE
            # any session is created, before connection metadata is bound,
            # and before _session_connections is (re)pointed at this
            # connection. A refused init therefore never creates a session,
            # never steals an existing session's routing, and never tears
            # down an existing session's worker.
            if not user_token:
                logger.warning(
                    f"session_init for {session_id} carried no auth token — "
                    f"refusing (Path A: identity must be token-derived)"
                )
                await self._send_error(
                    websocket,
                    "auth_required",
                    "This chat requires an authenticated session. Connect via the "
                    "banking app (the server attaches your identity token).",
                )
                await self._refuse_connection(websocket)
                return

            if not (hasattr(self, '_message_processor') and self._message_processor):
                logger.error(
                    f"No message processor — cannot validate token for session {session_id}"
                )
                await self._send_error(
                    websocket,
                    "session_error",
                    "Server not ready to authenticate the session",
                )
                await self._refuse_connection(websocket)
                return

            # Validate the token FIRST and derive the caller's identity (sub).
            # Imported lazily (same pattern as the agent) so this module has
            # no hard PyJWT dependency on paths that never validate tokens.
            from authentication.token_validator import get_token_validator
            try:
                token_sub = get_token_validator().validate(user_token).sub
            except Exception as e:
                logger.warning(
                    f"Token validation failed for session_init on connection "
                    f"{connection_id}: {e}"
                )
                await self._send_error(
                    websocket,
                    "auth_invalid",
                    "Could not validate your identity token. The session was refused.",
                )
                await self._refuse_connection(websocket)
                return

            # Ownership check: an existing session may only be rebound to a
            # new connection by the SAME token-derived user it was first
            # bound to. On mismatch: refuse, do NOT rebind, do NOT touch the
            # existing session's routing or worker.
            owner_sub = self._session_owners.get(session_id) if session_id else None
            if owner_sub is not None and owner_sub != token_sub:
                logger.warning(
                    f"session_init ownership mismatch for session {session_id} on "
                    f"connection {connection_id}: token sub does not match the "
                    f"session's bound user — refusing rebind"
                )
                await self._send_error(
                    websocket,
                    "session_owner_mismatch",
                    "This session is bound to a different user. The session was refused.",
                )
                await self._refuse_connection(websocket)
                return

            # Resolve the session id before the identity-binding call (the
            # processor binds identity keyed by session_id).
            if not session_id:
                session_id = str(uuid.uuid4())

            # Bind the validated identity to the session (the processor
            # re-validates the token at its own boundary — defense in depth).
            try:
                await self._message_processor.process_session_init_with_token(
                    session_id, user_token
                )
            except Exception as e:
                logger.warning(
                    f"Token identity binding failed for session {session_id}: {e}"
                )
                await self._send_error(
                    websocket,
                    "auth_invalid",
                    "Could not validate your identity token. The session was refused.",
                )
                await self._refuse_connection(websocket)
                return

            # Validation succeeded — only NOW create session state and bind
            # the connection to it.
            if self._session_manager:
                existing_session = await self._session_manager.get_session(session_id)
                if not existing_session:
                    await self._session_manager.create_session(
                        user_id=session_label, session_id=session_id
                    )
                    logger.info(f"Created new session with provided ID: {session_id}")

            # Update connection metadata + session routing
            self._session_owners[session_id] = token_sub
            if connection_id in self._connection_metadata:
                self._connection_metadata[connection_id]["session_id"] = session_id
                self._connection_metadata[connection_id]["user_id"] = session_label
                self._connection_metadata[connection_id]["user_token"] = user_token
            self._session_connections[session_id] = connection_id

            # Identity is bound. Acknowledge the session. We deliberately do
            # NOT echo any user identifier back to the browser.
            await self._send_message(websocket, {
                "type": "session_initialized",
                "session_id": session_id,
                "timestamp": datetime.now(timezone.utc).isoformat()
            })

            logger.info(f"Initialized session {session_id} for connection {connection_id}")

        except Exception as e:
            logger.error(f"Error handling session init: {e}")
            await self._send_error(websocket, "session_error", "Failed to initialize session")
    
    async def _handle_session_close(self, message: Dict[str, Any]) -> None:
        """
        Handle session close request.
        
        Args:
            message: The message data
        """
        connection_id = message["_connection_id"]
        websocket = self._connections.get(connection_id)
        
        if not websocket:
            return
        
        try:
            # WR-01/BL-04 discipline: the session being closed is the one
            # bound to THIS connection's metadata, never a body-supplied id.
            bound_session_id = None
            if connection_id in self._connection_metadata:
                bound_session_id = self._connection_metadata[connection_id].get("session_id")
            session_id = bound_session_id

            # Ownership guard (same as _cleanup_connection): only tear down
            # session state if THIS connection is still the one bound to the
            # session — a superseded connection must not destroy the session's
            # current routing or worker.
            if session_id and self._session_connections.get(session_id) == connection_id:
                del self._session_connections[session_id]
                self._session_owners.pop(session_id, None)

                # WR-02 Option A: deterministically tear down the session's
                # per-session worker + queue on explicit close. Pending messages
                # for the closed session are discarded (logged), not run against
                # a dead session.
                await self._teardown_session_worker(session_id)

            # Update connection metadata
            if connection_id in self._connection_metadata:
                self._connection_metadata[connection_id]["session_id"] = None
            
            # Send acknowledgment
            await self._send_message(websocket, {
                "type": "session_closed",
                "session_id": session_id,
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
            
            logger.info(f"Closed session {session_id} for connection {connection_id}")
            
        except Exception as e:
            logger.error(f"Error handling session close: {e}")
            await self._send_error(websocket, "session_error", "Failed to close session")
    
    async def _handle_ping(self, message: Dict[str, Any]) -> None:
        """
        Handle ping message for connection health check.
        
        Args:
            message: The message data
        """
        connection_id = message["_connection_id"]
        websocket = self._connections.get(connection_id)
        
        if websocket:
            await self._send_message(websocket, {
                "type": "pong",
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
    
    async def _handle_auth_response(self, message: Dict[str, Any]) -> None:
        """
        Handle authorization response from user.

        Args:
            message: The message data
        """
        connection_id = message["_connection_id"]
        websocket = self._connections.get(connection_id)

        if not websocket:
            return

        try:
            # BL-04: the session_id is taken from the WebSocket connection
            # metadata (set during _handle_session_init or _handle_chat_message).
            # NEVER trust the session_id field carried in the message body —
            # an attacker controlling one WebSocket could inject another user's
            # session_id and bind a stolen auth_code to their account.
            connection_session_id = None
            if connection_id in self._connection_metadata:
                connection_session_id = self._connection_metadata[connection_id].get("session_id")

            if not connection_session_id:
                logger.warning(
                    f"Auth response received on connection {connection_id} "
                    f"with no bound session_id — rejecting"
                )
                await self._send_error(
                    websocket,
                    "invalid_session",
                    "WebSocket has no authenticated session — call session_init first",
                )
                return

            # If the client carried a session_id in the body, it MUST match the
            # connection-bound one. Mismatch is a tampering signal — refuse.
            body_session_id = message.get("session_id")
            if body_session_id is not None and body_session_id != connection_session_id:
                logger.warning(
                    f"Auth response session_id mismatch on connection {connection_id}: "
                    f"body={body_session_id!r} bound={connection_session_id!r}"
                )
                await self._send_error(
                    websocket,
                    "session_id_mismatch",
                    "session_id in message body does not match the WebSocket's authenticated session",
                )
                return

            session_id = connection_session_id
            auth_code = message.get("auth_code")
            state = message.get("state")

            if not auth_code:
                await self._send_error(websocket, "invalid_auth", "auth_code is required")
                return

            # Send acknowledgment
            await self._send_message(websocket, {
                "type": "auth_received",
                "session_id": session_id,
                "timestamp": datetime.now(timezone.utc).isoformat()
            })

            # Notify message processor about auth response
            await self._notify_auth_response(session_id, auth_code, state)

            logger.info(f"Processed auth response for session {session_id}")

        except Exception as e:
            logger.error(f"Error handling auth response: {e}")
            await self._send_error(websocket, "auth_error", "Failed to process authorization response")
    
    async def send_message_to_session(self, session_id: str, message: Dict[str, Any]) -> bool:
        """
        Send a message to a specific session.
        
        Args:
            session_id: The session ID
            message: The message to send
            
        Returns:
            bool: True if message was sent successfully
        """
        connection_id = self._session_connections.get(session_id)
        if not connection_id:
            logger.warning(f"No active connection for session {session_id}")
            return False
        
        websocket = self._connections.get(connection_id)
        if not websocket:
            logger.warning(f"No websocket for connection {connection_id}")
            return False
        
        try:
            await self._send_message(websocket, message)
            return True
        except Exception as e:
            logger.error(f"Error sending message to session {session_id}: {e}")
            return False
    
    async def send_chat_response(self, session_id: str, response: str, metadata: Optional[Dict[str, Any]] = None) -> bool:
        """
        Send a chat response to a session.
        
        Args:
            session_id: The session ID
            response: The response content
            metadata: Optional metadata
            
        Returns:
            bool: True if response was sent successfully
        """
        message = {
            "type": "chat_response",
            "session_id": session_id,
            "content": response,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "metadata": metadata or {}
        }
        
        return await self.send_message_to_session(session_id, message)
    
    async def send_auth_request(self, session_id: str, auth_url: str, state: str) -> bool:
        """
        Send an authorization request to a session.
        
        Args:
            session_id: The session ID
            auth_url: The authorization URL
            state: The state parameter
            
        Returns:
            bool: True if request was sent successfully
        """
        message = {
            "type": "auth_request",
            "session_id": session_id,
            "auth_url": auth_url,
            "state": state,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        
        return await self.send_message_to_session(session_id, message)
    
    async def _send_message(self, websocket: WebSocketServerProtocol, message: Dict[str, Any]) -> None:
        """
        Send a message through a WebSocket connection.
        
        Args:
            websocket: The WebSocket connection
            message: The message to send
        """
        try:
            await websocket.send(json.dumps(message))
        except ConnectionClosed:
            logger.debug("Attempted to send message to closed connection")
        except Exception as e:
            logger.error(f"Error sending WebSocket message: {e}")
            raise
    
    async def _send_error(self, websocket: WebSocketServerProtocol, error_code: str, error_message: str) -> None:
        """
        Send an error message through a WebSocket connection.
        
        Args:
            websocket: The WebSocket connection
            error_code: The error code
            error_message: The error message
        """
        error_response = {
            "type": "error",
            "error_code": error_code,
            "error_message": error_message,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        
        await self._send_message(websocket, error_response)
    
    async def _refuse_connection(self, websocket: WebSocketServerProtocol) -> None:
        """
        Close a connection whose session_init was refused.

        Closes with 4401 (application-level "unauthorized"). Connection-local
        state is cleaned up by the normal disconnect path (handle_connection's
        finally -> _cleanup_connection). Because a refused init never bound
        this connection to the target session, that path can never remove the
        target session's _session_connections entry or tear down its worker.
        """
        try:
            await websocket.close(code=4401)
        except Exception as e:
            logger.debug(f"Error closing refused connection: {e}")

    async def _cleanup_connection(self, connection_id: str) -> None:
        """
        Clean up a connection and its associated data.
        
        Args:
            connection_id: The connection ID to clean up
        """
        try:
            # Remove from connections
            if connection_id in self._connections:
                del self._connections[connection_id]
            
            # Remove from metadata and session mapping
            if connection_id in self._connection_metadata:
                session_id = self._connection_metadata[connection_id].get("session_id")
                # Ownership guard: only tear down session state if THIS
                # connection is still the one bound to the session. A stale /
                # superseded connection must not destroy the session's current
                # routing or worker.
                if session_id and self._session_connections.get(session_id) == connection_id:
                    del self._session_connections[session_id]
                    self._session_owners.pop(session_id, None)
                    # WR-02 Option A: WS disconnect must also tear down the
                    # session's per-session worker so its task is cancelled +
                    # awaited (no orphans) and queued messages for the now-dead
                    # session are discarded with a logged reason.
                    await self._teardown_session_worker(session_id)
                del self._connection_metadata[connection_id]

            logger.debug(f"Cleaned up connection {connection_id}")
            
        except Exception as e:
            logger.error(f"Error cleaning up connection {connection_id}: {e}")
    
    async def _teardown_session_worker(self, session_id: str) -> None:
        """Ask the message processor to deterministically tear down a session.

        Delegates to MessageProcessor.clear_session_data, which (WR-02
        Option A) cancels + awaits that session's per-session worker task
        and discards any still-queued messages with a logged reason. Best
        effort: a teardown failure must not break connection cleanup.
        """
        processor = getattr(self, "_message_processor", None)
        if not processor:
            return
        try:
            await processor.clear_session_data(session_id)
        except Exception as e:
            logger.error(
                f"Error tearing down session worker for {session_id}: {e}"
            )

    def set_message_processor(self, message_processor) -> None:
        """
        Set the message processor for handling messages.
        
        Args:
            message_processor: The MessageProcessor instance
        """
        self._message_processor = message_processor
        logger.info("Set message processor for WebSocket handler")
    
    def set_session_manager(self, session_manager) -> None:
        """
        Set the session manager for handling sessions.
        
        Args:
            session_manager: The SessionManager instance
        """
        self._session_manager = session_manager
        logger.info("Set session manager for WebSocket handler")
    
    async def _notify_message_processor(self, chat_message: ChatMessage) -> None:
        """
        Notify the message processor about a new chat message.
        
        Args:
            chat_message: The chat message to process
        """
        if hasattr(self, '_message_processor') and self._message_processor:
            try:
                await self._message_processor.process_chat_message(chat_message)
            except Exception as e:
                logger.error(f"Error notifying message processor about message {chat_message.id}: {e}")
        else:
            logger.debug(f"No message processor set, cannot process message {chat_message.id}")
    
    async def _notify_auth_response(self, session_id: str, auth_code: str, state: str) -> None:
        """
        Notify about an authorization response.
        
        Args:
            session_id: The session ID
            auth_code: The authorization code
            state: The state parameter
        """
        if hasattr(self, '_message_processor') and self._message_processor:
            try:
                await self._message_processor.process_auth_response(session_id, auth_code, state)
            except Exception as e:
                logger.error(f"Error notifying message processor about auth response for session {session_id}: {e}")
        else:
            logger.debug(f"No message processor set, cannot process auth response for session {session_id}")
    
    def get_active_connections(self) -> Dict[str, Dict[str, Any]]:
        """
        Get information about active connections.
        
        Returns:
            Dict mapping connection IDs to connection metadata
        """
        return self._connection_metadata.copy()
    
    def get_active_sessions(self) -> Dict[str, str]:
        """
        Get active session to connection mapping.
        
        Returns:
            Dict mapping session IDs to connection IDs
        """
        return self._session_connections.copy()
    
    async def broadcast_to_all(self, message: Dict[str, Any]) -> int:
        """
        Broadcast a message to all active connections.
        
        Args:
            message: The message to broadcast
            
        Returns:
            int: Number of connections the message was sent to
        """
        sent_count = 0

        # Iterate over a snapshot — a connection can be cleaned up (dict
        # mutated) while we're awaiting a send.
        for connection_id, websocket in list(self._connections.items()):
            try:
                await self._send_message(websocket, message)
                sent_count += 1
            except Exception as e:
                logger.error(f"Error broadcasting to connection {connection_id}: {e}")
        
        return sent_count
    
    async def shutdown(self) -> None:
        """Shutdown the WebSocket handler and close all connections."""
        logger.info("Shutting down WebSocket handler")
        
        # Close all connections (snapshot — closing mutates the dict via
        # each connection's cleanup path)
        for connection_id, websocket in list(self._connections.items()):
            try:
                await websocket.close()
            except Exception as e:
                logger.error(f"Error closing connection {connection_id}: {e}")
        
        # Clear all data
        self._connections.clear()
        self._session_connections.clear()
        self._session_owners.clear()
        self._connection_metadata.clear()
        
        logger.info("WebSocket handler shutdown complete")