"""Unit tests for dynamic llm-proxy tier selection."""
from unittest.mock import patch

from codegraph.llm_target import (
    healthy_model_names,
    pick_healthy_model,
    preferred_model_name,
    resolve_llamacpp_target,
)


HEALTH = {
    "status": "healthy",
    "mode": "swap",
    "models": [
        {"name": "phi-4-mini-instruct", "port": 8091, "healthy": False, "load": 0},
        {"name": "gpt-oss-20b", "port": 8096, "healthy": True, "load": 0},
        {"name": "llama-3-groq-8b-tool-use", "port": 8093, "healthy": False, "load": 0},
    ],
}


class TestPickHealthyModel:
    def test_picks_only_healthy(self):
        assert healthy_model_names(HEALTH) == ["gpt-oss-20b"]
        assert pick_healthy_model(HEALTH) == "gpt-oss-20b"

    def test_honors_preferred_when_healthy(self):
        health = {
            "models": [
                {"name": "phi-4-mini-instruct", "healthy": True},
                {"name": "gpt-oss-20b", "healthy": True},
            ]
        }
        assert pick_healthy_model(health, preferred="phi-4-mini-instruct") == "phi-4-mini-instruct"

    def test_skips_preferred_when_unhealthy(self):
        assert pick_healthy_model(HEALTH, preferred="phi-4-mini-instruct") == "gpt-oss-20b"

    def test_none_when_all_down(self):
        health = {
            "models": [
                {"name": "phi-4-mini-instruct", "healthy": False},
                {"name": "gpt-oss-20b", "healthy": False},
            ]
        }
        assert pick_healthy_model(health) is None


class TestResolveTarget:
    def test_resolve_uses_proxy_health(self, monkeypatch):
        monkeypatch.setenv("LLAMACPP_BASE_URL", "http://llm-proxy:8090")
        monkeypatch.delenv("CODEGRAPH_LLAMACPP_BASE_URL", raising=False)
        monkeypatch.setenv("CODEGRAPH_MODEL", "phi-4-mini-instruct")
        with patch("codegraph.llm_target.fetch_proxy_health", return_value=HEALTH):
            base, model, reason = resolve_llamacpp_target()
        assert base == "http://llm-proxy:8090"
        assert model == "gpt-oss-20b"  # preferred phi unhealthy → gpt-oss
        assert "picked=gpt-oss-20b" in reason

    def test_preferred_model_skips_claude(self, monkeypatch):
        monkeypatch.setenv("CODEGRAPH_MODEL", "claude-sonnet-4-5")
        monkeypatch.setenv("LLAMACPP_MODEL", "phi-4-mini-instruct")
        assert preferred_model_name() == "phi-4-mini-instruct"
