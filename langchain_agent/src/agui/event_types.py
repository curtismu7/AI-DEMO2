"""AG-UI protocol event dataclasses.

Spec: https://docs.ag-ui.com/concepts/events
All events serialise to { "type": "<TYPE>", ...fields }
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any, Dict, Optional
import uuid


def _run_id() -> str:
    return f"run_{uuid.uuid4().hex[:12]}"


def _msg_id() -> str:
    return f"msg_{uuid.uuid4().hex[:12]}"


def _tool_call_id() -> str:
    return f"tc_{uuid.uuid4().hex[:12]}"


@dataclass
class RunStarted:
    run_id: str
    thread_id: str
    type: str = field(default="RUN_STARTED", init=False)

    def to_dict(self) -> Dict[str, Any]:
        return {"type": self.type, "runId": self.run_id, "threadId": self.thread_id}


@dataclass
class RunFinished:
    run_id: str
    thread_id: str
    type: str = field(default="RUN_FINISHED", init=False)

    def to_dict(self) -> Dict[str, Any]:
        return {"type": self.type, "runId": self.run_id, "threadId": self.thread_id}


@dataclass
class TextMessageStart:
    message_id: str
    role: str = "assistant"
    type: str = field(default="TEXT_MESSAGE_START", init=False)

    def to_dict(self) -> Dict[str, Any]:
        return {"type": self.type, "messageId": self.message_id, "role": self.role}


@dataclass
class TextMessageContent:
    message_id: str
    delta: str
    type: str = field(default="TEXT_MESSAGE_CONTENT", init=False)

    def to_dict(self) -> Dict[str, Any]:
        return {"type": self.type, "messageId": self.message_id, "delta": self.delta}


@dataclass
class TextMessageEnd:
    message_id: str
    type: str = field(default="TEXT_MESSAGE_END", init=False)

    def to_dict(self) -> Dict[str, Any]:
        return {"type": self.type, "messageId": self.message_id}


@dataclass
class ToolCallStart:
    tool_call_id: str
    tool_call_name: str
    type: str = field(default="TOOL_CALL_START", init=False)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "type": self.type,
            "toolCallId": self.tool_call_id,
            "toolCallName": self.tool_call_name,
        }


@dataclass
class ToolCallArgs:
    tool_call_id: str
    delta: str  # JSON-encoded args fragment
    type: str = field(default="TOOL_CALL_ARGS", init=False)

    def to_dict(self) -> Dict[str, Any]:
        return {"type": self.type, "toolCallId": self.tool_call_id, "delta": self.delta}


@dataclass
class ToolCallEnd:
    tool_call_id: str
    type: str = field(default="TOOL_CALL_END", init=False)

    def to_dict(self) -> Dict[str, Any]:
        return {"type": self.type, "toolCallId": self.tool_call_id}


@dataclass
class StateDelta:
    delta: Any  # JSON Patch array (RFC 6902) or plain dict
    type: str = field(default="STATE_DELTA", init=False)

    def to_dict(self) -> Dict[str, Any]:
        return {"type": self.type, "delta": self.delta}


@dataclass
class CustomEvent:
    name: str
    value: Any
    type: str = field(default="CUSTOM", init=False)

    def to_dict(self) -> Dict[str, Any]:
        return {"type": self.type, "name": self.name, "value": self.value}


@dataclass
class ErrorEvent:
    """AG-UI terminal-error event.

    Emits as type='RUN_ERROR' to match the BFF (routes/agentRun.js) and React
    hook (useAgentRun.js) contract — they only handle RUN_ERROR / RUN_FINISHED.
    A prior 'ERROR' type left the dock empty because no handler matched.
    run_id / thread_id are included so the UI can correlate the failure to
    the originating run.
    """
    message: str
    code: Optional[str] = None
    run_id: Optional[str] = None
    thread_id: Optional[str] = None
    type: str = field(default="RUN_ERROR", init=False)

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {"type": self.type, "message": self.message}
        if self.code:
            d["code"] = self.code
        if self.run_id:
            d["runId"] = self.run_id
        if self.thread_id:
            d["threadId"] = self.thread_id
        return d
