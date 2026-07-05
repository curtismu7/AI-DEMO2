"""FastAPI route: POST /run — AG-UI SSE endpoint (Phase 1.5).

Streams AG-UI events as Server-Sent Events for the AG-UI protocol.
Only registered when config.langchain.agui_enabled is True.
"""
from __future__ import annotations

import asyncio
import logging
import os
import uuid
from typing import Any, AsyncGenerator, Dict, Optional

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from agui.bff_tool_adapter import resolve_bff_tool_url
from agui.emitter import AGUIEventEmitter
from agui.sse_transport import format_sse, KEEPALIVE_PING

logger = logging.getLogger(__name__)

router = APIRouter()


def _configured_bff_tool_url() -> str:
    """Server-side BFF tool URL, used when a request supplies an untrusted host."""
    explicit = os.environ.get("BFF_INTERNAL_TOOL_URL", "").rstrip("/")
    if explicit:
        return explicit if explicit.endswith("/internal/agent-tool") else explicit + "/internal/agent-tool"
    base = os.environ.get("BFF_BASE_URL", "").rstrip("/")
    if base:
        return base + "/internal/agent-tool"
    return "http://127.0.0.1:3001/internal/agent-tool"

_message_processor: Optional[Any] = None


def set_message_processor(mp: Any) -> None:
    """Wire in the MessageProcessor instance at startup."""
    global _message_processor
    _message_processor = mp


