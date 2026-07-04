from __future__ import annotations
import uuid
from typing import AsyncIterator
from fastapi import Request
from fastapi.responses import StreamingResponse
from pydantic_ai.messages import ModelRequest, ModelResponse, UserPromptPart, TextPart
from .agent_factory import build_agent
from .agui_emitter import AGUIEmitter
from .bff_tool_adapter import resolve_bff_tool_url
from .models import BffDeps
from . import config as cfg


async def _error_stream(message: str) -> AsyncIterator[str]:
    """Stream an error event."""
    yield f"event:error\ndata:{message}\n\n"


async def handle_run(request: Request) -> StreamingResponse:
    body = await request.json()
    thread_id: str = body.get("threadId", str(uuid.uuid4()))
    run_id: str = body.get("runId", str(uuid.uuid4()))
    messages: list[dict] = body.get("messages", [])
    tool_schemas: list[dict] = body.get("tools", [])
    ctx_data: dict = body.get("context", {})
    # Vertical persona forwarded by the BFF from the active vertical manifest.
    # Used to override the default banking system prompt so the agent replies
    # in the active vertical's language (care, retail, sports, workforce, etc.).
    vertical_flavor: str | None = body.get("vertical_flavor") or None

    bff_tool_url: str = resolve_bff_tool_url(ctx_data.get("bffToolUrl", ""), cfg.BFF_INTERNAL_TOOL_URL)
    # BFF doesn't include its internal secret in the run context (the secret
    # lives on the BFF, not in payloads). Fall back to the same env-resolved
    # value the agent will use for its own /internal/agent-tool callbacks.
    bff_internal_secret: str = ctx_data.get("bffInternalSecret") or cfg.BFF_INTERNAL_SECRET
    session_id: str = ctx_data.get("sessionId", "")
    # Per-run model override from BFF context wins; falls back to the env-
    # resolved default (LM Studio's loaded model).
    model: str = ctx_data.get("model") or cfg.LLM_MODEL
    # Provider from BFF context: "anthropic" switches to Anthropic; anything
    # else (including "anthropic-lmstudio", "lmstudio", "") stays on LM Studio.
    run_provider: str = ctx_data.get("provider") or ""

    deps = BffDeps(
        bff_tool_url=bff_tool_url,
        bff_internal_secret=bff_internal_secret,
        session_id=session_id,
    )

    # Validate that messages array has at least one user message with content
    if not messages or not any(m.get("role") == "user" and m.get("content") for m in messages):
        return StreamingResponse(
            _error_stream("No user message found in request. Provide at least one message with role='user' and non-empty content."),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # Build message_history from all turns except the final one so pydantic-ai
    # sees prior context. The last user message is the live prompt.
    msg_history: list = []
    for msg in messages[:-1]:
        role = msg.get("role")
        content = msg.get("content", "")
        if role == "user":
            msg_history.append(ModelRequest(parts=[UserPromptPart(content=content)]))
        elif role == "assistant":
            msg_history.append(ModelResponse(parts=[TextPart(content=content)]))

    user_message = next(
        (m.get("content", "") for m in reversed(messages) if m.get("role") == "user"),
        "",
    )

    async def stream_events() -> AsyncIterator[str]:
        collected: list[str] = []

        async def sink(data: str) -> None:
            collected.append(data)

        emitter = AGUIEmitter(run_id, thread_id, sink)

        try:
            await emitter.on_run_start()
            while collected:
                yield collected.pop(0)

            # Built inside the try so a construction failure (bad provider, bad
            # tool schema) surfaces as RUN_ERROR after RUN_STARTED instead of
            # tearing down the SSE stream with no terminal event (empty dock).
            agent = build_agent(
                tool_schemas,
                model_name=model,
                base_url=cfg.LLM_BASE_URL,
                api_key=cfg.LLM_API_KEY,
                system_prompt=vertical_flavor,
                provider=run_provider,
                emit_fn=emitter.emit,
            )

            message_id = str(uuid.uuid4())

            async with agent.run_stream(
                user_message, deps=deps, message_history=msg_history or None
            ) as result:
                await emitter.on_text_start(message_id)
                while collected:
                    yield collected.pop(0)

                async for text in result.stream_text(delta=True):
                    await emitter.on_text_token(message_id, text)
                    while collected:
                        yield collected.pop(0)

            await emitter.on_text_end(message_id)
            while collected:
                yield collected.pop(0)

            await emitter.on_run_end()
            while collected:
                yield collected.pop(0)

        except Exception as exc:
            collected.clear()
            await emitter.on_error(str(exc))
            while collected:
                yield collected.pop(0)

    return StreamingResponse(
        stream_events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
