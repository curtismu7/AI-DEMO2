"""
Tests for ChatHelix LangChain adapter and updated llm_factory.

Real objects where possible:
  - ChatHelix construction and prompt-building helpers — fully real
  - _call_helix_async — httpx mocked (no network)
  - llm_factory.get_llm — real, ChatHelix construction tested

No Helix network required.
"""
import pytest
from unittest.mock import AsyncMock, Mock, patch, MagicMock
from langchain_core.messages import HumanMessage, SystemMessage, AIMessage

from src.agent.helix_llm import ChatHelix, _build_prompt, _extract_value, _api_base
from src.agent.llm_factory import get_llm


# ---------------------------------------------------------------------------
# _api_base — pure helper
# ---------------------------------------------------------------------------

class TestApiBase:
    def test_strips_path_from_console_url(self):
        result = _api_base("https://openam-helix.forgeblocks.com/some/ui/path")
        assert result == "https://openam-helix.forgeblocks.com/dpc/jas/helix/v1"

    def test_plain_origin(self):
        result = _api_base("https://openam-helix.forgeblocks.com")
        assert result == "https://openam-helix.forgeblocks.com/dpc/jas/helix/v1"


# ---------------------------------------------------------------------------
# _build_prompt — pure helper
# ---------------------------------------------------------------------------

class TestBuildPrompt:
    def test_user_only(self):
        msgs = [HumanMessage(content="what is my balance?")]
        assert _build_prompt(msgs) == "what is my balance?"

    def test_system_prepended_to_user(self):
        msgs = [
            SystemMessage(content="You are a banking assistant."),
            HumanMessage(content="show my accounts"),
        ]
        result = _build_prompt(msgs)
        assert result.startswith("You are a banking assistant.")
        assert "show my accounts" in result

    def test_last_user_message_wins(self):
        msgs = [
            HumanMessage(content="first message"),
            HumanMessage(content="second message"),
        ]
        result = _build_prompt(msgs)
        assert "second message" in result
        assert "first message" not in result


# ---------------------------------------------------------------------------
# _extract_value — pure helper
# ---------------------------------------------------------------------------

class TestExtractValue:
    def test_complete_class_plain_string(self):
        data = [{"class": "complete", "value": "hello world"}]
        assert _extract_value(data) == "hello world"

    def test_complete_class_json_response(self):
        import json
        data = [{"class": "complete", "value": json.dumps({"response": "my response"})}]
        assert _extract_value(data) == "my response"

    def test_no_complete_message_returns_none(self):
        data = [{"class": "start", "value": "something"}]
        assert _extract_value(data) is None

    def test_empty_list(self):
        assert _extract_value([]) is None


# ---------------------------------------------------------------------------
# ChatHelix construction
# ---------------------------------------------------------------------------

class TestChatHelixConstruction:
    def _make_helix(self):
        return ChatHelix(
            helix_base_url="https://openam-helix.forgeblocks.com",
            helix_api_key="test-key",
            helix_environment_id="env-uuid",
            helix_agent_id="LLM2",
            helix_prompt_field_id="textInputabc",
        )

    def test_llm_type(self):
        llm = self._make_helix()
        assert llm._llm_type == "helix"

    def test_fields_stored(self):
        llm = self._make_helix()
        assert llm.helix_agent_id == "LLM2"
        assert llm.helix_api_key == "test-key"
        assert llm.helix_environment_id == "env-uuid"
        assert llm.helix_prompt_field_id == "textInputabc"

    @pytest.mark.asyncio
    async def test_agenerate_returns_ai_message(self):
        """_agenerate calls _call_helix_async and wraps result in ChatResult."""
        llm = self._make_helix()
        llm._call_helix_async = AsyncMock(return_value="Your balance is $500")

        result = await llm._agenerate([HumanMessage(content="show balance")])

        assert len(result.generations) == 1
        assert isinstance(result.generations[0].message, AIMessage)
        assert result.generations[0].message.content == "Your balance is $500"


# ---------------------------------------------------------------------------
# llm_factory.get_llm — provider routing
# ---------------------------------------------------------------------------

