"""
Message processor for coordinating between chat interface and agent.
"""
import asyncio
import logging
import os
import json
from typing import Dict, Any, Optional, Tuple
from datetime import datetime, timezone, timedelta
import uuid

from models.chat import ChatMessage, ChatSession
from models.auth import AuthorizationCode
from agent.langchain_mcp_agent import LangChainMCPAgent, _content_to_text
from agent.grounding_guardrail import (
    CommitmentGroundingValidator,
    ToolCallRecord,
    contains_commitment_claim,
)
from guardrails.validator_base import FailResult
from .session_manager import SessionManager
from .websocket_handler import ChatWebSocketHandler
from config.settings import get_config


logger = logging.getLogger(__name__)


# Authorization / gateway policy-denial error codes the BFF surfaces in a denied
# tool result — the full set across every deny use case (gateway policy, scope,
# audience, exchange-scope, transaction, cross-owner), not just weather. Kept in
# sync with the deny bodies emitted by mcpToolPipeline / mcpGatewayClient /
# attackSimulatorService. Deliberately EXCLUDES non-denials the user should retry
# rather than see as "denied": authorization_pending (CIBA), mcp_authorize_error/
# _internal/_unavailable, authorization_service_unavailable.
_POLICY_DENY_CODES = (
    "gateway_policy_denied",
    "weather_scope_denied",
    "mcp_authorization_denied",
    "mcp_scope_denied",
    "gateway_auth_failed",
    "access_denied",
    "insufficient_scope",
    "invalid_scope",
    "missing_exchange_scopes",
    "transaction_denied",
)


def _tool_result_text(output) -> str:
    """The tool's own result string, unwrapped from whatever the event stream
    delivered it in.

    LangGraph's ToolNode hands ``on_tool_end`` a ToolMessage, not the tool's raw
    return, so ``str(output)`` yields a repr — ``content='{"...}' name='checkout'
    tool_call_id='tc1'`` — whose JSON never parses. Every consumer below reads
    these results as JSON, so capturing the repr silently disabled all of them:
    the HITL gate returned None and became LLM narration, and policy denials
    fell back to their generic sentence instead of the BFF's real reason.
    """
    content = getattr(output, "content", None)
    if isinstance(content, str):
        return content
    return str(output or "")


def _extract_policy_denial(tool_calls) -> Optional[str]:
    """Return a human-readable reason if any tool result this turn was an
    authorization / gateway policy denial, else None. The BFF returns the denied
    tool result as a JSON string carrying an ``error`` code plus a descriptive
    ``message`` (see bff_tool_adapter._arun)."""
    for rec in tool_calls or []:
        result = str(getattr(rec, "result", "") or "")
        if not any(code in result for code in _POLICY_DENY_CODES):
            continue
        try:
            data = json.loads(result)
            if isinstance(data, dict):
                msg = data.get("message") or data.get("error_description") or data.get("error")
                if isinstance(msg, str) and msg.strip():
                    return msg.strip()
        except (ValueError, TypeError):
            pass
        return "The request was denied by an authorization policy."
    return None


def _extract_hitl_interrupt(tool_calls) -> Optional[dict]:
    """Return the interrupt payload if a tool this turn needs human approval.

    The BFF normalizes a 428 approval gate into ``result.hitlRequired`` +
    ``interruptId`` (routes/agentTool.js). A gate is a PAUSE, not a failure, so
    it must end the turn as an AG-UI interrupt rather than becoming another
    observation for the LLM to narrate — otherwise the challenge is created and
    nobody is ever shown a modal to approve it.

    Deliberately distinct from _extract_policy_denial: a DENY is terminal and
    keeps its deterministic notice; only an approval gate pauses the run.
    """
    for rec in tool_calls or []:
        result = str(getattr(rec, "result", "") or "")
        if "hitlRequired" not in result:
            continue
        try:
            data = json.loads(result)
        except (ValueError, TypeError):
            continue
        if isinstance(data, dict) and data.get("hitlRequired"):
            return data
    return None


def _reply_surfaces_denial(reply: str) -> bool:
    """Heuristic: did the model's reply already explain the denial? Prevents
    doubling the deterministic notice when the system-prompt rule worked. A
    greeting or subject-change contains none of these terms."""
    r = (reply or "").lower()
    if not r.strip():
        return False
    return any(kw in r for kw in ("den", "block", "not allow", "scope", "policy", "restrict", "out of"))


class _SessionWorker:
    """One ordered processing path for a single chat session (WR-02 Option A).

    Owns its own ``asyncio.Queue`` and exactly ONE worker ``asyncio.Task``.
    A single sequential consumer task is what guarantees the load-bearing
    property: messages for THIS session are processed in strict arrival
    order (conversation turns must never reorder). Concurrency across
    sessions is achieved by having one of these PER session — different
    sessions are different tasks and interleave on the event loop.

    The worker task is the context in which ``_handle_queued_message`` runs,
    which is why WR-06's ``_current_tracer`` ContextVar stays leak-proof
    under real concurrency: ``set_tracer()`` (inside the agent call) and the
    tool-path ``_current_tracer.get()`` both execute inside THIS task's
    context, and ``asyncio.create_task`` copy-on-create isolates it from
    every other session's worker.
    """

    __slots__ = ("session_id", "queue", "task", "last_activity", "closing")

    def __init__(self, session_id: str):
        self.session_id = session_id
        self.queue: asyncio.Queue = asyncio.Queue()
        self.task: Optional[asyncio.Task] = None
        self.last_activity: datetime = datetime.now(timezone.utc)
        self.closing: bool = False


