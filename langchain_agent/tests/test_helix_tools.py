"""
Tests for ChatHelix prompt-mediated tool calling.

Covers:
  - bind_tools — OpenAI-schema conversion and tools pass-through to _generate/_agenerate
  - _build_prompt — TOOLS section rendering and conversation transcript with history
  - _parse_reply — tool_call envelope extraction (plain, fenced, embedded, malformed)
  - create_react_agent integration — graph builds and completes a full tool round-trip

No Helix network required — _call_helix_async is mocked the same way as in
test_helix_llm.py.
"""
import json
import sys

import pytest
from unittest.mock import AsyncMock
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import tool

from src.agent.helix_llm import ChatHelix, _build_prompt, _parse_reply


@tool
def get_balance(account: str) -> str:
    """Get the balance of an account."""
    return f"Balance of {account}: $500"


def _make_helix() -> ChatHelix:
    return ChatHelix(
        helix_base_url="https://openam-helix.forgeblocks.com",
        helix_api_key="test-key",
        helix_environment_id="env-uuid",
        helix_agent_id="LLM2",
        helix_prompt_field_id="textInputabc",
    )


def _converted_tools(llm: ChatHelix) -> list:
    """Return the OpenAI-schema tools that bind_tools stores on the binding."""
    return llm.bind_tools([get_balance]).kwargs["tools"]


# ---------------------------------------------------------------------------
# bind_tools — pass-through and prompt rendering
# ---------------------------------------------------------------------------

class TestBindTools:
    def test_bind_tools_converts_to_openai_schema(self):
        llm = _make_helix()
        tools = _converted_tools(llm)
        assert len(tools) == 1
        assert tools[0]["type"] == "function"
        assert tools[0]["function"]["name"] == "get_balance"
        assert "account" in tools[0]["function"]["parameters"]["properties"]

    async def test_ainvoke_passes_tools_through(self):
        llm = _make_helix()
        llm._call_helix_async = AsyncMock(return_value="plain prose answer")
        bound = llm.bind_tools([get_balance])

        result = await bound.ainvoke([HumanMessage(content="what is my balance?")])

        assert isinstance(result, AIMessage)
        assert result.content == "plain prose answer"
        _, called_kwargs = llm._call_helix_async.call_args
        assert called_kwargs["tools"][0]["function"]["name"] == "get_balance"

    def test_invoke_passes_tools_through(self):
        llm = _make_helix()
        llm._call_helix_async = AsyncMock(return_value="plain prose answer")
        bound = llm.bind_tools([get_balance])

        result = bound.invoke([HumanMessage(content="what is my balance?")])

        assert isinstance(result, AIMessage)
        assert result.content == "plain prose answer"
        _, called_kwargs = llm._call_helix_async.call_args
        assert called_kwargs["tools"][0]["function"]["name"] == "get_balance"

    def test_prompt_contains_tool_names_and_json_instruction(self):
        llm = _make_helix()
        tools = _converted_tools(llm)
        prompt = _build_prompt(
            [SystemMessage(content="You are a banking assistant."),
             HumanMessage(content="show my balance")],
            tools,
        )
        assert prompt.startswith("You are a banking assistant.")
        assert "TOOLS" in prompt
        assert "get_balance" in prompt
        assert "Get the balance of an account." in prompt
        assert '{"tool_call": {"name": "<tool name>", "arguments": { ... }}}' in prompt
        assert "User: show my balance" in prompt


# ---------------------------------------------------------------------------
# _parse_reply — tool_call envelope extraction
# ---------------------------------------------------------------------------

