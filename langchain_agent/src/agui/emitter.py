"""AG-UI event emitter — adapts LangChain callbacks to AG-UI typed events.

Usage:
    emitter = AGUIEventEmitter(run_id, thread_id, sink=async_fn)
    # Then call on_run_start(), on_llm_new_token(), on_tool_start(), etc.
    # from your LangChain callback handler.
"""
from __future__ import annotations
import json
import uuid
import logging
from typing import Any, Callable, Coroutine, Dict, Optional

from .event_types import (
    RunStarted, RunFinished,
    TextMessageStart, TextMessageContent, TextMessageEnd,
    ToolCallStart, ToolCallArgs, ToolCallEnd,
    StateDelta, ErrorEvent,
)

logger = logging.getLogger(__name__)


class AGUIEventEmitter:
    """Translates LangChain callback events into AG-UI typed events.

    Args:
        run_id: Unique identifier for this agent run.
        thread_id: Conversation thread identifier (session ID).
        sink: Async callable that receives a serialised event dict.
              The sink is the sole point of collection; in tests the
              fixture wires the sink to a list and assigns that same
              list to _sink_list so assertions can inspect events.
    """

    def __init__(
        self,
        run_id: str,
        thread_id: str,
        sink: Callable[[Dict[str, Any]], Coroutine],
    ) -> None:
        self._run_id = run_id
        self._thread_id = thread_id
        self._sink = sink
        self._current_message_id: Optional[str] = None
        self._last_tool_call_id: Optional[str] = None
        # Guards the terminal event: exactly one of RUN_FINISHED / RUN_ERROR may
        # be emitted per run. The MCP graph path emits RUN_ERROR then returns,
        # after which the /run handler calls on_run_end() — without this flag the
        # client would receive RUN_FINISHED after a RUN_ERROR.
        self._terminated: bool = False
        # Test helper: the fixture sets this to the same list that the
        # sink coroutine appends to, so tests can inspect emitted events.
        # _emit itself does not write here; the sink does the appending.
        self._sink_list: Optional[list] = None

    async def _emit(self, event_obj) -> None:
        d = event_obj.to_dict()
        try:
            await self._sink(d)
        except Exception:
            logger.exception("AG-UI sink error")

    async def on_run_start(self) -> None:
        await self._emit(RunStarted(run_id=self._run_id, thread_id=self._thread_id))

    async def on_run_end(self) -> None:
        if self._terminated:
            return
        self._terminated = True
        await self._emit(RunFinished(run_id=self._run_id, thread_id=self._thread_id))

    async def on_llm_start(self) -> None:
        self._current_message_id = f"msg_{uuid.uuid4().hex[:12]}"
        await self._emit(TextMessageStart(message_id=self._current_message_id))

    async def on_llm_new_token(self, token: str) -> None:
        if not self._current_message_id:
            return
        await self._emit(TextMessageContent(message_id=self._current_message_id, delta=token))

    async def on_llm_end(self) -> None:
        if self._current_message_id:
            await self._emit(TextMessageEnd(message_id=self._current_message_id))
            self._current_message_id = None

    async def on_tool_start(
        self, serialized: Dict[str, Any], tool_call_id: Optional[str] = None, **kwargs
    ) -> None:
        tc_id = tool_call_id or f"tc_{uuid.uuid4().hex[:12]}"
        name = serialized.get("name", "unknown_tool")
        await self._emit(ToolCallStart(tool_call_id=tc_id, tool_call_name=name))
        inputs = kwargs.get("inputs") or serialized.get("inputs")
        if inputs:
            await self._emit(ToolCallArgs(
                tool_call_id=tc_id,
                delta=json.dumps(inputs, separators=(",", ":")),
            ))
        self._last_tool_call_id = tc_id

    async def on_tool_end(
        self, output: Any, tool_call_id: Optional[str] = None, **kwargs
    ) -> None:
        tc_id = tool_call_id or self._last_tool_call_id or f"tc_{uuid.uuid4().hex[:12]}"
        await self._emit(ToolCallEnd(tool_call_id=tc_id))

    async def on_usage(self, input_tokens: int, output_tokens: int) -> None:
        try:
            await self._sink({
                "type": "CUSTOM",
                "name": "token_usage",
                "value": {"inputTokens": input_tokens, "outputTokens": output_tokens},
            })
        except Exception:
            logger.exception("AG-UI sink error")

    async def on_llm_detail(
        self,
        model: str,
        messages: list,
        tool_calls: list,
        usage: Optional[Dict[str, int]] = None,
    ) -> None:
        """Teaching payload for the Token Chain trace rail: what was actually
        sent to the LLM and what it decided. Content is truncated — this is a
        classroom exhibit, not a transcript export."""
        def _trunc(m):
            content = str(m.get("content", ""))[:600]
            return {"role": m.get("role", "?"), "content": content}
        try:
            await self._sink({
                "type": "CUSTOM",
                "name": "llm_detail",
                "value": {
                    "model": model,
                    "request": {"messages": [_trunc(m) for m in (messages or [])]},
                    "toolCalls": tool_calls or [],
                    "usage": usage,
                },
            })
        except Exception:
            logger.exception("AG-UI sink error")

    async def on_error(self, error: Exception, **kwargs) -> None:
        # RUN_ERROR is the AG-UI terminal-error event the BFF and React hook
        # (useAgentRun.js) actually handle. RUN_FINISHED is NOT emitted after
        # RUN_ERROR — the stream is considered terminated by the error, so mark
        # it terminated to suppress a trailing RUN_FINISHED from on_run_end().
        if self._terminated:
            return
        self._terminated = True
        await self._emit(ErrorEvent(
            message=str(error),
            code="AGENT_ERROR",
            run_id=self._run_id,
            thread_id=self._thread_id,
        ))
