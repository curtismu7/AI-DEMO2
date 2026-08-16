"""POST /run — accepts BFF run payload, returns AG-UI SSE stream."""
from __future__ import annotations
import asyncio
import json
import logging
import uuid
from typing import AsyncGenerator

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from agents import Runner

from .agent_factory import build_agent, build_llm_client
from .agui_emitter import AGUIEmitter
from .bff_tool_adapter import resolve_bff_tool_url
from .config import get_config
from .grounding_guardrail import CommitmentGroundingValidator, contains_commitment_claim
from guardrails.validator_base import FailResult

logger = logging.getLogger(__name__)
router = APIRouter()


def _format_sse(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


def _error_response(run_id: str, thread_id: str, message: str) -> StreamingResponse:
    """Fail fast as a single RUN_ERROR SSE frame (the event the UI hook handles)."""
    async def _one() -> AsyncGenerator[str, None]:
        yield _format_sse({
            "type": "RUN_ERROR",
            "runId": run_id,
            "threadId": thread_id,
            "message": message,
            "code": "AGENT_CONFIG_ERROR",
        })

    return StreamingResponse(
        _one(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/run")
async def agent_run(request: Request) -> StreamingResponse:
    body = await request.json()
    thread_id: str = body.get("threadId", f"t_{uuid.uuid4().hex[:8]}")
    run_id: str = body.get("runId", f"r_{uuid.uuid4().hex[:8]}")
    messages: list = body.get("messages", [])
    tool_schemas: list = body.get("tools", [])
    ctx: dict = body.get("context", {})
    # Vertical persona forwarded by the BFF from the active vertical manifest.
    # Used to override the default banking system prompt so the agent replies
    # in the active vertical's language (care, retail, sports, workforce, etc.).
    vertical_flavor: str | None = body.get("vertical_flavor") or None

    bff_tool_url = ctx.get("bffToolUrl", "")
    session_id = ctx.get("sessionId", "")

    cfg = get_config()
    # Per-run overrides from BFF context win over server-side defaults. Empty
    # strings fall back to config so the operator can leave context.model unset.
    model = ctx.get("model") or cfg.model
    # Provider from BFF context: "anthropic" routes to Anthropic's compat
    # endpoint; anything else stays on the LM Studio OpenAI-compat path.
    run_provider: str = ctx.get("provider") or ""

    llm_base_url = cfg.llm_base_url
    llm_api_key = cfg.llm_api_key
    if run_provider == "anthropic":
        import os
        llm_base_url = "https://api.anthropic.com/v1"
        llm_api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        if not llm_api_key:
            return _error_response(
                run_id, thread_id,
                "provider=anthropic but ANTHROPIC_API_KEY is not set",
            )
        if not model or ("/" not in model and not model.startswith("claude")):
            model = "claude-sonnet-4-6"

    run_ctx = {
        "bff_tool_url": resolve_bff_tool_url(bff_tool_url, cfg.bff_tool_url),
        "bff_internal_secret": cfg.bff_internal_secret,
        "session_id": session_id,
        "base_url": llm_base_url,
    }

    return StreamingResponse(
        _stream(run_id, thread_id, messages, tool_schemas, run_ctx, model, llm_api_key, vertical_flavor),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _stream(
    run_id: str,
    thread_id: str,
    messages: list,
    tool_schemas: list,
    run_ctx: dict,
    model: str,
    api_key: str,
    vertical_flavor: str | None = None,
) -> AsyncGenerator[str, None]:
    queue: asyncio.Queue = asyncio.Queue()

    async def sink(event: dict) -> None:
        await queue.put(event)

    emitter = AGUIEmitter(run_id=run_id, thread_id=thread_id, sink=sink)

    async def run_agent() -> None:
        client = None
        try:
            await emitter.on_run_start()
            # Own the client here so it can be closed reliably below.
            client = build_llm_client(api_key, run_ctx.get("base_url"))
            agent = build_agent(
                tool_schemas=tool_schemas,
                run_ctx=run_ctx,
                model=model,
                api_key=api_key,
                system_prompt=vertical_flavor,
                sink=sink,
                client=client,
            )
            # Pass full conversation history for multi-turn context.
            # Runner accepts str | list[dict]; filter to user/assistant roles only —
            # system messages are set on the Agent.instructions field.
            input_messages = [
                {"role": m["role"], "content": m.get("content", "")}
                for m in messages
                if m.get("role") in ("user", "assistant")
            ] or [{"role": "user", "content": ""}]
            # Runner.run_streamed returns RunResultStreaming directly (not a context manager)
            result = Runner.run_streamed(agent, input_messages)
            async for event in result.stream_events():
                await _handle_sdk_event(event, emitter)
            if contains_commitment_claim(emitter._turn_reply_text):
                try:
                    async def _chat_fn(prompt: str) -> str:
                        completion = await client.chat.completions.create(
                            model=model,
                            messages=[{"role": "user", "content": prompt}],
                            temperature=0,
                        )
                        return completion.choices[0].message.content or ""

                    validator = CommitmentGroundingValidator(chat_fn=_chat_fn, on_fail="fix")
                    check = await validator.async_validate(
                        emitter._turn_reply_text, {"tool_calls": emitter._turn_tool_calls}
                    )
                    if isinstance(check, FailResult):
                        await emitter.on_grounding_correction(
                            original=emitter._turn_reply_text,
                            corrected=check.fix_value,
                            note=check.error_message,
                        )
                except Exception:
                    # Fail open on ANY error in the grounding-check block (not
                    # just the LLM call, which the validator itself already
                    # fails open on internally) -- e.g. CommitmentGroundingValidator
                    # construction raising ValueError when ~/.guardrailsrc is
                    # missing. Never block or alter an already-streamed reply
                    # on a grounding-check error.
                    logger.exception("[grounding] guardrail check failed; failing open")
            usage = getattr(result, "usage", None)
            if usage:
                await emitter.on_usage(
                    getattr(usage, "input_tokens", 0),
                    getattr(usage, "output_tokens", 0),
                )
            await emitter.on_run_end()
        except Exception as exc:
            logger.exception("[openai-agent] run error run=%s", run_id)
            await emitter.on_error(exc)
        finally:
            # Close the per-run LLM client so its HTTP connection/socket is
            # released. Runs after streaming completes (or on cancel), so it
            # never tears the client down mid-stream.
            if client is not None:
                try:
                    await client.close()
                except Exception:
                    logger.exception("[openai-agent] client close error run=%s", run_id)
            await queue.put(None)

    agent_task = asyncio.create_task(run_agent())

    try:
        while True:
            item = await queue.get()
            if item is None:
                break
            yield _format_sse(item)
    finally:
        agent_task.cancel()
        # Await the cancelled task so its finally block (client cleanup) runs to
        # completion before the request ends; swallow the expected CancelledError.
        try:
            await agent_task
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.exception("[openai-agent] agent task teardown error run=%s", run_id)


async def _handle_sdk_event(event, emitter: AGUIEmitter) -> None:
    """Map openai-agents stream events to AG-UI emitter calls."""
    try:
        from agents.stream_events import RawResponsesStreamEvent, RunItemStreamEvent
        from openai.types.responses import ResponseTextDeltaEvent
    except ImportError as exc:
        # A missing SDK type here silently drops every event, leaving the UI
        # stuck. Log loudly and surface a RUN_ERROR so the failure is visible.
        logger.error("[openai-agent] cannot import SDK stream types: %s", exc)
        await emitter.on_error(exc)
        return

    if isinstance(event, RawResponsesStreamEvent):
        data = event.data
        if isinstance(data, ResponseTextDeltaEvent):
            if not emitter._current_message_id:
                await emitter.on_llm_start()
            await emitter.on_llm_token(data.delta)
    elif isinstance(event, RunItemStreamEvent):
        item = event.item
        item_type = getattr(item, "type", None)
        if item_type == "tool_call_item":
            # raw_item is a pydantic model (e.g. ResponseFunctionToolCall) for a
            # real function-tool call, and only rarely a plain dict -- extract
            # via both paths instead of assuming dict shape.
            raw = getattr(item, "raw_item", {})
            tc_id = (
                getattr(raw, "call_id", None)
                or (raw.get("call_id") if isinstance(raw, dict) else None)
                or uuid.uuid4().hex[:12]
            )
            name = (
                getattr(raw, "name", None)
                or (raw.get("name") if isinstance(raw, dict) else None)
                or "unknown"
            )
            args = (
                getattr(raw, "arguments", None)
                or (raw.get("arguments") if isinstance(raw, dict) else None)
                or "{}"
            )
            await emitter.on_tool_start(name, tc_id, args)
        elif item_type == "tool_call_output_item":
            raw = getattr(item, "raw_item", {})
            tc_id = (
                getattr(raw, "call_id", None)
                or (raw.get("call_id") if isinstance(raw, dict) else None)
                or ""
            )
            output = getattr(item, "output", "")
            await emitter.on_tool_end(tc_id, output)
        elif item_type == "message_output_item":
            await emitter.on_llm_end()