@router.post("/run")
async def agent_run(request: Request) -> StreamingResponse:
    """Accept a chat message and stream AG-UI events back as SSE."""
    body: Dict[str, Any] = await request.json()

    # BFF (agentRun.js) sends { threadId, runId, messages: [...], context: { sessionId, ... } }.
    # Fall back to legacy top-level fields so both formats work.
    context: Dict[str, Any] = body.get("context") or {}

    # Last user message — prefer new "messages" array; fall back to legacy "message" string.
    message: str = body.get("message", "")
    messages_list = body.get("messages") or []
    if messages_list:
        for msg in reversed(messages_list):
            role = msg.get("role", "")
            if role == "user":
                content = msg.get("content", "")
                if isinstance(content, str):
                    message = content
                elif isinstance(content, list):
                    message = " ".join(
                        c.get("text", "") for c in content
                        if isinstance(c, dict) and c.get("type") == "text"
                    )
                if message:
                    break

    # Session ID from context (new format) or top-level (legacy).
    session_id: str = (
        context.get("sessionId")
        or body.get("session_id")
        or f"sess_{uuid.uuid4().hex[:8]}"
    )

    auth_token: str = body.get("auth_token", "")
    run_id: str = f"run_{uuid.uuid4().hex[:12]}"
    # Vertical persona injected by the BFF from the active vertical manifest.
    # Used to override the base persona in _build_system_message on the first turn.
    vertical_flavor: Optional[str] = body.get("vertical_flavor") or None

    # BFF wiring: when agent_external_wiring='bff', the BFF sends bffToolUrl and
    # tool schemas so the agent calls back via /internal/agent-tool (RFC 8693
    # token exchange happens there, tokenEvents flow back as STATE_DELTA).
    bff_tool_url: str = resolve_bff_tool_url(context.get("bffToolUrl", ""), _configured_bff_tool_url())
    tool_schemas: list = body.get("tools") or []
    # Per-run LLM override forwarded from BFF (set by agent_mode selection in the UI).
    # When the user selects LM Studio mode, the BFF derives provider='anthropic-lmstudio'
    # from the session's langchain_config and sends it here so the agent uses LM Studio
    # instead of whatever LANGCHAIN_LLM_PROVIDER is configured at startup.
    run_provider: Optional[str] = context.get("provider") or None
    run_model: Optional[str] = context.get("model") or None
    # Non-sensitive identity injected by the BFF (userId + display email). The
    # BFF never sends the user's access token here (token exchange stays in the
    # BFF), so this is the only way the agent knows the caller is already
    # authenticated and should not ask them to identify by email.
    user_identity: Optional[Dict[str, Any]] = context.get("userIdentity") or None

    logger.info("[AG-UI] /run session=%s run=%s msg_len=%d bff_tools=%d provider=%s",
                session_id, run_id, len(message), len(tool_schemas), run_provider or "default")

    return StreamingResponse(
        _run_stream(run_id, session_id, message, auth_token, vertical_flavor,
                    bff_tool_url=bff_tool_url, tool_schemas=tool_schemas,
                    messages_list=messages_list, run_provider=run_provider, run_model=run_model,
                    user_identity=user_identity),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


async def _run_stream(
    run_id: str, session_id: str, message: str, auth_token: str,
    vertical_flavor: Optional[str] = None,
    bff_tool_url: str = "",
    tool_schemas: Optional[list] = None,
    messages_list: Optional[list] = None,
    run_provider: Optional[str] = None,
    run_model: Optional[str] = None,
    user_identity: Optional[Dict[str, Any]] = None,
) -> AsyncGenerator[str, None]:
    """Drive the agent and yield SSE frames from an asyncio.Queue."""
    queue: asyncio.Queue = asyncio.Queue()

    async def sink(event_dict: Dict[str, Any]) -> None:
        await queue.put(event_dict)

    async def finish() -> None:
        await queue.put(None)  # sentinel: stream done

    emitter = AGUIEventEmitter(run_id=run_id, thread_id=session_id, sink=sink)

    async def keepalive() -> None:
        while True:
            await asyncio.sleep(15)
            await queue.put("__ping__")

    ka_task = asyncio.create_task(keepalive())
    agent_task = asyncio.create_task(
        _invoke_agent(emitter, session_id, message, auth_token, finish, vertical_flavor,
                      bff_tool_url=bff_tool_url, tool_schemas=tool_schemas or [],
                      messages_list=messages_list or [], run_provider=run_provider,
                      run_model=run_model, user_identity=user_identity)
    )

    try:
        while True:
            item = await queue.get()
            if item is None:
                break
            if item == "__ping__":
                yield KEEPALIVE_PING
            else:
                yield format_sse(item)
    finally:
        # F5: cancel AND await so in-flight httpx/tool work is torn down
        # cleanly instead of being abandoned when the client disconnects.
        ka_task.cancel()
        agent_task.cancel()
        for _t in (ka_task, agent_task):
            try:
                await _t
            except asyncio.CancelledError:
                pass
            except Exception:
                logger.debug("[AG-UI] task teardown error", exc_info=True)


async def _invoke_agent(
    emitter: AGUIEventEmitter,
    session_id: str,
    message: str,
    auth_token: str,
    finish_fn,
    vertical_flavor: Optional[str] = None,
    bff_tool_url: str = "",
    tool_schemas: Optional[list] = None,
    messages_list: Optional[list] = None,
    run_provider: Optional[str] = None,
    run_model: Optional[str] = None,
    user_identity: Optional[Dict[str, Any]] = None,
) -> None:
    """Invoke the message processor and drive emitter lifecycle."""
    if _message_processor is None:
        await emitter.on_run_start()
        await emitter.on_error(RuntimeError("Message processor not initialised"))
        await finish_fn()
        return

    process_fn = getattr(_message_processor, "process_agui_message", None)
    if process_fn is None:
        await emitter.on_run_start()
        await emitter.on_error(
            NotImplementedError(
                "MessageProcessor.process_agui_message not yet implemented"
            )
        )
        await finish_fn()
        return

    try:
        await emitter.on_run_start()
        await process_fn(
            session_id=session_id,
            message=message,
            auth_token=auth_token,
            emitter=emitter,
            vertical_flavor=vertical_flavor,
            bff_tool_url=bff_tool_url,
            tool_schemas=tool_schemas or [],
            messages_list=messages_list or [],
            run_provider=run_provider,
            run_model=run_model,
            user_identity=user_identity,
        )
        await emitter.on_run_end()
    except Exception as exc:
        logger.exception("[AG-UI] Agent run error session=%s", session_id)
        await emitter.on_error(exc)
    finally:
        await finish_fn()
