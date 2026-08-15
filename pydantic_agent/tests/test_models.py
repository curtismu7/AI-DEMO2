from src.models import BffDeps


def test_bffdeps_fields():
    deps = BffDeps(
        bff_tool_url="http://localhost:3001/internal/agent-tool",
        bff_internal_secret="secret",
        session_id="sess_abc",
    )
    assert deps.bff_tool_url == "http://localhost:3001/internal/agent-tool"
    assert deps.bff_internal_secret == "secret"
    assert deps.session_id == "sess_abc"


def test_bffdeps_is_dataclass():
    import dataclasses
    assert dataclasses.is_dataclass(BffDeps)
