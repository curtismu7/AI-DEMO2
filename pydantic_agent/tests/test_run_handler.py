import pytest
import json
import os
from unittest.mock import patch, MagicMock, AsyncMock

# Provide BFF_INTERNAL_SECRET; AGENT_LLM_* defaults to LM Studio so no key
# is needed. (Regression: the previous test set OPENAI_API_KEY because the
# old config.py crashed at import without it.)
os.environ.setdefault("BFF_INTERNAL_SECRET", "test-secret")

from fastapi.testclient import TestClient

# /run is gated by AuthMiddleware on the shared internal secret; the BFF sends
# this header on every call, so the tests must too or they only exercise the 401.
AUTH_HEADERS = {"x-internal-gateway-secret": "test-secret"}


RUN_PAYLOAD = {
    "threadId": "t1",
    "runId": "r1",
    "messages": [{"role": "user", "content": "What are my accounts?"}],
    "tools": [
        {
            "name": "get_accounts",
            "description": "List accounts",
            "inputSchema": {"type": "object", "properties": {}},
        }
    ],
    "context": {
        "bffToolUrl": "http://127.0.0.1:3001/internal/agent-tool",
        "bffInternalSecret": "secret",
        "sessionId": "sess_abc",
        # Empty model intentionally to exercise the cfg.LLM_MODEL fallback.
        "model": "",
    },
}


def _parse_sse(text: str) -> list[dict]:
    return [
        json.loads(line[6:])
        for line in text.splitlines()
        if line.startswith("data: ")
    ]


def _make_mock_agent(tokens=None):  # type: ignore[no-untyped-def]
    """Return a mock Agent whose run_stream yields the given tokens."""
    tokens = tokens or ["Hello", " world"]

    class FakeStreamResult:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

        async def stream_text(self, delta: bool = False):
            for t in tokens:
                yield t

        async def get_output(self):
            return "".join(tokens)

        def all_messages(self, *, output_tool_return_content=None):
            return []

    mock_agent = MagicMock()
    mock_agent.run_stream.return_value = FakeStreamResult()
    return mock_agent


def test_run_returns_200_with_sse_content_type():
    with patch("src.run_handler.build_agent", return_value=_make_mock_agent()):
        from src.main import app
        client = TestClient(app)
        resp = client.post("/run", json=RUN_PAYLOAD, headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]


def test_run_emits_run_started_first():
    with patch("src.run_handler.build_agent", return_value=_make_mock_agent()):
        from src.main import app
        client = TestClient(app)
        resp = client.post("/run", json=RUN_PAYLOAD, headers=AUTH_HEADERS)
    events = _parse_sse(resp.text)
    assert events[0]["type"] == "RUN_STARTED"
    assert events[0]["runId"] == "r1"


def test_run_emits_run_finished_last():
    with patch("src.run_handler.build_agent", return_value=_make_mock_agent()):
        from src.main import app
        client = TestClient(app)
        resp = client.post("/run", json=RUN_PAYLOAD, headers=AUTH_HEADERS)
    events = _parse_sse(resp.text)
    assert events[-1]["type"] == "RUN_FINISHED"


def test_run_emits_text_content_events():
    with patch("src.run_handler.build_agent", return_value=_make_mock_agent(["Hello", " world"])):
        from src.main import app
        client = TestClient(app)
        resp = client.post("/run", json=RUN_PAYLOAD, headers=AUTH_HEADERS)
    events = _parse_sse(resp.text)
    content_events = [e for e in events if e["type"] == "TEXT_MESSAGE_CONTENT"]
    assert len(content_events) == 2
    assert "".join(e["delta"] for e in content_events) == "Hello world"


def test_run_emits_run_error_event_on_exception():
    """When the agent raises, the stream must emit RUN_ERROR (not ERROR) so
    the UI dock surfaces the failure instead of rendering an empty pane. The
    message is sanitized (raw exception text must not leak to the UI), so we
    assert on the RUN_ERROR event, not on the internal exception string."""
    mock_agent = MagicMock()
    mock_agent.run_stream.side_effect = RuntimeError("LLM failed at http://internal-host:9000")

    with patch("src.run_handler.build_agent", return_value=mock_agent):
        from src.main import app
        client = TestClient(app)
        resp = client.post("/run", json=RUN_PAYLOAD, headers=AUTH_HEADERS)
    events = _parse_sse(resp.text)
    error_events = [e for e in events if e["type"] == "RUN_ERROR"]
    assert len(error_events) == 1
    # Sanitized: the raw exception detail (and any internal host it names) must
    # not reach the client.
    assert "LLM failed" not in error_events[0]["message"]
    assert "internal-host" not in error_events[0]["message"]


def test_run_forwards_llm_provider_config_to_build_agent():
    """build_agent must be called with cfg.LLM_BASE_URL and cfg.LLM_API_KEY,
    not just a bare model URI like 'openai:gpt-4o'. This is the regression
    that broke LM Studio routing."""
    with patch("src.run_handler.build_agent", return_value=_make_mock_agent()) as mock_build:
        from src.main import app
        client = TestClient(app)
        client.post("/run", json=RUN_PAYLOAD, headers=AUTH_HEADERS)
        call_kwargs = mock_build.call_args.kwargs
        assert "base_url" in call_kwargs
        assert "api_key" in call_kwargs
        assert "model_name" in call_kwargs


