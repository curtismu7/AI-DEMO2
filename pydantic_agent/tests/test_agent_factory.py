import pytest
from unittest.mock import patch, MagicMock
from src.agent_factory import build_agent

SCHEMAS = [
    {
        "name": "get_accounts",
        "description": "List accounts",
        "inputSchema": {"type": "object", "properties": {"userId": {"type": "string"}}},
    }
]
MODEL = "google/gemma-4-e2b"
BASE_URL = "http://localhost:1234/v1"
API_KEY = "lm-studio"


def test_build_agent_returns_agent():
    with patch("src.agent_factory.Agent") as MockAgent:
        with patch("src.agent_factory.OpenAIModel"):
            with patch("src.agent_factory.OpenAIProvider"):
                MockAgent.return_value = MagicMock()
                agent = build_agent(SCHEMAS, MODEL, BASE_URL, API_KEY)
                assert agent is not None
                MockAgent.assert_called_once()


def test_build_agent_constructs_openai_model_with_provider():
    """build_agent must construct OpenAIModel(model_name, provider=OpenAIProvider(base_url, api_key))
    so pydantic_ai talks to LM Studio (or any OpenAI-compatible endpoint) instead
    of falling back to env-driven OPENAI_API_KEY."""
    with patch("src.agent_factory.Agent") as MockAgent:
        with patch("src.agent_factory.OpenAIModel") as MockModel:
            with patch("src.agent_factory.OpenAIProvider") as MockProvider:
                MockAgent.return_value = MagicMock()
                build_agent(SCHEMAS, MODEL, BASE_URL, API_KEY)
                MockProvider.assert_called_once_with(base_url=BASE_URL, api_key=API_KEY)
                # OpenAIModel called with the model name as the first positional/kwarg
                call = MockModel.call_args
                assert call.kwargs.get("model_name") == MODEL or (
                    call.args and call.args[0] == MODEL
                )


def test_build_agent_uses_default_system_prompt():
    with patch("src.agent_factory.Agent") as MockAgent:
        with patch("src.agent_factory.OpenAIModel"):
            with patch("src.agent_factory.OpenAIProvider"):
                MockAgent.return_value = MagicMock()
                build_agent(SCHEMAS, MODEL, BASE_URL, API_KEY)
                call_kwargs = MockAgent.call_args[1]
                assert "banking assistant" in call_kwargs.get("system_prompt", "")


def test_build_agent_uses_custom_system_prompt():
    with patch("src.agent_factory.Agent") as MockAgent:
        with patch("src.agent_factory.OpenAIModel"):
            with patch("src.agent_factory.OpenAIProvider"):
                MockAgent.return_value = MagicMock()
                build_agent(SCHEMAS, MODEL, BASE_URL, API_KEY, system_prompt="Custom prompt")
                call_kwargs = MockAgent.call_args[1]
                assert call_kwargs.get("system_prompt") == "Custom prompt"
