# openai_agent/tests/test_config.py
import os
import pytest
from unittest.mock import patch


def _reload_cfg():
    from importlib import reload
    import openai_agent.src.config as cfg
    reload(cfg)
    return cfg.get_config()


def test_config_reads_agent_llm_env_vars():
    """AGENT_LLM_* env vars (the canonical names) win when set."""
    with patch.dict(os.environ, {
        "AGENT_LLM_API_KEY": "lm-studio",
        "AGENT_LLM_BASE_URL": "http://localhost:1234/v1",
        "AGENT_LLM_MODEL": "qwen/qwen3.6-35b-a3b",
        "BFF_INTERNAL_SECRET": "secret123",
        "BFF_INTERNAL_TOOL_URL": "http://127.0.0.1:3001/internal/agent-tool",
        "AGENT_HTTP_PORT": "8891",
    }, clear=False):
        c = _reload_cfg()
        assert c.llm_api_key == "lm-studio"
        assert c.llm_base_url == "http://localhost:1234/v1"
        assert c.model == "qwen/qwen3.6-35b-a3b"
        assert c.bff_internal_secret == "secret123"
        assert c.bff_tool_url == "http://127.0.0.1:3001/internal/agent-tool"
        assert c.port == 8891


def test_config_falls_back_to_openai_legacy_env_vars():
    """OPENAI_API_KEY / OPENAI_MODEL still work as legacy fallbacks so existing
    .env files don't break when AGENT_LLM_* is unset."""
    with patch.dict(os.environ, {
        "OPENAI_API_KEY": "sk-test",
        "OPENAI_MODEL": "gpt-4o-mini",
    }, clear=True):
        c = _reload_cfg()
        assert c.llm_api_key == "sk-test"
        assert c.model == "gpt-4o-mini"


def test_config_defaults_to_lm_studio_when_nothing_set():
    """No env vars at all → LM Studio defaults so the agent boots without
    needing OPENAI_API_KEY (regression: KeyError at import time)."""
    with patch.dict(os.environ, {}, clear=True):
        c = _reload_cfg()
        assert c.llm_api_key == "lm-studio"
        assert c.llm_base_url == "http://localhost:1234/v1"
        assert c.model.startswith("google/")  # default LM Studio model
        assert c.port == 8891
