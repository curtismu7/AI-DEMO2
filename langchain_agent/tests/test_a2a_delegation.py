import json

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from agent import a2a_delegation
from agent.a2a_delegation import DelegationError, build_delegate_tools, delegate, load_targets, start_hop_trace
from api.a2a_handler import public_router, router, set_federated_token_validator

TARGETS = {"refunds": {"url": "https://gateway.example/refunds/a2a/jsonrpc", "description": "Handles refunds."}}


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setenv("A2A_DELEGATE_TARGETS", json.dumps(TARGETS))
    monkeypatch.setenv("PRIVILEGE_A2A_AGENT_KEY", "agent-key")


def _client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def test_no_targets_without_a_key(monkeypatch):
    monkeypatch.setenv("A2A_DELEGATE_TARGETS", json.dumps(TARGETS))
    monkeypatch.delenv("PRIVILEGE_A2A_AGENT_KEY", raising=False)
    assert load_targets() == {}
    assert build_delegate_tools() == []


async def test_delegate_sends_the_key_and_returns_the_reply(configured):
    seen = {}

    def handler(request):
        seen["auth"] = request.headers["authorization"]
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": "1", "result": {"parts": [{"kind": "text", "text": "Refund approved"}]}})

    assert await delegate("refunds", "Refund order 7", client=_client(handler)) == "Refund approved"
    assert seen["auth"] == "Bearer agent-key"
    assert seen["body"]["method"] == "message/send"
    assert seen["body"]["params"]["message"]["parts"][0]["text"] == "Refund order 7"


async def test_delegate_surfaces_gateway_refusals(configured):
    with pytest.raises(DelegationError, match="unknown delegation target"):
        await delegate("nope", "hi")

    plain = _client(lambda request: httpx.Response(403, text="Forbidden: key not scoped for a2a access\n"))
    with pytest.raises(DelegationError, match="403.*not scoped"):
        await delegate("refunds", "hi", client=plain)

    blocked = _client(lambda request: httpx.Response(400, json={"jsonrpc": "2.0", "error": {"code": -32600, "message": "request blocked by security policy"}}))
    with pytest.raises(DelegationError, match="blocked by security policy"):
        await delegate("refunds", "hi", client=blocked)


async def test_tool_is_built_per_target_and_reports_failure_as_text(configured, monkeypatch):
    (tool,) = build_delegate_tools()
    assert tool.name == "delegate_to_refunds"

    async def boom(_name, _text):
        raise DelegationError("refunds unreachable")

    monkeypatch.setattr(a2a_delegation, "delegate", boom)
    assert "Delegation failed: refunds unreachable" in await tool.ainvoke({"message": "hi"})


def test_handler_forwards_when_the_caller_names_a_target(configured, monkeypatch):
    monkeypatch.setenv("PRIVILEGE_A2A_STATIC_TOKEN", "gateway-shared-secret")
    set_federated_token_validator(None)

    async def fake_delegate(name, text):
        return f"{name} handled: {text}"

    monkeypatch.setattr(a2a_delegation, "delegate", fake_delegate)
    app = FastAPI()
    app.include_router(router)
    app.include_router(public_router)

    response = TestClient(app).post(
        "/a2a/jsonrpc",
        headers={"Authorization": "Bearer gateway-shared-secret"},
        json={
            "jsonrpc": "2.0",
            "id": "d1",
            "method": "message/send",
            "params": {
                "metadata": {"delegateTo": "refunds"},
                "message": {"role": "user", "messageId": "m", "parts": [{"kind": "text", "text": "Refund order 7"}]},
            },
        },
    )

    assert response.status_code == 200
    result = response.json()["result"]
    assert result["parts"] == [{"kind": "text", "text": "refunds handled: Refund order 7"}]
    assert result["metadata"]["delegatedTo"] == "refunds"


async def test_hops_are_recorded_for_allowed_and_refused_hand_offs(configured):
    hops = start_hop_trace()
    ok = _client(lambda request: httpx.Response(200, json={"jsonrpc": "2.0", "result": {"parts": [{"kind": "text", "text": "ok"}]}}))
    await delegate("refunds", "hi", client=ok)
    refused = _client(lambda request: httpx.Response(403, text="Forbidden"))
    with pytest.raises(DelegationError):
        await delegate("refunds", "hi", client=refused)

    assert [(h["from"], h["to"], h["status"]) for h in hops] == [
        ("langchainagent", "refunds", "ok"),
        ("langchainagent", "refunds", "refused"),
    ]
    assert "403" in hops[1]["detail"]


def test_handler_reports_hops_from_a_model_chosen_hand_off(configured, monkeypatch):
    """A hand-off made inside the agent run (the tool path) still reaches the caller."""

    monkeypatch.setenv("PRIVILEGE_A2A_STATIC_TOKEN", "gateway-shared-secret")
    set_federated_token_validator(None)

    async def fake_send(target, text, client):
        return "specialist says hi"

    monkeypatch.setattr(a2a_delegation, "_send", fake_send)

    class ToolUsingAgent:
        async def process_message(self, text, session_id):
            (tool,) = build_delegate_tools()
            return await tool.ainvoke({"message": text})

    from api.a2a_handler import set_agent

    set_agent(ToolUsingAgent())
    app = FastAPI()
    app.include_router(router)
    response = TestClient(app).post(
        "/a2a/jsonrpc",
        headers={"Authorization": "Bearer gateway-shared-secret"},
        json={"jsonrpc": "2.0", "id": "t1", "method": "message/send",
              "params": {"message": {"role": "user", "messageId": "m", "parts": [{"kind": "text", "text": "ask refunds"}]}}},
    )

    assert response.status_code == 200
    result = response.json()["result"]
    assert result["parts"][0]["text"] == "specialist says hi"
    assert [(h["to"], h["status"]) for h in result["metadata"]["hops"]] == [("refunds", "ok")]
