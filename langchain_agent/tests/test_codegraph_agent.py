"""Tests for the CodeGraph agent factory / runner.

Rewritten from a stale langchain-based test suite (`_resolve_mode`,
`create_react_agent`, `CodegraphRunner.mode/provider/graph`) that described
an architecture this module no longer has — `src/codegraph/agent.py` was
migrated to pydantic-ai (a single `Agent` wrapped by `CodegraphRunner`, model
selection via `_resolve_model()`'s Anthropic > Groq > local llm-proxy
fallback chain, no react-vs-retrieve mode split) without the old test file
being updated. These tests exercise the real, current implementation.
"""

import pytest
from unittest.mock import patch, MagicMock

from src.codegraph.agent import (
    SYSTEM_PROMPT,
    CodegraphRunner,
    create_codegraph_agent,
    _resolve_model,
    _to_msg_history,
    _anthropic_configured,
    _groq_configured,
)


class TestAnthropicConfigured:
    def test_true_for_a_real_looking_key(self, monkeypatch):
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-real-key")
        assert _anthropic_configured() is True

    def test_false_when_unset(self, monkeypatch):
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        assert _anthropic_configured() is False

    @pytest.mark.parametrize("placeholder", ["sk-ant-api03-placeholder", "test-key", "changeme"])
    def test_false_for_known_placeholders(self, monkeypatch, placeholder):
        monkeypatch.setenv("ANTHROPIC_API_KEY", placeholder)
        assert _anthropic_configured() is False

    def test_false_when_missing_sk_ant_prefix(self, monkeypatch):
        monkeypatch.setenv("ANTHROPIC_API_KEY", "not-the-right-shape")
        assert _anthropic_configured() is False


class TestGroqConfigured:
    def test_true_for_a_gsk_prefixed_key(self, monkeypatch):
        monkeypatch.setenv("GROQ_API_KEY", "gsk_realkey")
        assert _groq_configured() is True

    def test_false_when_unset(self, monkeypatch):
        monkeypatch.delenv("GROQ_API_KEY", raising=False)
        assert _groq_configured() is False

    def test_false_without_gsk_prefix(self, monkeypatch):
        monkeypatch.setenv("GROQ_API_KEY", "wrong-shape")
        assert _groq_configured() is False


class TestResolveModel:
    """Anthropic > Groq > local llm-proxy — first configured provider wins."""

    def test_anthropic_takes_priority(self, monkeypatch):
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-real-key")
        monkeypatch.setenv("GROQ_API_KEY", "gsk_alsoset")
        monkeypatch.setenv("CODEGRAPH_MODEL", "claude-haiku-4-5")
        with patch("pydantic_ai.models.anthropic.AnthropicModel") as MockAnthropic, \
             patch("pydantic_ai.providers.anthropic.AnthropicProvider") as MockProvider:
            MockAnthropic.return_value = MagicMock()
            _resolve_model()
        MockAnthropic.assert_called_once()
        assert MockAnthropic.call_args.args[0] == "claude-haiku-4-5"

    def test_anthropic_model_name_must_start_with_claude(self, monkeypatch):
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-real-key")
        monkeypatch.setenv("CODEGRAPH_MODEL", "gpt-4")
        with patch("pydantic_ai.models.anthropic.AnthropicModel") as MockAnthropic, \
             patch("pydantic_ai.providers.anthropic.AnthropicProvider"):
            MockAnthropic.return_value = MagicMock()
            _resolve_model()
        assert MockAnthropic.call_args.args[0] == "claude-haiku-4-5"

    def test_groq_used_when_anthropic_not_configured(self, monkeypatch):
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        monkeypatch.setenv("GROQ_API_KEY", "gsk_realkey")
        monkeypatch.setenv("GROQ_MODEL", "openai/gpt-oss-20b")
        with patch("src.codegraph.agent.OpenAIModel") as MockOpenAI, \
             patch("src.codegraph.agent.OpenAIProvider") as MockProvider:
            MockOpenAI.return_value = MagicMock()
            _resolve_model()
        MockOpenAI.assert_called_once()
        assert MockOpenAI.call_args.kwargs["model_name"] == "openai/gpt-oss-20b"
        assert MockProvider.call_args.kwargs["base_url"] == "https://api.groq.com/openai/v1"
        assert MockProvider.call_args.kwargs["api_key"] == "gsk_realkey"

    def test_falls_back_to_local_llm_proxy_when_neither_configured(self, monkeypatch):
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        monkeypatch.delenv("GROQ_API_KEY", raising=False)
        monkeypatch.setenv("LLAMACPP_BASE_URL", "http://llm-proxy:8090/v1")
        monkeypatch.setenv("LLAMACPP_MODEL", "gpt-oss-20b")
        with patch("src.codegraph.agent.OpenAIModel") as MockOpenAI, \
             patch("src.codegraph.agent.OpenAIProvider") as MockProvider:
            MockOpenAI.return_value = MagicMock()
            _resolve_model()
        assert MockOpenAI.call_args.kwargs["model_name"] == "gpt-oss-20b"
        assert MockProvider.call_args.kwargs["base_url"] == "http://llm-proxy:8090/v1"

    def test_codegraph_llamacpp_base_url_takes_priority_over_llamacpp_base_url(self, monkeypatch):
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        monkeypatch.delenv("GROQ_API_KEY", raising=False)
        monkeypatch.setenv("LLAMACPP_BASE_URL", "http://wrong:8090/v1")
        monkeypatch.setenv("CODEGRAPH_LLAMACPP_BASE_URL", "http://right:8090/v1")
        with patch("src.codegraph.agent.OpenAIModel") as MockOpenAI, \
             patch("src.codegraph.agent.OpenAIProvider") as MockProvider:
            MockOpenAI.return_value = MagicMock()
            _resolve_model()
        assert MockProvider.call_args.kwargs["base_url"] == "http://right:8090/v1"


