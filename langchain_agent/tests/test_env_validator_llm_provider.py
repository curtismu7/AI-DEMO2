"""Providers llm_factory.get_llm can build must not trigger the "not supported" warning."""
import logging

import pytest

from config.env_validator import EnvironmentValidator


@pytest.mark.parametrize("provider", ["groq", "google"])
def test_cloud_providers_are_supported(provider, monkeypatch, caplog):
    monkeypatch.setenv("LANGCHAIN_LLM_PROVIDER", provider)
    with caplog.at_level(logging.WARNING):
        EnvironmentValidator.warn_unsupported_llm_provider()
    assert "not supported" not in caplog.text


def test_unknown_provider_still_warns(monkeypatch, caplog):
    monkeypatch.setenv("LANGCHAIN_LLM_PROVIDER", "no-such-provider")
    with caplog.at_level(logging.WARNING):
        EnvironmentValidator.warn_unsupported_llm_provider()
    assert "not supported" in caplog.text
