from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.a2a_handler import (
    router,
    set_agent,
    set_federated_token_validator,
    set_transaction_token_validator,
)
from authentication.federated_token_validator import FederatedCaller, TokenValidationError
from authentication.token_validator import TokenValidationError


class FakeAgent:
    def __init__(self):
        self.calls = []

    async def process_message(self, text, session_id):
        self.calls.append((text, session_id))
        return "Delegated reply"


def client():
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def reject_token(_token):
    raise TokenValidationError("rejected")


def test_agent_card_advertises_privilege_compatible_jsonrpc(monkeypatch):
    monkeypatch.setenv(
        "PRIVILEGE_A2A_PUBLIC_URL",
        "https://gateway.example/langchainagent/a2a/jsonrpc",
    )
    response = client().get("/a2a/.well-known/agent-card.json")
    assert response.status_code == 200
    card = response.json()
    assert card["protocolVersion"] == "0.3.0"
    assert card["preferredTransport"] == "JSONRPC"
    assert card["url"] == "https://gateway.example/langchainagent/a2a/jsonrpc"


def test_agent_card_advertises_customer_oauth(monkeypatch):
    monkeypatch.setenv("A2A_PUBLIC_URL", "https://agent.example/a2a/jsonrpc")
    monkeypatch.setenv("A2A_TENANT_METADATA_URLS", "https://idp.a.example/.well-known/openid-configuration,https://idp.b.example/.well-known/openid-configuration")

    response = client().get("/a2a/.well-known/agent-card.json")

    assert response.status_code == 200
    card = response.json()
    assert card["url"] == "https://agent.example/a2a/jsonrpc"
    assert card["securityRequirements"] == [{"customerOAuth": ["agent:invoke"]}]
    assert card["x-tenantOAuthMetadata"] == [
        "https://idp.a.example/.well-known/openid-configuration",
        "https://idp.b.example/.well-known/openid-configuration",
    ]


def test_jsonrpc_accepts_allowlisted_customer_bearer_without_privilege_token():
    fake = FakeAgent()
    set_agent(fake)
    set_federated_token_validator(
        type("Validator", (), {"validate": lambda _self, token: FederatedCaller("tenant-a", "user-a", "a@example.test", ("agent:invoke",))})()
    )
    response = client().post(
        "/a2a/jsonrpc",
        headers={"Authorization": "Bearer customer-token"},
        json={
            "jsonrpc": "2.0",
            "id": "customer-1",
            "method": "message/send",
            "params": {"message": {"parts": [{"text": "hello"}]}},
        },
    )

    assert response.status_code == 200
    assert fake.calls[0][0] == "hello"


def test_jsonrpc_returns_403_for_customer_scope_failure():
    set_federated_token_validator(
        type("Validator", (), {"validate": lambda _self, token: (_ for _ in ()).throw(TokenValidationError("required scope missing: agent:invoke"))})()
    )
    response = client().post(
        "/a2a/jsonrpc",
        headers={"Authorization": "Bearer customer-token"},
        json={"jsonrpc": "2.0", "id": "scope-1", "method": "message/send", "params": {}},
    )

    assert response.status_code == 403
    assert response.headers["www-authenticate"].startswith("Bearer")


def test_jsonrpc_requires_cryptographically_valid_privilege_token():
    set_transaction_token_validator(reject_token)
    response = client().post(
        "/a2a/jsonrpc",
        headers={"txn-token": "forged"},
        json={"jsonrpc": "2.0", "id": "1", "method": "message/send", "params": {}},
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == -32001


def test_jsonrpc_message_send_runs_agent_without_echoing_transaction_token():
    fake = FakeAgent()
    set_agent(fake)
    set_transaction_token_validator(lambda _token: {"client_id": "privilege-caller"})
    response = client().post(
        "/a2a/jsonrpc",
        headers={"txn-token": "signed-gateway-token"},
        json={
            "jsonrpc": "2.0",
            "id": "request-1",
            "method": "message/send",
            "params": {
                "message": {
                    "role": "user",
                    "messageId": "message-1",
                    "parts": [{"kind": "text", "text": "Summarize account access"}],
                }
            },
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["result"]["parts"] == [{"kind": "text", "text": "Delegated reply"}]
    assert "signed-gateway-token" not in response.text
    assert fake.calls[0][0] == "Summarize account access"
    assert fake.calls[0][1].startswith("a2a-")
