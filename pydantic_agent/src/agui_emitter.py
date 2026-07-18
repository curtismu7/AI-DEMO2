from __future__ import annotations
import json
from typing import Callable, Awaitable

Sink = Callable[[str], Awaitable[None]]


class AGUIEmitter:
    def __init__(self, run_id: str, thread_id: str, sink: Sink) -> None:
        self.run_id = run_id
        self.thread_id = thread_id
        self._sink = sink
        # A well-formed stream with no text and no tool call renders as a
        # silent blank bubble — same bug class as the Node reason-loop and
        # langchain_agent empty-answer guards. Tracked in _emit (the single
        # low-level sink both named methods and the public emit() bypass for
        # tool adapters funnel through) so neither path is a blind spot.
        self._any_visible_output: bool = False

    async def _emit(self, event: dict) -> None:
        etype = event.get("type")
        if etype == "TEXT_MESSAGE_CONTENT" and event.get("delta"):
            self._any_visible_output = True
        elif etype == "TOOL_CALL_START":
            self._any_visible_output = True
        await self._sink(f"data: {json.dumps(event)}\n\n")

    async def emit(self, event: dict) -> None:
        """Public entry point for tool adapters to emit arbitrary AG-UI events."""
        await self._emit(event)

    async def on_run_start(self) -> None:
        await self._emit({"type": "RUN_STARTED", "runId": self.run_id, "threadId": self.thread_id})

    async def on_run_end(self) -> None:
        if not self._any_visible_output:
            await self.on_error(
                "The model didn't return a usable response. Try rephrasing your request or sending it again."
            )
            return
        await self._emit({"type": "RUN_FINISHED", "runId": self.run_id, "threadId": self.thread_id})

    async def on_text_start(self, message_id: str) -> None:
        await self._emit({"type": "TEXT_MESSAGE_START", "messageId": message_id, "role": "assistant"})

    async def on_text_token(self, message_id: str, delta: str) -> None:
        await self._emit({"type": "TEXT_MESSAGE_CONTENT", "messageId": message_id, "delta": delta})

    async def on_text_end(self, message_id: str) -> None:
        await self._emit({"type": "TEXT_MESSAGE_END", "messageId": message_id})

    async def on_tool_start(self, tool_call_id: str, tool_name: str) -> None:
        await self._emit({"type": "TOOL_CALL_START", "toolCallId": tool_call_id, "toolName": tool_name})

    async def on_tool_args(self, tool_call_id: str, delta: str) -> None:
        await self._emit({"type": "TOOL_CALL_ARGS", "toolCallId": tool_call_id, "delta": delta})

    async def on_tool_end(self, tool_call_id: str) -> None:
        await self._emit({"type": "TOOL_CALL_END", "toolCallId": tool_call_id})

    async def on_error(self, message: str) -> None:
        # RUN_ERROR is the AG-UI event the BFF and UI hook (useAgentRun.js) both
        # handle. Emitting ERROR alone leaves the dock empty because the hook
        # only listens for RUN_ERROR / RUN_FINISHED.
        await self._emit({
            "type": "RUN_ERROR",
            "runId": self.run_id,
            "threadId": self.thread_id,
            "message": message,
            "code": "AGENT_ERROR",
        })
