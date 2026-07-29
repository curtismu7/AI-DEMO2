"""A tool result that says "a human must approve this" must end the turn as an
AG-UI interrupt, not become narration.

The BFF's /internal/agent-tool already normalizes a 428 gate into
``result.hitlRequired`` + ``interruptId`` (routes/agentTool.js). Nothing
downstream read it: the result went back to the LLM, which politely reported
"I've submitted the request and it's pending approval" while the challenge sat
in demo_hitl_service unapproved, because the UI only opens its consent modal on
a RUN_FINISHED whose outcome is an interrupt.

Mirrors the shape of _extract_policy_denial, which already scans this same
tool-result list for authorization codes.
"""
import json
from types import SimpleNamespace

from langchain_core.messages import ToolMessage

from src.api.message_processor import (
    _extract_hitl_interrupt,
    _extract_policy_denial,
    _tool_result_text,
)


def _rec(result):
    return SimpleNamespace(result=result if isinstance(result, str) else json.dumps(result))


def test_extracts_the_interrupt_from_a_hitl_tool_result():
    calls = [_rec({
        "hitlRequired": True,
        "interruptId": "c1",
        "consentId": "c1",
        "tool": "checkout",
        "reason": "consent",
        "message": "Human approval is required before this action can run.",
        "expiresAt": "2026-07-28T17:00:00.000Z",
    })]
    got = _extract_hitl_interrupt(calls)
    assert got is not None
    assert got["interruptId"] == "c1"
    assert got["consentId"] == "c1"
    assert got["tool"] == "checkout"
    assert got["message"].startswith("Human approval is required")


def test_step_up_gates_are_interrupts_too():
    calls = [_rec({"hitlRequired": True, "interruptId": "c2", "stepUp": True, "tool": "checkout"})]
    got = _extract_hitl_interrupt(calls)
    assert got is not None
    assert got["stepUp"] is True


def test_returns_none_for_ordinary_results():
    assert _extract_hitl_interrupt([_rec({"balance": 100})]) is None
    assert _extract_hitl_interrupt([_rec("just a string")]) is None
    assert _extract_hitl_interrupt([]) is None
    assert _extract_hitl_interrupt(None) is None


def test_a_denial_is_not_an_interrupt():
    """A DENY is terminal — it must keep flowing to _extract_policy_denial's
    deterministic notice, not pause the run waiting for an approval that will
    never come."""
    calls = [_rec({"error": "transaction_denied", "message": "amount over limit"})]
    assert _extract_hitl_interrupt(calls) is None


def test_first_hitl_result_wins_when_several_tools_ran():
    calls = [
        _rec({"balance": 100}),
        _rec({"hitlRequired": True, "interruptId": "c3", "tool": "checkout"}),
        _rec({"hitlRequired": True, "interruptId": "c4", "tool": "pay_bill"}),
    ]
    assert _extract_hitl_interrupt(calls)["interruptId"] == "c3"


def test_survives_a_non_json_result():
    assert _extract_hitl_interrupt([_rec("<html>502</html>")]) is None


# ── How the result is captured off the event stream ──────────────────────────
# The extractor above was correct and still did nothing in production: LangGraph's
# ToolNode hands on_tool_end a ToolMessage, not the tool's raw return, and the
# capture site recorded str(output) — a repr:
#     content='{"hitlRequired": true, ...}' name='checkout' tool_call_id='tc1'
# "hitlRequired" IS in that string, so the substring guard passed and json.loads
# then threw, and every gate fell through to None. _extract_policy_denial hid the
# same defect because it falls back to a generic sentence when parsing fails.


def _tool_message(payload):
    return ToolMessage(content=json.dumps(payload), tool_call_id="tc1", name="checkout")


def test_toolmessage_output_is_unwrapped_to_its_content():
    msg = _tool_message({"hitlRequired": True, "interruptId": "c9"})
    assert json.loads(_tool_result_text(msg))["interruptId"] == "c9"


def test_a_raw_string_output_is_passed_through_unchanged():
    assert _tool_result_text('{"balance": 100}') == '{"balance": 100}'
    assert _tool_result_text(None) == ""


def test_the_interrupt_survives_the_real_capture_path():
    """End to end over the shape the event stream actually produces."""
    msg = _tool_message({"hitlRequired": True, "interruptId": "c9", "tool": "checkout"})
    got = _extract_hitl_interrupt([SimpleNamespace(result=_tool_result_text(msg))])
    assert got is not None
    assert got["interruptId"] == "c9"


def test_a_denial_captured_the_same_way_keeps_its_specific_message():
    """Regression the generic fallback was masking: the BFF's real reason was
    being replaced by "denied by an authorization policy" on every denial."""
    msg = _tool_message({"error": "transaction_denied", "message": "Amount exceeds the $2000 limit"})
    got = _extract_policy_denial([SimpleNamespace(result=_tool_result_text(msg))])
    assert got == "Amount exceeds the $2000 limit"