class MessageProcessor:
    """
    Coordinates message processing between chat interface and LangChain agent.
    
    Handles message routing, authorization flow coordination, and response delivery
    for the chat interface backend.
    """
    
    def __init__(self, 
                 agent: LangChainMCPAgent,
                 session_manager: SessionManager,
                 websocket_handler: ChatWebSocketHandler,
                 config=None):
        """
        Initialize the message processor.
        
        Args:
            agent: The LangChain MCP agent
            session_manager: The session manager
            websocket_handler: The WebSocket handler
            config: Optional configuration object
        """
        self.config = config or get_config()
        self.agent = agent
        self.session_manager = session_manager
        self.websocket_handler = websocket_handler
        
        # Pending authorization requests: state -> (session_id, created_at).
        # Tuple form lets us TTL-evict abandoned states whose user never
        # returned the auth code. Without TTL the dict grew unbounded
        # (one entry per abandoned login).
        self._pending_auth_requests: Dict[str, Tuple[str, datetime]] = {}
        self._pending_auth_ttl = timedelta(minutes=15)

        # Ingress queue (compat surface). process_chat_message /
        # process_auth_response enqueue here; a single dispatcher task drains
        # it and FANS each item OUT to the owning session's worker. The
        # dispatcher does no real work — it only routes — so it never blocks
        # on an LLM turn. Real processing happens in per-session workers
        # (WR-02 Option A): different sessions run concurrently, turns within
        # one session stay strictly ordered.
        self._message_queue: asyncio.Queue = asyncio.Queue()
        self._processing_task: Optional[asyncio.Task] = None
        self._shutdown_event = asyncio.Event()

        # WR-02 Option A: per-session worker pool.
        # session_id -> _SessionWorker (own asyncio.Queue + own worker Task).
        self._session_workers: Dict[str, "_SessionWorker"] = {}
        self._workers_lock = asyncio.Lock()
        self._max_session_workers = self.config.chat.max_session_workers
        self._session_worker_idle_ttl = timedelta(
            seconds=self.config.chat.session_worker_idle_ttl_seconds
        )
        self._reap_interval_seconds = (
            self.config.chat.session_worker_reap_interval_seconds
        )
        # CR-01-class guard: this reaper MUST be started at app init (see
        # MessageProcessor.start(), called from main.py). A cleanup loop that
        # is wired but never started is the exact CR-01 bug.
        self._reaper_task: Optional[asyncio.Task] = None

        logger.info(
            "Initialized MessageProcessor (per-session workers; cap=%d, "
            "idle_ttl=%ss)",
            self._max_session_workers,
            self.config.chat.session_worker_idle_ttl_seconds,
        )

    async def start(self) -> None:
        """Start the dispatcher and the per-session-worker idle reaper.

        CR-01-class invariant: the reaper is started HERE. main.py calls
        MessageProcessor.start() during app init alongside
        SessionManager.start() / ConversationMemory.start_cleanup_task().
        """
        if self._processing_task is None or self._processing_task.done():
            self._processing_task = asyncio.create_task(self._process_message_queue())
            logger.info("Started message dispatcher task")
        if self._reaper_task is None or self._reaper_task.done():
            self._reaper_task = asyncio.create_task(self._reap_idle_workers_loop())
            logger.info("Started per-session worker idle reaper task")

    async def stop(self) -> None:
        """Stop the dispatcher, reaper, and all per-session workers."""
        self._shutdown_event.set()

        if self._processing_task and not self._processing_task.done():
            try:
                await asyncio.wait_for(self._processing_task, timeout=5.0)
            except asyncio.TimeoutError:
                logger.warning("Message dispatcher task did not stop gracefully")
                self._processing_task.cancel()
                try:
                    await self._processing_task
                except asyncio.CancelledError:
                    pass

        if self._reaper_task and not self._reaper_task.done():
            try:
                await asyncio.wait_for(self._reaper_task, timeout=5.0)
            except asyncio.TimeoutError:
                logger.warning("Worker reaper task did not stop gracefully")
                self._reaper_task.cancel()
                try:
                    await self._reaper_task
                except asyncio.CancelledError:
                    pass

        # Tear down every per-session worker (cancel + await — no orphans).
        async with self._workers_lock:
            session_ids = list(self._session_workers.keys())
        for session_id in session_ids:
            await self._teardown_session_worker(
                session_id, reason="processor shutdown"
            )

        logger.info("Stopped MessageProcessor")
    
    async def process_chat_message(self, chat_message: ChatMessage) -> None:
        """
        Process a chat message from a user.
        
        Args:
            chat_message: The chat message to process
        """
        try:
            # Validate session exists and is active
            if not await self.session_manager.is_session_active(chat_message.session_id):
                logger.warning(f"Received message for inactive session {chat_message.session_id}")
                await self._send_error_response(
                    chat_message.session_id,
                    "Session expired or invalid. Please refresh and try again."
                )
                return
            
            # Add message to session history
            await self.session_manager.add_message_to_session(chat_message.session_id, chat_message)
            
            # Queue message for processing
            await self._message_queue.put({
                "type": "chat_message",
                "message": chat_message,
                "timestamp": datetime.now(timezone.utc)
            })
            
            logger.debug(f"Queued chat message {chat_message.id} for processing")
            
        except Exception as e:
            logger.error(f"Error processing chat message {chat_message.id}: {e}")
            await self._send_error_response(
                chat_message.session_id,
                "Failed to process your message. Please try again."
            )
    
    async def process_auth_response(self, session_id: str, auth_code: str, state: str) -> None:
        """
        Process an authorization response from a user.
        
        Args:
            session_id: The session ID
            auth_code: The authorization code
            state: The state parameter
        """
        try:
            # Evict expired pending requests before validating, so a slow-but-valid
            # response still works but truly-abandoned states don't leak.
            self._sweep_pending_auth_requests()

            # Validate state parameter
            if state not in self._pending_auth_requests:
                logger.warning(f"Received auth response with unknown state {state}")
                await self._send_error_response(
                    session_id,
                    "Invalid authorization state. Please try again."
                )
                return

            # Validate session matches
            expected_session_id = self._pending_auth_requests[state][0]
            if session_id != expected_session_id:
                logger.warning(f"Session ID mismatch for auth response: expected {expected_session_id}, got {session_id}")
                await self._send_error_response(
                    session_id,
                    "Session mismatch for authorization. Please try again."
                )
                return
            
            # Create authorization code object. PingOne issues authorization
            # codes with a default TTL of 10 minutes; mirror that on the
            # client object so AuthorizationCode.is_expired() doesn't
            # short-circuit immediately. The MCP server still does the
            # authoritative validation against the IdP.
            auth_code_obj = AuthorizationCode(
                code=auth_code,
                state=state,
                session_id=session_id,
                expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
            )
            
            # Queue auth response for processing
            await self._message_queue.put({
                "type": "auth_response",
                "session_id": session_id,
                "auth_code": auth_code_obj,
                "timestamp": datetime.now(timezone.utc)
            })
            
            # Clean up pending request
            del self._pending_auth_requests[state]
            
            logger.info(f"Queued auth response for session {session_id}")
            
        except Exception as e:
            logger.error(f"Error processing auth response for session {session_id}: {e}")
            await self._send_error_response(
                session_id,
                "Failed to process authorization response. Please try again."
            )
    
    async def request_user_authorization(self, session_id: str, auth_url: str, scope: str) -> str:
        """
        Request user authorization and return state parameter.
        
        Args:
            session_id: The session ID
            auth_url: The authorization URL
            scope: The requested scope
            
        Returns:
            str: The state parameter for tracking the request
        """
        try:
            # Generate state parameter
            state = str(uuid.uuid4())
            
            # Store pending request with timestamp for TTL eviction.
            self._pending_auth_requests[state] = (session_id, datetime.now(timezone.utc))
            
            # Send authorization request to user
            success = await self.websocket_handler.send_auth_request(session_id, auth_url, state)
            
            if not success:
                # Clean up if sending failed
                del self._pending_auth_requests[state]
                raise RuntimeError("Failed to send authorization request to user")
            
            logger.info(f"Sent authorization request to session {session_id} with state {state}")
            return state
            
        except Exception as e:
            logger.error(f"Error requesting user authorization for session {session_id}: {e}")
            raise
    
    @staticmethod
    def _session_id_of(message_data: Dict[str, Any]) -> Optional[str]:
        """Extract the owning session_id from an ingress queue item."""
        if message_data.get("type") == "chat_message":
            msg = message_data.get("message")
            return getattr(msg, "session_id", None)
        return message_data.get("session_id")

    async def _process_message_queue(self) -> None:
        """Dispatcher: drain the ingress queue, FAN OUT to per-session workers.

        This task does NO real work. It only routes — so a slow LLM turn in
        one session never blocks dispatch for another (the head-of-line
        blocking WR-02 was about). Strict per-session ordering is preserved
        because each session's items are appended to that ONE session's
        worker queue in dispatch order, and the dispatcher pulls the ingress
        queue FIFO.
        """
        logger.info("Started message dispatcher")

        idle_ticks = 0
        while not self._shutdown_event.is_set():
            try:
                try:
                    message_data = await asyncio.wait_for(
                        self._message_queue.get(),
                        timeout=1.0
                    )
                except asyncio.TimeoutError:
                    # Sweep abandoned pending auth requests every ~60 idle
                    # ticks (≈1 minute). Cheap when the dict is empty.
                    idle_ticks += 1
                    if idle_ticks >= 60:
                        idle_ticks = 0
                        self._sweep_pending_auth_requests()
                    continue  # Check shutdown event

                session_id = self._session_id_of(message_data)
                if not session_id:
                    logger.warning(
                        "Dispatcher dropped item with no session_id: type=%s",
                        message_data.get("type"),
                    )
                    continue

                worker = await self._get_or_create_session_worker(session_id)
                if worker is None:
                    # Cap reached — apply backpressure (do NOT silently drop).
                    logger.warning(
                        "Per-session worker cap (%d) reached — rejecting "
                        "message for session %s",
                        self._max_session_workers,
                        session_id,
                    )
                    await self._send_error_response(
                        session_id,
                        "The assistant is at capacity right now. Please retry "
                        "in a few seconds.",
                    )
                    continue

                worker.last_activity = datetime.now(timezone.utc)
                await worker.queue.put(message_data)

            except Exception as e:
                logger.error(f"Error in message dispatcher: {e}")

        logger.info("Message dispatcher stopped")

    async def _get_or_create_session_worker(
        self, session_id: str
    ) -> Optional["_SessionWorker"]:
        """Return the session's worker, lazily creating it (capped).

        Returns None when the concurrent-worker cap is hit (caller must
        apply backpressure). Worker creation is serialized by
        ``_workers_lock`` so two back-to-back messages for a NEW session
        cannot spawn two workers (which would break intra-session ordering).
        """
        async with self._workers_lock:
            worker = self._session_workers.get(session_id)
            if worker is not None and not worker.closing:
                if worker.task is not None and not worker.task.done():
                    return worker
                # Dead worker (task crashed/finished or never started) —
                # treat as absent: discard and recreate, otherwise the
                # session is permanently stranded behind a corpse.
                logger.warning(
                    "Discarding dead worker for session %s (task=%s) — recreating",
                    session_id,
                    "done" if worker.task is not None else "missing",
                )
                del self._session_workers[session_id]

            if len(self._session_workers) >= self._max_session_workers:
                return None

            worker = _SessionWorker(session_id)
            worker.task = asyncio.create_task(self._session_worker_loop(worker))
            self._session_workers[session_id] = worker
            logger.info(
                "Created per-session worker for %s (active workers=%d)",
                session_id,
                len(self._session_workers),
            )
            return worker

    async def _session_worker_loop(self, worker: "_SessionWorker") -> None:
        """The single ordered consumer for ONE session.

        Strictly sequential: it awaits each message to completion before
        pulling the next, so conversation turns for this session never
        reorder. Running ``_handle_queued_message`` HERE is also what keeps
        WR-06's ``_current_tracer`` ContextVar isolated per session under
        real concurrency (set + read both happen inside this task).
        """
        session_id = worker.session_id
        logger.debug("Session worker started for %s", session_id)
        try:
            while not self._shutdown_event.is_set() and not worker.closing:
                try:
                    message_data = await asyncio.wait_for(
                        worker.queue.get(), timeout=1.0
                    )
                except asyncio.TimeoutError:
                    continue
                worker.last_activity = datetime.now(timezone.utc)
                # Per-message processing timeout: prevent indefinite hangs from
                # stuck LLM calls or slow tool execution. Default 5 minutes.
                _MSG_TIMEOUT = int(os.environ.get("SESSION_WORKER_MSG_TIMEOUT_SECONDS", "300"))
                try:
                    await asyncio.wait_for(
                        self._handle_queued_message(message_data),
                        timeout=_MSG_TIMEOUT,
                    )
                except asyncio.TimeoutError:
                    logger.error(
                        "Session worker for %s: message processing timed out after %ds",
                        session_id, _MSG_TIMEOUT,
                    )
                    # Notify the user via WebSocket if possible
                    try:
                        ws_handler = self.websocket_handler
                        await ws_handler._send_to_session(session_id, {
                            "type": "error",
                            "error": "processing_timeout",
                            "message": "Your request took too long to process. Please try again.",
                        })
                    except Exception:
                        pass
                worker.last_activity = datetime.now(timezone.utc)
        except asyncio.CancelledError:
            logger.debug("Session worker for %s cancelled", session_id)
            raise
        except Exception as e:
            logger.error(
                "Session worker for %s crashed: %s", session_id, e
            )
        finally:
            # Self-deregister so a crashed worker can never permanently
            # strand its session — the next message recreates a worker.
            # Only remove if the registered entry IS this worker (teardown
            # may already have popped it, or a replacement may exist).
            # No await between check and delete, so this is race-free on
            # the event loop without taking _workers_lock.
            if self._session_workers.get(session_id) is worker:
                del self._session_workers[session_id]
            logger.debug("Session worker stopped for %s", session_id)

    async def _teardown_session_worker(
        self, session_id: str, reason: str
    ) -> None:
        """Deterministically tear down a session's worker.

        Cancels + awaits the worker task (no orphans) and discards any
        still-queued messages for the now-dead session with a logged reason
        — they are NOT processed against a closed session.
        """
        async with self._workers_lock:
            worker = self._session_workers.pop(session_id, None)
        if worker is None:
            return

        worker.closing = True
        pending = worker.queue.qsize()
        if pending:
            logger.info(
                "Discarding %d pending message(s) for session %s (%s)",
                pending,
                session_id,
                reason,
            )
        if worker.task and not worker.task.done():
            worker.task.cancel()
            try:
                await worker.task
            except (asyncio.CancelledError, Exception):
                pass
        logger.info(
            "Tore down per-session worker for %s (%s)", session_id, reason
        )

    async def _reap_idle_workers_loop(self) -> None:
        """Reap per-session workers idle past TTL.

        Mirrors SessionManager._cleanup_loop / ConversationMemory._cleanup_loop:
        a wait-for(shutdown, timeout=interval) tick loop that exits promptly
        on shutdown. CR-01-class invariant: this loop is only useful if it is
        actually STARTED — MessageProcessor.start() schedules it at app init.
        """
        logger.info(
            "Started per-session worker reaper (idle_ttl=%ss, interval=%ss)",
            self._session_worker_idle_ttl.total_seconds(),
            self._reap_interval_seconds,
        )
        while not self._shutdown_event.is_set():
            try:
                await asyncio.wait_for(
                    self._shutdown_event.wait(),
                    timeout=self._reap_interval_seconds,
                )
                break  # shutdown requested
            except asyncio.TimeoutError:
                pass  # interval elapsed — run a reap pass

            try:
                await self._reap_idle_workers_once()
            except Exception as e:
                logger.error(f"Error during worker reap pass: {e}")

        logger.info("Per-session worker reaper stopped")

    async def _reap_idle_workers_once(self) -> int:
        """Tear down workers idle (no messages, empty queue) past TTL.

        A DEAD worker (task missing or done) is reapable regardless of queue
        state — its queue can never drain, so requiring it to be empty would
        leak the worker forever.
        """
        cutoff = datetime.now(timezone.utc) - self._session_worker_idle_ttl
        async with self._workers_lock:
            idle = [
                sid
                for sid, w in self._session_workers.items()
                if (w.task is None or w.task.done())
                or (w.queue.empty() and w.last_activity < cutoff)
            ]
        for session_id in idle:
            await self._teardown_session_worker(
                session_id, reason="idle TTL expired"
            )
        if idle:
            logger.info("Reaped %d idle session worker(s)", len(idle))
        return len(idle)
    
    async def _handle_queued_message(self, message_data: Dict[str, Any]) -> None:
        """
        Handle a queued message.
        
        Args:
            message_data: The message data from the queue
        """
        message_type = message_data.get("type")
        
        try:
            if message_type == "chat_message":
                await self._handle_chat_message(message_data["message"])
            elif message_type == "auth_response":
                await self._handle_auth_response(
                    message_data["session_id"],
                    message_data["auth_code"]
                )
            else:
                logger.warning(f"Unknown message type in queue: {message_type}")
        
        except Exception as e:
            logger.error(f"Error handling queued message of type {message_type}: {e}")
    
    async def _handle_chat_message(self, chat_message: ChatMessage) -> None:
        """
        Handle a chat message by processing it with the agent.
        
        Args:
            chat_message: The chat message to handle
        """
        session_id = chat_message.session_id
        
        try:
            logger.info(f"Processing chat message {chat_message.id} from session {session_id}")
            
            # Send typing indicator
            await self.websocket_handler.send_message_to_session(session_id, {
                "type": "typing_start",
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
            
            # Process message with agent (with real-time tracing + optional WebSocket streaming)
            response = await self.agent.process_message_with_tracing(
                chat_message.content,
                session_id,
                stream_context={"websocket_handler": self.websocket_handler},
            )
            
            # Stop typing indicator
            await self.websocket_handler.send_message_to_session(session_id, {
                "type": "typing_stop",
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
            
            # Create assistant message
            assistant_message = ChatMessage.create_assistant_message(
                session_id=session_id,
                content=response,
                metadata={
                    "processing_time": datetime.now(timezone.utc).isoformat(),
                    "agent_version": "1.0"
                }
            )
            
            # Add to session history
            await self.session_manager.add_message_to_session(session_id, assistant_message)
            
            # Send response to user
            await self.websocket_handler.send_chat_response(
                session_id,
                response,
                metadata=assistant_message.metadata
            )
            
            logger.info(f"Successfully processed chat message {chat_message.id}")
            
        except Exception as e:
            logger.error(f"Error handling chat message {chat_message.id}: {e}")
            
            # Stop typing indicator
            await self.websocket_handler.send_message_to_session(session_id, {
                "type": "typing_stop",
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
            
            # Send error response
            await self._send_error_response(
                session_id,
                "I encountered an error while processing your message. Please try again."
            )
    
    async def _handle_auth_response(self, session_id: str, auth_code: AuthorizationCode) -> None:
        """
        Handle an authorization response by storing it in session context.

        Args:
            session_id: The session ID
            auth_code: The authorization code
        """
        try:
            logger.info(f"Handling auth response for session {session_id}")

            # Store auth code in session context for later use
            await self.session_manager.add_session_context(
                session_id,
                "pending_auth_code",
                {
                    "code": auth_code.code,
                    "state": auth_code.state,
                    "received_at": datetime.now(timezone.utc).isoformat()
                }
            )

            # Send confirmation to user
            await self.websocket_handler.send_message_to_session(session_id, {
                "type": "auth_confirmed",
                "message": "Authorization received successfully.",
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
            
            logger.info(f"Successfully handled auth response for session {session_id}")
            
        except Exception as e:
            logger.error(f"Error handling auth response for session {session_id}: {e}")
            await self._send_error_response(
                session_id,
                "Failed to process authorization response. Please try again."
            )
    
    async def _send_error_response(self, session_id: str, error_message: str) -> None:
        """
        Send an error response to a session.
        
        Args:
            session_id: The session ID
            error_message: The error message to send
        """
        try:
            await self.websocket_handler.send_message_to_session(session_id, {
                "type": "error_response",
                "message": error_message,
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
        except Exception as e:
            logger.error(f"Failed to send error response to session {session_id}: {e}")
    
    async def get_processor_stats(self) -> Dict[str, Any]:
        """
        Get statistics about the message processor.
        
        Returns:
            Dict containing processor statistics
        """
        return {
            "queue_size": self._message_queue.qsize(),
            "pending_auth_requests": len(self._pending_auth_requests),
            "processing_task_running": (
                self._processing_task is not None and
                not self._processing_task.done()
            ),
            "active_session_workers": len(self._session_workers),
            "max_session_workers": self._max_session_workers,
            "reaper_running": (
                self._reaper_task is not None
                and not self._reaper_task.done()
            ),
        }
    
    async def process_session_init_with_token(self, session_id: str, user_token: str) -> None:
        """
        Pre-identify the user STRICTLY from a validated PingOne access token
        delivered by the BFF proxy in `session_init` (Path A, CR-02/CR-04).

        Identity is derived only from validated token claims. Any failure is
        propagated so the WebSocket handler can refuse the session — there is
        no fallback to a client-supplied id/email (the CR-02 spoof primitive
        has been removed).

        Args:
            session_id: The chat session ID
            user_token: PingOne access token resolved server-side by the BFF.

        Raises:
            TokenValidationError: token absent / invalid / expired / wrong aud.
        """
        await self.agent.initialize_session_with_token(session_id, user_token)
        logger.info(
            "Token-bound identity established for session %s (Path A)", session_id
        )


    async def process_agui_message(
        self,
        session_id: str,
        message: str,
        auth_token: str,
        emitter,  # AGUIEventEmitter
        vertical_flavor: str = None,
        bff_tool_url: str = "",
        tool_schemas: list = None,
        messages_list: list = None,
        run_provider: str = None,
        run_model: str = None,
        user_identity: dict = None,
    ) -> None:
        """Process one agent turn and emit AG-UI events via the provided emitter.

        on_run_start / on_run_end are NOT called here -- the /run endpoint
        handles those before and after this method.

        Session identity is resolved from auth_token on every call so that
        stateless /run requests work without a prior session_init handshake.
        If the session is already identified (e.g. a second turn in the same
        SSE connection) the call is a no-op because initialize_session_with_token
        writes into conversation_memory which is idempotent on re-writes.

        When bff_tool_url is non-empty, uses a stateless per-run graph with BFF
        tools (RFC 8693 exchange happens in the BFF; tokenEvents flow back as
        STATE_DELTA). Otherwise falls through to the standard MCP graph path.

        Args:
            session_id: Conversation thread ID.
            message: The user message text for this turn.
            auth_token: PingOne access token (BFF-resolved; never browser-supplied).
            emitter: AGUIEventEmitter instance owned by the /run endpoint.
            bff_tool_url: When set, use BFF tool wiring instead of direct MCP.
            tool_schemas: Tool schema list from the BFF /run payload.
            messages_list: Full conversation history from the BFF (list of
                {role, content} dicts). Used as input for the stateless BFF path.
        """
        from langchain_core.messages import HumanMessage, SystemMessage, AIMessage
        from langchain_core.runnables import RunnableConfig

        # 1. Establish token-derived identity (mirrors process_session_init_with_token).
        if auth_token:
            await self.agent.initialize_session_with_token(session_id, auth_token)
        elif user_identity and user_identity.get("userId"):
            # BFF-tool path: identity is asserted by the BFF after the gateway
            # secret middleware authenticated the caller. Only accept a plain
            # string userId (reject objects/lists) and ignore a mismatched
            # sessionId claim if the BFF included one.
            uid = user_identity.get("userId")
            claimed_sid = user_identity.get("sessionId") or user_identity.get("session_id")
            if not isinstance(uid, str) or not uid.strip():
                logger.warning(
                    "[AG-UI] Ignoring non-string user_identity.userId for session %s",
                    session_id,
                )
            elif claimed_sid and str(claimed_sid) != str(session_id):
                logger.warning(
                    "[AG-UI] Ignoring user_identity with mismatched sessionId for session %s",
                    session_id,
                )
            else:
                await self.agent.conversation_memory.set_user_identified(
                    session_id,
                    user_identity.get("email") or "unknown",
                    uid.strip(),
                )
        else:
            logger.warning(
                "[AG-UI] process_agui_message called without auth_token or user_identity for session %s",
                session_id,
            )

        # 2. Determine which graph and input to use.
        # Per-run LLM: when the BFF sends a specific provider (e.g. 'anthropic-lmstudio'
        # from agent_mode=lmstudio), create a fresh LLM for this run instead of using
        # the startup-configured one. Keeps the agent instance reusable across modes.
        _LMSTUDIO_PROVIDERS = frozenset(["anthropic-lmstudio", "lmstudio"])
        _CLAUDE_PROVIDERS = frozenset(["anthropic"])
        _LLAMACPP_PROVIDERS = frozenset(["llamacpp"])
        _HELIX_PROVIDERS = frozenset(["helix"])
        _GROQ_PROVIDERS = frozenset(["groq"])
        _GOOGLE_PROVIDERS = frozenset(["google"])
        run_llm = self.agent.llm
        # True once a per-run provider actually produced its own LLM, so the MCP
        # graph path below knows to rebuild instead of reusing the startup graph.
        run_llm_overridden = False
        if run_provider and (run_provider in _LMSTUDIO_PROVIDERS or run_provider in _CLAUDE_PROVIDERS
                             or run_provider in _LLAMACPP_PROVIDERS or run_provider in _HELIX_PROVIDERS
                             or run_provider in _GROQ_PROVIDERS or run_provider in _GOOGLE_PROVIDERS):
            try:
                from agent.llm_factory import get_llm
                import os
                lc = self.agent.config.langchain
                if run_provider in _LLAMACPP_PROVIDERS:
                    run_llm = get_llm(
                        provider="llamacpp",
                        model=run_model or None,
                        temperature=lc.temperature,
                        max_tokens=lc.max_tokens,
                        streaming=bool(getattr(lc, "stream_llm_tokens", True)),
                        llamacpp_base_url=getattr(lc, "llamacpp_base_url", "http://127.0.0.1:8090"),
                        llamacpp_model=getattr(lc, "llamacpp_model", "phi-4-mini-instruct"),
                    )
                elif run_provider in _LMSTUDIO_PROVIDERS:
                    run_llm = get_llm(
                        provider=run_provider,
                        model=run_model or None,
                        api_key="lm-studio",
                        temperature=lc.temperature,
                        max_tokens=lc.max_tokens,
                        streaming=bool(getattr(lc, "stream_llm_tokens", True)),
                        lmstudio_base_url=getattr(lc, "lmstudio_base_url", "http://localhost:1234/v1"),
                    )
                elif run_provider in _HELIX_PROVIDERS:
                    # Helix — tenant-specific config carried on the agent's
                    # LangChainConfig (no env fallbacks; get_llm raises if unset).
                    run_llm = get_llm(
                        provider="helix",
                        model=run_model or None,
                        temperature=lc.temperature,
                        max_tokens=lc.max_tokens,
                        streaming=bool(getattr(lc, "stream_llm_tokens", True)),
                        helix_base_url=getattr(lc, "helix_base_url", ""),
                        helix_api_key=getattr(lc, "helix_api_key", ""),
                        helix_environment_id=getattr(lc, "helix_environment_id", ""),
                        helix_agent_id=getattr(lc, "helix_agent_id", ""),
                        helix_prompt_field_id=getattr(lc, "helix_prompt_field_id", ""),
                    )
                elif run_provider in _GROQ_PROVIDERS:
                    # GroqCloud — real key required (billed cloud API); no env
                    # fallback default, get_llm() raises if unset.
                    run_llm = get_llm(
                        provider="groq",
                        model=run_model or getattr(lc, "groq_model", None) or None,
                        api_key=getattr(lc, "groq_api_key", "") or os.environ.get("GROQ_API_KEY", ""),
                        temperature=lc.temperature,
                        max_tokens=lc.max_tokens,
                        streaming=bool(getattr(lc, "stream_llm_tokens", True)),
                        groq_base_url=getattr(lc, "groq_base_url", "https://api.groq.com/openai/v1"),
                    )
                elif run_provider in _GOOGLE_PROVIDERS:
                    # Gemini — real key required (billed cloud API); no env
                    # fallback default, get_llm() raises if unset.
                    run_llm = get_llm(
                        provider="google",
                        model=run_model or getattr(lc, "google_model", None) or None,
                        api_key=getattr(lc, "google_api_key", "") or os.environ.get("GOOGLE_API_KEY", ""),
                        temperature=lc.temperature,
                        max_tokens=lc.max_tokens,
                        streaming=bool(getattr(lc, "stream_llm_tokens", True)),
                        google_base_url=getattr(lc, "google_base_url", "https://generativelanguage.googleapis.com/v1beta/openai/"),
                    )
                else:
                    # anthropic — use real Anthropic API key from env
                    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
                    run_llm = get_llm(
                        provider="anthropic",
                        model=run_model or None,
                        api_key=api_key,
                        temperature=lc.temperature,
                        max_tokens=lc.max_tokens,
                        streaming=bool(getattr(lc, "stream_llm_tokens", True)),
                    )
                run_llm_overridden = run_llm is not None and run_llm is not self.agent.llm
                logger.info("[AG-UI] per-run LLM override: provider=%s model=%s applied=%s",
                            run_provider, run_model or "auto", run_llm_overridden)
            except Exception as _llm_err:
                logger.warning("[AG-UI] per-run LLM init failed (%s), using default", _llm_err)
                run_llm = self.agent.llm

        if bff_tool_url and tool_schemas:
            # ── BFF tool path ──────────────────────────────────────────────────
            # Build a stateless per-run graph so RFC 8693 token exchange happens
            # inside the BFF /internal/agent-tool call (not bypassed via MCP WS).
            if run_llm is None:
                _no_llm_msg = (
                    "No LLM is configured (LANGCHAIN_LLM_PROVIDER=none). "
                    "Set LANGCHAIN_LLM_PROVIDER in langchain_agent/.env to enable AI responses."
                )
                await emitter.on_llm_start()
                await emitter.on_llm_new_token(_no_llm_msg)
                await emitter.on_llm_end()
                return
            from agui.bff_tool_adapter import build_bff_tools
            from langgraph.prebuilt import create_react_agent

            bff_tools = build_bff_tools(
                tool_schemas, bff_tool_url, session_id, emitter._sink
            )
            # F2: bound the BFF-path prompt the same way the startup MCP graph
            # does. Without this hook the full AG-UI history is replayed every
            # turn, so a long chat grows unbounded and eventually overflows the
            # context window. Reuse the agent's existing token-trimming hook.
            active_graph = create_react_agent(
                run_llm, bff_tools, pre_model_hook=self.agent._pre_model_hook
            )
            active_config = RunnableConfig(
                recursion_limit=getattr(self.agent.config.langchain, "max_iterations", 25),
            )

            # Convert the full conversation history (all messages from the BFF
            # request, including the current turn) to LangChain message objects.
            def _to_lc(msgs):
                result = []
                for m in msgs:
                    role = m.get("role", "user")
                    content = m.get("content", "")
                    if isinstance(content, list):
                        content = " ".join(
                            c.get("text", "") for c in content
                            if isinstance(c, dict) and c.get("type") == "text"
                        )
                    if role == "user":
                        result.append(HumanMessage(content=content))
                    elif role == "assistant":
                        result.append(AIMessage(content=content))
                    elif role == "system":
                        result.append(SystemMessage(content=content))
                return result

            hist = _to_lc(messages_list or [])
            # Prepend a system message on the first turn if the history doesn't
            # already start with one.
            if not hist or not isinstance(hist[0], SystemMessage):
                system_text = await self.agent._build_system_message(
                    session_id, vertical_flavor=vertical_flavor
                )
                hist = [SystemMessage(content=system_text)] + hist

            agent_input = {"messages": hist}
            logger.info(
                "[AG-UI] BFF tool path session=%s tools=%d msgs=%d",
                session_id, len(bff_tools), len(hist),
            )
        else:
            # ── MCP graph path (existing) ──────────────────────────────────────
            # Honor the per-run LLM override on this path too. The startup graph
            # is bound to self.agent.llm (which may be None when
            # LANGCHAIN_LLM_PROVIDER=none); when the user picked a different
            # provider for this run, build a graph from run_llm over the MCP
            # tools + shared checkpointer so the selection isn't silently ignored
            # (and the "No LLM configured" message isn't shown despite a choice).
            if run_llm_overridden:
                if not self.agent._tools:
                    try:
                        self.agent._tools = await self.agent.mcp_tool_provider.get_langchain_tools()
                    except Exception:
                        logger.warning("[AG-UI] MCP tool load failed for per-run graph; running tool-less")
                        self.agent._tools = self.agent._tools or []
                from langgraph.prebuilt import create_react_agent as _create_react_agent
                active_graph = _create_react_agent(
                    model=run_llm,
                    tools=self.agent._tools,
                    pre_model_hook=self.agent._pre_model_hook,
                    checkpointer=self.agent._checkpointer,
                )
                logger.info("[AG-UI] MCP path using per-run LLM override (provider=%s)", run_provider)
            else:
                if not self.agent._graph:
                    await self.agent.initialize_tools()
                    if not self.agent._graph:
                        if self.agent.llm is None:
                            _no_llm_msg = (
                                "No LLM is configured (LANGCHAIN_LLM_PROVIDER=none). "
                                "Set LANGCHAIN_LLM_PROVIDER in langchain_agent/.env to enable AI responses."
                            )
                            await emitter.on_llm_start()
                            await emitter.on_llm_new_token(_no_llm_msg)
                            await emitter.on_llm_end()
                            return
                        raise RuntimeError("Agent graph failed to initialise")
                active_graph = self.agent._graph

            # Inject SystemMessage only on the first turn.
            try:
                graph_state = active_graph.get_state(
                    {"configurable": {"thread_id": session_id}}
                )
                has_prior_history = bool(graph_state.values.get("messages"))
            except Exception:
                has_prior_history = False

            if has_prior_history:
                msgs_for_graph = [HumanMessage(content=message)]
            else:
                system_msg_text = await self.agent._build_system_message(
                    session_id, vertical_flavor=vertical_flavor
                )
                msgs_for_graph = [
                    SystemMessage(content=system_msg_text),
                    HumanMessage(content=message),
                ]

            await self.agent.mcp_tool_provider.set_session_context(session_id)

            active_config = RunnableConfig(
                configurable={"thread_id": session_id},
                recursion_limit=getattr(self.agent.config.langchain, "max_iterations", 25),
            )
            agent_input = {"messages": msgs_for_graph}

        # 3. Stream events from the chosen graph and route to the emitter.
        llm_streaming = False
        total_input_tokens = 0
        total_output_tokens = 0
        turn_reply_text = ""
        pending_tool_calls: dict = {}
        turn_tool_calls: list = []
        # True once the run has produced ANYTHING the user can see (streamed
        # text, a single-shot fallback message, or a tool call). A model that
        # returns empty content and calls no tool -- seen intermittently with
        # Groq on ambiguous prompts -- otherwise leaves the user staring at a
        # blank chat with no error and no explanation.
        any_visible_output = False

        async for event in active_graph.astream_events(
            agent_input, config=active_config, version="v2"
        ):
            event_name = event.get("event")
            event_data = event.get("data") or {}

            if event_name == "on_chat_model_stream":
                chunk = event_data.get("chunk")
                # Flatten provider content: OpenAI-style models stream a str,
                # Anthropic-style providers stream a list of content blocks.
                # Without this the delta is a list that JSON-serializes and
                # renders client-side as "[object Object]".
                token = _content_to_text(getattr(chunk, "content", "")) if chunk is not None else ""
                if token:
                    if not llm_streaming:
                        await emitter.on_llm_start()
                        llm_streaming = True
                    await emitter.on_llm_new_token(token)
                    turn_reply_text += token
                    any_visible_output = True

            elif event_name == "on_chat_model_end":
                output = event_data.get("output")
                # Some providers (e.g. ChatHelix, whose API is poll-based, not
                # SSE) never emit on_chat_model_stream chunks, so llm_streaming
                # stays False and the visible chat bubble is never created —
                # the final text only reaches on_llm_detail (debug panel), not
                # the user. Surface it here as a single-shot message instead.
                if not llm_streaming and output is not None:
                    final_text = _content_to_text(getattr(output, "content", ""))
                    if final_text:
                        await emitter.on_llm_start()
                        await emitter.on_llm_new_token(final_text)
                        await emitter.on_llm_end()
                        any_visible_output = True
                        # Capture the single-shot reply too so the policy-denial
                        # fallback below can tell whether the model already
                        # explained the denial (the streaming path accumulates it
                        # via on_chat_model_stream; this non-streaming path did not).
                        turn_reply_text += final_text
                if output and (usage := getattr(output, "usage_metadata", None)):
                    # usage_metadata is a TypedDict (plain dict at runtime), so
                    # attribute access always yields the default 0 — read keys.
                    if isinstance(usage, dict):
                        total_input_tokens += usage.get("input_tokens", 0) or 0
                        total_output_tokens += usage.get("output_tokens", 0) or 0
                    else:
                        total_input_tokens += getattr(usage, "input_tokens", 0) or 0
                        total_output_tokens += getattr(usage, "output_tokens", 0) or 0

                try:
                    _msgs = event_data.get("input", {}).get("messages") or []
                    _flat = []
                    for _group in _msgs:
                        for _m in (_group if isinstance(_group, list) else [_group]):
                            _flat.append({
                                "role": getattr(_m, "type", None) or getattr(_m, "role", "?"),
                                "content": str(getattr(_m, "content", ""))[:600],
                            })
                    _tool_calls = list(getattr(output, "tool_calls", None) or [])
                    await emitter.on_llm_detail(
                        model=event.get("metadata", {}).get("ls_model_name", "unknown"),
                        messages=_flat,
                        tool_calls=_tool_calls,
                        usage={
                            "inputTokens": total_input_tokens,
                            "outputTokens": total_output_tokens,
                        },
                    )
                except Exception:
                    logger.exception("llm_detail emission failed (non-fatal)")

            elif event_name == "on_tool_start":
                if llm_streaming:
                    await emitter.on_llm_end()
                    llm_streaming = False
                serialized = {"name": event.get("name", "unknown_tool")}
                tool_call_id = event.get("run_id")
                pending_tool_calls[tool_call_id] = {
                    "name": event.get("name", "unknown_tool"),
                    "args": event_data.get("input"),
                }
                any_visible_output = True
                await emitter.on_tool_start(
                    serialized,
                    tool_call_id=tool_call_id,
                    inputs=event_data.get("input"),
                )

            elif event_name == "on_tool_end":
                output = event_data.get("output", "")
                tool_call_id = event.get("run_id")
                pending = pending_tool_calls.pop(tool_call_id, None)
                if pending is not None:
                    turn_tool_calls.append(
                        ToolCallRecord(
                            name=pending["name"],
                            args=pending["args"],
                            result=_tool_result_text(output),
                        )
                    )
                await emitter.on_tool_end(output, tool_call_id=tool_call_id)

            elif event_name == "on_chain_error":
                error = event_data.get("error") or RuntimeError("Agent chain error")
                if llm_streaming:
                    await emitter.on_llm_end()
                    llm_streaming = False
                await emitter.on_error(error)
                return  # on_error emits RUN_FINISHED; avoid double RUN_FINISHED from caller

        # 4. Close the LLM message if it was still open at stream end.
        if llm_streaming:
            await emitter.on_llm_end()

        # An approval gate ends the turn as an interrupt. The model has already
        # said its piece above (usually "I've submitted the request"), but the
        # run must STOP here rather than fall through to a plain RUN_FINISHED —
        # that is the only event the SPA turns into a consent modal, and without
        # it the challenge is created and never approvable.
        _interrupt = _extract_hitl_interrupt(turn_tool_calls)
        if _interrupt:
            logger.info(
                "[AG-UI] turn interrupted for human approval (tool=%s challenge=%s)",
                _interrupt.get("tool"), _interrupt.get("interruptId"),
            )
            await emitter.on_hitl_interrupt(_interrupt)
            return  # on_hitl_interrupt emits the terminal RUN_FINISHED

        # Deterministic policy-denial fallback: if a tool was blocked by an
        # authorization / gateway policy but the model's reply never surfaced it
        # (e.g. the banking persona greeted or changed the subject), state the
        # denial plainly as its own message — parity with the in-process
        # heuristic path's "❌ <reason>" so the user always sees WHY it was
        # blocked, regardless of what the LLM chose to say. Rule 21 in the system
        # prompt steers the normal case; this guarantees the tail case.
        _denial = _extract_policy_denial(turn_tool_calls)
        if _denial and not _reply_surfaces_denial(turn_reply_text):
            _notice = f"❌ {_denial}"
            await emitter.on_llm_start()
            await emitter.on_llm_new_token(_notice)
            await emitter.on_llm_end()
            turn_reply_text += ("\n" if turn_reply_text else "") + _notice
            any_visible_output = True

        if not any_visible_output:
            logger.warning(
                "[AG-UI] run produced no visible output (no text, no tool call) for session %s",
                session_id,
            )
            await emitter.on_error(RuntimeError(
                "The model didn't return a usable response. Try rephrasing your "
                "request or sending it again."
            ))
            return

        if contains_commitment_claim(turn_reply_text):
            try:
                async def _chat_fn(prompt: str) -> str:
                    resp = await run_llm.ainvoke([HumanMessage(content=prompt)])
                    return _content_to_text(getattr(resp, "content", ""))

                validator = CommitmentGroundingValidator(chat_fn=_chat_fn, on_fail="fix")
                check = await validator.async_validate(
                    turn_reply_text, {"tool_calls": turn_tool_calls}
                )
                if isinstance(check, FailResult):
                    await emitter.on_grounding_correction(
                        original=turn_reply_text,
                        corrected=check.fix_value,
                        note=check.error_message,
                    )
            except Exception:
                # Fail open on ANY error in the grounding-check block (not
                # just the LLM call, which the validator itself already
                # fails open on internally) -- e.g. CommitmentGroundingValidator
                # construction raising ValueError when ~/.guardrailsrc is
                # missing. Never block or alter an already-streamed reply on
                # a grounding-check error.
                logger.exception("[grounding] guardrail check failed; failing open")

        if total_input_tokens or total_output_tokens:
            await emitter.on_usage(total_input_tokens, total_output_tokens)

        logger.info("[AG-UI] process_agui_message complete for session %s", session_id)

    def _sweep_pending_auth_requests(self) -> int:
        """Evict pending auth requests older than _pending_auth_ttl.

        Called on every auth_response receipt and at queue-loop idle ticks.
        Returns the number of entries evicted.
        """
        cutoff = datetime.now(timezone.utc) - self._pending_auth_ttl
        expired_states = [
            state
            for state, (_sid, created_at) in self._pending_auth_requests.items()
            if created_at < cutoff
        ]
        for state in expired_states:
            del self._pending_auth_requests[state]
        if expired_states:
            logger.info(
                "Evicted %d expired pending auth request(s)", len(expired_states)
            )
        return len(expired_states)

    async def clear_session_data(self, session_id: str) -> None:
        """
        Clear all processor data for a session.
        
        Args:
            session_id: The session ID to clear
        """
        # Remove pending auth requests for this session
        states_to_remove = [
            state for state, (sid, _ts) in self._pending_auth_requests.items()
            if sid == session_id
        ]
        for state in states_to_remove:
            del self._pending_auth_requests[state]

        # WR-02 Option A: deterministic per-session worker teardown on close
        # (WS disconnect / session_close). Pending messages for the now-dead
        # session are discarded with a logged reason — never processed
        # against a closed session.
        await self._teardown_session_worker(
            session_id, reason="session closed"
        )

        # F6: evict the LangGraph checkpoint + conversation memory for this
        # ended session. The process-lifetime MemorySaver otherwise retains
        # every session's state forever. Called only on session close (WS
        # disconnect / session_close), so an active session is never evicted.
        # Best-effort: a failure here must not break connection cleanup.
        try:
            await self.agent.clear_session_memory(session_id)
        except Exception as e:
            logger.warning(
                f"Failed to clear agent memory for session {session_id}: {e}"
            )

        logger.debug(f"Cleared processor data for session {session_id}")
    
    async def shutdown(self) -> None:
        """Shutdown the message processor and clean up resources."""
        await self.stop()
        
        # Clear all pending data
        self._pending_auth_requests.clear()

        # Clear message queue
        while not self._message_queue.empty():
            try:
                self._message_queue.get_nowait()
            except asyncio.QueueEmpty:
                break
        
        logger.info("MessageProcessor shutdown complete")