"""Translates openai-agents SDK stream events into AG-UI event dicts."""
from __future__ import annotations
import uuid
import logging
from typing import Any, Callable

logger = logging.getLogger(__name__)


class AGUIEmitter:
    def __init__(self, run_id: str, thread_id: str, sink: Callable) -> None:
        self._run_id = run_id
        self._thread_id = thread_id
        self._sink = sink
        self._current_message_id: str | None = None

    async def _emit(self, event: dict) -> None:
        try:
            await self._sink(event)
        except Exception:
            logger.exception("AGUIEmitter sink error")

    async def on_run_start(self) -> None:
        await self._emit({"type": "RUN_STARTED", "runId": self._run_id, "threadId": self._thread_id})

    async def on_run_end(self) -> None:
        await self._emit({"type": "RUN_FINISHED", "runId": self._run_id, "threadId": self._thread_id})

    async def on_llm_start(self) -> None:
        self._current_message_id = f"msg_{uuid.uuid4().hex[:12]}"
        await self._emit({"type": "TEXT_MESSAGE_START", "messageId": self._current_message_id})

    async def on_llm_token(self, token: str) -> None:
        if not self._current_message_id:
            return
        await self._emit({"type": "TEXT_MESSAGE_CONTENT", "messageId": self._current_message_id, "delta": token})

    async def on_llm_end(self) -> None:
        if self._current_message_id:
            await self._emit({"type": "TEXT_MESSAGE_END", "messageId": self._current_message_id})
            self._current_message_id = None

    async def on_tool_start(self, tool_name: str, tool_call_id: str, args_json: str) -> None:
        await self._emit({"type": "TOOL_CALL_START", "toolCallId": tool_call_id, "toolCallName": tool_name})
        if args_json:
            await self._emit({"type": "TOOL_CALL_ARGS", "toolCallId": tool_call_id, "delta": args_json})

    async def on_tool_end(self, tool_call_id: str, result: Any) -> None:
        delta = result if isinstance(result, dict) else {"result": str(result)}
        await self._emit({"type": "STATE_DELTA", "delta": delta})
        await self._emit({"type": "TOOL_CALL_END", "toolCallId": tool_call_id})

    async def on_usage(self, input_tokens: int, output_tokens: int) -> None:
        await self._emit({
            "type": "CUSTOM",
            "name": "token_usage",
            "value": {"inputTokens": input_tokens, "outputTokens": output_tokens},
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