class TestGetLlm:
    def test_helix_provider_returns_chat_helix(self):
        llm = get_llm(
            provider="helix",
            helix_base_url="https://openam-helix.forgeblocks.com",
            helix_api_key="k",
            helix_environment_id="e",
            helix_agent_id="LLM2",
            helix_prompt_field_id="f",
        )
        assert llm._llm_type == "helix"
        assert isinstance(llm, ChatHelix)

    def test_default_provider_is_helix(self):
        llm = get_llm(
            helix_base_url="https://openam-helix.forgeblocks.com",
            helix_api_key="k",
            helix_environment_id="e",
            helix_agent_id="LLM2",
            helix_prompt_field_id="f",
        )
        assert isinstance(llm, ChatHelix)

    def test_unknown_provider_returns_none(self):
        """An unknown provider falls back to 'none' (heuristic routing), so get_llm
        returns None — see the get_llm docstring. (It does NOT silently become
        Helix, which would require tenant-specific config and fail later.)"""
        llm = get_llm(
            provider="unknown-llm",
            helix_base_url="https://openam-helix.forgeblocks.com",
            helix_api_key="k",
            helix_environment_id="e",
            helix_agent_id="LLM2",
            helix_prompt_field_id="f",
        )
        assert llm is None

    def test_lmstudio_provider_returns_chat_openai(self):
        from langchain_openai import ChatOpenAI
        llm = get_llm(provider="lmstudio", lmstudio_base_url="http://localhost:1234/v1")
        assert isinstance(llm, ChatOpenAI)

    def test_anthropic_lmstudio_provider_returns_chat_anthropic(self):
        from langchain_anthropic import ChatAnthropic
        llm = get_llm(
            provider="anthropic-lmstudio",
            lmstudio_base_url="http://localhost:1234/v1",
            model="claude-3-5-sonnet-20241022",
            api_key="lm-studio",
        )
        assert isinstance(llm, ChatAnthropic)

    def test_anthropic_lmstudio_strips_v1_from_base_url(self):
        """anthropic-lmstudio must strip /v1 so Anthropic SDK can append /v1/messages."""
        from langchain_anthropic import ChatAnthropic
        llm = get_llm(
            provider="anthropic-lmstudio",
            lmstudio_base_url="http://localhost:1234/v1",
            api_key="lm-studio",
        )
        assert isinstance(llm, ChatAnthropic)
        # anthropic_api_url should be the bare origin
        assert llm.anthropic_api_url == "http://localhost:1234"


# ---------------------------------------------------------------------------
# helix_key_loader — auto-load from JSON file
# ---------------------------------------------------------------------------

class TestHelixKeyLoader:
    def test_loads_key_from_file(self, tmp_path):
        import json
        from src.agent.helix_key_loader import load_agent_key
        key_file = tmp_path / "TestAgent.json"
        key_file.write_text(json.dumps({"keyValue": "my-agent-key"}))

        # Patch the search candidates to include tmp_path
        import src.agent.helix_key_loader as loader
        original_repo_root = loader._REPO_ROOT
        loader._REPO_ROOT = tmp_path
        loader.clear_cache()
        try:
            result = loader.load_agent_key("TestAgent")
            assert result == "my-agent-key"
        finally:
            loader._REPO_ROOT = original_repo_root
            loader.clear_cache()

    def test_returns_none_when_no_file(self, tmp_path):
        import src.agent.helix_key_loader as loader
        original_repo_root = loader._REPO_ROOT
        original_home = loader._HOME
        loader._REPO_ROOT = tmp_path
        loader._HOME = tmp_path
        loader.clear_cache()
        try:
            result = loader.load_agent_key("NoSuchAgent")
            assert result is None
        finally:
            loader._REPO_ROOT = original_repo_root
            loader._HOME = original_home
            loader.clear_cache()

    def test_empty_key_value_returns_none(self, tmp_path):
        import json
        import src.agent.helix_key_loader as loader
        key_file = tmp_path / "EmptyAgent.json"
        key_file.write_text(json.dumps({"keyValue": ""}))
        original_repo_root = loader._REPO_ROOT
        loader._REPO_ROOT = tmp_path
        loader.clear_cache()
        try:
            result = loader.load_agent_key("EmptyAgent")
            assert result is None
        finally:
            loader._REPO_ROOT = original_repo_root
            loader.clear_cache()

    def test_chat_helix_raises_when_no_key(self, tmp_path):
        """ChatHelix._resolve_api_key raises a clear error when no key is available."""
        import src.agent.helix_key_loader as loader
        original_repo_root = loader._REPO_ROOT
        original_home = loader._HOME
        loader._REPO_ROOT = tmp_path
        loader._HOME = tmp_path
        loader.clear_cache()
        try:
            llm = ChatHelix(
                helix_base_url="https://openam-helix.forgeblocks.com",
                helix_api_key="",  # blank
                helix_environment_id="e",
                helix_agent_id="MissingAgent",
                helix_prompt_field_id="f",
            )
            with pytest.raises(RuntimeError, match="No Helix API key found"):
                llm._resolve_api_key()
        finally:
            loader._REPO_ROOT = original_repo_root
            loader._HOME = original_home
            loader.clear_cache()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
