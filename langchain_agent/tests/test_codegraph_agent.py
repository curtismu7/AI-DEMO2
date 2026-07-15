"""Tests for the CodeGraph agent factory / runner."""

import pytest
from unittest.mock import patch, MagicMock

from src.codegraph.agent import (
    SYSTEM_PROMPT,
    CodegraphRunner,
    create_codegraph_agent,
    _resolve_mode,
)


class TestCreateCodegraphAgent:
    def test_llamacpp_uses_retrieve_mode(self):
        """llama.cpp defaults to retrieve-then-answer (no native tool_calls)."""
        mock_llm = MagicMock()
        with patch("src.codegraph.agent._resolve_provider", return_value="llamacpp"), \
             patch("src.codegraph.agent.resolve_llamacpp_target",
                   return_value=("http://llm-proxy:8090", "gpt-oss-20b", "picked")), \
             patch("src.codegraph.agent.get_llm", return_value=mock_llm) as mock_get, \
             patch("src.codegraph.agent.create_react_agent") as mock_react:
            runner = create_codegraph_agent(api_key="test-key")

        assert isinstance(runner, CodegraphRunner)
        assert runner.mode == "retrieve"
        assert runner.provider == "llamacpp"
        assert runner.graph is None
        mock_react.assert_not_called()
        kwargs = mock_get.call_args.kwargs
        assert kwargs["provider"] == "llamacpp"
        assert kwargs["model"] == "gpt-oss-20b"
        assert kwargs["llamacpp_base_url"] == "http://llm-proxy:8090"

    def test_anthropic_uses_react_mode(self):
        fake_tools = [MagicMock(), MagicMock()]
        mock_graph = MagicMock()
        with patch("src.codegraph.agent._resolve_provider", return_value="anthropic"), \
             patch("src.codegraph.agent.get_llm", return_value=MagicMock()), \
             patch("src.codegraph.agent.get_codegraph_tools", return_value=fake_tools), \
             patch("src.codegraph.agent.create_react_agent", return_value=mock_graph) as mock_create:
            runner = create_codegraph_agent(api_key="test-key")

        assert runner.mode == "react"
        assert runner.graph is mock_graph
        mock_create.assert_called_once()
        assert mock_create.call_args.args[1] == fake_tools
        assert mock_create.call_args.kwargs.get("prompt") == SYSTEM_PROMPT

    def test_helix_uses_retrieve_and_forwards_env(self, monkeypatch):
        monkeypatch.setenv("HELIX_BASE_URL", "https://helix.example")
        monkeypatch.setenv("HELIX_API_KEY", "key-123")
        monkeypatch.setenv("HELIX_ENVIRONMENT_ID", "env-abc")
        monkeypatch.setenv("HELIX_AGENT_ID", "LLM2")
        monkeypatch.setenv("HELIX_PROMPT_FIELD_ID", "field-xyz")
        with patch("src.codegraph.agent._resolve_provider", return_value="helix"), \
             patch("src.codegraph.agent.get_llm") as mock_llm, \
             patch("src.codegraph.agent.create_react_agent") as mock_react:
            mock_llm.return_value = MagicMock()
            runner = create_codegraph_agent(api_key="test-key")

        assert runner.mode == "retrieve"
        mock_react.assert_not_called()
        kwargs = mock_llm.call_args.kwargs
        assert kwargs["provider"] == "helix"
        assert kwargs["helix_base_url"] == "https://helix.example"
        assert kwargs["helix_api_key"] == "key-123"

    def test_force_retrieve_mode(self, monkeypatch):
        monkeypatch.setenv("CODEGRAPH_AGENT_MODE", "retrieve")
        with patch("src.codegraph.agent._resolve_provider", return_value="anthropic"), \
             patch("src.codegraph.agent.get_llm", return_value=MagicMock()), \
             patch("src.codegraph.agent.create_react_agent") as mock_react:
            runner = create_codegraph_agent(api_key="k")
        assert runner.mode == "retrieve"
        mock_react.assert_not_called()

    def test_system_prompt_mentions_key_repo_components(self):
        assert "demo_api_server" in SYSTEM_PROMPT
        assert "langchain_agent" in SYSTEM_PROMPT
        assert "demo_mcp_gateway" in SYSTEM_PROMPT


class TestResolveMode:
    def test_auto_react_for_anthropic(self):
        assert _resolve_mode("anthropic") == "react"

    def test_auto_retrieve_for_helix(self):
        assert _resolve_mode("helix") == "retrieve"

    def test_auto_retrieve_for_llamacpp(self):
        assert _resolve_mode("llamacpp") == "retrieve"


def test_system_prompt_mentions_grep_and_read_file():
    lowered = SYSTEM_PROMPT.lower()
    assert "grep" in lowered
    assert "read_file" in lowered


@pytest.mark.asyncio
async def test_retrieve_emits_keepalive_while_llm_is_slow(monkeypatch):
    """Slow LLM must not go silent — keepalive comments keep proxies awake."""
    import asyncio
    from langchain_core.messages import HumanMessage
    import src.codegraph.agent as agent_mod

    monkeypatch.setattr(agent_mod, "KEEPALIVE_SECONDS", 0.05)

    class SlowLLM:
        async def astream(self, _msgs):
            await asyncio.sleep(0.2)
            chunk = MagicMock()
            chunk.content = "ok"
            yield chunk

        async def ainvoke(self, _msgs):
            raise AssertionError("ainvoke should not run when astream yields")

    runner = CodegraphRunner(mode="retrieve", provider="llamacpp", llm=SlowLLM(), graph=None)
    frames = []
    with patch("src.codegraph.agent.gather_context", return_value="CTX"):
        async for frame in runner._stream_retrieve([HumanMessage(content="q")]):
            frames.append(frame)

    joined = "".join(frames)
    assert ": keepalive" in joined
    assert '"type": "token"' in joined
    assert "ok" in joined


@pytest.mark.asyncio
async def test_retrieve_empty_llm_emits_error():
    from langchain_core.messages import HumanMessage

    class EmptyLLM:
        async def astream(self, _msgs):
            if False:
                yield None

        async def ainvoke(self, _msgs):
            chunk = MagicMock()
            chunk.content = ""
            return chunk

    runner = CodegraphRunner(mode="retrieve", provider="llamacpp", llm=EmptyLLM(), graph=None)
    frames = []
    with patch("src.codegraph.agent.gather_context", return_value="CTX"):
        async for frame in runner._stream_retrieve([HumanMessage(content="q")]):
            frames.append(frame)

    joined = "".join(frames)
    assert '"type": "error"' in joined
    assert "empty answer" in joined