class TestParseReply:
    def test_valid_envelope_returns_tool_call(self):
        reply = json.dumps({"tool_call": {"name": "get_balance", "arguments": {"account": "checking"}}})
        msg = _parse_reply(reply)
        assert msg.content == ""
        assert len(msg.tool_calls) == 1
        tc = msg.tool_calls[0]
        assert tc["name"] == "get_balance"
        assert tc["args"] == {"account": "checking"}
        assert tc["id"].startswith("call_")
        assert tc["type"] == "tool_call"

    def test_fenced_json_envelope_parses(self):
        reply = '```json\n{"tool_call": {"name": "get_balance", "arguments": {"account": "savings"}}}\n```'
        msg = _parse_reply(reply)
        assert len(msg.tool_calls) == 1
        assert msg.tool_calls[0]["name"] == "get_balance"
        assert msg.tool_calls[0]["args"] == {"account": "savings"}

    def test_embedded_json_envelope_parses(self):
        reply = 'Sure, calling the tool: {"tool_call": {"name": "get_balance", "arguments": {}}} done'
        msg = _parse_reply(reply)
        assert len(msg.tool_calls) == 1
        assert msg.tool_calls[0]["name"] == "get_balance"
        assert msg.tool_calls[0]["args"] == {}

    def test_missing_arguments_defaults_to_empty_dict(self):
        reply = '{"tool_call": {"name": "get_balance"}}'
        msg = _parse_reply(reply)
        assert len(msg.tool_calls) == 1
        assert msg.tool_calls[0]["args"] == {}

    def test_prose_reply_returns_plain_message(self):
        msg = _parse_reply("Your balance is $500.")
        assert msg.content == "Your balance is $500."
        assert msg.tool_calls == []

    def test_malformed_json_returns_plain_message(self):
        reply = '{"tool_call": {"name": "get_balance", "arguments": {'
        msg = _parse_reply(reply)
        assert msg.content == reply
        assert msg.tool_calls == []

    def test_json_without_tool_call_envelope_returns_plain_message(self):
        reply = '{"name": "get_balance", "arguments": {}}'
        msg = _parse_reply(reply)
        assert msg.content == reply
        assert msg.tool_calls == []

    def test_non_string_name_returns_plain_message(self):
        reply = '{"tool_call": {"name": 42, "arguments": {}}}'
        msg = _parse_reply(reply)
        assert msg.content == reply
        assert msg.tool_calls == []

    async def test_agenerate_with_tools_parses_tool_call(self):
        llm = _make_helix()
        envelope = json.dumps({"tool_call": {"name": "get_balance", "arguments": {"account": "checking"}}})
        llm._call_helix_async = AsyncMock(return_value=envelope)
        bound = llm.bind_tools([get_balance])

        result = await bound.ainvoke([HumanMessage(content="balance please")])

        assert result.content == ""
        assert result.tool_calls[0]["name"] == "get_balance"

    async def test_agenerate_without_tools_never_parses(self):
        """Tool-less behaviour unchanged — a JSON-looking reply stays plain content."""
        llm = _make_helix()
        envelope = json.dumps({"tool_call": {"name": "get_balance", "arguments": {}}})
        llm._call_helix_async = AsyncMock(return_value=envelope)

        result = await llm.ainvoke([HumanMessage(content="balance please")])

        assert result.content == envelope
        assert result.tool_calls == []


# ---------------------------------------------------------------------------
# _build_prompt — history transcript rendering
# ---------------------------------------------------------------------------

