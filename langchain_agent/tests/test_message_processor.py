"""
Unit tests for MessageProcessor (AG-UI /run path).
"""
import pytest
from unittest.mock import Mock, AsyncMock, patch

from src.api.message_processor import MessageProcessor
from guardrails.validator_base import FailResult


@pytest.fixture
def mock_agent_agui():
    """Agent double for the AG-UI (process_agui_message) MCP-graph path."""
    agent = Mock()
    agent.initialize_session_with_token = AsyncMock(return_value=None)
    agent.llm = Mock()
    agent.config = Mock()
    agent.config.langchain = Mock(max_iterations=25)
    agent._pre_model_hook = Mock()
    agent._checkpointer = Mock()
    agent.mcp_tool_provider = Mock()
    agent.mcp_tool_provider.set_session_context = AsyncMock(return_value=None)
    agent._build_system_message = AsyncMock(return_value="System prompt")

    graph = Mock()
    graph.get_state = Mock(return_value=Mock(values={}))

    async def fake_astream_events(agent_input, config=None, version="v2"):
        yield {
            "event": "on_tool_start",
            "name": "request_fee_waiver",
            "run_id": "call_1",
            "data": {"input": {"account_id": "acc_1"}},
        }
        yield {
            "event": "on_tool_end",
            "run_id": "call_1",
            "data": {"output": '{"requestId": "fwr-123", "status": "logged_for_review"}'},
        }

        class _Chunk:
            content = "I've waived your fee!"

        yield {"event": "on_chat_model_stream", "data": {"chunk": _Chunk()}}
        yield {
            "event": "on_chat_model_end",
            "data": {"output": Mock(usage_metadata=None, tool_calls=[]), "input": {"messages": []}},
            "metadata": {},
        }

    graph.astream_events = fake_astream_events
    agent._graph = graph
    return agent


@pytest.fixture
def mock_agui_emitter():
    emitter = AsyncMock()
    return emitter


@pytest.mark.asyncio
async def test_process_agui_message_emits_grounding_correction_on_overclaim(
    mock_agent_agui, mock_agui_emitter,
):
    processor = MessageProcessor(agent=mock_agent_agui)
    with patch(
        "agent.grounding_guardrail.CommitmentGroundingValidator.async_validate",
        new=AsyncMock(
            return_value=FailResult(
                error_message="overclaim",
                fix_value="I've submitted a fee waiver request (ID: fwr-123) for human review.",
            )
        ),
    ):
        await processor.process_agui_message(
            session_id="s1",
            message="Can you waive the fee?",
            auth_token="tok",
            emitter=mock_agui_emitter,
            bff_tool_url="",
            tool_schemas=None,
            messages_list=None,
        )
    mock_agui_emitter.on_grounding_correction.assert_awaited_once()
    _, kwargs = mock_agui_emitter.on_grounding_correction.call_args
    assert kwargs["original"] == "I've waived your fee!"
    assert "fwr-123" in kwargs["corrected"]


@pytest.mark.asyncio
async def test_process_agui_message_no_correction_on_grounded_reply(
    mock_agui_emitter,
):
    agent = Mock()
    agent.initialize_session_with_token = AsyncMock(return_value=None)
    agent.llm = Mock()
    agent.config = Mock()
    agent.config.langchain = Mock(max_iterations=25)
    agent._pre_model_hook = Mock()
    agent._checkpointer = Mock()
    agent.mcp_tool_provider = Mock()
    agent.mcp_tool_provider.set_session_context = AsyncMock(return_value=None)
    agent._build_system_message = AsyncMock(return_value="System prompt")
    graph = Mock()
    graph.get_state = Mock(return_value=Mock(values={}))

    async def fake_astream_events(agent_input, config=None, version="v2"):
        class _Chunk:
            content = "Your checking balance is $1,204.55."

        yield {"event": "on_chat_model_stream", "data": {"chunk": _Chunk()}}
        yield {
            "event": "on_chat_model_end",
            "data": {"output": Mock(usage_metadata=None, tool_calls=[]), "input": {"messages": []}},
            "metadata": {},
        }

    graph.astream_events = fake_astream_events
    agent._graph = graph

    processor = MessageProcessor(agent=agent)
    await processor.process_agui_message(
        session_id="s1",
        message="What's my balance?",
        auth_token="tok",
        emitter=mock_agui_emitter,
        bff_tool_url="",
        tool_schemas=None,
        messages_list=None,
    )
    mock_agui_emitter.on_grounding_correction.assert_not_awaited()