from guardrails.validator_base import FailResult


def _make_mock_agent_with_tool_call(tokens, tool_name, tool_args, tool_result):
    """Return a mock Agent whose run_stream yields tokens and whose
    all_messages()/get_output() expose one tool call for grounding checks."""
    from pydantic_ai.messages import ModelResponse, ToolCallPart, ToolReturnPart

    class FakeStreamResult:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

        async def stream_text(self, delta: bool = False):
            for t in tokens:
                yield t

        async def get_output(self):
            return "".join(tokens)

        def all_messages(self, *, output_tool_return_content=None):
            return [
                ModelResponse(parts=[
                    ToolCallPart(tool_name=tool_name, args=tool_args, tool_call_id="call_1"),
                ]),
                ModelResponse(parts=[
                    ToolReturnPart(tool_name=tool_name, content=tool_result, tool_call_id="call_1"),
                ]),
            ]

    mock_agent = MagicMock()
    mock_agent.run_stream.return_value = FakeStreamResult()
    return mock_agent


def test_run_emits_grounding_correction_on_overclaiming_reply():
    mock_agent = _make_mock_agent_with_tool_call(
        ["I've waived your fee!"],
        "request_fee_waiver",
        {"account_id": "acc_1"},
        '{"requestId": "fwr-123", "status": "logged_for_review"}',
    )
    with patch("src.run_handler.build_agent", return_value=mock_agent), \
         patch(
             "src.grounding_guardrail.CommitmentGroundingValidator.async_validate",
             new=AsyncMock(
                 return_value=FailResult(
                     error_message="overclaim",
                     fix_value="I've submitted a fee waiver request (ID: fwr-123) for human review.",
                 )
             ),
         ):
        from src.main import app
        client = TestClient(app)
        resp = client.post("/run", json=RUN_PAYLOAD, headers=AUTH_HEADERS)
    events = _parse_sse(resp.text)
    custom_events = [e for e in events if e["type"] == "CUSTOM" and e["name"] == "grounding_correction"]
    assert len(custom_events) == 1
    assert "fwr-123" in custom_events[0]["value"]["corrected"]


def test_run_emits_no_grounding_correction_on_grounded_reply():
    mock_agent = _make_mock_agent_with_tool_call(
        ["Your checking balance is $1,204.55."],
        "get_accounts",
        {},
        '{"accounts": []}',
    )
    with patch("src.run_handler.build_agent", return_value=mock_agent):
        from src.main import app
        client = TestClient(app)
        resp = client.post("/run", json=RUN_PAYLOAD, headers=AUTH_HEADERS)
    events = _parse_sse(resp.text)
    custom_events = [e for e in events if e["type"] == "CUSTOM" and e["name"] == "grounding_correction"]
    assert len(custom_events) == 0


def test_grounding_call_reuses_conversation_model_not_cfg():
    """Regression test for the bug where the grounding _chat_fn always POSTed
    to cfg.LLM_BASE_URL / cfg.LLM_API_KEY via raw httpx, ignoring whatever
    model/provider actually served the conversation (e.g. Anthropic). That
    made the guardrail a silent no-op for Anthropic-routed sessions, since
    the wrong backend/model id would fail and fail-open to PassResult.

    The fix constructs a throwaway `Agent(agent.model, ...)` inside _chat_fn,
    reusing the exact model object the conversation's agent was built with.
    We verify this by patching `src.run_handler.Agent` (the class itself) and
    asserting it gets called with the mock agent's `.model` sentinel as the
    first positional argument -- this would fail under the old raw-httpx
    implementation, which never touches `Agent` or `agent.model` at all.
    """
    sentinel_model = object()

    mock_agent = _make_mock_agent_with_tool_call(
        ["I've waived your fee!"],
        "request_fee_waiver",
        {"account_id": "acc_1"},
        '{"requestId": "fwr-123", "status": "logged_for_review"}',
    )
    mock_agent.model = sentinel_model

    fake_grounding_agent = MagicMock()
    fake_grounding_agent.run = AsyncMock(return_value=MagicMock(output="grounded response"))
    mock_agent_cls = MagicMock(return_value=fake_grounding_agent)

    with patch("src.run_handler.build_agent", return_value=mock_agent), \
         patch("src.run_handler.Agent", new=mock_agent_cls):
        from src.main import app
        client = TestClient(app)
        resp = client.post("/run", json=RUN_PAYLOAD, headers=AUTH_HEADERS)

    assert resp.status_code == 200
    # The grounding Agent(...) must have been constructed with the
    # conversation's own model object, not re-derived from cfg.
    mock_agent_cls.assert_called_once()
    call_args = mock_agent_cls.call_args
    assert call_args.args[0] is sentinel_model
    assert call_args.kwargs.get("defer_model_check") is True