class TestHistoryTranscript:
    def test_full_history_renders_transcript_with_tool_result(self):
        llm = _make_helix()
        tools = _converted_tools(llm)
        messages = [
            SystemMessage(content="You are a banking assistant."),
            HumanMessage(content="what is my checking balance?"),
            AIMessage(
                content="",
                tool_calls=[{
                    "name": "get_balance",
                    "args": {"account": "checking"},
                    "id": "call_abc123",
                    "type": "tool_call",
                }],
            ),
            ToolMessage(content="Balance of checking: $500", tool_call_id="call_abc123", name="get_balance"),
            HumanMessage(content="thanks, and savings?"),
        ]
        prompt = _build_prompt(messages, tools)

        assert prompt.startswith("You are a banking assistant.")
        assert "User: what is my checking balance?" in prompt
        assert 'Assistant: {"tool_call": {"name": "get_balance", "arguments": {"account": "checking"}}}' in prompt
        assert "Tool result (get_balance): Balance of checking: $500" in prompt
        assert "User: thanks, and savings?" in prompt
        assert prompt.rstrip().endswith("Respond now as the Assistant.")

    def test_history_without_tools_still_renders_transcript(self):
        messages = [
            HumanMessage(content="hello"),
            AIMessage(content="hi there"),
            HumanMessage(content="what can you do?"),
        ]
        prompt = _build_prompt(messages)
        assert "User: hello" in prompt
        assert "Assistant: hi there" in prompt
        assert "User: what can you do?" in prompt

    def test_tool_message_without_name_uses_tool_call_id(self):
        messages = [
            HumanMessage(content="balance"),
            AIMessage(content="", tool_calls=[{"name": "get_balance", "args": {}, "id": "call_xyz", "type": "tool_call"}]),
            ToolMessage(content="$500", tool_call_id="call_xyz"),
        ]
        prompt = _build_prompt(messages)
        assert "Tool result (call_xyz): $500" in prompt

    def test_no_history_no_tools_keeps_legacy_format(self):
        messages = [
            SystemMessage(content="You are a banking assistant."),
            HumanMessage(content="show my accounts"),
        ]
        assert _build_prompt(messages) == "You are a banking assistant.\n\nshow my accounts"


# ---------------------------------------------------------------------------
# create_react_agent integration — full tool round-trip
# ---------------------------------------------------------------------------

@pytest.fixture
def real_create_react_agent():
    """
    Swap the conftest langgraph MagicMock stub for the real installed langgraph
    for the duration of the test, then restore the stub.
    """
    saved = {
        name: sys.modules.pop(name)
        for name in list(sys.modules)
        if name == "langgraph" or name.startswith("langgraph.")
    }
    try:
        from langgraph.prebuilt import create_react_agent
        yield create_react_agent
    finally:
        for name in list(sys.modules):
            if name == "langgraph" or name.startswith("langgraph."):
                del sys.modules[name]
        sys.modules.update(saved)


class TestCreateReactAgentIntegration:
    async def test_graph_builds_and_completes_tool_round_trip(self, real_create_react_agent):
        create_react_agent = real_create_react_agent

        llm = _make_helix()
        envelope = json.dumps({"tool_call": {"name": "get_balance", "arguments": {"account": "checking"}}})
        # Plain async function rather than AsyncMock — langgraph deep-copies the
        # model, which would degrade an AsyncMock attribute into a plain Mock.
        replies = iter([envelope, "Your checking balance is $500."])
        calls = []

        async def fake_call_helix(messages, tools=None):
            calls.append((messages, tools))
            return next(replies)

        llm._call_helix_async = fake_call_helix

        # Must not raise NotImplementedError (bind_tools is implemented)
        graph = create_react_agent(llm, [get_balance])

        result = await graph.ainvoke({"messages": [HumanMessage(content="what is my balance?")]})

        messages = result["messages"]
        # One tool round-trip happened: AI tool_call -> ToolMessage -> final prose
        tool_messages = [m for m in messages if isinstance(m, ToolMessage)]
        assert len(tool_messages) == 1
        assert tool_messages[0].content == "Balance of checking: $500"
        ai_with_tool_calls = [m for m in messages if isinstance(m, AIMessage) and m.tool_calls]
        assert len(ai_with_tool_calls) == 1
        assert ai_with_tool_calls[0].tool_calls[0]["name"] == "get_balance"
        assert messages[-1].content == "Your checking balance is $500."
        assert len(calls) == 2
        # Both model calls received the bound tools
        assert all(tools and tools[0]["function"]["name"] == "get_balance" for _, tools in calls)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