@pytest.mark.asyncio
async def test_process_agui_message_signals_error_on_empty_output(
    mock_agui_emitter,
):
    """Groq (and others) can intermittently return empty content and call no
    tool on an ambiguous prompt. Without a signal the user sees a blank chat
    with no error and no explanation. The run must instead emit on_error and
    skip the (pointless, on empty text) grounding check."""
    agent = Mock()
    agent.initialize_session_with_token = AsyncMock(return_value=None)
    agent.llm = Mock()
    agent.config = Mock()
    agent.config.langchain = Mock(max_iterations=25)
    agent._pre_model_hook = Mock()
    agent._checkpointer = Mock()
    agent.mcp_tool_provider = Mock()
    agent.mcp_tool_provider.set_session_context = AsyncMock(return_value=None)
    agent._build_system_message = AsyncMock(return_value="System prompt")
    graph = Mock()
    graph.get_state = Mock(return_value=Mock(values={}))

    async def fake_astream_events(agent_input, config=None, version="v2"):
        # No on_chat_model_stream chunk, no tool calls -- only an
        # on_chat_model_end with empty content, which is the shape seen
        # from Groq on an ambiguous prompt.
        yield {
            "event": "on_chat_model_end",
            "data": {"output": Mock(content="", usage_metadata=None, tool_calls=[]), "input": {"messages": []}},
            "metadata": {},
        }

    graph.astream_events = fake_astream_events
    agent._graph = graph

    processor = MessageProcessor(agent=agent)
    await processor.process_agui_message(
        session_id="s1",
        message="asdf",
        auth_token="tok",
        emitter=mock_agui_emitter,
        bff_tool_url="",
        tool_schemas=None,
        messages_list=None,
    )
    mock_agui_emitter.on_error.assert_awaited_once()
    mock_agui_emitter.on_grounding_correction.assert_not_awaited()


# --- Policy-denial fallback (greeting-instead-of-deny) --------------------------

from src.api.message_processor import _extract_policy_denial, _reply_surfaces_denial


class _Rec:
    """Duck-typed ToolCallRecord stand-in (the helper only reads `.result`)."""
    def __init__(self, result):
        self.result = result


_DENY_JSON = (
    '{"error":"gateway_policy_denied","gatewayErrorCode":"weather_scope_denied",'
    '"message":"Agent Gateway: weather scope restricted to Texas — city not recognized as Texas"}'
)


def test_extract_policy_denial_returns_message_from_deny_json():
    assert _extract_policy_denial([_Rec(_DENY_JSON)]) == (
        "Agent Gateway: weather scope restricted to Texas — city not recognized as Texas"
    )


def test_extract_policy_denial_none_for_ok_or_empty():
    assert _extract_policy_denial([_Rec('{"temp":"72F","city":"Austin"}')]) is None
    assert _extract_policy_denial([]) is None
    assert _extract_policy_denial(None) is None


def test_extract_policy_denial_covers_all_deny_use_cases_not_just_weather():
    # Genuine policy denials across every deny use case (scope, audience,
    # exchange-scope, transaction, cross-owner) are caught, not just weather.
    for code in ("access_denied", "insufficient_scope", "invalid_scope",
                 "missing_exchange_scopes", "transaction_denied"):
        rec = _Rec('{"error":"%s","message":"blocked by policy"}' % code)
        assert _extract_policy_denial([rec]) == "blocked by policy", code
    # But retryable non-denials (service errors / CIBA pending) must NOT be
    # treated as a denial — the user should try again, not see "denied".
    for code in ("authorization_pending", "mcp_authorize_unavailable",
                 "authorization_service_unavailable", "mcp_authorize_internal"):
        rec = _Rec('{"error":"%s","message":"try again"}' % code)
        assert _extract_policy_denial([rec]) is None, code


