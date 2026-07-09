"""Tests for the CodeGraph ReAct agent factory."""

from unittest.mock import patch, MagicMock
import pytest

from src.codegraph.agent import create_codegraph_agent, SYSTEM_PROMPT


class TestCreateCodegraphAgent:
    """Test the agent factory function."""

    def test_calls_get_llm_with_resolved_provider(self):
        """get_llm is called with the provider chosen by _resolve_provider.

        The cluster ships only a placeholder ANTHROPIC_API_KEY, so the agent
        defaults to the local llama.cpp provider when llama-server is reachable
        (overridable via CODEGRAPH_LLM_PROVIDER). The probe is mocked here so the
        test asserts the load-bearing invariants (provider, the unset model,
        api_key) deterministically rather than depending on a live server.
        """
        with patch("src.codegraph.agent._resolve_provider", return_value="llamacpp"), \
             patch("src.codegraph.agent.get_llm") as mock_llm, \
             patch("src.codegraph.agent.get_codegraph_tools", return_value=[]), \
             patch("src.codegraph.agent.create_react_agent", return_value=MagicMock()):
            create_codegraph_agent(api_key="test-key")

        mock_llm.assert_called_once()
        kwargs = mock_llm.call_args.kwargs
        assert kwargs["provider"] == "llamacpp"
        assert kwargs["model"] is None
        assert kwargs["api_key"] == "test-key"

    def test_passes_tools_to_react_agent(self):
        """Verify that get_codegraph_tools() results are passed to create_react_agent."""
        fake_tools = [MagicMock(), MagicMock()]
        with patch("src.codegraph.agent.get_llm", return_value=MagicMock()), \
             patch("src.codegraph.agent.get_codegraph_tools", return_value=fake_tools), \
             patch("src.codegraph.agent.create_react_agent", return_value=MagicMock()) as mock_create:
            create_codegraph_agent(api_key="test-key")

        mock_create.assert_called_once()
        call_args = mock_create.call_args
        # Second positional argument should be the tools list
        assert call_args.args[1] == fake_tools

    def test_passes_system_prompt(self):
        """Verify that a system prompt is passed to create_react_agent."""
        with patch("src.codegraph.agent.get_llm", return_value=MagicMock()), \
             patch("src.codegraph.agent.get_codegraph_tools", return_value=[]), \
             patch("src.codegraph.agent.create_react_agent", return_value=MagicMock()) as mock_create:
            create_codegraph_agent(api_key="test-key")

        call_kwargs = mock_create.call_args.kwargs
        assert call_kwargs.get("prompt") == SYSTEM_PROMPT

    def test_returns_agent_graph(self):
        """Verify that the factory returns the graph from create_react_agent."""
        mock_graph = MagicMock()
        with patch("src.codegraph.agent.get_llm", return_value=MagicMock()), \
             patch("src.codegraph.agent.get_codegraph_tools", return_value=[]), \
             patch("src.codegraph.agent.create_react_agent", return_value=mock_graph):
            result = create_codegraph_agent(api_key="test-key")

        assert result is mock_graph

    def test_system_prompt_mentions_key_repo_components(self):
        """Verify that SYSTEM_PROMPT mentions the key repository components."""
        assert "demo_api_server" in SYSTEM_PROMPT
        assert "langchain_agent" in SYSTEM_PROMPT
        assert "demo_mcp_gateway" in SYSTEM_PROMPT
        assert "demo_mcp_server" in SYSTEM_PROMPT


    def test_passes_helix_env_to_get_llm(self, monkeypatch):
        """Helix fallback must forward HELIX_* env vars into get_llm kwargs."""
        monkeypatch.setenv("HELIX_BASE_URL", "https://helix.example")
        monkeypatch.setenv("HELIX_API_KEY", "key-123")
        monkeypatch.setenv("HELIX_ENVIRONMENT_ID", "env-abc")
        monkeypatch.setenv("HELIX_AGENT_ID", "LLM2")
        monkeypatch.setenv("HELIX_PROMPT_FIELD_ID", "field-xyz")
        with patch("src.codegraph.agent._resolve_provider", return_value="helix"), \
             patch("src.codegraph.agent.get_llm") as mock_llm, \
             patch("src.codegraph.agent.get_codegraph_tools", return_value=[]), \
             patch("src.codegraph.agent.create_react_agent", return_value=MagicMock()):
            create_codegraph_agent(api_key="test-key")

        kwargs = mock_llm.call_args.kwargs
        assert kwargs["provider"] == "helix"
        assert kwargs["helix_base_url"] == "https://helix.example"
        assert kwargs["helix_api_key"] == "key-123"
        assert kwargs["helix_environment_id"] == "env-abc"
        assert kwargs["helix_agent_id"] == "LLM2"
        assert kwargs["helix_prompt_field_id"] == "field-xyz"


def test_system_prompt_mentions_grep_and_read_file():
    from src.codegraph.agent import SYSTEM_PROMPT
    lowered = SYSTEM_PROMPT.lower()
    assert "grep" in lowered
    assert "read_file" in lowered
