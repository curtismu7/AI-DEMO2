"""Where the code-search agent's LLM calls go, and what the Privilege path needs.

Through the PingOne Agent Privilege the custom lane (`<gateway>/llm/custom`) needs a
virtual key as the bearer and the model name the key allows (`llama.cpp`); the local
proxy needs neither. A silent fallback to the local proxy must still announce itself.
"""
from agent import _llm_route


def test_default_is_the_local_proxy_and_says_it_is_not_governed():
    r = _llm_route({})
    assert r["base"] == "http://llm-proxy:8090"
    assert r["api_key"] == "not-needed"
    assert r["model"] == "local"
    assert r["via_privilege"] is False
    assert "NOT governed" in r["label"]


def test_privilege_custom_lane_uses_the_virtual_key_and_the_allowed_model():
    r = _llm_route({"LLAMACPP_BASE_URL": "https://gw.example/llm/custom/", "LLAMACPP_API_KEY": "sk-test"})
    assert r["base"] == "https://gw.example/llm/custom"
    assert r["api_key"] == "sk-test"
    assert r["model"] == "llama.cpp"
    assert r["via_privilege"] is True
    assert "PRIVILEGE" in r["label"]


def test_explicit_model_wins_on_either_path():
    assert _llm_route({"AGENT_MODEL": "gpt-4o-mini"})["model"] == "gpt-4o-mini"
    r = _llm_route({"LLAMACPP_BASE_URL": "https://gw.example/llm/custom", "AGENT_MODEL": "gpt-4o-mini"})
    assert r["model"] == "gpt-4o-mini"


def test_privilege_url_without_a_key_is_flagged_as_misconfigured_not_silently_governed():
    r = _llm_route({"LLAMACPP_BASE_URL": "https://gw.example/llm/custom"})
    assert r["via_privilege"] is True
    assert "MISSING LLAMACPP_API_KEY" in r["label"]
