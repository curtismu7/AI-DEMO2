import sys
import types

from agent.opik_tracing import opik_callbacks


def test_noop_without_api_key(monkeypatch):
    monkeypatch.delenv("OPIK_API_KEY", raising=False)
    assert opik_callbacks("s1") == []


def test_tracer_attached_with_api_key(monkeypatch):
    monkeypatch.setenv("OPIK_API_KEY", "x")
    calls = {}

    class FakeTracer:
        def __init__(self, **kw):
            calls.update(kw)

    mod = types.ModuleType("opik.integrations.langchain")
    mod.OpikTracer = FakeTracer
    monkeypatch.setitem(sys.modules, "opik", types.ModuleType("opik"))
    monkeypatch.setitem(sys.modules, "opik.integrations", types.ModuleType("opik.integrations"))
    monkeypatch.setitem(sys.modules, "opik.integrations.langchain", mod)

    cbs = opik_callbacks("sess-9")
    assert len(cbs) == 1 and calls["thread_id"] == "sess-9"


def test_import_failure_is_swallowed(monkeypatch):
    monkeypatch.setenv("OPIK_API_KEY", "x")
    monkeypatch.setitem(sys.modules, "opik.integrations.langchain", None)
    assert opik_callbacks("s1") == []
