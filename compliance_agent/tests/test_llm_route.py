import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from llm_route import llm_route  # noqa: E402


def test_default_is_vendor_direct_with_existing_model():
    r = llm_route({})
    assert r["via_privilege"] is False
    assert r["model"] == "claude-3-5-sonnet-20241022"
    assert "NOT governed" in r["label"]


def test_privilege_base_url_switches_to_the_allowed_haiku_model():
    r = llm_route({"ANTHROPIC_BASE_URL": "https://gw.example/llm/anthropic"})
    assert r["via_privilege"] is True
    assert r["model"] == "claude-haiku-4-5"
    assert "PRIVILEGE" in r["label"]


def test_explicit_model_always_wins():
    r = llm_route({"ANTHROPIC_BASE_URL": "https://gw.example/llm/anthropic", "COMPLIANCE_MODEL": "claude-haiku-4-5-20251001"})
    assert r["model"] == "claude-haiku-4-5-20251001"


def test_a_non_privilege_custom_base_url_is_not_reported_as_governed():
    r = llm_route({"ANTHROPIC_BASE_URL": "https://proxy.internal"})
    assert r["via_privilege"] is False
    assert "NOT governed" in r["label"]
