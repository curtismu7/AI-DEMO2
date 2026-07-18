"""Translates openai-agents SDK stream events into AG-UI event dicts."""
from __future__ import annotations
import uuid
import logging
from typing import Any, Callable

from .grounding_guardrail import ToolCallRecord

logger = logging.getLogger(__name__)


class AGUIEmitter:
    def __init__(self, run_id: str, thread_id: str, sink: Callable) -> None:
        self._run_id = run_id
        self._thread_id = thread_id
        self._sink = sink
        self._current_message_id: str | None = None
        self._turn_reply_text: str = ""
        self._turn_tool_calls: list = []
        self._pending_tool_calls: dict = {}
        self._any_tool_call: bool = False

    async def _emit(self, event: dict) -> None:
        try:
            await self._sink(event)
        except Exception:
            logger.exception("AGUIEmitter sink error")

    async def on_run_start(self) -> None:
        await self._emit({"type": "RUN_STARTED", "runId": self._run_id, "threadId": self._thread_id})

    async def on_run_end(self) -> None:
        # A well-formed stream with no text and no tool call renders as a
        # silent blank bubble — same bug class as the Node reason-loop and
        # langchain_agent empty-answer guards.
        if not self._turn_reply_text.strip() and not self._any_tool_call:
            logger.warning("[AG-UI] run %s produced no visible output (no text, no tool call)", self._run_id)
            await self.on_error(RuntimeError(
                "The model didn't return a usable response. Try rephrasing your request or sending it again."
            ))
            return
        await self._emit({"type": "RUN_FINISHED", "runId": self._run_id, "threadId": self._thread_id})

    async def on_llm_start(self) -> None:
        self._current_message_id = f"msg_{uuid.uuid4().hex[:12]}"
        await self._emit({"type": "TEXT_MESSAGE_START", "messageId": self._current_message_id})

    async def on_llm_token(self, token: str) -> None:
        self._turn_reply_text += token
        if not self._current_message_id:
            return
        await self._emit({"type": "TEXT_MESSAGE_CONTENT", "messageId": self._current_message_id, "delta": token})

    async def on_llm_end(self) -> None:
        if self._current_message_id:
            await self._emit({"type": "TEXT_MESSAGE_END", "messageId": self._current_message_id})
            self._current_message_id = None

    async def on_tool_start(self, tool_name: str, tool_call_id: str, args_json: str) -> None:
        self._any_tool_call = True
        self._pending_tool_calls[tool_call_id] = {"name": tool_name, "args": args_json}
        await self._emit({"type": "TOOL_CALL_START", "toolCallId": tool_call_id, "toolCallName": tool_name})
        if args_json:
            await self._emit({"type": "TOOL_CALL_ARGS", "toolCallId": tool_call_id, "delta": args_json})

    async def on_tool_end(self, tool_call_id: str, result: Any) -> None:
        pending = self._pending_tool_calls.pop(tool_call_id, None)
        if pending is not None:
            self._turn_tool_calls.append(
                ToolCallRecord(name=pending["name"], args=pending["args"], result=str(result))
            )
        # STATE_DELTA.delta must be a JSON-Patch op ARRAY (the client runs it
        # through applyJsonPatch) — a plain dict is silently dropped. Mirror the
        # shape used by bff_tool_adapter._emit_token_events.
        value = result if isinstance(result, dict) else {"result": str(result)}
        await self._emit({
            "type": "STATE_DELTA",
            "delta": [
                {"op": "add", "path": "/toolResults/-",
                 "value": {"toolCallId": tool_call_id, "result": value}},
            ],
        })
        await self._emit({"type": "TOOL_CALL_END", "toolCallId": tool_call_id})

    async def on_usage(self, input_tokens: int, output_tokens: int) -> None:
        await self._emit({
            "type": "CUSTOM",
            "name": "token_usage",
            "value": {"inputTokens": input_tokens, "outputTokens": output_tokens},
        })

    async def on_grounding_correction(self, original: str, corrected: str, note: str) -> None:
        await self._emit({
            "type": "CUSTOM",
            "name": "grounding_correction",
            "value": {"original": original, "corrected": corrected, "correctionNote": note},
        })

    async def on_error(self, error: Exception) -> None:
        # RUN_ERROR is the AG-UI event the BFF and UI hook (useAgentRun.js) both
        # handle. Emitting ERROR alone leaves the dock empty because the hook
        # only listens for RUN_ERROR / RUN_FINISHED. RUN_FINISHED is not emitted
        # after RUN_ERROR — the stream is considered terminated by the error.
        await self._emit({
            "type": "RUN_ERROR",
            "runId": self._run_id,
            "threadId": self._thread_id,
            "message": str(error),
            "code": "AGENT_ERROR",
        })