def test_reply_surfaces_denial_true_when_explained_false_for_greeting():
    assert _reply_surfaces_denial("The request was denied — outside the allowed scope.") is True
    assert _reply_surfaces_denial("Hello! How can I assist you with your banking today?") is False
    assert _reply_surfaces_denial("") is False


def _weather_deny_agent(reply_text):
    agent = Mock()
    agent.initialize_session_with_token = AsyncMock(return_value=None)
    agent.llm = Mock()
    agent.config = Mock()
    agent.config.langchain = Mock(max_iterations=25)
    agent._pre_model_hook = Mock()
    agent._checkpointer = Mock()
    agent.mcp_tool_provider = Mock()
    agent.mcp_tool_provider.set_session_context = AsyncMock(return_value=None)
    agent._build_system_message = AsyncMock(return_value="System prompt")
    graph = Mock()
    graph.get_state = Mock(return_value=Mock(values={}))

    async def fake_astream_events(agent_input, config=None, version="v2"):
        yield {"event": "on_tool_start", "name": "get_weather", "run_id": "t1",
               "data": {"input": {"city_name": "Miami"}}}
        yield {"event": "on_tool_end", "run_id": "t1", "data": {"output": _DENY_JSON}}

        class _Chunk:
            content = reply_text

        yield {"event": "on_chat_model_stream", "data": {"chunk": _Chunk()}}
        yield {"event": "on_chat_model_end",
               "data": {"output": Mock(usage_metadata=None, tool_calls=[]), "input": {"messages": []}},
               "metadata": {}}

    graph.astream_events = fake_astream_events
    agent._graph = graph
    return agent


def _notice_tokens(emitter):
    return [c.args[0] for c in emitter.on_llm_new_token.await_args_list
            if c.args and isinstance(c.args[0], str) and c.args[0].startswith("❌")]


@pytest.mark.asyncio
async def test_process_agui_message_surfaces_policy_denial_when_llm_greets(
    mock_agui_emitter,
):
    """A tool blocked by a gateway policy while the model greeted / changed the
    subject must still surface the denial reason (deterministic ❌ fallback)."""
    agent = _weather_deny_agent("Hello! How can I assist you with your banking today?")
    processor = MessageProcessor(agent=agent)
    await processor.process_agui_message(
        session_id="s-deny-greet", message="what's the weather in Miami", auth_token="tok",
        emitter=mock_agui_emitter, bff_tool_url="", tool_schemas=None, messages_list=None,
    )
    # Greeting stream = 1 on_llm_start; the deterministic notice adds a 2nd.
    assert mock_agui_emitter.on_llm_start.await_count == 2
    notices = _notice_tokens(mock_agui_emitter)
    assert notices, "expected a ❌ policy-denial notice"
    assert "restricted to Texas" in notices[0]


@pytest.mark.asyncio
async def test_process_agui_message_no_double_when_llm_explains_denial(
    mock_agui_emitter,
):
    """If the model already explained the denial, the fallback must NOT add a
    second notice (no doubling)."""
    agent = _weather_deny_agent(
        "That was denied — Miami is outside the allowed weather scope (Texas only)."
    )
    processor = MessageProcessor(agent=agent)
    await processor.process_agui_message(
        session_id="s-deny-explained", message="what's the weather in Miami", auth_token="tok",
        emitter=mock_agui_emitter, bff_tool_url="", tool_schemas=None, messages_list=None,
    )
    assert mock_agui_emitter.on_llm_start.await_count == 1
    assert not _notice_tokens(mock_agui_emitter)