class TestCreateCodegraphAgent:
    def test_returns_a_codegraph_runner_wrapping_an_agent(self, monkeypatch):
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        monkeypatch.delenv("GROQ_API_KEY", raising=False)
        with patch("src.codegraph.agent.OpenAIModel"), patch("src.codegraph.agent.OpenAIProvider"):
            runner = create_codegraph_agent()
        assert isinstance(runner, CodegraphRunner)
        assert runner.agent is not None


class TestToMsgHistory:
    def test_empty_history_yields_no_messages(self):
        assert _to_msg_history([]) == []

    def test_skips_entries_with_empty_content(self):
        assert _to_msg_history([{"role": "user", "content": ""}, {"role": "user", "content": None}]) == []

    def test_user_entries_become_model_requests(self):
        from pydantic_ai.messages import ModelRequest, UserPromptPart
        msgs = _to_msg_history([{"role": "user", "content": "hi"}])
        assert len(msgs) == 1
        assert isinstance(msgs[0], ModelRequest)
        assert isinstance(msgs[0].parts[0], UserPromptPart)
        assert msgs[0].parts[0].content == "hi"

    def test_assistant_entries_become_model_responses(self):
        from pydantic_ai.messages import ModelResponse, TextPart
        msgs = _to_msg_history([{"role": "assistant", "content": "hello there"}])
        assert len(msgs) == 1
        assert isinstance(msgs[0], ModelResponse)
        assert isinstance(msgs[0].parts[0], TextPart)
        assert msgs[0].parts[0].content == "hello there"

    def test_unknown_role_treated_as_a_user_request(self):
        from pydantic_ai.messages import ModelRequest
        msgs = _to_msg_history([{"role": "system", "content": "ignored-role-still-kept"}])
        assert len(msgs) == 1
        assert isinstance(msgs[0], ModelRequest)

    def test_preserves_order(self):
        history = [
            {"role": "user", "content": "first question"},
            {"role": "assistant", "content": "first answer"},
            {"role": "user", "content": "second question"},
        ]
        msgs = _to_msg_history(history)
        assert len(msgs) == 3
        assert msgs[2].parts[0].content == "second question"


def test_system_prompt_mentions_key_repo_components():
    assert "demo_api_server" in SYSTEM_PROMPT
    assert "langchain_agent" in SYSTEM_PROMPT
    assert "demo_mcp_gateway" in SYSTEM_PROMPT


def test_system_prompt_mentions_grep_and_read_file():
    lowered = SYSTEM_PROMPT.lower()
    assert "grep" in lowered
    assert "read_file" in lowered
