from __future__ import annotations
import logging
import uuid
from typing import AsyncIterator
from fastapi import Request
from fastapi.responses import StreamingResponse
from pydantic_ai.messages import ModelRequest, ModelResponse, UserPromptPart, TextPart
from pydantic_ai.settings import ModelSettings
from pydantic_ai.usage import UsageLimits
from .agent_factory import build_agent
from .agui_emitter import AGUIEmitter
from .bff_tool_adapter import resolve_bff_tool_url
from .models import BffDeps
from . import config as cfg
from .grounding_guardrail import CommitmentGroundingValidator, ToolCallRecord, contains_commitment_claim
from guardrails.validator_base import FailResult
from pydantic_ai.messages import ToolCallPart, ToolReturnPart
import httpx

logger = logging.getLogger(__name__)

_SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


def _extract_tool_calls(messages) -> list:
    pending: dict = {}
    records: list = []
    for msg in messages:
        for part in getattr(msg, "parts", []):
            if isinstance(part, ToolCallPart):
                pending[part.tool_call_id] = {"name": part.tool_name, "args": part.args}
            elif isinstance(part, ToolReturnPart):
                info = pending.pop(part.tool_call_id, None)
                if info is not None:
                    records.append(
                        ToolCallRecord(name=info["name"], args=info["args"], result=str(part.content))
                    )
    return records


async def _error_stream(run_id: str, thread_id: str, message: str) -> AsyncIterator[str]:
    """Stream a malformed-request error as proper AG-UI events.

    Emits RUN_STARTED then RUN_ERROR (JSON, "data: " prefixed) using the same
    AGUIEmitter shapes as a normal run, so the UI dock surfaces the error
    instead of hanging on an unterminated stream.
    """
    collected: list[str] = []

    async def sink(data: str) -> None:
        collected.append(data)

    emitter = AGUIEmitter(run_id, thread_id, sink)
    await emitter.on_run_start()
    await emitter.on_error(message)
    for item in collected:
        yield item


async def handle_run(request: Request) -> StreamingResponse:
    try:
        body = await request.json()
    except Exception:
        # A malformed body must still terminate with the SSE/RUN_ERROR contract,
        # not a raw 500 that leaves the dock empty. No threadId/runId is
        # available yet, so synthesize them.
        return StreamingResponse(
            _error_stream(
                str(uuid.uuid4()),
                str(uuid.uuid4()),
                "Malformed request body: expected a JSON object.",
            ),
            media_type="text/event-stream",
            headers=_SSE_HEADERS,
        )
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
    # The BFF forwards the initial token-exchange events (the sign-in / exchange
    # that happened before the agent ran) so the token-chain rail can show them.
    initial_token_events: list = ctx_data.get("initialTokenEvents") or []

    deps = BffDeps(
        bff_tool_url=bff_tool_url,
        bff_internal_secret=bff_internal_secret,
        session_id=session_id,
    )

    # Validate that messages array has at least one user message with content
    last_user_idx = next(
        (
            i
            for i in range(len(messages) - 1, -1, -1)
            if messages[i].get("role") == "user" and messages[i].get("content")
        ),
        None,
    )
    if last_user_idx is None:
        return StreamingResponse(
            _error_stream(
                run_id,
                thread_id,
                "No user message found in request. Provide at least one message "
                "with role='user' and non-empty content.",
            ),
            media_type="text/event-stream",
            headers=_SSE_HEADERS,
        )

    # The live prompt is the final user turn; history is exactly the turns
    # before it. Slicing at last_user_idx (rather than messages[:-1]) means a
    # trailing assistant turn no longer duplicates the last user message into
    # both history and prompt, and any non-empty turn before the prompt is
    # preserved instead of dropped.
    msg_history: list = []
    for msg in messages[:last_user_idx]:
        content = msg.get("content", "")
        if not content:
            continue
        if msg.get("role") == "assistant":
            msg_history.append(ModelResponse(parts=[TextPart(content=content)]))
        else:
            msg_history.append(ModelRequest(parts=[UserPromptPart(content=content)]))

    user_message = messages[last_user_idx].get("content", "")

    async def stream_events() -> AsyncIterator[str]:
        collected: list[str] = []

        async def sink(data: str) -> None:
            collected.append(data)

        emitter = AGUIEmitter(run_id, thread_id, sink)

        try:
            await emitter.on_run_start()
            # Replay the initial token-exchange events into the stream so the
            # token-chain rail shows the pre-run exchange. Same op-array shape
            # bff_tool_adapter uses for per-tool token events.
            for te in initial_token_events:
                await emitter.emit({
                    "type": "STATE_DELTA",
                    "delta": [{"op": "add", "path": "/tokenEvents/-", "value": te}],
                })
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
                user_message,
                deps=deps,
                message_history=msg_history or None,
                # Bound the LLM call and the tool-call loop so a hung provider or
                # a runaway agent can't stall the stream indefinitely.
                model_settings=ModelSettings(timeout=cfg.LLM_TIMEOUT),
                usage_limits=UsageLimits(request_limit=cfg.LLM_REQUEST_LIMIT),
            ) as result:
                await emitter.on_text_start(message_id)
                while collected:
                    yield collected.pop(0)

                async for text in result.stream_text(delta=True):
                    await emitter.on_text_token(message_id, text)
                    while collected:
                        yield collected.pop(0)

                final_text = await result.get_output()
                turn_tool_calls = _extract_tool_calls(result.all_messages())

            if contains_commitment_claim(final_text):
                async def _chat_fn(prompt: str) -> str:
                    async with httpx.AsyncClient(timeout=15.0) as http_client:
                        resp = await http_client.post(
                            f"{cfg.LLM_BASE_URL}/chat/completions",
                            json={
                                "model": model,
                                "messages": [{"role": "user", "content": prompt}],
                                "temperature": 0,
                            },
                            headers={"Authorization": f"Bearer {cfg.LLM_API_KEY}"} if cfg.LLM_API_KEY else {},
                        )
                    resp.raise_for_status()
                    return resp.json()["choices"][0]["message"]["content"] or ""

                validator = CommitmentGroundingValidator(chat_fn=_chat_fn, on_fail="fix")
                check = await validator.async_validate(
                    final_text, {"tool_calls": turn_tool_calls}
                )
                if isinstance(check, FailResult):
                    await emitter.emit({
                        "type": "CUSTOM",
                        "name": "grounding_correction",
                        "value": {
                            "original": final_text,
                            "corrected": check.fix_value,
                            "correctionNote": check.error_message,
                        },
                    })
                    while collected:
                        yield collected.pop(0)

            await emitter.on_text_end(message_id)
            while collected:
                yield collected.pop(0)

            await emitter.on_run_end()
            while collected:
                yield collected.pop(0)

        except Exception:
            # Log the full detail server-side; surface only a generic message to
            # the UI so internal URLs/hostnames from exception text don't leak.
            logger.exception("[run_handler] agent run failed")
            collected.clear()
            await emitter.on_error(
                "The assistant hit an internal error and could not complete this request."
            )
            while collected:
                yield collected.pop(0)

    return StreamingResponse(
        stream_events(),
        media_type="text/event-stream",
        headers=_SSE_HEADERS,
    )
