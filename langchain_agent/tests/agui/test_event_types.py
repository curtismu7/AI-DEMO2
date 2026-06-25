import pytest
from src.agui.event_types import (
    RunStarted, RunFinished, TextMessageStart, TextMessageContent,
    TextMessageEnd, ToolCallStart, ToolCallArgs, ToolCallEnd,
    StateDelta, CustomEvent, ErrorEvent,
)


def test_run_started_serialises():
    e = RunStarted(run_id="run_abc", thread_id="thread_xyz")
    d = e.to_dict()
    assert d == {"type": "RUN_STARTED", "runId": "run_abc", "threadId": "thread_xyz"}


def test_text_message_content_serialises():
    e = TextMessageContent(message_id="msg_1", delta="hello")
    assert e.to_dict() == {"type": "TEXT_MESSAGE_CONTENT", "messageId": "msg_1", "delta": "hello"}


def test_tool_call_start_serialises():
    e = ToolCallStart(tool_call_id="tc_1", tool_call_name="get_accounts")
    assert e.to_dict()["type"] == "TOOL_CALL_START"
    assert e.to_dict()["toolCallName"] == "get_accounts"


def test_custom_event_serialises():
    e = CustomEvent(name="token_chain_bearer_obtained", value={"sub": "user1", "exp": 9999})
    d = e.to_dict()
    assert d["type"] == "CUSTOM"
    assert d["name"] == "token_chain_bearer_obtained"
    assert d["value"]["sub"] == "user1"


def test_error_event_optional_code():
    e = ErrorEvent(message="Something broke")
    assert "code" not in e.to_dict()
    e2 = ErrorEvent(message="Bad token", code="TOKEN_EXPIRED")
    assert e2.to_dict()["code"] == "TOKEN_EXPIRED"
