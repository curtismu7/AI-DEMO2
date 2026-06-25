import pytest
from src.agui.sse_transport import format_sse, KEEPALIVE_PING


def test_format_sse_basic():
    line = format_sse({"type": "RUN_STARTED", "runId": "r1", "threadId": "t1"})
    assert line.startswith("data: ")
    assert line.endswith("\n\n")
    assert '"type":"RUN_STARTED"' in line


def test_format_sse_escapes_newlines():
    # SSE data must be single-line
    line = format_sse({"type": "TEXT_MESSAGE_CONTENT", "messageId": "m1", "delta": "line1\nline2"})
    # The JSON itself is one line (json.dumps doesn't add newlines by default)
    assert line.count("\n\n") == 1


def test_keepalive_ping_format():
    assert KEEPALIVE_PING == ": ping\n\n"
