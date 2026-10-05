"""Providers llm_factory.get_llm can build must not trigger the "not supported" warning."""
import logging

from config.env_validator import EnvironmentValidator


def test_groq_is_a_supported_provider(monkeypatch, caplog):
    monkeypatch.setenv("LANGCHAIN_LLM_PROVIDER", "groq")
    with caplog.at_level(logging.WARNING):
        EnvironmentValidator.warn_unsupported_llm_provider()
    assert "not supported" not in caplog.text


def test_unknown_provider_still_warns(monkeypatch, caplog):
    monkeypatch.setenv("LANGCHAIN_LLM_PROVIDER", "no-such-provider")
    with caplog.at_level(logging.WARNING):
        EnvironmentValidator.warn_unsupported_llm_provider()
    assert "not supported" in caplog.text
